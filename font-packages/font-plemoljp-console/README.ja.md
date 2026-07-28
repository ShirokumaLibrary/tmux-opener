# PlemolJP Console HS (font resource for extensions)

*[English](README.md)*

拡張機能 ID: `shirokuma-library.font-plemoljp-console`

PlemolJP Console HS フォントを **他の拡張機能へ供給する** ための汎用フォントリソース
拡張機能。この拡張機能自体は UI もコマンドも持たず(`contributes` は空、`activationEvents`
も空、`main` は no-op)、**フォントを OS にはインストールしない**。同梱した TTF を、消費側の
拡張機能が自分の webview から `vscode-resource` 経由で読み込めるようにすることだけを目的と
する。

## 同梱フォント

| family(実測) | ファイル | weight | ライセンス |
|---|---|---|---|
| `PlemolJP Console HS` | `fonts/PlemolJPConsoleHS-Regular.ttf` | `400`(静的フォント・可変軸なし) | OFL-1.1 |
| `PlemolJP Console HS` | `fonts/PlemolJPConsoleHS-Bold.ttf` | `700`(静的フォント・可変軸なし) | OFL-1.1 |

同一 family の 2 face。どちらも同じ配布物に含まれる別々の静的 TTF。

`family` は想定値ではなく name table の **実測値**(下記「family 名」節)。各 `weight` は
**範囲ではなく単一値**で宣言している: これらは静的フォントであり、範囲宣言はその範囲を
カバーするという*主張*だから。`100 700` を宣言した face は xterm の bold セルにも「本物」と
して選ばれてレギュラーの太さで描かれる——つまり範囲宣言は太字を作るのではなく
**合成太字を抑止する**。実物の 700 face を同梱するのはまさにそのためで、宣言(主張)ではなく
実際に太いグリフで 700 を埋める。

上の表の `weight` はいずれも省略せず明示している。省略した場合の帰結は**どちらの宣言形から
省いたか**で異なり、その 2 つの規則は全 package 共通の記述として契約仕様の単一正本
`font-packages/README.md` に一度だけ書いてある。

著作権表示とライセンス全文は `LICENSE.txt`、参照している上流構成要素の一次ライセンス文書は
`licenses/` を参照。

## どの派生版か、なぜそれか(実測)

PlemolJP プロジェクトは複数の family を公開している。このパッケージが同梱するのは
**PlemolJP Console HS** で、名前の両方の部分に意味がある:

- **Console** —— 上流プロジェクトは、この派生版を「IBM Plex Mono の字体を除外せず全て適用した
  もので、多くの記号が半角で表示される」と説明している。同梱 face の実測(`hmtx` の default
  instance 送り幅・ASCII 送り幅 `A` = 528): `●` `○` `■` `★` `✓` `✔` `…` `①` はいずれも
  **528 = A**、つまり 1 セル幅。`⚠` だけは **1056 = 2A** で全角のまま —— この face の既知の
  限界であって、パッケージ側で回避してはいない。
- **HS** —— "Hidden Space"。既定のリリースが持つ全角スペース可視化を **加えていない** 方の
  リリース派生版。

いずれも *このバイト列* についての実測値である。消費側ターミナルの幅規約(East Asian
Ambiguous を幅 1 と数える)があって初めて意味を持つ値なので、確認手順そのものは
`font-packages/README.md` 側に置いてある。

## 著作権と帰属(4 者)

同梱 face の著作権フィールドは 4 者を表示している。**どの情報源が何を述べているかは以下で
分けて書く** —— paraphrase を引用として提示しないため。

### 著作権者(逐語引用)

同梱 TTF 自身の `name` table、nameID 0(copyright)。Macintosh(platform 1, encoding 0,
language 0x0)と Windows(platform 3, encoding 1, language 0x409)のレコードで内容が一致し、
regular / bold の 2 face でもバイト一致(実測)なので、この 1 引用で両 face を覆う。TTF は
無改変で同梱しているので、これは OFL §2 のいう機械可読な著作権フィールドそのもの:

```
[IBM Plex]
Copyright (c) 2017 IBM Corp. https://github.com/IBM/plex

[Hack]
Copyright 2018 Source Foundry Authors https://github.com/source-foundry/Hack

[Nerd Fonts]
Copyright (c) 2014, Ryan L McIntyre https://ryanlmcintyre.com

[PlemolJP]
Copyright (c) 2021, Yuko Otawara
```

上流リポジトリの `LICENSE`(タグ v3.0.0)は、PlemolJP の権利者を **Reserved Font Name** 付きで
改めて表示している:

```
Copyright (c) 2021, Yuko OTAWARA. with Reserved Font Name "PlemolJP"
```

`licenses/LICENSE_IBM-Plex` も同様に `"Plex"` を予約している(OFL §3)。ここでその条項に
触れるものは無い —— TTF は 2 本とも無改変で、宣言している family 名(`PlemolJP Console HS`)も
上流のもの —— が、*改変版* をこれらの予約名を含む名前で配布することはできない。

### OFL 宣言とライセンス文書

同梱 TTF の `name` table、nameID 13(license description)の逐語引用(2 レコード間・2 face 間で
一致・実測):

```
This Font Software is licensed under the SIL Open Font License,
Version 1.1. This license is available with a FAQ
at: http://scripts.sil.org/OFL
```

OFL 1.1 全文は `LICENSE.txt` にあり、上流リポジトリのタグ v3.0.0 の `LICENSE` から逐語で
複写したもの。上流構成要素の一次文書は `licenses/` に同梱してある —— 各文書の取得元と、
引用ではなく全文同梱にした理由は下記 provenance 節の「ライセンス文書」を参照。

参考リンク(便宜上): PlemolJP <https://github.com/yuru7/PlemolJP>、IBM Plex
<https://github.com/IBM/plex>、Hack <https://github.com/source-foundry/Hack>、Nerd Fonts
<https://github.com/ryanoasis/nerd-fonts>。これらは現行アドレスであり、配布物からの引用では
ない。

## 利用範囲の限界: `editor.fontFamily` / `terminal.integrated.fontFamily` では使えない

**この方式で供給されるフォントは、VS Code の設定(`editor.fontFamily` や
`terminal.integrated.fontFamily`)にフォント名 `PlemolJP Console HS` を書いても使えない。**
これはよくある誤解なので明記する(この拡張機能の displayName / description が「a resource for
extension developers, not a font selectable from ordinary settings such as
editor.fontFamily」と明言しているのはこのため)。

- このフォントを描画に使うには、消費側拡張機能が自分の webview の HTML/CSS の中に `@font-face`
  を **自前で注入する** 必要がある。その `@font-face` は、その webview 1 つのスコープの中だけに
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

規約の実体は `package.json` の `providedFont` フィールド:

```json
"providedFont": {
  "family": "PlemolJP Console HS",
  "file": "fonts/PlemolJPConsoleHS-Regular.ttf",
  "weight": "400",
  "license": "OFL-1.1",
  "faces": [
    { "file": "fonts/PlemolJPConsoleHS-Regular.ttf", "weight": "400" },
    { "file": "fonts/PlemolJPConsoleHS-Bold.ttf", "weight": "700" }
  ]
}
```

`faces` は family の全 face を宣言順に列挙する。これを読む消費側は 1 エントリにつき 1 つの
`@font-face` を注入する。フラットな `file` / `weight` の組は **400 の 1 face 向けの短縮形** と
して残してあり、先頭エントリとバイト一致に保つ。これにより、旧 1 ファイル契約向けに書かれた
消費側もそのまま動く(bold face は得られず、従来どおり合成太字にフォールバックする)。

**消費側がこれをどう読むか —— 2 つの宣言形・どちらが優先されるか・正規化と縮退の規則・
コード付きの借用手順 —— は同じリポジトリの `font-packages/README.md` にある。あちらが規約の
単一正本であり、この節は *このパッケージが宣言している内容* だけを記録する。**
tmux-opener の `src/font-registry.ts` / `getHtml` が消費側の実装例。

## 取得元(provenance)

TTF は 2 本とも **配布物のバイト列そのまま**(無改変・元のファイル名のまま)で配置してある
(リネームやサブセット化は、利点なしにこのパッケージを OFL §5 の派生物規定の下に置いてしまう)。

- **配布**: PlemolJP v3.0.0、リリース資産 `PlemolJP_HS_v3.0.0.zip`
  (`HS` = Hidden Space。全角スペース可視化を含まない方の派生版)
- **URL**: `https://github.com/yuru7/PlemolJP/releases/download/v3.0.0/PlemolJP_HS_v3.0.0.zip`
  (上流プロジェクト `https://github.com/yuru7/PlemolJP`)
- **アーカイブ**: 216,568,254 バイト、sha256
  `52c4de59f5030caf9e3c88aa304d281c7ea987e2c30fa0441ca162eede2bff12`
  (アーカイブ自体は **コミットしていない** —— 下表のファイルのみ)
- **展開**: python3 標準ライブラリの `zipfile`(このホストには `unzip`/`7z`/`bsdtar` が無い)。
  アーカイブには Console だけで 16 face 入っているが、同梱するのは `PlemolJPConsole_HS/` の
  Regular と Bold の 2 本 —— 契約が宣言するのは 400 をカバーする face 1 つと実物の 700 face
  1 つだから。

### sha256: アーカイブ内エントリ(展開時に実測)→ 配置ファイル

両列とも実測値で、順序に意味がある: 左はリポジトリへコピーする **前** に scratchpad 上の展開
ファイルから取ったもの、右は配置後のファイルから取ったもの。この作法——および自己参照の
1 列では何も検証しない理由——は全 package 共通の規律として `font-packages/README.md` に一度だけ
書いてある。

| アーカイブ内エントリ | sha256(エントリ・展開時) | 配置先 | sha256(配置後) |
|---|---|---|---|
| `PlemolJPConsole_HS/PlemolJPConsoleHS-Regular.ttf` | `de583b2a81e5bf991ae54523dc11ef7588d4d0fe9b9de5a67d1dfeb56dfa0f43` | `fonts/PlemolJPConsoleHS-Regular.ttf` | `de583b2a81e5bf991ae54523dc11ef7588d4d0fe9b9de5a67d1dfeb56dfa0f43` |
| `PlemolJPConsole_HS/PlemolJPConsoleHS-Bold.ttf` | `11af5bc2a756fca43db9268ce3b7ba537e811c08d5a71084956c635d23dd40b8` | `fonts/PlemolJPConsoleHS-Bold.ttf` | `11af5bc2a756fca43db9268ce3b7ba537e811c08d5a71084956c635d23dd40b8` |

### ライセンス文書(アーカイブに無いので上流リポジトリから取得)

**配布アーカイブにはフォントファイルしか入っていない。** 全 69 エントリ(ディレクトリ 5 件と
TTF 64 件)を列挙しても **license も README も 1 件も無い**(`python3 -m zipfile -l` で実測)。
`font-packages/` の他パッケージは配布物自身の license / README をアーカイブ内パスのまま同梱
しているが、ここには同梱すべき対象が存在しない。そこで一次文書は上流リポジトリの
**`v3.0.0` タグ**から取得し、その provenance を TTF とまったく同じ形——独立に実測した 2 列、
左は取得時(配置前)、右は配置後——で記録する。

変わらない点も明記しておく: パッケージ直下の `LICENSE.txt` は、どのパッケージでも元から
**構成物**(逐語引用と地の文を節で分けた文書)である。このパッケージで異なるのは、その主張を
突き合わせる一次文書の入手経路だけ。

| 取得元 URL | sha256(取得時) | 配置先 | sha256(配置後) |
|---|---|---|---|
| `https://raw.githubusercontent.com/yuru7/PlemolJP/v3.0.0/LICENSE` | `52bbb5e729acc62435831d20641ece6a919e610100285ba183ef4d7233fb1e9a` | `LICENSE.txt` 内に逐語引用(OFL 1.1 本文・バイト一致を確認) | — |
| `https://raw.githubusercontent.com/yuru7/PlemolJP/v3.0.0/source/LICENSE_IBM-Plex` | `37784b44044a4ffd9256702b7c0982c37e5c8887ba90c6dca0479aea93dc898d` | `licenses/LICENSE_IBM-Plex` | `37784b44044a4ffd9256702b7c0982c37e5c8887ba90c6dca0479aea93dc898d` |
| `https://raw.githubusercontent.com/yuru7/PlemolJP/v3.0.0/source/hack/LICENSE` | `1f61bb7c790c59b4b0ecdf304628b94e42ae4c8020094a8c3da73381ab212623` | `licenses/LICENSE_Hack` | `1f61bb7c790c59b4b0ecdf304628b94e42ae4c8020094a8c3da73381ab212623` |
| `https://raw.githubusercontent.com/yuru7/PlemolJP/v3.0.0/source/LICENSE_NerdFonts` | `245b522abb5aba0d8e84898bf6d5e95102620637626106bfd0061189a2370360` | `licenses/LICENSE_NerdFonts` | `245b522abb5aba0d8e84898bf6d5e95102620637626106bfd0061189a2370360` |

Hack の文書は上流パス `source/hack/LICENSE` にあり、3 件の命名を揃えるために
`licenses/LICENSE_Hack` として配置している。その改名を記録しているのが上表の当該行。ルートの
`LICENSE` に配置後 sha256 が無いのは、ファイルとしては同梱していないため —— OFL 1.1 本文を
`LICENSE.txt` に引用しており、その引用が取得した文書とバイト一致であることを確認している。

引用ではなく全文同梱にしたのは、3 件のうち 2 件が MIT の permission notice を含み、MIT の条件が
「その notice 自体を複製物・実質的部分すべてに含めること」だから。各文書は要約ではなく本文で
読むこと: **Nerd Fonts** はフォントが OFL で MIT はプロジェクトのソースコード側、対して
**Hack** プロジェクトでは MIT なのはフォントの成果物そのもの。さらに `licenses/LICENSE_Hack`
は DejaVu プロジェクトのパブリックドメイン宣言と Bitstream Vera License 全文も述べており、
上表で並べた 1 者より広い範囲を語っている。上流の包括的 OFL 宣言とこの MIT 記述が一見食い違って
見える点の読み方は `LICENSE.txt` の第 4 節にある。

## family 名(実測・想定ではない)

展開した **各** TTF に対する
`fc-scan --format '%{family}\n%{familylang}\n%{style}\n%{spacing}\n%{weight}\n'`
—— 同梱する face は全部測る。借用の仕組み全体が「2 face が *同じ* typographic family を
名乗ること」に乗っているため:

| フィールド | `PlemolJPConsoleHS-Regular.ttf` | `PlemolJPConsoleHS-Bold.ttf` |
|---|---|---|
| `family` | `PlemolJP Console HS` | `PlemolJP Console HS` |
| `familylang` | `en` | `en` |
| `style` | `Regular` | `Bold` |
| `spacing` | `90`(= `dual`) | *(値なし —— fontconfig が何も返さない)* |
| `weight` | `80`(fontconfig 尺度: Regular) | `200`(fontconfig 尺度: Bold) |

`family` の値は font family name(name ID 1。この 2 face は name ID 16 = typographic family の
レコードを持たない・実測)で、2 face で完全に同一 —— 上流がこの 2 本を 1 つの family
として設計したということであり、それが「2 本を 1 つの CSS `font-family` に束ねてよい」ことの
正当性(と、下記のメトリクス一致が偶然ではなく期待される性質であること)を支える。
**注入機構はこれに依存しない**: `@font-face` は family 名を読むのではなく **宣言する** 規則で、
CSS の font matching はファイル内部の名前を参照しない(機構の全文は
`font-packages/README.md`)。この行はフォントについての証拠であって、機構についての証拠では
ない。

`PlemolJP Console HS` がこの拡張機能の `providedFont.family` が持つ値であり、消費側のレジストリ
(tmux-opener の `FONT_REGISTRY`)と一字一句一致していなければならない。

`spacing` は regular が `dual`(90)、bold は値そのものが返らない点に注意 —— どちらも等幅の
証拠にはならない。fontconfig の `spacing` はヒューリスティックであり、証拠は下記の
`test/font-metrics.test.js`。

## 等幅メトリクス(実測)

リポジトリルートの `npm test`(`test/font-metrics.test.js`)が **両方の** ファイルを対象に、毎回
次を assert する:

- unitsPerEm 1000。ASCII 印字可能域 0x21–0x7E は全コードポイントが cmap に存在し、送り幅は
  単一値 **A = 528**。
- 全角サンプル 一 / 漢 / あ / ん / ア はいずれも **1056 = 2A**。
- 2 つの face が互いに一致する: unitsPerEm も A も同値。face 単位で等幅なだけでは足りない
  ——端末はセル幅を 1 つの family から測り、そのセルに両 face を描くので、bold のスケールが違うと
  ファイル単位の検査は全部通ったまま bold 行だけ桁がズレる。

上記の値は `hmtx` の **default instance** の送り幅であり、これら静的 face ではフォント全体を指す。
縦メトリクスも 2 face で同一(`hhea` ascender 950・descender −225・lineGap 0 —— 行高 1.175 em)。
