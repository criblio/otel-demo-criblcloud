/**
 * Force-directed dependency graph rendered as SVG.
 *
 * Uses d3-force for the physics simulation. We render the SVG ourselves
 * (rather than reaching for a React wrapper) because the popular wrappers
 * around d3-force / force-graph hit hooks-dispatcher errors under Vite + React 19,
 * and the rendering surface is small enough to write directly.
 *
 * The simulation owns its node/link arrays via refs so d3 can mutate them in
 * place each tick — we then bump a counter via setState to schedule a render
 * pass that reads the latest positions.
 *
 * Nodes are:
 *  - filled by *health* (error rate bucket — green / yellow / orange / red / gray)
 *  - sized by *traffic* (log of request count)
 *  - outlined by service identity hue (subtle) so two services with the
 *    same health still look distinguishable
 * On hover: show a floating NodeTooltip card with full stats + sparklines.
 * On click: pin the tooltip in place (adds a close button); clicking the
 *   same node or the background closes it. Navigation to the full service
 *   detail page happens via the "View service detail →" link inside the
 *   tooltip, so the click on the node itself is reserved for pinning.
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import NodeTooltip from './NodeTooltip';
import { serviceColor } from '../utils/spans';
import { serviceHealth } from '../utils/health';
import type {
  DependencyEdge,
  ServiceSummary,
  ServiceBucket,
} from '../api/types';

interface SimNode extends SimulationNodeDatum {
  id: string;
  size: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  value: number;
}

interface Props {
  edges: DependencyEdge[];
  /** Per-service summary keyed by service name. Drives health color + tooltip. */
  services: Map<string, ServiceSummary>;
  /** Time buckets keyed by service name. Drives sparklines in the tooltip. */
  bucketsByService: Map<string, ServiceBucket[]>;
  width: number;
  height: number;
}

export default function DependencyGraph({
  edges,
  services,
  bucketsByService,
  width,
  height,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  // Build nodes & links from edges (skip self-loops; aggregate edge counts).
  const { nodes, links } = useMemo(() => {
    const nodeMap = new Map<string, SimNode>();
    const linkAgg = new Map<string, SimLink>();
    // Seed from services map so services without dependencies still appear.
    for (const svc of services.keys()) {
      if (!nodeMap.has(svc)) nodeMap.set(svc, { id: svc, size: 0 });
    }
    for (const e of edges) {
      if (!nodeMap.has(e.parent)) nodeMap.set(e.parent, { id: e.parent, size: 0 });
      if (!nodeMap.has(e.child)) nodeMap.set(e.child, { id: e.child, size: 0 });
      nodeMap.get(e.parent)!.size += e.callCount;
      nodeMap.get(e.child)!.size += e.callCount;
      if (e.parent === e.child) continue;
      const key = `${e.parent}\u0000${e.child}`;
      const existing = linkAgg.get(key);
      if (existing) {
        existing.value += e.callCount;
      } else {
        linkAgg.set(key, {
          source: e.parent,
          target: e.child,
          value: e.callCount,
        });
      }
    }
    return { nodes: Array.from(nodeMap.values()), links: Array.from(linkAgg.values()) };
  }, [edges, services]);

  function nodeRadius(node: SimNode): number {
    // Size by traffic (request count). Fall back to edge callCount if no summary.
    const summary = services.get(node.id);
    const volume = summary ? summary.requests : node.size;
    return Math.max(10, Math.min(34, 10 + Math.log10(volume + 1) * 6));
  }

  // Live positions tracked in state so React re-renders on each tick.
  // We mutate the simNodes objects in place — d3 owns them.
  const [, force] = useState(0); // bumped each tick to trigger re-renders
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);

  useEffect(() => {
    // Clone so d3-force can mutate freely
    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const simLinks: SimLink[] = links.map((l) => ({ ...l }));
    simNodesRef.current = simNodes;
    simLinksRef.current = simLinks;

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(130)
          .strength(0.5),
      )
      .force('charge', forceManyBody().strength(-500))
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collision',
        forceCollide<SimNode>().radius((d) => nodeRadius(d) + 6),
      )
      .alphaDecay(0.04)
      .on('tick', () => {
        force((c) => c + 1);
      });

    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, width, height]);

  // The node that should show a tooltip — pinned takes precedence over hovered.
  const focusId = pinned ?? hovered;
  const focusNode = focusId
    ? simNodesRef.current.find((n) => n.id === focusId)
    : null;

  // Position the tooltip to the right of the node if there's room, else left.
  function tooltipPosition(node: SimNode): { left: number; top: number } {
    const r = nodeRadius(node);
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    const tooltipW = 300;
    const tooltipH = 400;
    let left = nx + r + 12;
    let top = ny - tooltipH / 2;
    if (left + tooltipW > width) left = nx - r - 12 - tooltipW;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    if (top + tooltipH > height) top = height - tooltipH - 8;
    return { left, top };
  }

  return (
    <div
      style={{ position: 'relative', width, height }}
      onClick={() => {
        // Click on background (outside any node) dismisses the pinned tooltip
        setPinned(null);
      }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ display: 'block', cursor: 'default' }}
      >
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 -5 10 10"
            refX="10"
            refY="0"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0,-5L10,0L0,5" fill="#9ca3af" />
          </marker>
          <marker
            id="arrowheadActive"
            viewBox="0 -5 10 10"
            refX="10"
            refY="0"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0,-5L10,0L0,5" fill="#0190ff" />
          </marker>
        </defs>

        {/* Edges */}
        <g>
          {simLinksRef.current.map((l, i) => {
            const sx = (l.source as SimNode).x ?? 0;
            const sy = (l.source as SimNode).y ?? 0;
            const tx = (l.target as SimNode).x ?? 0;
            const ty = (l.target as SimNode).y ?? 0;
            const sourceId = (l.source as SimNode).id;
            const targetId = (l.target as SimNode).id;
            // Pull endpoint back so the arrowhead lands at the node edge
            const dx = tx - sx;
            const dy = ty - sy;
            const dist = Math.max(1, Math.hypot(dx, dy));
            const tradius = nodeRadius(l.target as SimNode);
            const tEndX = tx - (dx / dist) * tradius;
            const tEndY = ty - (dy / dist) * tradius;
            const isHighlighted =
              focusId === sourceId || focusId === targetId;
            return (
              <line
                key={i}
                x1={sx}
                y1={sy}
                x2={tEndX}
                y2={tEndY}
                stroke={isHighlighted ? '#0190ff' : '#9ca3af'}
                strokeOpacity={isHighlighted ? 0.9 : focusId ? 0.15 : 0.45}
                strokeWidth={Math.max(1, Math.log10(l.value + 1))}
                markerEnd={isHighlighted ? 'url(#arrowheadActive)' : 'url(#arrowhead)'}
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {simNodesRef.current.map((n) => {
            const r = nodeRadius(n);
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const summary = services.get(n.id);
            const health = serviceHealth(summary);
            const isFocused = focusId === n.id;
            const isPinned = pinned === n.id;
            const idColor = serviceColor(n.id);

            // Health encoding: an offset halo ring around the node,
            // sized/colored by bucket. Healthy nodes get no ring so
            // the graph stays calm; unhealthy nodes stand out visually
            // without hiding the identity fill color underneath.
            const haloGap = 3;
            const haloRadius = r + haloGap;
            const haloWidth =
              health.bucket === 'critical' ? 3.5
              : health.bucket === 'warn' ? 3
              : health.bucket === 'watch' ? 2
              : health.bucket === 'idle' ? 1
              : 0;
            const haloDash =
              health.bucket === 'idle' ? '3 3' : undefined;

            return (
              <g
                key={n.id}
                transform={`translate(${x},${y})`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  setPinned((cur) => (cur === n.id ? null : n.id));
                }}
              >
                {/* Health halo — only drawn for non-healthy buckets */}
                {haloWidth > 0 && (
                  <circle
                    r={haloRadius}
                    fill="none"
                    stroke={health.color}
                    strokeWidth={haloWidth}
                    strokeDasharray={haloDash}
                    strokeLinecap="round"
                    opacity={focusId && !isFocused ? 0.35 : 0.85}
                  >
                    {health.bucket === 'critical' && (
                      <>
                        {/* Subtle pulse for critical nodes so they
                            catch the eye during scan. */}
                        <animate
                          attributeName="r"
                          values={`${haloRadius};${haloRadius + 3};${haloRadius}`}
                          dur="1.8s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0.85;0.35;0.85"
                          dur="1.8s"
                          repeatCount="indefinite"
                        />
                      </>
                    )}
                  </circle>
                )}
                {/* Main disc — identity-colored for service consistency
                    with the Home catalog, waterfall, and logs view. */}
                <circle
                  r={r}
                  fill={idColor}
                  stroke={isPinned ? '#1a1a2e' : 'rgba(0,0,0,0.2)'}
                  strokeWidth={isPinned ? 2 : 1}
                  opacity={focusId && !isFocused ? 0.35 : 1}
                />
                <text
                  y={r + haloGap + haloWidth + 12}
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily='"Open Sans", sans-serif'
                  fill="#1a1a2e"
                  fontWeight={isFocused || health.bucket === 'critical' ? 600 : 500}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {n.id}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {focusNode && (
        (() => {
          const { left, top } = tooltipPosition(focusNode);
          return (
            <NodeTooltip
              service={focusNode.id}
              summary={services.get(focusNode.id)}
              buckets={bucketsByService.get(focusNode.id) ?? []}
              pinned={pinned === focusNode.id}
              left={left}
              top={top}
              onClose={() => setPinned(null)}
            />
          );
        })()
      )}
    </div>
  );
}
