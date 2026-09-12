// The named queries the CLI and the skill show. A name here is a promise
// to an agent: the skill lists it, and this file maps it to a statement.
// Boundary: the mapping only. The statements live in the modules.
import type { Entry, Query } from "solarsql";
import { searchPathQueries } from "./providers/search-path/public.ts";
import { herdrQueries } from "./providers/herdr/public.ts";
import { gitQueries } from "./providers/git/public.ts";
import { miseQueries } from "./providers/mise/public.ts";
import { brewQueries } from "./providers/brew/public.ts";
import { repositoryVersionQueries } from "./providers/repository-versions/public.ts";
import { repositoryConfigFileQueries } from "./providers/repository-config-files/public.ts";
import { repoQueries } from "./providers/repos/public.ts";
import { reportQueries } from "./providers/report/public.ts";
import { sessionQueries } from "./providers/sessions/public.ts";
import { githubQueries } from "./providers/github/public.ts";
import { dockerQueries } from "./providers/docker/public.ts";
import { processQueries } from "./providers/processes/public.ts";
import { skillsQueries } from "./providers/skills/public.ts";
import { beadsQueries } from "./providers/beads/public.ts";
import { headsignQueries } from "./providers/headsign/public.ts";

export type Named = { query: Query<string, Entry>; description: string; params: readonly string[] };
export type Report = { description: string; sections: readonly (readonly [string, keyof typeof catalog])[]; gateSection: string };

export const catalog: Readonly<Record<string, Named>> = {
  "path-entries": { query: searchPathQueries.pathEntries, description: "The PATH entries of the caller, in order, with the ones that do not exist or repeat.", params: [] },
  "which": { query: searchPathQueries.which, description: "Every executable with one name on the caller's PATH, in order; the first row is the one that runs.", params: ["q"] },
  "shadowed-commands": { query: searchPathQueries.shadowedCommands, description: "Names that exist in more than one PATH directory, with the directory that wins.", params: [] },
  "agents": { query: herdrQueries.all, description: "Every agent herdr hosts, with its repository root.", params: [] },
  "find": { query: reportQueries.find, description: "Agents whose name, title, repository, or session name contains a word.", params: ["q"] },
  "in-dir": { query: herdrQueries.inDir, description: "The agents in one repository, by its root.", params: ["root"] },
  "working": { query: herdrQueries.working, description: "The agents that work right now.", params: [] },
  "workspaces": { query: herdrQueries.workspaces, description: "Which workspace holds agents of which repository.", params: [] },
  "dirty": { query: gitQueries.dirty, description: "Repositories with uncommitted changes, dirtiest first.", params: [] },
  "git-status": { query: gitQueries.status, description: "The branch, dirt, and distance from upstream of one repository.", params: ["root"] },
  "worktrees": { query: gitQueries.worktreesOf, description: "The worktrees of one repository, by its root.", params: ["root"] },
  "repos": { query: repoQueries.all, description: "Every repository ghq manages.", params: [] },
  "tools": { query: miseQueries.installed, description: "Every tool version mise has installed.", params: [] },
  "tools-in-dir": { query: miseQueries.inDir, description: "The tools mise activates in one repository, by its root.", params: ["root"] },
  "path-entries-in-dir": { query: miseQueries.pathEntriesInDir, description: "The PATH entries mise gives one repository, in order, with the ones that do not exist or repeat.", params: ["root"] },
  "which-in-dir": { query: miseQueries.whichInDir, description: "Every executable with one name on the PATH of one repository, in order; the first row is the one that runs.", params: ["root", "q"] },
  "shadowed-commands-in-dir": { query: miseQueries.shadowedCommandsInDir, description: "Names that exist in more than one PATH directory of one repository, with the directory that wins.", params: ["root"] },
  "brew-packages": { query: brewQueries.installed, description: "Every installed Homebrew formula and cask version.", params: [] },
  "installed-software": { query: reportQueries.installedSoftware, description: "Installed versions from mise and Homebrew, with their manager and package kind.", params: [] },
  "repository-versions": { query: repositoryVersionQueries.inDir, description: "Static version declarations and lock evidence in one repository.", params: ["root"] },
  "repository-config-files": { query: repositoryConfigFileQueries.inDir, description: "Recognized dependency, language, and tool configuration files in one repository.", params: ["root"] },
  "repository-config-files-in-scope": { query: repositoryConfigFileQueries.inScope, description: "Recognized configuration files and discovery diagnostics in repositories in scope.", params: [] },
  "repository-version-sources": { query: repositoryVersionQueries.sources, description: "Static version source coverage in repositories in scope.", params: [] },
  "shared-dependencies": { query: repositoryVersionQueries.sharedDependencies, description: "Direct npm dependencies declared by more than one repository in scope.", params: [] },
  "shared-dependency-details": { query: repositoryVersionQueries.sharedDependencyDetails, description: "Source evidence for direct npm dependencies shared across repositories in scope.", params: [] },
  "dependency-coverage": { query: repositoryVersionQueries.coverage, description: "Static source and unresolved-evidence counts for repositories in scope.", params: [] },
  "sessions": { query: sessionQueries.all, description: "Every Claude Code and Codex session alive now.", params: [] },
  "idle-sessions": { query: sessionQueries.idle, description: "Sessions ordered by how long they have been idle.", params: [] },
  "claude-sessions": { query: sessionQueries.claude, description: "Claude Code sessions alive now, with kind, status, and version.", params: [] },
  "codex-sessions": { query: sessionQueries.codex, description: "Codex threads alive now, with model, effort, and source.", params: [] },
  "pull-requests": { query: githubQueries.open, description: "Open pull requests of one repository.", params: ["root"] },
  "branch-pull-requests": { query: reportQueries.branchPullRequests, description: "Open pull requests for the branch one repository is on, with checks.", params: ["root"] },
  "review-requests": { query: githubQueries.reviewRequests, description: "Open pull requests that request the user's review.", params: [] },
  "containers": { query: dockerQueries.all, description: "Every Docker container, with image, state, health, and Compose identity.", params: [] },
  "containers-in-dir": { query: dockerQueries.inDir, description: "Docker containers associated with one repository.", params: ["root"] },
  "container-ports-in-dir": { query: dockerQueries.portsInDir, description: "Docker container ports associated with one repository.", params: ["root"] },
  "processes-in-dir": { query: processQueries.inDir, description: "Processes whose working directory is inside one repository.", params: ["root"] },
  "descendants": { query: processQueries.descendants, description: "Processes in scope that descend from one pid.", params: ["q"] },
  "session-processes": { query: reportQueries.sessionProcesses, description: "Processes in scope that a live session started, directly or through children.", params: [] },
  "busy-processes": { query: processQueries.busy, description: "Processes in scope that use the most CPU right now.", params: [] },
  "listening-ports": { query: processQueries.listening, description: "Every listening TCP port of the user, with the repository its process sits in.", params: [] },
  "skills": { query: skillsQueries.all, description: "Every skill Claude Code and Codex can load, with its source.", params: [] },
  "skills-in-dir": { query: skillsQueries.inDir, description: "The skills an agent can use in one repository.", params: ["root"] },
  "plugins": { query: skillsQueries.plugins, description: "Every installed plugin, with its version.", params: [] },
  "issues": { query: beadsQueries.open, description: "Open beads issues of one repository.", params: ["root"] },
  "issues-with-agents": { query: reportQueries.issuesWithAgents, description: "Repositories with an agent and their open beads issues.", params: [] },
  "issues-unattended": { query: reportQueries.issuesUnattended, description: "Repositories with open beads issues and no agent.", params: [] },
  "workflow": { query: headsignQueries.inDir, description: "The headsign run of one repository.", params: ["root"] },
  "workflows": { query: headsignQueries.all, description: "Every headsign run, with its phase.", params: [] },
  "running-workflows-with-agents": { query: reportQueries.runningWorkflowsWithAgents, description: "Running headsign workflows in repositories where an agent works.", params: [] },
  "running-workflows-unattended": { query: reportQueries.runningWorkflowsUnattended, description: "Running headsign workflows with no agent in the repository.", params: [] },
  "stopped-workflows": { query: reportQueries.stoppedRuns, description: "Headsign runs that stopped or recorded a failure.", params: [] },
  "agents-in-dirty-repos": { query: reportQueries.agentsInDirtyRepos, description: "Agents that work in a repository with uncommitted changes.", params: [] },
  "crowded-repos": { query: reportQueries.crowdedRepos, description: "Repositories with more than one agent, and their dirt.", params: [] },
  "idle-worktrees": { query: reportQueries.idleWorktrees, description: "Linked worktrees with no agent in them.", params: [] },
  "agents-outside-ghq": { query: reportQueries.agentsOutsideGhq, description: "Agents whose repository is not one ghq manages, or no repository at all.", params: [] },
  "dirty-unattended": { query: reportQueries.dirtyUnattended, description: "Repositories with uncommitted changes and no agent.", params: [] },
  "behind-upstream-with-agents": { query: reportQueries.behindUpstreamWithAgents, description: "Repositories behind their upstream that have an agent in them.", params: [] },
  "missing-tools-with-agents": { query: reportQueries.missingToolsWithAgents, description: "Repositories with an agent where a requested tool is not installed.", params: [] },
  "tool-versions-split": { query: reportQueries.toolVersionsSplit, description: "Tools whose active version differs between repositories with an agent.", params: [] },
  "agents-with-sessions": { query: reportQueries.agentsWithSessions, description: "Agents with the name, start time, and last activity of their session.", params: [] },
  "sessions-without-pane": { query: reportQueries.sessionsWithoutPane, description: "Sessions alive now that herdr does not show as an agent.", params: [] },
  "codex-threads-with-agents": { query: reportQueries.codexThreadsWithAgents, description: "Agents that are Codex threads, with model and effort.", params: [] },
  "prs-with-agents": { query: reportQueries.prsWithAgents, description: "Agents whose branch has an open pull request, with its checks.", params: [] },
  "failing-checks-with-agents": { query: reportQueries.failingChecksWithAgents, description: "Open pull requests with failing checks in repositories where an agent works.", params: [] },
  "review-requests-with-agents": { query: reportQueries.reviewRequestsWithAgents, description: "Requested reviews, with the number of agents in that repository.", params: [] },
  "ports-in-dir": { query: reportQueries.portsInDir, description: "Listening ports of processes inside one repository, with checkout context.", params: ["root"] },
  "servers-with-agents": { query: reportQueries.serversWithAgents, description: "Listening processes in repositories where an agent works.", params: [] },
  "long-running-without-agents": { query: reportQueries.longRunningWithoutAgents, description: "Processes older than an hour in repositories with no agent.", params: [] },
  "duplicate-skill-names": { query: reportQueries.duplicateSkillNames, description: "Skill names that come from more than one source.", params: [] },
  "skills-in-one-agent": { query: reportQueries.skillsInOneAgent, description: "Skills that exist for Claude Code or Codex but not both.", params: [] },
  "project-skills-with-agents": { query: reportQueries.projectSkillsWithAgents, description: "Project skills in repositories where an agent works.", params: [] },
};

export const reports = {
  here: {
    description: "Everything about the repository you sit in: who else is here, the checkout, its pull request, ports, containers, tools, issues, the workflow.",
    sections: [
      ["agents", "in-dir"],
      ["git", "git-status"],
      ["worktrees", "worktrees"],
      ["pull_requests", "branch-pull-requests"],
      ["ports", "ports-in-dir"],
      ["processes", "processes-in-dir"],
      ["containers", "containers-in-dir"],
      ["container_ports", "container-ports-in-dir"],
      ["tools", "tools-in-dir"],
      ["issues", "issues"],
      ["workflow", "workflow"],
    ],
    gateSection: "agents",
  },
  "dependency-report": {
    description: "Shared direct npm dependency requests and static source coverage in one snapshot.",
    sections: [["shared", "shared-dependencies"], ["coverage", "dependency-coverage"], ["sources", "repository-version-sources"]],
    gateSection: "shared",
  },
} as const satisfies Readonly<Record<string, Report>>;

export function reportParams(report: Report): string[] {
  return [...new Set(report.sections.flatMap(([, query]) => catalog[query]!.params))];
}
