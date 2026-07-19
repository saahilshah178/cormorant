import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

// Enables the "use workflow" / "use step" directives (Tier 4 discovery pipeline).
export default withWorkflow(nextConfig);
