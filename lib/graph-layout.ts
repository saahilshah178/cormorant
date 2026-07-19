/**
 * Deal-flow map layout math, kept free of react-force-graph so both the graph
 * wrapper (radial force + guide rings) and the deal-flow view (which seeds each
 * node's start position when it first enters the node cache) can share it
 * without the view pulling the graph library into its bundle.
 */

/** Radial band the fit score maps to: fit 100 → MIN_R (center), fit 0 → MAX_R. */
export const MIN_R = 25;
export const MAX_R = 330;

/** ~137.5° — spreads sequential nodes evenly around a ring (sunflower spacing). */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Distance from center for a given fit score (higher fit → closer to center). */
export function radiusForFit(fit: number): number {
  const clamped = Math.max(0, Math.min(100, fit));
  return MIN_R + (1 - clamped / 100) * (MAX_R - MIN_R);
}

/** The mutable position fields the force simulation reads/writes on a node. */
export type Positioned = {
  fit: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
};

/**
 * Seed a node's starting position on its own fit ring at a golden-angle offset,
 * so a freshly added node lands fanned out around the circle instead of piling
 * onto one arc (forceRadial fixes distance from center, not angle). `index`
 * should increase monotonically across every node ever seeded so the whole pool
 * stays evenly distributed. Called by the node-cache owner (DealflowView) on the
 * objects it owns — never on a prop.
 */
export function seedNodePosition(node: Positioned, index: number): void {
  const r = radiusForFit(node.fit);
  const angle = index * GOLDEN_ANGLE;
  node.x = Math.cos(angle) * r;
  node.y = Math.sin(angle) * r;
  node.vx = 0;
  node.vy = 0;
}
