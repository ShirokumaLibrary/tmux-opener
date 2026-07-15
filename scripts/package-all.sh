#!/usr/bin/env bash
# Build every published VSIX from this one machine, then verify each one.
#
# There is no CI. This script is the release gate: it runs the same checks the
# GitHub Actions workflow used to run, in the same order, before it packages
# anything. Run it before tagging a release.
#
#   bash scripts/package-all.sh          # gate + 4 VSIXs into out/
#   bash scripts/package-all.sh --no-x64 # skip the target that needs docker
#
# Why the targets are not symmetric:
#
#   linux-*   node-pty ships no Linux prebuild, so `npm ci` compiles pty.node
#             into build/Release for the host arch. The host's own arch is built
#             natively; the other one is built inside a docker container of that
#             platform (qemu). This is the one target that cannot be faked.
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

for target in "linux-$HOST_ARCH" darwin-x64 darwin-arm64; do
  echo
  echo "==> packaging $target (native host)"
  npx vsce package --dependencies --target "$target" --out out/
done

if [ "$SKIP_X64" = 1 ]; then
  echo
  echo "!!! skipping linux-$FOREIGN_ARCH — that VSIX will be missing from the release"
else
  echo
  echo "==> packaging linux-$FOREIGN_ARCH (docker, $DOCKER_PLATFORM)"
  # The tree goes in over stdin rather than as a bind mount so the host's
  # node_modules (wrong arch) can never leak in; the container runs `npm ci`
  # against the same package-lock.json and compiles pty.node for its own arch.
  # It runs as the host user so out/*.vsix does not come back owned by root.
  # ./tmp is the sparse vscode clone kept for reference — big, and not needed.
  #
  # GOMAXPROCS=1: esbuild's Go binary crashes under qemu-x86_64 user-mode
  # emulation on an arm64 host ("fatal error: lfstack.push", a goroutine
  # scheduler/GC worker panic) when it runs multi-threaded. Forcing the Go
  # runtime single-threaded avoids the qemu atomics bug that triggers it.
  # Native amd64 hosts are unaffected; this only matters under emulation.
  tar -c --exclude=./node_modules --exclude=./out --exclude=./.git --exclude=./tmp -C "$ROOT" . |
    docker run --rm -i \
      --platform "$DOCKER_PLATFORM" \
      -u "$(id -u):$(id -g)" \
      -e HOME=/tmp \
      -e GOMAXPROCS=1 \
      -v "$ROOT/out:/out" \
      node:20-bookworm \
      bash -euo pipefail -c '
        mkdir -p /tmp/build && tar -x -C /tmp/build && cd /tmp/build
        npm ci --no-audit --no-fund
        node -e "require(\"node-pty\")"
        npx vsce package --dependencies --target '"linux-$FOREIGN_ARCH"' --out /out/
      '
fi

echo
echo "==> verifying"
node scripts/verify-vsix.js out/*.vsix
ls -la out/*.vsix
