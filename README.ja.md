# Tmux Opener

*[English](README.md)*

VS Code のセカンダリサイドバーで動く tmux ターミナルです。ワークスペースフォルダー名の
セッションを開き、既にあればアタッチします。追加のセッションもいくつでも持てます。

他の tmux 拡張機能と違い、VS Code の統合ターミナルを包むものではありません。このビュー
自体が独立したターミナルなので、デタッチしても、ウィンドウを再読み込みしても、tmux の
セッションとウィンドウ配置はそのまま残ります。

## 必要なもの

`tmux` がインストールされ、`PATH` から見えること。

## 使い方

セカンダリサイドバー（右側のパネル）から **Tmux** ビューを開きます。

- 上部のツールバーに、現在のセッション名、セッションを作る `+ ⌄` ボタン、そして
  通知音の切り替え（`tmuxOpener.notifySound`）・セッション一覧の表示切り替え・
  現在のセッションの終了・設定を開くボタンが並びます。
- 右側のセッション一覧は VS Code のターミナルタブと同じように使えます。クリックで
  切り替え、**×**（またはマウス中ボタン）で終了、端をドラッグで幅を変更できます。
- アタッチできるセッションは常に1つです。切り替えると前のセッションからはデタッチ
  されますが、セッション自体は動き続けます。
- ビューを開くと一番上のセッションにアタッチします。セッションを終了したとき、あるいは
  `exit` で抜けたときは、次のセッションに移ります。
- `Ctrl`/`Cmd`+`F` で検索バーが開きます。出力中の URL はクリックできます。
- tmux のコピーモードからのコピー（OSC 52 経由）と、`Shift`+ドラッグまたは
  `Option`+ドラッグで作った端末側の選択の両方をクリップボードに送ります。
  `Ctrl`/`Cmd`+`C` は選択があるときだけコピーし、無ければ `SIGINT` として素通しします。

同じ操作はコマンドパレットの **Tmux:** からも実行できます。

## プロファイル

`+` は通常のシェルでセッションを作ります。隣のシェブロンを押すと**プロファイル**の
一覧が出ます。プロファイルはコマンドをセッションのプロセスそのものとして起動するので、
そのコマンドを終了するとセッションも終わります。

**Claude Code**、**Codex**、**Gemini**、**Cursor**、**Grok** のプロファイルが最初から
入っています。`tmuxOpener.profiles` はそれらに上書きされる形で統合されます。キーに
`null` を指定すると組み込みを非表示にでき、新しいキーを足せば独自のプロファイルを
定義できます。

```jsonc
"tmuxOpener.profiles": {
  "Gemini": null,                                    // 組み込みを非表示にする
  "Claude Code": { "command": "claude --continue" }, // 組み込みを上書きする
  "Build": { "command": "npm run watch", "sessionSuffix": "build" }
}
```

セッション名はワークスペースフォルダー名から作られます。`myrepo`、`myrepo-2`、
`myrepo-3`… という具合です。プロファイルのセッションは専用の名前
（`myrepo-claude-code`）になるので、この連番を消費しません。

コマンドが `PATH` に見つからないプロファイルには印が付きますが、選択はできます。
tmux が起動するログインシェルの `PATH` では見つかることがあるためです。

## 通知

このビューは各セッションのターミナルベル（BEL、`\a`）を監視し、鳴らしたセッション名を
示す VS Code のネイティブ通知を出します。バックグラウンドのセッションで AI CLI を
動かしたまま、プロンプト待ちで止まったときや処理が終わったときに気づけます。通知の
**開く**ボタンでそのセッションに移動できます。既定で有効です。`tmuxOpener.notifyOnBell`
を `false` にすると無効化できます。

通知と同時に音が鳴るので、画面から離れていても気づけます。音は WebView（常にローカル側で
動作）で合成するため、セッションがリモートホスト上にあっても（Remote-SSH）手元のマシンで
鳴ります。既定で有効で、`tmuxOpener.notifySound` を `false` にすると無音にできます。
`tmuxOpener.notifySoundPreset` で 5 種のプリセットから選べます — `classic`（クラシック
着信音・既定）、`siren`（サイレン）、`sos`（SOSパルス）、`cascade`（下降チャイム）、
`trill`（高速トリル）。設定を変えてベルを鳴らすと試聴できます。

ブラウザは、ウィンドウが一度も操作されていないあいだ音の再生を許可しません。そのため
リロード直後にまだ触っていないウィンドウでベルが鳴ると無音になります。このときは通知に
**音を鳴らす**ボタンが付きます。押せば聞き逃したベルがその場で鳴り、以降のベルは自動で
鳴るようになります。

これが働くには、セッション内のツールが注意を促すときにベルを鳴らす必要があります。多くの
AI CLI は鳴らせますが、既定では鳴らないことがあります。

### BEL の発生源を 1 つ選ぶ（足し算にはならない）

Claude Code では 3 通りの構成があり、これらは**加算できる追加機能ではなく、排他的な
選択肢**です。後述の参考フックスクリプトは、Claude Code 内蔵のベルに*上乗せ*するのでは
なく、BEL の発生源を**置き換え**ます。鳴らすものは常に 1 つだけであるべきで、どれを選ぶかが
`~/.claude/settings.json` の `preferredNotifChannel` を決めます。

| 構成 | BEL を鳴らすのは | `preferredNotifChannel` |
| --- | --- | --- |
| **A. スクリプト無し**（既定） | Claude Code 本体 | `"terminal_bell"` — **必要**（他に鳴らすものが無い） |
| **B. ベル理由サウンド**（「入力待ち」を別の音で） | `tmux-opener-bell.sh`（`Stop` / `Notification` フックから） | **非ベル**チャンネル（例: `"notifications_disabled"`） |
| **C. サブエージェント対応 idle ゲート**（*本当に*アイドルのときだけ鳴らす） | `subagent-idle-gate.sh` → `tmux-opener-bell.sh` | **非ベル**チャンネル（例: `"notifications_disabled"`） |

C は B の上に積む構成です（B の `Notification` → ask の配線をそのまま残し、*完了*のベル
だけをゲート経由にする）。積めないのは **A と B / C の併用**です — スクリプトがベルを
鳴らしているのに `terminal_bell` を有効なままにするのが、この表が防ごうとしている
間違いです。

**A — スクリプト無し。** Claude Code 自身がベルを鳴らしますが、そう頼んだときだけです。
`~/.claude/settings.json` に `"preferredNotifChannel": "terminal_bell"` を追加するか、
セッション内で `/config preferredNotifChannel=terminal_bell` を実行してください
（`claude config` という CLI サブコマンドは存在しません）。これで設定は完了で、以降は
すべて任意です。

**B と C — `terminal_bell` は切り戻す。** フックスクリプトが BEL を鳴らすようになると、
Claude Code の内蔵ベルは同じイベントに対する**第二の発生源**になり、両者が競合します。

- 拡張機能は近接した 2 つの BEL を 1 つの通知に畳みます（セッション単位の 5 秒
  クールダウン）。したがって二重に鳴ることはありません — しかしそれは、**先に着いた
  ほうの BEL しか判定されない**ということでもあります。VS Code は一度出した通知を
  後から書き換えられません。
- フックは鳴らす**前に**理由ファイル（`stop` / `ask`）を書きます。Claude Code の内蔵
  ベルは何も書きません。ただし、それだけでは多くの場合まだ壊れません。判定の時点で
  **直近 30 秒以内**に書かれた理由ファイルがディスクにあれば、拡張機能は **250ms** 待って
  読み直します（後述の待ち）。内蔵ベルに数ミリ秒遅れたフックのファイルもこの間に着くので、
  正しい音が鳴ります。
- **しかしこの待ちは、最初に見えるものが既にあったときにしか働きません。** どの理由
  ファイルも新鮮でないとき — 30 秒間なにも書かれていない状態で、これは長いツール実行の
  あとに承認プロンプトが出る場面そのものです — 内蔵ベルはその場で、理由の付いていない
  ベルとして判定されます。完了プリセットと中立の通知文です。フック自身の BEL は
  `ask` ファイルを書いた上で届きますが、クールダウンに落ちて捨てられ、判定を訂正する
  ものは何もありません。B の存在理由である「入力待ち」の音は、まさに**席を外していた
  ときの承認プロンプト**で失われます。
- ゲート（C）では、内蔵ベルは音を間違えるおそれがあるどころではありません。ゲートを
  完全に迂回して、サブエージェントがまだ動いている最中に通知します — ゲートが防ごうと
  している当のものです。こちらは競合すら要りません。内蔵ベルはゲートを参照しないからです。

`"notifications_disabled"`（または他の非ベルチャンネル）に設定し、BEL の発生源を
スクリプト一本に絞ってください。切っても失うものはありません — フックは完了と入力待ちの
両方の理由で鳴らします。

他の CLI にはそれぞれの設定があります（ここのスクリプトは Claude Code 専用です）。

- **Gemini CLI** — `enableTerminalBell` を有効化（設定 → アクセシビリティ。既定はオフ）
- **Codex CLI** — Linux では完了時に既定でベルが鳴ることがあります（環境依存）
- **aider** — `aider --notifications-command 'printf "\a"'` で通知をベルに寄せられます

BEL は AI 専用の信号ではないため、他の要因でも鳴ります。シェルの補完ベル、vim の
エラービープ、`tput bel` なども同じベルを鳴らし、それぞれで通知が出ます。うるさく感じる
場合は、シェルの補完ベルを切る（readline 系のシェルなら `~/.inputrc` に
`set bell-style none`）か、tmux の `bell-action`（`man tmux`）でどのベルに反応するかを
調整してください。

### 参考スクリプトのインストール

以下の 3 つの任意機能 — **statusline ブリッジ**・**ベル理由ごとの音**・
**サブエージェント対応アイドルゲート** — は、このリポジトリの
[`claude/`](claude/) にある小さなスクリプトが動かします。`~/.claude` へ
そのままの構造でインストールします:

```
claude/statusline.sh                ->  ~/.claude/statusline.sh
claude/hooks/session-state.sh       ->  ~/.claude/hooks/session-state.sh
claude/hooks/subagent-idle-gate.sh  ->  ~/.claude/hooks/subagent-idle-gate.sh
claude/hooks/tmux-opener-bell.sh    ->  ~/.claude/hooks/tmux-opener-bell.sh
```

いずれも `PATH` に `jq` が必要です。どれも任意ですが、**すべてが「加算」ではありません**。
純粋な追加機能は **statusline ブリッジ**だけです — これはベルを鳴らさず、通知に
コンテキスト率とコストを足すだけなので、上記のどの構成にも積めます。一方 2 本の
**ベルフック**（`tmux-opener-bell.sh`・`subagent-idle-gate.sh`）は BEL の発生源を
引き受けます。構成 B / C で Claude Code 側の `terminal_bell` を切る必要があるのは
このためです。何も入れなければ構成 A です — ベルは鳴り通知も出ますが、それは
`terminal_bell` が鳴らしているからです。**この配置、特にフック 2 本を同じ
ディレクトリに置くことは崩さないでください**: アイドルゲートはベルスクリプトを
自分自身からの相対で解決します。

**clone する場合**（スクリプトの正本はリポジトリ側です）:

```bash
git clone https://github.com/ShirokumaLibrary/tmux-opener.git
cd tmux-opener
npm run claude:install
```

インストーラは上書きするファイルを `~/.claude/backup-<タイムスタンプ>/` へ退避し、
実行ビットを立て、貼り付けるべき `settings.json` の断片を**表示します** —
`settings.json` 自体は決して書き換えません。`npm run claude:install -- --dry-run`
は何をするかを表示するだけで、一切書き込みません（`--` が必要です。npm は手前に
置かれたフラグを食べてしまいます）。

インストール先が**シンボリックリンク**のとき（dotfiles リポジトリで管理している
場合など）、インストーラはリンクを貫通して書き込まず、停止して知らせます。リンクへ
コピーするとリンク先（`~/.claude` の外にある実ファイル）を上書きしてしまい、リンク
だけを退避したバックアップからは復旧できないためです。`--force` で続行でき、その
場合はリンク先の**中身**を先に退避してから、リンクを実ファイルに置き換えます。

**clone しない場合** — Marketplace から拡張機能を入れた場合、スクリプトは VSIX に
含まれません。同じインストーラがリポジトリから直接スクリプトを取得できます。
インストーラを取得し、公開された `claude/` スクリプトを指して実行してください。

```bash
curl -fsSL https://raw.githubusercontent.com/ShirokumaLibrary/tmux-opener/main/scripts/install-claude.sh -o install-claude.sh
bash install-claude.sh --src https://raw.githubusercontent.com/ShirokumaLibrary/tmux-opener/main/claude
```

スクリプトを一時ディレクトリへ取得し、clone の場合とまったく同じように
インストールします — 同じバックアップ、シンボリックリンク／レガシー配置に対する
同じ拒否、同じ実行ビット、そして貼り付け用の `settings.json` 断片の表示（決して
書き換えません）。`--dry-run` を付ければ何も書き込まずに計画だけ表示します。
[`gh` CLI](https://cli.github.com/) を使いたい場合 — private ミラーや
`raw.githubusercontent.com` が塞がれている環境など — は、そちらで取得します:

```bash
gh api repos/ShirokumaLibrary/tmux-opener/contents/scripts/install-claude.sh -H "Accept: application/vnd.github.raw" > install-claude.sh
bash install-claude.sh --src gh:ShirokumaLibrary/tmux-opener/claude
```

必要な `~/.claude/settings.json` の設定は、以下の各機能の節に載せてあります。ベルを
鳴らす 2 つについては、その構成が要求する `preferredNotifChannel` も各節で再掲します。
使いたいものだけ有効にしてください。

### statusline ブリッジ（通知にコンテキスト率とコストを出す）

通知には、そのセッションが**どれだけコンテキストを使い、いくらかかっているか**も
出せます（例: `セッション「myproject」に注意が必要です。 (コンテキスト 82%、コスト $0.45)`）。
拡張機能は Claude Code の内部 JSON を直接見られませんが、statusline スクリプトは
その JSON を標準入力で受け取れます。そこで参考の `statusline.sh` が抜粋を
`${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/status-<セッション>.json` へ書き出し、
拡張機能がベル発火時に（30 秒以内の新しいものだけ）読み取ります。完全に opt-in で、
スクリプトを入れなければ挙動は変わりません。

このパスは書き手・読み手のどちらも `XDG_CACHE_HOME`（未設定なら `$HOME/.cache`）から
組み立てます。書き手（スクリプト）は対話シェルの環境、読み手（拡張機能）は VS Code を
起動した環境を使うため、**両者の `XDG_CACHE_HOME` は一致している必要があります。**
`~/.bashrc` や `~/.zshrc` など対話シェルだけで `XDG_CACHE_HOME` を設定していると、
書き手は `$XDG_CACHE_HOME` へ、読み手は `$HOME/.cache` を読むので、ファイルを取り逃して
静かに効かなくなります（通知から追記が消えるだけで、誤った情報は出ません）。両側とも
`XDG_CACHE_HOME` を未設定のままにする（多くの場合これで一致します）か、VS Code を同じ値で
起動してください。

有効にするには、スクリプトをインストールし（上記）、`~/.claude/settings.json` に
statusline を登録します:

```json
"statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }
```

statusline には**実行中 / アイドルのインジケーター**も出ます — 生成中は回転する
スピナー（`⠋ working`）、終われば `✅ idle`。**出るか出ないかを決めるのはフックの状態**で、
時計が決めるのは*どのコマか*だけです。つまりコマが進むことが示すのは
「**この statusline がまだ描き直されている**」という一点だけです — 生きた表示と、
止まった画面（デタッチされたペイン・固まった端末）は見分けられますが、フックの
wedge は見分けられません（フックが `running` を書いたまま固まっても statusline は
呼ばれ続け、スピナーは回り続けます）。この状態は statusline 自身の標準入力からは
分からないため、2 つのフックが駆動するもう 1 本のスクリプト
[`claude/hooks/session-state.sh`](claude/hooks/session-state.sh) から受け取ります。
これは任意で、入れなくてもインジケーターが `○`（不明）のままになるだけで、他の表示は
問題なく動きます。有効にするには、`~/.claude/settings.json` にフックと
`refreshInterval` を登録します:

```json
"statusLine": {
  "type": "command",
  "command": "~/.claude/statusline.sh",
  "refreshInterval": 1
},
"hooks": {
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/session-state.sh running" } ] }
  ],
  "Stop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/session-state.sh stopped" } ] }
  ]
}
```

インジケーターが即座に切り替わるのは `refreshInterval` のおかげです。`UserPromptSubmit`
は statusline の更新契機ではない（更新契機はアシスタントの各メッセージ後・`/compact` 後・
権限モード変更時・vim モード切替時）ため、タイマーが無いとフックが書いた `running` は
次の更新契機まで反映されず、たいてい手遅れになります。

またこのインジケーターは、メインのターンが停止した後もサブエージェントが動いている間は
回り続けます（後述の idle ゲートと同じマーカーを読むため）。したがって
インジケーターとベルが「本当にアイドルかどうか」で食い違うことはありません。

その隣には **git のブランチと状態**も出ます — `🌿 main ↑2 ✚ …` は「upstream より 2 コミット
先行、追跡済みファイルに未コミットの変更あり、さらに未追跡ファイルもある」の意味です
（`↓` は遅れ。乖離していれば矢印が両方出ます）。取得は 1 回の
`git status --porcelain=v2 --branch` だけで、`--no-optional-locks` 付きなので、あなた自身の
git コマンドから `index.lock` を奪うことはありません。

`✚` と `…` を **1 つにまとめず 2 つに分けている**のは意図的です。取るべき行動が違う
（追跡済みの変更は commit すべき作業・未追跡ファイルはたいてい放置でよい）うえに、
意図的に未追跡のままにしているディレクトリがあるリポジトリでは、まとめた記号が常時点灯して
しまい、記号が無いのと同じになるからです。

追記だけを止めたい（通知は残す）ときは `tmuxOpener.notifyBridgeStatusline` を
`false` にします。標準入力のフィールド名（`.context_window.used_percentage`・
`.cost.total_cost_usd`）は Claude Code の statusline スキーマを想定しており、
`// empty` / `// 0` のフォールバックでフィールド欠損に耐えます。ファイルが無い・
古い・読めないときは、拡張機能は従来どおりの通知にフォールバックします。

### ベル理由サウンド（「入力待ち」を別の音で知らせる）

通知の音を、**ベルが鳴った理由に応じて変える**こともできます — ターンが*完了*
したときのプリセットと、CLI が*あなたの入力を待っている*とき（例: permission の
確認）のプリセット。音で聞き分けられるので、作業を続けてよいのか切り替えが要るのか
が分かります。statusline ブリッジと同じく完全に opt-in で、フックスクリプトを入れ
なければどのベルも通常の `tmuxOpener.notifySoundPreset` を鳴らし、挙動は変わりません。

拡張機能はベルが鳴った*理由*を知れませんが、Claude Code のフックは知っています —
`Stop` フックは完了時に、`Notification` フックはあなたに何かを求めるイベントで発火
します。参考の `tmux-opener-bell.sh` を各フックから `stop` / `ask` 引数付きで呼ぶと、
理由別ファイル（`${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/bell-<session>.<reason>.json`）
を書いてからベルを鳴らします。2 つの理由は**別ファイル**に書くので、`stop` と `ask` が
近接して着地しても互いを上書きしません（読み手が後述の規則で決着させます — 通知種別で、
無ければ mtime で。後述）。

ベルが届くと、拡張機能は両方の理由ファイルを読んで音を選びます:

- どちらも新鮮でない（**30 秒**以内でない）→ 通常の `notifySoundPreset`（フック無し
  の既定・遅延ゼロ）。
- 片方だけ新鮮 → その理由の音。
- 両方新鮮かつ互いに**3 秒**以内に書かれた（同時発火）→ ask の理由ファイルが「あなた待ち」
  の通知種別（`permission_prompt`・`agent_needs_input`・`elicitation_dialog`）を名乗るなら
  ask の音、そうでなければ **`stop` 優先**。`matcher` 配線はこの 3 種だけを ask フックに
  届けるので、そのいずれかを持つ ask は完了にこれほど近くても本物の承認待ちです。通知種別を
  記録していない ask（この欄より前のレガシーフック）は従来どおり完了に畳まれます。
- 両方新鮮だが**3 秒**より離れている → 新しい方（本当に独立した ask、あるいは — より*新しい*
  stop があるなら — 先行のプロンプトを解決した完了）。通知種別が優先するのは上記の**3 秒**の
  同時発火だけで、ここでより新しい stop を覆すことはありません。

少なくとも片方の理由ファイルが新鮮なときは、同時発火する相方の着地を **250ms** 待って
から選びます。新鮮な理由ファイルが無いベルはこの待機を完全にスキップします。

**3 秒**の決着規則があるのは、`Notification` がターンの*完了*時にも発火するからです。
1 つの完了ターンが両方のファイルを数ミリ秒差で書きうるので、この組は `stop` に寄せて
決着させる必要がありました（完了を ask の音に乗っ取らせない）。この**本物の** ask を同時
発火と見分けるため、ask フックはいまベルを鳴らした通知種別を — `Notification` の標準入力
から読んで — 理由ファイルへ記録し、読み手はその種別を**3 秒の同時発火窓の中で**信じます。
新鮮な ask が「あなた待ち」3 種のいずれか（後述の `matcher` はこの 3 種だけを通します）
を名乗れば、その mtime が完了のすぐ隣にあっても ask として鳴らします。よって、ターン完了
直後に届いた permission の確認は、いまや ask の音と "waiting for your input"（入力待ち）の
トーストで鳴ります — かつては `stop` に寄り、ターンが完了したと言い張っていた挙動です。

種別が優先するのはその**3 秒**の窓だけで、より新しい mtime の規則は覆しません。プロンプトが
とうに解決された ask — それより **3 秒より後**に*新しい* `stop` がある — は `stop` に決着し
ます。よって、同じターンの早い時点で本物のプロンプトが鳴ったというだけで、完了したターンが
「入力待ち」と誤って鳴ることはありません。

同時発火窓の中でも、**種別を判別できない** ask は従来どおり `stop` に畳まれます — 種別
フィールド以前のレガシーフックや、matcher *無し* の `Notification` 配線が完了イベントから
同時発火させた ask（その記録種別は 3 種ではなく完了型）です。よって matcher 無しのユーザー
が頼る「完了を乗っ取らせない」保護は変わりません。

有効にするには、スクリプトをインストールし（上記）、`~/.claude/settings.json` に
フックを登録します:

```json
"hooks": {
  "Stop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-bell.sh stop" } ] }
  ],
  "Notification": [
    {
      "matcher": "permission_prompt|agent_needs_input|elicitation_dialog",
      "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-bell.sh ask" } ]
    }
  ]
}
```

**これは構成 B なので、`preferredNotifChannel` は非ベルチャンネルにしてください**
（上の表を参照）。ここから先は `tmux-opener-bell.sh` が BEL の発生源です。Claude Code
内蔵の `terminal_bell` を有効なままにすると、理由の付かない第二のベルが共有クールダウンを
先に取ってしまい、ask の音が鳴らなくなることがあります。

**`matcher` は任意ではありません。** `Notification` は Claude Code の**すべての**通知
タイプで発火します（完了系も idle リマインダーも含みます）。matcher 無しで登録すると、
あなたを待っていないイベントでも「入力待ち」のベルが鳴ります。上で指定している 3 タイプが
実際に待っているもの — permission プロンプト・エージェントの入力要求・elicitation
ダイアログ — です。

**完了系・idle 系のタイプを足さないでください**（`agent_completed`・
`elicitation_complete`・`idle_prompt`）。完了のベルには所有者が 1 つだけあります —
`Stop` フック（後述のゲートを入れるなら `subagent-idle-gate.sh main-stop`）です。
そこに第二の発生源を足すことが、ゲートが防いでいる早すぎるベルを呼び戻します。

「入力待ち」の音は `tmuxOpener.notifySoundPresetOnAsk` で選びます（既定は `siren`
で、完了プリセットと区別しやすくしてあります）。`notifySoundPreset` と同じ 5 種の
プリセットを使います。理由ファイルは上の statusline ブリッジと同じく `XDG_CACHE_HOME`
からパスを解決するので、「両側が一致していること」という同じ注意点が当てはまります。

### サブエージェント対応の idle（*本当に*アイドルのときだけ鳴らす）

既定では `Stop` フックは**メインターン**が止まった瞬間にベルを鳴らします。しかし、
そのターンがサブエージェント（`Task` のファンアウト）を起動していた場合、まだ本当は
アイドルではありません — サブエージェントがまだ動いています。任意で、小さなゲートを挟むと、
メインターンが停止し**かつすべてのサブエージェントが終了する**まで通知を保留できるので、
ベルが「調整役が一時停止した」ではなく「本当に完了した」を意味するようになります。

参考の `subagent-idle-gate.sh` は、稼働中のサブエージェントを
`${XDG_CACHE_HOME:-$HOME/.cache}/tmux-opener/subagents-<session>/` 配下のマーカー
ファイル（Claude Code の `session_id` をキーに、サブエージェント 1 つにつき 1 ファイル）
として追跡し、その集合が空になったときにだけ発火します:

- `PreToolUse`（matcher `Agent`）→ Agent ツール呼び出しがサブエージェントを起動しよう
  としたその瞬間に*暫定*マーカーを追加（順序に関する注記は後述）。
- `SubagentStart` → そのサブエージェントの本マーカーを追加（同時に暫定マーカーを 1 つ
  回収し、同じサブエージェントを二重に数えないようにする）。
- `SubagentStop` → そのサブエージェントのマーカーを削除（live 集合と quarantine 集合の
  **両方**から）。ここでは idle を**発火しません**: バックグラウンドのサブエージェントの
  完了は必ずメインループを起こして新しい後続ターンを走らせるため、ここで鳴らすと 1 ターン
  早すぎます。
- `Stop`（メインターン）→ まず掃除（下記）を走らせ、そのうえで live マーカーが残っていな
  ければ**のみ** idle 発火。残っていればサブエージェントがまだ稼働中で、その完了が別の
  メインターンを起こし、集合がついに空になったターンの `Stop` で発火します。
- `UserPromptSubmit` → 新しいターンの冒頭でも掃除を走らせます。

掃除はもはやマーカーの age（経過時間）で stale を判定しません。稼働中のサブエージェントは、
Claude Code がその transcript（`${transcript_path%.jsonl}/subagents/agent-<agent_id>.jsonl`）
に追記を続けている限り**生存**していると観測されるので、何時間走っていても書き続けている限り
マーカーは残ります。transcript が閾値を超えて沈黙したマーカーは削除ではなく**隔離**（兄弟
ディレクトリへ退避）され、そのサブエージェントが再び書けば次のフックイベントで live 集合へ
戻ります——だから誤判定の掃除は毎ターン鳴らずに**単発のベルで自己修復**します。掃除は `Stop`
と `UserPromptSubmit` の**両方**で走るので、取りこぼした `SubagentStop` によるリークマーカー
は、あなたがベルを待って黙っている間でも回収されます。transcript を観測できない環境（古い
Claude Code や `jq` 不在）では、掃除は age 判定へフォールバックします。

**順序に関する注記（なぜ `PreToolUse` か）。** Agent ツールはサブエージェントを*非同期*に
起動するため、`SubagentStart` は起動元ターンの `Stop` より先には発火しません — 実際の
実行では、対応する `SubagentStart` がマーカーを作るより約 25 秒も前に `Stop` が発火して
（idle 通知まで出て）しまいました。`PreToolUse` は Agent ツール呼び出しの時点、つまり
起動元ターン自身の `Stop` より前に発火するので、そこでサブエージェントを pending として
先回りマーキングすると競合が解消します: `main-stop` は、これから存在するがまだ自己申告
していないサブエージェントに対して空集合を見なくなります。`PreToolUse` フックを省いても
既に稼働中のサブエージェントに対してはゲートは機能しますが、この「起動直後に停止」の競合
だけは早すぎるベルをすり抜けさせ得ます。

発火時、ゲートは実際のベルを自分と同じディレクトリの `tmux-opener-bell.sh stop` に
委任します（セッション解決やベル送信を自前で再実装しません）。また 3 秒クールダウン
（完了 vs ask の窓と同じ思想）でデデュープし、同時発生した `main-stop` が二重通知
しないようにします。両方を `~/.claude/hooks/` に置く必要があるのはこのためです —
ゲートはベルを自分自身からの相対で解決し、パスの設定を持ちません。参考の
`statusline.sh` も同じマーカー集合を読み、サブエージェントが 1 つでも動いている間は
`idle` ではなく `working` を出し続けます — ゲートがベルを保留している最中に「終わった」
と読めることはありません。件数は出しません（起動したサブエージェントは Claude Code
自身が既に表示しています）。

**後方互換 / opt-in。** これは別スクリプトです。これらのフックを登録しなければ何も
変わりません — 上の素の `Stop → tmux-opener-bell.sh stop` の配線が、従来どおりメイン
ターンの停止を idle として扱います。

有効にするには、スクリプトをインストールし（上記）、`~/.claude/settings.json` で
`Stop` フックをベル直呼びからゲートに向け替え、`PreToolUse` / `SubagentStart` /
`SubagentStop` / `UserPromptSubmit` フックを追加します:

```json
"hooks": {
  "Stop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh main-stop" } ] }
  ],
  "PreToolUse": [
    {
      "matcher": "Agent",
      "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh pending" } ]
    }
  ],
  "SubagentStart": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh start" } ] }
  ],
  "SubagentStop": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh stop" } ] }
  ],
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh reset" } ] }
  ],
  "Notification": [
    {
      "matcher": "permission_prompt|agent_needs_input|elicitation_dialog",
      "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-bell.sh ask" } ]
    }
  ]
}
```

`PreToolUse` フックは `"matcher": "Agent"` で絞ってあるので、あらゆるツール使用では
なく Agent ツール呼び出しのときだけサブエージェントを pending としてマーキングします —
これが上述の非同期な「起動直後に停止」の競合を解消します。`Notification` フックは
構成 B と同じ matcher を付けたまま `tmux-opener-bell.sh ask` に向けておきます —
ゲートが司るのは完了（idle）だけで「入力待ち」の理由には関与せず、その matcher が
「ゲートの所管である完了系・idle 系のタイプでこのフックを発火させない」ことを担保します。

**BEL の発生源はゲートに一本化する — 第二の発生源にゲートを迂回させない。**
これが構成 C で、切るべき発生源は 1 つではなく 2 つあります。

- `Stop` フックは `tmux-opener-bell.sh stop` ではなく `subagent-idle-gate.sh main-stop`
  を呼ぶこと。両者は排他です: 構成 B のベル直呼びをゲートと**併用してはいけません**
  ——メインターンの停止ごとに鳴ってしまい、ゲートの意味が失われます。ゲートは自分で
  `tmux-opener-bell.sh stop` を呼びますが、それは本当に idle だと判定したときだけです。
- Claude Code 自身の `preferredNotifChannel` を `"terminal_bell"` のままにしないこと。
  そのままだと Claude Code が内蔵ベルを直接鳴らし、ゲートを完全に迂回して意図しない
  タイミングで通知が出ます。`"notifications_disabled"`（または他の非ベルチャンネル）に
  設定し、完了 BEL の発生源をゲート一本に絞ってください。

## 設定

| 設定 | 説明 |
| --- | --- |
| `tmuxOpener.terminal.fontFamily` | ターミナルのフォント。空なら `editor.fontFamily` に従います。 |
| `tmuxOpener.terminal.fontSize` | ターミナルのフォントサイズ。未設定なら `editor.fontSize` に従います。 |
| `tmuxOpener.profiles` | `⌄` のドロップダウンに出すコマンド。 |
| `tmuxOpener.notifyOnBell` | セッションがターミナルベルを鳴らしたときに通知します。既定で有効。 |
| `tmuxOpener.notifySound` | ベル通知と同時に音を鳴らします。既定で有効。 |
| `tmuxOpener.notifyToast` | ポップアップ通知（トースト）を表示します。既定で有効。無効にすると音だけ残せます。両方を止めるときは `notifyOnBell` を false に。 |
| `tmuxOpener.notifySoundPreset` | 鳴らすサウンド: `classic` / `siren` / `sos` / `cascade` / `trill`。 |
| `tmuxOpener.notifySoundPresetOnAsk` | ベルが完了ではなく「ask」（入力待ち）のときに鳴らすサウンド。既定は `siren`。参考の `tmux-opener-bell.sh` フックが必要。 |
| `tmuxOpener.notifyBridgeStatusline` | statusline ブリッジのコンテキスト率とコストを通知に追記します。既定で有効。参考 `statusline.sh` が必要。 |

## 開発に参加する

ビルド方法とローカルでの実行方法は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## ライセンスと帰属

MIT ライセンスです。全文と、以下にまとめた帰属表示は `LICENSE` を参照してください。

セッション一覧のレイアウト（既定・最小・最大の幅、ラベルや閉じるボタンが隠れる幅の
しきい値、既定で右側に置くこと、中ボタンで終了すること）と分割ボタンは、Microsoft の
Visual Studio Code のソース（同じく MIT ライセンス）を参考にしています。コードを
そのまま複製した箇所はありません。

拡張機能のアイコンは Jason Long 氏による公式 tmux ロゴを、ISC ライセンスのもとで無改変
のまま使用しています。ビューコンテナのアイコンは同じデザインを単色で描き直したものです
（VS Code がビューコンテナのアイコンを単色のマスクとして描画するため）。ツールバーの
アイコンは Microsoft の Codicons（CC BY 4.0）です。

**tmux-opener は非公式のプロジェクトであり、tmux プロジェクトとは関係がなく、その承認も
受けていません。**
