const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filename, (error, data) => {
        if (error) { res.writeHead(404); res.end('Not found'); return; }
        res.setHeader('Content-Type', (mime[path.extname(filename)] || 'application/octet-stream') + '; charset=utf-8');
        res.end(data);
    });
}).listen(4173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4173'));
