// The named queries the CLI and the skill show. A name here is a promise
// to an agent: group and purpose say when to use it, and default marks the
// curated short list. The statements live in the modules.
// Boundary: the mapping only.
import type { Entry, Query } from "solarsql";
import type { Scope } from "./core/loader.ts";
import { workDashboard } from "./dashboard.ts";
import { searchPathQueries } from "./providers/search-path/public.ts";
import { herdrQueries } from "./providers/herdr/public.ts";
import { gitQueries } from "./providers/git/public.ts";
import { miseQueries } from "./providers/mise/public.ts";
import { brewQueries } from "./providers/brew/public.ts";
import { repositoryVersionQueries } from "./providers/repository-versions/public.ts";
import { repositoryConfigFileQueries } from "./providers/repository-config-files/public.ts";
import { repoQueries } from "./providers/repos/public.ts";
import { reportQueries } from "./providers/report/public.ts";
import { usageQueries } from "./providers/usage/public.ts";
import { sessionQueries } from "./providers/sessions/public.ts";
import { githubQueries } from "./providers/github/public.ts";
import { dockerQueries } from "./providers/docker/public.ts";
import { processQueries } from "./providers/processes/public.ts";
import { skillsQueries } from "./providers/skills/public.ts";
import { beadsQueries } from "./providers/beads/public.ts";
import { headsignQueries } from "./providers/headsign/public.ts";
import { runtagQueries } from "./providers/runtag/public.ts";
import { cursorQueries } from "./providers/cursor/public.ts";

export type Named = {
  query: Query<string, Entry>;
  description: string;
  params: readonly string[];
  group: string;
  purpose: string;
  default: boolean;
  // When the caller omits --scope. A root parameter still defaults to root.
  defaultScope?: Scope;
};
export type Report = {
  description: string;
  purpose: string;
  group: string;
  default: boolean;
  sections: readonly (readonly [string, keyof typeof catalog])[];
  gateSection: string;
  defaultScope?: Scope;
  // How to refresh this report on an interval. The CLI copies it into JSON.
  refresh?: string;
};

function named(
  query: Query<string, Entry>,
  description: string,
  params: readonly string[],
  group: string,
  purpose: string,
  curated = false,
  defaultScope?: Scope,
): Named {
  return { query, description, params, group, purpose, default: curated, ...(defaultScope === undefined ? {} : { defaultScope }) };
}

export const catalog: Readonly<Record<string, Named>> = {
  "path-entries": named(searchPathQueries.pathEntries, "The PATH entries of the caller, in order, with the ones that do not exist or repeat.", [], "Search path", "When a command is missing and you need the dead or repeated PATH entries."),
  "which": named(searchPathQueries.which, "Every executable with one name on the caller's PATH, in order; the first row is the one that runs.", ["q"], "Search path", "When you need every match for one command name and which one the caller runs.", true),
  "shadowed-commands": named(searchPathQueries.shadowedCommands, "Names that exist in more than one PATH directory, with the directory that wins.", [], "Search path", "When the same command name exists in more than one PATH directory."),
  "agents": named(herdrQueries.all, "Every agent herdr hosts, with its repository root.", [], "Agents", "When you need every hosted agent and the repository it sits in.", true),
  "find": named(reportQueries.find, "Agents whose name, title, repository, or session name contains a word.", ["q"], "Agents", "When you know a word from an agent's name, title, repository, or session."),
  "in-dir": named(herdrQueries.inDir, "The agents in one repository, by its root.", ["root"], "Agents", "When you are about to work in a repository and need to see who else is there.", true),
  "working": named(herdrQueries.working, "The agents that work right now.", [], "Agents", "When you need the agents that are working right now.", true),
  "workspaces": named(herdrQueries.workspaces, "Which workspace holds agents of which repository.", [], "Agents", "When you need which workspace holds agents from which repository."),
  "dirty": named(gitQueries.dirty, "Repositories with uncommitted changes, dirtiest first.", [], "Git", "When you want repositories with uncommitted changes, busiest first.", true),
  "git-status": named(gitQueries.status, "The branch, dirt, and distance from upstream of one repository.", ["root"], "Git", "When you need one repository's branch and how far it is from upstream."),
  "worktrees": named(gitQueries.worktreesOf, "The worktrees of one repository, by its root.", ["root"], "Git", "When you need the worktrees of one repository."),
  "repos": named(repoQueries.all, "Every repository ghq manages.", [], "Repositories", "When you need every repository ghq manages."),
  "tools": named(miseQueries.installed, "Every tool version mise has installed.", [], "Tools", "When you need every tool version mise has installed."),
  "tools-in-dir": named(miseQueries.inDir, "The tools mise activates in one repository, by its root.", ["root"], "Tools", "When you need the tool versions mise activates in one repository.", true),
  "path-entries-in-dir": named(miseQueries.pathEntriesInDir, "The PATH entries mise gives one repository, in order, with the ones that do not exist or repeat.", ["root"], "Search path", "When a repository's mise PATH has a dead or repeated entry."),
  "which-in-dir": named(miseQueries.whichInDir, "Every executable with one name on the PATH of one repository, in order; the first row is the one that runs.", ["root", "q"], "Search path", "When you need the executable a repository would run for one name.", true),
  "shadowed-commands-in-dir": named(miseQueries.shadowedCommandsInDir, "Names that exist in more than one PATH directory of one repository, with the directory that wins.", ["root"], "Search path", "When a repository's PATH hides one command name behind another directory."),
  "brew-packages": named(brewQueries.installed, "Every installed Homebrew formula and cask version.", [], "Installed software", "When you need installed Homebrew formula and cask versions."),
  "installed-software": named(reportQueries.installedSoftware, "Installed versions from mise and Homebrew, with their manager and package kind.", [], "Installed software", "When you want mise and Homebrew versions in one list."),
  "repository-versions": named(repositoryVersionQueries.inDir, "Static version declarations and lock evidence in one repository.", ["root"], "Repository versions", "When you need static version and lock evidence in one repository before you trust a runtime.", true),
  "repository-config-files": named(repositoryConfigFileQueries.inDir, "Recognized dependency, language, and tool configuration files in one repository.", ["root"], "Repository configuration files", "When you need the recognized config files in one repository before you choose a parser."),
  "repository-config-files-in-scope": named(repositoryConfigFileQueries.inScope, "Recognized configuration files and discovery diagnostics in repositories in scope.", [], "Repository configuration files", "When you need that config-file inventory for every repository in scope."),
  "repository-version-sources": named(repositoryVersionQueries.sources, "Static version source coverage in repositories in scope.", [], "Repository versions", "When you need to see which version files were inspected across repositories."),
  "shared-dependencies": named(repositoryVersionQueries.sharedDependencies, "Direct npm dependencies declared by more than one repository in scope.", [], "Repository versions", "When the same direct npm dependency is declared in more than one repository."),
  "shared-dependency-details": named(repositoryVersionQueries.sharedDependencyDetails, "Source evidence for direct npm dependencies shared across repositories in scope.", [], "Repository versions", "When you need the file evidence behind a shared npm dependency."),
  "dependency-coverage": named(repositoryVersionQueries.coverage, "Static source and unresolved-evidence counts for repositories in scope.", [], "Repository versions", "When you need to know how much static version evidence was read or left unresolved."),
  "claude-usage": named(usageQueries.claude, "Subscription quota percentages reported by Claude /usage.", [], "Usage", "When you need Claude subscription quota before a long run."),
  "codex-usage": named(usageQueries.codex, "Quota percentages from the tails of the 32 most recently modified Codex logs.", [], "Usage", "When you need Codex quota from recent local logs before a long run."),
  "sessions": named(sessionQueries.all, "Every Claude Code and Codex session alive now.", [], "Sessions", "When you need every Claude Code and Codex session that is alive."),
  "idle-sessions": named(sessionQueries.idle, "Sessions ordered by how long they have been idle.", [], "Sessions", "When you want the sessions that have been quiet the longest.", true),
  "claude-sessions": named(sessionQueries.claude, "Claude Code sessions alive now, with observed model, effort, name, and status.", [], "Sessions", "When you need a live Claude session's recorded model, effort, or name.", true),
  "codex-sessions": named(sessionQueries.codex, "Codex threads alive now, with model, effort, and source.", [], "Sessions", "When you need a live Codex thread's model, effort, or source.", true),
  "pull-requests": named(githubQueries.open, "Open pull requests of one repository.", ["root"], "GitHub", "When you need the open pull requests of one repository."),
  "branch-pull-requests": named(reportQueries.branchPullRequests, "Open pull requests for the branch one repository is on, with checks.", ["root"], "GitHub", "When you need the open pull request for the branch one repository is on."),
  "review-requests": named(githubQueries.reviewRequests, "Open pull requests that request the user's review.", [], "GitHub", "When you need pull requests that ask you for review."),
  "containers": named(dockerQueries.all, "Every Docker container, with image, state, health, and Compose identity.", [], "Docker", "When you need every Docker container and whether it is running."),
  "containers-in-dir": named(dockerQueries.inDir, "Docker containers associated with one repository.", ["root"], "Docker", "When you need the containers associated with one repository.", true),
  "container-ports-in-dir": named(dockerQueries.portsInDir, "Docker container ports associated with one repository.", ["root"], "Docker", "When you need published and exposed ports for one repository's containers."),
  "processes-in-dir": named(processQueries.inDir, "Processes whose working directory is inside one repository.", ["root"], "Processes", "When you need the processes whose working directory is inside one repository.", true),
  "descendants": named(processQueries.descendants, "Processes in scope that descend from one pid.", ["q"], "Processes", "When you need the in-scope processes that descend from one pid."),
  "session-processes": named(reportQueries.sessionProcesses, "Processes in scope that a live session started, directly or through children.", [], "Sessions", "When you need the processes a live session started."),
  "busy-processes": named(processQueries.busy, "Processes in scope that use the most CPU right now.", [], "Processes", "When you need the in-scope processes using the most CPU."),
  "listening-ports": named(processQueries.listening, "Every listening TCP port of the user, with the repository its process sits in.", [], "Processes", "When you need every listening TCP port and the repository it sits in."),
  "skills": named(skillsQueries.all, "Every skill Claude Code and Codex can load, with its source.", [], "Skills", "When you need every skill Claude Code and Codex can load."),
  "skills-in-dir": named(skillsQueries.inDir, "The skills an agent can use in one repository.", ["root"], "Skills", "When you need the skills an agent can use in one repository.", true),
  "plugins": named(skillsQueries.plugins, "Every installed plugin, with its version.", [], "Skills", "When you need installed plugins and their versions."),
  "issues": named(beadsQueries.open, "Open beads issues of one repository.", ["root"], "Issues", "When you pick up a repository and need its open beads issues.", true),
  "issues-in-scope": named(beadsQueries.all, "Open beads issues across repositories in scope, one row per issue.", [], "Issues", "When you want open beads issues across projects. Omitting --scope reads every ghq root with .beads. --scope agents narrows to roots that have an agent.", true, "all"),
  "issues-ready": named(beadsQueries.ready, "Claimable beads issues across repositories in scope, one row per issue.", [], "Issues", "When you want claimable beads issues across projects. Omitting --scope reads every ghq root with .beads. --scope agents narrows to roots that have an agent.", true, "all"),
  "issues-with-agents": named(reportQueries.issuesWithAgents, "Repositories with an agent and their open beads issues.", [], "Issues", "When you want open beads issues in repositories that have an agent."),
  "issues-unattended": named(reportQueries.issuesUnattended, "Repositories with open beads issues and no agent.", [], "Issues", "When open beads issues have no agent in the repository.", true),
  "workflow": named(headsignQueries.inDir, "The headsign run of one repository.", ["root"], "Workflows", "When you pick up a repository and need its headsign run.", true),
  "runs-in-dir": named(runtagQueries.inDir, "runtag jobs whose repository root or working directory is the given directory or inside it.", ["root"], "Runs", "When you are waiting on a detached runtag job for one directory.", true),
  "workflows": named(headsignQueries.all, "Every headsign run, with its phase.", [], "Workflows", "When you need every headsign run and its phase."),
  "running-workflows-with-agents": named(reportQueries.runningWorkflowsWithAgents, "Running headsign workflows in repositories where an agent works.", [], "Workflows", "When a headsign workflow is running where an agent works."),
  "running-workflows-unattended": named(reportQueries.runningWorkflowsUnattended, "Running headsign workflows with no agent in the repository.", [], "Workflows", "When a headsign workflow is running with no agent in the repository.", true),
  "stopped-workflows": named(reportQueries.stoppedRuns, "Headsign runs that stopped or recorded a failure.", [], "Workflows", "When a headsign run stopped or recorded a failure."),
  "agents-in-dirty-repos": named(reportQueries.agentsInDirtyRepos, "Agents that work in a repository with uncommitted changes.", [], "Git", "When an agent is working in a checkout that already has changes."),
  "crowded-repos": named(reportQueries.crowdedRepos, "Repositories with more than one agent, and their dirt.", [], "Git", "When more than one agent shares a repository."),
  "idle-worktrees": named(reportQueries.idleWorktrees, "Linked worktrees with no agent in them.", [], "Git", "When you need a linked worktree with nobody in it.", true),
  "agents-outside-ghq": named(reportQueries.agentsOutsideGhq, "Agents whose repository is not one ghq manages, or no repository at all.", [], "Repositories", "When an agent's checkout is outside ghq, or the agent has no repository."),
  "dirty-unattended": named(reportQueries.dirtyUnattended, "Repositories with uncommitted changes and no agent.", [], "Git", "When uncommitted changes have no agent tending them.", true),
  "behind-upstream-with-agents": named(reportQueries.behindUpstreamWithAgents, "Repositories behind their upstream that have an agent in them.", [], "Git", "When an agent sits in a repository that is behind upstream."),
  "missing-tools-with-agents": named(reportQueries.missingToolsWithAgents, "Repositories with an agent where a requested tool is not installed.", [], "Tools", "When an agent is in a repository whose requested tool is not installed."),
  "tool-versions-split": named(reportQueries.toolVersionsSplit, "Tools whose active version differs between repositories with an agent.", [], "Tools", "When repositories with agents disagree on the active version of a tool."),
  "agents-with-sessions": named(reportQueries.agentsWithSessions, "Agents with the name, model, start time, and last activity of their session.", [], "Sessions", "When you want each agent together with its session name, model, and idle time.", true),
  "cursor-agents": named(cursorQueries.recent, "Recent Cursor agent conversations, with model, status, and repository when the local database records them.", [], "Cursor", "When you want the model and status of recent Cursor agent conversations stored on this machine."),
  "sessions-without-pane": named(reportQueries.sessionsWithoutPane, "Sessions alive now that herdr does not show as an agent.", [], "Sessions", "When a live session is not shown as a herdr agent."),
  "codex-threads-with-agents": named(reportQueries.codexThreadsWithAgents, "Agents that are Codex threads, with model and effort.", [], "Sessions", "When you want the Codex model and effort for agents that are threads."),
  "prs-with-agents": named(reportQueries.prsWithAgents, "Agents whose branch has an open pull request, with its checks.", [], "GitHub", "When you need the open pull request for a branch an agent is on.", true),
  "failing-checks-with-agents": named(reportQueries.failingChecksWithAgents, "Open pull requests with failing checks in repositories where an agent works.", [], "GitHub", "When failing checks sit in a repository where an agent works.", true),
  "review-requests-with-agents": named(reportQueries.reviewRequestsWithAgents, "Requested reviews, with the number of agents in that repository.", [], "GitHub", "When a requested review is in a repository that also has agents."),
  "ports-in-dir": named(reportQueries.portsInDir, "Listening ports of processes inside one repository, with checkout context.", ["root"], "Processes", "When you are about to bind a port and need the listeners already inside one repository.", true),
  "servers-with-agents": named(reportQueries.serversWithAgents, "Listening processes in repositories where an agent works.", [], "Processes", "When a listener is running in a repository where an agent works."),
  "long-running-without-agents": named(reportQueries.longRunningWithoutAgents, "Processes older than an hour in repositories with no agent.", [], "Processes", "When a process has been up for over an hour in a repository with no agent."),
  "duplicate-skill-names": named(reportQueries.duplicateSkillNames, "Skill names that come from more than one source.", [], "Skills", "When the same skill name comes from more than one source."),
  "skills-in-one-agent": named(reportQueries.skillsInOneAgent, "Skills that exist for Claude Code or Codex but not both.", [], "Skills", "When a skill exists for Claude Code or Codex but not both."),
  "project-skills-with-agents": named(reportQueries.projectSkillsWithAgents, "Project skills in repositories where an agent works.", [], "Skills", "When a project skill lives in a repository where an agent works."),
};

export const reports = {
  here: {
    description: "Everything about the repository you sit in: who else is here, the checkout, its pull request, ports, containers, tools, issues, the workflow.",
    purpose: "When you start work in a repository and want the other agents, the checkout, and what is already running.",
    group: "Reports",
    default: true,
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
    purpose: "When you want shared npm requests and source coverage from one snapshot.",
    group: "Reports",
    default: false,
    sections: [["shared", "shared-dependencies"], ["coverage", "dependency-coverage"], ["sources", "repository-version-sources"]],
    gateSection: "shared",
  },
  work: {
    description: workDashboard.description,
    purpose: workDashboard.purpose,
    group: workDashboard.group,
    default: workDashboard.default,
    defaultScope: workDashboard.defaultScope,
    sections: workDashboard.sections,
    gateSection: workDashboard.gateSection,
    refresh: workDashboard.refresh,
  },
} as const satisfies Readonly<Record<string, Report>>;

export function reportParams(report: Report): string[] {
  return [...new Set(report.sections.flatMap(([, query]) => catalog[query]!.params))];
}
