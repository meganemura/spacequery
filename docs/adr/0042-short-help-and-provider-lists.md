# 0042. Help is a short list, and config can hide a provider from lists.

Date: 2026-09-23

Status: accepted

## Context

The catalog has more queries than a person or an agent can scan.
The useful complaint is not the count. It is that a name does not say when to use the query.
ADR 0023 orders `--help` by the call log. On a fresh machine that order is the catalog order, and it is the whole catalog.
Some providers are optional inventories. Beads, headsign, and runtag are author-owned tools. Homebrew is a machine inventory. Leaving them in every list advertises tools the machine may not have.

## Decision

Every built-in query has a `group`, a one-line `purpose`, and a `default` flag.
`group` follows the headings in the query reference. `purpose` says when to use the query. `default` marks the curated set.
`--help` and `--help --json` print the curated queries union the queries this machine has actually called, after removing any query whose required provider is off.
The cap is 25. Curated queries stay when they exceed it. A query with no calls does not fill a spare seat.
The call log only ranks that set. It is read on the machine at help time.
`--help --all` and `--help --all --json` print every enabled query, with the same fields: `group`, `purpose`, `default`, `enabled`, `requires`.
A report stays on the list when its gate section's providers are on. `requires` for a report still names every provider its sections read.
`$XDG_CONFIG_HOME/spacequery/config.json` (or `~/.config/spacequery/config.json`) holds `providers` as booleans and optional `help.mode` of `short` or `all`.
A missing file enables every built-in provider except `beads`, `brew`, `headsign`, and `runtag`.
Those four stay off until the file sets them to `true`. Any other provider can be set to `false`.
Help, JSON help, and the terminal browser omit or dim a query when a provider it reads is off.
Naming a query, or passing `--sql`, still loads the providers the statement reads.
Doctor does not load a provider that is off. It lists those names in `disabled_providers`.
The terminal browser writes the same config file when a provider is toggled.

## Consequences

A fresh `--help` is the curated set, not one developer's history and not the whole catalog.
Turning beads on puts its curated queries back on the short list.
The call log remains names and times only.
`config.json` is a second file spacequery writes. Only the provider toggle writes it. Help and doctor only read it.
A provider that is off is not a failed doctor check.
