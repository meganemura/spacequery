// These tests prove that the GitHub loaders join origins to roots and keep
// review requests in their own table. They use gh-shaped fixture output.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import type { Exec, Loader } from "../core/loader.ts";
import { runSql } from "../core/run.ts";
import { buildPullRequestsQuery, checkState, githubLoader, githubReviewsLoader, parseGithubOrigin } from "../providers/github/loader.ts";
import { herdrLoader } from "../providers/herdr/loader.ts";
import { repoLoader } from "../providers/repos/loader.ts";
import { fakeExec, fixtureAgentsWithLinkedWorktree, fixtureRepo, fixtureRepoWithOrigins, paths } from "./fixture.ts";

const loaders: Loader[] = [repoLoader, herdrLoader, githubLoader, githubReviewsLoader];

type GithubExecOptions = { nonGithub?: boolean; absent?: string; graphqlErrorsWithoutData?: boolean; fork?: boolean; checkState?: string | null };

function pullRequest(repo: string, number: number, state: string | null = "SUCCESS", fork = false): Record<string, unknown> {
  return { number, title: repo === "example/alpha" ? "Alpha" : "Beta", headRefName: "main", headRepository: { nameWithOwner: fork ? "example/fork" : repo }, baseRefName: "trunk", author: { login: "octo" }, isDraft: repo === "example/beta", state: "OPEN", reviewDecision: repo === "example/alpha" ? "APPROVED" : null, updatedAt: "2026-09-10T00:00:00Z", url: `https://example.test/${repo}/${number}`, commits: { nodes: state === null ? [] : [{ commit: { statusCheckRollup: { state } } }] } };
}

function githubExec(options: GithubExecOptions = {}): Exec {
  const base = fakeExec({ agents: fixtureAgentsWithLinkedWorktree() });
  return async (command, args, cwd) => {
    if (command === "gh") {
      if (args[0] === "api" && args[1] === "graphql" && args[2] === "-f" && args[3]?.startsWith("query=")) {
        if (options.graphqlErrorsWithoutData) return JSON.stringify({ errors: [{ message: "gh: authentication required" }] });
        const aliases = [...args[3].matchAll(/r(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)];
        const data: Record<string, unknown> = {};
        for (const [, index, owner, name] of aliases) {
          const repo = `${owner}/${name}`;
          data[`r${index}`] = repo === options.absent ? null : { nameWithOwner: repo, pullRequests: { nodes: [pullRequest(repo, repo === "example/alpha" ? 7 : 8, options.checkState ?? (repo === "example/alpha" ? "SUCCESS" : "PENDING"), options.fork ?? false)] } };
        }
        return JSON.stringify({ data });
      }
      if (args[0] === "search") return JSON.stringify([{ repository: { nameWithOwner: "example/alpha" }, number: 7, title: "Alpha", author: { login: "octo" }, updatedAt: "2026-09-10T00:00:00Z", url: "https://example.test/alpha/7" }, { repository: { nameWithOwner: "example/review" }, number: 9, title: "Review", author: { login: "reviewer" }, updatedAt: "2026-09-10T00:02:00Z", url: "https://example.test/review/9" }]);
    }
    return base(command, args, cwd);
  };
}

test("github stores open pull requests, and review requests in their own table", async () => {
  const result = await runSql("select repo, root, number, checks from pull_requests order by repo, number", { loaders, exec: githubExec(), repo: fixtureRepo, env: {}, params: {} });
  assert.deepEqual(result.rows, [
    { repo: "example/alpha", root: paths.alpha, number: 7, checks: "pass" },
    { repo: "example/beta", root: paths.beta, number: 8, checks: "pending" },
  ]);
  assert.deepEqual(result.providers.map((entry) => entry.name), ["github", "herdr"]);
  const reviews = await runSql("select repo, root, number from review_requests order by repo, number", { loaders, exec: githubExec(), repo: fixtureRepo, env: {}, params: {} });
  assert.deepEqual(reviews.rows, [
    { repo: "example/alpha", root: paths.alpha, number: 7 },
    { repo: "example/review", root: null, number: 9 },
  ]);
  assert.deepEqual(reviews.providers.map((entry) => entry.name), ["github_reviews", "herdr"]);
});

test("github lists a shared repository once and skips a non-GitHub origin", async () => {
  const origins = new Map([[paths.alpha, "git@github.com:example/alpha.git"], [paths.alphaWorktree, "git@github.com:example/alpha.git"], [paths.beta, "https://gitlab.com/example/beta.git"]]);
  const result = await runSql("select repo, count(*) as rows from pull_requests group by repo order by repo", { loaders, exec: githubExec({ nonGithub: true }), repo: fixtureRepoWithOrigins(origins), env: {}, params: {} });
  assert.deepEqual(result.rows, [{ repo: "example/alpha", rows: 1 }]);
});

test("github leaves its table empty when GraphQL returns errors without data", async () => {
  const result = await runSql("select * from pull_requests", { loaders, exec: githubExec({ graphqlErrorsWithoutData: true }), repo: fixtureRepo, env: {}, params: {} });
  assert.deepEqual(result.rows, []);
  const provider = result.providers.find((entry) => entry.name === "github");
  assert.equal(provider?.ok, 0);
  assert.equal(provider?.error, "gh: authentication required");
});

test("github accepts a missing repository and keeps a fork head repository", async () => {
  const origins = new Map([[paths.alpha, "git@github.com:example/alpha.git"], [paths.beta, "git@github.com:example/beta.git"]]);
  const result = await runSql("select repo, head_repo from pull_requests", { loaders, exec: githubExec({ absent: "example/beta", fork: true }), repo: fixtureRepoWithOrigins(origins), env: {}, params: {} });
  assert.deepEqual(result.rows, [{ repo: "example/alpha", head_repo: "example/fork" }]);
});

test("the GitHub origin parser preserves generated repository names", () => hegel.test((tc) => {
  const owner = tc.draw(gs.fromRegex("[A-Za-z0-9._-]{1,20}"));
  const name = tc.draw(gs.fromRegex("[A-Za-z0-9._-]{1,20}"));
  const shape = tc.draw(gs.sampledFrom([`git@github.com:${owner}/${name}`, `https://github.com/${owner}/${name}`, `ssh://git@github.com/${owner}/${name}`]));
  const suffix = tc.draw(gs.sampledFrom(["", ".git"]));
  assert.equal(parseGithubOrigin(`${shape}${suffix}`), `${owner}/${name}`);
}));

test("the GitHub origin parser rejects strings without github.com", () => hegel.test((tc) => {
  const value = tc.draw(gs.fromRegex("[A-Za-z0-9:/@._-]{0,80}").filter((text) => !text.includes("github.com")));
  assert.equal(parseGithubOrigin(value), null);
}));

test("the commit status check state has four outcomes", () => hegel.test((tc) => {
  const state = tc.draw(gs.optional(gs.sampledFrom(["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"] as const)));
  const expected = state === "SUCCESS" ? "pass" : state === "FAILURE" || state === "ERROR" ? "fail" : state === "PENDING" || state === "EXPECTED" ? "pending" : "none";
  assert.equal(checkState(state), expected);
}));

test("the pull request query preserves generated repository owner and name pairs", () => hegel.test((tc) => {
  const repos = tc.draw(gs.arrays(gs.fromRegex("[A-Za-z0-9._-]{1,20}").flatMap((owner) => gs.fromRegex("[A-Za-z0-9._-]{1,20}").map((name) => `${owner}/${name}`)), { maxSize: 20, unique: true }));
  const pairs = [...buildPullRequestsQuery(repos).matchAll(/r\d+: repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)].map(([, owner, name]) => `${owner}/${name}`);
  assert.deepEqual(pairs, repos);
}));
