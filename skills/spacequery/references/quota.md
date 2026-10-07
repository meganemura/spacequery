# Pick an agent by roster and quota

This recipe answers two questions before a caller sends work to a coding agent.
Which agents can run now? Which subscription has quota left?
spacequery observes the answers. The caller owns the policy that picks an agent.

## Environment

A scheduler, a launchd job, or a hook often starts with a smaller environment than a login shell.
The providers in this recipe need these commands and variables:

| Need | Used by | Usual place |
| --- | --- | --- |
| `claude` | `claude_usage` | `~/.local/bin` (the native Claude Code installer) or the bin directory of the npm global packages |
| `herdr` | `agents`, `working`, `agents-with-sessions` | the directory where you installed herdr |
| `git` | every provider that finds a repository root | `/usr/bin` or Homebrew |
| `ps`, `lsof` | `sessions` (all session queries) | `/bin`, `/usr/sbin` |
| `node` and `spacequery` | the call itself | the bin directory of the Node.js install |
| `HOME` | every provider | set by the login session |
| `USER` | `claude_usage` on macOS | set by the login session |

On macOS the `claude` CLI reads its subscription sign-in from the keychain.
If `USER` is not set, the CLI still exits 0, but it prints cost totals and no quota windows.
`claude_usage` then fails with "no subscription quota windows".

Check the environment before the first dispatch:

```sh
command -v spacequery claude herdr git lsof
spacequery doctor
```

`doctor` exits 0 even when a provider fails. Read its `providers` rows, or use the `--strict` calls below as the gate.

## Commands

Run every call with `--strict`. Without it, a provider that fails gives an empty `rows` array and exit 0.
With it, the call exits 4 after it prints the rows when any provider did not answer.

Roster:

```sh
spacequery agents-with-sessions --strict --json   # herdr panes with their Claude or Codex session and model
spacequery working --strict --json                # panes that work now
spacequery idle-sessions --strict --json          # sessions that wait for input
spacequery cursor-agents --strict --json          # recent local Cursor conversations
```

`agents`, `claude-sessions`, and `codex-sessions` give the same roster in other shapes. Their columns are in [queries.md](queries.md).

Quota:

```sh
spacequery claude-usage --strict --json
spacequery codex-usage --strict --json
```

`claude-usage` starts `claude -p /usage`, which contacts the Claude service. It takes about 10 seconds.
`codex-usage` reads local Codex logs only. It takes less than one second.
The two calls are independent. Run them in parallel when the delay matters.

## Exit codes

| Exit | Meaning | Action |
| --- | --- | --- |
| 0 | Every provider answered. | Read `rows`. |
| 4 | A provider did not answer. `providers[].error` says why. | Treat the data from that provider as unknown. Do not read empty `rows` as "no agents" or "no quota". |
| other | The call failed. | Treat all data as unknown. |

Common provider errors:

| `error` | Cause |
| --- | --- |
| `spawn claude ENOENT`, `spawn herdr ENOENT`, `spawn lsof ENOENT` | The command is not on `PATH`. Fix `PATH`. |
| `Claude usage output has no subscription quota windows; ...` | The CLI is signed out, uses API billing, or cannot read its sign-in. On macOS, set `USER`. |
| `Claude did not return a successful local usage command` | The CLI changed its output, or the command failed. |

## Read the quota rows

Each row is one quota window. `used_percent` is 0 to 100. The free part of a window is `100 - used_percent`.

| State | Rule |
| --- | --- |
| Exhausted | Any window that applies to the dispatch has `used_percent` 100 or more. |
| Headroom | Every window that applies has `used_percent` below 100. The caller picks its own margin, for example below 90. |
| Unknown | The provider failed (exit 4), the query returned no rows, or a window that applies is missing. |

Unknown is not headroom. Make a policy decision for it, or ask a human.

### Claude rows

`claude-usage` gives one row per line of the `/usage` screen:

| `limit_id` | `window_minutes` | Applies to |
| --- | --- | --- |
| `Current session` | 300 | Every dispatch. A full session window blocks work even when the week has room. |
| `Current week (all models)` | 10080 | Every dispatch. |
| `Current week (<model>)` | 10080 | Only a dispatch that uses that model. |

`resets_at` is always null for Claude. `resets_text` keeps the reset time as the CLI printed it, in the CLI's time zone.
`recorded_at` is the time of the call, so Claude rows are current.

### Codex rows

`codex-usage` gives one row per `limit_id` and `window_minutes` in the newest Codex log records on this machine.
A row with `window_minutes` 300 is the 5-hour window. A row with 10080 is the week window. A log can carry only one of the two.

Codex rows are observations from the past:

- `now - recorded_at` is the age of the observation. Use from other machines or from the web does not show in it.
- If `resets_at` is before now, the window reset after the observation. The old `used_percent` no longer applies. Treat the window as headroom of unknown size.
- No rows with exit 0 means no Codex log on this machine has a quota record. Treat Codex quota as unknown.
- The rows do not prove which account is signed in now.

### Cursor

spacequery has no source for Cursor quota. `cursor-agents` lists local conversations only.
Treat Cursor quota as unknown, and ask a human before a dispatch depends on it.

## Example policy

The caller writes the policy. This example prefers one subscription while its week has room:

1. If `claude-usage` exits 0, and both `Current session` and `Current week (all models)` are below the margin, use Claude.
2. Otherwise, if `codex-usage` exits 0 with rows, and every Codex window that applies is below the margin or has reset, use Codex.
3. Otherwise, the state is exhausted or unknown. Wait for the earliest reset, or ask a human.

Keep the result of each call in memory for that dispatch only. spacequery holds no cache, and a stored copy goes stale at the next dispatch.
