const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('app.js', 'utf8');

const idRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
let match;
const missing = new Set();
const found = new Set();
while ((match = idRegex.exec(js)) !== null) {
  const id = match[1];
  if (!html.includes('id="' + id + '"') && !html.includes("id='" + id + "'")) {
    missing.add(id);
  } else {
    found.add(id);
  }
}
console.log('Missing IDs from getElementById:', Array.from(missing));
console.log('Found IDs count:', found.size);
