/**
 * Fixed sector → color mapping for the deal-flow map and board badges.
 *
 * Categorical palette: 8 validated slots (CVD-checked against the white app
 * surface with scripts from the dataviz method; worst adjacent CVD ΔE 9.1,
 * normal-vision ΔE 19.6). 11 sectors > 8 slots, so the three 2-company
 * deep-tech sectors (biotech, space, defense) fold into a neutral gray —
 * identity is never color-alone: every node draws its company name, the map
 * has a legend, and the report shows the sector as text.
 *
 * The assignment is FIXED (color follows the sector, never its rank): the
 * same sector keeps the same hue across theses, filters, and re-scores.
 */

export const SECTOR_COLORS: Record<string, string> = {
  ai_infra: "#2a78d6", // blue
  climate: "#008300", // green
  consumer: "#e87ba4", // magenta
  fintech: "#eda100", // yellow
  healthcare: "#1baf7a", // aqua
  robotics: "#eb6834", // orange
  devtools: "#4a3aa7", // violet
  enterprise_saas: "#e34948", // red
};

/** Neutral "Other" for sectors without a slot (biotech, space, defense). */
export const OTHER_SECTOR_COLOR = "#898781";

export const SECTOR_LABELS: Record<string, string> = {
  ai_infra: "AI infra",
  devtools: "Devtools",
  consumer: "Consumer",
  fintech: "Fintech",
  healthcare: "Healthcare",
  climate: "Climate",
  robotics: "Robotics",
  biotech: "Biotech",
  space: "Space",
  defense: "Defense",
  enterprise_saas: "Enterprise SaaS",
};

export function sectorColor(sector: string | null): string {
  return (sector && SECTOR_COLORS[sector]) || OTHER_SECTOR_COLOR;
}

export function sectorLabel(sector: string | null): string {
  return (sector && SECTOR_LABELS[sector]) || sector || "Unknown";
}
