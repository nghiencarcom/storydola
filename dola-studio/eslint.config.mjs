import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    ".next-dev/**",
    ".next-production*/**",
    "node_modules/**",
    "dola-render-gateway/**",
    "next-env.d.ts"
  ])
]);
