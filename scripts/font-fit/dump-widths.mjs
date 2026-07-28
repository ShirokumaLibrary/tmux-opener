// xterm.js が実際に割り当てる列数を、xterm 自身の unicode11 プロバイダから吸い出す。
// 手書きの EastAsianWidth 表に頼ると転記漏れ（⚠ ✓ ✔ を落とした・#262 事故 1）が
// 起きるため、「レンダラが何セル割り当てるか」を正本にする。
//
// 参照元は node_modules 側（scripts/copy-webview-assets.js が media/xterm/ へ
// コピーする元と同一バイト）。media/xterm/addon-unicode11.js は .gitignore された
// 生成物で `npm run compile` 前は存在しないため、そちらを読むとビルド順に依存する。
//
// 出力（widths.json）は scratch へ書き、リポにコミットしない。幅表の唯一の存在意義は
// 「同梱レンダラが実際に割り当てる列数」への自動追従で、コミットした瞬間に
// xterm の bump に取り残される手保守物へ退化する（設計 #271 R5 案 B の却下理由）。
//
// 使い方: node dump-widths.mjs <出力パス>
//        （--print-version だけを渡すと addon のバージョンを 1 行出して終わる）
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// copy-webview-assets.js のコピー元と同じパスを名指しする（同一バイトの供給源）。
const addonDir = join(repoRoot, 'node_modules', '@xterm', 'addon-unicode11');
const addonEntry = join(addonDir, 'lib', 'addon-unicode11.js');

const addonVersion = JSON.parse(
  readFileSync(join(addonDir, 'package.json'), 'utf8'),
).version;

if (process.argv[2] === '--print-version') {
  // 来歴（設計 #271 R7）に記録するツールバージョンの 1 つ。
  process.stdout.write(`${addonVersion}\n`);
  process.exit(0);
}

const mod = require(addonEntry);

// アドオンは activate(terminal) の中で terminal.unicode.register(provider) を
// 呼ぶ。ダミー端末を渡して provider を捕まえる。
let provider = null;
const fakeTerm = {
  unicode: {
    register(p) {
      provider = p;
    },
  },
};
new mod.Unicode11Addon().activate(fakeTerm);

if (!provider || typeof provider.wcwidth !== 'function') {
  throw new Error('provider.wcwidth を取得できなかった');
}
console.error(`@xterm/addon-unicode11 ${addonVersion}  provider version = ${provider.version}`);

// Unicode 全域を走査し、符号位置ごとの列数を控える。
// （幅 0 = 結合文字 / 幅 2 = 全角 / 幅 -1 = 制御 → 255 に畳む）
const widths = new Uint8Array(0x110000);
for (let cp = 0; cp < 0x110000; cp++) {
  const w = provider.wcwidth(cp);
  widths[cp] = w < 0 ? 255 : w;
}

// ランレングスで JSON に落とす（[start, end, width] の配列）
const runs = [];
let start = 0;
for (let cp = 1; cp <= 0x110000; cp++) {
  if (cp === 0x110000 || widths[cp] !== widths[start]) {
    runs.push([start, cp - 1, widths[start]]);
    start = cp;
  }
}

const out = process.argv[2];
if (!out) {
  throw new Error('出力パスを指定してください: node dump-widths.mjs <出力パス>');
}
writeFileSync(out, JSON.stringify(runs));
console.error(`${runs.length} ラン を ${out} に書き出した`);

// 確認用サンプル（#262 事故 1 で落ちていた ⚠ ✓ ✔ を含む）
const samples = [0x41, 0x6f22, 0x25cf, 0x2605, 0x26a0, 0x2713, 0x2714, 0x2460, 0x24b6, 0x2776, 0x2026];
for (const cp of samples) {
  console.error(`  U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${String.fromCodePoint(cp)} -> ${provider.wcwidth(cp)} 列`);
}
