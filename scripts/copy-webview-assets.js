const fs = require('fs');
const path = require('path');

// npm runs scripts from the package root, but resolve against this file's
// location so the script works no matter where it is invoked from.
const root = path.join(__dirname, '..');

// Both destinations are gitignored and rebuilt on every compile; only the
// copies land in the VSIX, since the source packages are devDependencies.
const groups = [
  {
    outDir: path.join(root, 'media', 'xterm'),
    files: [
      ['node_modules/@xterm/xterm/lib/xterm.js', 'xterm.js'],
      ['node_modules/@xterm/xterm/css/xterm.css', 'xterm.css'],
      ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js'],
      ['node_modules/@xterm/addon-web-links/lib/addon-web-links.js', 'addon-web-links.js'],
      ['node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js', 'addon-unicode11.js'],
      ['node_modules/@xterm/addon-search/lib/addon-search.js', 'addon-search.js'],
      ['node_modules/@xterm/addon-webgl/lib/addon-webgl.js', 'addon-webgl.js'],
      ['node_modules/@xterm/addon-clipboard/lib/addon-clipboard.js', 'addon-clipboard.js'],
    ],
  },
  {
    outDir: path.join(root, 'media', 'codicons'),
    files: [
      ['node_modules/@vscode/codicons/dist/codicon.css', 'codicon.css'],
      ['node_modules/@vscode/codicons/dist/codicon.ttf', 'codicon.ttf'],
    ],
  },
];

let count = 0;
for (const { outDir, files } of groups) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [src, destName] of files) {
    fs.copyFileSync(path.join(root, src), path.join(outDir, destName));
    count += 1;
  }
}

console.log(`Copied ${count} webview assets into media/`);
