# 0037: Session metadata comes from local records

## Context

Session queries need model, effort, and title information without remote API calls.
Codex supplies model, reasoning effort, title, and name in its local threads database.
Claude supplies name and name source in its live session registry.
Claude assistant records also contain message.model, effort, and perTurnEffort.
A resumed Claude session can change cwd while its transcript remains under the original project.

## Decision

Add model, effort, per_turn_effort, and metadata_at to claude_sessions and the claude-sessions query.
Keep the source field names, with snake case for perTurnEffort.
Read these fields from one matching assistant response in the final 8 KiB.
Skip synthetic responses, sidechain responses, and records for another session ID.
metadata_at records that response's timestamp in milliseconds since the epoch.
Missing values stay null; an older response never fills a newer response's missing effort.
The values describe a recorded response, not a setting changed after that response.

Use the current cwd's project directory first.
If the transcript is missing, enumerate immediate project directories and probe only the live session's filename.
Read the tail when exactly one fallback file matches. An ambiguous fallback yields null context.
This extends ADR 0014's path lookup while retaining its content read bound and live-session boundary.

## Consequences

Both session queries expose metadata through local reads. No hooks, remote calls, or caches are required.
Large responses or tool output can push metadata outside the tail. Those calls return null metadata.
The registry name remains available independently of transcript metadata.
The fallback performs file probes proportional to project directories and sessions that need it.
