# M PLUS 1 Code Term (font resource for extensions)

*[English](README.md)*

拡張機能 ID: `shirokuma-library.font-mplus1code`

M PLUS 1 Code Term フォントを **他の拡張機能へ供給する** ための汎用フォントリソース拡張機能。
この拡張機能自体は UI もコマンドも持たず(`contributes` は空、`activationEvents` も空、`main`
は no-op)、**フォントを OS にはインストールしない**。同梱した TTF を、消費側の拡張機能が
自分の webview から `vscode-resource` 経由で読み込めるようにすることだけを目的とする。

**M PLUS 1 Code Term は M PLUS 1 Code の改変版**で、端末向けに作り直してある: 端末が
「幅 1 列」と数える記号を、レンダラが横に潰す幅より下へ収めてある: ink がセル幅の
**1.15 倍**を超える輪郭はちょうどその幅まで縮小し、セルからはみ出す輪郭は
セルの中央へ置く。したがってはみ出しは左右対称で、500 ユニットのセルに対し片側 38
ユニットを超えない(倍率どおりなら 37.5・残りは整数丸め。約 7.6%・実測)。**記号が隣の
セルにわずかに掛かることはある**——決して起きないのは「潰される」ことのほう。送り幅は
これに含まれない: 升目は動かず、このファイルの `hmtx`(全 6,747 グリフの advance と
lsb)は直前の #291 リリースとバイト単位で一致する(実測)。倍率そのものの意味・上限
1.5・なぜ 1.15 かは
`scripts/font-fit/manifest.json` の `note` に 1 箇所だけ定義がある。

**縦と横は別倍率である**(#293 以降): 横を `s` に縮めるとき、縦は面が許す範囲で `s × 1.3` まで伸ばす。
理由は Mgen+ 系での実測にある —— あちらでは横の縮小が実際に効き、`①` をセル幅まで
縮めると高さが同じ面の cap height を下回った。「小さく見える」の主因は幅ではなく高さ
だった。この書体はほとんど縮小されない(「取得元(provenance)」参照)ので、ここでの伸長は
「狭められていないグリフを縦に伸ばす」形になる。伸長は**この面から実測した壁**で
グリフごとに clamp する —— 漢(U+6F22)の ink の**上端と下端**で、Regular が
`y = -77..824`・Bold が `-93..827`。伸ばした結果がその内側にとどまるよう伸長係数を
抑える。**縛るのは ink の高さではなくグリフの到達**である: この変換は縦の中心を保存
するので、高さだけを抑えても、中心が漢とずれたグリフは行の外へ出てしまう。したがって
出荷バイトについて真になるのは**条件つきの言明**である —— この変換はグリフを漢の
上端・下端より外へ出さない。等倍の時点で既に外にいるグリフは直前リリースの姿のまま
1 ユニットも動かない(実測: どちらの面も新しく外へ出たグリフは **0 個**)。
「漢がすでに持っている以上には食い込まない」とは**主張していない** —— この書体には
元から漢より高く届く記号があり、Regular では作り直した 46 個のうち **27 個**が等倍の
時点で既に漢の箱の外にいる。
clamp の下限は 1.0 なので、**作り直したグリフが必ず縦に伸びるわけではない**: 出荷バイトの
実測で、伸びたのは Regular が 46 個中 **19 個**、Bold が 67 個中 **25 個**。残りは等倍の
時点で伸ばす余地が無く、1 ユニットも動いていない。`1.3` は 5 段階を焼いて人が選んだ
値であって、近い値をとる cap height 比から**導出した値ではない**。意味・実測上限・既定は
同じ `note` に定義がある。ASCII・Latin-1 は対象外
(レンダラが縮小しない範囲であり、対象にすると本文まで作り直すことになる)で、
box drawing / block / 私用領域も同様——正確な対象範囲は `font-packages/README.md` にあり、
このパッケージはその実例(bold 面の `î` / `ï`・「取得元(provenance)」参照)を出荷している。
それ以外の輪郭には手を触れていない。
三段連鎖は後述の「取得元(provenance)」にある。

## 同梱フォント

| family(実測) | ファイル | weight | ライセンス |
|---|---|---|---|
| `M PLUS 1 Code Term` | `fonts/MPLUS1CodeTerm-Regular.ttf` | `400`(静的フォント・可変軸なし) | OFL-1.1 |
| `M PLUS 1 Code Term` | `fonts/MPLUS1CodeTerm-Bold.ttf` | `700`(静的フォント・可変軸なし) | OFL-1.1 |

**以前は可変フォント 1 本だったものが、静的 2 面になっている。** これは梱包上の好みではない:
可変フォントの輪郭を編集すると `gvar` のデルタが壊れるので、変換は先にインスタンスを固定する
必要がある。400 と 700 の 2 点で固定してそれぞれを変換した —— 契約が `100 700` 軸を名乗る
1 face ではなく単一値 weight の 2 face になっているのはそのため。静的 face が範囲を宣言するのは
`font-packages/README.ja.md`(規範の正は英語版 `font-packages/README.md`)が説明する
「合成 bold 抑止の罠」そのもので、CSS の font matching が
レギュラー face を bold セルの実体として選び、レギュラーの太さで描いてしまう。分割の利点は、
bold が合成ではなく実バイトになったことである。

ライセンス全文は `fonts/OFL.txt` を参照。

## 利用範囲の限界: `editor.fontFamily` / `terminal.integrated.fontFamily` では使えない

**この方式で供給されるフォントは、VS Code の設定(`editor.fontFamily` や
`terminal.integrated.fontFamily`)にフォント名 `M PLUS 1 Code Term` を書いても使えない。**
これはよくある誤解なので明記する(この拡張機能の displayName / description が「a resource for
extension developers, not a font selectable from ordinary settings such as
editor.fontFamily」と明言しているのはこのため)。

- このフォントを描画に使うには、消費側拡張機能が自分の webview の HTML/CSS の中に `@font-face`
  を **自前で注入する** 必要がある。その `@font-face` は、その webview1つのスコープの中だけに
  存在する定義であり、VS Code のメインウィンドウ(エディタ本体 = Monaco や標準の統合ターミナル)
  の CSS には一切存在しない。
- `editor.fontFamily` はメインウィンドウ側で描画されるエディタ本体の設定なので、webview 用に
  注入した `@font-face` はそこには届かない。存在しないフォント名を指定した場合と同じ扱いになり、
  エラーも出ずに静かに次のフォールバックへ流れる。`terminal.integrated.fontFamily`(VS Code 標準
  の統合ターミナル)も同様にメインウィンドウ側で、届かない。
- したがってこの仕組みが使えるのは、**消費側拡張機能自身が「独自の webview を持っていて、
  借用手順(`getExtension` → `localResourceRoots` → `asWebviewUri` → `@font-face`)
  を自前で実装している」場合に限る**。tmux-opener はまさにこのケース(VS Code 標準の Terminal
  パネルを使わず、自前の webview 上に xterm.js を持つ設計)なので利用できるが、一般的な用途
  (エディタや標準ターミナルでこのフォントを使いたい)には使えない。そちらが必要な場合は、
  フォントを OS へ実インストールする以外の手段がない。

## 他拡張機能からこのフォントを利用する方法(規約)

**注意**: これは VS Code の公式な拡張機能間フォント共有の仕組みではない。**そのような公式機構は
存在しない。** 非公式の自前規約であり、この拡張機能の ID と
`package.json` の `providedFont` 契約フィールドの形をそのまま前提にする。将来この拡張機能側で
ファイル配置・ID・契約フィールドを変更すると、消費側は無言で壊れる。

**契約仕様——2 つの宣言形・読み手の正規化規則・縮退規則・コード付きの消費側手順——は
同じリポジトリの `font-packages/README.ja.md`(規範の正は英語版
`font-packages/README.md`)が単一正本。本節はこの package が何を宣言して
いるかだけを記録する。**

この拡張機能の `providedFont`:

```json
"providedFont": {
  "family": "M PLUS 1 Code Term",
  "file": "fonts/MPLUS1CodeTerm-Regular.ttf",
  "weight": "400",
  "faces": [
    { "file": "fonts/MPLUS1CodeTerm-Regular.ttf", "weight": "400" },
    { "file": "fonts/MPLUS1CodeTerm-Bold.ttf", "weight": "700" }
  ],
  "license": "OFL-1.1"
}
```

`faces` は family の全 face を宣言順に並べたもので、読める消費側はエントリごとに `@font-face`
を 1 つずつ注入する。隣のフラットな `file` / `weight` の組は **単一 400 face の略記** で、値は
その エントリと同一。旧来の 1 ファイル契約を前提に書かれた消費側はそのまま動き続ける。

各 weight は静的 face なので **単一値であり範囲ではない**。#275 までこの package は `faces`
無しで `"weight": "100 700"` を宣言しており、当時それは *真* の主張だった —— fvar `wght` 軸が
実際に 100–700 の**可変フォント** 1 本を同梱しており、1 ファイルで両方のセル weight を実グリフ
でカバーしていた。変換はその軸をインスタンス化して消す(「同梱フォント」節)ので、範囲は
「もう持っていない軸」についての主張、すなわち合成 bold 抑止の罠になる。同ディレクトリの静的
Mgen+ 2 package が最初から face ごとに単一値を宣言しているのも同じ理由。

消費側は
`vscode.extensions.getExtension('shirokuma-library.font-mplus1code')` が `undefined` を返す
ケースを必ず処理すること: これは**ソフト依存**(あれば使う)なので実行時チェック +
フォールバックで扱い、`package.json` の `extensionDependencies` には **入れない**。
tmux-opener 本体はその場合 `@font-face` を一切注入せず OS 標準の monospace で描画し、この
フォントが選択されているときに限りインストールを促す 1 回きりの通知を出す
(`src/font-registry.ts`)。同本体の `src/font-registry.ts` / `getHtml`(`src/extension.ts`)が
消費側の実装例。

## 取得元(provenance): 上流アーカイブ → 変換 → 出力

> 英語版の対応節は `README.md` の
> `## Provenance (upstream archive → conversion → output)`。機械照合の対象は
> `README.md` の見出しのみで、この日本語版は訳文として扱われる。

**このパッケージが同梱する 2 本の TTF は変換出力であり、上流のバイト列ではない。**
#275 までは無改変の可変 TTF 1 本を同梱していた。改変ファイルは、無改変パッケージが使う
2 列 sha256 規約では証明できない —— 比較対象である上流 TTF がこのリポジトリに存在しないため。
代わりに **三段連鎖**(各段とも実測)で置き換える。

### 1. 上流(入力)

**ここが唯一の弱い環であり、推測ではなく「弱いまま」記録する。** この package は 2 列
provenance 規約より前に作られており(#174)、**上流アーカイブの URL も sha256 も記録が残って
いない**。ここにも書かない —— 捏造した値は実測値と見分けがつかないからである。
`scripts/font-fit/manifest.json` も同じことを `unrecorded` フィールドに書き、`upstream.url` と
`upstream.archiveSha256` を意図的に `null` にしてある。次にアーカイブを取り直す人が両方を実測
して双方に埋めること。

**実測してあるのは入力ファイル自体** —— #275 まで同梱していた無改変の `MPLUS1Code.ttf` を、
リポジトリにあった状態でハッシュした値。これが `manifest.json` の `srcSha256` であり、`run.sh`
は **1 バイトも書く前に** `--src-dir` の中身をこの値と突き合わせる。

| 変換入力 | sha256 |
|---|---|
| `MPLUS1Code.ttf`(#275 以前の同梱ファイル) | `ff68678c5bd7e9d9d6ab6d57e4355aabe30f6b8f8bff9bd59baf6a7807dcfd36` |

上流プロジェクト: M PLUS FONTS <https://github.com/coz-m/MPLUS_FONTS>。同梱の
`fonts/OFL.txt` は著作権者を `Copyright 2021 The M+ FONTS Project Authors`(1 行目)と記載して
おり、パッケージ直下の `LICENSE.txt` はそれとバイト一致。

### 2. 変換(入力を出力に変えたもの)

- **パイプライン**: 本リポジトリの `scripts/font-fit/run.sh`。駆動は
  `scripts/font-fit/manifest.json`。`instance.py` が可変軸を固定し、`fit.py` が変換本体、
  `verify.py` がゲート、`dump-widths.mjs` が `@xterm/addon-unicode11` 自身のプロバイダから
  セル幅表を生成する(手書きの幅表は禁止)。**順序は固定**: 先にインスタンス化、後に変換。
  可変フォントのまま輪郭を変えると `gvar` のデルタが壊れる。
- **どの変換器か —— commit ではなく内容で識別する**。導入は Issue **#275**。出力を決める
  ファイルそれぞれの sha256 で固定する:

  | パイプラインのファイル | sha256 |
  |---|---|
  | `scripts/font-fit/fit.py` | `c634881d418a59d68f1892db4d35f4fc66780a71cff277448cbef91479470bf7` |
  | `scripts/font-fit/instance.py` | `86240ac88d1dfa4527ebaa1e7e97caf6c656e97cd04833d12b21149d2fefe2af` |
  | `scripts/font-fit/verify.py` | `5c7d58d6a8ff4e4d248990c4bc39bcf379faee2fec9303ea3966c6ce1c5d9cf5` |
  | `scripts/font-fit/dump-widths.mjs` | `4813198fba79edb3d3086aa07b8808183a362406b1a1da9c7d614c5b90633a03` |
  | `scripts/font-fit/run.sh` | `4966ccca260ded4b1d7aa94fa71bc9802956363e9a646c788166ee530ab8c55a` |
  | `scripts/font-fit/manifest.json` | `0fed27ae2614fd0cbe570cde156bb4ed5ff32fe7a0a7c814b97d71acaf49629b` |

  **なぜ commit SHA を書かないか。** 本節の初稿は SHA を記録しており、それは同じ PR の中で
  偽になった: 変換器を直し(bold 面が自分を Regular と名乗っていた)、出力が動いたのに、
  記録された SHA は古い変換器を指したまま —— checkout して再実行すると、3 行下に記録した
  ハッシュとは違う値が出る状態だった。これは注意力で避けられる類の失敗ではない: git の SHA は
  内容アドレスなので、**ファイルは自分を含む commit を名指しできない**。SHA を書こうとすると、
  TTF と `checksums.json` の記録と本表を 2 つの commit に割る(R13 が防ごうとしている当の分離)か、
  誰かが後で差し替えるプレースホルダを置く(忘れれば無言で出荷される)しかない。スクリプトを
  ハッシュすればどちらの問題も無い —— 値は執筆時点で確定し、rebase や履歴の書き換えを跨いでも
  生き残り、無関係な変更も含む commit 経由ではなく**変換器そのもの**を指す。加えて `run.sh` は
  作業ツリーが `HEAD` と違うとき、印字する commit に `-dirty` を付ける。未コミットの編集から
  生成した来歴を、clean な checkout で生成したものと取り違えられないようにするため。
- **実測ツールバージョン**(`run.sh` が実行冒頭で印字したもの):

  | ツール | バージョン |
  |---|---|
  | fontTools | `4.63.0` |
  | Python | `3.14.4` |
  | `@xterm/addon-unicode11` | `0.10.0-beta.288` |

- **固定した環境変数**: `PYTHONHASHSEED=0`、`LC_ALL=C.UTF-8`、fontTools の保存は
  `recalcTimestamp=False`。
- **実行が何を変えたか**(face ごと・`run.sh` の実測報告)。入力の軸は
  `wght: (100.0, 400.0, 700.0)` で、出力 face ごとに固定した:

  | 出力 face | インスタンス | 直したグリフ | うち移動のみ / 縮小 | 元から適合 |
  |---|---|---|---|---|
  | Regular | `wght=400` | 46 | 46 / 0 | 295 |
  | Bold | `wght=700` | 67 | 61 / 6 | 274 |

  Mgen+ 系より 2 桁少ない。この書体の Ambiguous 記号はもともとほぼ正しく、はみ出していたもの
  だけに触れた —— 設計方針どおりの結果である。`fitRatio` 1.15 では Regular 面は
  **1 グリフも縮小されない** —— 実測で対象内の最大 ink が 555 ユニット、room が 575 ユニット
  なので、この面で「直した」のはすべて中央寄せだけである。
- **実行を駆動した `fitRatio`**: **1.15**(`manifest.json` のトップレベル既定。この
  パッケージは上書きしていない)。ink がセル幅 500 の 1.15 倍 = 575 ユニットを超える輪郭を
  そこまで縮小する。値の意味と上限 1.5 は `scripts/font-fit/manifest.json` の `note` に
  1 箇所だけ定義があり、ここでは繰り返さない。
- **実行を駆動した `vstretch`**: **1.3**(`manifest.json` のトップレベル既定。この
  パッケージは上書きしていない)。縦の壁は宣言値ではなく **face ごとの実測値** —— 漢
  (U+6F22)の ink の**上端と下端**で、`run.sh` の印字どおり Regular `y = −77…824`・
  Bold `−93…827`。clamp が効いたのは Regular が 46 個中 **46 個**、Bold が 67 個中
  **67 個**。うち Regular 27 個・Bold 42 個は等倍の時点で伸ばす余地が無く、**1 ユニットも
  動いていない**(clamp の下限が 1.0)。したがって実際に縦へ伸びたのは **46 個中 19 個**と
  **67 個中 25 個**である。作り直した対象のうち Regular **27 個**・Bold **42 個**は
  等倍の時点で既に漢の箱の外にあり、**新しく外へ出たグリフはどちらの面も 0 個**
  (同じインスタンス化入力を `vstretch = 1.0` で焼いたバイトとの実測比較)。
  横はこれに一切影響されない: `hmtx` は全 6,747 グリフが #293 前の
  リリースとバイト一致(実測)で、対象内の最大 ink も 555 / 575 のまま。
- **両 face とも 3 つの契約を通過**(`verify.py`・変換器が実際に読んだインスタンス化済み
  ファイルと、宣言した倍率・伸長率で突き合わせ):**契約① 宣言した帯(ink ≤ `A × 1.15`・はみ出す
  ときは中央対称・advance は `A`)から外れる対象符号位置 0**(対象内の最大 ink は
  Regular 555 → 555〔もともと room の内側で縮小対象なし〕・Bold 650 → 575〔宣言 room
  ちょうど〕)、**契約② 本文グリフ 5,567 個中 輪郭が変わったもの 0**、**契約③ 宣言した
  `vstretch` と実測の壁(この face 自身の 漢 の y 到達範囲)から決まる上下端と食い違う
  変換グリフ 0**(Regular 46 個中 0・Bold
  67 個中 0)。契約③ は等式なので、違う伸長率で焼いたバイトはどちら向きにずれても落ちる。
  式を再計算しない側の検査(③c)でも、**新しく壁の外へ出たグリフは両 face とも 0**。「対象範囲」は逃げではなく仕様で、
  ASCII / Latin-1・BMP 私用領域・box drawing / block・幅 1 でないものをパイプラインが
  意図的に除外している(`font-packages/README.md` の "Terminal width conventions")。
  実例はこのパッケージが出荷している: `fonts/MPLUS1CodeTerm-Bold.ttf`(`A` = 500)の
  `î`(U+00EE)は advance 500 で ink `74 … 524`、`ï`(U+00EF)は `74 … 509` —— 幅 1 で
  箱の外だが、対象外なので触っていないのが正しい。
- `name` テーブルの family / style 名は書き換わる(`M PLUS 1 Code` → `M PLUS 1 Code Term`)が、
  **nameID 0(著作権)はバイト単位でそのまま**(出力側で再実測):
  `Copyright 2021 The M+ FONTS Project Authors (https://github.com/coz-m/MPLUS_FONTS)`。
  **style ビットも名前と一緒に動く**: `OS/2.fsSelection` の bit 5(BOLD)と bit 6(REGULAR)、
  `head.macStyle` の bit 0 を、継承ではなく style から導出して設定する。これが効くのは
  可変フォントであるこのパッケージだけ —— `instantiateVariableFont` は `usWeightClass` は
  更新するがビットは触らないので、放置すると既定(Regular)インスタンスのビットが Bold 面へ
  そのまま乗り、「自分を `Bold` と名乗りながら Regular のフラグを立てたファイル」になる。
  出力側の実測: Regular が `fsSelection=0x00C0` / `macStyle=0x0000`、Bold が
  `fsSelection=0x00A0` / `macStyle=0x0001` —— どちらも bit 7(USE_TYPO_METRICS)は保たれて
  いる。フィールドへの代入ではなくビット単位で立て/落としているため。
- **再現性は「主張」ではなく「実測」として**: 同一マシン・同一入力・上記ツールバージョンで
  再実行し、バイト単位で同一の出力(下記 sha256)を得た。*別バージョン* の fontTools / Python
  については何も主張しない。

### 3. 出力(同梱物)

配置後のファイルで実測し、同じ値を `scripts/font-fit/checksums.json` に記録している。
#291 以降は sha256 の隣に焼いた `fitRatio` を、#293 以降は `vstretch` も記録し、`npm test`
はそれらを manifest の宣言とも突き合わせる。

| 配置先 | sha256(配置後) | fitRatio | vstretch |
|---|---|---|---|
| `fonts/MPLUS1CodeTerm-Regular.ttf` | `63c80ed65c2a9eff8a80d54cf918aa2cbf68a06f6f23dc04d0a04ed401521ebf` | `1.15` | `1.3` |
| `fonts/MPLUS1CodeTerm-Bold.ttf` | `06f4fd340d71a39f44dc516f03968fd40608f4d300d9594269cc7ec7b4474f0f` | `1.15` | `1.3` |

### Reserved Font Name の確認(実測)

同梱のライセンス本文すべてに対する実測:

> **この手順は置き換えられた(#288)。** 以下の `grep` は **もう手順ではない**。
> `scripts/font-fit/check-license.py` を実行すること(工程は `font-packages/README.md`
> の「Reserved Font Name check」)。下のコマンドは **`name` テーブルに到達できない** ——
> どのファイルにも現れない予約名がフォント本体にだけ書かれている形があり(Source Han
> Code JP で実測・#285)、UTF-8 でないライセンス文書も見落とす。下の表は
> **この grep が出した記録** として残してあり、指示ではない: `name` テーブル段より前の
> ものなので、道具が報告する `fonts/*.ttf#0:nameID N` の行があれば載っていない。
> その追記は #289 で行う。

```sh
grep -rniI 'reserved font name' \
  font-packages/font-mplus1code/LICENSE.txt \
  font-packages/font-mplus1code/fonts/
```

**フラグとパス指定は効いている**。そしてこのパッケージこそ最も効く —— 拠り所にしているのが
**「ヒットが無い」という答え**だからで、検索がその答えを偶然作り出せてはならない。`-i` は語句を
大文字で叫ぶ行が飛ばされるのを防ぎ、`--include='*.txt'` ではなく `fonts/` を指定することで
拡張子なしのライセンス文書の読み飛ばしを防ぎ(このパッケージには無いが姉妹パッケージには
あり、コマンドが理由もなく食い違うべきではない)、`-I` は TTF が「マッチするバイナリ」として
報告されるのを防ぐ。下表には**検索が返す全行**を載せる:

| ファイル:行 | 宣言している名前 |
|---|---|
| `LICENSE.txt:33` | *名前なし* —— OFL の定義条項そのもの |
| `fonts/OFL.txt:33` | *名前なし* —— 同じ条項(2 ファイルはバイト一致) |

**`name` テーブルの段はここに 1 行も足さない**(#289・`scripts/font-fit/check-license.py` で
実測)。上の「superseded」注記は「道具が出す `fonts/*.ttf#0:nameID N` 行がこの表に欠けている」と
言っているが、道具は**1 行も出さない** —— 出荷 2 面の `name` テーブルも予約名を宣言していない。
つまりこのパッケージが依拠している「ヒットなし」という答えは、上の 2 行に加えて、`grep` では
到達できない段でも裏づけられたことになる。合計が 0 件なので道具の OK は**空虚に真**であり、
道具はそう言う: 終了ステータスは 0 ではなく **4**、判定行は
`'M PLUS 1 Code Term': どの予約名も含まない → OK **（照合した予約名 0 件——この OK は空虚に真）**`。
この区別が終了コードの存在意義である —— 何とも照合していない pass が、4 件と照合した pass と
同じ顔をしてはいけない。ここでは正当なケースで、明示するための手段が
`--allow-zero-reserved` である。

**このパッケージでは Reserved Font Name が 1 つも宣言されていない。** 著作権行
(`LICENSE.txt:1`)に `with Reserved Font Name …` 句が無く、そこが §3 の予約名を付ける位置で
ある。したがって `M PLUS 1 Code Term` は §3 の制約を受けない —— 避けるべき名前が見つからな
かったという *結果* であって、次回この確認を省いてよい理由ではない。

## family 名(実測・想定ではない)

同梱する変換後のファイルに対する実測。`name` テーブルを直読:

| フィールド | `MPLUS1CodeTerm-Regular.ttf` | `MPLUS1CodeTerm-Bold.ttf` |
|---|---|---|
| nameID 1(family) | `M PLUS 1 Code Term` | `M PLUS 1 Code Term` |
| nameID 2(subfamily) | `Regular` | `Bold` |
| nameID 4(full name) | `M PLUS 1 Code Term Regular` | `M PLUS 1 Code Term Bold` |
| nameID 6(PostScript) | `MPLUS1CodeTerm-Regular` | `MPLUS1CodeTerm-Bold` |
| `OS/2.usWeightClass` | `400` | `700` |
| `fvar` | 無し(静的) | 無し(静的) |

どちらの face も nameID 16 / 17 を持たない。family は nameID 1 で、2 face で同一 —— それが
「2 本を 1 つの CSS `font-family` に束ねてよい」ことの正当性を支える。**注入機構はこれに依存
しない**: `@font-face` は family 名を読むのではなく **宣言する** 規則で、CSS の font matching は
ファイル内部の名前を参照しない。

`M PLUS 1 Code Term` がこの拡張機能の `providedFont.family` が持つ値であり、消費側のレジストリ
(tmux-opener の `FONT_REGISTRY`)と一字一句一致していなければならない。

消費側への注記: 変換前の名前 `M PLUS 1 Code` は、これらのファイルが宣言する名前ではもう無い。
tmux-opener は旧名を alias として登録し、alias 名義の `@font-face` も注入することで既存の
`settings.json` を変換後のバイト列で描画させている。これは消費側の互換レイヤであって、この
パッケージの性質ではない。

## 等幅メトリクス(実測)

リポジトリルートの `npm test`(`test/font-metrics.test.js`)が **このパッケージ内の TTF 各本**
を対象に(glob で拾うので bold 面も対象)、毎回次を assert する:

- unitsPerEm 1000。ASCII 印字可能域 0x21–0x7E は全コードポイントが cmap に存在し、送り幅は
  単一値 **A = 500**。
- 全角サンプル 一 / 漢 / あ / ん / ア はいずれも **1000 = 2A**。
- 2 面が互いに一致する: unitsPerEm も A も同値。この検査が実効を持つようになったのは #275 から
  —— 単一ファイルの間は食い違う相手がおらず、2 本目の TTF が現れた瞬間に(テストの編集なしで)
  自動的に効き始めた。

これらの値は `hmtx` の送り幅で、変換によって変わっていない。そして実は、このパッケージでは
**どの送り幅も**変わっていない —— ただしそれは *この書体についての事実* であって、ツールの性質
ではない。この違いは重要である:

- **変換は、選んだグリフの送り幅をセル幅に設定する。** 上流が幅 1 の符号位置を全角送りで描いて
  いれば、変換はそれを変える。Mgen+ 系では 1 面あたり約 1000 グリフがこれに当たる(1024 → 512)。
- **ここでは 46 / 67 グリフを選んだが、送り幅は 1 件も変えなかった**。出荷ファイルと、変換器が
  実際に読んだ静的化済み入力とを突き合わせた実測で、**両面とも送り幅の変化 0 件**。M PLUS 1 Code
  は該当符号位置に既に正しい送り幅を与えており、はみ出していたのは *描画* のほう(`Ấ` `Ố` の
  ように積み上がったアクセントが箱の外へ出ていた)なので、輪郭の移動・縮小だけで仕事が終わった。
- **元の可変フォントとの差が 1 件だけある**が、これは変換の仕業ではない:
  `uni20A9.BRACKET.varAlt02` が `wght=700` での静的化時に 1015 → 1044 になる(静的化の段階で
  実測・変換前。`wght=400` では変化なし)。このグリフは `cmap` から到達できない。
- **本文グリフは輪郭も送り幅も無傷**(「取得元」節の契約②・グリフ単位で検証)で、**セル格子も
  動かない**: A は 500 のまま、全角グリフは 1000 のまま。

この段落の前の版は「変換は送り幅に一切触れない」と書いていた。このパッケージに限れば出荷結果は
どちらでも同じで、だからこそ誤った理由付けがレビューを通り抜けた —— **ツールの性質**として書か
れており、その意味では偽である(Mgen+ 系がその反例)。契約②は変換が**選ばなかった**グリフに
ついての主張であり、選ばれたグリフは設計上、輪郭も送り幅も変わりうる。

## この規約について

繰り返しになるが、VS Code に拡張機能間でフォントを共有する **公式の仕組みは存在しない**。
借用手順は、供給側(この拡張機能)と消費側(tmux-opener 等)の間で取り決めた
非公式の自前規約であり、`providedFont` 契約フィールドがその取り決めの正本
(規約そのものの記述の正本は `font-packages/README.ja.md`。規範の正は英語版
`font-packages/README.md`)。契約フィールドの形や
フォントファイルの配置を変更する場合は、消費側が無言で壊れることを踏まえ、双方を揃えて
更新すること。
