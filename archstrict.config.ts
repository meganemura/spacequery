import type { Config } from "./archstrict.types.js";

export default {
  schemaVersion: 1,
  surface: "index.ts",
  exclude: [
    "*.ts",
    "test/**",
    "tests/**",
    "example/**",
    "examples/**",
    "spike/**",
    "dist/**",
    "coverage/**",
    "scripts/**",
    "features/**",
    "fixtures/**",
    "migrations/**",
    "docs/**",
    "skills/**",
  ],
  classify: [
    { glob: "core/**", tags: ["kind:core"] },
    { glob: "providers/**", tags: ["kind:provider"] },
    { glob: "ui/**", tags: ["kind:ui"] },
  ],
  // First operational adopt: one module. No src/; root entrypoints (cli.ts,
  // catalog.ts, dashboard.ts) stay under exclude "*.ts" — single-file modules
  // break todo (archstrict-4oe). Brace multi-root globs do not match.
  declaredModules: [
    { name: "spacequery", glob: "**/*", surface: "index.ts" },
  ],
  because: "spacequery first adopt: single module via **/*, root *.ts excluded",
} satisfies Config;
