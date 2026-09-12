// The joins. This module owns no table and reads every provider's table
// (readsAll). Every query that crosses two providers lives here, so a
// provider module stays a description of one tool.
// `:me` is the caller's pane. Null keeps every agent, so a shell with no
// herdr identity still gets rows.
import { queries } from "solarsql";
import { generated } from "./solarsql.generated.ts";

export const reportQueries = queries(generated, {
  // The source and kind keep package identities separate across managers.
  installedSoftware: `
    select cast('mise' as text) as manager, cast('tool' as text) as kind, tool as name, version from tools where installed = 1
    union all
    select cast('brew' as text) as manager, kind, name, version from brew_packages
    order by manager, kind, name, version`,
  // An agent can be identified by a pane field or by the session it holds.
  find: `
    select a.pane_id, a.agent, a.agent_status, a.name, a.title, a.root, a.cwd, s.name as session_name
    from agents a left join sessions s on s.session_id = a.session_id
    where (:me is null or a.pane_id <> :me)
      and (a.name like '%' || :q || '%' or a.title like '%' || :q || '%' or a.root like '%' || :q || '%' or a.cwd like '%' || :q || '%' or s.name like '%' || :q || '%')
    order by a.pane_id`,
  // Agents that work in a repository with uncommitted changes.
  agentsInDirtyRepos: `
    select a.pane_id, a.name, a.agent_status, a.root, g.branch, g.dirty_count, g.untracked_count
    from agents a join git_status g on g.root = a.root
    where g.dirty_count > 0 and (:me is null or a.pane_id <> :me)
    order by g.dirty_count desc, a.pane_id`,
  // The checkout branch identifies a pull request only when its head belongs
  // to the same repository, which excludes fork branches with the same name.
  branchPullRequests: `
    select p.repo, p.number, p.title, p.head_branch, p.checks, p.review_decision, p.is_draft, p.url
    from git_status g join pull_requests p on p.root = g.root and p.head_branch = g.branch and p.head_repo = p.repo
    where g.root = :root
    order by p.repo, p.number`,
  // Repositories with more than one agent, and their dirt.
  crowdedRepos: `
    select a.root, cast(count(*) as integer) as agents, cast(sum(a.agent_status = 'working') as integer) as working,
           cast(coalesce(g.dirty_count, 0) as integer) as dirty_count
    from agents a left join git_status g on g.root = a.root
    where a.root is not null
    group by a.root having count(*) > 1 order by agents desc, a.root`,
  // Linked worktrees that have no agent in them.
  idleWorktrees: `
    select w.path, w.branch, w.repo_root
    from worktrees w left join agents a on a.root = w.path
    where a.pane_id is null and w.path <> w.repo_root order by w.path`,
  // Agents whose root is not a ghq repository: scratch, temp, or no repository.
  agentsOutsideGhq: `
    select a.pane_id, a.name, a.agent_status, a.cwd, a.root from agents a
    left join repos r on r.path = a.root
    where r.path is null and (:me is null or a.pane_id <> :me) order by a.pane_id`,
  // Repositories with uncommitted changes and no agent at all.
  dirtyUnattended: `
    select g.root, g.branch, g.dirty_count, g.untracked_count from git_status g
    left join agents a on a.root = g.root
    where a.pane_id is null and g.dirty_count > 0 order by g.dirty_count desc, g.root`,
  // Repositories behind their upstream that have an agent in them.
  behindUpstreamWithAgents: `
    select g.root, g.branch, g.upstream, g.behind, g.ahead,
           cast(count(a.pane_id) as integer) as agents
    from git_status g join agents a on a.root = g.root
    where g.behind > 0 and (:me is null or a.pane_id <> :me)
    group by g.root order by g.behind desc, g.root`,
  // Repositories with an agent and a requested version that is absent.
  missingToolsWithAgents: `
    select u.root, u.tool, u.version, u.source, cast(count(a.pane_id) as integer) as agents
    from tool_uses u join agents a on a.root = u.root
    where u.installed = 0 and (:me is null or a.pane_id <> :me)
    group by u.root, u.tool, u.version, u.source order by u.root, u.tool`,
  // Tool versions that differ between roots where an agent is present.
  toolVersionsSplit: `
    select u.tool, cast(count(distinct u.version) as integer) as versions,
           cast(group_concat(distinct u.version) as text) as version_list
    from tool_uses u join agents a on a.root = u.root
    group by u.tool having count(distinct u.version) > 1 order by u.tool`,
  // Agent panes with the session record that describes their recent work.
  agentsWithSessions: `
    select a.pane_id, a.agent, a.agent_status, s.name, c.status as claude_status, c.kind, x.model, x.source, s.started_at, s.updated_at, s.last_turn_at, s.last_branch, a.root,
           cast((unixepoch('subsec') * 1000 - s.updated_at) / 60000 as integer) as idle_minutes
    from agents a left join sessions s on s.session_id = a.session_id
    left join claude_sessions c on c.session_id = s.session_id
    left join codex_sessions x on x.session_id = s.session_id
    where :me is null or a.pane_id <> :me
    order by idle_minutes desc`,
  // A session owns every in-scope process reached through its child chain.
  // The recursive part descends once per distinct root pid, not once per
  // session: two sessions sharing a pid (e.g. two Codex threads in the same
  // app) would otherwise double the anchor and compound at every level. The
  // closing join back onto sessions fans the shared descendant set out to
  // every session that holds that pid. `union` (not `union all`) keeps a
  // repeated path or a ppid cycle from adding a duplicate row.
  sessionProcesses: `
    with recursive session_descendants(session_pid, pid) as (
      select r.pid, p.pid
      from (select distinct pid from sessions where pid is not null) r
      join processes p on p.ppid = r.pid
      union
      select d.session_pid, p.pid
      from session_descendants d join processes p on p.ppid = d.pid
    )
    select s.session_id, s.agent, s.name, s.pid as session_pid, p.pid, p.command, p.elapsed_s, p.cpu, p.root
    from session_descendants d join sessions s on s.pid = d.session_pid
    join processes p on p.pid = d.pid
    order by s.session_id, p.pid`,
  // Live sessions can lack a pane when they run headlessly or elsewhere.
  sessionsWithoutPane: `
    select s.session_id, s.agent, s.cwd, s.root, s.name, s.updated_at
    from sessions s left join agents a on a.session_id = s.session_id
    where a.pane_id is null order by s.agent, s.updated_at`,
  // Codex thread fields stay distinct from Claude Code fields in this join.
  codexThreadsWithAgents: `
    select a.pane_id, a.root, x.model, x.reasoning_effort, x.source, x.tokens_used, s.updated_at
    from agents a join sessions s on s.session_id = a.session_id
    join codex_sessions x on x.session_id = s.session_id
    where :me is null or a.pane_id <> :me
    order by s.updated_at desc`,
  // Agents whose current branch has an open pull request.
  prsWithAgents: `
    select a.pane_id, a.name, a.agent_status, p.repo, p.number, p.title, p.head_branch, p.checks, p.review_decision, p.is_draft, p.url
    from agents a join git_status g on g.root = a.root
    join pull_requests p on p.root = g.root and p.head_branch = g.branch and p.head_repo = p.repo
    where :me is null or a.pane_id <> :me
    order by p.repo, p.number, a.pane_id`,
  // Failed pull requests show how many agents work in their repository.
  failingChecksWithAgents: `
    select p.repo, p.number, p.title, p.head_branch, p.checks, p.review_decision, p.is_draft, p.url,
           cast(count(a.pane_id) as integer) as agents
    from agents a join git_status g on g.root = a.root
    join pull_requests p on p.root = g.root and p.head_branch = g.branch and p.head_repo = p.repo
    where p.checks = 'fail' and (:me is null or a.pane_id <> :me)
    group by p.id order by p.repo, p.number`,
  // A review request can sit outside the roots currently in scope.
  reviewRequestsWithAgents: `
    select p.repo, p.number, p.title, p.author, p.updated_at, p.url,
           cast(count(a.pane_id) as integer) as agents
    from review_requests p left join agents a on a.root = p.root and (:me is null or a.pane_id <> :me)
    group by p.id order by p.updated_at desc`,
  // Ports inside the selected repository.
  portsInDir: `
    select l.pid, l.address, l.port, l.cwd, l.root, l.command, w.head, g.branch, g.dirty_count, g.untracked_count, p.elapsed_s
    from listeners l
    left join processes p on p.pid = l.pid and p.root = l.root
    left join git_status g on g.root = l.root
    left join worktrees w on w.path = l.root
    where l.root = :root order by l.port`,
  // A server and the agents whose repository it occupies.
  serversWithAgents: `
    select l.root, l.port, l.address, l.pid, l.command, cast(count(a.pane_id) as integer) as agents
    from listeners l join agents a on a.root = l.root
    where :me is null or a.pane_id <> :me
    group by l.id order by l.port`,
  // Long-lived repository processes without an agent pane.
  longRunningWithoutAgents: `
    select p.root, p.pid, p.executable, p.elapsed_s, p.rss_kb
    from processes p left join agents a on a.root = p.root
    where p.elapsed_s > 3600 and a.pane_id is null order by p.elapsed_s desc`,
  // A source collision can change which skill an agent chooses.
  duplicateSkillNames: `
    select agent, name, cast(count(*) as integer) as sources, cast(group_concat(source, ',') as text) as source_list
    from skills group by agent, name having count(*) > 1 order by agent, name`,
  // Distinct names make an agent-level comparison independent of source count.
  skillsInOneAgent: `
    select left_names.name, left_names.agent from (select distinct agent, name from skills) left_names
    left join (select distinct agent, name from skills) right_names
      on right_names.name = left_names.name and right_names.agent <> left_names.agent
    where right_names.agent is null order by left_names.name, left_names.agent`,
  // Project skills matter where a terminal pane currently has a repository.
  projectSkillsWithAgents: `
    select s.root, s.name, s.description, cast(count(a.pane_id) as integer) as agents
    from skills s join agents a on a.root = s.root
    where s.source = 'claude-project'
    group by s.root, s.name, s.description order by s.root, s.name`,
  // Open issues show the work beside agents that occupy the same repository.
  issuesWithAgents: `
    select i.root, cast(count(distinct i.id) as integer) as open_issues,
           cast(min(i.priority) as integer) as top_priority, cast(count(distinct a.pane_id) as integer) as agents
    from issues i join agents a on a.root = i.root
    where :me is null or a.pane_id <> :me
    group by i.root order by i.root`,
  // A repository with issues but no pane needs an explicit owner.
  issuesUnattended: `
    select i.root, cast(count(distinct i.id) as integer) as open_issues, cast(min(i.priority) as integer) as top_priority
    from issues i left join agents a on a.root = i.root
    where a.pane_id is null group by i.root order by i.root`,
  // Only a running workflow needs the presence count of non-caller panes.
  runningWorkflowsWithAgents: `
    select w.root, w.workflow, w.phase, w.total_iterations, w.phase_entered_at, cast(count(a.pane_id) as integer) as agents
    from workflow_runs w join agents a on a.root = w.root
    where w.status = 'running' and (:me is null or a.pane_id <> :me)
    group by w.root, w.workflow, w.phase, w.total_iterations, w.phase_entered_at order by w.root`,
  // A running workflow without a pane cannot receive a prompt to continue.
  runningWorkflowsUnattended: `
    select w.root, w.workflow, w.phase, w.phase_entered_at
    from workflow_runs w left join agents a on a.root = w.root
    where w.status = 'running' and a.pane_id is null order by w.root`,
  // A recorded failure remains useful even if the state calls the run complete.
  stoppedRuns: `
    select root, workflow, phase, status, end_reason, last_failure from workflow_runs
    where (status <> 'running' and status <> 'complete') or last_failure is not null order by root`,
});
