const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  // Security: prevent path traversal
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(__dirname, filePath);
  
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext.startsWith('.html') ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`✅ XuanGuang-XZ running on port ${PORT}`);
});
