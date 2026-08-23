"use client";

import { useMemo, useState } from "react";
import type { GraphData, GraphNode } from "@/lib/types";

type PositionedNode = GraphNode & { x: number; y: number };

function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function color(node: GraphNode) {
  if (node.relation === "draft") return "#d85f45";
  if (node.relation === "suggested") return "#7868e6";
  if (node.isTopVenue) return "#249279";
  return node.depth > 1 ? "#8d96a8" : "#3c6fa8";
}

export function GraphView({ graph, onSelect }: { graph: GraphData; onSelect: (paper: GraphNode) => void }) {
  const [focus, setFocus] = useState(graph.root);
  const positioned = useMemo(() => {
    const root = graph.nodes.find((node) => node.id === graph.root) || graph.nodes[0];
    const candidates = graph.nodes
      .filter((node) => node.id !== root.id)
      .sort((a, b) => a.depth - b.depth || (b.score || 0) - (a.score || 0) || b.citationCount - a.citationCount)
      .slice(0, 70);
    const groups = new Map<number, GraphNode[]>();
    for (const node of candidates) {
      const ring = node.relation === "suggested" ? 4 : Math.min(3, Math.max(1, node.depth));
      groups.set(ring, [...(groups.get(ring) || []), node]);
    }
    const nodes: PositionedNode[] = [{ ...root, x: 500, y: 360 }];
    const radii: Record<number, number> = { 1: 128, 2: 225, 3: 305, 4: 330 };
    for (const [ring, items] of groups) {
      items.forEach((node, index) => {
        const offset = ring === 4 ? Math.PI / 12 : ring * 0.36;
        const angle = offset + (index / Math.max(1, items.length)) * Math.PI * 2;
        const radius = radii[ring];
        const xStretch = ring === 4 ? 1.36 : 1.22;
        nodes.push({ ...node, x: 500 + Math.cos(angle) * radius * xStretch, y: 360 + Math.sin(angle) * radius * 0.88 });
      });
    }
    return nodes;
  }, [graph]);
  const nodeMap = new Map(positioned.map((node) => [node.id, node]));
  const visibleIds = new Set(nodeMap.keys());

  return (
    <div className="graph-shell">
      <svg className="paper-graph" viewBox="0 0 1000 720" role="img" aria-label="Interactive citation relationship graph">
        <defs>
          <filter id="nodeShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.16" />
          </filter>
        </defs>
        {graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge, index) => {
          const source = nodeMap.get(edge.source);
          const target = nodeMap.get(edge.target);
          if (!source || !target) return null;
          return (
            <line
              key={`${edge.source}-${edge.target}-${index}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              className={`graph-edge ${edge.kind}`}
            />
          );
        })}
        {positioned.map((node) => {
          const selected = focus === node.id;
          const radius = node.relation === "draft" ? 26 : selected ? 15 : node.isTopVenue ? 12 : 9;
          return (
            <g
              key={node.id}
              className="graph-node"
              transform={`translate(${node.x} ${node.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${node.title}, ${node.year || "year unknown"}`}
              onClick={() => { setFocus(node.id); onSelect(node); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setFocus(node.id);
                  onSelect(node);
                }
              }}
            >
              <circle r={radius + (selected ? 5 : 2)} className="node-halo" />
              <circle r={radius} fill={color(node)} filter="url(#nodeShadow)" />
              {(selected || node.relation === "draft") && (
                <g transform={`translate(${node.x > 720 ? -12 : 12} ${node.y > 590 ? -20 : 7})`}>
                  <rect
                    className="node-label-bg"
                    x={node.x > 720 ? -220 : 0}
                    y="-18"
                    width="220"
                    height="38"
                    rx="8"
                  />
                  <text className="node-label" x={node.x > 720 ? -210 : 10} y="6">
                    {truncate(node.title, 30)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="graph-legend" aria-label="Graph legend">
        <span><i className="legend-dot draft" />Draft</span>
        <span><i className="legend-dot cited" />Cited</span>
        <span><i className="legend-dot top" />Top venue</span>
        <span><i className="legend-dot suggested" />Suggested</span>
      </div>
      {graph.nodes.length > positioned.length && (
        <div className="graph-cap">Showing the strongest {positioned.length} of {graph.nodes.length} nodes</div>
      )}
    </div>
  );
}
