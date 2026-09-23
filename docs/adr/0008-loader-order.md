# 0008. Loaders run in dependency order, then configuration order.

Date: 2026-09-10

Status: accepted; serial execution of independent loaders is superseded by [0044](0044-independent-loaders-run-together.md)

## Context

The git loader needs the roots to run on.
Under the default scope they are the roots with an agent, from the agents table; under `--scope all` the ghq repositories join them.
It reads both through the owners' `public.ts`, so it runs after herdr and after repos.

Independent loaders need an order too, and the order changes the time a call takes.
Measured on 2026-09-10: `ghq list -p` alone takes 50 to 130 ms.
Run right after 18 `git rev-parse` calls in different repositories it takes 1,500 to 1,700 ms, and after one such call 210 ms.
The next call is fast again.
The cause was not identified.

## Decision

A loader runs after the loaders its `after` names.
Independent loaders keep the order of the module list in `spacequery.config.ts`.
The configuration puts loaders that start ghq, gh, mise, bd, and docker before loaders that start many git or lsof processes.
On 2026-09-11, 18 concurrent file-opening processes delayed the next large non-Apple binary by about two seconds.

## Consequences

A default-scope call puts its large executable launches before later process bursts.
Under `--scope all` git takes 1.4 s for 66 repositories.
A change to the module list changes the order independent loaders run in.
