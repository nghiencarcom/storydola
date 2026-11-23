import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next";
import nextTypescript from "eslint-config-next/typescript";

const nextWithNonBlockingHooksRules = next.map((config) => {
  if (!config.plugins?.["react-hooks"]) return config;

  return {
    ...config,
    rules: {
      ...config.rules,
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  };
});
const typescriptPlugin = next.find((config) => config.plugins?.["@typescript-eslint"])?.plugins?.["@typescript-eslint"];

export default defineConfig([
  ...nextWithNonBlockingHooksRules,
  ...nextTypescript,
  {
    files: ["scripts/**/*.js", "tests/**/*.cjs"],
    plugins: { "@typescript-eslint": typescriptPlugin },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "coverage/**",
  ]),
]);
