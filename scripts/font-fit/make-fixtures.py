"""`check-license.py` の陽性コントロール用 fixture を作る（レビュー #288 M6）。

`font-packages/README.md` は「`.py` に自動ゲートが届かないので、**陽性コントロールと
記録された数値が gate の代わり**」と述べている。ところが 3 本のコントロールのうち
落とし穴 1（case）だけが同梱バイト（`font-plemoljp-console/LICENSE.txt:48`）で赤に
でき、残り 2 本は合成 fixture に依存していた——リポジトリに fixture が無ければ、
後の読み手はその 2 本を**再走できない**。gate の代替と称するものが再現できないのでは
主張が成立しないので、fixture を「作る手順」として同梱する。

fixture そのものはコミットしない（scratch へ書く）。数十バイトのテキストと、
同梱 TTF から派生させる 1 面だけなので、**作り直せることがバイト列を置くことより
強い**——TTF を置くと `test/font-cellfit.test.js` の走査対象や VSIX 検査と紛らわしい。

使い方: make-fixtures.py <出力ディレクトリ>

作るもの:
  text/LICENSE_E        拡張子なし・RFN 1 行（落とし穴 2 の赤経路）
  text/LICENSE_J        Shift_JIS の RFN 1 行（レビュー H2・非 UTF-8 の赤経路）
  text/LICENSE_UTF16    UTF-16 の RFN 1 行（同上）
  text/LICENSE_LATIN1   Latin-1 の RFN 1 行（同上）
  text/LICENSE_H1       抽出の 23 パターン（H1 6 形 + NH1 6 形 + NH2 3 形 + NM4 1 形
                        + NNH1 5 形〔括弧・略語ピリオド・セミコロンでの打ち切り〕
                        + CJK 1 形 + アポストロフィ 1 形。いずれも実測された偽陰性
                        か、判定を壊す過剰捕捉）
  font/Probe-Regular.ttf  nameID 0 **だけ**に予約名を持つ面（落とし穴 3 の赤経路）
  font/broken.ttf         先頭 2000 バイトで切った TTF（M3・走査が止まらないこと）

確認のしかたは `font-packages/README.md`「Reserved Font Name check」に書いてある。
"""

import os
import re
import sys

# 種にする面: **name テーブルに RFN を持たない**面を選ぶ（持つ面を種にすると、
# 「nameID 0 にしか無い予約名」という fixture の性質が崩れる）。実測で
# MPLUS1CodeTerm-Regular.ttf は name テーブルに RFN を持たない。
SEED_TTF = os.path.join("font-packages", "font-mplus1code", "fonts",
                        "MPLUS1CodeTerm-Regular.ttf")

EXTLESS = """\
This Font Software is licensed under the SIL Open Font License, Version 1.1.

Copyright (c) 2099, Fixture Author, with Reserved Font Name "FixtureExtless"

（拡張子なしのライセンス文書。#277 で LICENSE_E / LICENSE_J が --include='*.txt' に
 覆われず落ちた形。--control-ext-filter txt を付けるとこの行が消える）
"""

H1_PATTERNS = """\
with Reserved Font Name Cica, based on the "Hack" project.
with Reserved Font Names Foo and Bar
with Reserved Font Name `Backtick`
with Reserved Font Name: lowercase
with Reserved Font Name (Paren)
Copyright, with Reserved Font Name Multi and Reserved Font Name Second
The Reserved Font Name for this font is Golf.
Reserved Font Names are Hotel and India.
with Reserved Font Name of Juliett
Reserved Font Name: is Kilo
with Reserved Font Name Note Lima
with Reserved Font Name The Mike
with Reserved Font Name "Alpha" and Bravo
with Reserved Font Names (Charlie) and Delta
with Reserved Font Name \u300cEcho\u300d and Foxtrot
with Reserved Font Name "November" and also Reserved Font Name.  Oscar
with Reserved Font Names Papa (the base) and Quebec
with Reserved Font Name Romeo (formerly Foo) and Sierra
with Reserved Font Name Inc. Tango
with Reserved Font Names Uniform. Victor is also reserved
with Reserved Font Name Whiskey; Xray is also reserved
with Reserved Font Name シータ。イオタも予約
with Reserved Font Names Foo's Yankee and Bar's Zulu
"""

NON_UTF8_LINE = 'Copyright (c) 2099, 大河原, with Reserved Font Name "SjisReserved"\n'
LATIN1_LINE = ('Copyright (c) 2099, André, with Reserved Font Name '
               '"Latin1Reserved"\n')

NAME_TABLE_ONLY = ('Copyright (c) 2099 Fixture Author, with Reserved Font Name '
                   '"NameTableOnlyProbe".')


def main(out_dir):
    text_dir = os.path.join(out_dir, "text")
    font_dir = os.path.join(out_dir, "font")
    os.makedirs(text_dir, exist_ok=True)
    os.makedirs(font_dir, exist_ok=True)

    with open(os.path.join(text_dir, "LICENSE_E"), "w", encoding="utf-8") as fp:
        fp.write(EXTLESS)
    with open(os.path.join(text_dir, "LICENSE_H1"), "w", encoding="utf-8") as fp:
        fp.write(H1_PATTERNS)
    with open(os.path.join(text_dir, "LICENSE_J"), "wb") as fp:
        fp.write(NON_UTF8_LINE.encode("shift_jis"))
    with open(os.path.join(text_dir, "LICENSE_UTF16"), "wb") as fp:
        fp.write(NON_UTF8_LINE.encode("utf-16"))
    with open(os.path.join(text_dir, "LICENSE_LATIN1"), "wb") as fp:
        fp.write(LATIN1_LINE.encode("latin-1"))

    if not os.path.exists(SEED_TTF):
        sys.exit(f"[make-fixtures] 種の TTF が無い（リポジトリルートで実行すること）: {SEED_TTF}")

    from fontTools.ttLib import TTFont

    # 種の面に予約名が**無い**ことをその場で確かめる（レビュー #288 NM5）。
    # コントロール 3 は「nameID 0 **だけ**に予約名がある面」でなければ何も証明
    # しない。種を差し替えた／上流を再変換して name テーブルに RFN が入った場合、
    # probe はその性質を失うのにコントロールは緑のまま——`--control-*` が防ごうと
    # している GREEN CONTROL と同型なので、生成器が自分で落ちる。
    phrase = re.compile(r"reserved\s+font\s+names?", re.IGNORECASE)
    seed = TTFont(SEED_TTF)
    seed_hits = []
    for rec in seed["name"].names:
        try:
            text = rec.toUnicode()
        except Exception:                              # noqa: BLE001
            seed_hits.append(f"nameID {rec.nameID}: decode できない name レコード")
            continue
        if phrase.search(text):
            seed_hits.append(f"nameID {rec.nameID}: {' '.join(text.split())[:120]}")
    if seed_hits:
        sys.exit(
            "[make-fixtures] 種の面が既に予約名の語句を持っている: "
            f"{SEED_TTF}\n  " + "\n  ".join(seed_hits) +
            "\n  コントロール 3 は『nameID 0 だけに予約名がある面』でしか成立しない。"
            "\n  語句を持たない面へ SEED_TTF を差し替えること。"
        )

    font = TTFont(SEED_TTF)
    for rec in list(font["name"].names):
        if rec.nameID == 0:
            rec.string = NAME_TABLE_ONLY
    probe = os.path.join(font_dir, "Probe-Regular.ttf")
    font.save(probe)

    # 出来上がった probe が「nameID 0 の 1 件だけ」であることも確かめる。
    written = TTFont(probe)
    probe_hits = [rec.nameID for rec in written["name"].names
                  if phrase.search(rec.toUnicode())]
    if set(probe_hits) != {0}:
        sys.exit(f"[make-fixtures] probe の予約名が nameID 0 だけになっていない: "
                 f"{sorted(set(probe_hits))}")

    with open(SEED_TTF, "rb") as src, \
            open(os.path.join(font_dir, "broken.ttf"), "wb") as dst:
        dst.write(src.read(2000))

    print(f"[make-fixtures] 作った: {out_dir}")
    for root, _dirs, files in os.walk(out_dir):
        for name in sorted(files):
            print(f"  {os.path.join(root, name)}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("使い方: make-fixtures.py <出力ディレクトリ>（scratch を指すこと）")
    sys.exit(main(sys.argv[1]))
