/**
 * Streaming client for the Cribl Copilot Investigation agent.
 *
 * Endpoint: POST /api/v1/ai/q/agents/local_search
 * Response: NDJSON stream, one JSON object per line. Each line is one of:
 *
 *   1. Text token:
 *        {"name":"agent:local_search","role":"assistant","content":"word"}
 *
 *   2. Tool call (may batch multiple calls in one frame):
 *        {"name":"agent:local_search","role":"assistant","content":null,
 *         "tool_calls":[{"id":"call_xxx","function":{"name":"...","arguments":"{...}"}}]}
 *
 *   3. Inline tool result (server-side tools like fetch_local_context):
 *        {"role":"tool","content":"..."}
 *
 *   4. UI notification (loading spinner, status):
 *        {"notificationMessageType":"loadingMessage","toolName":"...","content":[...]}
 *
 * The agent loop (see agentLoop.ts) consumes this stream, executes any
 * client-side tool calls, then sends the full updated message history
 * back in a fresh POST to continue the conversation.
 */

export interface AgentMessage {
  id?: string;
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  reqId?: number;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AgentToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentContext {
  resources?: {
    availableDatasets?: Array<{ id: string; description?: string }>;
  };
  files?: Record<string, unknown>;
}

export interface AgentRequest {
  messages: AgentMessage[];
  stream: boolean;
  sessionId: string;
  context: AgentContext;
  tools?: AgentToolDefinition[];
}

export interface AgentToolDefinition {
  id: string;
  description: string;
  schema?: Record<string, unknown>;
}

/** A parsed frame from the streaming NDJSON response. */
export type AgentFrame =
  | { kind: 'text'; content: string }
  | { kind: 'toolCalls'; calls: AgentToolCall[] }
  | { kind: 'toolResult'; content: string }
  | { kind: 'notification'; toolName?: string; content: unknown }
  | { kind: 'unknown'; raw: unknown };

/** Raised when the Cribl platform's injected auth token has expired
 *  and we get a 5xx back with a "Bearer Token has expired" reason.
 *  Catch this at the UI layer and prompt the user to reload the tab —
 *  a hard reload is currently the only way to pick up a fresh token
 *  from the platform's fetch proxy. */
export class SessionExpiredError extends Error {
  readonly isSessionExpired = true as const;
  constructor(message = 'Your Cribl session has expired. Reload the page to continue.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export function isSessionExpiredError(err: unknown): err is SessionExpiredError {
  return (
    err instanceof Error &&
    (err as { isSessionExpired?: boolean }).isSessionExpired === true
  );
}

/** Does a server error body look like an expired-token rejection?
 *  The agent endpoint returns `{"reason":"Bearer Token has expired"}`
 *  under a 5xx; future Cribl versions may use slightly different
 *  wording so we match permissively. */
function looksLikeSessionExpired(body: string): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes('bearer token has expired') ||
    lower.includes('token has expired') ||
    lower.includes('token expired')
  );
}

/**
 * Touch one of the cheap AI metadata GETs to nudge the platform to
 * refresh the AI bearer token it caches per user.
 *
 * The Cribl platform's fetch proxy injects auth into every API call
 * (per `oteldemo/AGENTS.md`), but the AI subsystem appears to keep
 * its own per-user bearer token with a shorter TTL than the user's
 * Cribl session cookie. Once it expires, the agent endpoint returns
 * 500 + `{"reason":"Bearer Token has expired"}` even though the
 * user's session is still valid (other API calls keep working).
 *
 * Captures of the native Cribl Search Copilot UI (see
 * `docs/research/investigator-spike/all-api-calls.json`) show it
 * fetches these AI metadata endpoints before every investigation:
 *   - `GET /api/v1/ai/consent/`
 *   - `GET /api/v1/ai/settings/disabled`
 *   - `GET /api/v1/ai/settings/features`
 * Best theory is one of these (or all of them) is what keeps the
 * AI bearer token cache warm. We pick `/ai/settings/features`
 * because it's a single round-trip, has no side effects, and is
 * the most-recently-fetched of the three in the native trace.
 *
 * Best-effort. Errors swallowed — the caller is going to retry the
 * agent POST regardless and surface a real error if that still
 * fails.
 */
async function warmupAiToken(signal?: AbortSignal): Promise<void> {
  try {
    await fetch(`${apiUrl()}/ai/settings/features`, { method: 'GET', signal });
  } catch {
    /* swallow — caller will retry the agent POST and surface real failures */
  }
}

function apiUrl(): string {
  return window.CRIBL_API_URL ?? import.meta.env.VITE_CRIBL_API_URL ?? '/api/v1';
}

function agentUrl(): string {
  return `${apiUrl()}/ai/q/agents/local_search`;
}

/**
 * Parse one NDJSON line into an AgentFrame. Unknown shapes are
 * preserved for debugging rather than dropped on the floor.
 */
export function parseAgentFrame(line: string): AgentFrame | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Notification frames (loading spinners, status messages)
  if ('notificationMessageType' in obj) {
    return {
      kind: 'notification',
      toolName: typeof obj.toolName === 'string' ? obj.toolName : undefined,
      content: obj.content,
    };
  }

  // Server-side tool result frames (e.g. fetch_local_context)
  if (obj.role === 'tool') {
    return {
      kind: 'toolResult',
      content: typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content ?? ''),
    };
  }

  // Assistant frames — either text chunks or tool call batches
  if (obj.role === 'assistant') {
    const toolCalls = obj.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      return { kind: 'toolCalls', calls: toolCalls as AgentToolCall[] };
    }
    if (typeof obj.content === 'string') {
      return { kind: 'text', content: obj.content };
    }
  }

  return { kind: 'unknown', raw: obj };
}

/** POST the agent request once. On a 5xx with an expired-token
 *  signature, returns null so the caller can warm up + retry; on
 *  any other failure, throws. On success, returns the live Response
 *  so the caller can stream from `resp.body`. */
async function postAgentRequest(
  req: AgentRequest,
  signal?: AbortSignal,
): Promise<Response | null> {
  const resp = await fetch(agentUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (resp.ok) {
    if (!resp.body) throw new Error('Agent response has no body');
    return resp;
  }
  const body = await resp.text().catch(() => '');
  if (looksLikeSessionExpired(body)) {
    return null;
  }
  throw new Error(`Agent request failed (${resp.status}): ${body}`);
}

/**
 * POST a request to the agent endpoint and yield parsed frames as
 * they arrive. The stream ends when the server closes the connection.
 *
 * AbortSignal support lets callers cancel in-flight investigations
 * (e.g. when the user navigates away or clicks a Stop button).
 *
 * Expired-token recovery: if the first POST returns a 5xx with a
 * "Bearer Token has expired" body, we call `warmupAiToken()` to
 * nudge the platform's AI token cache and retry the POST exactly
 * once. If the retry also returns the expired-token error, we
 * surface a `SessionExpiredError` so the UI can prompt the user to
 * reload the page (the only currently-known fallback if the warmup
 * GET doesn't recover the cache). All other 5xx/4xx errors throw
 * immediately without retrying, since they're not transient.
 */
export async function* streamAgent(
  req: AgentRequest,
  signal?: AbortSignal,
): AsyncGenerator<AgentFrame, void, void> {
  let resp = await postAgentRequest(req, signal);
  if (resp === null) {
    // First attempt hit the expired-token error. Warm up the AI
    // bearer token cache and retry once. If we still get the same
    // error, give up and ask the user to reload.
    await warmupAiToken(signal);
    resp = await postAgentRequest(req, signal);
    if (resp === null) {
      throw new SessionExpiredError();
    }
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  // Line buffer — NDJSON frames are newline-delimited, but a single
  // chunk from the reader can contain a partial line.
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, newlineIdx);
        buf = buf.slice(newlineIdx + 1);
        const frame = parseAgentFrame(line);
        if (frame) yield frame;
      }
    }
    // Flush any trailing partial line (rare but possible)
    if (buf.trim()) {
      const frame = parseAgentFrame(buf);
      if (frame) yield frame;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Fire the lightweight analytics event the native UI sends alongside
 * each user query submission. The server appears to require it — the
 * conversation still runs without it, but we match the native UI
 * behavior to avoid divergence.
 */
export async function logAgentEvent(
  eventType: string,
  eventClass: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await fetch(`${apiUrl()}/ai/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientTimestamp: Date.now(),
        eventType,
        eventClass,
        surface: 'criblApmInvestigation',
        ...payload,
      }),
    });
  } catch {
    /* analytics are best-effort */
  }
}
