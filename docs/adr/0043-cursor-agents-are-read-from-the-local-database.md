# 0043. Cursor agents are read from the local database.

Date: 2026-09-23

Status: accepted

## Context

Cursor agent conversations are stored in the IDE's state database, not as herdr panes.
The sidebar index is the `composer.composerHeaders` item, or the optional `composerHeaders` table when that table has a `composerId` column.
Cursor 2.x keeps the same list in each workspace database under `composer.composerData`.
Model, status, and git worktree live on one document keyed `composerData:<id>`.
Message bubbles are the conversation history.
The cloud agent list needs a credential. `agent ls` is an interactive resume screen, not an inventory.

## Decision

The cursor provider reads `state.vscdb` and starts no process.
On macOS the file is `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`.
On other platforms it is `~/.config/Cursor/User/globalStorage/state.vscdb`.
The database is opened read-only and is never written.
The index is the `composerHeaders` table when it exists and returns rows, otherwise the `composer.composerHeaders` item.
The table's `value` blob is the header document. Its title and workspace count even when that blob omits `composerId`, because the id is the table column.
When that index is empty, the newest 64 workspace databases supply `composer.composerData`, and a sibling `workspace.json` supplies the folder.
The call keeps the newest 32 distinct composer ids and reads only those `composerData:` documents.
`model` is `modelConfig.modelName`.
`root` is the git toplevel of the worktree path when that path is present, otherwise of the workspace path.
A missing database is an empty table and a provider row with `ok` 1.
An index that does not parse is `ok` 0.
One composer document that does not parse leaves that row's model null.
Bubbles are not read.
Cloud agents and `agent ls` are out of scope.
The provider is on by default, the same way sessions are: a machine without Cursor still answers.
The named query `cursor-agents` stays off the curated help list.

## Consequences

No credential and no child process.
A model recorded only on a bubble stays null.
A workspace-only install has no global `composerData` documents, so model and branch stay null while the index still names the conversation.
This machine had no Cursor database. A fixture of 32 composer documents, each with a model and a worktree path, was read in about 2 ms.
