const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
// Solo archivos públicos; no desplegar SQL, pruebas ni documentación interna.
for (const file of fs.readdirSync(root)) {
    if (file === 'index.html' || /\.(png|jpe?g)$/.test(file) ||
        (file.endsWith('.json') && !['package.json', 'package-lock.json', 'vercel.json'].includes(file))) {
        fs.copyFileSync(path.join(root, file), path.join(output, file));
    }
}
fs.cpSync(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
