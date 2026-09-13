# 0038: Usage limits come from the CLI and local logs

## Decision

Two independent loaders expose subscription quota observations.
claude-usage invokes `claude -p /usage --output-format json --no-session-persistence`.
The command is a fixed local command, not an inference prompt supplied by a query.
Its result must identify the usage command, report success, and report zero inference turns.
The CLI may contact its service. Session persistence is disabled.
Observed command durations ranged from about 2.3 seconds to 48 seconds under concurrent test load.
Actual call durations appear in providers.

codex-usage inventories JSONL modification times under local sessions and archived_sessions directories.
It reads at most the final 256 KiB of each of the 32 most recently modified files.
Within those tails it retains the newest event timestamp per limit ID and window length.
Modification times select files; event timestamps select observations. These clocks serve different purposes.
The fixed limit lets missing windows fall back to other recent files without an unbounded content scan.
A partial first record is skipped. Missing files during discovery or opening are skipped.
Every call starts fresh and reads at most 8 MiB of log content, plus directory entries and file metadata.
An earlier full scan of about 1.9 GiB took 30 to 72 seconds. The bounded scan took under one second on that machine.
This observes recent evidence rather than proving the newest value across all history.
Older files, events outside a tail, and windows absent from the inspected records can be omitted.
It starts no process and makes no network request.

Both tables report used percentages, window lengths in minutes, and observation times in epoch milliseconds.
Codex reset times are converted from epoch seconds to milliseconds.
Claude reset text has no year, so it stays as source text and the numeric reset time is null.
Missing windows produce no rows. Missing values never mean zero usage.
Malformed Claude output fails the provider instead of returning a successful empty observation.

## Boundaries

Quota observations concern the account used by the source, not usage attributable to this machine.
Codex logs can outlive account changes. Source paths and record timestamps identify their evidence;
the loader cannot certify that an old snapshot belongs to the currently signed-in account.
Expired snapshots remain timestamped historical observations, not inferred fresh quotas.
Model-specific windows retain their source labels or limit IDs.
Token totals, cost estimates, local usage-attribution prose, credentials, and quota resets are outside these tables.
