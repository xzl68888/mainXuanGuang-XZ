// server.js - XG Chat Server (WebSocket + HTTP)
// 支持多房间、实时聊天、阅后即焚

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 10000;

// ===== MIME Types =====
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

// ===== Room & User Management =====
const rooms = new Map(); // roomName -> Set of userId
const users = new Map(); // userId -> { ws, username, room }

function generateUserId() {
  return crypto.randomBytes(8).toString('hex');
}

function getRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set());
  }
  return rooms.get(roomName);
}

function broadcastToRoom(roomName, message, excludeUserId = null) {
  const room = rooms.get(roomName);
  if (!room) return;

  const msgStr = JSON.stringify(message);
  for (const userId of room) {
    if (userId === excludeUserId) continue;
    const user = users.get(userId);
    if (user && user.ws && user.ws.readyState === 1) {
      user.ws.send(msgStr);
    }
  }
}

function getUserList(roomName) {
  const room = rooms.get(roomName);
  if (!room) return [];
  const list = [];
  for (const userId of room) {
    const user = users.get(userId);
    if (user) list.push(user.username);
  }
  return list;
}

// ===== HTTP Server =====
const server = http.createServer((req, res) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  let filePath = req.url === '/' ? '/login.html' : req.url;
  filePath = filePath.split('?')[0]; // Remove query string

  // Security: prevent path traversal
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(__dirname, filePath);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
});

// ===== WebSocket Upgrade =====
server.on('upgrade', (req, socket, head) => {
  // Simple WebSocket handshake
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n');

  socket.write(responseHeaders);

  // Simple WebSocket frame parser
  const ws = {
    socket: socket,
    readyState: 1, // OPEN
    send: (data) => {
      if (socket.writable) {
        const frame = encodeWebSocketFrame(data);
        socket.write(frame);
      }
    },
    close: () => {
      ws.readyState = 3; // CLOSED
      socket.destroy();
    },
  };

  let buffer = Buffer.alloc(0);
  let userId = null;

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let payloadLen = buffer[1] & 0x7f;

      let offset = 2;
      if (payloadLen === 126) {
        if (buffer.length < 4) break;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) break;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      if (masked) offset += 4;
      if (buffer.length < offset + payloadLen) break;

      let payload = buffer.slice(offset, offset + payloadLen);
      if (masked) {
        const mask = buffer.slice(offset - 4, offset);
        payload = Buffer.from(payload).map((b, i) => b ^ mask[i % 4]);
      }

      buffer = buffer.slice(offset + payloadLen);

      if (opcode === 0x8) { // Close
        ws.readyState = 3;
        socket.destroy();
        return;
      }

      if (opcode === 0x1) { // Text
        try {
          const text = payload.toString('utf8');
          const msg = JSON.parse(text);
          handleMessage(ws, msg, (id) => { userId = id; });
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      }
    }
  });

  socket.on('close', () => {
    if (userId) {
      const user = users.get(userId);
      if (user) {
        const room = getRoom(user.room);
        room.delete(userId);
        users.delete(userId);

        broadcastToRoom(user.room, {
          type: 'user_leave',
          username: user.username,
        }, userId);

        broadcastToRoom(user.room, {
          type: 'user_list',
          users: getUserList(user.room),
        });
      }
    }
  });

  socket.on('error', (e) => {
    console.error('[WS] Socket error:', e);
  });
});

// ===== Message Handler =====
function handleMessage(ws, msg, setUserId) {
  switch (msg.type) {
    case 'auth': {
      const userId = generateUserId();
      const username = (msg.username || 'Anonymous').slice(0, 20);
      const roomName = (msg.room || 'default').slice(0, 30);

      users.set(userId, {
        ws: ws,
        username: username,
        room: roomName,
      });

      const room = getRoom(roomName);
      room.add(userId);

      setUserId(userId);

      ws.send(JSON.stringify({ type: 'auth_ok', userId: userId }));

      broadcastToRoom(roomName, {
        type: 'user_join',
        username: username,
      }, userId);

      broadcastToRoom(roomName, {
        type: 'user_list',
        users: getUserList(roomName),
      });

      console.log(`[XG] ${username} joined room "${roomName}" (${userId})`);
      break;
    }

    case 'chat': {
      const user = users.get(msg.userId || findUserIdByWs(ws));
      if (!user) return;

      const chatMsg = {
        type: 'chat',
        id: msg.id || crypto.randomBytes(4).toString('hex'),
        username: user.username,
        text: (msg.text || '').slice(0, 2000),
        ttl: Math.min(Math.max(msg.ttl || 10, 5), 300),
        encrypted: msg.encrypted || null,
        iv: msg.iv || null,
      };

      broadcastToRoom(user.room, chatMsg);
      break;
    }

    default:
      console.log('[WS] Unknown message type:', msg.type);
  }
}

function findUserIdByWs(ws) {
  for (const [id, user] of users) {
    if (user.ws === ws) return id;
  }
  return null;
}

// ===== WebSocket Frame Encoder =====
function encodeWebSocketFrame(data) {
  const payload = Buffer.from(data, 'utf8');
  const len = payload.length;

  let header;
  if (len <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + Text
    header[1] = len;
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

// ===== Start Server =====
server.listen(PORT, () => {
  console.log(``);
  console.log(`🔥 XG 自焚聊天室 - 服务已启动`);
  console.log(`   本地访问: http://localhost:${PORT}`);
  console.log(`   端口: ${PORT}`);
  console.log(``);
});
