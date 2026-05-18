// chat-app.js - XG Chat Application (Client)

(function () {
  'use strict';

  const username = localStorage.getItem('xg_username');
  const room = localStorage.getItem('xg_room') || 'default';

  if (!username) {
    window.location.href = 'login.html';
    return;
  }

  // DOM refs
  const chatArea = document.getElementById('chatArea');
  const msgInput = document.getElementById('msgInput');
  const ttlSelect = document.getElementById('ttlSelect');
  const emptyState = document.getElementById('emptyState');
  const burnOverlay = document.getElementById('burnOverlay');
  const myNameEl = document.getElementById('myName');
  const myAvatarEl = document.getElementById('myAvatar');
  const roomDisplay = document.getElementById('roomDisplay');
  const userCountEl = document.getElementById('userCount');
  const userListContainer = document.getElementById('userListContainer');
  const connStatus = document.getElementById('connStatus');
  const sendBtn = document.getElementById('sendBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  // State
  let ws = null;
  let msgIdCounter = 0;
  const activeMessages = new Map(); // id -> { interval, el }
  let sessionKey = null;
  let reconnectAttempts = 0;

  // Init UI
  myNameEl.textContent = username;
  myAvatarEl.textContent = username.charAt(0).toUpperCase();
  roomDisplay.textContent = room;

  // ===== Crypto =====
  async function initCrypto() {
    try {
      sessionKey = await CryptoModule.generateKey();
      console.log('[XG] Session key generated');
    } catch (e) {
      console.error('[XG] Crypto init failed:', e);
    }
  }

  // ===== WebSocket =====
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}`;
    console.log('[XG] Connecting to', wsUrl);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[XG] WS connected');
      connStatus.textContent = '已连接';
      reconnectAttempts = 0;

      // Authenticate
      ws.send(JSON.stringify({
        type: 'auth',
        username: username,
        room: room
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('[XG] Parse error:', e);
      }
    };

    ws.onclose = () => {
      console.log('[XG] WS disconnected');
      connStatus.textContent = '已断开';
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.error('[XG] WS error:', e);
    };
  }

  function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    console.log(`[XG] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    setTimeout(connectWS, delay);
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'auth_ok':
        console.log('[XG] Authenticated');
        break;

      case 'user_list':
        updateUserList(msg.users);
        break;

      case 'user_join':
        addSystemMessage(`🔥 ${msg.username} 加入了房间`);
        break;

      case 'user_leave':
        addSystemMessage(`💨 ${msg.username} 离开了房间`);
        break;

      case 'chat':
        displayMessage(msg.id, msg.username, msg.text, msg.ttl, false, msg.encrypted, msg.iv);
        break;

      default:
        console.log('[XG] Unknown message type:', msg.type);
    }
  }

  // ===== User List =====
  function updateUserList(users) {
    userCountEl.textContent = users.length;
    userListContainer.innerHTML = users
      .filter(u => u !== username)
      .map(u => `
        <div class="user-item">
          <div class="user-avatar">${u.charAt(0).toUpperCase()}</div>
          <div class="user-name">${escapeHtml(u)}</div>
          <div class="user-online"></div>
        </div>
      `).join('');
  }

  // ===== System Message =====
  function addSystemMessage(text) {
    hideEmptyState();
    const el = document.createElement('div');
    el.className = 'sys-msg';
    el.textContent = text;
    chatArea.appendChild(el);
    chatArea.scrollTop = chatArea.scrollHeight;

    // Auto-remove after 10s
    setTimeout(() => { if (el.parentNode) el.remove(); }, 10000);
  }

  // ===== Display Message =====
  function displayMessage(id, name, text, ttl, isSelf, encrypted, iv) {
    hideEmptyState();

    const el = document.createElement('div');
    el.className = `msg ${isSelf ? 'self' : 'other'}`;
    el.id = `msg-${id}`;
    el.innerHTML = `
      <div class="msg-avatar">${name.charAt(0).toUpperCase()}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-name">${escapeHtml(name)}</span>
          <span class="msg-time">${formatTime()}</span>
          <span class="msg-timer" id="timer-${id}">${ttl}s</span>
        </div>
        <div class="msg-text" id="text-${id}">${encrypted ? '🔓 解密中...' : escapeHtml(text)}</div>
      </div>
      <div class="msg-burn-bar" id="bar-${id}" style="width:100%"></div>
    `;

    chatArea.appendChild(el);
    chatArea.scrollTop = chatArea.scrollHeight;

    // Decrypt if needed
    if (encrypted && iv && sessionKey) {
      decryptMessage(encrypted, iv).then(plain => {
        const textEl = document.getElementById(`text-${id}`);
        if (textEl) textEl.textContent = plain || '[解密失败]';
      }).catch(() => {
        const textEl = document.getElementById(`text-${id}`);
        if (textEl) textEl.textContent = '[解密失败]';
      });
    }

    // Start burn countdown
    startBurnTimer(id, el, ttl);
  }

  // ===== Burn Timer =====
  function startBurnTimer(id, el, ttl) {
    const started = Date.now();
    const timerEl = document.getElementById(`timer-${id}`);
    const barEl = document.getElementById(`bar-${id}`);

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const remain = ttl - elapsed;
      if (remain <= 0) {
        clearInterval(interval);
        burnMessage(id, el);
        return;
      }
      if (timerEl) timerEl.textContent = `${remain}s`;
      if (barEl) barEl.style.width = `${(remain / ttl) * 100}%`;
    }, 250);

    activeMessages.set(id, { interval, el });
  }

  function burnMessage(id, el) {
    if (!el || !el.parentNode) return;

    burnOverlay.classList.add('active');
    setTimeout(() => burnOverlay.classList.remove('active'), 300);

    el.classList.add('burning');

    setTimeout(() => {
      if (el.parentNode) el.remove();
      activeMessages.delete(id);
      if (activeMessages.size === 0 && !chatArea.querySelector('.sys-msg')) {
        emptyState.style.display = 'flex';
      }
    }, 800);
  }

  // ===== Send Message =====
  async function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    const ttl = parseInt(ttlSelect.value, 10);
    const id = `local-${++msgIdCounter}`;

    // Encrypt if key available
    let encrypted = null;
    let iv = null;
    if (sessionKey) {
      try {
        const result = await CryptoModule.encryptMessage(text, sessionKey);
        encrypted = result.encrypted;
        iv = result.iv;
      } catch (e) {
        console.error('[XG] Encrypt failed:', e);
      }
    }

    // Send via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'chat',
        id: id,
        text: text,
        ttl: ttl,
        encrypted: encrypted,
        iv: iv
      }));
    }

    // Display locally
    displayMessage(id, username, text, ttl, true, encrypted, iv);

    msgInput.value = '';
    msgInput.style.height = 'auto';
  }

  // ===== Crypto Helpers =====
  async function decryptMessage(encryptedB64, ivB64) {
    if (!sessionKey) return null;
    return await CryptoModule.decryptMessage(encryptedB64, sessionKey, ivB64);
  }

  // ===== UI Helpers =====
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function hideEmptyState() {
    if (emptyState) emptyState.style.display = 'none';
  }

  // ===== Event Listeners =====
  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
  });

  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('xg_username');
    localStorage.removeItem('xg_room');
    if (ws) ws.close();
    window.location.href = 'login.html';
  });

  // ===== Boot =====
  async function boot() {
    await initCrypto();
    connectWS();
  }

  boot();
})();
