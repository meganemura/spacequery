# 0019. Beads issues are read per repository.

Date: 2026-09-10

Status: accepted

## Context

A repository that uses beads has a `.beads` directory at its root.
The beads command embeds a dolt database and costs about 0.6 seconds for each repository.
Open issues describe present work; closed issues describe history.

## Decision

For each root in scope with `.beads`, spacequery runs `bd -C <root> list --json`.
The loader reads open issues only and runs the calls concurrently.

## Consequences

The provider costs about 0.6 seconds per repository in scope, with concurrent calls.
A closed issue is absent because history needs a search tool.
Claimable issues are a separate read (ADR 0045).
