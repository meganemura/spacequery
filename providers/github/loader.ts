// Fills pull requests from repository origins and the caller's review queue.
// One GraphQL request replaces one process per repository. This saves time and
// avoids the process burst that ADR 0022 describes. The 50-item cap remains;
// the query reference explains its effect.
// Origins identify a GitHub repository even when worktrees use different paths.
// Boundary: this provider's table only.
import type { LoadContext, Loader } from "../../core/loader.ts";
import { discoveryLoaders, rootsInScope } from "../../core/scope.ts";
import { githubCommands } from "./module.ts";
import type { PullRequestsId, ReviewRequestsId } from "./solarsql.generated.ts";

type PullRequest = { id: PullRequestsId; repo: string; root: string | null; number: number; title: string; head_branch: string | null; head_repo: string | null; base_branch: string | null; author: string | null; is_draft: number; state: string; review_decision: string | null; checks: string | null; updated_at: number; url: string };
type ReviewRequest = { id: ReviewRequestsId; repo: string; root: string | null; number: number; title: string; author: string | null; updated_at: number; url: string };
type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
}

export function parseGithubOrigin(origin: string): string | null {
  const match = /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(origin.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export function checkState(state: unknown): "pass" | "fail" | "pending" | "none" {
  if (state === "SUCCESS") return "pass";
  if (state === "FAILURE" || state === "ERROR") return "fail";
  if (state === "PENDING" || state === "EXPECTED") return "pending";
  return "none";
}

function githubError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(message.split("\n")[0] || "gh failed");
}

export function buildPullRequestsQuery(repos: readonly string[]): string {
  const selections = repos.map((repo, index) => {
    const [owner, name] = repo.split("/");
    return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { nameWithOwner pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { number title headRefName headRepository { nameWithOwner } baseRefName author { login } isDraft state reviewDecision updatedAt url commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }`;
  });
  return `query { ${selections.join(" ")} }`;
}

function firstGithubError(errors: unknown): string | null {
  if (!Array.isArray(errors)) return null;
  for (const error of errors) {
    const value = object(error);
    if (value !== null && typeof value.message === "string") return value.message;
  }
  return null;
}

function asPullRequest(value: unknown, repo: string, root: string | null): PullRequest {
  const row = object(value);
  const author = row === null ? null : object(row.author);
  const commits = row === null ? null : object(row.commits);
  const nodes = commits === null || !Array.isArray(commits.nodes) ? null : commits.nodes;
  const lastCommit = nodes?.[0] === undefined ? null : object(nodes[0]);
  const commit = lastCommit === null ? null : object(lastCommit.commit);
  const statusCheckRollup = commit === null ? null : object(commit.statusCheckRollup);
  // The head of a pull request from a fork is a branch of another repository;
  // a join on the branch name alone would pair it with a local checkout.
  const headRepository = row === null ? null : object(row.headRepository);
  const headRepo = headRepository !== null && typeof headRepository.nameWithOwner === "string" ? headRepository.nameWithOwner : null;
  if (row === null || typeof row.number !== "number" || typeof row.title !== "string" || typeof row.state !== "string" || typeof row.updatedAt !== "string" || typeof row.url !== "string" || nodes === null || (row.headRefName !== null && row.headRefName !== undefined && typeof row.headRefName !== "string") || (row.baseRefName !== null && row.baseRefName !== undefined && typeof row.baseRefName !== "string") || (row.isDraft !== undefined && typeof row.isDraft !== "boolean") || (row.reviewDecision !== null && row.reviewDecision !== undefined && typeof row.reviewDecision !== "string") || (author !== null && typeof author.login !== "string") || (statusCheckRollup !== null && typeof statusCheckRollup.state !== "string")) throw new Error("gh returned invalid JSON");
  return { id: `${repo}#${row.number}` as PullRequestsId, repo, root, number: row.number, title: row.title, head_branch: row.headRefName ?? null, head_repo: headRepo, base_branch: row.baseRefName ?? null, author: author?.login as string | undefined ?? null, is_draft: row.isDraft ? 1 : 0, state: row.state, review_decision: row.reviewDecision ?? null, checks: checkState(statusCheckRollup?.state), updated_at: Date.parse(row.updatedAt), url: row.url };
}

function asReviewRequest(value: unknown, roots: ReadonlyMap<string, string>): ReviewRequest {
  const row = object(value);
  const repository = row === null ? null : object(row.repository);
  const author = row === null ? null : object(row.author);
  if (row === null || repository === null || typeof repository.nameWithOwner !== "string" || typeof row.number !== "number" || typeof row.title !== "string" || typeof row.updatedAt !== "string" || typeof row.url !== "string" || (author !== null && typeof author.login !== "string")) throw new Error("gh returned invalid JSON");
  const repo = repository.nameWithOwner;
  return { id: `${repo}#${row.number}` as ReviewRequestsId, repo, root: roots.get(repo) ?? null, number: row.number, title: row.title, author: author?.login as string | undefined ?? null, updated_at: Date.parse(row.updatedAt), url: row.url };
}

// The GitHub repository of every root in scope, from its origin. A root
// without origin, or with an origin elsewhere, is not on GitHub.
async function repoRootsOf(ctx: LoadContext): Promise<Map<string, string>> {
  const rootRepos = new Map<string, string>();
  await Promise.all((await rootsInScope(ctx)).map(async (root) => {
    try {
      const origin = await ctx.repo.originOf(root);
      const repo = origin === null ? null : parseGithubOrigin(origin);
      if (repo !== null) rootRepos.set(root, repo);
    } catch { /* A root without origin does not identify a GitHub repository. */ }
  }));
  // Two roots of one repository (worktrees) share the rows; the first wins.
  const repoRoots = new Map<string, string>();
  for (const [root, repo] of rootRepos) if (!repoRoots.has(repo)) repoRoots.set(repo, root);
  return repoRoots;
}

export const githubLoader: Loader = {
  name: "github",
  tables: ["pull_requests"],
  after: [], afterForScope: discoveryLoaders,
  async load(ctx) {
    const repoRoots = await repoRootsOf(ctx);
    let rows: PullRequest[];
    try {
      const entries = [...repoRoots];
      if (entries.length === 0) return;
      const response = object(JSON.parse(await ctx.exec("gh", ["api", "graphql", "-f", `query=${buildPullRequestsQuery(entries.map(([repo]) => repo))}`])));
      const data = response === null ? null : object(response.data);
      const repositories = data === null ? [] : entries.map((_, index) => data[`r${index}`]).filter((repository) => repository !== null && repository !== undefined);
      const error = response === null ? null : firstGithubError(response.errors);
      if (data === null || (error !== null && repositories.length === 0)) throw new Error(error ?? "gh returned invalid JSON");
      rows = entries.flatMap(([repo, root], index) => {
        const repository = data[`r${index}`];
        const pullRequests = object(repository)?.pullRequests;
        const nodes = object(pullRequests)?.nodes;
        if (repository === null || repository === undefined) return [];
        if (!Array.isArray(nodes)) throw new Error("gh returned invalid JSON");
        return nodes.map((value) => asPullRequest(value, repo, root));
      });
    } catch (error) { throw githubError(error); }
    const loaded = await ctx.db.run(githubCommands.loadPullRequests, { rows });
    if (!loaded.ok) throw new Error(`pull_requests: ${loaded.kind}`);
  },
};

// One search across GitHub, 2 to 5 s on its own, so it has its own table
// and a query that does not ask for review requests does not wait for it.
export const githubReviewsLoader: Loader = {
  name: "github_reviews",
  tables: ["review_requests"],
  after: [], afterForScope: discoveryLoaders,
  async load(ctx) {
    const repoRoots = await repoRootsOf(ctx);
    let rows: ReviewRequest[];
    try {
      rows = JSON.parse(await ctx.exec("gh", ["search", "prs", "--review-requested=@me", "--state=open", "--limit", "50", "--json", "repository,number,title,author,updatedAt,url"])).map((value: unknown) => asReviewRequest(value, repoRoots));
    } catch (error) { throw githubError(error); }
    const loaded = await ctx.db.run(githubCommands.loadReviewRequests, { rows });
    if (!loaded.ok) throw new Error(`review_requests: ${loaded.kind}`);
  },
};
