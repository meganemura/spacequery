# 🪐 spacequery

[English](README.md)

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
spacequery work
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
jobs directory が無いときは空の答えである。`runtag` を有効にしたとき、`spacequery doctor` はその欠如を答えありと報告し、directory を読めないときや job file が parse できないときは失敗と報告する。無効のときは doctor は `runtag` を読み込まず `disabled_providers` に載せる。

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
