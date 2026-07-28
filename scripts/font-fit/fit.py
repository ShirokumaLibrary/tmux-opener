"""ターミナルのセル幅に合わないグリフを、形を保ったまま収める。

（#262 の動作確認済み試作 `shrink.py` からの移植。設計 #271 R5。
  新規実装ではない——事故 4 件の対策がこのファイルのコメントに書いてある。）

目標は一つ: どの符号位置でも「輪郭が **宣言した fitRatio の帯**に収まる」。
xterm の挙動（media/xterm/addon-webgl.js の allowRescaling）:
  - ink > ceil(1.5 * セル幅) → 横方向だけ縮める（縦は据え置き）= 潰れて見える
  - 1.0 < ink/セル幅 <= 1.5   → 何もしない = 隣のセルにわずかに被る
  - ink <= セル幅              → 何も起きない
つまり「潰される帯」に入らなければよく、セル幅ちょうどである必要はない。どこまで
許すかが fitRatio（room = A * fitRatio）で、**意味・上限・既定の正本は
scripts/font-fit/manifest.json の note**。ここでは実装だけを持つ（二重管理しない）。

割り当てセル数は xterm 自身の unicode11 プロバイダから吸い出した表（widths.json・
dump-widths.mjs が生成）を正本にする。EastAsianWidth を手で転記すると必ず漏れる
（⚠ ✓ ✔ を落とした = #262 事故 1）。

やること（対象グリフのみ）:
  1. ink 幅が room に収まる係数 s を出す（横だけ潰さないための係数）。
     すでに room 以下なら縮小しない（s = 1.0 = 移動のみ）
  2. 横倍率は s、縦倍率は s * vstretch を掛ける（#293。vstretch = 1.0 なら
     従来どおりの等倍で、出力バイト列は #291 と恒等）。縦倍率は、伸ばした結果が
     参照グリフの **y 到達範囲**（上端・下端）を越えない範囲へ clamp する（下限 1.0）
  3. ink の縦中心は据え置き、横は箱の中央へ寄せる。room > A のときのはみ出しは
     この中央寄せによって左右対称（±(ink - A)/2）になる
  4. advance を A*w に、lsb を新しい xMin に
  5. ヒンティング命令を空にする（座標が変わったので無効）

複合グリフの巻き添えを防ぐ二相構成（= #262 事故 2 の対策）:
  `ざ` は `さ` と `゛`(U+309B) の複合で、`゛` は幅 1 の縮小対象。素朴に順番に書き換えると
  `゛` を縮めた瞬間、それを参照する `ざ` `ど` `ぼ` … 本文のかなまで一緒に変わる。
  同じ理屈で `ℵ` `♻` のように「対象を参照しているが自身は適合済み」のグリフも壊れた。
  そこで:
    相 A: 元のフォントから、変更対象 M と「M を推移的に参照する複合グリフ」C の
          輪郭を分解して控える（この時点では何も書き換えない）
    相 B: 控えた輪郭を書き戻す。M は変換して、C は元のまま（分解済みの姿で固定）
  これで C は変更前の見た目を保ったまま M から切り離される。

触らないもの:
  - 幅 0（結合文字）と制御文字
  - 罫線 U+2500-257F / ブロック U+2580-259F
    （WebGL の customGlyphs がフォントを見ずにベクタで描く。かつ罫線は
      セル端に接して線をつなぐ必要があり、内側に縮めると繋がらなくなる）
  - 割り当て幅が食い違う符号位置から共有されているグリフ
  - 既にセルの中に収まっていて、room にも収まっていて、advance も正しいグリフ

使い方: fit.py <widths.json> <入力 TTF> <出力 TTF> <family> <style> <fitRatio> <vstretch>

fitRatio / vstretch に既定値は置かない（どちらも必須引数）。既定は manifest.json が
持ち、run.sh が解決して渡す——ここにも既定を書くと「どちらが効いたか」が事後に
分からなくなる。
"""

import json
import struct
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import ControlBoundsPen
from fontTools.misc.transform import Transform
from fontTools.ttLib.tables import ttProgram
from fontTools.ttLib.tables._g_l_y_f import Glyph

# fitRatio の上限。xterm の allowRescaling が「横だけ潰す」帯に入る境界そのもので、
# 好みの問題ではない（glyphWidth > ceil(1.5 * cellWidth) で潰れる）。この変換が存在
# する理由が「潰させない」ことなので、ここを超える値は受け付けない。
# 1.5 ちょうどが安全という意味ではない（判定はアンチエイリアス込みのデバイス
# ピクセル）——実用上の推奨は manifest.json の note にある。
MAX_FIT_RATIO = 1.5

# vstretch の下限。1.0 未満は「等倍より縦を縮める」で、この変換が縦へ手を入れる
# 理由（幅を詰めたぶん失った高さを取り戻す）と逆向きなので受け付けない。
# **上限側は定数ではない**——フォントから実測する参照グリフの y 到達範囲で、
# 個々のグリフごとに縦倍率を clamp する（意味の正本は manifest.json の note）。
MIN_VSTRETCH = 1.0

# 縦の壁になる参照グリフ。漢 (U+6F22) の ink の **上端と下端** が、そのフォントで
# 「本文が行の上下へ既に届いている位置」の実測値になる。伸長後の上端・下端が
# その内側にとどまる限り、この変換はグリフを漢より外へ出さない。**推測値で
# 代替しない**: この符号位置を持たないフォントは壁を実測できないので、1 バイトも
# 書く前に変換を拒否する。
VSTRETCH_REFERENCE_CP = 0x6F22

# customGlyphs が描く範囲（罫線・ブロック）
CUSTOM_GLYPH_RANGES = [(0x2500, 0x257F), (0x2580, 0x259F)]

# 私用領域（BMP PUA 全域）。Powerline 等のグリフが載る領域で、xterm の
# allowRescaling はここを縮小しない。
PRIVATE_USE_RANGE = (0xE000, 0xF8FF)


def parse_fit_ratio(raw):
    """文字列を fitRatio へ。範囲外・非数は **1 バイトも書く前に** ここで落とす。

    範囲は 0 < r <= MAX_FIT_RATIO。0 以下は「ink 幅 0 以下へ縮める」で意味を成さず、
    上限超えは xterm に横だけ潰させる。呼び出し側（run.sh）も manifest の全 face を
    変換開始前に同じ規則で検査するが、こちらは fit.py を直接叩いた場合の砦。
    """
    try:
        ratio = float(raw)
    except (TypeError, ValueError):
        raise SystemExit(f"[fit] fitRatio が数値でない: {raw!r}")
    if ratio != ratio or ratio in (float("inf"), float("-inf")):
        raise SystemExit(f"[fit] fitRatio が数値でない: {raw!r}")
    if ratio <= 0:
        raise SystemExit(f"[fit] fitRatio は 0 より大きくなければならない: {ratio}")
    if ratio > MAX_FIT_RATIO:
        raise SystemExit(
            f"[fit] fitRatio が上限 {MAX_FIT_RATIO} を超えている: {ratio}\n"
            f"  上限は xterm の allowRescaling が横だけ潰す境界（ink > ceil(1.5*セル幅)）。\n"
            f"  これを超える値で焼いた TTF は、この変換が防ごうとしている潰れ方をする。"
        )
    return ratio


def parse_vstretch(raw):
    """文字列を vstretch へ。範囲外・非数は **1 バイトも書く前に** ここで落とす。

    範囲は v >= MIN_VSTRETCH（= 1.0）。**上限は書かない**——上限は定数ではなく
    フォントから実測する参照グリフの **y 到達範囲**（ink の上端・下端）で、グリフ
    ごとに縦倍率を clamp する形で効く（意味の正本は manifest.json の note）。
    ここで数値としての上限を
    足すと、実測の壁と好みの壁が 2 本立つことになる。
    """
    try:
        v = float(raw)
    except (TypeError, ValueError):
        raise SystemExit(f"[fit] vstretch が数値でない: {raw!r}")
    if v != v or v in (float("inf"), float("-inf")):
        raise SystemExit(f"[fit] vstretch が数値でない: {raw!r}")
    if v < MIN_VSTRETCH:
        raise SystemExit(
            f"[fit] vstretch は {MIN_VSTRETCH} 以上でなければならない: {v}\n"
            f"  1.0 未満は等倍より縦を縮める指定で、この変換が縦へ手を入れる理由と逆向き。"
        )
    return v


def load_widths(path):
    """[start, end, width] のランから cp -> 列数 を引く関数を返す。"""
    with open(path) as fp:
        runs = json.load(fp)

    def width_of(cp):
        lo, hi = 0, len(runs) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            s, e, w = runs[mid]
            if cp < s:
                hi = mid - 1
            elif cp > e:
                lo = mid + 1
            else:
                return w
        return 1

    return width_of


def in_custom_range(cp):
    return any(lo <= cp <= hi for lo, hi in CUSTOM_GLYPH_RANGES)


def in_private_use(cp):
    lo, hi = PRIVATE_USE_RANGE
    return lo <= cp <= hi


# 複合グリフの component フラグ（OpenType 仕様）
_ARG_1_AND_2_ARE_WORDS = 0x0001
_WE_HAVE_A_SCALE = 0x0008
_MORE_COMPONENTS = 0x0020
_WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
_WE_HAVE_A_TWO_BY_TWO = 0x0080


def _raw_components(glyf, name, glyph_order):
    """グリフを展開せずに、参照している部品グリフ名を返す。

    展開したグリフは保存時に再コンパイルされ、座標が数ユニット動く。fontTools は
    未展開のグリフだけを元のバイト列のまま書き戻すので、「調べるための展開」も
    事故になる。Rounded Mgen+ は本文の多くが複合グリフで、部品を読むために
    展開しただけで対象外の漢字・かな 3400 個がずれた。そこで生バイトを直接読む。
    """
    g = glyf.glyphs[name]
    data = getattr(g, "data", None)
    if data is None:                       # 既に展開済み（＝これから書き換えるもの）
        return [c.glyphName for c in getattr(g, "components", ())]
    if len(data) < 10 or struct.unpack(">h", data[:2])[0] >= 0:
        return []                          # 単純グリフ、または空

    out, pos = [], 10
    while pos + 4 <= len(data):
        flags, glyph_index = struct.unpack(">HH", data[pos:pos + 4])
        pos += 4
        if glyph_index < len(glyph_order):
            out.append(glyph_order[glyph_index])
        pos += 4 if flags & _ARG_1_AND_2_ARE_WORDS else 2
        if flags & _WE_HAVE_A_SCALE:
            pos += 2
        elif flags & _WE_HAVE_AN_X_AND_Y_SCALE:
            pos += 4
        elif flags & _WE_HAVE_A_TWO_BY_TWO:
            pos += 8
        if not flags & _MORE_COMPONENTS:
            break
    return out


def _referencing_composites(glyf, targets, glyph_order):
    """targets を推移的に参照している複合グリフの集合（targets 自身は含まない）。"""
    parents = {}
    for name in glyf.keys():
        for child in _raw_components(glyf, name, glyph_order):
            parents.setdefault(child, set()).add(name)

    found, stack = set(), list(targets)
    while stack:
        child = stack.pop()
        for parent in parents.get(child, ()):
            if parent in found or parent in targets:
                continue
            found.add(parent)
            stack.append(parent)
    return found


def measure_ink_box(glyph_set, glyf, cmap, cp):
    """符号位置 cp の輪郭を分解して ink の箱を実測する（無ければ None）。

    格納 bbox（g.yMin / g.yMax）ではなく輪郭から測る。理由は plan ループの
    適合判定と同じで、格納値は古いことがある（#262 の ℵ ♺）。verify.py の
    契約③ も同じ物差し（分解した輪郭の制御点箱）で測る。
    """
    name = cmap.get(cp)
    if name is None or glyf[name].numberOfContours == 0:
        return None
    rec = DecomposingRecordingPen(glyph_set)
    glyph_set[name].draw(rec)
    bounds = ControlBoundsPen(None)
    rec.replay(bounds)
    return bounds.bounds


def fit(in_path, out_path, new_family, new_style, width_of, fit_ratio, vstretch,
        report=True):
    # recalcBBoxes=False が要（= #262 事故 3 の対策）。既定の True だと fontTools は
    # 保存時に全グリフを展開して bbox を再計算する。xMin が実インクから制御点箱へ
    # 変わる一方 hmtx の lsb は据え置きで、fontTools の TTGlyphSet は描画時に
    # offset = lsb - xMin を適用するため、触っていない A や漢字が数ユニット横に
    # ずれる（Rounded Mgen+ で 3400 個）。
    #
    # recalcTimestamp=False は決定性のため（設計 #271 R5）。既定の True は保存の
    # たびに head.modified を「今」で書き換えるので、同一入力から同一 sha256 が
    # 出なくなり、R7 の再現性主張と R13 の checksums 束縛がどちらも成立しない。
    font = TTFont(in_path, recalcBBoxes=False, recalcTimestamp=False)
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()

    # 【変更対象以外は元のバイト列に戻す】
    # fontTools は「一度も展開していないグリフ」を元バイトのまま書き戻すが、展開した
    # グリフは再コンパイルし、そこで座標が数ユニット動く。そして展開は意図せず伝播する:
    # `Ⓐ` は丸と `A` の複合なので、候補である `Ⓐ` を分解した時点で部品の `A` まで
    # 展開される。Rounded Mgen+ ではこれで対象外の 3400 個（A M V W・漢字・かな）が
    # ずれていた。展開を避けきるのは不可能なので、最後に元バイトへ戻す方針に変える。
    original_bytes = {}
    for _name in font.getGlyphOrder():
        _data = getattr(glyf.glyphs[_name], "data", None)
        if _data is not None:
            original_bytes[_name] = _data

    A = hmtx[cmap[0x41]][0]

    # 縦の壁（参照グリフの y 到達範囲）を **このフォントから実測**する（#293）。
    # 定数ではないので upem や
    # 書体の差にそのまま追従する。参照グリフが無ければ推測せずに落ちる——ここは
    # まだ font.save() の前なので、出力は 1 バイトも書かれていない。
    _ref_box = measure_ink_box(glyph_set, glyf, cmap, VSTRETCH_REFERENCE_CP)
    if _ref_box is None:
        raise SystemExit(
            f"[fit] 縦の壁の参照グリフ U+{VSTRETCH_REFERENCE_CP:04X} "
            f"({chr(VSTRETCH_REFERENCE_CP)}) の y 到達範囲を測れない: {in_path}\n"
            f"  このフォントでは縦の壁（このグリフの ink の上端・下端）を実測できない。\n"
            f"  縛るのは ink の高さではなく行の上下への到達なので、上端・下端の両方が要る。\n"
            f"  推測値では代替しない（設計の判断・#293）ので変換を行わない。"
        )
    _rx0, ref_y0, _rx1, ref_y1 = _ref_box
    max_ink_h = ref_y1 - ref_y0

    def target_advance(cp):
        """この符号位置に割り当てられる箱の幅。触らない対象なら None。

        xterm の allowRescaling が発動しうる条件をそのまま写す（3 述語・
        = #262 事故 4 の対策）:
          width === 1 かつ codepoint > 0xFF かつ私用領域(U+E000-F8FF)でない。
        ASCII / Latin-1 は xterm が決して縮小しないので、輪郭が advance を
        わずかに超えていても実害がない（書体として常態）。対象に入れると
        本文の A M V W まで動かしてしまう。
        幅 2 も対象外（allowRescaling は width===1 でしか動かない）。幅 2 まで
        対象にしていた版は `ぃ` に手を入れていた。
        """
        if cp <= 0xFF or in_private_use(cp):
            return None
        if width_of(cp) != 1:  # 0 = 結合文字, 2 = 全角, 255 = 制御
            return None
        return A

    # グリフ名 -> それを指す符号位置が要求する箱幅の集合
    # customGlyphs が描く符号位置はフォントを参照しないので要求から外す
    demands = {}
    for cp, name in cmap.items():
        if in_custom_range(cp):
            continue
        demands.setdefault(name, set()).add(target_advance(cp))

    plan = {}          # グリフ名 -> (代表 cp, 箱幅)
    recorded = {}      # グリフ名 -> 分解済み輪郭（変換前）
    skipped_shared = []
    already_ok = 0
    for cp, name in sorted(cmap.items()):
        if name in plan or name not in demands:
            continue
        wanted = demands[name]
        if None in wanted:
            continue
        if len(wanted) > 1:
            skipped_shared.append((cp, name))
            continue
        t = next(iter(wanted))
        if glyf[name].numberOfContours == 0:
            continue
        # 適合判定は輪郭から実測する。glyf に保存された bbox は古いことがあり、
        # Mgen+ の ℵ ♺ は保存値が実体より小さく「適合済み」と誤判定されていた。
        rec = DecomposingRecordingPen(glyph_set)
        glyph_set[name].draw(rec)
        bounds = ControlBoundsPen(None)
        rec.replay(bounds)
        if bounds.bounds is None:
            continue
        x0, _y0, x1, _y1 = bounds.bounds
        # 「触らない」の条件は 3 つそろって初めて成立する: セルの中に収まっていて、
        # room にも収まっていて、advance が正しい。3 つ目の room 条件は fit_ratio >= 1
        # では 1 つ目から導ける（ink <= A <= room）ので **出力バイトを変えない**が、
        # fit_ratio < 1 では導けない——ink が room と A の間にあるグリフを素通しして
        # しまい、verify.py の契約①(a)（ink <= room）を構造的に満たせなくなる。
        # 検査が絶対に通らない設定を作らないために、ここで閉じておく。
        # **この選択規則は verify.py の selected_glyphs が同形で持っている**
        # （#293 レビュー Low-3）。契約③(b) は「宣言値ちょうどまで伸ばした」という
        # 下限の主張なので、検証側の対象集合がここより広いと「触っていないグリフが
        # 伸びていない」を違反として挙げてしまう——契約① のように「verify を厳しい側
        # へ倒す」逃げ道が無い唯一の場所。demands の作り方・None / 複数要求の除外・
        # ここの 3 条件のどれかを触るときは、必ず verify.py 側も一緒に動かすこと。
        if x0 >= 0 and x1 <= t and (x1 - x0) <= t * fit_ratio and hmtx[name][0] == t:
            already_ok += 1
            continue
        plan[name] = (cp, t)
        recorded[name] = rec

    # --- 相 A: 巻き添えになる複合グリフの輪郭も控える（まだ書き換えない）---------
    collateral = _referencing_composites(glyf, set(plan), font.getGlyphOrder())
    for name in sorted(collateral):
        rec = DecomposingRecordingPen(glyph_set)
        glyph_set[name].draw(rec)
        recorded[name] = rec

    # --- 相 B: 書き戻す --------------------------------------------------------
    changed, translated_only = [], 0
    clamped, floored, grew = 0, 0, 0
    # 到達の診断（#293 レビュー High-1）。「参照グリフ（漢）の y 範囲より外へ出ている
    # 対象グリフ」を、等倍（vstretch = 1.0）の姿と、実際に書き出した姿の両方で数える。
    # 機構が正しければ後者は前者を**超えない**——伸長は到達で clamp されており、既に
    # 外にいるグリフは下限 1.0 で 1 ユニットも動かないので、外に出ている集合は等倍の
    # ときから増えない。等倍側がわずかに多く出ることはある（等倍側は丸め前の浮動小数
    # で判定し、出力側は丸めた整数座標で測るため、壁の上にちょうど載るグリフの扱いが
    # 分かれる）。増えていたらそれは機構の破れなので、run.sh のログに毎回出しておく。
    reach_out_flat, reach_out_new = 0, 0
    for name, (cp, t) in plan.items():
        # 境界は「これから書き出す輪郭そのもの」から測る。glyf の bbox は複合グリフだと
        # 部品の箱の合成で、分解後の実体とずれることがある（Mgen+ の ℵ ♺ がこれで
        # 縮小後も箱からはみ出していた）。
        bounds = ControlBoundsPen(None)
        recorded[name].replay(bounds)
        if bounds.bounds is None:
            continue
        x0, y0, x1, y1 = bounds.bounds
        old_ink = x1 - x0

        room = t * fit_ratio
        s = min(1.0, room / old_ink) if old_ink > 0 else 1.0

        # 縦だけ vstretch を掛ける（#293）。横倍率 s も、対象グリフの選び方も、
        # advance も一切変わらない——**変わるのは縦倍率だけ**。
        #
        # clamp は倍率側にかけるが、縛るのは ink の**高さ**ではなく行の上下への
        # **到達（y 座標そのもの）**である（#293 レビュー High-1）。高さで縛った版は
        # 「新しい食い込みを作らない」を満たさなかった: この変換は縦中心 cy を保存
        # するので、中心が参照グリフ（漢）の中心とずれたグリフは、高さが上限に
        # 届いていなくても伸長ぶんだけ行の外へ出る。実測で `‗`(U+2017) は clamp が
        # 一度も発火しないまま下端が 32 ユニット深くなり、`⚥`(U+26A5) は clamp が
        # 発火して高さが上限ちょうどに抑えられたまま上端が 26 ユニット上がった。
        #
        # 到達で縛る形はこう出る。伸長後の上端・下端は cy ± half * v なので
        #   cy + half*v <= ref_y1  かつ  cy - half*v >= ref_y0
        # の両方を満たす v の上限を取る（**厳しいほうが効く**）。丸めは otRound で
        # 単調なので、丸め前でこの不等式が成り立てば丸め後も成り立つ。
        #
        # 下限 1.0 は維持する。等倍（vstretch = 1.0）の時点で既に漢の y 範囲より外に
        # いるグリフは上の上限が 1.0 を割るので v_allowed が 1.0 に落ち、**1 ユニットも
        # 動かない**（= #291 の出力のまま）。下限を 1.0 より下へ落とさないのは、そこを
        # 割ると vstretch = 1.0 が #291 の出力と恒等でなくなり、比較の基準線が消えるため。
        old_h = y1 - y0
        cy = (y0 + y1) / 2.0
        half = old_h * s / 2.0
        v_allowed = vstretch
        if half > 0:
            v_allowed = min(vstretch, (ref_y1 - cy) / half, (cy - ref_y0) / half)
            if v_allowed < MIN_VSTRETCH:
                v_allowed = MIN_VSTRETCH
            if v_allowed < vstretch - 1e-9:
                clamped += 1
                if v_allowed <= MIN_VSTRETCH + 1e-9:
                    floored += 1
        if v_allowed > MIN_VSTRETCH + 1e-9:
            grew += 1
        if cy + half > ref_y1 or cy - half < ref_y0:
            reach_out_flat += 1
        sy = s * v_allowed

        new_xmin = (t - old_ink * s) / 2.0
        tr = Transform().translate(new_xmin - x0 * s, cy - cy * sy).scale(s, sy)

        pen = TTGlyphPen(None)
        recorded[name].replay(TransformPen(pen, tr))
        new_glyph = _install(glyf, name, pen)
        hmtx[name] = (t, new_glyph.xMin)
        if new_glyph.numberOfContours != 0 and (
                new_glyph.yMax > ref_y1 or new_glyph.yMin < ref_y0):
            reach_out_new += 1

        if s >= 0.9999:
            translated_only += 1
        changed.append((cp, name, old_ink, new_glyph.xMax - new_glyph.xMin, s))

    # 巻き添え候補は「変換前の姿」を分解済みの輪郭として固定する（見た目は不変）
    for name in sorted(collateral):
        adv, lsb = hmtx[name]
        pen = TTGlyphPen(None)
        recorded[name].replay(pen)
        _install(glyf, name, pen)
        hmtx[name] = (adv, lsb)

    # 変更対象でないのに展開されてしまったグリフを、元のバイト列へ戻す。
    # これで「触っていないグリフはバイト単位で不変」が保証される。
    keep = set(plan) | set(collateral)
    restored = 0
    for name, data in original_bytes.items():
        if name in keep:
            continue
        if not hasattr(glyf.glyphs[name], "data"):
            glyf.glyphs[name] = Glyph(data)
            restored += 1

    rename(font, new_family, new_style)
    font.save(out_path)

    if report:
        print(f"{in_path.split('/')[-1]} -> {out_path.split('/')[-1]}  A={A}"
              f"  fitRatio={fit_ratio}  room={A * fit_ratio:.1f}  vstretch={vstretch}")
        print(f"  縦の壁（U+{VSTRETCH_REFERENCE_CP:04X} {chr(VSTRETCH_REFERENCE_CP)} の y 到達範囲）"
              f": {ref_y0}..{ref_y1}  (ink 高さ {max_ink_h})")
        print(f"  縦 clamp が効いた: {clamped} / {len(plan)}"
              f"（うち伸長 0＝等倍のまま {floored} / 途中まで伸びた {clamped - floored}）"
              f"／実際に伸びた {grew}")
        print(f"  漢の y 範囲より外へ出ている対象: 等倍でも {reach_out_flat} / 出力で {reach_out_new}"
              f"（出力 <= 等倍 なら伸長は新しい到達を作っていない）")
        print(f"  直したグリフ   : {len(changed)}（移動のみ {translated_only} / 縮小 {len(changed) - translated_only}）")
        print(f"  巻き添え遮断   : {len(collateral)}（対象を参照する複合グリフを分解して固定）")
        print(f"  元から適合     : {already_ok}")
        print(f"  共有のため除外 : {len(skipped_shared)}")
        print(f"  元バイトへ復帰 : {restored}（巻き添えで展開されたが変更しないもの）")
        worst = sorted(changed, key=lambda r: r[4])[:5]
        if worst:
            print("  倍率が最も小さかったもの:")
            for c, _n, oi, ni, s in worst:
                print(f"    U+{c:04X} {chr(c)}  ink {oi} -> {ni}  倍率 {s:.3f}")
    return len(changed)


def _install(glyf, name, pen):
    """ペンで描いたグリフを差し込み、境界を再計算しヒンティングを空にする。"""
    new_glyph = pen.glyph()
    glyf[name] = new_glyph
    new_glyph.recalcBounds(glyf)
    empty = ttProgram.Program()
    empty.fromBytecode(b"")
    new_glyph.program = empty
    return new_glyph


# RIBBI = Regular / Italic / Bold / Bold Italic — the four styles OpenType can
# express in the style BITS (OS/2.fsSelection, head.macStyle) rather than in a
# name. `style` is a free string as far as the rest of this file is concerned;
# only these four have a bit pattern, and anything else must not be guessed at.
_RIBBI_BITS = {
    "Regular": (False, False),
    "Italic": (False, True),
    "Bold": (True, False),
    "Bold Italic": (True, True),
}


def set_style_bits(font, new_style):
    """style から RIBBI ビットを導出して立てる（`fsSelection` / `macStyle`）。

    name テーブルだけ書き換えて**ビットを放置すると、フォントは自分を Regular だと
    名乗ったまま Bold を名乗る**という自己矛盾した状態で出荷される（#275 のコード
    レビュー Medium-3 で実測された `MPLUS1CodeTerm-Bold.ttf` がまさにそれ:
    nameID 2 = Bold・usWeightClass = 700 なのに fsSelection は bit6 REGULAR）。

    なぜ M PLUS だけで起きたか——上流が**可変フォント**だからで、書体の問題ではない:
    `instance.py` は `instantiateVariableFont(..., updateFontNames=False)` を使い、
    fontTools はそこで `usWeightClass` しか更新しない。既定インスタンス（=Regular）の
    ビットがそのまま Bold 面へ引き継がれる。上流が最初から静的な Mgen+ / Rounded は
    正しいビットを持って入ってくるので、ここは no-op になり出力バイトは変わらない。
    **静的化を経由する経路だけが踏む穴**なので、次に可変フォントを足したときも同じ
    ように踏む。だから呼び出し側ではなくこのパイプラインで塞ぐ。

    描画への影響は本リポジトリの経路では無い（`@font-face` が `font-weight` を明示
    宣言し、CSS の font matching はファイル内部のフラグを見ない）。効くのは、この
    パッケージ群が本来の用途である「汎用フォントリソース」として OS レベルの
    スタイルリンクに使われたとき——同じ family に Regular が 2 面あるように見える。

    bit5 BOLD と bit6 REGULAR は**相互排他**なので、立てるだけでなく落とす。
    それ以外のビット（bit7 USE_TYPO_METRICS・bit8 WWS など）は書体の宣言なので
    保つ——`fsSelection = 0x20` のような代入で潰さないこと。
    """
    if new_style not in _RIBBI_BITS:
        # 列挙にない style は推測しない。ここで落ちるのは manifest に RIBBI 外の
        # style（"SemiBold" など）を足したときで、そのときに必要なのはこの表の
        # 拡張ではなく「ビットで表せないから name だけで運ぶ」という判断である。
        raise SystemExit(
            f"[fit] RIBBI 外の style はビットを導出できない: {new_style!r}\n"
            f"  表せるのは {sorted(_RIBBI_BITS)} のみ（OpenType の style ビットの制約）。"
        )
    bold, italic = _RIBBI_BITS[new_style]

    os2 = font["OS/2"]
    fs = os2.fsSelection
    fs = (fs | (1 << 5)) if bold else (fs & ~(1 << 5))          # bit5 BOLD
    fs = (fs | (1 << 0)) if italic else (fs & ~(1 << 0))        # bit0 ITALIC
    # bit6 REGULAR は「Bold でも Italic でもない」ときだけ立つ（相互排他）。
    fs = (fs & ~(1 << 6)) if (bold or italic) else (fs | (1 << 6))
    os2.fsSelection = fs

    head = font["head"]
    ms = head.macStyle
    ms = (ms | (1 << 0)) if bold else (ms & ~(1 << 0))          # bit0 bold
    ms = (ms | (1 << 1)) if italic else (ms & ~(1 << 1))        # bit1 italic
    head.macStyle = ms


def rename(font, new_family, new_style):
    name = font["name"]
    full = f"{new_family} {new_style}"
    ps = f"{new_family.replace(' ', '').replace('+', 'Plus')}-{new_style.replace(' ', '')}"
    for rec in list(name.names):
        nid = rec.nameID
        if nid == 1:
            rec.string = new_family
        elif nid == 2:
            rec.string = new_style
        elif nid == 3:
            rec.string = f"{full}; derived"
        elif nid == 4:
            rec.string = full
        elif nid == 6:
            rec.string = ps
        elif nid == 16:
            rec.string = new_family
        elif nid == 17:
            rec.string = new_style
    # 名前とビットは同じ 1 つの事実の 2 つの表現なので、常に一緒に動かす。
    set_style_bits(font, new_style)


if __name__ == "__main__":
    if sys.argv[1:2] == ["--version"]:
        # 来歴（設計 #271 R7）に記録する fonttools のバージョン。venv に pip が
        # 入っているとは限らないので、実際に import されたライブラリから読む。
        import fontTools

        print(fontTools.version)
        sys.exit(0)
    if len(sys.argv) != 8:
        raise SystemExit(
            "usage: fit.py <widths.json> <in.ttf> <out.ttf> <family> <style> "
            "<fitRatio> <vstretch>"
        )
    widths_path, src, dst, family, style, raw_ratio, raw_vstretch = sys.argv[1:8]
    # 範囲検査を **font を開く前**に済ませる（1 バイトも書かないうちに落とす）。
    ratio = parse_fit_ratio(raw_ratio)
    stretch = parse_vstretch(raw_vstretch)
    fit(src, dst, family, style, load_widths(widths_path), ratio, stretch)
