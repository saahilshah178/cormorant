/**
 * Deal-flow map layout math, kept free of react-force-graph so both the graph
 * wrapper (radial force + guide rings) and the deal-flow view (which seeds each
 * node's start position when it first enters the node cache) can share it
 * without the view pulling the graph library into its bundle.
 */

/** Radial band the fit score maps to: fit 100 → MIN_R (center), fit 0 → MAX_R. */
export const MIN_R = 25;
export const MAX_R = 330;

/** ~137.5° — spreads sequential slots evenly around a ring (sunflower spacing). */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Distance from center for a given fit score (higher fit → closer to center). */
export function radiusForFit(fit: number): number {
  const clamped = Math.max(0, Math.min(100, fit));
  return MIN_R + (1 - clamped / 100) * (MAX_R - MIN_R);
}

/**
 * Fixed angle for a node's slot. Slots are golden-angle spaced so radial
 * neighbours (similar fit) are never angular neighbours — the whole pool stays
 * evenly fanned around the circle no matter how many nodes exist.
 */
export function slotAngle(slot: number): number {
  return slot * GOLDEN_ANGLE;
}

/**
 * Deterministic anchor target for a node: radius from its fit, angle from its
 * fixed slot. The graph pins each node toward this point (forceX/forceY) instead
 * of letting it float on a free fit ring, so no reheat, click, poll, or stray
 * drag can ever slide the pool into a one-sided cluster. Fit changing (thesis
 * swap) moves only the radius, so the node glides in/out along its fixed angle.
 */
export function anchorX(slot: number, fit: number): number {
  return Math.cos(slotAngle(slot)) * radiusForFit(fit);
}
export function anchorY(slot: number, fit: number): number {
  return Math.sin(slotAngle(slot)) * radiusForFit(fit);
}

/** The mutable position fields the force simulation reads/writes on a node. */
export type Positioned = {
  fit: number;
  /** Stable index assigned once when the node enters the cache; sets its angle. */
  slot: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
};

/**
 * Seed a node's starting position ON its anchor target, so a freshly added node
 * appears in place instead of flying in from the center and shoving the pool.
 * Reads `node.slot` (assigned by the node-cache owner, DealflowView). Called on
 * the objects that owner holds — never on a prop.
 */
export function seedNodePosition(node: Positioned): void {
  node.x = anchorX(node.slot, node.fit);
  node.y = anchorY(node.slot, node.fit);
  node.vx = 0;
  node.vy = 0;
}
