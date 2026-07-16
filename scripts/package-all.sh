#!/usr/bin/env bash
# Build every published VSIX from this one machine, then verify each one.
#
# There is no CI. This script is the release gate: it runs the same checks the
# GitHub Actions workflow used to run, in the same order, before it packages
# anything. Run it before tagging a release.
#
#   bash scripts/package-all.sh          # gate + 4 VSIXs into out/
#   bash scripts/package-all.sh --no-x64 # skip the emulated foreign-arch target
#
# --no-x64 no longer means "skip the target that needs docker": docker is now a
# hard requirement for *every* Linux build, host arch included (see below). What
# it skips is only the foreign-arch VSIX, the one built under qemu emulation.
#
# Why the targets are not symmetric:
#
#   linux-*   node-pty ships no Linux prebuild, so `npm ci` compiles pty.node
#             into build/Release. Both Linux arches are now built the same way,
#             inside a `node:20-bookworm` container via package_linux_in_docker,
#             so pty.node links against bookworm's glibc (2.36) rather than this
#             host's — i.e. docker is required for the host-arch build too, not
#             just the foreign one. The host arch's container runs
#             `--platform linux/<host>`, which matches the machine, so it is a
#             *native* build with no qemu (docker without emulation); the foreign
#             arch runs under qemu emulation. This is the one target that cannot
#             be faked.
#   darwin-*  node-pty ships macOS prebuilds, so both are cross-packaged here.
#             build/Release ends up holding this host's ELF, which is harmless:
#             lib/utils.js tries build/Release, fails to load it, and falls
#             through to prebuilds/<platform>-<arch>. What matters is the
#             executable bit on prebuilds/*/spawn-helper — npm publishes it 0644
#             on every platform and chmods it nowhere, yet macOS posix_spawnp()s
#             it (src/unix/pty.cc). vsce preserves the mode into the zip.
#
# Windows is not a target: the extension spawns `tmux` directly.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD

SKIP_X64=0
[ "${1:-}" = "--no-x64" ] && SKIP_X64=1

case "$(uname -m)" in
  aarch64 | arm64) HOST_ARCH=arm64 ;;
  x86_64) HOST_ARCH=x64 ;;
  *) echo "unsupported build host: $(uname -m)" >&2; exit 1 ;;
esac
FOREIGN_ARCH=$([ "$HOST_ARCH" = arm64 ] && echo x64 || echo arm64)
DOCKER_PLATFORM=$([ "$FOREIGN_ARCH" = x64 ] && echo linux/amd64 || echo linux/arm64)
HOST_PLATFORM=$([ "$HOST_ARCH" = x64 ] && echo linux/amd64 || echo linux/arm64)

# Build a linux-<arch> VSIX inside a node:20-bookworm container.
#
#   $1 arch      x64 | arm64 (the vsce --target suffix)
#   $2 platform  the docker --platform (linux/amd64 | linux/arm64)
#   $3 emulated  1 when $platform does not match the host arch (runs under qemu)
#
# The tree goes in over stdin rather than as a bind mount so the host's
# node_modules (wrong arch) can never leak in; the container runs `npm ci`
# against the same package-lock.json and compiles pty.node for its own arch,
# against bookworm's glibc. It runs as the host user so out/*.vsix does not come
# back owned by root. ./tmp is the sparse vscode clone kept for reference — big,
# and not needed.
#
# GOMAXPROCS=1 (emulated path only): esbuild's Go binary crashes under
# qemu user-mode emulation ("fatal error: lfstack.push", a goroutine
# scheduler/GC worker panic) when it runs multi-threaded. This hits whichever
# arch is the *emulated* one — qemu-x86_64 when the host is arm64, qemu-aarch64
# when the host is x64 — since the bug is in qemu's atomics, not in any one
# guest arch. Forcing the Go runtime single-threaded avoids it. A native build
# (host arch, no qemu) is unaffected, so it runs esbuild multi-threaded and does
# not pay that cost.
package_linux_in_docker() {
  local arch=$1 platform=$2 emulated=${3:-0}
  echo
  if [ "$emulated" = 1 ]; then
    echo "==> packaging linux-$arch (docker, $platform, emulated)"
  else
    echo "==> packaging linux-$arch (docker, $platform, native)"
  fi

  local -a docker_env=(-e HOME=/tmp)
  [ "$emulated" = 1 ] && docker_env+=(-e GOMAXPROCS=1)

  tar -c --exclude=./node_modules --exclude=./out --exclude=./.git --exclude=./tmp -C "$ROOT" . |
    docker run --rm -i \
      --platform "$platform" \
      -u "$(id -u):$(id -g)" \
      "${docker_env[@]}" \
      -v "$ROOT/out:/out" \
      node:20-bookworm \
      bash -euo pipefail -c '
        mkdir -p /tmp/build && tar -x -C /tmp/build && cd /tmp/build
        npm ci --no-audit --no-fund
        node -e "require(\"node-pty\")"
        npx vsce package --dependencies --target '"linux-$arch"' --out /out/
      '
}

echo "==> gate (the checks CI used to run)"
npm run check-types
npm run lint
npm test
node -e "require('node-pty')" && echo "node-pty loads on the host"

# vsce writes a *file* named `out` when the directory does not exist.
mkdir -p out
rm -f out/*.vsix

echo
echo "==> restoring the executable bit on spawn-helper"
chmod +x node_modules/node-pty/prebuilds/darwin-x64/spawn-helper
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper

# darwin uses node-pty's macOS prebuilds and links against no host glibc, so it
# is packaged directly on this host. linux-<host-arch> is the machine's own
# shipping VSIX, but it too goes through a bookworm container (native, no qemu)
# so its pty.node links against glibc 2.36 rather than this host's newer one —
# it is a primary artifact and is never skipped by --no-x64.
for target in darwin-x64 darwin-arm64; do
  echo
  echo "==> packaging $target (native host)"
  npx vsce package --dependencies --target "$target" --out out/
done

package_linux_in_docker "$HOST_ARCH" "$HOST_PLATFORM"

if [ "$SKIP_X64" = 1 ]; then
  echo
  echo "!!! skipping linux-$FOREIGN_ARCH — that VSIX will be missing from the release"
else
  package_linux_in_docker "$FOREIGN_ARCH" "$DOCKER_PLATFORM" 1
fi

echo
echo "==> verifying"
node scripts/verify-vsix.js out/*.vsix
ls -la out/*.vsix
