#!/usr/bin/env bash
# Install the reference scripts in claude/ into ~/.claude — the same "build here,
# install locally" flow the VSIX already has (`npm run vsix && code
# --install-extension …`), which is the one thing the distributed scripts lacked.
#
# claude/ is the single source of truth; ~/.claude/*.sh is a *derived* copy. The
# divergence this repo suffered (#76) was not caused by carelessness — it was the
# symptom of having no installer at all, so the only way to change the live
# scripts was to hand-edit them. Edit claude/ and re-run this; don't edit the
# installed copies.
#
# What it deliberately does NOT do: touch ~/.claude/settings.json. It prints the
# snippet to paste instead. Settings edits are irreversible in a file that holds
# unrelated config (enabledPlugins, other people's hooks), and no install is
# worth that risk.
#
# The one safety claim this script makes is "everything it overwrites is backed
# up first". Every refusal below exists to keep that claim true — a destination
# it cannot back up faithfully is a destination it does not write.
set -euo pipefail

usage() {
  cat <<'USAGE'
Install the reference scripts in claude/ into ~/.claude.

  npm run claude:install              # install from this clone (backs up first)
  npm run claude:install -- --dry-run # print the plan, write nothing
  npm run claude:install -- --force   # proceed despite a refusal (see below)
  npm run claude:install -- --help

Remote source (install WITHOUT a clone — e.g. a Marketplace install):

  bash install-claude.sh --src gh:OWNER/REPO/claude   # fetch via `gh api` (auth)
  bash install-claude.sh --src https://…/claude       # fetch via curl (public)
  bash install-claude.sh --src /path/to/claude        # copy from a local path
  TMUX_OPENER_CLAUDE_SRC=gh:OWNER/REPO/claude bash install-claude.sh

With a gh:/http(s) --src the scripts are fetched into a temporary directory and
installed from there; every safety check below still applies, and --dry-run still
writes nothing to ~/.claude (it may still fetch). `gh:` needs the `gh` CLI
authenticated; set TMUX_OPENER_CLAUDE_GH_REF to pick a branch/tag (default: the
repo's default branch).

Note the `--`: npm swallows flags that come before it and they never reach here.

Refusals (--force overrides; --dry-run always prints the plan):
  * a legacy flat layout in ~/.claude (hooks alongside statusline.sh)
  * a destination file that is a symlink (its target lives outside ~/.claude)

~/.claude/settings.json is never modified — the snippet to paste is printed.
USAGE
}

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

# The source of the scripts. Default: this clone's claude/ (the repository is the
# source of truth — unchanged). Override with --src or TMUX_OPENER_CLAUDE_SRC to
# install WITHOUT a clone. The scheme set mirrors shirokuma-flow install-cli.sh's
# fetch layer, and only that layer (no manifest->tarball->npm — claude/ is plain
# shell scripts, not a package):
#   gh:OWNER/REPO/SUBPATH  each file via `gh api` contents (raw), authenticated
#   http(s)://…/claude     each file via curl (a public raw content root)
#   /path or ./path        a local directory, used in place (no fetch)
# A gh:/http(s) source is fetched into a mktemp staging dir which then becomes the
# install source, so the entire safety machinery below runs against it unchanged.
source_spec="${TMUX_OPENER_CLAUDE_SRC:-$repo_root/claude}"
gh_ref="${TMUX_OPENER_CLAUDE_GH_REF:-}"

# Resolved from $HOME, never hardcoded: that is what lets the legacy-flat and
# dry-run paths be exercised against a throwaway HOME instead of a real one.
# `set -u` catches an *unset* HOME but not an empty one, and an empty one would
# silently aim the whole install at /.claude (which root would happily create).
[ -n "${HOME:-}" ] || { echo "install-claude: HOME is empty or unset" >&2; exit 1; }
dest="$HOME/.claude"

dry_run=0
force=0
# `while [ $# -gt 0 ]` rather than `for arg in "$@"`: bash 3.2 — still /bin/bash
# on macOS, a supported host — errors on the empty expansion of "$@" under
# `set -u`, and the default invocation (`npm run claude:install`) passes no
# arguments at all. `$#` is always set, so this idiom cannot hit that bug.
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --force)   force=1 ;;
    --src)
      shift
      [ $# -gt 0 ] || { echo "install-claude: --src needs an argument" >&2; exit 2; }
      source_spec="$1"
      ;;
    --src=*) source_spec="${1#--src=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "install-claude: unknown option: $1" >&2
      echo "usage: npm run claude:install -- [--dry-run] [--force]" >&2
      exit 2
      ;;
  esac
  shift
done

# "${*:-}" rather than "$*" for the same bash 3.2 reason as the argument loop
# above: an unguarded "$*" with no arguments is an unbound expansion under
# `set -u`. Every call site passes one argument today; this keeps a future bare
# `say` from breaking the install on macOS only.
say() { printf '%s\n' "${*:-}"; }

# Emit a manifest's real entries (drop '#' comments and blank lines). grep -v
# exits 1 when it selects nothing — an all-comment or empty manifest — and that is
# NOT an error here: the empty result must flow to the caller's friendly "needs
# claude/manifest.txt" guard, not abort the whole install under `set -e`/pipefail.
# Only a real grep error (exit >= 2) fails the pipeline.
strip_manifest() { # strip_manifest <file>
  { grep -v '^[[:space:]]*#' "$1" || [ "$?" -eq 1 ]; } | sed '/^[[:space:]]*$/d'
}

# Refuse any fetched relative path that could escape the staging dir *before* it
# is used to build an mkdir/curl/gh target. Manifest lines (http[s]) and contents-
# API names (gh) are untrusted network data; the $dest safety machinery further
# below guards only the $src->$dest copy, never this network->$stage write, so
# containment is enforced here. fail-closed: an empty path, a leading '/'
# (absolute), or any '..' path component is refused outright. Applied on both the
# gh: and url: paths (the gh .name is a single component so traversal is already
# hard there, but defense-in-depth runs both through it).
reject_unsafe_rel() { # reject_unsafe_rel <rel>
  local rel="$1" _oldifs _comp
  case "$rel" in
    "") echo "install-claude: refusing an empty path from $source_spec" >&2; exit 1 ;;
    /*) echo "install-claude: refusing an absolute path from $source_spec: $rel" >&2; exit 1 ;;
  esac
  _oldifs=$IFS; IFS=/; set -f
  for _comp in $rel; do
    if [ "$_comp" = ".." ]; then
      IFS=$_oldifs; set +f
      echo "install-claude: refusing a path with a '..' component from $source_spec: $rel" >&2
      exit 1
    fi
  done
  IFS=$_oldifs; set +f
}

# --- remote source: fetch layer (borrowed from install-cli.sh; only this layer)-
# When source_spec is gh:/http(s), fetch each *.sh into a staging dir and make
# that dir the install source; a local path is used in place. Either way the
# scripts keep their relative layout (statusline.sh at the root, hooks/*.sh under
# hooks/), so the gate<->bell adjacency invariant holds exactly as from a clone.
is_gh()  { case "$1" in gh:*) return 0 ;; *) return 1 ;; esac; }
# https only: a non-TLS http:// source can be rewritten in flight by a man in the
# middle, and the swapped .sh is then chmod 755'd and wired into hooks = RCE. So
# http:// is not matched here and is refused outright before the fetch dispatch
# below; only TLS-protected https:// is accepted.
is_url() { case "$1" in https://*) return 0 ;; *) return 1 ;; esac; }

fetch() { # fetch <rel> <dest-file>
  local rel="$1" dest="$2" full api
  if is_gh "$source_spec"; then
    full="${gh_subpath:+$gh_subpath/}$rel"
    api="repos/$gh_owner_repo/contents/$full"
    [ -n "$gh_ref" ] && api="$api?ref=$gh_ref"
    gh api "$api" -H "Accept: application/vnd.github.raw" > "$dest"
  elif is_url "$source_spec"; then
    # --proto/--proto-redir '=https' pin every request, including redirect hops,
    # to https so a 3xx cannot downgrade the transfer to plaintext http.
    curl -fsSL --proto '=https' --proto-redir '=https' "${source_spec%/}/$rel" -o "$dest"
  else
    cp "${source_spec%/}/$rel" "$dest"
  fi
}

# gh: enumerates *.sh live via the contents API (recursively), so a *.sh added to
# claude/ is picked up with no manifest to maintain — the same reason the clone
# path uses find: the source of truth lists itself.
# fail-closed enumeration: a `done < <(gh api …)` process substitution hides the
# gh api exit status from `set -e`/pipefail, so a mid-recursion failure (network
# blip, rate limit, a 404 subdir) would return a *partial* set silently — and a
# partial set is a split statusline/hooks install, which the "they always move
# together" invariant forbids ([ -z "$rels" ] only catches a totally empty one).
# So each level captures gh api into a temp file under $stage (swept by the EXIT
# trap) and aborts the whole enumeration on failure instead of reading it through
# a process substitution. This also fixes the misleading "no *.sh scripts found"
# a swallowed gh failure used to print.
_gh_walk() {
  local dir="$1" prefix="$2" q="" type name _tmp
  [ -n "$gh_ref" ] && q="?ref=$gh_ref"
  _tmp="$(mktemp "$stage/.ghwalk.XXXXXX")"
  if ! gh api "repos/$gh_owner_repo/contents/$dir$q" --jq '.[] | "\(.type)\t\(.name)"' > "$_tmp"; then
    echo "install-claude: gh api enumeration failed at contents/$dir (network, rate limit, or auth?)." >&2
    echo "  Refusing to install a partial script set; re-run once gh api is reachable." >&2
    exit 1
  fi
  while IFS=$'\t' read -r type name; do
    [ -n "$type" ] || continue
    case "$type" in
      file) case "$name" in *.sh) printf '%s%s\n' "$prefix" "$name" ;; esac ;;
      dir)  _gh_walk "$dir/$name" "$prefix$name/" ;;
    esac
  done < "$_tmp"
}
gh_enumerate() { _gh_walk "$gh_subpath" ""; }

# A plain http(s) content root cannot list a directory, so that path reads the
# committed claude/manifest.txt (one relative path per line, # comments allowed)
# for the *.sh set. Keep it in sync when adding a *.sh to claude/ — the clone
# install warns below if it drifts.
url_read_manifest() { # url_read_manifest <manifest-file>
  fetch "manifest.txt" "$1"
  strip_manifest "$1"
}

# A non-TLS http:// source is refused outright (see is_url): with http:// no
# longer matched by is_url or is_gh it would otherwise fall through to the local-
# path branch and fail with a confusing "no such directory", so name the real
# reason. Local paths and gh: are unaffected (no TLS involved).
case "$source_spec" in
  http://*)
    echo "install-claude: refusing a non-TLS http:// source (man-in-the-middle risk)." >&2
    echo "  Use https:// (or a gh: source, or a local path)." >&2
    exit 1
    ;;
esac

if is_gh "$source_spec" || is_url "$source_spec"; then
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  # Resolve $stage once for the containment check in the fetch loop below; mktemp
  # -d can hand back a path through a symlink (e.g. /tmp -> /private/tmp on macOS),
  # so compare against the resolved form, exactly as the $dest check does.
  stage_real="$(cd "$stage" && pwd -P)"
  if is_gh "$source_spec"; then
    command -v gh >/dev/null 2>&1 || { echo "install-claude: a gh: source needs the gh CLI on PATH" >&2; exit 1; }
    _spec="${source_spec#gh:}"
    gh_owner_repo="$(printf '%s' "$_spec" | cut -d/ -f1-2)"
    gh_subpath="$(printf '%s' "$_spec" | cut -d/ -f3-)"
    [ -n "$gh_subpath" ] || { echo "install-claude: a gh: source must be gh:OWNER/REPO/SUBPATH" >&2; exit 1; }
    gh api "repos/$gh_owner_repo" >/dev/null 2>&1 || {
      echo "install-claude: cannot reach repos/$gh_owner_repo via gh api (is gh authenticated and the repo accessible?)" >&2
      exit 1
    }
    say "Fetching scripts from $source_spec via gh api into a staging dir..."
    # gh_enumerate runs in a command substitution, so _gh_walk's fail-closed
    # `exit 1` exits that subshell; propagate it here rather than continuing with a
    # partial (or empty) set.
    rels="$(gh_enumerate)" || exit 1
  else
    command -v curl >/dev/null 2>&1 || { echo "install-claude: an http(s): source needs curl on PATH" >&2; exit 1; }
    say "Fetching scripts from ${source_spec%/} via curl into a staging dir..."
    rels="$(url_read_manifest "$stage/.manifest.txt")"
  fi
  if [ -z "$rels" ]; then
    echo "install-claude: no *.sh scripts found at $source_spec" >&2
    is_url "$source_spec" && echo "  (an http(s) source needs claude/manifest.txt beside the scripts)" >&2
    exit 1
  fi
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    # $rel is untrusted network data (a manifest line or a contents-API name) —
    # validate before it builds any filesystem target. reject_unsafe_rel bars an
    # absolute path and any '..' component, so the mkdir/fetch below cannot leave
    # $stage.
    reject_unsafe_rel "$rel"
    mkdir -p "$stage/$(dirname "$rel")"
    # Belt-and-suspenders (matching the $dest containment check below): the just-
    # created parent must resolve back inside $stage. reject_unsafe_rel already
    # bars the escapes that reach here, so this only fires on something exotic, but
    # it keeps "nothing is written outside the staging dir" true by construction.
    _reldir="$(dirname "$rel")"
    if _parent_real="$(cd "$stage" && cd "$_reldir" 2>/dev/null && pwd -P)"; then
      case "$_parent_real/" in
        "$stage_real"/*) ;;
        *) echo "install-claude: refusing a path that escapes the staging dir: $rel" >&2; exit 1 ;;
      esac
    else
      echo "install-claude: cannot resolve a staging path for: $rel" >&2
      exit 1
    fi
    fetch "$rel" "$stage/$rel"
  done <<EOF
$rels
EOF
  src="$stage"
  say ""
else
  src="$source_spec"
fi

[ -d "$src" ] || { echo "install-claude: no such directory: $src" >&2; exit 1; }

# Relative paths of everything to install, so adding a *.sh to claude/ needs no
# edit here. `find` (POSIX) rather than `install -D` or `cp --parents`, both GNU-
# only: macOS is a supported host. Note the list is deliberately `-name '*.sh'`;
# anything else in claude/ is not installed.
#
# Read into an array with `IFS= read -r`, never `for rel in $files`: an unquoted
# expansion word-splits on spaces and glob-expands `[`, so one file named
# `foo bar.sh` would turn into two entries whose `cp` fails — under `set -e`,
# *after* the backup ran and some of the files were already written. The worst
# possible place to abort a destructive operation is halfway through it.
files=()
while IFS= read -r rel; do
  [ -n "$rel" ] && files+=("$rel")
done <<EOF
$(cd "$src" && find . -type f -name '*.sh' | sed 's|^\./||' | LC_ALL=C sort)
EOF

[ "${#files[@]}" -gt 0 ] || { echo "install-claude: no scripts found under $src" >&2; exit 1; }

# The one case the array still cannot express is a newline inside a file name,
# which would have split into two entries above. Prove every entry really exists
# before anything destructive happens, so such a name fails closed here rather
# than mid-copy.
for rel in "${files[@]}"; do
  [ -f "$src/$rel" ] || {
    echo "install-claude: not a regular file (a newline in the name?): $src/$rel" >&2
    exit 1
  }
done

# Advisory: the http(s) remote install path reads claude/manifest.txt (a plain
# content root cannot list a directory) while clone (find) and gh: (contents API)
# enumerate live. Warn if the live *.sh set here has drifted from the manifest,
# so adding a *.sh to claude/ does not silently leave the URL install behind. This
# only fires from a clone (where a developer adds files); it never blocks.
if [ -f "$src/manifest.txt" ]; then
  live_set="$(printf '%s\n' "${files[@]}" | LC_ALL=C sort)"
  manifest_set="$(strip_manifest "$src/manifest.txt" | LC_ALL=C sort)"
  if [ "$live_set" != "$manifest_set" ]; then
    say "WARNING: claude/manifest.txt is out of sync with the *.sh files in $src."
    say "  The http(s) remote install reads that manifest; update it to match."
    say ""
  fi
fi

# `blocked` collects the reasons this install should not proceed silently. They
# are all reported, then resolved in one place: --force overrides, --dry-run
# prints the plan anyway (it writes nothing), a plain run refuses.
blocked=0

# --- (4) legacy flat layout: stop, don't warn-and-continue ---------------------
# The old README told users to drop all four scripts directly in ~/.claude. If we
# installed over that, statusline.sh (same path in both layouts) would be
# overwritten with the new version while the three hooks would be *created* in
# ~/.claude/hooks/ — and settings.json would still point at the stale flat copies.
# The result is a split install: new statusline reading the marker set an old gate
# writes. That is a silent, version-skewed wrong answer, so it must not happen by
# default. Refuse, explain, and let --force override deliberately.
legacy=()
for name in session-state.sh subagent-idle-gate.sh tmux-opener-bell.sh; do
  { [ -e "$dest/$name" ] || [ -L "$dest/$name" ]; } && legacy+=("$name")
done

if [ "${#legacy[@]}" -gt 0 ]; then
  blocked=1
  say "WARNING: a legacy flat layout was found in $dest:"
  for name in "${legacy[@]}"; do say "  $dest/$name"; done
  say ""
  say "Installing on top of it would upgrade statusline.sh but leave settings.json"
  say "pointing at these old hook copies — a split install where a new statusline"
  say "reads the markers an old gate writes. Migrate in this order:"
  say ""
  say "  1. Install first, so the new layout exists before anything points at it:"
  say "       npm run claude:install -- --force"
  say "  2. Point the hooks in $dest/settings.json at the hooks/ layout:"
  say "       ~/.claude/session-state.sh       ->  ~/.claude/hooks/session-state.sh"
  say "       ~/.claude/subagent-idle-gate.sh  ->  ~/.claude/hooks/subagent-idle-gate.sh"
  say "       ~/.claude/tmux-opener-bell.sh    ->  ~/.claude/hooks/tmux-opener-bell.sh"
  say "  3. Delete the old flat copies:"
  for name in "${legacy[@]}"; do say "       rm $dest/$name"; done
  say ""
  say "Repointing settings.json before step 1 would leave it aiming at hooks that do"
  say "not exist yet, and every hook would silently fail until the install landed."
  say ""
fi

# --- (5) symlinked destinations: refuse, because the backup cannot be honest ---
# A destination that is a symlink (a dotfiles repo managing ~/.claude/statusline.sh
# is a perfectly legitimate reason for one) breaks the backup contract in both
# directions:
#   * `cp -a` copies the *link*, not the file it points at, so the backup preserves
#     nothing — and the original it was supposed to protect is precisely what the
#     next step destroys.
#   * `cp src dest` and `chmod` both *follow* the link, so the write lands on the
#     target — outside ~/.claude entirely, wherever that target happens to live.
# Together those turn an installer into a silent overwrite of an unrelated file
# with no way back. So: refuse and explain, exactly as with a legacy layout. With
# --force the link is backed up by *content* (cp -p follows it) and then removed
# before the copy, so the write can no longer escape $dest.
links=()
for rel in "${files[@]}"; do
  [ -L "$dest/$rel" ] && links+=("$rel")
done

# --- (5b) escaping path elements: refuse, --force does NOT override ------------
# The links[] loop above lstats only the *final* component (`test -L` never
# follows the leaf), so it misses a symlinked *intermediate directory* such as
# ~/.claude/hooks -> somewhere-outside. mkdir -p and cp both follow that link,
# so the install of hooks/*.sh would land outside $dest — the exact escape the
# leaf check was meant to stop, one level up (#83 M2). Detect it two ways:
#
#   (a) walk each intermediate directory component and flag a symlink. This also
#       catches a *dangling* one, which resolves to nothing yet mkdir -p would
#       still follow out of $dest.
#   (b) belt-and-suspenders: resolve the parent directory as it exists today
#       (`pwd -P`, POSIX — no GNU `realpath`, which macOS may lack) and refuse
#       any that lands outside $dest. This also catches a `..` in a path even
#       though find never emits one.
#
# Unlike a symlinked *file*, an escaping element is refused even with --force:
# neutralizing a leaf symlink means unlinking one file and writing a fresh one
# in its place, but "neutralizing" a symlinked directory would mean tearing down
# the directory-level symlink a user deliberately created (a dotfiles-managed
# ~/.claude/hooks is a legitimate reason to have one) and orphaning whatever else
# lives under it. That is a categorically more destructive act than replacing one
# file, so the safe and honest answer is to refuse and let the user resolve it —
# which keeps "nothing is written outside $dest" true by construction.
dir_component_is_symlink() {
  _rel_dir=$(dirname "$1")
  [ "$_rel_dir" = "." ] && return 1
  _prefix=""
  _oldifs=$IFS
  IFS=/
  set -f
  for _comp in $_rel_dir; do
    _prefix="${_prefix:+$_prefix/}$_comp"
    if [ -L "$dest/$_prefix" ]; then
      IFS=$_oldifs; set +f
      return 0
    fi
  done
  IFS=$_oldifs; set +f
  return 1
}

escapes=()
if [ -d "$dest" ]; then
  dest_real=$(cd "$dest" && pwd -P)
  for rel in "${files[@]}"; do
    if dir_component_is_symlink "$rel"; then
      escapes+=("$rel")
      continue
    fi
    reldir=$(dirname "$rel")
    # A non-existent parent dir makes this `cd` fail; that is fine — mkdir -p will
    # create it *inside* $dest with no symlink to follow, so it cannot escape.
    if parent_real=$(cd "$dest" && cd "$reldir" 2>/dev/null && pwd -P); then
      # The quoted "$dest_real" is a literal in the pattern; only the trailing /*
      # is a glob, and that trailing slash stops a sibling like ".claude-evil"
      # from matching.
      case "$parent_real/" in
        "$dest_real"/*) ;;
        *) escapes+=("$rel") ;;
      esac
    fi
  done
fi

if [ "${#links[@]}" -gt 0 ]; then
  blocked=1
  say "WARNING: these destinations are symlinks, not regular files:"
  for rel in "${links[@]}"; do
    target=$(readlink "$dest/$rel" 2>/dev/null || true)
    say "  $dest/$rel  ->  ${target:-?}"
  done
  say ""
  say "Copying onto a symlink writes through it: the file that would be overwritten"
  say "is the target above, which lives outside $dest, and a plain backup of a link"
  say "saves the link rather than its contents — so the overwritten original could"
  say "not be restored. If you manage these files from a dotfiles repository, edit"
  say "them there (or point the links at claude/ in this repository) instead."
  say ""
  say "With --force each link is replaced by a regular file: its current *contents*"
  say "are backed up first, the link itself is then removed, and nothing is"
  say "written outside $dest."
  say ""
fi

# An escaping path element is handled before the shared blocked/--force logic
# below, because --force must NOT override it — the write would land outside
# $dest and no backup could make that honest.
if [ "${#escapes[@]}" -gt 0 ]; then
  say "WARNING: these destinations resolve to a path outside $dest:"
  for rel in "${escapes[@]}"; do
    reldir=$(dirname "$rel")
    resolved=$(cd "$dest" && cd "$reldir" 2>/dev/null && pwd -P || true)
    say "  $dest/$rel  ->  ${resolved:-<dangling symlink>}/$(basename "$rel")"
  done
  say ""
  say "A directory component of these paths is a symlink pointing outside $dest"
  say "(a dotfiles-managed ~/.claude/hooks is the usual reason). mkdir -p and cp"
  say "would follow it and write outside $dest — breaking this installer's one"
  say "invariant, that nothing is written outside $dest. Point the symlink inside"
  say "$dest, or edit the files where the symlink leads, and re-run."
  say ""
  if [ "$dry_run" -eq 1 ]; then
    say "--dry-run: printing the plan anyway — nothing is written either way."
    say "A real install would refuse this even with --force: unlike a symlinked"
    say "file, an escaping directory symlink cannot be neutralized without tearing"
    say "down the symlink you created, so it is refused rather than overridden."
    say ""
  else
    say "Refusing to install. --force does not override this, on purpose."
    exit 1
  fi
fi

if [ "$blocked" -eq 1 ]; then
  if [ "$force" -eq 1 ]; then
    say "--force given: continuing anyway."
    say ""
  elif [ "$dry_run" -eq 1 ]; then
    # A dry run writes nothing, so there is nothing to protect the user from —
    # and the plan is exactly what someone deciding whether to migrate (or to
    # pass --force) needs to see. Refusing to print it would leave them choosing
    # blind.
    say "--dry-run: printing the plan anyway — nothing is written either way."
    say "A real install would refuse until the above is resolved, or use --force."
    say ""
  else
    say "Refusing to install. Re-run with --force to install anyway"
    say "(npm run claude:install -- --force), or with --dry-run to see the plan."
    exit 1
  fi
fi

# --- (6) stale detection -------------------------------------------------------
# Not "diffing two sources of truth" — there is only one. This answers a single
# question: is the installed derivative out of date? It can only speak when the
# installer runs, which is exactly why it doesn't try to be a divergence check.
stale=0
say "Source:      $src"
say "Destination: $dest"
say ""
for rel in "${files[@]}"; do
  if [ ! -e "$dest/$rel" ]; then
    say "  new       $rel"
  elif cmp -s "$src/$rel" "$dest/$rel"; then
    say "  unchanged $rel"
  else
    stale=1
    say "  OUT OF DATE $rel — the installed copy differs from claude/$rel:"
    diff -u "$dest/$rel" "$src/$rel" 2>/dev/null | sed -n '3,12p' | sed 's/^/      /' || true
  fi
done
say ""
if [ "$stale" -eq 1 ]; then
  say "The installed scripts are out of date. Re-installing brings them back in"
  say "sync with the repository (the copies being replaced are backed up first)."
  say ""
fi

# --- (1) backup ----------------------------------------------------------------
# Every file about to be overwritten is copied aside first. This is the step that
# would have saved the live-only statusline features in #76 had anyone ever
# overwritten them, so it runs before a single byte is written.
#
# `cp -p`, not `cp -a`: a plain (non-recursive) cp *follows* a symlink on both GNU
# and BSD, so the backup holds the file's contents, and -p carries its mode and
# timestamps across. `-a` implies `-d`/`-P` — it would archive the link itself,
# i.e. a backup that restores nothing, which is the bug this whole block exists
# to close. A dangling link has no contents to save, so `-e` excludes it here;
# the install loop below unlinks it either way.
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$dest/backup-$stamp"
to_backup=()
for rel in "${files[@]}"; do
  [ -e "$dest/$rel" ] && to_backup+=("$rel")
done

if [ "$dry_run" -eq 1 ]; then
  say "--dry-run: nothing will be written."
  if [ "${#to_backup[@]}" -gt 0 ]; then
    say ""
    say "Would back up (cp -p, following any symlink to its contents) into $backup/:"
    for rel in "${to_backup[@]}"; do say "  $dest/$rel  ->  $backup/$rel"; done
  fi
  if [ "${#links[@]}" -gt 0 ]; then
    say ""
    say "Would remove these symlinks and write regular files in their place:"
    for rel in "${links[@]}"; do say "  $dest/$rel"; done
  fi
  say ""
  say "Would install:"
  for rel in "${files[@]}"; do say "  $src/$rel  ->  $dest/$rel  (chmod 755)"; done
  say ""
else
  if [ "${#to_backup[@]}" -gt 0 ]; then
    for rel in "${to_backup[@]}"; do
      mkdir -p "$backup/$(dirname "$rel")"
      cp -p "$dest/$rel" "$backup/$rel"
    done
    say "Backed up the copies being replaced to:"
    say "  $backup/"
    say ""
  fi

  # --- (2) copy and make executable --------------------------------------------
  # `rm -f` before `cp`: a `cp` onto an existing symlink follows it and writes the
  # target, and the following `chmod` would follow it too. Unlinking first means
  # the copy always creates a fresh regular file inside $dest, so neither the
  # write nor the mode change can reach outside it. (For a plain file the `rm -f`
  # is a no-op in effect — `cp` would have truncated it anyway.)
  for rel in "${files[@]}"; do
    mkdir -p "$dest/$(dirname "$rel")"
    rm -f "$dest/$rel"
    cp "$src/$rel" "$dest/$rel"
    chmod 755 "$dest/$rel"
    say "  installed $dest/$rel"
  done
  say ""
fi

# --- (3) settings.json: print, never write -------------------------------------
say "$dest/settings.json is NOT modified by this installer. If you haven't wired"
say "these scripts up yet, paste the parts you want (all of it is opt-in):"
cat <<'SNIPPET'

  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "refreshInterval": 1
  },
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "~/.claude/hooks/session-state.sh running" } ] },
      { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh reset" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "~/.claude/hooks/session-state.sh stopped" } ] },
      { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh main-stop" } ] }
    ],
    "PreToolUse": [
      {
        "matcher": "Agent",
        "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh pending" } ]
      }
    ],
    "SubagentStart": [
      { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh start" } ] }
    ],
    "SubagentStop": [
      { "hooks": [ { "type": "command", "command": "~/.claude/hooks/subagent-idle-gate.sh stop" } ] }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt|agent_needs_input|elicitation_dialog",
        "hooks": [ { "type": "command", "command": "~/.claude/hooks/tmux-opener-bell.sh ask" } ]
      }
    ]
  }

SNIPPET
say "With the gate wired as above, Stop must call subagent-idle-gate.sh main-stop"
say "and NOT tmux-opener-bell.sh stop — the gate rings the bell itself, once the"
say "session is truly idle. Requires jq on your PATH."
say ""
say "The Notification matcher is load-bearing, and so is what it leaves out (#108):"
say "a Notification hook with NO matcher fires on all eight notification types, so"
say "auth_success, an MCP elicitation_complete and an agent_completed each rang the"
say "\"waiting for your input\" bell. The three above are the ones that actually wait"
say "on a human. Do NOT add idle_prompt (or agent_completed) to it, tempting as it"
say "looks: that is the session going idle, and the idle bell already has exactly"
say "one owner — Stop -> subagent-idle-gate.sh main-stop, which holds it back while"
say "a subagent is still running. A second, ungated bell for the same event is #75"
say "all over again."
say ""
# The other BEL source, and the one the snippet above cannot see (#109). The bell
# hooks *replace* Claude Code's built-in bell rather than adding to it: with
# preferredNotifChannel left at "terminal_bell", Claude Code keeps ringing the
# bell itself, bypassing the gate entirely and notifying while subagents are
# still running — the very regression the gate exists to prevent. Kept as its own
# paragraph, outside the snippet, because it is a settings key the user edits, not
# a hook we can print into the JSON above.
#
# The condition is *which parts of the snippet were pasted*, not whether these
# scripts are installed. The snippet is opt-in piecewise, and the statusline half
# rings no bell at all — it only appends context%/cost to the notification. Telling
# a statusline-only user to switch "terminal_bell" off would leave nothing ringing
# (README: only the statusline bridge is a true *addition*; the bell hooks are a
# *replacement*). So key the advice on the bell wiring.
say "Also check preferredNotifChannel in $dest/settings.json — which way depends on"
say "which parts of the snippet you pasted, not on this install:"
say ""
say "  * Pasted the bell hooks (Notification -> tmux-opener-bell.sh, Stop -> the"
say "    gate)? They take over as the source of the BEL, so Claude Code's own bell"
say "    must be switched off: set preferredNotifChannel to \"notifications_disabled\""
say "    (or another non-bell channel). Leaving it at \"terminal_bell\" adds a second"
say "    BEL that bypasses the gate and notifies at the wrong moment. Nothing is"
say "    lost — the hooks ring for both a finished turn and a prompt waiting on you."
say ""
say "  * Pasted only the statusLine? Leave preferredNotifChannel alone. The"
say "    statusline rings no bell; it only appends context%/cost to the"
say "    notification, so it adds to whatever already rings. Switching"
say "    \"terminal_bell\" off without the bell hooks leaves nothing ringing at all."
