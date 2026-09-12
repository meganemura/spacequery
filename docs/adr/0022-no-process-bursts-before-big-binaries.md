# 0022. Large binaries run before process bursts.

Date: 2026-09-11

Status: superseded by [0032](0032-commands-start-by-absolute-path.md)

## Context

On 2026-09-11, a burst of 18 concurrent file-opening processes delayed the next large non-Apple binary for about three seconds.
`gh --version` took 113 ms alone and 2,033 ms after the burst.
`ghq --version` took 127 ms alone and 2,665 ms after the burst.
`node -e 0` took 120 ms alone and 2,206 ms after the burst.
Apple git, python3, and a small jq were unaffected.
A burst of `/usr/bin/true` did not trigger the delay.
The delay grew with the burst size: 0.9 s for four, 1.4 s for eight, and 2.0 s for 18 processes.
It ended after three seconds.
gh and ghq are adhoc linker-signed, node uses the hardened runtime, and XProtect was the only security client.
ADR 0032 found that the trigger was `PATH` probing for name-based spawns.

## Decision

The core reads Git roots and origin URLs from Git discovery files in-process.
The loader configuration starts ghq, gh, mise, bd, and docker before loaders that start many git or lsof processes.

## Consequences

A query no longer starts Git to resolve a root or an origin.
It still starts Git for status and worktree data.
Measured after the change, on 2026-09-11 with 22 agents in 17 roots: the herdr loader takes 75 ms instead of 240; a query that reads `pull_requests` spends 3.5 to 4.1 s in gh instead of 8 to 9; `review_requests` 1.6 s instead of 5.8; git 150 to 250 ms as before. The 17 concurrent gh calls alone cost 2.5 to 3 s, so the remaining time is gh itself, not a burst before it.
