# 🪐 spacequery

[![npm version](https://img.shields.io/npm/v/spacequery)](https://www.npmjs.com/package/spacequery)

spacequery gives a coding agent one current view of a developer's machine.
An agent can already call git, GitHub, process tools, terminal sessions, and worktree tools.
Each tool shows one slice.
Before the agent edits, starts a server, opens a pull request, or takes over old work, it needs to know who and what already occupies the machine and the repository.

spacequery answers that question.
It observes existing sources of state, joins their rows in a fresh in-memory SQLite database, prints the result, and exits.
A provider is one source it observes, such as herdr, git, ghq, mise, Homebrew, gh, Docker, lsof, beads, a session record, a headsign file, or a runtag job file.
spacequery reads those sources.
It does not change them.

```sh
spacequery here
spacequery in-dir --tsv
spacequery agents-with-sessions
spacequery watch in-dir --until empty
spacequery doctor
spacequery --help
```

## Terminal Browser

`spacequery ui` opens Tables and Queries in the terminal.
Inspect columns and SQL, follow related tables and queries, then press `r` to fetch rows.
The result includes provider status and observation times.
See the [browser keys and scope rules](skills/spacequery/references/ui.md).

## A First Use

Run this before work starts in a repository:

```sh
spacequery here
```

`here` is a report about one repository.
It shows other agents in the repository, the current git state, linked worktrees, the branch pull request, listening ports, local processes, Docker containers and ports, mise tools, open beads issues, and headsign workflow state.
The agent can then choose a safer next action:

- wait, with `spacequery watch in-dir --until empty`, when another agent already works in the repository
- reuse an idle worktree, or avoid a worktree that is already occupied
- notice dirty files before it edits or reviews
- avoid a port that already has a local server
- see a container or Docker-published port tied to the repository
- see a missing tool for this repository before it runs a check
- read open issues and workflow state before it continues work
- see failing pull request checks before it asks to merge

Queries that list agents exclude the caller by default.
For an agent inside a pane, `spacequery here` and `spacequery in-dir` read as "who else is here?"
That makes the result useful as a gate:

```sh
spacequery here --expect-empty --strict
```

For `here`, `--expect-empty` checks the `agents` section.
`--strict` fails if any provider did not answer.

## Why It Fits Agents

Agents need structured facts more than a screen.
spacequery returns JSON by default, so an agent can read rows, sections, provider status, and the resolved caller identity without parsing terminal text.
TSV is available when a human wants a compact table.

Agents often need a question that crosses tools.
git can say a checkout is dirty.
herdr can say which pane runs an agent.
gh can say a branch has failing checks.
spacequery joins those facts by repository root, so `agents-in-dirty-repos`, `failing-checks-with-agents`, `idle-worktrees`, and `servers-with-agents` are direct queries.

Agents should pay only for the question they ask.
A query loads the providers for the tables it reads.
`tools-in-dir` does not call GitHub.
`review-requests` does not run `git status`.
Ad hoc SQL and user query files use the same provider resolution.

Agents need to know when observation is incomplete.
Every call starts from an empty database, so there is no stale cache.
The JSON envelope includes `providers`, with `source`, `ok`, `observed_at`, `ms`, and `error` for each provider that ran.
If a provider fails, its tables are empty and its provider row says so.
Empty rows beside a failed provider mean "unknown", not "none".
When a result looks incomplete, `spacequery doctor` checks which built-in providers answered.
The skill explains how to read that report.

Reports add section-level trust data.
`here` returns `sections`, `section_status`, and report-level `providers`.
Each `section_status` entry says which direct providers the section reads and whether they answered.
Read the report-level `providers` too when `--scope agents` or `--scope all` widens the call, because root enumeration can depend on another provider.

Agents also need instructions at the moment they act.
The agent workflow lives in [skills/spacequery/SKILL.md](skills/spacequery/SKILL.md).
The README is the door: it explains what spacequery is, why it helps, how to install it, and where to read next.

## Requirements

spacequery requires Node 24.10 or later.
The build and ad hoc SQL resolver use `setAuthorizer` from `node:sqlite`.

Put the tools you want spacequery to observe on `PATH`: `herdr`, `git`, `ghq`, `mise`, `brew`, `gh` logged in, `docker`, `lsof`, and `bd`.
Headsign rows come from files and need no command on `PATH`.
Session rows come from records under `~/.claude` and `~/.codex`.
Joining a pane to a session needs herdr's Claude Code and Codex integrations.
runtag rows come from `$XDG_DATA_HOME/runtag/jobs/` (or `~/.local/share/runtag/jobs/`).
[runtag](https://github.com/meganemura/runtag) ([npm](https://www.npmjs.com/package/runtag)) records those jobs. spacequery reads the files.

## Waiting on a runtag job

[runtag](https://github.com/meganemura/runtag) ([npm](https://www.npmjs.com/package/runtag)) records a command and writes the job file.
Install it with `npm i -g runtag`.
spacequery reads that file and watches.

```sh
runtag exec --detach --cwd <repo> -- <cmd>...
spacequery watch runs-in-dir --root <repo> --until status=exited
runtag status <id>
```

`runs-in-dir` lists jobs whose `repo_root` or `cwd` is `<repo>` or inside it.
`status` is `running` or `exited`.
A job whose file still says `running` after its supervisor pid has died stays `running`, with `orphan` 1 and `exit_code` null.
That row does not satisfy `--until status=exited`.
`runtag status <id>` is where the exit code is read after the watch exits 0.
A missing jobs directory is an empty answer. `spacequery doctor` reports `runtag` as answered in that case, and as failed when the jobs directory cannot be read or a job file does not parse.

A missing provider does not make a false row.
It gives an empty table and a `providers` row that reports the failure.

`repository-versions` reads root files and declared npm workspaces from one repository.
It does not run Git, mise, a language, or a package manager.
Its lock rows are file evidence and do not prove installed versions.
`dependency-report` compares direct npm requests across active repository roots.
Use `--scope all` to include ghq roots.
The report includes source coverage and unresolved evidence from the same snapshot.

## Install

```sh
npm install -g spacequery
```

The package is published on npm as `spacequery`.

From a checkout:

```sh
npm install
npm link
spacequery --help
```

Without a link, `node cli.ts <query>` works from the checkout.

Give the skill to agents on this machine:

```sh
gh skill install meganemura/spacequery spacequery --scope user --agent claude-code
gh skill install meganemura/spacequery spacequery --scope user --agent codex
```

## Read Next

| Need | Read |
| --- | --- |
| The workflow an agent follows before it acts | [skills/spacequery/SKILL.md](skills/spacequery/SKILL.md) |
| Query names, parameters, report sections, and columns | [queries.md](skills/spacequery/references/queries.md) |
| JSON envelopes, `providers`, `section_status`, flags, `me`, and exit codes | [output.md](skills/spacequery/references/output.md) |
| Exact provider JSON names and state sources | [providers.md](skills/spacequery/references/providers.md) |
| Provider tables for ad hoc SQL or user queries | [tables.md](skills/spacequery/references/tables.md) |
| User query files under `~/.config/spacequery/queries/` | [user-queries.md](skills/spacequery/references/user-queries.md) |

## Design

The design records are in [docs/](docs/README.md).
They explain the fresh database, read-only behavior, provider freshness, selective loading, call log, Docker observation, and report model.

## License

MIT

---

## Japanese

spacequery は、コーディングエージェントに開発者の機械 1 台の現在の見取り図を渡す。
エージェントは git、GitHub、プロセス、terminal session、worktree の道具をすでに呼べる。
しかし、それぞれの道具が見せるのは一部分である。
編集する前、server を起動する前、pull request を開く前、止まった作業を引き継ぐ前に、エージェントは機械とリポジトリを誰が何に使っているかを知る必要がある。

spacequery はその問いに答える。
既存の状態源を観測し、その行を新しい in-memory SQLite database で結合し、結果を印字して終了する。
**provider** は spacequery が観測する状態源である。
たとえば herdr、git、ghq、mise、gh、Docker、lsof、beads、session の記録、headsign の file、runtag の job file が provider になる。
spacequery は provider を読む。
provider の状態は変えない。

```sh
spacequery here
spacequery in-dir --tsv
spacequery agents-with-sessions
spacequery watch in-dir --until empty
spacequery doctor
spacequery --help
```

## 最初の使い方

リポジトリで作業を始める前に、この command を実行する。

```sh
spacequery here
```

`here` は 1 つのリポジトリについての report である。
同じリポジトリにいる他のエージェント、現在の git state、linked worktree、branch の pull request、listening port、local process、Docker container と port、mise tool、open beads issue、headsign workflow state を示す。
エージェントはその結果から次の行動を選べる。

- 他のエージェントが同じリポジトリで作業していれば待つ。
- 誰もいない worktree を使うか、使用中の worktree を避ける。
- 編集や review の前に dirty file に気付く。
- local server が使っている port を避ける。
- リポジトリに結び付いた container や Docker-published port を見る。
- check を走らせる前に、このリポジトリの missing tool を見る。
- 作業を続ける前に open issue と workflow state を読む。
- merge を求める前に pull request の failing check を見る。

エージェントを列挙する query は、既定で呼び手自身を除く。
pane の中にいるエージェントにとって、`spacequery here` と `spacequery in-dir` は「他に誰がここにいるか」という意味になる。
この性質により、結果を gate として使える。

```sh
spacequery here --expect-empty --strict
```

`here` では、`--expect-empty` は `agents` section を検査する。
`--strict` は、答えなかった provider があれば失敗する。

## エージェントに向いている理由

エージェントには画面より構造化された事実が要る。
spacequery は既定で JSON を返すので、エージェントは terminal text を parse せずに rows、sections、provider status、解決済みの caller identity を読める。
人間が小さな表で見たいときは TSV も使える。

エージェントは、道具をまたぐ問いを必要とすることが多い。
git は checkout が dirty かを言える。
herdr はどの pane でエージェントが動いているかを言える。
gh は branch の check が落ちているかを言える。
spacequery はそれらの事実を repository root で結合するので、`agents-in-dirty-repos`、`failing-checks-with-agents`、`idle-worktrees`、`servers-with-agents` は直接呼べる query になる。

エージェントは、問いに必要な分だけ払えばよい。
query が読む table から、読み込む provider が決まる。
`tools-in-dir` は GitHub を呼ばない。
`review-requests` は `git status` を走らせない。
ad hoc SQL と user query file も同じ provider 解決を使う。

エージェントには、観測が不完全だったかどうかも必要である。
呼び出しごとに空の database から始めるので、古い cache はない。
JSON envelope は、実行した provider ごとに `source`、`ok`、`observed_at`、`ms`、`error` を持つ `providers` を含む。
provider が失敗した場合、その table は空になり、provider row が失敗を示す。
失敗した provider の隣にある空の rows は「ない」ではなく「分からない」と読む。
結果が不完全に見えるときは、`spacequery doctor` が組み込み provider の答えを点検する。
report の読み方は skill にある。

report は section ごとの信頼情報も返す。
`here` は `sections`、`section_status`、report level の `providers` を返す。
それぞれの `section_status` は、その section が直接読む provider と、それらが答えたかを示す。
`--scope agents` や `--scope all` で範囲を広げたときは、report level の `providers` も読む。
root の列挙が別の provider に依存することがあるためである。

エージェントには、動く瞬間に読む手順も要る。
その workflow は [skills/spacequery/SKILL.md](skills/spacequery/SKILL.md) にある。
README は入口である。
spacequery が何で、なぜ役に立ち、どう導入し、次に何を読むかを説明する。

## 必要なもの

spacequery には Node 24.10 以降が要る。
build と ad hoc SQL の解決が `node:sqlite` の `setAuthorizer` を使うためである。

spacequery に観測させたい道具を `PATH` に置く。
対象は `herdr`、`git`、`ghq`、`mise`、ログイン済みの `gh`、`docker`、`lsof`、`bd` である。
headsign rows は file から来るので、`PATH` 上の command は要らない。
session rows は `~/.claude` と `~/.codex` の記録から来る。
pane と session の結合には、herdr の Claude Code integration と Codex integration が要る。
runtag rows は `$XDG_DATA_HOME/runtag/jobs/`（未設定なら `~/.local/share/runtag/jobs/`）の file から来る。
[runtag](https://github.com/meganemura/runtag)（[npm](https://www.npmjs.com/package/runtag)）がその job を記録する。spacequery はその file を読む。

## runtag job を待つ

[runtag](https://github.com/meganemura/runtag)（[npm](https://www.npmjs.com/package/runtag)）が command を記録し、job file を書く。
導入は `npm i -g runtag` である。
spacequery はその file を読み、待つ。

```sh
runtag exec --detach --cwd <repo> -- <cmd>...
spacequery watch runs-in-dir --root <repo> --until status=exited
runtag status <id>
```

`runs-in-dir` は、`repo_root` または `cwd` が `<repo>` そのものか、その中にある job を返す。
`status` は `running` か `exited` である。
file が `running` のまま supervisor pid が死んでいる job は `running` のまま残る。`orphan` は 1、`exit_code` は null である。
その row は `--until status=exited` を満たさない。
watch が 0 で終わったあと、`exit_code` は `runtag status <id>` で読む。
jobs directory が無いときは空の答えである。`spacequery doctor` はそのとき `runtag` を答えありと報告し、directory を読めないときや job file が parse できないときは失敗と報告する。

provider が無いとき、spacequery は偽の行を作らない。
空の table と、失敗を示す `providers` row を返す。

## 導入

```sh
npm install -g spacequery
```

`spacequery` は npm に公開されている。

checkout から導入するときは次のとおり。

```sh
npm install
npm link
spacequery --help
```

link しない場合も、checkout で `node cli.ts <query>` が動く。

この機械のエージェントに skill を渡す。

```sh
gh skill install meganemura/spacequery spacequery --scope user --agent claude-code
gh skill install meganemura/spacequery spacequery --scope user --agent codex
```

## 次に読むもの

| 必要なこと | 読むもの |
| --- | --- |
| エージェントが動く前に従う workflow | [skills/spacequery/SKILL.md](skills/spacequery/SKILL.md) |
| query name、parameter、report section、column | [queries.md](skills/spacequery/references/queries.md) |
| JSON envelope、`providers`、`section_status`、flag、`me`、exit code | [output.md](skills/spacequery/references/output.md) |
| provider の JSON name と状態源 | [providers.md](skills/spacequery/references/providers.md) |
| ad hoc SQL や user query のための provider table | [tables.md](skills/spacequery/references/tables.md) |
| `~/.config/spacequery/queries/` の user query file | [user-queries.md](skills/spacequery/references/user-queries.md) |

## 設計

設計の記録は [docs/](docs/README.md) にある。
fresh database、read-only behavior、provider freshness、selective loading、call log、Docker observation、report model を説明している。

## ライセンス

MIT
