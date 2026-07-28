"""予約フォント名（Reserved Font Name・OFL 1.1 §3）を全数抽出する。

（#285 の試作 `rfncheck.py`〔name テーブル抽出・HackGen で動作実測済み〕と、
  `font-packages/README.md` の手組み grep 手順を 1 本へ統合したもの。課題 #286 /
  計画 #287 T1。新規発明ではない——下の落とし穴 3 つはいずれも実測で踏んだ跡である。）

OFL 1.1 §3 は改変版が予約名を名乗ることを禁じる。だから変換パッケージは
**自分の名前を決める前に**「何が予約されているか」を確定しなければならない。
その確定を、人が grep を組み立て直す作業から、この道具 1 実行へ移す。

## 設計目標は「偽陰性ゼロ」であって「もっともらしい出力」ではない

出力の最終形は `--derived-name` の**包含判定**である。ここで
**過剰に拾うことと落とすことは対称ではない**:

  過剰に拾う → 派生名が誤って NG になる → 人が候補を見て捨てる（コスト: 手間）
  落とす     → 予約名を含む名前で公開する（コスト: ライセンス違反）

したがって疑わしきは拾う。そして**拾えなかった行は「宣言なし」と言わない**——
語句はあるのに候補を取り出せなかった行は `⚠ 未解決` として出し、そのとき
`--derived-name` の判定は **OK と言わずに保留**する（exit 5）。初版はここで
「引用符が 1 つでもあれば引用符なしの本物の名前を捨てる」偽陰性を 6 パターン
作っていた（コードレビュー #288 H1・実測）。**道具が防ぐはずだった事故を道具
自身が起こす形**だったので、抽出は下記のとおり全面的に組み直した。

## 塞ぐ落とし穴 3 つ（それぞれ実測で踏んだ）

1. **case-sensitive では大文字見出し行を落とす**（#275 実測）。OFL 本文は語句を
   title-case で書くが、節見出しは叫ぶことがある——`font-plemoljp-console/LICENSE.txt:48`
   の `RESERVED FONT NAME:` が実在し、case-sensitive 検索はこの 1 行を落とす
   （そのファイルに対し 6 行 → 5 行）。本ツールは常に case-insensitive で照合する。
   陽性コントロール: `--control-case-sensitive` を付けると劣化し、行数が減る。

2. **拡張子で絞ると拡張子なしのライセンス文書を落とす**（#277 実測）。上流同梱の
   ライセンス文書は拡張子を持たないことが珍しくない（`font-plemoljp-console` の
   `licenses/LICENSE_IBM-Plex` / `licenses/LICENSE_Hack`、#277 の `LICENSE_E` /
   `LICENSE_J`）。本ツールは**拡張子を一切見ない**——パスを列挙し、各ファイルの
   **先頭バイト**でフォント（sfnt magic）/ テキスト / バイナリを判定する。
   名前ベースの除外はリネームで無音破綻するので採らない。
   陽性コントロール: `--control-ext-filter txt` を付けると #277 の誤りを再現し、
   拡張子なしファイルの予約名が消える。

   **同じ穴はエンコーディング軸でも開く**（レビュー #288 H2・実測）。初版は
   「UTF-8 として decode できなければバイナリ」としていたので、Shift_JIS の
   `LICENSE_J` や Latin-1 の古いライセンス文書が**パスも出さずに**捨てられた。
   いまは **NUL バイトの有無**で判定し（UTF-16 は BOM で別扱い）、RFN の語句が
   純 ASCII であることを使って `errors="replace"` で読む。飛ばしたバイナリは
   **パスを列挙**する——数だけでは icon.png を捨てたのかライセンス文書を捨てたのか
   分からない。

3. **`LICENSE` に RFN 行が無く、フォント本体の `name` テーブルにしか無い場合がある**
   （#285 実測）。Source Han Code JP のリポジトリ `LICENSE.txt` には RFN 宣言行が
   **無く**、`'Source'` の予約は nameID 0 にしか書かれていない。テキストだけを見る
   手順は、この形を構造的に見落とす。本ツールは sfnt を開いて全 name レコード
   （TTC は全 face）を走査し、出所を `path#face:nameID` で示す。
   陽性コントロール: `--control-skip-name-table` を付けると劣化し、name テーブル
   にしか無い予約名が消える。

**この 3 つのスイッチは陽性コントロール専用**（「検査器が本当に検査しているか」を
赤で示すためだけにある）。本番の検査では絶対に付けないこと。全部クリーンという
出力は、検査器が動いていないときにも出る——#270 の GREEN CONTROL の教訓。
劣化中は stdout と **stderr の両方**にバナーを出し、判定行の頭に `[劣化実行]` を
付ける（記録を切り取っても劣化が残る・レビュー M2）。

## 出力と終了コード

- 一致した行を **1 行も省かずに** 出す。出所は `path:行番号`（テキスト）または
  `path#face:nameID`（フォント本体）。予約名を宣言していない行も落とさないが、
  **なぜ「宣言なし」と判定したのかを必ず添える**（散文 / 見出し・参照 / 未解決）。
- 末尾に予約名の重複排除リストと出所、`--derived-name` の判定。

      0  違反なし（予約名 1 件以上と照合した）
      1  検査が完了しなかった（パス不存在・fontTools 不在など）
      3  派生名が予約名を含む＝ OFL 1.1 §3 違反
      4  照合対象が 0 件（**空虚に真な OK**。`--allow-zero-reserved` で 0 にできる）
      5  未解決行がある（語句はあるのに候補を取り出せなかった → OK と言わない）

  4 と 5 を 0 から分けたのは、`font-mplus1code` が**本番で予約名 0 件を出す**ため
  「0 件なら怪しい」という経験則が立たないから（レビュー M1）。

## 抽出規則（`extract_names`・`--self-test` が回帰を守る）

**構造の原則: どの条件でも解析を打ち切らない。** この関数は 2 度組み直しており、
1 度目は「引用符が当たったら以降を読まない」（H1）、2 度目は「散文語が来たら行ごと
捨てる」（NH1）で、**どちらも「ある条件で打ち切る」形の失敗**だった。3 度目を作らない
ため、いまは**全部集めてから絞る**形にしてある——打ち切る分岐は 1 つも無い。

語句 `reserved font name(s)` の**各出現**について、その後ろ（**1 文**）から:

- 引用符付き候補を**すべて**拾う（`"` `'` `` ` `` `“”` `‘’` `「」`。`(...)` は語句の
  直後にあるときだけ）。拾った範囲は伏せ字にする。
- **伏せ字の外に残った全ての断片**も読む（引用が当たっても止めない——`Name "Alpha"
  and Bravo` の `Bravo` が落ちる・NH2）。断片ごとに、塊・` and ` / `,` / `/` / `、`
  で割った断片・散文語でない単語、をすべて候補にする。
- **散文語（`PROSE_STARTS`）は候補から落とすだけ**で、解析は止めない。落とすのは
  「全語が散文語の候補」と、句の**両端**にある散文語（`the Adobe line above reserves
  the name` → `Adobe`）。中央は触らないので `M PLUS 1 Code` のような名前は保つ。
- 大文字始まりかどうかでは判定しない（`with Reserved Font Name: cica` を落とすため）。
- 1 文の外に読まなかった文字が残っていて、1 文目から何も取れなかったなら
  **`unresolved`**（`Reserved Font Name.  Bravo` 型・NM4）。

**`.py` にはどの自動ゲートも到達しない**（Semgrep の bundled ルール 3 本はいずれも
`languages: [typescript, javascript]`・ESLint は JS のみ・#273 実測）。だから
**この道具は自分でコントロールを持つ**: `--self-test` が `(入力行 → 期待名)` の表を
走らせる（レビュー #288 Q7 の提案）。抽出を Node へ移して `npm test` に載せる案は
見送った——理由は「純粋部分は壊れない」ではない（最も危険な偽陰性 H1 はまさにこの
純粋関数の中にあった）。①#288 のスコープ外、②走査と name テーブル読みが fontTools
依存で Python 側に残る以上、移すのは分割であって移動ではない、③分割すれば規則の
2 つ目の写しが増える——の 3 つである。

## 判定の限界（先に言う）

- 抽出は語句の後ろを読む機械的な規則であって、法的判断ではない。**捨てるのは人**。
- 部分文字列判定は NFKC 正規化 + casefold（全角・大小文字を畳む）。空白を除いた形での
  一致は**判定を変えず別行の警告**として出す（`MPLUS1CodeTerm` 型の派生名がこのリポ
  自身の命名規約なので・レビュー M7）。翻字・図形的類似は見ない。
- **予約名 0 件に対する OK は空虚に真**である（照合対象が無いのだから何も含まない）。
  判定行に照合件数を添え、exit 4 で機械的にも分ける。
- **アーカイブの中は見ない**。`.vsix` / `.zip` はバイナリとして飛ばす（パスを列挙
  する）。梱包物の中身は「Packaging a font extension」の手作業の工程が別にある。

使い方:
  check-license.py <パス...> [--derived-name <候補>]...
  check-license.py --self-test
  （パスはディレクトリでもファイルでもよい。ディレクトリは再帰的に走査する）
"""

import argparse
import os
import re
import sys
import unicodedata

# sfnt / OpenType のシグネチャ。**拡張子ではなく先頭バイトで判定する**（落とし穴 2）。
FONT_MAGICS = (
    b"\x00\x01\x00\x00",  # TrueType
    b"true",              # TrueType (Apple)
    b"ttcf",              # TrueType Collection
    b"OTTO",              # CFF outlines
)

PHRASE = re.compile(r"reserved\s+font\s+names?", re.IGNORECASE)
PHRASE_CASE_SENSITIVE = re.compile(r"Reserved\s+Font\s+Names?")

# 引用符の対。バッククォートと丸括弧も**引用の一種として**受ける（レビュー H1:
# `` `Cica` `` と `(Cica)` が 0 件になっていた）。丸括弧は無関係な補足まで拾うが、
# それは過剰捕捉＝安全側。
QUOTED = re.compile(
    r"\"([^\"\n]{1,80})\""
    r"|'([^'\n]{1,80})'"
    r"|`([^`\n]{1,80})`"
    r"|“([^”\n]{1,80})”"
    r"|‘([^’\n]{1,80})’"
    r"|「([^」\n]{1,80})」"
)

# 丸括弧は**語句の直後（空白のみを挟む）にあるときだけ**引用として受ける。
# 行のどこにある括弧でも拾う版を試したところ、name テーブルの
# `[M+ OUTLINE FONTS] Copyright(c) 2015 …` から候補 `'c'` が出て、`c` を含む
# あらゆる派生名が違反になった（実測）。過剰捕捉は安全側だが、**全部を違反に
# する候補は判定を無意味にする**（「全部クリーン」の裏返しの警報疲れ）ので、
# 括弧だけは位置で限定する。H1 が要求した `Reserved Font Name (Cica)` は
# この限定で拾える。
LEADING_PAREN = re.compile(r"^\(([^)\n]{1,80})\)")

# 引用符なし候補。**始端の大小文字では判定しない**（`Name: cica` を落とすため）。
UNQUOTED_LEAD = re.compile(r"^[\s:：　\-–—=]*")
CLOSING_QUOTES = "\"'`”’」"

# 塊をさらに割る区切り（`Names Foo and Bar` → Foo / Bar / "Foo and Bar"）。
# 文末記号もここに入れる: `.` `;` `。` は「読むのをやめる印」ではなく**割る印**
# として扱う——`Name Inc. Quux` を「1 文目で打ち切り」にすると Quux が黙って消える
# が、割るだけなら `Inc` と `Quux` の両方が候補になる（レビュー #288 NNH1）。
# `。` は後ろに空白を要求しない（CJK では空白が来ない・NNM3）。
SPLITTERS = re.compile(
    r"\s+and\s+|\s+or\s+|\s*[,/、；;]\s*|\s+および\s+|\.\s+|\.$|。",
    re.IGNORECASE,
)

# CJK（かな・漢字）。引用符の無い CJK の断片は**語に割れない**ので、候補を返しつつ
# 行を `unresolved` に倒す（レビュー #288 NNM3）。`"白源"` のように引用されていれば
# 引用の側で解決するので、ここには来ない。
CJK = re.compile(r"[぀-ヿ㐀-䶿一-鿿豈-﫿]")

# **候補から落とす語**（`prose` かどうかを決める中断ゲートではない）。
#
# 初版はこの表を「語句の直後がこの語なら、その行は宣言なし」と読む**中断ゲート**に
# していた。表に載る語は `is are the of for note …` のような、宣言と名前の間に最も
# 普通に挟まる語なので、`Reserved Font Names are Foo and Bar` や
# `Reserved Font Name Note Sans` が**行ごと消えた**（レビュー #288 NH1・実測 6 形）。
# **表の漏れが偽陰性になる向き**だったのが芯である。
#
# いまはこの表を stop-word として使う: 語句の後ろは常に最後まで解析し、候補を全部
# 集めてから、**全語が表に載っている候補だけ**を落とす。こうすると漏れの向きが
# 反転する——表に無い散文語は「余計な候補が 1 つ増える」（安全側）、表に載る語が
# 名前なら落ちるのは**その 1 語**で、行全体ではない（`Note Sans` は塊として残る）。
#
# 語彙は**同梱コーパスで実測して**足した（`file end anywhere names after` 等は、
# 4 パッケージの RFN 一致行 30 行に実在する散文）。足し忘れは誤検知であって
# 見落としではないので、`--self-test` の否定ケースが固定するのはこの性質である。
PROSE_STARTS = frozenset("""
refers refer refering referring is are was were be been being note notes noted
this that these those it its they them their the a an and or of to in on at as
for from with without shall may must can could should would means meaning
declared declares declaring declare specified specifies specify applies apply
above below here there section clause paragraph part when where which who whose
no not none nothing any all each every both either neither if unless because so
such same other another next previous following mentioned given used using
name names font fonts file files end ends anywhere after before statement
statements copyright license licensed licensing reserved software version
also again holder holders line lines only same still just per via within
reserve reserves reserving reserved based project projects refer stated states
""".split())

# **この検査の記録そのもの**であるファイル（工程は出力全行をここへ書き写す）。
# 走査対象に入れると記録が自分自身を引用し、書き足すたびに出力が変わる不動点に
# なる。basename で外す——初版は「与えられた root の直下」だけを見ていたので、
# `font-packages` を丸ごと走査すると各パッケージの README が入り込み、ハブの
# README だけが外れるという逆の外し方になっていた（レビュー M4・実測 73 行）。
# 拡張子ではなくこの 2 つの名前だけを外すので、上流の `LICENSE.md` は落とさない。
RECORD_FILES = ("README.md", "README.ja.md")


# --- 分類（落とし穴 2 のエンコーディング軸・レビュー H2）--------------------

def read_head(path, n=4096):
    with open(path, "rb") as fp:
        return fp.read(n)


def classify(path):
    """'font' / 'text:<encoding>' / 'binary' を先頭バイトから決める。

    テキストかどうかは **NUL バイトの有無**で決める（UTF-8 として decode できるか
    ではない）。RFN の語句は純 ASCII なので、Shift_JIS でも Latin-1 でも
    `errors="replace"` で確実に拾える——初版はここが厳しすぎて、非 UTF-8 の
    ライセンス文書を無言でバイナリ扱いしていた。UTF-16 は NUL を含むので BOM で
    先に受ける。
    """
    head = read_head(path)
    if head.startswith(FONT_MAGICS):
        return "font", None
    if head[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return "text", "utf-16"
    if b"\x00" in head:
        return "binary", None
    return "text", "utf-8"


# --- 抽出（レビュー H1 の全面組み直し）--------------------------------------

# 候補として認める語数の上限。名前は名前であって文ではない——散文から拾った
# `the Adobe line above, and the OFL definition` のような句が予約名の記録に載ると、
# 逐語転記する工程（#289）が読めなくなる。**検出力は落ちない**: 同じ断片から短い
# 部分候補と単語候補も出しているので、5 語以下の実在する名前はすべて残る
# （`Bitstream Vera Sans Mono` は 4 語）。
MAX_CANDIDATE_WORDS = 5


def _clean(name):
    name = name.strip().strip("　")
    if not name or len(name) > 80:
        return None
    if not any(ch.isalnum() for ch in name):
        return None
    if len(_words(name)) > MAX_CANDIDATE_WORDS:
        return None
    return name


def _words(text):
    return [w for w in re.split(r"[\s　]+", text) if w]


def _is_stop(word):
    """語単体が「名前ではない」と言えるか（散文語・数字のみ・記号のみ・1 文字）。

    **英数が 1 文字しかない候補は落とす。** 予約名は名前であって 1 文字ではなく、
    逆に 1 文字の候補は「その字を含む全派生名」を違反にするので、判定を無意味に
    する（警報疲れ）。実際に 2 度出た: `Copyright(c)` からの `'c'`（括弧を語句直後に
    限定して回避）と、`Foo's Sans` のアポストロフィ対から出た `'s'`（レビュー
    #288 NNM2）。経路を塞ぐより、**1 文字は名前ではない**という性質でまとめて落とす。
    """
    core = word.strip(".,;:()[]{}\"'`“”‘’「」-–—").casefold()
    if not core:
        return True
    if core in PROSE_STARTS:
        return True
    if len([ch for ch in core if ch.isalnum()]) <= 1:
        return True
    return not any(ch.isalnum() for ch in core) or core.isdigit()


def _all_stop(text):
    words = _words(text)
    return bool(words) and all(_is_stop(w) for w in words)


def _trim_stop_edges(text):
    """句の**両端**から散文語を削る（真ん中は触らない）。

    `the Adobe line above reserves the name` → `Adobe`。名前は文の途中に埋まって
    いても端が散文語で始まったり終わったりしない、という形の議論であって、走査の
    打ち切りではない。**検出力は落ちない**——包含判定は部分文字列なので、端を削った
    芯が派生名に含まれることは、削る前の句が含まれることから従う（`Note Sans` は
    `Sans` として残り、`Note Sans Term` はやはり違反になる）。
    削らないと、散文 1 行から `the Adobe line above reserves the name` のような
    句がそのまま予約名の記録に載り、逐語で README へ書き写す工程が壊れる。
    """
    words = _words(text)
    while words and _is_stop(words[0]):
        words.pop(0)
    while words and _is_stop(words[-1]):
        words.pop()
    return " ".join(words)


def _candidates_from_segment(segment):
    """引用符に囲まれていない断片から候補を作る。**打ち切らない**。

    塊・区切りで割った断片・先頭の散文語を落とした接尾・散文語でない単語、の
    4 系統をすべて集めてから、全語が散文語の候補だけを落とす。「この語が来たら
    解析をやめる」形の分岐は**ここには 1 つも無い**——`extract_names` の組み直しが
    2 度とも「ある条件で打ち切る」形の失敗だったので、打ち切りを構造から外した
    （レビュー #288 H1 / NH1・NH2）。
    """
    out = []

    def add(text, trim=True):
        # 削る前の塊も、削った芯も、**両方**残す（レビュー #288 NNM1）。芯だけに
        # すると `Note Sans` が記録に `'Sans'` としてしか載らず、#289 が逐語転記
        # する記録に「このパッケージは 'Sans' を予約している」という**事実でない
        # こと**が載る。両方載せれば転記は正しく、検出力も変わらない。
        for value in ({text, _trim_stop_edges(text)} if trim else {text}):
            value = _clean(value)
            if value and not _all_stop(value):
                out.append(value)

    segment = segment.strip(" \t　")
    if not segment:
        return out

    add(segment)
    for part in SPLITTERS.split(segment):
        add(part)
        for word in _words(part):
            if not _is_stop(word):
                add(word, trim=False)
    return out


def extract_names(rest):
    """語句の後ろから予約名の候補を取り出す。

    返り値 `(names, verdict)`。verdict は:
      'names'      候補を取り出した
      'prose'      候補になりうる語が 1 つも無く、全部が既知の散文語だった
      'reference'  行内にこれ以上の中身が無い（見出し・次行への参照）
      'unresolved' 語句はあるが候補を取り出せない ← **「宣言なし」と言ってはいけない**
    """
    # 語句そのものが引用されている形（OFL §1 の `"Reserved Font Name" refers to …`）
    # では、閉じ引用符が**空白なしで**語句の直後に来る。これを外してから読む——
    # 外さないと「引用符で始まる＝名前の引用が続く」と誤り、定義文が『未解決』に
    # なって全パッケージが判定保留になる。
    if rest[:1] in CLOSING_QUOTES:
        rest = rest[1:]

    # **走査範囲を切らない。** 3 巡目まで、ここには「1 文だけ読む」と「最初の `(`
    # より先は読まない」の 2 つの打ち切りがあり、切る前に候補が 1 つでも取れると
    # `names` を返して切った先を黙って捨てていた（レビュー #288 NNH1・実測 6 形。
    # `Names Hack (the base) and NerdFonts` の NerdFonts、`Name Inc. Quux` の Quux —
    # 略語のピリオドが名前を二分する形まで含む）。
    #
    # 打ち切りは 3 度とも同じ失敗（1 巡目「引用が当たったら以降を読まない」・
    # 2 巡目「散文語が来たら行ごと捨てる」・3 巡目「文と括弧で切る」）だったので、
    # **境界そのものを構造から消した**——`.` `;` `。` `(` `)` `[` `]` は「読むのを
    # やめる印」ではなく**候補を割る区切り**として扱う。読まない場所が無ければ、
    # そこで黙ることもできない（4 度目が作れない形にする、が目的）。
    region = rest

    names = []
    # 引用符（と語句直後の括弧）で**宣言された**名前と、引用の外から拾った候補を
    # 区別して控える。判定は両方を使う（偽陰性ゼロ）が、記録は分けて出す——
    # 散文からの過剰捕捉が宣言と同じ列に並ぶと、#289 が逐語転記する記録に
    # 「このパッケージは 'OFL' を予約している」と読める行が載る（レビュー NNM1）。
    quoted = []
    # 消費済みの位置を伏せ字にしていく（引用の中を二重に読まないため）。
    masked = list(region)

    def consume(start, stop):
        for i in range(start, stop):
            masked[i] = "\x00"

    for m in QUOTED.finditer(region):
        value = _clean(next(g for g in m.groups() if g is not None))
        if value:
            names.append(value)
            quoted.append(value)
        consume(m.start(), m.end())

    lead = UNQUOTED_LEAD.match(region).end()
    paren = LEADING_PAREN.match(region[lead:])
    if paren:
        value = _clean(paren.group(1))
        if value:
            names.append(value)
            quoted.append(value)
        consume(lead, lead + paren.end())

    # 引用の外に残ったところを**すべて**読む。引用が 1 つ当たったらそこで終わり、
    # という分岐は置かない——`Name "Alpha" and Bravo` の Bravo が落ちる（NH2）。
    # 括弧・角括弧は**区切り**（`Hack (the base) and NerdFonts` の NerdFonts を
    # 落とさないため。中身も読むが、それは過剰捕捉＝安全側）。
    leftover = re.sub(r"[()\[\]]", "\x00", "".join(masked))
    had_text = had_word = cjk_unsplit = False
    for segment in leftover.split("\x00"):
        segment = segment.strip(" \t　:：-–—=")
        if segment:
            had_text = True
        if any(ch.isalnum() for ch in segment):
            had_word = True
        if CJK.search(segment):
            # 引用符の無い CJK は語に割れない（`シータ。イオタも予約` から
            # `イオタ` は取り出せない）。候補は返すが、行としては解決していない。
            cjk_unsplit = True
        names.extend(_candidates_from_segment(segment))

    # 重複排除（出現順を保つ）
    seen, ordered = set(), []
    for name in names:
        if name not in seen:
            seen.add(name)
            ordered.append(name)

    if cjk_unsplit:
        # 候補は失わない。判定だけ保留する（`unresolved` は `names` より強い）。
        return ordered, "unresolved", quoted
    if ordered:
        return ordered, "names", quoted
    if had_word:
        # 語はあったが候補が 1 つも残らなかった＝全部が既知の散文語だった。
        return [], "prose", []
    if had_text or region.strip(" \t　:：-–—=\"'`”’」"):
        # 文字はあるのに語として読めなかった（記号だけ・引用の中が空 等）。
        # ここを `prose` に倒すと「読めなかった」を「宣言なし」と言うことになる。
        return [], "unresolved", []
    return [], "reference", []


def extract_from_line(line, phrase):
    """1 行から候補を集める。**語句の出現ごとに**見る（同一行 2 宣言・H1）。

    `unresolved` は `names` より**強い**（レビュー NM4）: 1 つ目の出現から名前が
    取れていても、2 つ目が読めていないなら行としては解決していない。安全網は
    「取れた分で満足しない」側に倒す。
    """
    names, verdicts, quoted = [], [], []
    for m in phrase.finditer(line):
        found, verdict, found_quoted = extract_names(line[m.end():])
        names.extend(found)
        quoted.extend(found_quoted)
        verdicts.append(verdict)
    seen, ordered = set(), []
    for name in names:
        if name not in seen:
            seen.add(name)
            ordered.append(name)
    quoted = sorted(set(quoted))
    if "unresolved" in verdicts:
        return ordered, "unresolved", quoted
    if ordered:
        return ordered, "names", quoted
    if "prose" in verdicts:
        return [], "prose", []
    return [], "reference", []


VERDICT_LABEL = {
    "prose": "（宣言なし——散文・定義文）",
    "reference": "（宣言なし——見出し・次行への参照。この行に名前は続かない）",
    "unresolved": "⚠ 未解決——語句はあるが候補を取り出せない（人が読むこと）",
}


# --- 走査 -------------------------------------------------------------------

def scan_text(path, encoding, phrase, hits):
    with open(path, "r", encoding=encoding, errors="replace") as fp:
        for lineno, line in enumerate(fp, 1):
            line = line.rstrip("\n")
            if not phrase.search(line):
                continue
            names, verdict, quoted = extract_from_line(line, phrase)
            hits.append((f"{path}:{lineno}", line.strip(), names, verdict, quoted))


def scan_font(path, phrase, hits, counts, problems):
    """name テーブルを走査する。

    1 ファイルの異常で走査全体を止めない（レビュー M3: 切り詰められた TTF が
    fontTools の AssertionError で全体を落とし、既に見つかっていた行まで
    1 行も出なくなっていた）。異常はパス付きで報告し、続ける。
    """
    from fontTools.ttLib import TTFont, TTCollection

    try:
        if read_head(path, 4) == b"ttcf":
            fonts = list(TTCollection(path, lazy=True).fonts)
        else:
            fonts = [TTFont(path, lazy=True)]
    except Exception as exc:                       # noqa: BLE001 - 種類を問わず続ける
        problems.append(f"{path}: フォントとして開けない（{type(exc).__name__}: {exc}）")
        return

    for face_index, font in enumerate(fonts):
        try:
            records = font["name"].names
        except Exception as exc:                   # noqa: BLE001
            problems.append(f"{path}#{face_index}: name テーブルを読めない "
                            f"（{type(exc).__name__}: {exc}）")
            continue
        seen = set()
        for rec in records:
            try:
                s = rec.toUnicode()
            except Exception:                      # noqa: BLE001
                # 読めない name レコードは **まさに RFN が隠れうる場所**なので、
                # 数えて報告する（レビュー M5: 無言で捨てていた）。
                counts["name-decode-failed"] += 1
                problems.append(f"{path}#{face_index}:nameID {rec.nameID} の "
                                f"decode に失敗（plat={rec.platformID}）")
                continue
            if not phrase.search(s):
                continue
            key = (rec.nameID, s)
            if key in seen:
                continue
            seen.add(key)
            names, verdict, quoted = extract_from_line(s, phrase)
            flat = " ".join(s.split())
            hits.append((f"{path}#{face_index}:nameID {rec.nameID}", flat, names,
                         verdict, quoted))


def iter_files(roots, all_files, skipped_records):
    """走査対象のパスを列挙する。

    記録ファイル（`RECORD_FILES`）を外したときは **`skipped_records` に控える**——
    外したことを黙っていると、上流アーカイブ同梱の `README.md` に RFN 宣言がある
    場合に無言で落ちる（レビュー NM3）。バイナリ除外のパス列挙と同じ扱いにする。
    """
    for root in roots:
        if os.path.isfile(root):
            yield root
            continue
        if not os.path.isdir(root):
            sys.exit(f"[check-license] パスが存在しない: {root}")
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames.sort()
            for name in sorted(filenames):
                path = os.path.join(dirpath, name)
                if not all_files and name in RECORD_FILES:
                    skipped_records.append(path)
                    continue
                yield path


# --- 自己テスト（`.py` に自動ゲートが来ない以上、道具が自分で持つ）-----------

SELF_TEST_CASES = [
    # (入力行, 期待する候補の部分集合, 期待 verdict)
    # レビュー #288 H1 が実測した偽陰性 6 パターン（初版はすべて取り逃がした）
    ('with Reserved Font Name Cica, based on the "Hack" project.',
     ["Cica", "Hack"], "names"),
    ("with Reserved Font Names Foo and Bar", ["Foo", "Bar"], "names"),
    ("with Reserved Font Name `Cica`", ["Cica"], "names"),
    ("with Reserved Font Name: cica", ["cica"], "names"),
    ("with Reserved Font Name (Cica)", ["Cica"], "names"),
    ("Copyright, with Reserved Font Name Cica and Reserved Font Name Nerd",
     ["Cica", "Nerd"], "names"),
    # レビュー #288 NH1 が実測した偽陰性 6 形（2 版目の `PROSE_STARTS` 中断ゲートが
    # 行ごと落としていた。散文語は**候補から落とす**だけで、解析は続ける）
    ("The Reserved Font Name for this font is Cica.", ["Cica"], "names"),
    ("Reserved Font Names are Foo and Bar.", ["Foo", "Bar"], "names"),
    ("with Reserved Font Name of Cica", ["Cica"], "names"),
    ("Reserved Font Name: is Cica", ["Cica"], "names"),
    # 予約名そのものが散文語で始まる形。端の散文語は削るので候補は芯の `Sans` に
    # なるが、包含判定は部分文字列なので `Note Sans Term` / `The Sans Term` は
    # どちらも違反として捕まる（落ちないことが要件で、字面の一致は要件ではない）
    ("with Reserved Font Name Note Sans", ["Sans"], "names"),
    ("with Reserved Font Name The Sans", ["Sans"], "names"),
    # レビュー #288 NH2 が実測した偽陰性 3 形（引用 / 括弧が 1 つ当たると、
    # それ以降の引用符なし名前が読まれなかった）
    ('with Reserved Font Name "Alpha" and Bravo', ["Alpha", "Bravo"], "names"),
    ("with Reserved Font Names (Charlie) and Delta", ["Charlie", "Delta"], "names"),
    ("with Reserved Font Name 「Echo」 and Foxtrot", ["Echo", "Foxtrot"], "names"),
    # レビュー #288 NM4 由来。打ち切りを消したので**両方**読める形になった
    # （以前は 2 つ目の出現が `.` の先にあり、1 つ目で満足して黙っていた）
    ('with Reserved Font Name "Alpha" and also Reserved Font Name.  Bravo',
     ["Alpha", "Bravo"], "names"),
    ("with Reserved Font Name.  Cica", ["Cica"], "names"),
    # レビュー #288 NNH1 が実測した偽陰性 6 形（3 巡目に残っていた 2 つの打ち切り
    # ——1 文で切る / 最初の `(` で切る——が、切る前に 1 つ取れると黙っていた）
    ("with Reserved Font Names Hack (the base) and NerdFonts",
     ["Hack", "NerdFonts"], "names"),
    ("with Reserved Font Name Cica (formerly Foo) and Bravo",
     ["Cica", "Bravo"], "names"),
    ("with Reserved Font Name Kappa (see LICENSE) and Lambda",
     ["Kappa", "Lambda"], "names"),
    ("with Reserved Font Name Inc. Quux", ["Quux"], "names"),
    ("with Reserved Font Names Alpha. Bravo is also reserved",
     ["Alpha", "Bravo"], "names"),
    ("with Reserved Font Name Zeta; Eta is also reserved",
     ["Zeta", "Eta"], "names"),
    # レビュー #288 NNM1: 芯だけでなく**塊も**残す（記録が事実であるために）
    ("with Reserved Font Name Note Sans", ["Note Sans", "Sans"], "names"),
    ("with Reserved Font Name The Sans Mono", ["The Sans Mono", "Sans Mono"], "names"),
    # レビュー #288 NNM3: 引用符の無い CJK は語に割れない → 判定は保留に倒す
    ("with Reserved Font Name シータ。イオタも予約", [], "unresolved"),
    # 安全網そのものの回帰（`unresolved` を期待するケースが 1 件も無いと、網が
    # 二度と発火しない実装に退化しても緑のまま・レビュー NM1）
    ("with Reserved Font Name — ***", [], "unresolved"),
    # 出荷バイトに実在する形（これらを壊さないための回帰）
    ("Copyright (c) 2021, Yuko OTAWARA. with Reserved Font Name \"PlemolJP\"",
     ["PlemolJP"], "names"),
    ('Copyright © 2014, 2015 Adobe Systems Incorporated (http://www.adobe.com/), '
     "with Reserved Font Name 'Source'.", ["Source"], "names"),
    ("Bitstream Vera Sans Mono ... with Reserved Font Names \"Bitstream\" and \"Vera\"",
     ["Bitstream", "Vera"], "names"),
    ('Copyright (c) 2019, Yuko OTAWARA. with Reserved Font Name "白源", "HackGen"',
     ["白源", "HackGen"], "names"),
    ("RESERVED FONT NAME: the Adobe line above reserves the name 'Source' (OFL",
     ["Source"], "names"),
    # 名前を宣言しない行——ここを 'names' にすると全 OFL が予約名を宣言することになる
    ('"Reserved Font Name" refers to any names specified as such after the',
     [], "prose"),
    ("RESERVED FONT NAME note at the end of section 1.", [], "prose"),
    ("no reserved name. 'Source' is the only reserved font name declared anywhere in",
     [], "prose"),
    ("states the PlemolJP holder again, there with a Reserved Font Name:",
     [], "reference"),
]

# **出てはいけない候補**（部分集合方式では表現できないので別の列にする・レビュー
# #288 NNM2 の申し送り）。1 文字候補は「その字を含む全派生名」を違反にするので、
# 拾いすぎの中でもこれだけは害が判定を壊す水準にある。
SELF_TEST_FORBIDDEN = [
    # アポストロフィが `'…'` の対にマッチして伏せ字になり、`'s'` が候補になった形
    ("with Reserved Font Names Foo's Sans and Bar's Mono", ["s"]),
    # `Copyright(c)` から `'c'` が出た形（1 文字候補の除外で塞いである）
    ("[M+ OUTLINE FONTS] with Reserved Font Name 'Source'. Copyright(c) 2015",
     ["c"]),
]


def run_self_test():
    print("=== --self-test: extract_names の回帰表 ===")
    print()
    failures = 0
    for line, expected, expected_verdict in SELF_TEST_CASES:
        names, verdict, _quoted = extract_from_line(line, PHRASE)
        missing = [e for e in expected if e not in names]
        ok = not missing and verdict == expected_verdict
        if not ok:
            failures += 1
        print(f"{'OK ' if ok else 'NG '} {line[:72]!r}")
        print(f"      得た候補: {names} / verdict={verdict}")
        if missing:
            print(f"      **取り逃がした**: {missing}")
        if verdict != expected_verdict:
            print(f"      **verdict 不一致**: 期待 {expected_verdict}")
    print()
    print("--- 出てはいけない候補（禁止リスト・部分集合方式では固定できない）---")
    for line, forbidden in SELF_TEST_FORBIDDEN:
        names, verdict, _quoted = extract_from_line(line, PHRASE)
        hit = [f for f in forbidden if f in names]
        if hit:
            failures += 1
        print(f"{'OK ' if not hit else 'NG '} {line[:72]!r}")
        print(f"      得た候補: {names} / verdict={verdict}")
        if hit:
            print(f"      **出てはいけない候補が出た**: {hit}")

    total = len(SELF_TEST_CASES) + len(SELF_TEST_FORBIDDEN)
    print()
    print(f"{total} 件中 失敗 {failures} 件")
    print("（期待は**部分集合**で書いてある: 過剰捕捉は安全側なので落とさない。")
    print("  落とすこと〔偽陰性〕・宣言なしの行を宣言ありと言うこと・禁止候補を")
    print("  出すことの 3 つだけが失敗）")
    return 0 if failures == 0 else 6


# --- 判定 -------------------------------------------------------------------

def normalize(s):
    """比較用の正規化: NFKC（全角を畳む）+ casefold（大小文字）。

    このリポ自身の派生名が `MPLUS1CodeTerm` のように**空白を落とす**形なので、
    空白差は判定には効かせず**別行の警告**として出す（レビュー M7）。
    """
    return unicodedata.normalize("NFKC", s).casefold()


def strip_spaces(s):
    return re.sub(r"\s+", "", normalize(s))


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="check-license.py",
        description="予約フォント名（OFL 1.1 §3）を全数抽出する",
    )
    ap.add_argument("paths", nargs="*", help="走査するファイル / ディレクトリ")
    ap.add_argument(
        "--derived-name", action="append", default=[], metavar="NAME",
        help="派生名の候補。各予約名を部分文字列として含むかを判定する（複数可）",
    )
    ap.add_argument(
        "--all-files", action="store_true",
        help=f"{' / '.join(RECORD_FILES)}（この検査の記録そのもの）も走査する",
    )
    ap.add_argument(
        "--allow-zero-reserved", action="store_true",
        help="予約名 0 件でも exit 0 にする（0 件が正当だと分かっているパッケージ用）",
    )
    ap.add_argument(
        "--allow-spaceless-match", action="store_true",
        help="空白を除くと予約名と一致する派生名を明示的に受け入れる（既定は保留）",
    )
    ap.add_argument(
        "--self-test", action="store_true",
        help="抽出規則の回帰表を走らせる（走査はしない）",
    )
    ap.add_argument(
        "--control-case-sensitive", action="store_true",
        help="【陽性コントロール専用】case-sensitive に劣化させる（落とし穴 1 の赤経路）",
    )
    ap.add_argument(
        "--control-ext-filter", metavar="EXT", default=None,
        help="【陽性コントロール専用】この拡張子のファイルだけ走査する（落とし穴 2 の赤経路）",
    )
    ap.add_argument(
        "--control-skip-name-table", action="store_true",
        help="【陽性コントロール専用】フォント本体の name テーブルを見ない（落とし穴 3 の赤経路）",
    )
    args = ap.parse_args(argv)

    if args.self_test:
        return run_self_test()
    if not args.paths:
        ap.error("走査するパスを 1 つ以上指定すること（または --self-test）")

    controls = [
        ("--control-case-sensitive", args.control_case_sensitive),
        ("--control-ext-filter", args.control_ext_filter is not None),
        ("--control-skip-name-table", args.control_skip_name_table),
    ]
    active = [n for n, on in controls if on]
    degraded = bool(active)
    if degraded:
        banner = (f"!! 劣化スイッチが有効: {' '.join(active)}\n"
                  "!! これは陽性コントロール専用の実行であって、検査の結果ではない。")
        print(banner)
        print()
        # 記録が切り取られても劣化が残るよう、stderr にも出す（レビュー M2）。
        print(banner, file=sys.stderr)

    mark = "[劣化実行] " if degraded else ""
    phrase = PHRASE_CASE_SENSITIVE if args.control_case_sensitive else PHRASE

    hits = []
    problems = []
    skipped_binaries = []
    skipped_records = []
    counts = {"text": 0, "font": 0, "binary": 0, "ext-filtered": 0,
              "unreadable": 0, "name-decode-failed": 0}
    for path in iter_files(args.paths, args.all_files, skipped_records):
        if args.control_ext_filter is not None and not path.endswith(
            "." + args.control_ext_filter.lstrip(".")
        ):
            counts["ext-filtered"] += 1
            continue
        try:
            kind, encoding = classify(path)
        except OSError as exc:
            counts["unreadable"] += 1
            problems.append(f"{path}: 読めない（{exc}）")
            continue
        if kind == "binary":
            counts["binary"] += 1
            skipped_binaries.append(path)
            continue
        if kind == "font":
            counts["font"] += 1
            if not args.control_skip_name_table:
                scan_font(path, phrase, hits, counts, problems)
            continue
        counts["text"] += 1
        try:
            scan_text(path, encoding, phrase, hits)
        except OSError as exc:
            counts["unreadable"] += 1
            problems.append(f"{path}: 読めない（{exc}）")

    print(f"走査: テキスト {counts['text']} / フォント {counts['font']} "
          f"/ バイナリ除外 {counts['binary']} / 拡張子で除外 {counts['ext-filtered']} "
          f"/ 読めず {counts['unreadable']} "
          f"/ name レコード decode 失敗 {counts['name-decode-failed']}")
    if skipped_binaries:
        print("バイナリとして飛ばしたパス（中は見ていない・zip は展開しない）:")
        for path in skipped_binaries:
            print(f"  - {path}")
    if skipped_records:
        # 外したことを黙らない（レビュー NM3）。上流同梱の README に RFN 宣言が
        # あることは十分ありうるので、`--all-files` で読み直す判断を人に渡す。
        print(f"記録ファイルとして外したパス（{' / '.join(RECORD_FILES)}"
              "——この検査の記録そのもの。読ませるなら --all-files）:")
        for path in skipped_records:
            print(f"  - {path}")
    if problems:
        print("走査中の異常（続行した）:")
        for line in problems:
            print(f"  ! {line}")
    print(f"一致行: {len(hits)}")
    print()
    print("--- 一致行（全行・省略なし）---")
    for origin, line, names, verdict, _quoted in hits:
        print(f"{origin}: {line}")
        if names:
            # 名前が取れていても未解決の出現が残っている行がある（1 行に語句が
            # 2 回あり、片方が読めなかった形・NM4）。取れた分で満足したように
            # 見せない。
            suffix = ("  ⚠ ただし同じ行に未解決の出現がある（判定は保留）"
                      if verdict == "unresolved" else "")
            print(f"    予約名候補: {', '.join(repr(n) for n in names)}{suffix}")
        else:
            print(f"    予約名候補: {VERDICT_LABEL[verdict]}")

    unresolved = [h for h in hits if h[3] == "unresolved"]
    reserved = {}
    quoted_names = set()
    for origin, _line, names, _verdict, quoted in hits:
        for name in names:
            reserved.setdefault(name, []).append(origin)
        quoted_names.update(quoted)

    declared = {n: o for n, o in reserved.items() if n in quoted_names}
    residual = {n: o for n, o in reserved.items() if n not in quoted_names}

    # 2 群に分けて出す。**判定は両方を使う**（引用符なしの宣言は実在する——
    # `with Reserved Font Name Cica` の形で、レビュー #288 NH1 が実測した）。
    # 分ける目的は記録の質だけ: 散文からの過剰捕捉が宣言と同じ列に並ぶと、
    # 逐語転記された記録が「このパッケージは 'OFL' を予約している」と読める
    # （レビュー NNM1）。
    print()
    print(f"--- 予約名: 引用符で宣言されたもの {len(declared)} 件 ---")
    if not declared:
        print("  （引用符付きの宣言は 1 件も無い）")
    for name in sorted(declared):
        print(f"  {name!r}  ← {', '.join(declared[name])}")

    print()
    print(f"--- 引用符なしで拾った候補: {len(residual)} 件"
          "（宣言のことも過剰捕捉のこともある・判定には同じく使う）---")
    if not residual:
        print("  （なし）")
    for name in sorted(residual):
        print(f"  {name!r}  ← {', '.join(residual[name])}")
    print(f"  ↑ 照合に使う予約名は上下あわせて {len(reserved)} 件。"
          "散文由来の候補は出所の行を見て人が捨てる（落とすより拾いすぎる側に倒してある）。")

    if unresolved:
        print()
        print(f"--- ⚠ 未解決行: {len(unresolved)} 件 ---")
        print("  語句はあるのに候補を取り出せなかった行がある。**人が読むこと**。")
        print("  この状態で「予約名を含まない」とは言えないので、判定は保留する。")
        for origin, line, _names, _verdict, _quoted in unresolved:
            print(f"  ? {origin}: {line}")

    violations = []
    spaceless_hits = []
    if args.derived_name:
        print()
        print("--- 派生名の判定（部分文字列・NFKC + casefold）---")
        for derived in args.derived_name:
            norm = normalize(derived)
            contained = sorted(n for n in reserved if normalize(n) in norm)
            spaceless = sorted(
                n for n in reserved
                if normalize(n) not in norm and strip_spaces(n) in strip_spaces(derived)
            )
            # 空白差の一致は**判定行の中**に畳む（別行の ⚠ は、README 手順 3 の
            # 「判定行を逐語で記録せよ」に従うと落ちる・レビュー NM2）。
            note = ""
            if spaceless:
                spaceless_hits.append((derived, spaceless))
                note = (f" ⚠（空白を除くと {', '.join(repr(n) for n in spaceless)} と一致"
                        f"——このリポの派生名は空白を落とす形なので保留）")
            if contained:
                violations.append((derived, contained))
                print(f"  {mark}{derived!r}: 予約名 {', '.join(repr(n) for n in contained)} "
                      f"を含む → **OFL 1.1 §3 違反**（この名前は使えない）{note}")
            elif unresolved:
                print(f"  {mark}{derived!r}: **判定保留**——未解決行 {len(unresolved)} 件がある "
                      f"（OK とは言えない。照合できた予約名 {len(reserved)} 件）{note}")
            elif spaceless and not args.allow_spaceless_match:
                print(f"  {mark}{derived!r}: **判定保留**{note}")
            elif not reserved:
                print(f"  {mark}{derived!r}: どの予約名も含まない → OK "
                      f"**（照合した予約名 0 件——この OK は空虚に真）**{note}")
            else:
                print(f"  {mark}{derived!r}: どの予約名も含まない → OK "
                      f"（照合した予約名 {len(reserved)} 件）{note}")

    if violations:
        print()
        print("NG: 派生名が予約名を含む", file=sys.stderr)
        return 3
    if unresolved:
        print(f"⚠ 未解決行 {len(unresolved)} 件——検査は完了していない", file=sys.stderr)
        return 5
    if spaceless_hits and not args.allow_spaceless_match:
        print("⚠ 空白を除くと予約名と一致する派生名がある——保留"
              "（正当なら --allow-spaceless-match で明示する）", file=sys.stderr)
        return 5
    if args.derived_name and not reserved and not args.allow_zero_reserved:
        print("⚠ 照合対象が 0 件——この OK は空虚に真"
              "（正当なら --allow-zero-reserved で明示する）", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
