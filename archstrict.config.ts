// Module boundaries for this repository.
// Boundary: the checker only. It does not change what the package exports
// or how a call runs.
import type { Config } from "./archstrict.types.js";

export default {
  schemaVersion: 1,
  surface: ["index.ts", "index.tsx", "index.mts", "index.cts"],
  // Tests import internals on purpose. The two archstrict files are the
  // checker, not a module of the tool. Hidden directories are tool state.
  // The nukadoko scenario runs the CLI as a process and imports nothing.
  exclude: [
    "archstrict.config.ts",
    "archstrict.types.ts",
    ".*/**",
    "**/.*/**",
    "test/**",
    "features/**",
    "nukadoko.config.ts",
  ],
  // Most specific glob wins, so each file carries one tier and one kind.
  // cli.ts is the process entry. ui/ is retagged so the ink/react deny
  // does not apply to the module that renders.
  classify: [
    { glob: "**", tags: ["tier:lib", "kind:rest"] },
    { glob: "cli.ts", tags: ["tier:app", "kind:rest"] },
    { glob: "ui/**", tags: ["tier:lib", "kind:ui"] },
  ],
  declaredModules: [
    { name: "catalog.ts", glob: "catalog.ts", surface: "catalog.ts" },
    { name: "cli.ts", glob: "cli.ts", surface: "cli.ts" },
    {
      name: "core",
      glob: "core/**",
      // Every file another module already imports. diagnose.ts and
      // core/providers stay private.
      surface: [
        "calls.ts",
        "config.ts",
        "doctor.ts",
        "help.ts",
        "loader.ts",
        "repo.ts",
        "resolve.ts",
        "run.ts",
        "scope.ts",
        "search-path.ts",
        "user-providers.ts",
        "user-queries.ts",
        "watch.ts",
      ],
    },
    { name: "dashboard.ts", glob: "dashboard.ts", surface: "dashboard.ts" },
    { name: "migrations", glob: "migrations/**", surface: "index.ts" },
    // Outside providers/, the only importable file of a provider is its public.ts.
    { name: "providers", glob: "providers/**", surface: "*/public.ts" },
    { name: "spacequery.config.ts", glob: "spacequery.config.ts", surface: "spacequery.config.ts" },
    { name: "ui", glob: "ui/**", surface: "main.ts" },
  ],
  // Modules with no frozen debt. catalog.ts holds the cycle and providers
  // holds the repository-versions type leaks; those two stay off this list
  // so the freeze can record them.
  strict: ["cli.ts", "core", "dashboard.ts", "migrations", "spacequery.config.ts", "ui"],
  edges: {
    order: [
      {
        tagNamespace: "tier",
        sequence: { "": ["lib", "app"] },
        direction: "downward-only",
        because: "cli.ts is the process entry; a library module does not import it",
      },
    ],
    allowDeny: [
      {
        source: "kind:rest",
        targetNamespace: "pkg",
        deny: ["ink", "react"],
        because: "ink and react draw the terminal UI, so only ui/ imports them",
      },
    ],
  },
  because: "core, providers, and ui are directories; each root entrypoint is its own file. Providers are reached through public.ts, core through the files other modules already import, and ui through main.ts.",
} satisfies Config;
