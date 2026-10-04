# 0051. Project issues come from polylinedb.

Date: 2026-10-04

Status: accepted.

## Context

Several repositories can use one local or cloud issue store.
A repository marker cannot identify the selected store or project.
Agent work needs the current project list, including in-progress and deferred tasks.
Closed history can be large, while the work dashboard shows unfinished work.

## Decision

Read `pd context` from each root in scope. Use its store selector and project for subsequent reads.
For each distinct store and project, read every page for `open`, `in_progress`, and `deferred` separately.
Do not fetch `closed` issues for the generic queries.
Keep repository associations separately from issue records. Deduplicate issues by store and issue ID.
Expose configured and unconfigured roots through an issue-source query.
A failed read fails the provider. It never substitutes a legacy issue list.

The generic issue queries use this provider. Historical providers remain available only through explicitly named queries.
The work dashboard lists unclosed issues, open issues, and their repository sources. Open status does not establish a claim or resolve dependencies.
The provider calls read operations only. It does not log in, change a connection, or modify an issue.

## Consequences

Each root requires one context call. Each distinct store and project requires one paginated list per active status.
Three status reads cost more than one read for a small project. A closed-heavy synthetic fixture with 1,000 closed issues and three active issues used 11 process invocations and returned 1,003 rows when listed without a status filter. Three status-filtered reads used three process invocations and returned three rows.
Pagination observes separate requests, so the resulting list is not a transaction-wide snapshot.
Provider status distinguishes failure from a successful empty list. Source rows distinguish unconfigured roots from configured projects.
