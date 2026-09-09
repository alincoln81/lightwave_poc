// Add ?v=<timestamp> to JS and CSS references in dist HTML files
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const version = Date.now().toString();

function appendVersion(url) {
  if (url.includes('?v=')) return url; // idempotent
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${version}`;
}

function processHtml(filePath) {
  let html = fs.readFileSync(filePath, 'utf8');
  // <link rel="stylesheet" href="...">
  html = html.replace(/(<link[^>]+href=")([^"]+\.(?:css))("[^>]*>)/g, (_m, p1, url, p3) => `${p1}${appendVersion(url)}${p3}`);
  // <script src="...">
  html = html.replace(/(<script[^>]+src=")([^"]+\.(?:js))("[^>]*><\/script>)/g, (_m, p1, url, p3) => `${p1}${appendVersion(url)}${p3}`);
  fs.writeFileSync(filePath, html, 'utf8');
}

function run() {
  if (!fs.existsSync(distDir)) return;
  const files = fs.readdirSync(distDir).filter(f => f.endsWith('.html'));
  for (const f of files) {
    processHtml(path.join(distDir, f));
  }
  console.log(`Injected version v=${version} into ${files.length} HTML file(s).`);
}

run();


