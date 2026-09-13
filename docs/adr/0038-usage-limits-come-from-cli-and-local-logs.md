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
It reads backward from each of the 32 most recently modified files, starting with 4 KiB.
Blocks double in size until a block yields complete quota records, the file starts, or 256 KiB has been read.
The leading fragment stays as bytes until a preceding block completes its JSONL record.
Reading stops at the first block with valid quota records, including all complete quota records in that block.
Within those tails it retains the newest event timestamp per limit ID and window length.
Modification times select files; event timestamps select observations. These clocks serve different purposes.
The fixed limit lets missing windows fall back to other recent files without an unbounded content scan.
An incomplete leading record at the read limit is skipped. Missing files during discovery or opening are skipped.
Every call starts fresh and reads at most 8 MiB of log content, plus directory entries and file metadata.
An earlier full scan of about 1.9 GiB took 30 to 72 seconds. The bounded scan took under one second on that machine.
This observes recent evidence rather than proving the newest value across all history.
Older files, earlier blocks beyond the first match, and windows absent from the inspected records can be omitted.
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


## Adaptive read measurements

A sample of the 32 most recently modified files among 1,108 local logs had quota records in 31 files (96.9%).
The nearest record was within 4 KiB in 26 files (81.3%), 8 KiB in 27, and 256 KiB in 31.
Extending that sample to 1 MiB found no additional matching file.
These are sample hit rates, not a guarantee for other machines or future logs.

A later sample during implementation also matched 31 of 32 files.
Adaptive reads consumed 217,575 bytes; fixed reads of those same files would consume 7,878,359 bytes.
Five query runs before and after the change had median durations of about 493 ms and 71 ms.
Live logs, filesystem caches, and machine load can change these timings.
The 256 KiB value remains a safety limit; the sample supports a small initial read, not universal coverage.
