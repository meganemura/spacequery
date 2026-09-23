# 0046. The work dashboard is one section list.

Date: 2026-09-23

Status: accepted. Refreshing the board is ADR 0047. Editing this list is not the refresh path.

## Context

An agent and a person both need the claimable issues, the open issues, and the models of the agents on this machine.
A screen drawn for a person, with a second smaller view for an agent, drifts: the two lists stop matching.
ADR 0025 already makes a report an ordered list of catalog queries from one database.
ADR 0002 makes every call a new observation.

## Decision

The work dashboard is the ordered section list in `dashboard.ts`.
`work` is that list registered as a report.
`spacequery work --json` returns the list as `definition.sections`, the omitted-scope default as `definition.default_scope`, and the refresh rule as `definition.refresh`.
`spacequery --help --json` returns the same sections on the `work` report, with `default_scope` and `refresh`.
`spacequery work --tsv` prints those section names in that order.
`spacequery ui` shows the same list under Reports and, on Run, the rows of those sections.
There is no cache of the previous rows. Refreshing that list on an interval is ADR 0047.
The sections are `issues-ready`, `issues-in-scope`, `agents-with-sessions`, and `cursor-agents`.
`cursor-agents` stays the local IDE database. Cloud agents are not a section.
A user still cannot define a report outside the repository.

## Consequences

The agent-facing JSON is the snapshot the human views render.
Help and the terminal browser cannot grow a second section order.
