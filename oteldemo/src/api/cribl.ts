/**
 * Thin client for Cribl Search job API.
 *
 * Inside the Cribl App Platform iframe, window.CRIBL_API_URL is injected and
 * all fetch() calls to that origin are automatically proxied (auth headers
 * injected, pack-scoped rewrites applied). For local dev the env variable
 * VITE_CRIBL_API_URL can be used.
 */

declare global {
  interface Window {
    CRIBL_API_URL?: string;
    CRIBL_BASE_PATH?: string;
    CRIBL_APP_ID?: string;
  }
}

function apiUrl(): string {
  return window.CRIBL_API_URL ?? import.meta.env.VITE_CRIBL_API_URL ?? '/api/v1';
}

/** Search endpoints MUST go through the default_search config group. */
function searchBase(): string {
  return `${apiUrl()}/m/default_search/search`;
}

export interface SearchJobResult {
  jobId: string;
  status: string;
  events: Record<string, unknown>[];
}

/**
 * Run a KQL query and return parsed result rows.
 *
 * Creates a search job, polls until completion, then fetches results.
 */
export async function runQuery(
  kql: string,
  earliest: string = '-1h',
  latest: string = 'now',
  limit: number = 200,
): Promise<Record<string, unknown>[]> {
  // 1. Create the job
  const createResp = await fetch(`${searchBase()}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: kql, earliest, latest }),
  });
  if (!createResp.ok) {
    const text = await createResp.text();
    throw new Error(`Search job creation failed (${createResp.status}): ${text}`);
  }
  const job = (await createResp.json()) as { id: string };
  const jobId = job.id;

  // 2. Poll until done
  let status = '';
  for (let i = 0; i < 120; i++) {
    const poll = await fetch(`${searchBase()}/jobs/${jobId}`);
    if (!poll.ok) throw new Error(`Poll failed: ${poll.status}`);
    const state = (await poll.json()) as { status: string };
    status = state.status;
    if (status === 'completed' || status === 'failed' || status === 'canceled') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (status !== 'completed') throw new Error(`Search job ${jobId} ended with status: ${status}`);

  // 3. Fetch results
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  while (rows.length < limit) {
    const pageSize = Math.min(200, limit - rows.length);
    const res = await fetch(
      `${searchBase()}/jobs/${jobId}/results?offset=${offset}&limit=${pageSize}`,
    );
    if (!res.ok) throw new Error(`Results fetch failed: ${res.status}`);
    const data = (await res.json()) as { results: Record<string, unknown>[]; totalEventCount?: number };
    const page = data.results ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return rows;
}
