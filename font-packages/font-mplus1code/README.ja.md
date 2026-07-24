# M PLUS 1 Code (font resource for extensions)

*[English](README.md)*

拡張機能 ID: `shirokuma-library.font-mplus1code`

M PLUS 1 Code フォントを **他の拡張機能へ供給する** ための汎用フォントリソース拡張機能。
この拡張機能自体は UI もコマンドも持たず(`contributes` は空、`activationEvents` も空、`main`
は no-op)、**フォントを OS にはインストールしない**。同梱した TTF を、消費側の拡張機能が
自分の webview から `vscode-resource` 経由で読み込めるようにすることだけを目的とする。

## 同梱フォント

| family | ファイル | weight 軸 | ライセンス |
|---|---|---|---|
| `M PLUS 1 Code` | `fonts/MPLUS1Code.ttf` | `100 700` (fvar wght 100–700) | OFL-1.1 |

ライセンス全文は `fonts/OFL.txt` を参照。

## 利用範囲の限界: `editor.fontFamily` / `terminal.integrated.fontFamily` では使えない

**この方式で供給されるフォントは、VS Code の設定(`editor.fontFamily` や
`terminal.integrated.fontFamily`)にフォント名 `M PLUS 1 Code` を書いても使えない。**
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
  そこに下記の借用手順(`getExtension` → `localResourceRoots` → `asWebviewUri` → `@font-face`)
  を自前で実装している」場合に限る**。tmux-opener はまさにこのケース(VS Code 標準の Terminal
  パネルを使わず、自前の webview 上に xterm.js を持つ設計)なので利用できるが、一般的な用途
  (エディタや標準ターミナルでこのフォントを使いたい)には使えない。そちらが必要な場合は、
  フォントを OS へ実インストールする以外の手段がない。

## 他拡張機能からこのフォントを利用する方法(規約)

**注意**: これは VS Code の公式な拡張機能間フォント共有の仕組みではない。**そのような公式機構は
存在しない。** 以下はこの拡張機能が独自に定義した非公式の自前規約であり、この拡張機能の ID と
`package.json` の `providedFont` 契約フィールドの形をそのまま前提にする。将来この拡張機能側で
ファイル配置・ID・契約フィールドを変更すると、消費側は無言で壊れる。

契約の本体は `package.json` の `providedFont` フィールド:

```json
"providedFont": {
  "family": "M PLUS 1 Code",
  "file": "fonts/MPLUS1Code.ttf",
  "weight": "100 700",
  "license": "OFL-1.1"
}
```

消費側は、この4フィールド(`family` / `file` / `weight` / `license`)を読んでフォントを借用する。

### 1. この拡張機能の存在を確認する

```js
const vscode = require('vscode');

const FONT_EXTENSION_ID = 'shirokuma-library.font-mplus1code';
const fontExt = vscode.extensions.getExtension(FONT_EXTENSION_ID);

if (!fontExt) {
  // 未インストール。フォント選択肢を隠す / 別のフォントへフォールバックするなど、
  // undefined ケースを必ず処理すること(下記「未インストール時のフォールバック」参照)。
  return;
}
```

`vscode.extensions.getExtension()` は対象拡張機能が **activate されていなくても**、
インストール済みであればメタデータ(`extensionUri` / `packageJSON` など)を返す。この拡張機能は
`activationEvents` が空で activate される契機を持たない供給専用の拡張機能なので、この
「未 activate でもメタデータが読める」性質に依存している。

### 2. `providedFont` 契約からファイルパスと weight を引く

```js
const contract = fontExt.packageJSON.providedFont;
// contract.family  === 'M PLUS 1 Code'
// contract.file    === 'fonts/MPLUS1Code.ttf'
// contract.weight  === '100 700'
// contract.license === 'OFL-1.1'
```

ファイルパスを固定値でハードコードせず、必ず `contract.file` から引くこと(将来の配置変更に
追従できるようにするための契約フィールド)。

### 3. webview の `localResourceRoots` に、このフォント拡張機能のディレクトリを追加する

**これがアクセス制御の本体。** `localResourceRoots` にこの拡張機能の `extensionUri` を追加
しない限り、VS Code は CSP を評価する以前の段階で、他拡張機能配下のファイルへの
`asWebviewUri` URL の配信を拒否する。逆に言えば、これさえ追加すれば **CSP の `font-src` を
広げる必要はない**: `asWebviewUri` は借用したファイルを消費側 webview 自身のリソース
オーソリティ(= `webview.cspSource` が返すもの)へ書き換えるため、既存の
`font-src ${webview.cspSource}` がそのまま両方(自前の vendored フォントと借用フォント)を
カバーする(tmux-opener 本体で実機確認済み。`src/font-registry.ts` の冒頭コメントおよび
`CLAUDE.md` の該当 invariant を参照)。

```js
const fontExtensionRoots = fontExt ? [fontExt.extensionUri] : [];

webviewView.webview.options = {
  enableScripts: true,
  localResourceRoots: [
    vscode.Uri.joinPath(context.extensionUri, 'media'), // 自分自身のリソースルート
    ...fontExtensionRoots,                              // 借用するフォント拡張機能のルート
  ],
};
```

`localResourceRoots` は自拡張機能配下である必要はなく、任意の `vscode.Uri` を渡せる。未インストール
なら空配列を足すだけで、他のフォールバック経路には影響しない。

### 4. `asWebviewUri` で URI を変換し、`@font-face` で読み込む

```js
const fontFileUri = vscode.Uri.joinPath(
  fontExt.extensionUri,
  ...contract.file.split('/'), // 'fonts/MPLUS1Code.ttf' → ['fonts', 'MPLUS1Code.ttf']
);
const fontUri = webview.asWebviewUri(fontFileUri);

const html = `
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource};">
  <style>
    @font-face {
      font-family: '${contract.family}';
      src: url(${fontUri}) format('truetype');
      font-weight: ${contract.weight};
      font-display: block;
    }
    .term { font-family: '${contract.family}', monospace; }
  </style>
  ...
`;
```

これで OS へのフォントインストールなしに、別拡張機能が持つフォントファイルを webview 上で
描画できる。tmux-opener 本体では、`src/font-registry.ts` の `resolveBundledFontSource()` が
単一の供給元へ解決する: font 拡張機能が installed のときはそこから借用し、無いときは `none` を
返す ── その場合 `getHtml` は `@font-face` を一切注入せず、ターミナルは OS 標準の monospace へ
落ちる(tmux-opener 本体はもはや自前の TTF コピーを同梱しない)。実際の URI 構築は
`src/extension.ts` の `getHtml`(上記コードと同じ `joinPath` → `asWebviewUri` → `@font-face`
の流れ)にある。

## 未インストール時のフォールバック

`vscode.extensions.getExtension(FONT_EXTENSION_ID)` が `undefined` を返すケースを、消費側で
**必ず処理すること**。このフォント拡張機能はソフト依存(あれば使う)であり、なくても消費側が
壊れてはならない。

- ソフト依存にしたい場合は、上記のように実行時チェック + フォールバック(自前の vendored フォント
  や別のフォントに落とす、フォント選択肢を隠す等)で済ませ、`package.json` の
  `extensionDependencies` には **入れない**。`extensionDependencies` は「なければ動かない」強い
  依存であり、「あれば使う」ソフト依存にはならない。
- tmux-opener 本体は、このフォント拡張機能が未インストールのときは OS 標準の monospace で描画
  し(`@font-face` を注入しない)、バンドルフォントが選択されている場合に限りインストールを促す
  1回きりの通知を出す(`shouldNotifyFontExtensionMissing` in `src/font-registry.ts`)。

## この規約について

繰り返しになるが、VS Code に拡張機能間でフォントを共有する **公式の仕組みは存在しない**。
本ドキュメントの手順は、供給側(この拡張機能)と消費側(tmux-opener 等)の間で取り決めた
非公式の自前規約であり、`providedFont` 契約フィールドがその取り決めの正本。契約フィールドの
形(`family` / `file` / `weight` / `license`)やフォントファイルの配置を変更する場合は、
消費側が無言で壊れることを踏まえ、双方を揃えて更新すること。
