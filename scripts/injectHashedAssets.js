/**
 * Injects content-hashed asset filenames into dist HTML so the app shell always
 * references the latest built JS/CSS. Run after bundles:build and copy:dist.
 *
 * Why content-hashed filenames:
 * - Hashed assets (e.g. user-ABC123.js, main-abc12def.css) can be cached for 1 year
 *   with Cache-Control: immutable. Each deploy produces new hashes, so HTML
 *   (which we never cache) always points at the current deploy's assets and we
 *   avoid stale deploys on Render.
 *
 * - JS: esbuild outputs [name]-[hash].js; we discover dist/js/*.js and replace
 *   /js/<name>.bundle.js with the actual hashed filename in all HTML.
 * - CSS: reads dist/css/main.css, computes content hash, writes main.[hash].css,
 *   removes main.css, and updates HTML to reference the hashed file.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const distDir = path.join(__dirname, '..', 'dist');
const distJs = path.join(distDir, 'js');
const distCss = path.join(distDir, 'css');

// Match esbuild output: name-<hash>.js (hash is alphanumeric, typically 8 chars)
const BUNDLE_NAMES = ['user', 'producer', 'output', 'helper'];

function getJsMap() {
  const map = {};
  if (!fs.existsSync(distJs)) return map;
  const files = fs.readdirSync(distJs);
  for (const name of BUNDLE_NAMES) {
    // esbuild --entry-names=[name]-[hash] produces e.g. user-abc12def.js
    const re = new RegExp(`^${name}-[a-zA-Z0-9]+\\.js$`);
    const found = files.find((f) => re.test(f));
    if (found) map[name] = found;
  }
  return map;
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
}

function processCss() {
  const mainCss = path.join(distCss, 'main.css');
  if (!fs.existsSync(mainCss)) return null;
  const content = fs.readFileSync(mainCss, 'utf8');
  const hash = hashContent(content);
  const hashedName = `main-${hash}.css`;
  const hashedPath = path.join(distCss, hashedName);
  fs.writeFileSync(hashedPath, content);
  fs.unlinkSync(mainCss);
  return hashedName;
}

function processHtml(jsMap, cssHashedName) {
  const files = fs.readdirSync(distDir).filter((f) => f.endsWith('.html'));
  for (const f of files) {
    let html = fs.readFileSync(path.join(distDir, f), 'utf8');

    for (const [name, filename] of Object.entries(jsMap)) {
      const oldRef = `/js/${name}.bundle.js`;
      const newRef = `/js/${filename}`;
      html = html.replace(new RegExp(oldRef.replace(/\//g, '\\/'), 'g'), newRef);
    }

    if (cssHashedName) {
      html = html.replace(
        /href="(\/css\/)main\.css"/g,
        `href="$1${cssHashedName}"`
      );
      // Handle relative paths in some HTML (e.g. ../css/main.css)
      html = html.replace(
        /href="\.\.\/css\/main\.css"/g,
        `href="/css/${cssHashedName}"`
      );
    }

    fs.writeFileSync(path.join(distDir, f), html);
  }
  return files.length;
}

function run() {
  if (!fs.existsSync(distDir)) {
    console.log('injectHashedAssets: dist not found, skipping.');
    return;
  }

  const jsMap = getJsMap();
  const hasJsHashes = Object.keys(jsMap).length > 0;

  let cssHashedName = null;
  if (fs.existsSync(distCss) && fs.existsSync(path.join(distCss, 'main.css'))) {
    cssHashedName = processCss();
    if (cssHashedName) {
      console.log('injectHashedAssets: hashed CSS to', cssHashedName);
    }
  }

  if (hasJsHashes || cssHashedName) {
    const count = processHtml(jsMap, cssHashedName);
    console.log(
      'injectHashedAssets: updated',
      count,
      'HTML file(s). JS map:',
      hasJsHashes ? jsMap : '(none)'
    );
  } else {
    console.log('injectHashedAssets: no hashed JS bundles found (dev build?), skipping HTML updates.');
  }
}

run();
