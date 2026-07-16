#!/usr/bin/env node
// Check that a packaged VSIX actually carries the binary its --target claims.
//
// The filename is not evidence: `vsce package --target` only stamps metadata,
// it does not choose a binary. Every VSIX we build carries the same three
// native artifacts (node-pty's two darwin prebuilds plus whatever `npm ci`
// compiled into build/Release), so the only thing that distinguishes a
// linux-x64 VSIX from a linux-arm64 one is the machine type inside
// build/Release/pty.node. Read it.
//
// Also asserts the executable bit on prebuilds/*/spawn-helper. node-pty's npm
// tarball publishes it 0644 on every platform and chmods it nowhere, yet macOS
// posix_spawnp()s it (src/unix/pty.cc), so a darwin VSIX whose helper is not
// executable cannot start a pty. vsce preserves the mode into the zip and VS
// Code preserves it on install, so the mode in the zip is what ships.
//
// Usage: node scripts/verify-vsix.js out/tmux-opener-linux-x64-0.0.1.vsix …
// Exits non-zero on the first VSIX that fails.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const NODE_PTY = 'extension/node_modules/node-pty';
const PTY = `${NODE_PTY}/build/Release/pty.node`;

// Dev-only trees that .vscodeignore excludes, asserted absent from the package.
//
// The excludes are name-based, so a rename silently defeats them: renaming
// .eslintrc.json to the flat config leaked the config into a VSIX once already,
// and `examples/` -> `claude/` (#83) is the same shape of move. A name-based
// exclude cannot notice it is no longer matching anything — this can.
//
// Every path here carries the `extension/` prefix a VSIX gives its payload (see
// NODE_PTY above). Written bare, `claude/` would match no entry in any VSIX,
// ever, and the guard would pass forever without checking anything.
const DEV_ONLY_PREFIXES = [
  'extension/claude/',      // the scripts installed into ~/.claude (npm run claude:install)
  'extension/.claude/',     // this repo's own Claude Code settings — a different thing
  'extension/scripts/',
  'extension/src/',
  'extension/test/',
  'extension/tmp/',
  'extension/.shirokuma/',
  'extension/.github/',
  'extension/infra/',
  'extension/.vscode/',
];
const DEV_ONLY_FILES = ['extension/CLAUDE.md'];

// `vsce package --target <t>` writes the target into the filename, which is the
// only place we can recover it from a finished VSIX without parsing the manifest.
// linux: node-pty ships no Linux prebuild, so the binary that runs is the one
// `npm ci` compiled into build/Release, and it must match the target.
// darwin: the binary that runs is prebuilds/<target>/pty.node. A darwin VSIX is
// cross-packaged on Linux, so build/Release holds the *host's* ELF; lib/utils.js
// tries it first, fails to load it, and falls through to prebuilds/. Assert the
// prebuild instead — build/Release is meaningless for a darwin target.
const TARGET_MACHINE = {
  'linux-x64': { entry: PTY, machine: 'x86-64' },
  'linux-arm64': { entry: PTY, machine: 'aarch64' },
  'darwin-x64': { entry: `${NODE_PTY}/prebuilds/darwin-x64/pty.node`, machine: 'x86-64 (Mach-O)' },
  'darwin-arm64': { entry: `${NODE_PTY}/prebuilds/darwin-arm64/pty.node`, machine: 'arm64 (Mach-O)' },
};

// The highest GLIBC symbol version a linux pty.node is allowed to require. This
// is the *ceiling of what the build toolchain emits*, not the base image's glibc
// version — measured (#152) from the node:20-bookworm build of pty.node, whose
// highest required symbol is GLIBC_2.34. Debian bookworm ships glibc 2.36, so
// 2.34 is what that gcc/ld actually references, comfortably under 2.36.
//
// Keep this in sync with the base image in infra/ (node:20-bookworm / glibc
// 2.36): bumping the base image can raise the emitted floor, and this is the one
// gate that catches the opposite mistake — a linux VSIX built host-native on a
// newer distro (e.g. Ubuntu's glibc 2.4x), which requires symbols absent from
// the older glibc on a user's machine and dies at load with a
// `version 'GLIBC_2.xx' not found` error the machine-type check can't see.
const MAX_GLIBC = { major: 2, minor: 34 };

/** Order two {major, minor} GLIBC versions numerically (a - b). */
function compareGlibc(a, b) {
  return a.major - b.major || a.minor - b.minor;
}

// The highest GLIBC symbol version an ELF *requires* — i.e. the newest glibc it
// will refuse to load without. The versions the linker recorded live as
// `GLIBC_x.y` strings in .dynstr (referenced by the .gnu.version_r verneed
// entries); a node-pty .node is dynamically linked and holds no other GLIBC_
// strings, so scanning the image for them and taking the numeric max yields the
// required floor without decoding the section headers. latin1 is a byte-exact
// 1:1 decode, so the ASCII `GLIBC_` markers survive intact for the regex.
// Returns null if none are present (a statically linked or non-ELF image).
function maxGlibcVersion(bin) {
  const re = /GLIBC_(\d+)\.(\d+)/g;
  const text = bin.toString('latin1');
  let max = null;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = { major: Number(m[1]), minor: Number(m[2]) };
    if (max === null || compareGlibc(v, max) > 0) max = v;
  }
  return max;
}

/**
 * A problem string if this ELF's required GLIBC floor is unacceptable for a
 * linux target, else null. Over MAX_GLIBC means it was built against a newer
 * glibc than the bookworm base image; no GLIBC symbols at all means we cannot
 * vouch for the floor (a linux pty.node should always carry them).
 */
function glibcProblem(bin, entryName) {
  const req = maxGlibcVersion(bin);
  if (req === null) {
    return `${entryName}: no GLIBC version symbols found — cannot verify the glibc floor (expected a dynamically linked ELF)`;
  }
  if (compareGlibc(req, MAX_GLIBC) > 0) {
    return `${entryName} requires GLIBC_${req.major}.${req.minor}, newer than the MAX_GLIBC ${MAX_GLIBC.major}.${MAX_GLIBC.minor} floor — built against a newer glibc than the node:20-bookworm base image (rebuild it there; a host-native build on a newer distro will not load on older glibc)`;
  }
  return null;
}

/** Read a zip's central directory: entry name -> {mode, offset}. */
function readCentralDirectory(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) {
    eocd--;
  }
  if (eocd < 0) {
    throw new Error('not a zip file (no end-of-central-directory record)');
  }
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error(`corrupt central directory at entry ${i}`);
    }
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.set(name, {
      // The unix mode lives in the high 16 bits of the external attributes.
      mode: (buf.readUInt32LE(off + 38) >>> 16) & 0o7777,
      offset: buf.readUInt32LE(off + 42),
      // Take the sizes from here, never from the local header: when general
      // purpose bit 3 is set the local header carries zeros and the real sizes
      // live in a trailing data descriptor. vsce's zip writer does exactly that.
      compressedSize: buf.readUInt32LE(off + 20),
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Decompress one entry. Only stored (0) and deflate (8) occur in a VSIX. */
function readEntry(buf, entry) {
  const off = entry.offset;
  if (buf.readUInt32LE(off) !== 0x04034b50) {
    throw new Error('corrupt local file header');
  }
  const method = buf.readUInt16LE(off + 8);
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressedSize);
  if (method === 0) {
    return data;
  }
  if (method === 8) {
    return zlib.inflateRawSync(data);
  }
  throw new Error(`unsupported compression method ${method}`);
}

/** Machine type of an ELF or Mach-O image, as a short name. */
function machineOf(bin) {
  if (bin.readUInt32BE(0) === 0x7f454c46) {
    // ELF: e_machine is a 16-bit field at 0x12, little-endian on both our
    // targets (EI_DATA at 0x05 is 1 = ELFDATA2LSB).
    const machine = bin.readUInt16LE(0x12);
    if (machine === 0x3e) return 'x86-64';
    if (machine === 0xb7) return 'aarch64';
    return `ELF e_machine=0x${machine.toString(16)}`;
  }
  if (bin.readUInt32LE(0) === 0xfeedfacf) {
    const cputype = bin.readUInt32LE(4);
    if (cputype === 0x0100000c) return 'arm64 (Mach-O)';
    if (cputype === 0x01000007) return 'x86-64 (Mach-O)';
    return `Mach-O cputype=0x${cputype.toString(16)}`;
  }
  return `unknown (magic ${bin.subarray(0, 4).toString('hex')})`;
}

function targetOf(file) {
  const m = path.basename(file).match(/-(linux|darwin)-(x64|arm64)-/);
  if (!m) {
    throw new Error(`cannot read a --target out of the filename: ${file}`);
  }
  return `${m[1]}-${m[2]}`;
}

function main(files) {
  let failed = false;
  for (const file of files) {
    const target = targetOf(file);
    const buf = fs.readFileSync(file);
    const entries = readCentralDirectory(buf);
    const problems = [];

    // Dev-only trees must not have shipped. Name the offending entries: the
    // point of failing here is to say *which* exclude stopped matching.
    const leaked = [...entries.keys()].filter(
      (name) =>
        DEV_ONLY_PREFIXES.some((p) => name.startsWith(p)) || DEV_ONLY_FILES.includes(name),
    );
    if (leaked.length) {
      const shown = leaked.slice(0, 5).join(', ');
      const more = leaked.length > 5 ? `, … (${leaked.length} entries)` : '';
      problems.push(
        `dev-only files leaked into the VSIX — check .vscodeignore: ${shown}${more}`,
      );
    }

    const expected = TARGET_MACHINE[target];
    const pty = entries.get(expected.entry);
    let machine = '(missing)';
    if (!pty) {
      problems.push(`${expected.entry} is missing — vsce dropped the binary this target runs`);
    } else {
      const bin = readEntry(buf, pty);
      machine = machineOf(bin);
      if (machine !== expected.machine) {
        problems.push(`${expected.entry} is ${machine}, expected ${expected.machine}`);
      }
      // Only linux runs build/Release directly (darwin falls through to the
      // Mach-O prebuild, checked above), so the GLIBC floor is a linux-only
      // concern — a Mach-O image carries no GLIBC symbols and would false-flag.
      if (target.startsWith('linux')) {
        const glibc = glibcProblem(bin, expected.entry);
        if (glibc) problems.push(glibc);
      }
    }

    // Only macOS runs spawn-helper (src/unix/pty.cc guards it with
    // `#if !defined(__APPLE__)` inverted); the Linux VSIXs carry the darwin
    // prebuilds as dead weight, and their modes there are irrelevant.
    if (target.startsWith('darwin')) {
      const helper = `${NODE_PTY}/prebuilds/${target}/spawn-helper`;
      const e = entries.get(helper);
      if (!e) {
        problems.push(`${helper} is missing`);
      } else if (!(e.mode & 0o111)) {
        problems.push(`${helper} is ${e.mode.toString(8)} — macOS cannot posix_spawnp it`);
      }
    }

    if (problems.length) {
      failed = true;
      console.error(`FAIL ${file}`);
      for (const p of problems) console.error(`  - ${p}`);
    } else {
      console.log(`ok   ${path.basename(file)}  ${target}  ${machine}`);
    }
  }
  return failed;
}

// Export the pure glibc logic for the unit suite; run the CLI only when invoked
// directly (node scripts/verify-vsix.js …), the same shape the other testable
// scripts use so `require()` from a test doesn't spawn the CLI or call exit().
module.exports = { MAX_GLIBC, compareGlibc, maxGlibcVersion, glibcProblem };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)) ? 1 : 0);
}
