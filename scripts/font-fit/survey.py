"""フォント候補の収録範囲とセル適合を実測する（候補評価の道具・計画 #287 T2）。

（#285 の試作 `coverage2.py`〔ブロック別充足率〕・`coverage.py`〔26 サンプルの実在〕・
  `inkbounds.mjs`〔advance と ink 境界〕を 1 本へ統合したもの。新規発明ではない——
  数値の正本は #285 のコメントで、本ツールはそれを再現できることで担保される。）

「この書体を同梱してよいか」「変換で直るのか」を決めるための測定を 1 実行にまとめる。
`verify.py` が**変換時のゲート**（違反 1 件で落とす）なのに対し、こちらは**採否を決める
人のための観測**であり、何も落とさない（exit 0）。

## セル適合は 2 条件を分けて出す（混ぜると判断が壊れる）

  条件 1 `adv≠箱` : advance が割り当てセル数ぶんの幅と一致しない
                    （= その符号位置が主張する列数と、実際に進む量が食い違う）
  条件 2 `ink外`   : 輪郭（glyf 格納 bbox）が箱 `[0, 箱幅]` の外に出る

**この 2 つは別の欠陥である。** HackGen Console は条件 1 だけが立つ（= 変換で直る）
一方、Latin-1 の `î` のように条件 2 だけが立つ形もある（#285）。片方の数だけを見て
「適合」と言うと、もう片方の欠陥が数字の背後に消える。

**条件 2（`ink外` / `箱に収まる`）は、#291 以降は変換パイプラインの契約ではない。**
契約は「ink ≤ セル幅 × fitRatio（既定 1.15）で、はみ出すなら左右対称」であって
「セルの中」ではない（意味の正本は `manifest.json` の `note`）。したがって変換出力の
6 面をこのツールに掛けると `ink外` が 3 桁出るが、それは**設計どおり**で違反ではない。
本ツールは観測なので判定基準を変えず、セル `[0, 箱幅]` を素朴に測り続ける——採否を
決める人が見たいのは「素の書体がどれだけセルからはみ出しているか」だからで、その生の
数値は fitRatio をいくつにすべきかの入力でもある。契約に対する合否は `verify.py`
（変換時）と `test/font-cellfit.test.js`（リポ側）だけが判定する。

**`adv∧ink` と `adv∨ink` も併記する。** 面によっては条件 1 の集合が条件 2 の集合に
**含まれてしまい**、ink 単独値と OR 値が同じ数になる——同梱中の PlemolJP Console HS
の 2 面がまさにこれで、`ink外` 374 / 460 は **ink 単独値**でありながら OR カウントとも
一致する。`test/font-cellfit.test.js` の冒頭コメント（`374 / 460` を含む段落——
行番号で指すと 1 行足すだけでずれるので文字列で指す）は同じ 374 / 460 を
**OR カウント**として記録しているので、列を分けずに出すと「OR ラベルで ink 値を再導出する」取り違えが起こる
（計画 #287 レビュー L2）。列を 4 本並べるのはそのためで、冗長ではない。

## 系列は scope 内 / 全体（+ Latin-1）

  scope内   `font-packages/README.md`「Terminal width conventions」の **4 除外**
            （`cp <= 0xFF` / BMP 私用領域 U+E000-F8FF / 罫線 U+2500-257F・ブロック
            要素 U+2580-259F / 幅 1 以外）。**変換パイプラインが契約する範囲**で、
            `fit.py` の `target_advance` と `verify.py` の 4 項条件と同じもの。
  Latin-1   `cp <= 0xFF`。4 除外の 1 番目で **scope から外れている**範囲だが、
            出荷バイトに既知の非ゼロがある（MPLUS1CodeTerm-Bold の `î` 等）ので
            別系列として明示する。scope 内の数値と足し合わせないこと。
  全体      cmap の全符号位置（幅 0 と制御を除く）。除外を一切かけない。
            **ink 項が恒常 0 の壊れた実装は、この系列で即座に赤くなる。**

## 4 除外の定義は `fit.py` から import する（相互参照ではなく共有）

`in_custom_range` / `in_private_use` / `load_widths` は `fit.py` の実装をそのまま
使う（`verify.py` と同じ流儀）。3 つ目の複製を作らない——複製した瞬間に「どれが
本物の scope か」が分からなくなる。幅表は `dump-widths.mjs` が `@xterm/addon-unicode11`
から生成したものだけを使い、**EastAsianWidth を手で書かない**（手書き表が `⚠ ✓ ✔` を
落としたのが #262 事故 1）。`--widths` 省略時は node を呼んで scratch に作り直す。

## 限界（先に言う）

- 読むのは `glyf` の**格納 bbox** で、輪郭の再測定ではない（`verify.py` 契約①と同じ
  限界。格納値が古い書体では実体とずれる——#285 で Cica `⊞` の実例を測った）。
- CFF アウトライン（`glyf` の無いフォント）は対象外。Source Han Code JP がこれで、
  そもそも `fit.py` の対象でもない。
- 画面のピクセルは測っていない。潰れ・重なりの実機観測は人の手番。
- **`.py` にはどの自動ゲートも到達しない**（Semgrep bundled 3 ルールは
  `languages: [typescript, javascript]`・#273 実測）。担保は「既知の非ゼロ値を
  再現すること」であって、出力の形が整っていることではない（#270 GREEN CONTROL）。

使い方:
  survey.py <TTF...> [--widths widths.json] [--section blocks,samples,cellfit]
            [--codepoints U+00EE,U+2605]
"""

import argparse
import os
import subprocess
import sys
import tempfile

from fontTools.ttLib import TTFont

from fit import load_widths, in_custom_range, in_private_use

HERE = os.path.dirname(os.path.abspath(__file__))

# coverage2.py（#285）のブロック表。収録の広さを面ごとに比べるためのもの。
BLOCKS = [
    ("ASCII",            0x0020, 0x007E),
    ("Latin-1 補助",     0x00A0, 0x00FF),
    ("ラテン拡張 A/B",   0x0100, 0x024F),
    ("ギリシャ",         0x0370, 0x03FF),
    ("キリル",           0x0400, 0x04FF),
    ("一般句読点",       0x2000, 0x206F),
    ("文字様記号",       0x2100, 0x214F),
    ("数字形",           0x2150, 0x218F),
    ("矢印",             0x2190, 0x21FF),
    ("数学演算子",       0x2200, 0x22FF),
    ("その他技術用",     0x2300, 0x23FF),
    ("囲み英数字",       0x2460, 0x24FF),
    ("罫線",             0x2500, 0x257F),
    ("ブロック要素",     0x2580, 0x259F),
    ("幾何学模様",       0x25A0, 0x25FF),
    ("その他の記号",     0x2600, 0x26FF),
    ("装飾記号",         0x2700, 0x27BF),
    ("CJK 記号・句読点", 0x3000, 0x303F),
    ("ひらがな",         0x3040, 0x309F),
    ("カタカナ",         0x30A0, 0x30FF),
    ("囲み CJK",         0x3200, 0x32FF),
    ("CJK 互換",         0x3300, 0x33FF),
    ("CJK 統合漢字",     0x4E00, 0x9FFF),
    ("CJK 拡張 A",       0x3400, 0x4DBF),
    ("全角形",           0xFF00, 0xFFEF),
]

# coverage.py（#285）の日常記号 26 サンプル。ターミナルの実出力で実際に出るものを
# 選んである。**このうち 5 件（± × ÷ § ¶）は `cp <= 0xFF` で 4 除外の 1 番目に当たり、
# 下の cellfit の scope 内系列には入っていない**——同じ表の中で 2 つの基準を混ぜない
# ため、サンプル表と scope 内の数値は別物として読むこと（#285 の同注記と同じ）。
SAMPLES = [
    (0x25CF, "●"), (0x25CB, "○"), (0x25A0, "■"), (0x2605, "★"), (0x25C6, "◆"),
    (0x2460, "①"), (0x2461, "②"), (0x2462, "③"),
    (0x26A0, "⚠"), (0x2713, "✓"), (0x2714, "✔"),
    (0x2026, "…"), (0x2025, "‥"),
    (0x24B6, "Ⓐ"), (0x2776, "❶"),
    (0x2668, "♨"), (0x266C, "♬"),
    (0x00B1, "±"), (0x00D7, "×"), (0x00F7, "÷"),
    (0x00A7, "§"), (0x00B6, "¶"), (0x2030, "‰"),
    (0x2103, "℃"), (0x2121, "℡"), (0x2153, "⅓"),
]

SECTIONS = ("blocks", "samples", "cellfit")


def _display_width(s):
    """表示幅（East Asian Wide / Fullwidth を 2 と数える）。

    ラベルに日本語が混ざる表で `str.ljust` を使うと、桁数と表示幅が食い違って
    列がずれる。曖昧幅（`○` `△` 等）は 1 と数える——xterm.js の割り当てと同じ側。
    """
    import unicodedata
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in s)


def _pad(s, n):
    return s + " " * max(1, n - _display_width(s))


def _rpad(s, n):
    """右寄せ版（データ行の `{v:>n}` に見出しを合わせる）。"""
    return " " * max(1, n - _display_width(s)) + s


def ensure_widths(path):
    """幅表を用意する。省略時は dump-widths.mjs を呼んで scratch に生成する。"""
    if path:
        return path, None
    tmpdir = tempfile.mkdtemp(prefix="font-survey-")
    # 生成に失敗したら（node 不在・dump-widths.mjs の例外）作ったディレクトリを
    # その場で片づける——呼び出し側の finally には返り値が届かないので、ここで
    # 面倒を見ないと空の scratch が残る（レビュー I1）。
    try:
        out = os.path.join(tmpdir, "widths.json")
        dumper = os.path.join(HERE, "dump-widths.mjs")
        # 幅表の出どころ（addon の版）は測定の来歴なので 1 行だけ出す。生成本体の
        # 進捗ログ（サンプル一覧）は測定結果と混ざるので捨てる。
        version = subprocess.run(
            ["node", dumper, "--print-version"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        print(f"幅表: @xterm/addon-unicode11 {version} から生成（手書きの表は使わない）")
        print()
        subprocess.run(
            ["node", dumper, out],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except BaseException:
        cleanup_tmpdir(tmpdir)
        raise
    return out, tmpdir


def cleanup_tmpdir(tmpdir):
    if not tmpdir:
        return
    for root, _dirs, files in os.walk(tmpdir, topdown=False):
        for name in files:
            os.unlink(os.path.join(root, name))
    os.rmdir(tmpdir)


class Face:
    def __init__(self, path, width_of):
        self.path = path
        self.name = os.path.basename(path)
        self.font = TTFont(path, lazy=True)
        self.cmap = self.font.getBestCmap()
        self.hmtx = self.font["hmtx"]
        try:
            self.glyf = self.font["glyf"]
        except KeyError:
            sys.exit(f"[survey] glyf が無い（CFF アウトライン）: {path}")
        if 0x41 not in self.cmap:
            sys.exit(f"[survey] cmap に 'A'(U+0041) が無い: {path}")
        self.A = self.hmtx[self.cmap[0x41]][0]
        self.upem = self.font["head"].unitsPerEm
        self.width_of = width_of

    def cells(self, cp):
        return self.width_of(cp)

    def in_scope(self, cp):
        """4 除外（fit.py の target_advance と verify.py の 4 項条件と同一）。"""
        return (
            cp > 0xFF
            and not in_private_use(cp)
            and not in_custom_range(cp)
            and self.width_of(cp) == 1
        )


def count_series(face, member):
    """1 系列を数える。member(cp) が真の符号位置だけを対象にする。

    返す 5 値: 対象数 / 条件1 / 条件2 / AND / OR。
    対象は「輪郭を持つ」グリフに限る（空グリフは箱から出ようがない）。
    """
    subjects = adv = ink = both = either = 0
    for cp, name in face.cmap.items():
        if not member(cp):
            continue
        cells = face.cells(cp)
        if cells in (0, 255):        # 結合文字 / 制御は箱を持たない
            continue
        g = face.glyf[name]
        if g.numberOfContours == 0:
            continue
        box = face.A * cells
        subjects += 1
        a = face.hmtx[name][0] != box
        i = g.xMin < 0 or g.xMax > box
        adv += a
        ink += i
        both += (a and i)
        either += (a or i)
    return subjects, adv, ink, both, either


def report_cellfit(faces):
    print("=== セル適合（条件 1 = advance / 条件 2 = ink・2 条件を分けて出す）===")
    print()
    print("箱幅 = A × 割り当てセル数（幅表は @xterm/addon-unicode11 から生成）。")
    print("`ink外` は **ink 単独の値**。`adv∨ink` と別の列にしてあるのは、面によって")
    print("条件 1 の集合が条件 2 に含まれ両者が同数になるため（PlemolJP Console HS の")
    print("2 面がその実例で、test/font-cellfit.test.js 冒頭の `374 / 460` を含む段落は")
    print("同じ数を OR として記録している。ink 値を OR ラベルで再導出しないこと）。")
    print()
    # face 名の幅は実測で決める（固定幅にすると長い名前 1 つで全列がずれる）。
    name_w = max(len(f.name) for f in faces) + 2
    head_w = name_w + 5 + 6 + 2
    # 見出しは `_pad` / `_rpad` で組む（CJK ラベルの表示幅ぶん列がずれるため・
    # データ行の `{v:>n}` と桁を合わせる）。
    header = (_pad("face", name_w) + _rpad("A", 5) + _rpad("upem", 6) + "  "
              + _pad("系列", 12)
              + _rpad("対象", 5) + _rpad("adv≠箱", 8) + _rpad("ink外", 7)
              + _rpad("adv∧ink", 9) + _rpad("adv∨ink", 9))
    print(header)
    print("-" * (head_w + 52))
    for face in faces:
        series = [
            ("scope内", face.in_scope),
            ("Latin-1", lambda cp: cp <= 0xFF),
            ("全体", lambda cp: True),
        ]
        for i, (label, member) in enumerate(series):
            subjects, adv, ink, both, either = count_series(face, member)
            head = (f"{face.name:<{name_w}}{face.A:>5}{face.upem:>6}  "
                    if i == 0 else " " * head_w)
            print(f"{head}{_pad(label, 12)}"
                  f"{subjects:>5}{adv:>8}{ink:>7}{both:>9}{either:>9}")
    print()
    print("scope内 = 4 除外（cp<=0xFF / BMP 私用領域 / 罫線・ブロック要素 / 幅 1 以外）")
    print("Latin-1 = cp<=0xFF（4 除外の 1 番目・scope の外。scope 内の数と足さないこと）")
    print("全体    = cmap 全体（除外なし・幅 0 と制御を除く）")
    print()


def report_samples(faces):
    print("=== 日常記号 26 サンプルの実在とセル適合 ===")
    print()
    print("○ = advance == A かつ ink が [0, A] に収まる / △ = 収録はあるが箱の外 /")
    print("— = cmap に無い（OS のフォールバックが描く＝変換の対象外。変換はグリフを増やせない）")
    print("注: ± × ÷ § ¶ は cp<=0xFF で **cellfit の scope 内系列には入っていない**。")
    print()
    width = max(len(f.name) for f in faces) + 2
    label_w = 24
    print(_pad("記号", label_w) + "".join(f"{f.name:<{width}}" for f in faces))
    print("-" * (label_w + width * len(faces)))
    tally = {f.name: {"○": 0, "△": 0, "—": 0} for f in faces}
    for cp, ch in SAMPLES:
        row = _pad(f"{ch} U+{cp:04X}", label_w)
        for face in faces:
            name = face.cmap.get(cp)
            if name is None:
                mark = "—"
            else:
                g = face.glyf[name]
                adv = face.hmtx[name][0]
                if g.numberOfContours == 0:
                    mark = "—"          # 空グリフは描かれない＝実在しないのと同じ
                elif adv == face.A and g.xMin >= 0 and g.xMax <= face.A:
                    mark = "○"
                else:
                    mark = "△"
            tally[face.name][mark] += 1
            row += _pad(mark, width)
        print(row)
    print("-" * (label_w + width * len(faces)))
    for mark, label in (("○", "○ の数 / 26"), ("△", "△（収録あるが箱外）"), ("—", "—（未収録）")):
        print(_pad(label, label_w)
              + "".join(f"{tally[f.name][mark]:<{width}}" for f in faces))
    print()


def report_blocks(faces):
    print("=== ブロック別の収録数 ===")
    print()
    width = max(len(f.name) for f in faces) + 2
    label_w = 22
    print(_pad("", label_w) + "".join(f"{f.name:>{width}}" for f in faces))
    print("-" * (label_w + width * len(faces)))
    print(_pad("総収録数", label_w) + "".join(f"{len(f.cmap):>{width},}" for f in faces))
    print("-" * (label_w + width * len(faces)))
    for label, lo, hi in BLOCKS:
        size = hi - lo + 1
        row = _pad(label, label_w)
        for face in faces:
            n = sum(1 for cp in face.cmap if lo <= cp <= hi)
            cell = f"{n:>5} /{size:>5} ({100 * n / size:>3.0f}%)"
            row += f"{cell:>{width}}"
        print(row)
    print()


def parse_codepoints(spec):
    out = []
    for token in spec.split(","):
        token = token.strip()
        if not token:
            continue
        text = token[2:] if token.upper().startswith("U+") else token
        try:
            out.append(int(text, 16))
        except ValueError:
            sys.exit(f"[survey] 符号位置として読めない: {token}（U+00EE の形で書く）")
    return out


def report_codepoints(faces, codepoints):
    print("=== 指定した符号位置の advance と ink 境界 ===")
    print()
    for face in faces:
        print(f"{face.name}  A={face.A}  upem={face.upem}")
        print("  " + _pad("char", 6) + _pad("cp", 10)
              + _rpad("セル", 5) + _rpad("箱", 7) + _rpad("advance", 9)
              + _rpad("xMin", 7) + _rpad("xMax", 7) + "  判定")
        for cp in codepoints:
            name = face.cmap.get(cp)
            # サロゲート（U+D800-DFFF）と非文字は `chr()` は返すが print で
            # UnicodeEncodeError になる。表示だけ諦めて測定は続ける。
            printable = not (0xD800 <= cp <= 0xDFFF or (cp & 0xFFFE) == 0xFFFE)
            label = _pad(chr(cp) if printable else "?", 6)
            cpname = _pad(f"U+{cp:04X}", 10)
            if name is None:
                print(f"  {label}{cpname}    cmap に無い（OS のフォールバック）")
                continue
            cells = face.cells(cp)
            box = face.A * cells if cells not in (0, 255) else None
            adv = face.hmtx[name][0]
            g = face.glyf[name]
            if g.numberOfContours == 0:
                print(f"  {label}{cpname}{cells:>5}{'-' if box is None else box:>7}"
                      f"{adv:>9}      -      -  空グリフ")
                continue
            marks = []
            if box is not None and adv != box:
                marks.append(f"adv≠箱({adv - box:+d})")
            if box is not None and (g.xMin < 0 or g.xMax > box):
                marks.append(f"ink外(xMin={g.xMin} xMax={g.xMax} 箱={box})")
            verdict = " / ".join(marks) if marks else "箱に収まる"
            print(f"  {label}{cpname}{cells:>5}{'-' if box is None else box:>7}"
                  f"{adv:>9}{g.xMin:>7}{g.xMax:>7}  {verdict}")
        print()


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="survey.py",
        description="フォント候補の収録範囲とセル適合を実測する",
    )
    ap.add_argument("fonts", nargs="+", help="測る TTF（複数指定で 1 表にまとめる）")
    ap.add_argument("--widths", default=None,
                    help="widths.json（省略時は dump-widths.mjs で生成）")
    ap.add_argument("--section", default=",".join(SECTIONS),
                    help=f"出す節（カンマ区切り・既定は全部）: {' / '.join(SECTIONS)}")
    ap.add_argument("--codepoints", default=None, metavar="LIST",
                    help="個別に advance と ink 境界を見る符号位置（U+00EE,U+2605 の形）")
    args = ap.parse_args(argv)

    sections = [s.strip() for s in args.section.split(",") if s.strip()]
    unknown = [s for s in sections if s not in SECTIONS]
    if unknown:
        sys.exit(f"[survey] 知らない節: {', '.join(unknown)}（{' / '.join(SECTIONS)}）")

    # `--widths` 省略時は scratch へ幅表を作る。node の失敗（node 不在・
    # dump-widths.mjs の例外）で mkdtemp 済みのディレクトリが残らないよう、
    # 生成そのものも finally の内側に置く（レビュー I1）。
    widths_path = tmpdir = None
    try:
        widths_path, tmpdir = ensure_widths(args.widths)
        width_of = load_widths(widths_path)
        faces = [Face(p, width_of) for p in args.fonts]

        if "blocks" in sections:
            report_blocks(faces)
        if "samples" in sections:
            report_samples(faces)
        if "cellfit" in sections:
            report_cellfit(faces)
        if args.codepoints:
            report_codepoints(faces, parse_codepoints(args.codepoints))
    finally:
        cleanup_tmpdir(tmpdir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
