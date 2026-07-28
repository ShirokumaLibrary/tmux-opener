#!/usr/bin/env bash
# font-fit — 同梱フォントを「幅 1 の ink ≤ セル幅」へ変換するパイプラインのドライバ。
# 設計 #271 R5/R7/R13。変換ロジックは #262 の動作確認済み試作からの移植。
#
# 2 つの生成物は扱いが正反対で、これを取り違えると意味が壊れる:
#
#   widths.json    コミットしない。上流（@xterm/addon-unicode11）に自動追従すべき
#                  **派生入力**で、コミットした瞬間に xterm の bump に取り残される
#                  手保守物へ退化する。だから毎回 scratch へ生成し直す。
#   checksums.json コミットする。出力 TTF のバイト列に対する**主張**で、npm test が
#                  同梱 TTF と突き合わせる照合元（R13）。TTF と同一 commit で動く。
#                  出力ごとに「焼いた fitRatio」「焼いた vstretch」も記録する
#                  （#291 / #293）——sha256 だけではどの倍率で焼いたかが
#                  復元できないため。
#
# 使い方:
#   scripts/font-fit/run.sh --src-dir <展開済み上流ディレクトリ> [options]
#
#   --src-dir DIR    manifest の srcEntry を解決する根。**必須**（差し替え後、
#                    リポには上流バイト列が無い）。変換前に全 face の srcSha256 を
#                    一括照合し、取り違えは 1 バイトも書く前に落ちる。
#   --out-dir DIR    出力の根（既定 = リポジトリルート = 各パッケージへ直接配置）。
#                    dry-run は scratch を指定する。リポジトリルート以外を指した
#                    ときは checksums を <DIR>/checksums.json へ書き、リポの
#                    checksums.json は触らない。
#   --only PKG       manifest の package が PKG に一致するものだけ変換（部分実行）。
#   --face OUT       out 名が OUT に一致する face だけ変換（部分実行）。
#                    部分実行はリポジトリルートへは置けない（--out-dir が必須）。
#   --work-dir DIR   widths.json と静的化中間ファイルの置き場（既定 = mktemp -d。
#                    既定のときだけ終了時に消す。明示したら利用者の持ち物）。
#   --fit-ratio R    manifest の fitRatio を 1 回限り上書きする（試行用）。
#                    **--out-dir が必須**——宣言（manifest）と違う倍率で焼いた TTF を
#                    既定 out-dir へ置かせない。checksums.json は「どの倍率で焼いたか」
#                    を出力ごとに記録するので、記録と manifest が食い違う状態を
#                    リポジトリに作らせないのが趣旨（--only / --face と同じ規律）。
#   --vstretch V     manifest の vstretch を 1 回限り上書きする（試行用）。
#                    **--out-dir が必須**——理由は --fit-ratio と同一。
#
# Python は venv（PEP 668）。$FONTTOOLS_PY 既定 ~/.local/share/fonttools-venv/bin/python。
# 無ければ（または fontTools を import できなければ）導入手順を出して **hard-fail**
# する——Semgrep（lint 層）の soft-skip とは逆に倒す。これは生成工程で、「skip した
# 緑」に意味がないため（設計 #271 R5）。
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$here/../.." && pwd -P)"
manifest="$here/manifest.json"

# manifest 由来のパス片（package / srcEntry / out）は「リポ内の定数」だが、結合前に
# 検証する。scripts/install-claude.sh が「$dest の外へは 1 バイトも書かない」を構成で
# 保証しているのと同水準に寄せる（脱出は書ける者が既にリポを書ける前提なので実害は
# 低いが、水準を落とす理由もない）。symlink の追従だけは install-claude.sh の
# 「祖先まで解決」より弱く、出力先の leaf が symlink なら拒否する止まり。
reject_unsafe_path() {
  local label="$1" p="$2"
  case "$p" in
    "" ) echo "[font-fit] manifest の $label が空" >&2; exit 1 ;;
    /* ) echo "[font-fit] manifest の $label が絶対パス: $p" >&2; exit 1 ;;
    *..*) echo "[font-fit] manifest の $label に .. が含まれる: $p" >&2; exit 1 ;;
  esac
}

require_value() {
  # $1 = フラグ名 / $2 = 残り引数の数。値なしフラグが末尾に来たときに
  # set -u の生エラー（$2: unbound variable）ではなく使い方を出す。
  if [ "$2" -lt 2 ]; then
    echo "[font-fit] $1 には値が必要（--help で使い方）" >&2
    exit 2
  fi
}

src_dir=""
out_dir=""
work_dir=""
only_pkg=""
only_face=""
fit_ratio_override=""
vstretch_override=""

# fitRatio の範囲検査（意味・上限の正本は manifest.json の note）。fit.py と同じ規則を
# シェル側でも持つのは二重管理ではなく **位置**の違い: fit.py は 1 face を書く直前の
# 砦で、こちらは全 face を書き始める前の砦（相 1）。face #3 の値が不正なとき #1/#2 が
# 既に書かれている、を作らない。
MAX_FIT_RATIO=1.5
# 数値の形の検査（両 assert 共通）。非数字・小数点 2 個以上に加え、**末尾ドット**
# （`1.` `.` ——awk は 1 / 0 として黙って通す）も落とす（#293 レビュー Low-4）。
# 実害が出た値ではないが、通してよい理由も無い形なので入口で閉じる。
assert_numeric_shape() {
  # $1 = 値 / $2 = 名前 / $3 = どこから来たか（エラー文用）
  case "$1" in
    ''|*[!0-9.]*|*.*.*|*.) echo "[font-fit] $2 が数値でない（$3）: $1" >&2; exit 2 ;;
  esac
}
assert_fit_ratio() {
  # $1 = 値 / $2 = どこから来たか（エラー文用）
  assert_numeric_shape "$1" fitRatio "$2"
  if ! awk -v r="$1" -v m="$MAX_FIT_RATIO" 'BEGIN { exit !(r > 0 && r <= m) }'; then
    echo "[font-fit] fitRatio は 0 < r <= $MAX_FIT_RATIO の範囲（$2）: $1" >&2
    echo "  上限は xterm の allowRescaling が横だけ潰す境界（意味は manifest.json の note）。" >&2
    exit 2
  fi
}

# vstretch の範囲検査。fit.py の parse_vstretch と同じ規則で、同じ理由（相 1 の砦）。
# **上限は書かない**——上限はフォントから実測する参照グリフの y 到達範囲で、fit.py が
# グリフごとに clamp する（意味の正本は manifest.json の note）。
MIN_VSTRETCH=1.0
assert_vstretch() {
  # $1 = 値 / $2 = どこから来たか（エラー文用）
  assert_numeric_shape "$1" vstretch "$2"
  if ! awk -v v="$1" -v m="$MIN_VSTRETCH" 'BEGIN { exit !(v >= m) }'; then
    echo "[font-fit] vstretch は $MIN_VSTRETCH 以上（$2）: $1" >&2
    echo "  1.0 未満は等倍より縦を縮める指定（意味は manifest.json の note）。" >&2
    exit 2
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --src-dir)  require_value "$1" "$#"; src_dir="$2";  shift 2 ;;
    --out-dir)  require_value "$1" "$#"; out_dir="$2";  shift 2 ;;
    --work-dir) require_value "$1" "$#"; work_dir="$2"; shift 2 ;;
    --only)     require_value "$1" "$#"; only_pkg="$2"; shift 2 ;;
    --face)     require_value "$1" "$#"; only_face="$2"; shift 2 ;;
    --fit-ratio) require_value "$1" "$#"; fit_ratio_override="$2"; shift 2 ;;
    --vstretch) require_value "$1" "$#"; vstretch_override="$2"; shift 2 ;;
    # ヘッダコメントが伸び縮みしても壊れないよう、最初の非コメント行で止める。
    -h|--help)  sed -n '2,${/^#/!q; p;}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# --- venv hard-fail --------------------------------------------------------
FONTTOOLS_PY="${FONTTOOLS_PY:-$HOME/.local/share/fonttools-venv/bin/python}"

venv_hint() {
  cat >&2 <<EOF

このホストは PEP 668 の externally-managed 環境なので \`pip install fonttools\` は
拒否される。専用の venv に入れること（CLAUDE.md の Semgrep と同じ手順）:

  python3 -m venv ~/.local/share/fonttools-venv
  ~/.local/share/fonttools-venv/bin/pip install fonttools

別の場所に入れてあるなら FONTTOOLS_PY で指す。
ここは lint ではなく生成工程なので skip しない: 変換しないまま緑を返すことに
意味がない（設計 #271 R5）。
EOF
}

if [ ! -x "$FONTTOOLS_PY" ]; then
  echo "[font-fit] fonttools の Python が見つからない: $FONTTOOLS_PY" >&2
  venv_hint
  exit 1
fi

for tool in jq sha256sum node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[font-fit] $tool が無い（このドライバの前提ツール）" >&2
    exit 1
  fi
done

if [ -z "$src_dir" ]; then
  echo "[font-fit] --src-dir は必須（展開済み上流ディレクトリ）" >&2
  exit 2
fi
if [ ! -d "$src_dir" ]; then
  echo "[font-fit] --src-dir が存在しない: $src_dir" >&2
  exit 1
fi

# --- 決定性のために固定する環境変数（R7 の記録項目）------------------------
export PYTHONHASHSEED=0
export LC_ALL=C.UTF-8
# 出力バイト列とは無関係な衛生措置（R7 の記録項目ではない）: verify.py が fit.py を
# import するので、放っておくと scripts/font-fit/__pycache__/ がリポに残る。
export PYTHONDONTWRITEBYTECODE=1

# --- 出力先の解決: 判定軸は「--out-dir を省略したか」ではなく「リポジトリルートか」
# --out-dir <repo_root> は既定と同じ配置なので、同じ扱い（checksums はリポの正本へ
# 書き、部分実行を拒否する）にする。省略の有無で判定していた頃はこの指定でガードを
# 迂回でき、リポルート直下に stray な checksums.json ができた。
if [ -z "$out_dir" ]; then
  out_dir="$repo_root"
fi
mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd -P)"
src_dir="$(cd "$src_dir" && pwd -P)"

placing_in_repo=0
if [ "$out_dir" = "$repo_root" ]; then
  placing_in_repo=1
elif [ "${out_dir#"$repo_root"/}" != "$out_dir" ]; then
  echo "[font-fit] 注意: 出力先が作業ツリーの中にある（git status に出る）: $out_dir" >&2
fi

partial=0
if [ -n "$only_pkg" ] || [ -n "$only_face" ]; then
  partial=1
fi

# --fit-ratio × リポジトリルートも **開始前に** 拒否する。判定軸は --only / --face と
# 同じく「--out-dir を省略したか」ではなく「出力先がリポジトリルートか」（--out-dir
# <repo_root> でガードを迂回できないため）。
if [ -n "$fit_ratio_override" ]; then
  assert_fit_ratio "$fit_ratio_override" "--fit-ratio"
  if [ "$placing_in_repo" -eq 1 ]; then
    cat >&2 <<EOF
[font-fit] --fit-ratio はリポジトリルートへは置けない。
  manifest.json が宣言した倍率と違う値で焼いた TTF を同梱先に置くと、
  「TTF は宣言と違う倍率・manifest と checksums.json は宣言どおり」という
  復元不能な状態が残る（sha256 だけでは焼いた倍率が分からない）。
  試行は scratch へ出すこと: --out-dir <スクラッチディレクトリ>
  同梱先の倍率を変えるときは manifest.json の fitRatio を書き換えて全面実行する。
EOF
    exit 2
  fi
fi

# --vstretch × リポジトリルートも同じ規律で拒否する（判定軸も同一）。
if [ -n "$vstretch_override" ]; then
  assert_vstretch "$vstretch_override" "--vstretch"
  if [ "$placing_in_repo" -eq 1 ]; then
    cat >&2 <<EOF
[font-fit] --vstretch はリポジトリルートへは置けない。
  manifest.json が宣言した縦伸長率と違う値で焼いた TTF を同梱先に置くと、
  「TTF は宣言と違う伸長率・manifest と checksums.json は宣言どおり」という
  復元不能な状態が残る（sha256 だけでは焼いた伸長率が分からない）。
  試行は scratch へ出すこと: --out-dir <スクラッチディレクトリ>
  同梱先の伸長率を変えるときは manifest.json の vstretch を書き換えて全面実行する。
EOF
    exit 2
  fi
fi

# 部分実行 × リポジトリルートは **開始前に** 拒否する。checksums.json の更新だけを
# 止める形にしていた頃は、TTF はすでに同梱先へ書かれていて「TTF は動いたのに記録は
# 古い」不整合が exit 0 で黙って残った。ガードは書く前に立てる（srcSha256 照合と
# 同じ規律）。
if [ "$placing_in_repo" -eq 1 ] && [ "$partial" -eq 1 ]; then
  cat >&2 <<EOF
[font-fit] 部分実行（--only / --face）はリポジトリルートへは置けない。
  部分実行で同梱先の TTF だけを差し替えると、checksums.json が古いまま残り
  「TTF は動いたのに記録は動いていない」不整合が作られる。
  scratch へ出すこと: --out-dir <スクラッチディレクトリ>
  同梱先を更新するときは --only / --face を外して全面実行する。
EOF
  exit 2
fi

if [ -z "$work_dir" ]; then
  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/font-fit-XXXXXX")"
  # 自動生成した work-dir だけ後始末する（widths.json と静的化中間 TTF が毎回残る）。
  # --work-dir を明示したときは利用者の持ち物なので触らない。
  trap 'rm -rf "$work_dir"' EXIT
fi
mkdir -p "$work_dir"
work_dir="$(cd "$work_dir" && pwd -P)"

# --- 来歴（R7）に記録するツールバージョンを実測して出す ---------------------
# fontTools が import できないと fit.py --version は traceback で非 0 終了する。
# ここで落とさないと「fonttools : unknown」という測れていない来歴を印字したうえで
# widths を作り、最後に生の traceback で死ぬ——導入手順は一度も出ない。venv 不在の
# hard-fail は「import できること」まで見て初めて成立する（設計 #271 R5）。
#
# 判定軸は **終了ステータスと値の形**であって、出力に失敗らしい文字列が含まれるか
# ではない。stdout と stderr を混ぜて `*Error*|*error*|*Traceback*` の否定リストで
# 見ていた頃は、(a) stderr の無害な warning が「fonttools のバージョン」として来歴に
# 印字され、(b) `error` を含む warning で誤 hard-fail し、(c) 版数を出しつつ非 0 で
# 終わる python をそのまま採用した。否定リストは「列挙し忘れた失敗」を必ず成功に
# 化けさせる。statusline と同じ規律で、測れなかった来歴は印字しない。
probe_err="$work_dir/version-probe.err"

probe_failed() {
  # $1 = 何を測ろうとしたか / $2 = 得られた stdout（形が不正なら中身を見せる）
  echo "[font-fit] 来歴を測れない: $1" >&2
  echo "  コマンド: $FONTTOOLS_PY" >&2
  if [ -n "$2" ]; then
    printf '%s\n' "$2" | sed 's/^/  stdout: /' >&2
  fi
  if [ -s "$probe_err" ]; then
    sed 's/^/  stderr: /' "$probe_err" >&2
  fi
}

if ! fonttools_version="$("$FONTTOOLS_PY" "$here/fit.py" --version 2>"$probe_err")"; then
  probe_failed "fit.py --version が非 0 終了（fontTools を import できない可能性）" ""
  venv_hint
  exit 1
fi
# 形の肯定確認: 1 行で、数字始まり（fontTools.version は "4.63.0" の形）。
case "$fonttools_version" in
  [0-9]*) ;;
  *) probe_failed "fit.py --version の出力がバージョンの形をしていない" "$fonttools_version"
     venv_hint
     exit 1 ;;
esac
newline=$'\n'
case "$fonttools_version" in
  *"$newline"*)
    probe_failed "fit.py --version が複数行を返した" "$fonttools_version"; exit 1 ;;
esac

if ! python_version="$("$FONTTOOLS_PY" --version 2>"$probe_err")"; then
  probe_failed "python --version が非 0 終了" ""
  exit 1
fi
case "$python_version" in
  Python\ [0-9]*) ;;
  *) probe_failed "python --version の出力が Python x.y.z の形をしていない" "$python_version"
     exit 1 ;;
esac
rm -f "$probe_err"
addon_version="$(node "$here/dump-widths.mjs" --print-version)"
echo "[font-fit] 来歴に記録するツールバージョン（設計 #271 R7）"
echo "  fonttools              : $fonttools_version"
echo "  python                 : $python_version"
echo "  @xterm/addon-unicode11 : $addon_version"
echo "  固定環境変数           : PYTHONHASHSEED=0 LC_ALL=C.UTF-8 recalcTimestamp=False"
# リポジトリ commit は **裸の HEAD では書かない**。来歴（R7）が主張するのは「この
# commit のこの変換器が、この入力から、この sha256 を出す」であり、作業ツリーが汚れて
# いればその主張は偽になる——HEAD を checkout して再実行しても、記録した出力は再現
# しない。#275 がまさにこれを踏んだ: fit.py を未コミットで直して再変換し、来歴には
# 変更前の HEAD が印字され、その commit を checkout すると別のハッシュが出る README が
# 出荷されかけた。裸の HEAD の罪は「間違っている」ことではなく「**汚れた状態で作った
# 来歴を、clean な HEAD で作ったものと区別できない**」ことにある。
#
# 判定はパイプラインの入力になるファイル（scripts/font-fit/ と、そこから読む
# node_modules 以外の一切）ではなく **作業ツリー全体**で行う。狭く取ると「対象外だと
# 思っていたファイルが実は効いていた」を見逃す側に倒れるので、広く取って false dirty
# を許す。来歴は疑わしきを記録する側でよい。
#
# `git describe --dirty` を使わないのは、タグの無いリポジトリでは失敗するため（この
# リポジトリの v* タグはリリース時にしか付かない）。同じことを rev-parse + diff で行う。
git_provenance() {
  local sha
  sha="$(git -C "$repo_root" rev-parse --short HEAD 2>/dev/null)" || { echo unknown; return; }
  # --quiet は差分があれば非 0。index と作業ツリーの両方を見る（ステージ済みの変更も
  # 「HEAD ではない」ことに変わりはない）。未追跡ファイルは ls-files で別に見る:
  # 変換器の新しいモジュールが未追跡のまま効いている、が起こりうる形。
  if ! git -C "$repo_root" diff --quiet HEAD 2>/dev/null \
     || [ -n "$(git -C "$repo_root" ls-files --others --exclude-standard 2>/dev/null)" ]; then
    echo "$sha-dirty"
    return
  fi
  echo "$sha"
}
repo_commit="$(git_provenance)"
echo "  リポジトリ commit      : $repo_commit"
case "$repo_commit" in
  *-dirty)
    echo "  ↑ **-dirty**: 作業ツリーが HEAD と一致していない。この commit を checkout して"
    echo "     再実行しても、いま出る sha256 は再現しない。来歴（README の三段連鎖）へ"
    echo "     この値をそのまま書かないこと——変換器を先にコミットし、確定した SHA で"
    echo "     記録するか、その SHA へ差し替える手順を残すこと（設計 #271 R7）。" ;;
esac
echo

# --- manifest を 1 度だけ展開する（jq の失敗をここで捕まえる）--------------
# フィールド区切りは TAB ではなく US (0x1F)。TAB は IFS の空白類なので bash の read が
# 連続 TAB を 1 個に畳み、空フィールドがあると列が 1 つずれる（style が空の face を
# 足すと out がずれて出力パスが黙って変わる）。非空白の区切り文字は畳まれない。
US=$'\037'
#
# fitRatio / vstretch は package 単位の上書き（packages[].fitRatio・
# packages[].vstretch）→ トップレベル既定（.fitRatio・.vstretch）の順に解決して
# face の行へ畳み込む。解決を 1 箇所（この jq）に閉じるので、下の 2 つのループは
# どちらも「行に書いてある値」を使うだけになる。
faces="$work_dir/faces.list"
if ! jq -r --arg us "$US" '.fitRatio as $default | .vstretch as $vdefault
  | .packages[] as $p | $p.faces[]
  | [$p.package, $p.family, .srcEntry, .srcSha256, (.instanceWght // "null" | tostring), .out, .style,
     (($p.fitRatio // $default) | tostring),
     (($p.vstretch // $vdefault) | tostring)]
  | join($us)' "$manifest" > "$faces"; then
  echo "[font-fit] manifest.json を読めない: $manifest" >&2
  exit 1
fi

# manifest が宣言した face 数を別に数え、相 1 が実際に読んだ行数と突き合わせる。
# **これが捕まえるのは「行数が変わる破損」だけ**——値への改行混入と、末尾の未終端行を
# read が落とす形。名指しで捕まえられないものを書かないでおく: `package: null` は jq の
# join が null を空文字列にするため行数が変わらず（実測）、これを止めるのは下の
# reject_unsafe_path package であって本チェックではない。US の混入も行区切りではない
# ので行数が変わらず、列がずれた結果は srcSha256 ゲート（書き込みの直前に立つ唯一の
# 砦）が受ける。本チェックは安価な belt-and-braces であって、fail-open の主たる修正
# ではない。
if ! declared_faces="$(jq '[.packages[].faces[]] | length' "$manifest")"; then
  echo "[font-fit] manifest.json の faces を数えられない: $manifest" >&2
  exit 1
fi

# --- 相 1: 選択された全 face を検証する（1 バイトも書かない）---------------
# srcSha256 の照合を変換ループの中に置くと「face #1/#2 は書けたが #3 で落ちた」
# という半端な作業ツリーが残り、ヘッダの「1 バイトも書く前に落ちる」が実行単位では
# 偽になる。全 face を先に見てから書き始める。
selected=0
seen=0
while IFS="$US" read -r pkg family src_entry src_sha inst_wght out_rel style face_ratio face_vstretch; do
  seen=$((seen + 1))
  # package の空は「空行スキップ」に食わせない——それが唯一の fail-open だった
  # （`package: null` の 2 面が黙って消え、4 面で exit 0 した）。全フィールドと
  # 同じく空を拒否する。
  reject_unsafe_path package "$pkg"
  reject_unsafe_path srcEntry "$src_entry"
  reject_unsafe_path out "$out_rel"
  if [ -z "$family" ] || [ -z "$style" ] || [ -z "$src_sha" ]; then
    echo "[font-fit] manifest の face に空フィールドがある: $pkg/$out_rel" >&2
    exit 1
  fi

  if [ -n "$only_pkg" ] && [ "$pkg" != "$only_pkg" ]; then continue; fi
  if [ -n "$only_face" ] && [ "$out_rel" != "$only_face" ]; then continue; fi

  # 解決後の値をここで検査する（上書きが効くなら上書きの値を）。相 1 でやるのは
  # srcSha256 と同じ理由——不正な倍率が face #3 にあるとき #1/#2 を書かせない。
  assert_fit_ratio "${fit_ratio_override:-$face_ratio}" "manifest / $pkg"
  assert_vstretch "${vstretch_override:-$face_vstretch}" "manifest / $pkg"

  src="$src_dir/$src_entry"
  if [ ! -f "$src" ]; then
    echo "[font-fit] 上流エントリが --src-dir に無い: $src_entry" >&2
    exit 1
  fi
  actual="$(sha256sum "$src" | cut -d' ' -f1)"
  if [ "$actual" != "$src_sha" ]; then
    # 取り違えは 1 バイトも書く前にここで落ちる（設計 #271 R5「入力の扱い」）。
    echo "[font-fit] srcSha256 不一致: $src_entry" >&2
    echo "  manifest: $src_sha" >&2
    echo "  実測    : $actual" >&2
    exit 1
  fi

  dst="$out_dir/$pkg/$out_rel"
  if [ -L "$dst" ]; then
    echo "[font-fit] 出力先が symlink（追従して外へ書かない）: $dst" >&2
    exit 1
  fi
  selected=$((selected + 1))
done < "$faces"

if [ "$seen" -ne "$declared_faces" ]; then
  echo "[font-fit] manifest の face 数と読めた行数が食い違う（宣言 $declared_faces / 読めた $seen）" >&2
  echo "  face が黙って落ちる形の manifest 破損（改行や区切り文字の混入）。" >&2
  echo "  面数が少ないまま成功させない: $manifest" >&2
  exit 1
fi

if [ "$selected" -eq 0 ]; then
  echo "[font-fit] 変換対象が 0 件（--only / --face の指定を確認）" >&2
  exit 1
fi

# --- 幅表を毎回生成（scratch・コミットしない）------------------------------
widths="$work_dir/widths.json"
node "$here/dump-widths.mjs" "$widths"
echo

# --- 相 2: 変換する -------------------------------------------------------
results="$work_dir/checksums.tsv"
: > "$results"
converted=0

while IFS="$US" read -r pkg family src_entry src_sha inst_wght out_rel style face_ratio face_vstretch; do
  # $faces を読み直すので、パス片の構造検査も相 2 でやり直す（純粋な文字列比較なので
  # コストはゼロに近い）。相 1 と相 2 の間に $faces を差し替えられると pkg="../../.."
  # で $out_dir の外へ書けるが、これを止めるのは **この再検査だけ**——下の
  # [ -L "$dst" ] は symlink しか見ず、traversal は覆わない（別の性質の検査である）。
  reject_unsafe_path package "$pkg"
  reject_unsafe_path srcEntry "$src_entry"
  reject_unsafe_path out "$out_rel"

  if [ -n "$only_pkg" ] && [ "$pkg" != "$only_pkg" ]; then continue; fi
  if [ -n "$only_face" ] && [ "$out_rel" != "$only_face" ]; then continue; fi

  ratio="${fit_ratio_override:-$face_ratio}"
  assert_fit_ratio "$ratio" "manifest / $pkg"
  vstretch="${vstretch_override:-$face_vstretch}"
  assert_vstretch "$vstretch" "manifest / $pkg"

  src="$src_dir/$src_entry"
  dst="$out_dir/$pkg/$out_rel"

  conv_src="$src"
  if [ "$inst_wght" != "null" ] && [ -n "$inst_wght" ]; then
    # 可変フォントは先に静的化する。順序は固定——輪郭を変えてからでは
    # gvar のデルタが壊れる（設計 #271 R6・#262 で実証）。
    conv_src="$work_dir/$(basename "$out_rel" .ttf)-instance-$inst_wght.ttf"
    "$FONTTOOLS_PY" "$here/instance.py" "$src" "$conv_src" "$inst_wght"
  fi

  # 同梱先へ直接 save させない: 保存中の中断（Ctrl-C・ディスクフル・fonttools の
  # 例外）で切り詰められた TTF が同梱先に残る。work_dir で作り、契約①② を通って
  # から同ディレクトリ内の rename で置く。
  staged="$work_dir/staged-$(basename "$out_rel")"
  "$FONTTOOLS_PY" "$here/fit.py" "$widths" "$conv_src" "$staged" "$family" "$style" \
    "$ratio" "$vstretch"
  # 変換時ゲート: 契約①②③ を上流（= fit.py が実際に読んだファイル）と突き合わせて
  # 全数検証する。1 件でも違反があれば非 0 で終わり、set -e でここが最後になる。
  # fitRatio / vstretch は fit.py に渡したのと **同じ値**を渡す: 契約①③ は
  # 「宣言値に対して締める」ので、検査側だけ緩い値を渡すと赤経路が消える
  # （#270 の欠陥の再来）。
  "$FONTTOOLS_PY" "$here/verify.py" "$conv_src" "$staged" "$widths" "$ratio" "$vstretch"
  mkdir -p "$(dirname "$dst")"
  # symlink について、何が保証され何が保証されないかを先に言う:
  #
  #   保証する — 実行開始前（正確にはこの face の順番が来る前）に仕込まれた
  #     $dst.new の symlink は追従しない。rm -f が先に潰す。バイトが $out_dir の
  #     外へ出る経路は cp の宛先だけで、それがこの 1 行の対象。
  #   保証しない — rm -f と cp の間の窓。出力ディレクトリに書ける者はそこで
  #     symlink を作り直せ、cp は宛先 symlink を追従する（cp に O_NOFOLLOW 相当は
  #     無い）。**この窓はコマンドの並べ替えでは閉じられない**——保証の出どころは
  #     出力ディレクトリのパーミッションであって rm -f ではない。rm -f が上げるのは
  #     難度であって不可能性ではない。
  #
  # 下の $dst の symlink 再検査は**脱出経路を 1 つも閉じていない**: mv は宛先 symlink
  # を追従せず（rename(2) はリンク自体を置き換える・実測）、$dst が symlink であること
  # 自体は脱出経路ではない。残す理由は「利用者が置いた symlink を黙って潰さない」と
  # いう方針の一貫性であって、防御ではない。
  if [ -L "$dst" ]; then
    echo "[font-fit] 出力先が symlink（追従して外へ書かない）: $dst" >&2
    exit 1
  fi
  rm -f "$dst.new"
  cp "$staged" "$dst.new"
  mv "$dst.new" "$dst"
  echo

  printf '%s\t%s\t%s\t%s\n' "$pkg/$out_rel" "$(sha256sum "$dst" | cut -d' ' -f1)" \
    "$ratio" "$vstretch" >> "$results"
  converted=$((converted + 1))
done < "$faces"

# --- checksums.json（コミットする側）--------------------------------------
if [ "$placing_in_repo" -eq 1 ]; then
  checksums="$here/checksums.json"
else
  checksums="$out_dir/checksums.json"
fi

# 一時ファイルへ書いてから mv する。`> "$checksums"` を直接使うと、リポ配置のときは
# --slurpfile の読み先と同一ファイルで、bash が jq 起動**前**に truncate するため
# $old が [] になり note が黙って null に潰れた（しかも jq が失敗すると空ファイルが
# バックアップなしで残った）。note は widths.json と checksums.json の扱いが正反対で
# ある理由を書いた唯一の場所なので、読み終わってから置き換える。
#
# 一時ファイルは **$checksums と同じディレクトリ**に置く。work_dir 側に置くと mv が
# FS を跨ぎ（既定の work_dir は tmpfs・リポは別 FS）、rename ではなくコピーに退化して
# アトミック性が消える。TTF 側（上の cp + mv）と同じ形にそろえる。
new_checksums="$checksums.new"
rm -f "$new_checksums"
if ! jq -n --rawfile tsv "$results" --slurpfile old "$here/checksums.json" '
  ($tsv | split("\n") | map(select(length > 0) | split("\t"))
        | map({(.[0]): { sha256: .[1], fitRatio: (.[2] | tonumber),
                         vstretch: (.[3] | tonumber) }}) | add) as $outputs
  | { note: $old[0].note, outputs: ($outputs // {}) }
  | if .note == null then error("checksums.json の note を読めなかった（既存の note を落としかけた）") else . end
' > "$new_checksums"; then
  # 失敗した .new を残さない（既存の checksums.json は無傷のまま）。
  rm -f "$new_checksums"
  echo "[font-fit] checksums.json を書けなかった（既存の記録は触っていない）" >&2
  exit 1
fi
mv "$new_checksums" "$checksums"

echo "[font-fit] $converted 面を変換し、sha256 を $checksums へ記録した"
