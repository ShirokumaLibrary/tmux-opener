# Mgen+ 1mn Term (font resource for extensions)

*[English](README.md)*

拡張機能 ID: `shirokuma-library.font-mgenplus-1mn`

Mgen+ 1mn Term フォントを **他の拡張機能へ供給する** ための汎用フォントリソース拡張機能。
この拡張機能自体は UI もコマンドも持たず(`contributes` は空、`activationEvents` も空、`main`
は no-op)、**フォントを OS にはインストールしない**。同梱した TTF を、消費側の拡張機能が
自分の webview から `vscode-resource` 経由で読み込めるようにすることだけを目的とする。

**Mgen+ 1mn Term は Mgen+ 1mn の改変版**で、端末向けに作り直してある: 端末が
「幅 1 列」と数える記号を、レンダラが横に潰す幅より下へ収めてある: ink がセル幅の
**1.15 倍**を超える輪郭はちょうどその幅まで縮小し、セルからはみ出す輪郭は
セルの中央へ置く。したがってはみ出しは左右対称で、512 ユニットのセルに対し片側 38
ユニット(約 7.5%)を超えない。**記号が隣のセルにわずかに掛かることはある**——決して
起きないのは「潰される」ことのほう。送り幅はこれに含まれない: 升目は動かず、この
ファイルの `hmtx`(Regular 面 18,109 グリフ全部の advance と lsb)は直前の #291
リリースとバイト単位で一致する(実測)。倍率そのものの意味・上限 1.5・なぜ 1.15 かは
`scripts/font-fit/manifest.json` の `note` に 1 箇所だけ定義がある。

**縦と横は別倍率である**(#293 以降): 横を `s` に縮めるとき、縦は面が許す範囲で `s × 1.3` まで伸ばす。
`①` をセル幅まで縮めると高さも 588 ユニットになり、同じ面の cap height 748(実測)を
下回っていた —— 「小さく見える」の主因は幅ではなく高さで、横にはもう伸ばす余地が無い。
伸長は**この面から実測した壁**でグリフごとに clamp する —— 漢(U+6F22)の ink の
**上端と下端**で、Regular が `y = -78..843`・Bold が `-95..847`。伸ばした結果が
その内側にとどまるよう伸長係数を抑える。**縛るのは ink の高さではなくグリフの到達**
である: この変換は縦の中心を保存するので、高さだけを抑えても、中心が漢とずれたグリフは
行の外へ出てしまう。したがって出荷バイトについて真になるのは**条件つきの言明**である
—— この変換はグリフを漢の上端・下端より外へ出さない。等倍の時点で既に外にいるグリフは
直前リリースの姿のまま 1 ユニットも動かない(実測: どちらの面も新しく外へ出たグリフは
**0 個**)。「漢がすでに持っている以上には食い込まない」とは**主張していない** ——
この書体には元から漢より高く届く記号があり、Regular では作り直した 1001 個のうち
**141 個**が等倍の時点で既に漢の箱の外にいる。clamp の下限は 1.0 なので、**作り直した
グリフが必ず縦に伸びるわけではない**: 出荷バイトの実測で、伸びたのは Regular が
1001 個中 **857 個**、Bold が 1020 個中 **899 個**。残りは等倍の時点で伸ばす余地が
無く、1 ユニットも動いていない。`1.3` は 5 段階を焼いて人が選んだ値であって、近い値をとる cap height 比
(748 / 588 = 1.272)から**導出した値ではない**。意味・実測上限・既定は同じ `note` に
定義がある。ASCII・Latin-1 は対象外
(レンダラが縮小しない範囲であり、対象にすると本文まで作り直すことになる)で、
box drawing / block / 私用領域も同様——正確な対象範囲は `font-packages/README.md` に
ある。それ以外の輪郭には手を触れていない。どのアーカイブから、何で変換し、出力が何のハッシュになったかの三段連鎖は後述の
「取得元(provenance)」にある。

## 同梱フォント

| family(実測) | ファイル | weight | ライセンス |
|---|---|---|---|
| `Mgen+ 1mn Term` | `fonts/MgenPlus1mnTerm-Regular.ttf` | `400`(静的フォント・可変軸なし) | OFL-1.1 |
| `Mgen+ 1mn Term` | `fonts/MgenPlus1mnTerm-Bold.ttf` | `700`(静的フォント・可変軸なし) | OFL-1.1 |

同一 family の 2 face。どちらも同じ上流配布物の対応する face から変換した別々の静的 TTF。

`family` は想定値ではなく name table の **実測値**(下記「family 名」節)。各 `weight` は
**範囲ではなく単一値**で宣言している: これらは静的フォントであり、範囲宣言はその範囲を
カバーするという*主張*だから。`100 700` を宣言した face は xterm の bold セルにも「本物」と
して選ばれてレギュラーの太さで描かれる——つまり範囲宣言は太字を作るのではなく
**合成太字を抑止する**。実物の 700 face を同梱するのはまさにそのためで、宣言(主張)ではなく
実際に太いグリフで 700 を埋める(#249)。

上の表の `weight` はいずれも省略せず明示している。省略した場合の帰結は**どちらの宣言形から
省いたか**で異なり、その 2 つの規則は全 package 共通の記述として契約仕様の単一正本
`font-packages/README.ja.md`(規範の正は英語版 `font-packages/README.md`)に一度だけ
書いてある。

著作権表示とライセンス全文は
`LICENSE.txt`、配布物そのままのライセンス本文は `fonts/SIL_Open_Font_License_1.1.txt` を参照。

## 著作権と帰属(3 者)

Mgen+ は M+ OUTLINE FONTS に無いグリフを源ノ角ゴシックで補ったフォントであり、3 者を掲げる。
**どの記述が何を支えているかは以下で分けて書く** —— 3 者のうち 2 者は一次情報が著作権者として
逐語で名指ししているが、残る 1 者はそうではないため。

### 著作権者(逐語引用)

同梱 TTF 自身の `name` テーブル nameID 0(copyright)。Macintosh(platform 1 / encoding 0 /
language 0x0)と Windows(platform 3 / encoding 1 / language 0x409)の両レコードで内容は同一で、
さらに regular / bold の 2 face 間でもバイト単位で同一(実測)——したがってこの 1 つの引用が
両方を覆う。変換は family / style 名を書き換えるが **nameID 0 はバイト単位でそのまま通す**
(配置後のファイルで再実測・#275)ので、これは OFL §2 が言う machine-readable な
著作権フィールドそのもの、上流から変わっていない:

```
[Source Han Sans]
Copyright © 2014, 2015 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'.

[M+ OUTLINE FONTS]
Copyright(c) 2015 M+ FONTS PROJECT
```

配布物同梱の README(`fonts/README_MgenPlus.txt` の「ライセンスと著作権について」節・無改変で
同梱)も、同じ 2 者を日本語で名指ししている:

```
・フォントデータに含まれる、源ノ角ゴシック由来の文字グリフの著作権は Adobe が所有しています。
・フォントデータに含まれる、M+ OUTLINE FONTS 由来の文字グリフの著作権は M+ FONTS PROJECT が所有しています。
```

Adobe の行にある **Reserved Font Name `'Source'`**(OFL §3)に注意。このパッケージは
**改変版そのもの**なので §3 は正面から適用され、かつ満たされている —— face が宣言する名前
(`Mgen+ 1mn Term`)は予約名を含まない。このパッケージのライセンス本文で宣言されている RFN は
`'Source'` だけで、その実測記録は後述の「取得元(provenance)」にある。このフォントに由来する
ものを `'Source'` を含む名前で頒布することはできない。

### 3 者目: 自家製フォント工房 (Jikasei Font Studio)

自家製フォント工房については、name テーブルにも README の著作権節にも逐語の著作権表示は無い。
ここで掲げているのは **合成されたフォント本体の制作者・頒布元** としての帰属 —— 2 つの上流
グリフセットを選び・統合し・調整して Mgen+ にした仕事 —— であり、配布物はこれを**別の節**、
「■ 頒布元」(`fonts/README_MgenPlus.txt` 90 行目)で示している:

```
自家製フォント工房
http://jikasei.me/
```

これは著作権表示の逐語引用ではなく、制作・頒布の主体としての帰属として読むこと。

### ライセンスとリンクについて

フォントのライセンスは **SIL Open Font License, Version 1.1**(全文は `LICENSE.txt`。その OFL
本文は配布物同梱の `fonts/SIL_Open_Font_License_1.1.txt` とバイト一致)。上流グリフが依拠する
M+ OUTLINE FONTS のライセンスは `fonts/mplus-TESTFLIGHT-059/LICENSE_E` / `.../LICENSE_J` に、
アーカイブ内の元パスのまま(平坦化せず)同梱してあり、どのファイルに対するライセンスかが
曖昧にならないようにしてある。

参考リンク: Mgen+ <http://jikasei.me/font/mgenplus/>、源ノ角ゴシック
<https://github.com/adobe-fonts/source-han-sans>、M+ FONTS PROJECT
<http://mplus-fonts.osdn.jp/>。**これらは現行の URL であって配布物からの引用ではない** ——
配布物の「■ 改変元」節が挙げているのは `http://mplus-fonts.sourceforge.jp/` と Adobe ストアの
製品ページ
(`http://store1.adobe.com/cfusion/store/html/index.cfm?store=OLS-JP&event=displayFontPackage&code=1967`)
で、いずれも移転済み。

## 利用範囲の限界: `editor.fontFamily` / `terminal.integrated.fontFamily` では使えない

**この方式で供給されるフォントは、VS Code の設定(`editor.fontFamily` や
`terminal.integrated.fontFamily`)にフォント名 `Mgen+ 1mn Term` を書いても使えない。**
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
- したがってこの仕組みが使えるのは、**消費側拡張機能自身が独自の webview を持っていて、そこに
  借用手順を自前で実装している場合に限る**。エディタや標準ターミナルでこのフォントを
  使いたい場合は、フォントを OS へ実インストールする以外の手段がない。

## 他拡張機能からこのフォントを利用する方法(規約)

**注意**: これは VS Code の公式な拡張機能間フォント共有の仕組みではない。**そのような公式機構は
存在しない。** 以下は非公式の自前規約であり、この拡張機能の ID と `package.json` の
`providedFont` 契約フィールドの形をそのまま前提にする。将来この拡張機能側でファイル配置・ID・
契約フィールドを変更すると、消費側は無言で壊れる。

契約の本体は `package.json` の `providedFont` フィールド:

```json
"providedFont": {
  "family": "Mgen+ 1mn Term",
  "file": "fonts/MgenPlus1mnTerm-Regular.ttf",
  "weight": "400",
  "faces": [
    { "file": "fonts/MgenPlus1mnTerm-Regular.ttf", "weight": "400" },
    { "file": "fonts/MgenPlus1mnTerm-Bold.ttf", "weight": "700" }
  ],
  "license": "OFL-1.1"
}
```

`faces` は family の全 face を宣言順に並べたもので、読める消費側はエントリごとに `@font-face` を
1 つずつ注入する。フラットな `file` / `weight` の対は **単一 400 face の略記** として残しており、
値は先頭エントリと同一。旧来の 1 ファイル契約を前提に書かれた消費側はそのまま動き続ける
(bold face を受け取らないので、この package が bold を同梱する前と同じく合成太字にフォール
バックするだけ)。

**それを消費側がどう読むか——2 つの宣言形・どちらが正か・正規化と縮退の規則・コード付きの
借用手順——は同じリポジトリの `font-packages/README.ja.md`(規範の正は英語版
`font-packages/README.md`)が単一正本。本節はこの package が
何を宣言しているかだけを記録する。** tmux-opener 本体の `src/font-registry.ts` / `getHtml` が
消費側の実装例。

## 取得元(provenance): 上流アーカイブ → 変換 → 出力

> 英語版の対応節は `README.md` の
> `## Provenance (upstream archive → conversion → output)`。機械照合の対象は
> `README.md` の見出しのみで、この日本語版は訳文として扱われる。

**このパッケージが同梱する 2 本の TTF は変換出力であり、上流のバイト列ではない。**
#275 までは配布物のバイト列そのままを配置しており、その規約が伴う 2 列 sha256 表が
provenance の証明のすべてだった: アーカイブ内エントリのハッシュと配置ファイルのハッシュが
一致することが「上流が公開したものと同一」を意味した。改変ファイルにはその証明が使えない
—— 比較対象である上流 TTF がこのリポジトリに存在しないため。代わりに **三段連鎖**(各段とも
実測)で置き換える: 入力がどこから来たか、何が入力を出力に変えたか、出力のハッシュは何か。
これは旧規約の安価版ではなく別種の主張である —— 「このバイト列がどう作られたか」の記録で
あって、その中に上流と機械照合できるものは無い。

同梱するライセンス・README 文書は **従来どおりバイト列そのまま**配置しており、2 列規約が
そのまま適用される(変換対象ではない)。

### 1. 上流アーカイブ(入力)

- **配布**: Mgen+ 1.059.20150602、公式アーカイブ `mgenplus-1m-20150602.zip`
- **URL**: `https://ftp.iij.ad.jp/pub/osdn.jp/users/8/8592/mgenplus-1m-20150602.zip`
  (OSDN の IIJ ミラー。上流プロジェクトページは `http://jikasei.me/font/mgenplus/`)
- **アーカイブ**: 29,504,415 バイト、`Last-Modified: Wed, 03 Jun 2015 14:17:54 GMT`、
  sha256 `fae75318098697f165d74c5c4297805dfcfa335e09b0c31175ed299663c4c009`
  (アーカイブ自体は **コミットしていない**)
- **展開**: python3 標準ライブラリの `zipfile`(このホストには `unzip`/`7z`/`bsdtar` が無い)。
  どちらのアーカイブに `1mn` が入るかは **仮定していない**: `users/8/8592`(`-1m-`)と
  `users/8/8593`(`-1-`)の両方を列挙し、`mgenplus-1mn-regular.ttf` は `-1m-` 側にあった
  (42.9MB のアーカイブは不要だった)。

下記のエントリ sha256 は `scripts/font-fit/manifest.json` が `srcSha256` として持つ値と同一で、
`run.sh` は **1 バイトも書く前に** `--src-dir` 内の全 face をこの値と突き合わせる —— 入力の
取り違えは、もっともらしい出力ができる前にそこで落ちる。

| アーカイブ内エントリ | sha256(展開時) |
|---|---|
| `mgenplus-1mn-regular.ttf` | `52098e94e7e3673ea1457179d9841754ce07044868d146ecacf606464e8486f3` |
| `mgenplus-1mn-bold.ttf` | `1d720fb23c0362240836547ef8ebe889db8234cee4c432568f568af5c8c4af97` |

### 2. 変換(入力を出力に変えたもの)

- **パイプライン**: 本リポジトリの `scripts/font-fit/run.sh`。駆動は
  `scripts/font-fit/manifest.json`(このパッケージはその 1 エントリ。この manifest に載って
  いることが「変換出力パッケージである」ことの定義)。`fit.py` が変換本体、`verify.py` が
  ゲート、`dump-widths.mjs` が `@xterm/addon-unicode11` 自身のプロバイダからセル幅表を生成する
  —— 手書きの幅表は禁止。
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
- **実測ツールバージョン**(`run.sh` が実行冒頭で印字したもの。文書からの転記ではない):

  | ツール | バージョン |
  |---|---|
  | fontTools | `4.63.0` |
  | Python | `3.14.4` |
  | `@xterm/addon-unicode11` | `0.10.0-beta.288` |

- **固定した環境変数**: `PYTHONHASHSEED=0`、`LC_ALL=C.UTF-8`、および fontTools の保存を
  `recalcTimestamp=False` で行う(`head.modified` を再計算すると実行のたびに別バイト列になり、
  下記の出力ハッシュが無意味になる)。
- **実行を駆動した `fitRatio`**: **1.15**(`manifest.json` のトップレベル既定。この
  パッケージは上書きしていない)。ink がセル幅 512 の 1.15 倍 = 588.8 ユニットを超える輪郭を
  そこまで縮小する。値の意味と上限 1.5 は `scripts/font-fit/manifest.json` の `note` に
  1 箇所だけ定義があり、ここでは繰り返さない。
- **実行が何を変えたか**(face ごと・`run.sh` の実測報告):

  | face | 直したグリフ | うち移動のみ / 縮小 | 元から適合 |
  |---|---|---|---|
  | Regular | 1001 | 250 / 751 | 1344 |
  | Bold | 1020 | 232 / 788 | 1327 |

  倍率 0.96 だった前リリースと比べ「移動のみ」が増え「縮小」が減っている: 1.15 では
  room がセルより広いので、ink が 588.8 に収まるグリフは縮小されず中央へ寄せられるだけになる。

- **実行を駆動した `vstretch`**: **1.3**(`manifest.json` のトップレベル既定。この
  パッケージは上書きしていない)。縦の壁は宣言値ではなく **face ごとの実測値** —— 漢
  (U+6F22)の ink の**上端と下端**で、`run.sh` の印字どおり Regular `y = −78…843`・
  Bold `−95…847`。clamp が効いたのは Regular が 1001 個中 **357 個**、Bold が
  1020 個中 **284 個**。うち Regular 144 個・Bold 121 個は等倍の時点で伸ばす余地が無く、
  **1 ユニットも動いていない**(clamp の下限が 1.0)。したがって実際に縦へ伸びたのは
  **1001 個中 857 個**と **1020 個中 899 個**である。作り直した対象のうち Regular
  **141 個**・Bold **121 個**は等倍の時点で既に漢の箱の外にあり、**新しく外へ出た
  グリフはどちらの面も 0 個**(同じ上流を `vstretch = 1.0` で焼いたバイトとの実測比較)。
  横はこれに一切影響されない:
  `hmtx` は Regular 18,109 / Bold 18,106 グリフすべてが #293 前のリリースとバイト一致
  (実測)で、対象内の最大 ink も 588 のまま。
- **両 face とも 3 つの契約を通過**(`verify.py`・変換器が実際に読んだ上流ファイルと、
  宣言した倍率・伸長率で突き合わせ):
  **契約① 宣言した帯(ink ≤ `A × 1.15`・はみ出すときは中央対称・advance は `A`)から
  外れる対象符号位置 0**。対象内の最大 ink はちょうど宣言 room に着地する
  (Regular 1024 → 588・Bold 1032 → 588)。**契約② 本文グリフ 13,101 個中
  輪郭が変わったもの 0**。**契約③ 宣言した `vstretch` と実測の壁(この face 自身の
  漢 の y 到達範囲)から決まる上下端と
  食い違う変換グリフ 0**(Regular 1001 個中 0・Bold 1020 個中 0)。契約③ は等式なので、
  違う伸長率で焼いたバイトはどちら向きにずれても落ちる。式を再計算しない側の検査
  (③c)でも、**新しく壁の外へ出たグリフは両 face とも 0**。併せて「対象のうちはみ出していたグリフには全部届き、宣言どおりの
  ところまでで止まり、それ以外には触っていない」を意味する。「対象範囲」は逃げではなく仕様で、ASCII / Latin-1・BMP 私用領域・
  box drawing / block・幅 1 でないものをパイプラインが意図的に除外している
  (`font-packages/README.md` の "Terminal width conventions")。Latin-1 のグリフが送り幅を
  はみ出していても、この 0 件の外側にあるのは設計どおり。
- `name` テーブルの family / style 名は書き換わる(`Mgen+ 1mn` → `Mgen+ 1mn Term`)が、
  **nameID 0(著作権)はバイト単位でそのまま**(出力側で再実測・上に引用)。
- **再現性は「主張」ではなく「実測」として**: 同一マシン・同一入力・上記ツールバージョンで
  再実行し、バイト単位で同一の出力(下記 sha256)を得た。*別バージョン* の fontTools / Python
  については何も主張しない —— 検証していないため。上記 3 点以外の環境変数の影響も未検証。

### 3. 出力(同梱物)

配置後のファイルで実測し、同じ値を `scripts/font-fit/checksums.json` に記録している。#276 以降は
`npm test` が両者を突き合わせるので、TTF と記録は同一コミットでしか動かせない。#291 以降は
sha256 の隣に焼いた `fitRatio` を、#293 以降は `vstretch` も記録し、`npm test` はそれらを
manifest の宣言とも突き合わせる。

| 配置先 | sha256(配置後) | fitRatio | vstretch |
|---|---|---|---|
| `fonts/MgenPlus1mnTerm-Regular.ttf` | `05973b8cb602325d735b27293df5cf103d90fb23192a737f2811e78bf9028adf` | `1.15` | `1.3` |
| `fonts/MgenPlus1mnTerm-Bold.ttf` | `c8f0fd9be1d08905ce28859b647912ba8fa5dd0ff2834ca61b2520d6338d953d` | `1.15` | `1.3` |

### Reserved Font Name の確認(実測)

OFL 1.1 §3 は改変版が Reserved Font Name を名前に含むことを禁じるので、変換パッケージは
自分の名前を決める **前に** どの名前が予約されているかを確定しなければならない。同梱の
ライセンス本文すべてに対する実測:

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
  font-packages/font-mgenplus-1mn/LICENSE.txt \
  font-packages/font-mgenplus-1mn/fonts/
```

**2 つのフラグとパス指定はいずれも効いている**。そして #275 で 3 つとも一度ずつ間違えた:

- **`-i`** —— OFL 本文はこの語句を title-case(`Reserved Font Name`)で書くが、節見出しが
  大文字で叫ぶことがあり、case-sensitive な grep はその行を無言で落とす。本表の最初の版が、
  まさにこのパッケージの結論を述べている `LICENSE.txt:62` を落としていたのがそれ。
- **`--include='*.txt'` ではなくパス列挙** —— このフォントが由来する M+ のライセンス文書は
  `LICENSE_E` / `LICENSE_J` という **拡張子なし**で同梱されているため、`*.txt` フィルタは
  それらを読み飛ばす。一方で本文は「同梱のライセンス本文すべて」を検索したと言っている。
  `LICENSE.txt` と `fonts/` ディレクトリ全体を指定すれば覆える。(両ファイルとも予約名の
  記載は無い —— 各 0 ヒットを実測。結論は最初から揺らいでいなかったが、それを出した検索の
  ほうが揺らいでいた。)
- **`-I`** —— `fonts/` には TTF もあるので、これが無いと `Binary file … matches` が出て、
  1 行ずつ突き合わせられるはずの表が濁る。

判定は「それを出した検索」以上には正しくならないので、コマンドを書き残し、下表には**検索が
返す全行**を載せる(興味深い行だけではなく):

| ファイル:行 | 宣言している名前 |
|---|---|
| `LICENSE.txt:31` | *名前なし* —— `:62` の注記への前方参照 |
| `LICENSE.txt:51` | `'Source'`(Adobe・引用した源ノ角ゴシックの著作権行) |
| `LICENSE.txt:62` | `'Source'` —— このパッケージ自身の RESERVED FONT NAME 注記(上の行の再掲) |
| `LICENSE.txt:65` | *名前なし* —— 同じ注記の散文 |
| `LICENSE.txt:67` | *名前なし* —— 同じ注記が検索対象ファイルを列挙している行 |
| `LICENSE.txt:146` | *名前なし* —— OFL の定義条項そのもの |
| `fonts/SIL_Open_Font_License_1.1.txt:31` | *名前なし* —— 同じ定義条項 |
| `fonts/mplus-TESTFLIGHT-059/LICENSE_E` | *ヒットなし* —— 検索済み・宣言なし |
| `fonts/mplus-TESTFLIGHT-059/LICENSE_J` | *ヒットなし* —— 検索済み・宣言なし |
| `fonts/README_MgenPlus.txt` | *ヒットなし* —— 検索済み・宣言なし |

**`grep` では到達できなかった `name` テーブルの行**(#289・
`scripts/font-fit/check-license.py` で実測)。これは上の表の*訂正ではない* —— 宣言している
名前は表が既に記録しているものと同じで、テキストのみの手順が構造的に見られなかった証拠を、
上の「superseded」注記が「欠けている」と言っているので足したものである:

| 出所 | 宣言している名前 |
|---|---|
| `fonts/MgenPlus1mnTerm-Regular.ttf#0:nameID 0` | `'Source'`(同じ行から過剰捕捉された `'M+ OUTLINE FONTS'` / `'OUTLINE'` を伴う) |
| `fonts/MgenPlus1mnTerm-Bold.ttf#0:nameID 0` | `'Source'`(同じ行・同じ過剰捕捉) |

出荷バイトに対する道具自身の判定行(逐語):
`'Mgen+ 1mn Term': どの予約名も含まない → OK （照合した予約名 9 件）`、終了ステータス 0。
道具が出すテキストのヒット行は上の表とは**行番号が違う** —— あの `grep` を走らせて以降
`LICENSE.txt` を書き換えたためで、表はあのコマンドが返したものの記録として残す(そのための表
である)。

**ここで宣言されている RFN は `'Source'` だけ**であり、`Mgen+` も `1mn` も `Term` もそれを
含まないので、改変版の名前として `Mgen+ 1mn Term` は許される。(対照的に
`font-plemoljp-console` は `"PlemolJP"` を予約名として宣言している —— それがあのパッケージを
そもそも変換対象にしていない理由の 1 つ。)

### 付随文書(バイト列そのまま・2 列規約)

両列とも実測値で、順序に意味がある: 左はリポジトリへコピーする **前** に scratchpad 上の展開
ファイルから取ったもの、右はコミット後のファイルから取ったもの。この作法——および自己参照の
1 列では何も検証しない理由——は全 package 共通の規律として `font-packages/README.ja.md`
(規範の正は英語版 `font-packages/README.md`)に一度だけ書いてある。

| アーカイブ内エントリ | sha256(展開時) | 配置先 | sha256(配置後) |
|---|---|---|---|
| `SIL_Open_Font_License_1.1.txt` | `697383c6addd5dd14d7e1ff053aaa44520ce86a58589eef1f9985ab66e08db08` | `fonts/SIL_Open_Font_License_1.1.txt` | `697383c6addd5dd14d7e1ff053aaa44520ce86a58589eef1f9985ab66e08db08` |
| `README_MgenPlus.txt` | `7ad4c1969beefb2af09c789a68b3da7bb4b628b2fae8b64fe1ce25429d5acf4d` | `fonts/README_MgenPlus.txt` | `7ad4c1969beefb2af09c789a68b3da7bb4b628b2fae8b64fe1ce25429d5acf4d` |
| `mplus-TESTFLIGHT-059/LICENSE_E` | `2d499d752eca1988766eeca70d4145fd94793579924702629181d0ed63dd51a7` | `fonts/mplus-TESTFLIGHT-059/LICENSE_E` | `2d499d752eca1988766eeca70d4145fd94793579924702629181d0ed63dd51a7` |
| `mplus-TESTFLIGHT-059/LICENSE_J` | `66b4cd071d8b2e8a69db344604c00aec7e81192dd9c0c9657979b142310cc3ab` | `fonts/mplus-TESTFLIGHT-059/LICENSE_J` | `66b4cd071d8b2e8a69db344604c00aec7e81192dd9c0c9657979b142310cc3ab` |

これらはアーカイブ内の元パスのまま同梱している: Mgen+ 自体を覆う OFL 1.1 本文、配布物自身の
`README_MgenPlus.txt`(バージョンと構成を述べている)、そして Mgen+ が由来する上流
M+ OUTLINE FONTS のライセンス(平坦化せず `mplus-TESTFLIGHT-059/` ディレクトリのまま。対象が
曖昧にならないように)。いずれも **上流の** フォントについての文書であり、改変について述べて
いるのはこの README である。

## family 名(実測・想定ではない)

#275 で **変換後のファイルに対して**測り直した。同梱するのはそちらであり、変換は `name`
テーブルを書き換えるので、変換前の測定値をそのまま載せると「このパッケージにもう存在しない
バイト列についての主張」になってしまう。`name` テーブルを直読(nameID 1 / 2 / 4 / 6、および
存在する場合は 16 / 17)—— 同梱する face は全部測る。借用の仕組み全体が「2 face が *同じ*
typographic family を名乗ること」に乗っているため:

| フィールド | `MgenPlus1mnTerm-Regular.ttf` | `MgenPlus1mnTerm-Bold.ttf` |
|---|---|---|
| nameID 1(family) | `Mgen+ 1mn Term` | `Mgen+ 1mn Term` |
| nameID 16(typographic family) | `Mgen+ 1mn Term` | `Mgen+ 1mn Term` |
| nameID 2 / 17(subfamily) | `Regular` | `Bold` |
| nameID 4(full name) | `Mgen+ 1mn Term Regular` | `Mgen+ 1mn Term Bold` |
| nameID 6(PostScript) | `MgenPlus1mnTerm-Regular` | `MgenPlus1mnTerm-Bold` |
| `OS/2.usWeightClass` | `400` | `700` |
| `fvar` | 無し(静的) | 無し(静的) |

nameID 16 が typographic family で、2 face で完全に同一 —— 上流がこの 2 本を 1 つの family
として設計し、変換もそれを保っているということであり、それが「2 本を 1 つの CSS
`font-family` に束ねてよい」ことの正当性(と、下記のメトリクス一致が偶然ではなく期待される
性質であること)を支える。**注入機構はこれに依存しない**: `@font-face` は family 名を読むの
ではなく **宣言する** 規則で、CSS の font matching はファイル内部の名前を参照しない(機構の
全文は `font-packages/README.ja.md`。規範の正は英語版 `font-packages/README.md`)。
この表はフォントについての証拠であって、機構についての
証拠ではない。

`Mgen+ 1mn Term` がこの拡張機能の `providedFont.family` が持つ値であり、消費側のレジストリ
(tmux-opener の `FONT_REGISTRY`)と一字一句一致していなければならない。ここに記録している
のは実測値であって、「名前を決めたので適用されたはずだ」ではない。face を追加・差し替えたら
列を足して実測すること —— この表は測定の記録であって、測定を省く根拠ではない(#249)。

消費側への注記: 変換前の名前 `Mgen+ 1mn` は、これらのファイルが宣言する名前ではもう無い。
tmux-opener は旧名を alias として登録し、同じファイルに対して alias 名義の `@font-face` も
注入することで既存の `settings.json` を変換後のバイト列で描画させている。これは消費側の
互換レイヤであって、このパッケージの性質ではない。

`fc-scan` の `spacing` は `mono`(100)ではなく `dual`(90)である点に注意(#275 以前の本表は
fc-scan 由来だった)—— CJK フォントでは普通のことで、fontconfig の `spacing` が等幅の証拠に
ならない理由がこれ。証拠は下記の `test/font-metrics.test.js`。

## 等幅メトリクス(実測)

リポジトリルートの `npm test`(`test/font-metrics.test.js`)が **両方の** ファイルを対象に、毎回
次を assert する:

- unitsPerEm 1024。ASCII 印字可能域 0x21–0x7E は全コードポイントが cmap に存在し、送り幅は
  単一値 **A = 512**。
- 全角サンプル 一 / 漢 / あ / ん / ア はいずれも **1024 = 2A**。
- 2 つの face が互いに一致する: unitsPerEm も A も同値(#249)。face 単位で等幅なだけでは足りない
  ——端末はセル幅を 1 つの family から測り、そのセルに両 face を描くので、bold のスケールが違うと
  ファイル単位の検査は全部通ったまま bold 行だけ桁がズレる。

上記の値は `hmtx` の **default instance** の送り幅であり、これら静的 face ではフォント全体を指す。
**上記の値は変換で変わっていないが、他の送り幅は多数変わっている**。この区別は正確に書く必要が
ある —— #275 で一度、これを緩く「変換は送り幅に一切触れない」と書いて出荷しかけたが、それは
偽である:

- **幅 1 の符号位置の送り幅は、意図的にセル幅へ設定する** (大半にとってそれは変更である)。
  それが変換の目的の半分である: 上流はその大半を
  全角送り 1024 で描いており、変換はセル幅にする。出荷ファイルと上流ファイルを突き合わせた実測で
  **regular 面 997 グリフ・bold 面 1016 グリフ**が 1024 → 512 になっており、どちらのファイルにも
  1024 → 512 **以外の遷移は 1 件も無い**。この 2 つの数は **#291 のバイト列で再実測して不変** ——
  `fitRatio` が動かすのは ink だけで advance は動かさないので、`hmtx` の **advance** は倍率 0.96
  だった前リリースとバイト単位で一致する。`hmtx` テーブル全体は一致しない: 各エントリは
  `(advanceWidth, lsb)` であり、作り直したグリフは ink が動くぶん `lsb` も動くので、前リリースに
  対して **advance の差分が 0 件のまま regular 面 875 件・bold 面 935 件が異なる**
  (fontTools で実測・#292)。
- **本文グリフの送り幅は変わらない**。輪郭も変わらない —— それが「取得元」節の契約②で、グリフ
  単位で検証している。
- **セル格子は動かない**: A は 512 のまま、全角グリフは 1024 のまま。だから本節の数値が今も成り
  立ち、変換後のテキストも同じ桁に組まれる。

2 番目・3 番目を「送り幅は変わらない」と混同したのが偽の一文を生んだ原因である。契約②は変換が
**選ばなかった**グリフについての主張であり、選ばれたグリフは輪郭が変わり、上流が全角で描いて
いたものは送り幅も変わる —— ほぼ全部だが、全部ではない。実測では **regular 面で作り直した
1001 グリフのうち 997 (bold は 1020 のうち 1016)** が送り幅も変わり、残る各面 4 件 ——
`↑ U+2191` `↓ U+2193` `↕ U+2195` と、regular の `ȿ U+023F` / bold の `Ϡ U+03E0` —— は
上流がすでに 1 列送りで描いていたグリフで、変換は ink を中央へ寄せただけで送り幅は動かしていない。
