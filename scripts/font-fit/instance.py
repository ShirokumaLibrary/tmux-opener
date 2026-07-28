"""可変フォントを指定 weight で静的化する。

（#262 の動作確認済み試作からの移植。設計 #271 R5/R6。）

M PLUS 1 Code は fvar の wght 軸 100-700 を持つ可変フォント。輪郭を編集すると
gvar のデルタ（旧い点数に紐づく）が壊れるので、**先に静的化してから**縮小する。
順序は固定——fit.py を先に走らせると gvar が壊れる。
副産物として Regular/Bold が実体のある 2 面になり、他パッケージと同じ faces 形になる。

recalcTimestamp=False は決定性のため（設計 #271 R5）。ここで head.modified が
「今」に書き換わると、後段の fit.py が何をしようと出力 sha256 が毎回変わる。

使い方: instance.py <入力 TTF> <出力 TTF> <wght>
"""

import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer


def main(src, dst, wght):
    font = TTFont(src, recalcTimestamp=False)
    axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in font["fvar"].axes}
    print(f"{src.split('/')[-1]}  軸: {axes}")
    inst = instancer.instantiateVariableFont(font, {"wght": float(wght)}, inplace=True, updateFontNames=False)
    inst.save(dst)
    print(f"  wght={wght} で静的化 -> {dst.split('/')[-1]}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
