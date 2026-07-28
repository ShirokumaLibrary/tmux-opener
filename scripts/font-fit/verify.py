"""変換結果を検証する（変換時ゲート・設計 #271 R9/R13 の契約①②）。

（#262 の動作確認済み試作からの移植。事故 4 件はいずれもこの検証器が捕まえた。）

契約①（fitRatio 版・#291）幅 1 の符号位置は、**宣言した fitRatio に対して**
  a) ink 幅 <= A * fitRatio
  b) セルからはみ出すなら、そのはみ出しが左右対称（xMin + xMax が A に一致）
  c) advance が A と一致（**不変**——升目は動かない）
  d) 面全体として「宣言値ちょうどまで縮めた」: 変換後の最大 ink が
     min(変換前の最大 ink, A*fitRatio) と一致する
契約② 本文グリフ（ASCII・かな・CJK）の輪郭が 1 つも変わっていない
契約③（vstretch 版・#293）変換対象のグリフは、**宣言した vstretch に対して**
  変換後の上下端 == 縦中心 ± (等倍の半分の高さ) * max(1.0, min(vstretch, 壁までの余裕))
  a) 天井 = この等式の外側（伸ばしすぎ）、b) 締め = 内側（伸ばし不足）。
  丸め誤差 ROUNDING_TOLERANCE を許す。
  **測るのは高さではなく行の上下への到達（y 座標）**（#293 レビュー High-1）。
  高さの等式だった版は機構と契約がずれていた: 高さが上限内でも、縦中心が参照
  グリフとずれたグリフは伸長ぶんだけ行の外へ出るのを、検査が構造的に見逃す。
  「等倍の姿」は変換前の輪郭から再計算する（縦中心 ± 変換前 ink 高さ * 横倍率 s / 2）。
  壁は参照グリフ U+6F22（漢）の ink の上端・下端で、フォントから測る。
  max（clamp の下限 1.0）が要る——**等倍の時点で既に壁の外にいるグリフは
  1 ユニットも伸びない**ので、そのグリフは変換後も壁の外のままで正しい。
  無条件の「壁の内側」はそのグリフを偽陽性で挙げる。
  **両側で見るのが要点**: 天井だけなら 1.0 で焼いた face が 1.3 の主張に対して
  通り、締めだけなら 1.3 で焼いた face が 1.0 の主張に対して通る。等式にすると
  どちらの向きにも赤経路が残る（契約①(d) と同じ形）。
  対象は fit.py が変換したグリフだけ（selected_glyphs が変換前の面から再現する）。
  触っていないグリフは到達が変わらないことだけを見る。
  c) **式を介さない性質検査**（#293 レビュー Low-A）。(a)(b) は fit.py と同じ式を
  ここで再計算して等式で比べるので、**式そのものが概念的に誤っていれば赤にならない**
  ——1 巡目の High-1 がまさにそれで、fit.py と verify.py が同じ「高さで縛る」理解を
  共有していたため、契約③ はグリーンのまま偽の記述が出荷された。文書 14 ファイルが
  主張しているのは式ではなく**性質**なので、それを直接書く:
      変換後の到達 <= max(壁, 等倍の到達)  かつ  >= min(壁, 等倍の到達)
  つまり「壁の外へ**新しく**出たら赤」。max / min は下限 1.0 の対応物で、等倍の
  時点で既に外にいるグリフ（その姿のままが正しい）を偽陽性にしないため。この 2 行は
  v_allowed の式を一切参照しないので、式を書き換えると (a)(b) ではなくこちらが落ちる。
  fit.py 側にも同型の到達カウンタ（reach_out_flat / reach_out_new）があるが、あちらは
  run.sh のログへ**印字するだけでゲートではない**——ゲートはこちら側に置く。
  **vstretch の意味・上限・既定の正本は scripts/font-fit/manifest.json の note**。
  ここに書いてあるのは検査の形だけで、値の意味は二重管理しない。

**(d) が「緩めるのではなく宣言値に対して締める」の実体**。(a)(b)(c) だけだと
fitRatio を大きく宣言するほど検査が緩くなり、0.96 で焼いた face が 1.15 の主張に
対しても通ってしまう（#270 で「ink 判定に赤経路が無い」欠陥を実際に出している）。
(d) があると 1.15 の face は 0.96 の主張に対して (a) で落ち、0.96 の face は 1.15 の
主張に対して (d) で落ちる——両向きに赤経路が残る。

fitRatio > 1 では xMin < 0 が **合法**になる。旧契約の `xMin < 0 or xMax > A` は
境界を広げれば済むものではなく、(a)(b) の形に書き換わっている。

違反が 1 件でもあれば非 0 で終了する（run.sh は set -e で中断する）。「テストは緑・
フォントは壊れている」型の事故しか起きなかったので、ここで止めるのが唯一のゲート。

契約② の比較は bbox ではなく輪郭の点列で行う。fontTools は保存時に全グリフの bbox を
再計算する（recalcBBoxes 既定 True）ので、bbox 比較だと曲線を含む無変更グリフが
1 ユニット差で偽陽性になる。実際 C S a c d e ぃ ざ つ ど が偽陽性で挙がった。

契約① の方は glyf に格納された bbox（g.xMin / g.xMax）を読む。変換したグリフと
巻き添えグリフは _install() が recalcBounds() を呼ぶので実測と一致するが、元バイトへ
復帰したグリフは上流の格納値のままである——契約① は「輪郭で見ている」わけではない
（設計 #271 の『検証の限界』節と同じ限界）。

契約③ は格納 bbox ではなく **分解した輪郭の制御点箱**で測る（fit.py が縦倍率を
決めるときに使う物差しと同じもの）。格納 bbox は制御点箱より小さいことがあるので、
2 つの物差しを混ぜると (b) の締めが偽陽性で落ちる。

比較対象（before）は **fit.py が実際に読んだファイル**を渡すこと。可変フォントは
静的化後の中間ファイルが before になる（元の可変フォントと比べても意味がない）。

使い方: verify.py <変換前 TTF> <変換後 TTF> <widths.json> <fitRatio> <vstretch>
"""

import sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.boundsPen import ControlBoundsPen
from fit import (MIN_VSTRETCH, VSTRETCH_REFERENCE_CP, in_custom_range,
                 in_private_use, load_widths, parse_fit_ratio, parse_vstretch)

# 座標の整数丸めで許す誤差（フォントユニット）。fit.py は浮動小数で新しい原点と
# 倍率を出し、TTGlyphPen が整数へ丸める。左右の縁がそれぞれ 0.5 まで動くので、
# 幅と対称性はどちらも最大 1 ユニットずれうる。2 は 1 段の余裕。
ROUNDING_TOLERANCE = 2

# 契約③c（性質検査）が許す誤差。**(a)(b) の 2 とは別に持つ**（#293 レビュー Low-A）。
# こちらが許すのは座標の整数化 1 段だけ: fit.py は浮動小数で到達を決め TTGlyphPen が
# otRound する（最大 0.5）。壁ちょうどまで伸ばした場合は壁が整数なので丸めても超えない
# が、等倍の到達（**浮動小数**）に対しては丸めで最大 0.5 外へ出る。出荷 6 面の実測が
# まさにそれで、最大超過は 0.5 ユニット——許容 0 では丸めだけで赤になる。1 は丸めの
# ぶんの余裕であって、壁を 1 ユニット越えてよいという宣言ではない（超過は run.sh の
# ログに毎回「最大超過」として出るので、増えたら読める）。(a)(b) の 2 をここへ流用
# すると、検査が許す量が文書の主張より 1 段緩くなる。
REACH_TOLERANCE = 1

# 本文として絶対に触ってはいけない範囲
BODY_RANGES = [
    (0x0020, 0x007E),   # ASCII
    (0x3040, 0x309F),   # ひらがな
    (0x30A0, 0x30FF),   # カタカナ
    (0x4E00, 0x9FFF),   # CJK 統合漢字
    (0xFF01, 0xFF60),   # 全角英数・記号
]


def in_body(cp):
    return any(lo <= cp <= hi for lo, hi in BODY_RANGES)


def outline(glyph_set, name):
    rec = DecomposingRecordingPen(glyph_set)
    glyph_set[name].draw(rec)
    return rec.value


def is_subject(cp, width_of):
    """契約① の対象。除外は fit.py の 3 述語 + customGlyphs 範囲と同一。"""
    return (width_of(cp) == 1 and cp > 0xFF
            and not in_private_use(cp) and not in_custom_range(cp))


def max_subject_ink(font, cmap, width_of):
    """幅 1 の対象グリフのうち、格納 bbox で測った最大 ink 幅（無ければ None）。

    面全体で 1 つの数に畳むので、格納 bbox が実体とずれる個別グリフ（上流の ℵ ♺）
    の影響を受けにくい。契約①(d) の左辺・右辺をこの同じ物差しで測る。
    """
    glyf = font["glyf"]
    widest = None
    for cp, name in cmap.items():
        if not is_subject(cp, width_of):
            continue
        g = glyf[name]
        if g.numberOfContours == 0:
            continue
        ink = g.xMax - g.xMin
        if widest is None or ink > widest:
            widest = ink
    return widest


def control_box(glyph_set, glyf, name):
    """分解した輪郭の制御点箱（無ければ None）。fit.py の物差しと同じ。"""
    if glyf[name].numberOfContours == 0:
        return None
    rec = DecomposingRecordingPen(glyph_set)
    glyph_set[name].draw(rec)
    bounds = ControlBoundsPen(None)
    rec.replay(bounds)
    return bounds.bounds


def selected_glyphs(before, bc, bs, width_of, fit_ratio):
    """fit.py が **変換したはず**のグリフ名の集合を、変換前の面から再現する。

    契約③(b) は「宣言値ちょうどまで伸ばした」という**下限**の主張なので、対象集合が
    fit.py より広いと「触っていないグリフが伸びていない」を違反として挙げてしまう。
    契約① で verify を fit より厳しい側へ倒しているのとは事情が逆で、ここだけは
    fit.py の選択規則（demands / already_ok）を**同じ形で**持つ必要がある。

    再現するのは fit.py の plan 構築そのもの: 幅が食い違う符号位置から共有される
    グリフを外し、既に適合しているグリフ（セル内・room 内・advance 正）を外す。
    巻き添え（対象を参照する複合グリフ）は plan に入らないので自動的に外れる。
    """
    glyf, hmtx = before["glyf"], before["hmtx"]
    A = hmtx[bc[0x41]][0]

    demands = {}
    for cp, name in bc.items():
        if in_custom_range(cp):
            continue
        demands.setdefault(name, set()).add(A if is_subject(cp, width_of) else None)

    selected = set()
    for cp, name in sorted(bc.items()):
        if name in selected or name not in demands:
            continue
        wanted = demands[name]
        if None in wanted or len(wanted) > 1:
            continue
        if glyf[name].numberOfContours == 0:
            continue
        box = control_box(bs, glyf, name)
        if box is None:
            continue
        x0, _y0, x1, _y1 = box
        if x0 >= 0 and x1 <= A and (x1 - x0) <= A * fit_ratio and hmtx[name][0] == A:
            continue                      # 既に適合＝fit.py は触らない
        selected.add(name)
    return selected


def vertical_violations(before, after, bc, ac, bs, as_, width_of, room, fit_ratio,
                        vstretch, ref_y0, ref_y1):
    """契約③ の違反を返す（(a) 天井 / (b) 締め / (c) 性質）。**測るのは高さではなく到達**。

    等倍（vstretch = 1.0）の姿を変換前の輪郭から再計算する: s = min(1, room /
    変換前 ink 幅)、等倍の上下端 = 縦中心 ± (変換前 ink 高さ * s) / 2。fit.py と
    同じ式をここでも持つのは二重管理ではなく、**変換器の出力を変換器と独立に
    測るため**（契約①(d) が room を再計算しているのと同じ立場）。

    高さで測っていた版は機構と契約がずれていた（#293 レビュー High-1）: 高さが
    上限内でも、縦中心が参照グリフとずれたグリフは伸長ぶんだけ行の外へ出る。
    到達で測ればその破れがそのまま (a) の違反として出る。

    (c) は (a)(b) と**独立**に、式を介さず主張そのものを見る（レビュー Low-A）。
    (a)(b) が fit.py の式のミラーである以上、式が誤っていれば両方そろって緑になる。
    (c) は「壁の外へ新しく出ていないか」だけを見るので、式が誤ればここが落ちる。
    """
    selected = selected_glyphs(before, bc, bs, width_of, fit_ratio)
    ceiling_bad, tight_bad, reach_bad = [], [], []
    worst_excess = 0.0
    # 数えるのは**グリフ**であって符号位置ではない（#293 レビュー Low-1）。同じ
    # グリフを指す符号位置が複数あると多重計上され、同じログに並ぶ fit.py の
    # 「直したグリフ N」と定義の違う数字が出る。違反の列挙は符号位置のままで
    # よい（どの文字で見えるかが要る）が、突き合わせる数の単位はそろえる。
    counted = set()
    for cp, name in sorted(ac.items()):
        if not is_subject(cp, width_of) or cp not in bc:
            continue
        after_box = control_box(as_, after["glyf"], name)
        before_box = control_box(bs, before["glyf"], bc[cp])
        if after_box is None or before_box is None:
            continue
        bx0, by0, bx1, by1 = before_box
        _ax0, ay0, _ax1, ay1 = after_box
        old_w, old_h = bx1 - bx0, by1 - by0

        if bc[cp] not in selected:
            # 変換対象でないグリフは行の上下へ 1 ユニットも伸びない（縦の主張はこれだけ）。
            if ay1 > by1 + ROUNDING_TOLERANCE or ay0 < by0 - ROUNDING_TOLERANCE:
                ceiling_bad.append((cp, ay0, ay1, by0, by1))
            continue

        counted.add(bc[cp])
        s = min(1.0, room / old_w) if old_w > 0 else 1.0
        cy = (by0 + by1) / 2.0
        half = old_h * s / 2.0                   # 等倍（vstretch = 1.0）の半分の高さ
        # 宣言 vstretch から**変換後の上下端そのもの**を再計算する（clamp 込み）:
        #   到達が参照グリフの y 範囲を越えない範囲まで伸ばし（厳しいほうが効く）、
        #   下限 1.0＝等倍より縮めない（既に外にいるグリフは 1 ユニットも動かない）。
        allowed = vstretch
        if half > 0:
            allowed = min(vstretch, (ref_y1 - cy) / half, (cy - ref_y0) / half)
            allowed = max(MIN_VSTRETCH, allowed)
        want_y1, want_y0 = cy + half * allowed, cy - half * allowed
        if (ay1 > want_y1 + ROUNDING_TOLERANCE
                or ay0 < want_y0 - ROUNDING_TOLERANCE):
            ceiling_bad.append((cp, ay0, ay1, want_y0, want_y1))
        if (ay1 < want_y1 - ROUNDING_TOLERANCE
                or ay0 > want_y0 + ROUNDING_TOLERANCE):
            tight_bad.append((cp, ay0, ay1, want_y0, want_y1))

        # (c) 性質検査。**上の allowed を一切参照しない**——参照するのは等倍の到達
        # （flat_y0/flat_y1）と壁（ref_y0/ref_y1）だけで、どちらも変換器の式ではなく
        # 変換前の面とフォントから直接出る量である。「等倍で既に外なら、その姿の
        # ままでよい」を max / min で表し、それより外は無条件に赤。
        flat_y1, flat_y0 = cy + half, cy - half
        limit_hi, limit_lo = max(ref_y1, flat_y1), min(ref_y0, flat_y0)
        excess = max(ay1 - limit_hi, limit_lo - ay0)
        if excess > worst_excess:
            worst_excess = excess
        if excess > REACH_TOLERANCE:
            reach_bad.append((cp, ay0, ay1, limit_lo, limit_hi))
    return ceiling_bad, tight_bad, reach_bad, worst_excess, len(counted)


def main(before_path, after_path, widths_path, fit_ratio, vstretch):
    width_of = load_widths(widths_path)
    before, after = TTFont(before_path), TTFont(after_path)
    ag = after["glyf"]
    bh, ah = before["hmtx"], after["hmtx"]
    bc, ac = before.getBestCmap(), after.getBestCmap()
    bs, as_ = before.getGlyphSet(), after.getGlyphSet()

    A_a = ah[ac[0x41]][0]
    room = A_a * fit_ratio

    still_bad, body_changed, body_checked = [], [], 0
    for cp, name in sorted(ac.items()):
        # 1. 幅 1 の符号位置が宣言した帯に収まっているか（これが変換の契約①abc）。
        #    除外は fit.py の 3 述語 + customGlyphs 範囲と同一。fit.py 側の
        #    追加除外（幅が食い違う符号位置から共有されるグリフ / 除外対象からも
        #    参照されるグリフ）の対応物は **意図的に置かない**——verify は fit より
        #    厳しい側に倒す。将来この非対称に当たるフォントで run.sh が止まったら、
        #    ゲートを緩めるのではなく、そのフォントを採用するかを人が決める。
        if is_subject(cp, width_of):
            g = ag[name]
            if g.numberOfContours != 0:
                overflows = g.xMin < 0 or g.xMax > A_a
                if (g.xMax - g.xMin > room + ROUNDING_TOLERANCE                      # (a)
                        or (overflows
                            and abs(g.xMin + g.xMax - A_a) > ROUNDING_TOLERANCE)     # (b)
                        or ah[name][0] != A_a):                                      # (c)
                    still_bad.append((cp, ah[name][0], g.xMin, g.xMax, A_a))

        # 2. 本文が無傷か（契約②。幅に関係なく全数見る。かな・漢字は幅 2 なので
        #    上の幅フィルタの中に置くと 1 文字も検査されない）
        if in_body(cp) and cp in bc:
            body_checked += 1
            bn = bc[cp]
            if bh[bn][0] != ah[name][0] or outline(bs, bn) != outline(as_, name):
                body_changed.append(cp)

    # (d) 面全体の締め。変換前に room を超える対象があったなら、変換後の最大 ink は
    #     ちょうど room でなければならない（宣言より小さく縮めていない）。無かった
    #     なら最大 ink は変換前のまま（何も縮めていない）。
    before_max = max_subject_ink(before, bc, width_of)
    after_max = max_subject_ink(after, ac, width_of)
    tightness = None
    if before_max is None or after_max is None:
        tightness = "幅 1 の対象グリフが 1 つも無い（検査が空回りしている）"
    else:
        expected = min(before_max, room)
        if abs(after_max - expected) > ROUNDING_TOLERANCE:
            tightness = (f"最大 ink {after_max} は宣言 fitRatio={fit_ratio} の "
                         f"期待値 {expected:.1f}（= min(変換前最大 {before_max}, room {room:.1f})）"
                         f"と一致しない")

    # 契約③（#293）。壁は変換後の面から実測する——参照グリフ（漢）は本文なので
    # 契約② が「輪郭が変わっていない」を全数で押さえており、変換前と同じ値になる。
    ref_name = ac.get(VSTRETCH_REFERENCE_CP)
    ref_box = control_box(as_, after["glyf"], ref_name) if ref_name else None
    if ref_box is None:
        vertical = (f"縦の壁の参照グリフ U+{VSTRETCH_REFERENCE_CP:04X} を測れない"
                    f"（fit.py が拒否すべき入力が通っている）")
        ceiling_bad, tight_bad, reach_bad, worst_excess, vsubjects = [], [], [], 0.0, 0
        ref_y0 = ref_y1 = None
    else:
        vertical = None
        ref_y0, ref_y1 = ref_box[1], ref_box[3]
        (ceiling_bad, tight_bad, reach_bad, worst_excess,
         vsubjects) = vertical_violations(
            before, after, bc, ac, bs, as_, width_of, room, fit_ratio, vstretch,
            ref_y0, ref_y1)
        if vsubjects == 0:
            vertical = "変換対象の符号位置が 1 つも無い（契約③ が空回りしている）"

    print(f"{after_path.split('/')[-1]}  A={A_a} fitRatio={fit_ratio} room={room:.1f}"
          f" vstretch={vstretch}")
    print(f"  契約①abc 帯から外れる符号位置 : {len(still_bad)}")
    for cp, adv, xmin, xmax, box in still_bad[:12]:
        print(f"    U+{cp:04X} {chr(cp)}  adv={adv} ink=[{xmin},{xmax}] 幅={xmax - xmin} セル={box}")
    print(f"  契約①d  最大 ink              : 変換前 {before_max} -> 変換後 {after_max}"
          f"{'' if tightness is None else '  ← ' + tightness}")
    print(f"  契約② 本文グリフ検査         : {body_checked} 個中 輪郭が変わったもの {len(body_changed)} 個")
    for cp in body_changed[:12]:
        print(f"    ! U+{cp:04X} {chr(cp)}")
    print(f"  契約③a 伸ばしすぎ（壁 U+{VSTRETCH_REFERENCE_CP:04X} の y 到達 = {ref_y0}..{ref_y1}）"
          f": {len(ceiling_bad)}")
    for cp, ay0, ay1, wy0, wy1 in ceiling_bad[:12]:
        print(f"    U+{cp:04X} {chr(cp)}  y {ay0}..{ay1} が期待 {wy0:.1f}..{wy1:.1f} の外へ出た")
    print(f"  契約③b 伸ばし不足             : {len(tight_bad)}"
          f"（変換対象 {vsubjects} 個）"
          f"{'' if vertical is None else '  ← ' + vertical}")
    for cp, ay0, ay1, wy0, wy1 in tight_bad[:12]:
        print(f"    U+{cp:04X} {chr(cp)}  y {ay0}..{ay1} が期待 {wy0:.1f}..{wy1:.1f} に届かない")
    print(f"  契約③c 新しく壁の外へ出た対象  : {len(reach_bad)}"
          f"（最大超過 {worst_excess:.1f} ユニット / 許容 {REACH_TOLERANCE}）")
    for cp, ay0, ay1, ly0, ly1 in reach_bad[:12]:
        print(f"    U+{cp:04X} {chr(cp)}  y {ay0}..{ay1} が "
              f"max(壁, 等倍) {ly0:.1f}..{ly1:.1f} の外へ新しく出た")
    return (len(still_bad), len(body_changed), tightness,
            len(ceiling_bad) + len(tight_bad) + len(reach_bad), vertical)


if __name__ == "__main__":
    if len(sys.argv) != 6:
        raise SystemExit(
            "usage: verify.py <before.ttf> <after.ttf> <widths.json> <fitRatio> <vstretch>")
    bad, changed, loose, vbad, vloose = main(
        sys.argv[1], sys.argv[2], sys.argv[3],
        parse_fit_ratio(sys.argv[4]), parse_vstretch(sys.argv[5]))
    if bad or changed or loose or vbad or vloose:
        total = bad + changed + (1 if loose else 0) + vbad + (1 if vloose else 0)
        print(f"  NG: 契約違反 {total} 件——変換を採用しない", file=sys.stderr)
        sys.exit(1)
    print("  OK: 契約①②③ をすべて満たす")
