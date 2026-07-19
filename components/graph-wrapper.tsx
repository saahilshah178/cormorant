"use client";

import { useEffect, useRef } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import { forceCollide, forceRadial } from "d3-force";
import { sectorColor } from "@/lib/sectors";

/**
 * Direct react-force-graph-2d wrapper (PLAN.md stack gotcha: refs break
 * through next/dynamic, so this client component imports the lib directly and
 * holds the ref internally; deal-map.tsx dynamic()s THIS file with ssr:false).
 *
 * Layout: forceRadial pulls each node to a radius set by its fit score (high
 * fit → center). Every node is the same fixed size; color = sector, label =
 * name (drawn always — identity is never color-alone). Charge and link forces
 * are weakened so they don't fight the radial layout.
 */

export type GraphNode = {
  id: string;
  name: string;
  sector: string | null;
  fit: number; // 0–100
  confidence: number; // 0–1
};

export type GraphLink = {
  source: string;
  target: string;
  label: string;
  kind: "shared_signal" | "sector";
};

const MIN_R = 25;
const MAX_R = 330;

/** Every node renders at the same fixed radius (size is not a data channel). */
const NODE_R = 6;

function radiusForFit(fit: number): number {
  const clamped = Math.max(0, Math.min(100, fit));
  return MIN_R + (1 - clamped / 100) * (MAX_R - MIN_R);
}

/** Faint guide rings so "closer to center = higher fit" is legible. */
const GUIDE_FITS = [80, 50, 20];

/** ~137.5° — spreads sequential nodes evenly around a ring (sunflower spacing). */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export default function GraphWrapper({
  nodes,
  links,
  width,
  height,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const fgRef = useRef<ForceGraphMethods<NodeObject<GraphNode>> | undefined>(
    undefined,
  );
  const hasAutoFitted = useRef(false);
  // Node ids we've already given a starting position. Each node is seeded once
  // (overriding the library's default placement, which drops new nodes near the
  // origin and lets them clump on one side); settled nodes keep their positions
  // across refetches and thesis swaps so the resettle stays an animation.
  const seededIds = useRef(new Set<string>());

  // (Re)configure forces whenever the data changes: the radial force reads
  // node.fit live, so after a thesis swap mutates fits, a reheat is all the
  // nodes need to animate to their new radii.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("center", null);
    fg.d3Force("charge")?.strength?.(-25);
    const link = fg.d3Force("link");
    link?.strength?.(0.02);
    link?.distance?.(60);
    fg.d3Force(
      "radial",
      forceRadial<NodeObject<GraphNode>>(
        (node) => radiusForFit(node.fit ?? 0),
        0,
        0,
      ).strength(0.85) as never,
    );
    // Keeps same-fit nodes from stacking on top of each other so every node
    // stays individually clickable.
    fg.d3Force(
      "collide",
      forceCollide<NodeObject<GraphNode>>(NODE_R + 6).strength(0.9) as never,
    );

    // Seed each not-yet-seen node onto its own fit ring at a golden-angle
    // offset, so the whole pool fans out around the circle from the first frame
    // instead of piling onto one arc (forceRadial fixes distance, not angle).
    let seedIndex = seededIds.current.size;
    for (const node of nodes as NodeObject<GraphNode>[]) {
      if (seededIds.current.has(node.id)) continue;
      const r = radiusForFit(node.fit ?? 0);
      const a = seedIndex * GOLDEN_ANGLE;
      node.x = Math.cos(a) * r;
      node.y = Math.sin(a) * r;
      node.vx = 0;
      node.vy = 0;
      seededIds.current.add(node.id);
      seedIndex++;
    }

    fg.d3ReheatSimulation();
  }, [nodes, links]);

  return (
    <ForceGraph2D<GraphNode, GraphLink>
      ref={fgRef}
      graphData={{ nodes, links }}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      cooldownTime={8000}
      onEngineStop={() => {
        if (!hasAutoFitted.current && nodes.length > 0) {
          hasAutoFitted.current = true;
          fgRef.current?.zoomToFit(500, 60);
        }
      }}
      onRenderFramePre={(ctx) => {
        ctx.save();
        for (const fit of GUIDE_FITS) {
          const r = radiusForFit(fit);
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, 2 * Math.PI);
          ctx.strokeStyle = "rgba(11,11,11,0.16)";
          ctx.lineWidth = 1.25;
          ctx.stroke();
          ctx.fillStyle = "rgba(11,11,11,0.45)";
          ctx.font = "6px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(`fit ${fit}`, 0, -r - 2);
        }
        ctx.restore();
      }}
      nodeCanvasObject={(node, ctx, globalScale) => {
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const r = NODE_R;
        const isSelected = node.id === selectedId;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = sectorColor(node.sector);
        ctx.fill();
        // 2px surface ring so overlapping marks stay separable.
        ctx.lineWidth = Math.max(0.75, 2 / globalScale);
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(x, y, r + 2.5, 0, 2 * Math.PI);
          ctx.lineWidth = Math.max(1, 2 / globalScale);
          ctx.strokeStyle = "#0b0b0b";
          ctx.stroke();
        }

        const fontSize = Math.max(3.5, 11 / globalScale);
        ctx.font = `${isSelected ? "600 " : ""}${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isSelected ? "#0b0b0b" : "#52514e";
        ctx.fillText(node.name, x, y + r + 1.5);
      }}
      nodePointerAreaPaint={(node, paintColor, ctx, globalScale) => {
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const r = NODE_R;
        const fontSize = Math.max(3.5, 11 / globalScale);
        ctx.fillStyle = paintColor;
        // Hit target bigger than the mark: circle plus the label block.
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
        ctx.fill();
        const w = Math.max(30, node.name.length * fontSize * 0.6);
        ctx.fillRect(x - w / 2, y + r, w, fontSize + 4);
      }}
      nodeLabel={(node) =>
        `${node.name} — fit ${Math.round(node.fit)} · click for the report`
      }
      linkColor={(l: LinkObject<GraphNode, GraphLink>) =>
        l.kind === "shared_signal" ? "rgba(42,120,214,0.30)" : "rgba(11,11,11,0.06)"
      }
      linkWidth={(l: LinkObject<GraphNode, GraphLink>) =>
        l.kind === "shared_signal" ? 1.5 : 1
      }
      linkLabel={(l: LinkObject<GraphNode, GraphLink>) => l.label}
      onNodeClick={(node) => onSelect((node.id as string) ?? null)}
      onBackgroundClick={() => onSelect(null)}
    />
  );
}
