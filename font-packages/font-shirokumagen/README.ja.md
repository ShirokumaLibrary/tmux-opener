# ShirokumaGen Term (font resource for extensions)

*[English](README.md)*

拡張機能 ID: `shirokuma-library.font-shirokumagen`

ShirokumaGen Term(白熊源 Term)フォントを **他の拡張機能へ供給する** ための
汎用フォントリソース拡張機能。この拡張機能自体は UI もコマンドも持たず(`contributes` は空、
`activationEvents` も空、`main` は no-op)、**フォントを OS にはインストールしない**。同梱した
TTF を、消費側の拡張機能が自分の webview から `vscode-resource` 経由で読み込めるように
することだけを目的とする。

**ShirokumaGen Term は HackGen Console(白源 Console・v2.10.0)の改変版**で、端末向けに
作り直してある: 端末が「幅 1 列」と数える記号を、レンダラが横に潰す幅より下へ収めてある。
上流はそれらの記号を**全角の送り幅 1080** で設計しているので、変換は選んだグリフの送り幅を
1 セル分の **540** に書き換える —— Regular で 1656 グリフ、Bold で 1621 グリフ(出荷バイトの実測)。
ink がセル幅の **1.15 倍**を超える輪郭はちょうどその幅まで縮小し、セルからはみ出す輪郭は
セルの中央へ置く。したがってはみ出しは左右対称で、540 ユニットのセルに対し片側 41 ユニットを
超えない(倍率どおりなら 40.5・残りは整数丸め。約 7.6%・実測)。**記号が隣のセルにわずかに
掛かることはある**——決して起きないのは「潰される」ことのほう。倍率そのものの意味・上限
1.5・なぜ 1.15 かは `scripts/font-fit/manifest.json` の `note` に 1 箇所だけ定義がある。

**縦と横は別倍率である**: 横を `s` に縮めるとき、縦は面が許す範囲で `s × 1.3` まで伸ばす。
伸長は**この面から実測した壁**でグリフごとに clamp する —— 漢(U+6F22)の ink の**上端と下端**で、
Regular が `y = -72..856`・Bold が `-80..866`。伸ばした結果がその内側にとどまるよう伸長係数を
抑える。**縛るのは ink の高さではなくグリフの到達**である: この変換は縦の中心を保存するので、
高さだけを抑えても、中心が漢とずれたグリフは行の外へ出てしまう。したがって出荷バイトについて
真になるのは**条件つきの言明**である —— この変換はグリフを漢の上端・下端より外へ出さない。
等倍の時点で既に外にいるグリフは等倍のときの姿のまま動かない(実測: どちらの面も新しく外へ
出たグリフは **0 個**。Regular では外にいる数が等倍の 593 個から出力の **592 個**へ 1 個減って
いる)。「漢がすでに持っている以上には食い込まない」とは**主張していない** —— この書体には
元から漢より高く届く記号があり、Regular では作り直した 1723 個のうち **593 個**が等倍の時点で
既に漢の箱の外にいる。clamp の下限は 1.0 なので、**作り直したグリフが必ず縦に伸びるわけでは
ない**: 出荷バイトの実測で、伸びたのは Regular が 1723 個中 **1128 個**、Bold が 1694 個中
**1115 個**。残りは等倍の時点で伸ばす余地が無く、伸長係数が clamp の下限 1.0 に留まった ——
これは**縦の係数についての言明であってバイトについてのものではない**。このパッケージには前
リリースが無いので比較先は**上流**であり、上流と突き合わせると、その 595 個 / 579 個のうち
1 ユニットも動いていないのは **8 個 / 11 個**だけである(残りは同じ工程で中央へ寄せられ、
送り幅を `A` にされ、あるいは横に縮んでいる。内訳は「取得元(provenance)」参照)。`1.3` は 5 段階を
焼いて人が選んだ値であって、近い値をとる cap height 比から**導出した値ではない**。意味・
実測上限・既定は同じ `note` に定義がある。ASCII・Latin-1 は対象外(レンダラが縮小しない範囲で
あり、対象にすると本文まで作り直すことになる)で、box drawing / block / 私用領域も同様——正確な
対象範囲は `font-packages/README.md` にあり、このパッケージはその実例(両面の `©`・
「取得元(provenance)」参照)を出荷している。それ以外の輪郭には手を触れていない。三段連鎖は
後述の「取得元(provenance)」にある。

## 同梱フォント

| family(実測) | ファイル | weight | ライセンス |
|---|---|---|---|
| `ShirokumaGen Term` | `fonts/ShirokumaGenTerm-Regular.ttf` | `400`(静的フォント・可変軸なし) | OFL-1.1 |
| `ShirokumaGen Term` | `fonts/ShirokumaGenTerm-Bold.ttf` | `700`(静的フォント・可変軸なし) | OFL-1.1 |

1 family 2 face。上流の対応する静的 face をそれぞれ変換したもの。weight は**単一値であって
範囲ではない**: 範囲はその重みを覆うという*主張*であり、静的な Regular が `100 700` を名乗ると
CSS の font matching がそれを bold セルの「本物」として選び、regular の太さで描いてしまう——
範囲宣言は合成 bold を**生む**のではなく**抑止する**。ここでは 700 は実在の bold face が覆って
いる。理由は全パッケージ共通で `font-packages/README.ja.md`(規範の正は英語版
`font-packages/README.md`)に 1 箇所だけ書いてある。

**どの上流バリアントか、なぜそれが効くか。** HackGen は 1 リリースにつき 4 family を公開して
いるが、このパッケージが変換したのは **`HackGenConsole`** であって `HackGenConsoleNF` ではない。
NF 版は Nerd Fonts のアイコン集合を足したもので、そのグリフは私用領域に入る —— そして**補助面の
私用領域は、変換がレンダラから借りている 4 除外に含まれない**。NF 版を変換すると、1 セルに
収める気のないアイコンを何千個も縮めることになる(#285 実測: NF 版の増分 10,383 グリフのうち
10,376 が私用領域で、うち 3,959 が上流の 0.70 倍未満に縮む)。ここで同梱している通常版の cmap は
私用領域を **7 符号位置**しか持たない(両面で実測)。除外集合を広げることは変換の scope を変える
ことなので、このパッケージの範囲外である。

著作権表示とライセンス全文は `LICENSE.txt`、上流構成物の一次ライセンス文書は `licenses/` を参照。

## 制約: `editor.fontFamily` / `terminal.integrated.fontFamily` では使えない

**この方式で供給されるフォントは、VS Code の設定(`editor.fontFamily` /
`terminal.integrated.fontFamily`)にフォント名 `ShirokumaGen Term` を書いても使えない。**
よくある誤解なので明記する —— この拡張機能の displayName / description が「拡張機能開発者向けの
リソースであって、editor.fontFamily 等の通常設定から選べるフォントではない」と述べているのも
同じ理由である。

- このフォントで描画するには、消費側の拡張機能が**自分の webview の HTML/CSS に `@font-face` を
  自分で注入する**必要がある。その `@font-face` 定義はその webview の中だけに存在し、VS Code の
  メインウィンドウ(Monaco のエディタ本体・標準の統合ターミナル)の CSS には一切現れない。
- `editor.fontFamily` はメインウィンドウで描画されるエディタの設定なので、webview へ注入した
  `@font-face` は届かない。存在しないフォント名を書いたときと同じ挙動になり、エラーも出ずに
  次のフォールバックへ落ちる。`terminal.integrated.fontFamily` も同様にメインウィンドウ側で、
  同じく届かない。
- したがってこの機構が使えるのは、**消費側の拡張機能が自前の webview を持ち、借用手順
  (`getExtension` → `localResourceRoots` → `asWebviewUri` → `@font-face`)を自分で実装している
  場合だけ**である。tmux-opener はまさにその形(設計上、標準の Terminal パネルを使わず xterm.js を
  自前の webview でホストしている)なのでこのフォントを使える。エディタや標準ターミナルで
  使いたいという通常の用途では機能せず、その場合は OS にフォントをインストールするしかない。

## 他の拡張機能からの使い方(規約)

**注意:** これは VS Code 公式のフォント共有機構ではない。**そのような公式機構は存在しない。**
非公式の自前規約であり、この拡張機能の ID と `package.json` の `providedFont` 契約フィールドの
形に依存している。将来この拡張機能がファイル配置・ID・契約フィールドを変えると、消費側は
無音で壊れる。

**契約の仕様——2 つの宣言形・読み手の正規化規則・劣化規則・消費側の手順(コード付き)——は同じ
リポジトリの `font-packages/README.ja.md`(規範の正は英語版 `font-packages/README.md`)が
単一の正本である。この節は*このパッケージが何を
宣言しているか*だけを記録する。**

この拡張機能の `providedFont`:

```json
"providedFont": {
  "family": "ShirokumaGen Term",
  "file": "fonts/ShirokumaGenTerm-Regular.ttf",
  "weight": "400",
  "faces": [
    { "file": "fonts/ShirokumaGenTerm-Regular.ttf", "weight": "400" },
    { "file": "fonts/ShirokumaGenTerm-Bold.ttf", "weight": "700" }
  ],
  "license": "OFL-1.1"
}
```

`faces` は family の全 face を宣言順に並べたもので、読み手はエントリごとに `@font-face` を
1 つ注入する。隣にあるフラットな `file` / `weight` の対は **400 面 1 つの短縮形**で、その
エントリとバイト等価に保つ —— 旧来の 1 ファイル契約に対して書かれた消費側がそのまま動く。

**この family に別名(alias)は無い。** #275 で変換した 3 family は変換と同時に*改名*されたので、
tmux-opener は各々の旧名を alias として登録し、同じファイルに対して旧名の `@font-face` も注入して
いる(手を触れていない `settings.json` を動かし続けるため)。このパッケージは新規で、
`ShirokumaGen Term` に旧名は存在しない —— つまり「変換済みなら alias を持つ」は全称では
ない。**#298 の改名でも alias は増えない**: この family 名は #289 の時点から公開されておらず、
旧い綴りを持つ `settings.json` はどこにも存在しない。alias は「利用者のディスクにある値」を
守るための恒久エントリなので、守る対象が無いまま足せば期限の無い負債になるだけである。

**`version` を 0.1.0 のままにしているのも同じ事実による。** 2 面のバイト列は動いたが、version の
bump が答える問いは「このパッケージが**公開したもの**が、前の番号で公開したものと違うか」で
あって、0.1.0 で公開したものは存在しない —— 比較対象そのものが無い。(公開済みだったなら、
name テーブルの変更は利用者の `settings.json` から見える変更なので minor bump に当たる。)

消費側は `vscode.extensions.getExtension('shirokuma-library.font-shirokumagen')` が `undefined` を
返す場合を扱わなければならない: これは**ソフト**依存(あれば使う)なので、実行時チェックと
フォールバックで扱い、`package.json` の `extensionDependencies` には**入れない**。tmux-opener は
その場合 OS 標準の monospace で描画し(`@font-face` を 1 つも注入しない)、このフォントが選択中の
ときに限りインストールを促す通知を 1 度だけ出す(`src/font-registry.ts`)。同リポジトリの
`src/font-registry.ts` と `getHtml`(`src/extension.ts`)が消費側の実装例である。

## 取得元(provenance): 上流 archive → 変換 → 出力

**このパッケージが出荷する 2 つの TTF は変換出力であって、上流のバイト列ではない。** 改変済み
ファイルは、無改変パッケージが使う二列 sha256 規約では証明できない —— 比較対象になる上流 TTF を
このリポジトリが持たないからである。代わりに来歴は**三段連鎖**で、各段を実測する: 入力がどこから
来たか、何が入力を出力へ変えたか、出力のハッシュは何か。これは前者の安価版ではなく**別の主張**
であり、この中のどれ 1 つとして機械が上流と突き合わせられるものはない。

### 1. 上流(入力)

| 上流 archive | sha256(ダウンロードで実測) |
|---|---|
| `https://github.com/yuru7/HackGen/releases/download/v2.10.0/HackGen_v2.10.0.zip` | `ed182e2a4b95792d94dea7932f6b45280b5ae353651be249d5f6b7867b788db7` |

archive 自体はコミットしていない。中身は TTF 8 本とディレクトリ 1 つだけで、**ライセンス
ファイルも README も 1 件も入っていない**(`python3 -m zipfile -l` で実測。このホストには
`unzip`/`7z`/`bsdtar` が無い)。取り出した 2 エントリは Console バリアントの Regular と Bold で、
そのハッシュが `manifest.json` の `srcSha256` の値であり、`run.sh` は**1 バイトも書く前に**
`--src-dir` に対して両方を照合する。

| archive エントリ | sha256(展開時に実測) |
|---|---|
| `HackGen_v2.10.0/HackGenConsole-Regular.ttf` | `72f550f90b49be633a9661f153b8c8398272785d9beda53dd5c400b61412a3ec` |
| `HackGen_v2.10.0/HackGenConsole-Bold.ttf` | `268a3fb847765aa12779e6021329e5aa33a45a6cb4c98ed0d40ee9d201d5d84a` |

上流プロジェクト: HackGen(白源) <https://github.com/yuru7/HackGen>。

#### ライセンス文書(archive に無いので上流リポジトリから取得)

リリース archive がライセンスファイルを持たないため、一次文書は上流リポジトリの **`v2.10.0`
タグ**から取得した(`font-packages/README.ja.md` がこの場合のために定めている経路。規範の正は
英語版 `font-packages/README.md`)。来歴は TTF と
同じく独立に実測した二列で記録する: 左は配置**前**の取得時、右は配置後のファイル。

| 取得元 URL | sha256(取得時) | 配置先 | sha256(配置後) |
|---|---|---|---|
| `https://raw.githubusercontent.com/yuru7/HackGen/v2.10.0/LICENSE` | `9bfc3b3826a9c71042b87fda90a19cda4918894cdbd449cab163b7a7c93c5aa7` | `licenses/LICENSE_HackGen` | `9bfc3b3826a9c71042b87fda90a19cda4918894cdbd449cab163b7a7c93c5aa7` |
| `https://raw.githubusercontent.com/yuru7/HackGen/v2.10.0/source/LICENSE_GenJyuuGothic` | `68b83948ea44760eaf1cefc59f0ce2a381bb0e307508e8f0e5e8df529ee04170` | `licenses/LICENSE_GenJyuuGothic` | `68b83948ea44760eaf1cefc59f0ce2a381bb0e307508e8f0e5e8df529ee04170` |
| `https://raw.githubusercontent.com/yuru7/HackGen/v2.10.0/source/LICENSE_Hack` | `1f61bb7c790c59b4b0ecdf304628b94e42ae4c8020094a8c3da73381ab212623` | `licenses/LICENSE_Hack` | `1f61bb7c790c59b4b0ecdf304628b94e42ae4c8020094a8c3da73381ab212623` |
| `https://raw.githubusercontent.com/yuru7/HackGen/v2.10.0/source/LICENSE_NerdFonts` | `1f6ad4edae6479aaace3112ede5279a23284ae54b2a34db66357aef5f64df160` | `licenses/LICENSE_NerdFonts` | `1f6ad4edae6479aaace3112ede5279a23284ae54b2a34db66357aef5f64df160` |
| (同じ取得済み `LICENSE`) | `9bfc3b3826a9c71042b87fda90a19cda4918894cdbd449cab163b7a7c93c5aa7` | `LICENSE.txt` 内へ OFL 1.1 本文を逐語引用 | — |

ルートの `LICENSE` が 2 行あるのは、**配置**と**引用**の両方をしているため: 配置したコピーは
二列の実測値を持ち、`LICENSE.txt` への引用はハッシュを取る配置ファイルが無いので規約どおり
`—` になる。引用は取得済み文書とバイト単位で一致することを確認済みで、それが右列の担っていた
主張と同じものである。

`licenses/LICENSE_NerdFonts` を **NF 版でないのに**同梱しているのは、推測ではなく実測に基づく:
出荷 face の `name` テーブル nameID 0 が Nerd Fonts を(`Copyright (c) 2014, Ryan L McIntyre`)
明記しており、それが上流からそのまま持ち越されているので、その表示が指す文書も一緒に運ぶ。
これはメタデータについての言明であってグリフについてではない —— アイコン集合は NF 版が足すもので、
こちらの私用領域は全部で 7 符号位置しかない。

### 2. 変換(入力を出力に変えたもの)

- **パイプライン**: このリポジトリの `scripts/font-fit/run.sh` を `scripts/font-fit/manifest.json`
  で駆動したもの(このパッケージはそこの 1 エントリで、そのファイルに載っていることが「変換
  パッケージである」ことの定義)。`fit.py` が作り直し、`verify.py` が結果を全数検査し、
  `dump-widths.mjs` が `@xterm/addon-unicode11` 自身のプロバイダからセル幅表を生成する(手書きの
  幅表は禁止)。`instance.py` は**このパッケージでは動いていない**: 上流の 2 面はどちらも静的で
  (`fvar` 不在・実測)、固定すべき軸が無い。
  **このパッケージを足すために必要だったのは `manifest.json` の 1 エントリだけで、スクリプトは
  1 行も変えていない** —— `run.sh` / `fit.py` / `verify.py` はどの書体名も知らない。設計 #271 R5 が
  狙っていた性質で、外部から来た書体でそれを実際に確かめた最初の事例がこのパッケージである。
- **どの変換器か——commit ではなく内容で同定する**。出力を決めるファイルの sha256:

  | パイプラインのファイル | sha256 |
  |---|---|
  | `scripts/font-fit/fit.py` | `c634881d418a59d68f1892db4d35f4fc66780a71cff277448cbef91479470bf7` |
  | `scripts/font-fit/instance.py` | `86240ac88d1dfa4527ebaa1e7e97caf6c656e97cd04833d12b21149d2fefe2af` |
  | `scripts/font-fit/verify.py` | `5c7d58d6a8ff4e4d248990c4bc39bcf379faee2fec9303ea3966c6ce1c5d9cf5` |
  | `scripts/font-fit/dump-widths.mjs` | `4813198fba79edb3d3086aa07b8808183a362406b1a1da9c7d614c5b90633a03` |
  | `scripts/font-fit/run.sh` | `4966ccca260ded4b1d7aa94fa71bc9802956363e9a646c788166ee530ab8c55a` |
  | `scripts/font-fit/manifest.json` | `0fed27ae2614fd0cbe570cde156bb4ed5ff32fe7a0a7c814b97d71acaf49629b` |

  `instance.py` を載せているのは、ここで動いたからではなく、実行結果を決めるパイプラインの
  一部だからである。**commit SHA では代用できない**: git SHA は内容アドレスなので、ファイルは
  自分を含む commit を名乗れない。記録しようとすると 2 commit に割る(sha256 束縛が前提にしている
  結合が壊れる)か、誰かが後で差し替える前提のプレースホルダを置く(忘れた瞬間に無音で出荷される)
  かのどちらかになる。**`manifest.json` の行は、このパッケージの追加が他の変換パッケージの
  README を同一 commit で書き換える理由でもある**: manifest はハッシュ対象の 1 つなので、
  エントリを 1 つ足すと旧値を書いた行が全部偽になる。
- **実測したツールバージョン**(`run.sh` が実行開始時に印字したもの。文書からの写しではない):

  | ツール | バージョン |
  |---|---|
  | fontTools | `4.63.0` |
  | Python | `3.14.4` |
  | `@xterm/addon-unicode11` | `0.10.0-beta.288` |

- **固定した環境**: `PYTHONHASHSEED=0`・`LC_ALL=C.UTF-8`・fontTools の保存は
  `recalcTimestamp=False`(`head.modified` が再計算されると毎回バイト列が変わり、下の出力ハッシュが
  無意味になる)。
- **この実行が何を変えたか**(面ごと・実測。`run.sh` の出力):

  | 出力 face | 作り直したグリフ | うち移動のみ / 縮小 | 元から適合 | 送り幅が変わったもの |
  |---|---|---|---|---|
  | Regular | 1723 | 956 / 767 | 1193 | 1656(すべて 1080 → 540) |
  | Bold | 1694 | 888 / 806 | 1201 | 1621(すべて 1080 → 540) |

  送り幅の列は、上流の設計上ここで必要になる段である: HackGen Console はこれらの東アジア
  曖昧幅記号を全角の送りで描くので、幅 1 と数える端末は 1 セルしか与えない。送り幅を `A` に
  することがそれを決着させる。これは**選ばれたグリフだけ**への変更で、それ以外の送り幅は
  1 つも動いていない(出荷ファイルと上流入力を差分して実測: 1656 件と 1621 件、それ以外は 0)。
- **この実行を駆動した `fitRatio`**: **1.15**(`manifest.json` のトップレベル既定。このパッケージは
  上書きを宣言していない)。`A × 1.15` = 540 ユニットのセルに対し 621 ユニットを超える ink は
  そこまで縮小される。値の意味と上限 1.5 は `scripts/font-fit/manifest.json` の `note` に定義が
  あり、ここでは繰り返さない。
- **この実行を駆動した `vstretch`**: **1.3**(同じくトップレベル既定・上書きなし)。縦の壁は
  宣言ではなく**面ごとの実測**で、漢(U+6F22)の**上端と下端** —— `run.sh` が印字したとおり
  Regular が `y = -72…856`、Bold が `-80…866`。clamp が効いたのは Regular が 1723 個中
  **987 個**、Bold が 1694 個中 **919 個**。そのうち 595 個 / 579 個は等倍の時点で余地が無く、
  伸長係数が clamp の下限 1.0 に留まった —— **伸びていないことは動いていないことではない**。
  既存 3 パッケージが「動いていない」と言えるのは比較の基準が自分の前リリース(#291 で横の
  refit は適用済み)だからで、このパッケージには前リリースが無いから基準は**上流**になる。
  上流と突き合わせた実測では、この 595 個 / 579 個のうち 1 ユニットも動いていないのは
  **8 個 / 11 個**だけである。残りは同じ工程で動いており、**133 個 / 152 個**は縦横とも縮み
  (`s < 1`)、それ以外は `s = 1` のまま中央へ寄せられたか送り幅を `A` にされている
  (送り幅が変わったもの 442 個 / 404 個・変わっていないもの 12 個 / 12 個)。測り方は、
  上流の面に対して `verify.py` の `selected_glyphs` で `fit.py` の選択を再現し、選ばれた各
  グリフの点列(`DecomposingRecordingPen`——契約② と同じ物差し)を出荷面と比較した。
  実際に縦へ伸びたのは **1723 個中 1128 個**と
  **1694 個中 1115 個**である —— 縦の変化は全称ではなく、数で言うのが誠実な言い方になる。
  作り直し対象のうち **593 個**(Regular)/ **577 個**(Bold)は等倍の時点で既に漢の箱の外にあり、
  **新しく外へ出たものはどちらの面にも無い**(Regular は 593 → 592 で、伸長はむしろ 1 個減らした)。
- **3 つのゲートは両面とも通過**(`verify.py`・変換器が実際に読んだ上流ファイルに対して、宣言値の
  倍率と伸長率で実行): **契約① —— 帯から外れる scope 内符号位置: 0**。scope 内の最大 ink は
  両面とも 1024 → 622(宣言 room は 621.0 で、622 は整数格子の着地点)。**契約② —— 輪郭が変わった
  本文グリフ: 各面 13,101 個中 0 個**。**契約③ —— 宣言した `vstretch` と実測した壁から導かれる
  上下端と食い違う作り直しグリフ: Regular 1723 個中 0 個 / Bold 1694 個中 0 個**。これは双方向の
  等式検査なので、違う伸長率で焼いたバイト列はどちら向きにずれても落ちる。式を再計算しない側の
  検査(③c)は両面とも**新しく壁の外へ出たグリフ 0 個**(最大超過 0.5 ユニット・許容 1)。
  *scope 内*は逃げ口上ではなく本質的な限定である: パイプラインは ASCII / Latin-1・BMP 私用領域・
  罫線とブロック要素・幅 1 以外を意図的に除外している(`font-packages/README.md`「Terminal width
  conventions」)。このパッケージはその実例を出荷している: 両面(`A` = 540)で `©`(U+00A9)は
  送り幅 540・ink `-1 … 541` —— 幅 1 で左右 1 ユニットずつセルの外へ出ており、正しく手を触れて
  いない。
- `name` テーブルの family / style は新名へ書き換えてある(`HackGen Console` →
  `ShirokumaGen Term`・nameID 3 に `; derived`)。**nameID 0(著作権)はバイト単位でそのまま
  持ち越している**(出力で再実測) —— 4 つの角括弧付き表示は `LICENSE.txt` §1 に引用してある。
  **スタイルビットは名前と一緒に動く**: `OS/2.fsSelection` の bit 5(BOLD)と bit 6(REGULAR)、
  `head.macStyle` の bit 0 を、継承ではなく style から導出する。出力の実測: Regular
  `fsSelection=0x0040` / `macStyle=0x0000`、Bold `fsSelection=0x0020` / `macStyle=0x0001`。上流の
  `fsSelection` は既に各面で正しいビットを立てていたが、`head.macStyle` の bit 0 は Bold でも
  `0x0000` のままだった —— 名前以外で変換が動かしたメタデータはこの 1 ビットだけである。
- **再現性は約束ではなく実測として記録する**: 同じマシンで、同じ入力から、上のツールバージョンで
  再実行したところ、バイト単位で同一の出力(下の sha256)が得られた。*別の* fontTools や Python に
  ついては何も主張しない —— 試していない。上で固定した 3 つ以外の環境変数の影響も同様。

### 3. 出力(出荷するもの)

配置後のファイルで実測し、`scripts/font-fit/checksums.json` にも同じ値を記録してある。
`npm test` が両者を突き合わせるので、TTF と記録は同一 commit でしか動かせない。記録された
`fitRatio` / `vstretch` は manifest の宣言とも突き合わされる。

| 配置先 | sha256(配置後) | fitRatio | vstretch |
|---|---|---|---|
| `fonts/ShirokumaGenTerm-Regular.ttf` | `a1ae61cd72e9ec6eb2869e4581adcb1f56f99f08bb9e6b2d232f09b50bccdcf7` | `1.15` | `1.3` |
| `fonts/ShirokumaGenTerm-Bold.ttf` | `c31cd509f2a909fc799e28a0c0948842c00a089f4ee332028a0a3f5463b936ea` | `1.15` | `1.3` |

### 予約フォント名(Reserved Font Name)の確認(実測)

OFL 1.1 §3 は Modified Version が予約フォント名を名乗ることを禁じているので、変換パッケージは
自分の名前を決める**前に**どの名前が予約されているかを確定しなければならない。確認は
`scripts/font-fit/check-license.py` で行う(手組みの `grep` ではない): パッケージ配下の全ファイルを
列挙し、テキスト / フォント / バイナリを**ファイル名ではなく先頭バイト**で判別し、フォントを
開いて `name` テーブルを読む —— `font-packages/README.md` が挙げる 3 つの落とし穴に対応しており、
うち 1 つはファイル検索では原理的に到達できない。

```sh
~/.local/share/fonttools-venv/bin/python scripts/font-fit/check-license.py \
  font-packages/font-shirokumagen --derived-name 'ShirokumaGen Term'
```

終了ステータス **0**。道具が印字した全行(逐語):

```
走査: テキスト 7 / フォント 2 / バイナリ除外 1 / 拡張子で除外 0 / 読めず 0 / name レコード decode 失敗 0
バイナリとして飛ばしたパス（中は見ていない・zip は展開しない）:
  - font-packages/font-shirokumagen/icon.png
記録ファイルとして外したパス（README.md / README.ja.md——この検査の記録そのもの。読ませるなら --all-files）:
  - font-packages/font-shirokumagen/README.ja.md
  - font-packages/font-shirokumagen/README.md
一致行: 10

--- 一致行（全行・省略なし）---
font-packages/font-shirokumagen/LICENSE.txt:79: RESERVED FONT NAME note at the end of section 1.
    予約名候補: （宣言なし——散文・定義文）
font-packages/font-shirokumagen/LICENSE.txt:109: Copyright (c) 2019, Yuko OTAWARA. with Reserved Font Name "白源", "HackGen"
    予約名候補: '白源', 'HackGen'
font-packages/font-shirokumagen/LICENSE.txt:118: RESERVED FONT NAME: the HackGen line above reserves "白源" and "HackGen" (OFL
    予約名候補: '白源', 'HackGen', 'the HackGen line above reserves', 'OFL'
font-packages/font-shirokumagen/LICENSE.txt:121: contains neither. Four reserved font names are declared anywhere in this
    予約名候補: （宣言なし——散文・定義文）
font-packages/font-shirokumagen/LICENSE.txt:216: "Reserved Font Name" refers to any names specified as such after the
    予約名候補: （宣言なし——散文・定義文）
font-packages/font-shirokumagen/licenses/LICENSE_GenJyuuGothic:33: "Reserved Font Name" refers to any names specified as such after the
    予約名候補: （宣言なし——散文・定義文）
font-packages/font-shirokumagen/licenses/LICENSE_Hack:5: Bitstream Vera Sans Mono Copyright 2003 Bitstream Inc. and licensed under the Bitstream Vera License with Reserved Font Names "Bitstream" and "Vera"
    予約名候補: 'Bitstream', 'Vera'
font-packages/font-shirokumagen/licenses/LICENSE_HackGen:10: Copyright (c) 2019, Yuko OTAWARA. with Reserved Font Name "白源", "HackGen"
    予約名候補: '白源', 'HackGen'
font-packages/font-shirokumagen/licenses/LICENSE_HackGen:42: "Reserved Font Name" refers to any names specified as such after the
    予約名候補: （宣言なし——散文・定義文）
font-packages/font-shirokumagen/licenses/LICENSE_NerdFonts:66: "Reserved Font Name" refers to any names specified as such after the
    予約名候補: （宣言なし——散文・定義文）

--- 予約名: 引用符で宣言されたもの 4 件 ---
  'Bitstream'  ← font-packages/font-shirokumagen/licenses/LICENSE_Hack:5
  'HackGen'  ← font-packages/font-shirokumagen/LICENSE.txt:109, font-packages/font-shirokumagen/LICENSE.txt:118, font-packages/font-shirokumagen/licenses/LICENSE_HackGen:10
  'Vera'  ← font-packages/font-shirokumagen/licenses/LICENSE_Hack:5
  '白源'  ← font-packages/font-shirokumagen/LICENSE.txt:109, font-packages/font-shirokumagen/LICENSE.txt:118, font-packages/font-shirokumagen/licenses/LICENSE_HackGen:10

--- 引用符なしで拾った候補: 2 件（宣言のことも過剰捕捉のこともある・判定には同じく使う）---
  'OFL'  ← font-packages/font-shirokumagen/LICENSE.txt:118
  'the HackGen line above reserves'  ← font-packages/font-shirokumagen/LICENSE.txt:118
  ↑ 照合に使う予約名は上下あわせて 6 件。散文由来の候補は出所の行を見て人が捨てる（落とすより拾いすぎる側に倒してある）。

--- 派生名の判定（部分文字列・NFKC + casefold）---
  'ShirokumaGen Term': どの予約名も含まない → OK （照合した予約名 6 件）
```

日本語名についても同じ検査を実行する(§3 が縛るのは「利用者に提示される主たるフォント名」で、
言語を問わないため)。終了ステータス **0**、判定行の逐語:

```
--- 派生名の判定（部分文字列・NFKC + casefold）---
  '白熊源': どの予約名も含まない → OK （照合した予約名 6 件）
```

**記録の読み方。** **引用符付き**の群が宣言である: `"白源"` と `"HackGen"`(上流自身のもの・
`licenses/LICENSE_HackGen:10`。このパッケージの `LICENSE.txt` でも再掲)、および Hack 文書が
Bitstream Vera License を再録していることで入ってくる `"Bitstream"` と `"Vera"`。**引用符なし**の
群は道具の意図的な過剰捕捉で、`'OFL'` と語句の断片 `'the HackGen line above reserves'` の 2 件 ——
どちらもこのパッケージ自身の結論を述べた散文行から拾われている。判定には他の候補と同じく使い、
潰さずに記録する。どちらも「このパッケージがその名前を予約している」という主張ではない。
**`name` テーブル由来の行は 1 つも無い**: 出荷 2 面の nameID 0 は 4 件の著作権表示を持つが
`with Reserved Font Name` 節は持たない(実測)。つまり `grep` では到達できない段が、ここでは
何も見つけなかった。その段が実行されていること自体が、これを「未検証の仮定」ではなく「結果」に
している。

`ShirokumaGen Term` も 白熊源 も、6 件の候補のどれも含まない。予約名は、派生名を機械的に
`HackGen Console Term` としなかった理由でもある —— 上流の family に `Term` を足すだけの名前は、
予約フォント名を含む名前を公開することになる。**`Console` が落ちているのは別の理由**で、
命名規則(`font-packages/README.ja.md`「出荷する family 名の導き方」。規範の正は英語版
`font-packages/README.md` の "How a shipped family name is derived")による:
決め手はその語が**何を言っているか**であって、`Console` は「端末向けに整えた側」という
上流の目印 —— つまり ` Term` が主張する性質そのもの —— なので、二重に同じことを言うことに
なる。(`M PLUS 1 Code` の `Code` は**どの書体か**を言っている。プロポーショナルな
`M PLUS 1` に対する等幅の兄弟という意味なので、あちらでは残す。)規則とその限界
——「その語を取り除いた名前を上流が publish しているか」が決定手順ではなく傍証にすぎない
理由を含む —— は、この節ではなく当該節に書いてある。改名で変わるのは `name` テーブルだけである:
同じ入力・同じ `fitRatio` / `vstretch` で同じパイプラインを流し直しており、全グリフの輪郭と
`hmtx` は #289 のバイト列と一致した(実測・面あたり 19,795 / 19,797 グリフ全数。他に動いた
バイトは `head.checkSumAdjustment` のみで、これはファイル全体の checksum そのもの)。

## family 名(実測・推測ではない)

出荷する変換後のファイルで実測。`name` テーブルの直読み:

| フィールド | `ShirokumaGenTerm-Regular.ttf` | `ShirokumaGenTerm-Bold.ttf` |
|---|---|---|
| nameID 1(family) | `ShirokumaGen Term` | `ShirokumaGen Term` |
| nameID 2(subfamily) | `Regular` | `Bold` |
| nameID 3(unique ID) | `ShirokumaGen Term Regular; derived` | `ShirokumaGen Term Bold; derived` |
| nameID 4(full name) | `ShirokumaGen Term Regular` | `ShirokumaGen Term Bold` |
| nameID 6(PostScript) | `ShirokumaGenTerm-Regular` | `ShirokumaGenTerm-Bold` |
| `OS/2.usWeightClass` | `400` | `700` |
| `fvar` | 不在(静的) | 不在(静的) |

どちらの面も nameID 16 / 17 の対を持たない。family は nameID 1 で、2 面で一致している ——
これが 2 面を 1 つの CSS `font-family` にまとめてよい根拠である。**注入はこれに依存しない** ——
`@font-face` は family 名を*宣言*するのであって読み取らないし、CSS の font matching はファイル
内部の名前を参照しない。機構の説明は `font-packages/README.ja.md`(規範の正は英語版
`font-packages/README.md`)にある。この表はフォントについての
証拠であって、機構についての証拠ではない。

`ShirokumaGen Term` はこの拡張機能の `providedFont.family` が持つ値で、消費側の
レジストリ(tmux-opener の `FONT_REGISTRY`)の項と一致し続けなければならない。

## 等幅メトリクス(実測)

リポジトリルートの `npm test`(`test/font-metrics.test.js`)が**このパッケージの各 TTF** を検査
する(glob なので bold 面も毎回 assert される):

- unitsPerEm 1024。ASCII の印字可能符号位置 0x21–0x7E がすべて cmap にあり、送り幅 **A = 540** を
  共有する。
- 全角サンプル 一 / 漢 / あ / ん / ア はいずれも **1080 = 2A**。
- 2 面が互いに一致する: unitsPerEm も A も同じ。

**何が変わり、何が変わっていないか**を正確に言う価値がここにはある。`font-mplus1code` とは
逆の事例だからである:

- **変換は選んだグリフの送り幅をセル幅にする**。ここではそれが Regular で 1656 回、Bold で
  1621 回起きた —— すべて 1080 → 540(上流入力との差分で実測)。上流はこれらの曖昧幅記号を全角で
  設計しており、端末はそれを 1 列と数える。
- **それ以外は動いていない**。どちらのファイルでも他の送り幅は上流と一致し、本文グリフは輪郭も
  無傷である —— 「取得元」の契約②、グリフごとに検証済み、各面 13,101 個中 0 個。
- **升目は動かない**: A は前後とも 540、全角グリフは 1080 のまま、gid 0(この面での実名は
  `.notdef#0#0#0`。`font-packages/README.md` が規則をグリフ名ではなく **gid 0** で述べているのは
  このためである)も 540。
  最後の 1 つが効くのは、cmap に無い符号位置が gid 0 に解決されるためで、その幅を読む実装は
  未収録の記号をすべて「半角で問題なし」と報告してしまう。

## 収録範囲(実測・変換にできないこと)

出荷面と上流面に対する `scripts/font-fit/survey.py` の結果:

- cmap の符号位置数は **18,201**(Regular)/ **18,180**(Bold) —— このリポジトリが同梱する
  family の中で最大である。
- survey がサンプルする日常記号 26 件は、両面とも **26 件すべて収録されている**(`—`(未収録)の
  行が 1 つも無い)。ここが変換に供給できない側である: **作り直しはグリフを動かすだけで、
  1 つも増やせない**。収録していない記号は収録していないままで、OS のフォールバックが描く。
- 変換前は 26 件中 **14 件**がセルに収まらず、その*原因*は圧倒的に(14 件中 13 件)輪郭の乱れではなく
  送り幅の側にある ——
  これはまさに `fit.py` が決着させる形である。実測どおりに言うと: 14 件のうち **13 件**が全角の
  送り幅(2A = 1080)を持ち、その 13 件は ink 条件でも必ず落ちる(1080 ユニットの送り幅に描かれた
  ink が 540 ユニットの箱に収まることはない)。残る 1 件は `‰`(U+2030)で、送り幅は既に 540、
  ink は `-1…541` —— 落ちるのは ink 条件だけである。**ただしそれは「手を触れていない」と
  同義ではなく、出荷バイトは上流と一致しない。** 左右 1 ユニットずつのはみ出しを許すのは
  `verify.py` の契約①であって、`fit.py` の「既に適合」判定はそれより厳しい別物であり
  (`x0 >= 0 かつ x1 <= A かつ …`)、`x0 = -1` はこれを外すので `‰` は変換対象に入る。
  対象に入っても横は動かない —— ink は `room`(540 × 1.15 = 621)に十分収まるので横倍率は
  `s = 1.0`、送り幅も 540 のままである —— が、縦倍率は掛かり、実際に伸びた: 上流面に対する
  実測で制御点箱は Regular が `(-1, 0, 541, 695)` → `(-1, -72, 541, 767)`、Bold が
  `(-1, 0, 541, 695)` → `(-1, -80, 541, 775)` で、縦の中心(347.5)は保存されている。
  変換後は scope 内の符号
  位置で送り幅条件を外すものが **0** 件になった(実測: Regular は scope 内 2916 件中 `adv≠箱` 0、
  Bold は 2895 件中 0)。
- survey の `○` 列は変換の契約より厳しく、変換の前後で動かない: `○` は ink が `[0, A]` に収まる
  ことを要求するが、契約は ink がセル中央基準で `A × 1.15` まで出ることを許す。したがって同じ
  14 件は変換後も `△` のままである —— ただし中身は「1 セルに押し込まれた全角グリフ」から
  「左右対称で上限つきのはみ出し」に変わっている。この列を「変換が何もしなかった」と読まないこと。
  読むべきは上の送り幅の数字である。

## この規約について

繰り返すが、VS Code にはフォントを拡張機能間で共有する**公式機構は存在しない**。借用手順は
供給側(この拡張機能)と消費側(tmux-opener 等)の間で取り決めた非公式の自前規約であり、
`providedFont` 契約フィールドがその合意の正本、`font-packages/README.ja.md`(規範の正は英語版
`font-packages/README.md`)が規約の*説明*の正本で
ある。契約フィールドの形やフォントファイルの位置を変えるときは、消費側が無音で壊れることを
念頭に、両側を一緒に更新すること。
