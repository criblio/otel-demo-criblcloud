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
 * pass that reads the latest positions. The react-hooks/refs lint rule
 * doesn't like "ref read during render," but the pattern is intentional and
 * scoped to this one file.
 */
/* eslint-disable react-hooks/refs */
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
import { serviceColor } from '../utils/spans';
import type { DependencyEdge } from '../api/types';

interface SimNode extends SimulationNodeDatum {
  id: string;
  size: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  value: number;
}

interface Props {
  edges: DependencyEdge[];
  width: number;
  height: number;
  onNodeClick: (id: string) => void;
}

export default function DependencyGraph({ edges, width, height, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Build nodes & links from edges (skip self-loops; aggregate edge counts).
  const { nodes, links } = useMemo(() => {
    const nodeMap = new Map<string, SimNode>();
    const linkAgg = new Map<string, SimLink>();
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
  }, [edges]);

  // Live positions tracked in state so React re-renders on each tick.
  // We mutate the simNodes objects in place — d3 owns them.
  const [, force] = useState(0); // bumped each tick to trigger re-renders
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);

  function nodeRadius(callCount: number): number {
    return Math.max(8, Math.min(28, 8 + Math.log10(callCount + 1) * 5));
  }

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
          .distance(120)
          .strength(0.6),
      )
      .force('charge', forceManyBody().strength(-400))
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collision',
        forceCollide<SimNode>().radius((d) => nodeRadius(d.size) + 4),
      )
      .alphaDecay(0.04)
      .on('tick', () => {
        force((c) => c + 1);
      });

    return () => {
      sim.stop();
    };
  }, [nodes, links, width, height]);

  return (
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
          const tradius = nodeRadius((l.target as SimNode).size);
          const tEndX = tx - (dx / dist) * tradius;
          const tEndY = ty - (dy / dist) * tradius;
          const isHighlighted = hovered === sourceId || hovered === targetId;
          return (
            <line
              key={i}
              x1={sx}
              y1={sy}
              x2={tEndX}
              y2={tEndY}
              stroke={isHighlighted ? '#0190ff' : '#9ca3af'}
              strokeOpacity={isHighlighted ? 0.9 : 0.45}
              strokeWidth={Math.max(1, Math.log10(l.value + 1))}
              markerEnd="url(#arrowhead)"
            />
          );
        })}
      </g>

      {/* Nodes */}
      <g>
        {simNodesRef.current.map((n) => {
          const r = nodeRadius(n.size);
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const isHovered = hovered === n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${x},${y})`}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onNodeClick(n.id)}
            >
              <circle
                r={r}
                fill={serviceColor(n.id)}
                stroke={isHovered ? '#1a1a2e' : '#ffffff'}
                strokeWidth={isHovered ? 2 : 1.5}
                opacity={hovered && !isHovered ? 0.4 : 1}
              />
              <text
                y={r + 12}
                textAnchor="middle"
                fontSize="11"
                fontFamily='"Open Sans", sans-serif'
                fill="#1a1a2e"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {n.id}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
