// The one list of providers: a provider is in `modules` for its tables and
// in `loaders` for its code. The build can import this file because solarsql
// writes the generated stubs before it imports anything.
// Independent loaders in this list run together. A loader waits only for the
// loaders whose tables it reads while loading (ADR 0044). The list order is
// the order eligible loaders start.
// Boundary: the list only. A provider's tables and code live in its module.
import { config } from "solarsql";
import type { Loader } from "./core/loader.ts";
import { loader as searchPathLoader } from "./providers/search-path/public.ts";
import { loader as repoLoader } from "./providers/repos/public.ts";
import { loader as herdrLoader } from "./providers/herdr/public.ts";
import { loader as gitLoader } from "./providers/git/public.ts";
import { loader as miseLoader } from "./providers/mise/public.ts";
import { loader as brewLoader } from "./providers/brew/public.ts";
import { loader as repositoryVersionsLoader } from "./providers/repository-versions/public.ts";
import { loader as repositoryConfigFilesLoader } from "./providers/repository-config-files/public.ts";
import { loader as sessionsLoader } from "./providers/sessions/public.ts";
import { loader as cursorLoader } from "./providers/cursor/public.ts";
import { loader as githubLoader, reviewsLoader as githubReviewsLoader } from "./providers/github/public.ts";
import { loader as dockerLoader } from "./providers/docker/public.ts";
import { loader as processesLoader } from "./providers/processes/public.ts";
import { loader as skillsLoader } from "./providers/skills/public.ts";
import { loader as beadsLoader, readyLoader as beadsReadyLoader } from "./providers/beads/public.ts";
import { loader as headsignLoader } from "./providers/headsign/public.ts";
import { loader as runtagLoader } from "./providers/runtag/public.ts";

import { claudeUsageLoader, codexUsageLoader } from "./providers/usage/public.ts";

export const loaders: readonly Loader[] = [claudeUsageLoader, codexUsageLoader, searchPathLoader, repoLoader, herdrLoader, githubLoader, githubReviewsLoader, miseLoader, brewLoader, repositoryVersionsLoader, repositoryConfigFilesLoader, beadsLoader, beadsReadyLoader, dockerLoader, sessionsLoader, cursorLoader, gitLoader, processesLoader, skillsLoader, headsignLoader, runtagLoader];

export default config({
  modules: ["./providers/usage","./core/providers", "./providers/search-path", "./providers/repos", "./providers/herdr", "./providers/git", "./providers/mise", "./providers/brew", "./providers/repository-versions", "./providers/repository-config-files", "./providers/sessions", "./providers/cursor", "./providers/github", "./providers/docker", "./providers/processes", "./providers/skills", "./providers/beads", "./providers/headsign", "./providers/runtag", { dir: "./providers/report", readsAll: true }],
  migrations: "./migrations",
});
