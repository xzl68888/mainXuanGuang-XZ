/**
 * XG 阅后即焚 · 移动端 PWA
 * 核心逻辑：WebSocket + 阅后即焚 + 防截屏
 * 协议基于 server.js: auth / chat / msg_read / burn_receipt
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════
  // 全局状态
  // ═══════════════════════════════════════════════
  const STATE = {
    userId: null,
    username: '',
    room: 'default',
    ws: null,
    connected: false,
    messages: [],          // 当前会话消息
    pendingBurns: {},      // {msgId: {timer, ttl, startTime}}
    onlineUsers: [],
    defaultBurn: true,
    defaultTTL: 10,
    screenshotProtection: true,
    currentView: 'login',  // login | rooms | chat
  };

  // ═══════════════════════════════════════════════
  // WebSocket 连接
  // ═══════════════════════════════════════════════
  const WS_URL = `ws://${location.hostname}:10000`;
  const RECONNECT_DELAY = 3000;
  let reconnectTimer = null;

  function connect() {
    if (STATE.ws) STATE.ws.close();

    appendLog('Connecting to ' + WS_URL + '...');
    const ws = new WebSocket(WS_URL);
    STATE.ws = ws;

    ws.addEventListener('open', () => {
      appendLog('Connected!');
      setConnected(true);
      // 发送认证
      ws.send(JSON.stringify({
        type: 'auth',
        username: STATE.username,
        room: STATE.room,
      }));
    });

    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleServerMessage(msg);
      } catch (err) {
        appendLog('Parse error: ' + e.data);
      }
    });

    ws.addEventListener('close', () => {
      appendLog('Disconnected');
      setConnected(false);
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      appendLog('WebSocket error');
      setConnected(false);
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
  }

  // ═══════════════════════════════════════════════
  // 服务器消息处理
  // ═══════════════════════════════════════════════
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'auth_ok':
        STATE.userId = msg.userId;
        appendLog('Auth OK: ' + msg.userId);
        showPage('rooms');
        STATE.currentView = 'rooms';
        toast('✅ 已连接至 ' + STATE.room + ' 房间');
        break;

      case 'user_join':
        appendLog(msg.username + ' joined');
        addSystemMsg(msg.username + ' 加入了房间', false);
        if (!STATE.onlineUsers.find(u => u.username === msg.username)) {
          STATE.onlineUsers.push({ username: msg.username, ws: msg.ws });
        }
        renderOnlineUsers();
        break;

      case 'user_list':
        STATE.onlineUsers = msg.users || [];
        renderOnlineUsers();
        break;

      case 'user_left':
        appendLog(msg.username + ' left');
        addSystemMsg(msg.username + ' 离开了房间', false);
        STATE.onlineUsers = STATE.onlineUsers.filter(u => u.username !== msg.username);
        renderOnlineUsers();
        break;

      case 'chat':
        appendLog('Received: ' + msg.text + (msg.ttl ? ' [TTL=' + msg.ttl + ']' : ''));
        handleIncomingMessage(msg);
        break;

      case 'msg_read_ack':
        // 对方已读确认（A端收到）
        updateMessageStatus(msg.msgId, 'read');
        break;

      case 'burn_receipt_ack':
        // 焚烧回执确认（A端收到）
        handleBurnReceiptAck(msg.msgId);
        break;

      case 'server_msg_deleted':
        // 服务器推送删除（B端收到）
        deleteMessageById(msg.msgId, true);
        break;

      default:
        appendLog('Unknown: ' + JSON.stringify(msg));
    }
  }

  // ═══════════════════════════════════════════════
  // 接收消息处理（含焚毁逻辑）
  // ═══════════════════════════════════════════════
  function handleIncomingMessage(msg) {
    const isBurn = msg.ttl && msg.ttl > 0;
    const displayMsg = {
      ...msg,
      isMine: false,
      isBurn,
      status: 'delivered', // delivered | read | burning | burned
      receivedAt: Date.now(),
    };

    STATE.messages.push(displayMsg);
    renderMessage(displayMsg);
    scrollToBottom();

    if (isBurn) {
      // 🔴 私密消息占位符 — 列表页不显示真实内容
      // （移动端列表不需要单独处理，因为消息列表是按用户分的）

      // 🔥 通知对方已打开（MSG_READ_START）
      // 协议：用 chat type 发送读回执给服务器
      if (STATE.ws && STATE.connected) {
        STATE.ws.send(JSON.stringify({
          type: 'msg_read',
          msgId: msg.id,
          userId: STATE.userId,
        }));
      }

      updateMessageStatus(msg.id, 'burning');

      // 启动焚毁倒计时
      startBurnTimer(msg.id, msg.ttl);
    }
  }

  // ═══════════════════════════════════════════════
  // 焚毁倒计时核心逻辑
  // ═══════════════════════════════════════════════
  function startBurnTimer(msgId, ttl) {
    // 如果已有计时器，先清除
    if (STATE.pendingBurns[msgId]) {
      clearInterval(STATE.pendingBurns[msgId].interval);
    }

    const startTime = Date.now();
    const duration = ttl * 1000;

    // 每100ms更新进度条
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, duration - elapsed);
      const percent = (remaining / duration) * 100;

      // 更新倒计时进度条
      const progressEl = document.getElementById('progress-' + msgId);
      if (progressEl) {
        progressEl.style.width = percent + '%';
      }

      // 更新倒计时文字
      const statusEl = document.getElementById('status-' + msgId);
      if (statusEl && remaining > 0) {
        statusEl.textContent = '🔥 ' + Math.ceil(remaining / 1000) + 's';
      }
    }, 100);

    STATE.pendingBurns[msgId] = { interval, ttl, startTime };

    // 定时销毁
    setTimeout(() => {
      burnMessage(msgId);
    }, duration);
  }

  function burnMessage(msgId) {
    clearInterval(STATE.pendingBurns[msgId]?.interval);
    delete STATE.pendingBurns[msgId];

    // 触发焚烧动画
    const bubble = document.getElementById('bubble-' + msgId);
    const wrap = document.getElementById('wrap-' + msgId);

    if (bubble) {
      bubble.classList.add('burning');
      setTimeout(() => {
        bubble.classList.remove('burning');
        bubble.classList.add('burned-out');
        // 动画结束后显示替换文字
        setTimeout(() => {
          if (wrap) {
            wrap.innerHTML = '<div class="burned-replacement">🔥 消息已安全销毁</div>';
          }
        }, 800);
      }, 300);
    } else {
      deleteMessageById(msgId, false);
    }

    updateMessageStatus(msgId, 'burned');

    // 发送 BURN_RECEIPT 给服务器
    if (STATE.ws && STATE.connected) {
      STATE.ws.send(JSON.stringify({
        type: 'burn_receipt',
        msgId: msgId,
        userId: STATE.userId,
      }));
    }

    // 播放销毁音效（可选）
    playBurnSound();
  }

  function playBurnSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════════
  // 发送消息
  // ═══════════════════════════════════════════════
  function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = (input.value || '').trim();
    if (!text || !STATE.connected) {
      if (!STATE.connected) toast('⚠️ 未连接服务器');
      return;
    }

    const burnToggle = document.getElementById('burn-toggle');
    const ttlInput = document.getElementById('setting-default-ttl');
    const ttl = burnToggle && burnToggle.checked ? STATE.defaultTTL : 0;

    const msgId = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    const chatMsg = {
      type: 'chat',
      id: msgId,
      text,
      ttl,
      userId: STATE.userId,
    };

    // 先本地显示（A端）
    const displayMsg = {
      ...chatMsg,
      username: STATE.username,
      isMine: true,
      isBurn: ttl > 0,
      status: 'pending',
      receivedAt: Date.now(),
    };

    STATE.messages.push(displayMsg);
    renderMessage(displayMsg);
    scrollToBottom();
    input.value = '';

    // 发送到服务器
    STATE.ws.send(JSON.stringify(chatMsg));
    updateMessageStatus(msgId, 'delivered');
  }

  // ═══════════════════════════════════════════════
  // 状态更新
  // ═══════════════════════════════════════════════
  function updateMessageStatus(msgId, status) {
    const el = document.getElementById('status-' + msgId);
    if (!el) return;
    el.className = 'msg-status ' + status;
    const labels = {
      pending: '⏳',
      delivered: '✓',
      read: '👁️',
      burning: '🔥',
      burned: '💀',
    };
    el.textContent = labels[status] || status;
  }

  function handleBurnReceiptAck(msgId) {
    // A端收到B的焚烧回执，替换为"对方已阅已销毁"提示
    updateMessageStatus(msgId, 'burned');
    const wrap = document.getElementById('wrap-' + msgId);
    if (wrap) {
      setTimeout(() => {
        wrap.innerHTML = '<div class="burned-replacement">👁️ 对方已阅 · 消息已安全销毁</div>';
      }, 500);
    }
    // 自动焚烧自己的副本
    clearTimeout(STATE.pendingBurns[msgId]?.timer);
    delete STATE.pendingBurns[msgId];
  }

  function deleteMessageById(msgId, fromServer) {
    // B端收到服务器删除指令，或主动删除
    const wrap = document.getElementById('wrap-' + msgId);
    if (wrap) {
      wrap.classList.add('burned-out');
      setTimeout(() => wrap.remove(), 800);
    }
    STATE.messages = STATE.messages.filter(m => m.id !== msgId);
    if (STATE.pendingBurns[msgId]) {
      clearInterval(STATE.pendingBurns[msgId].interval);
      delete STATE.pendingBurns[msgId];
    }
  }

  // ═══════════════════════════════════════════════
  // 渲染函数
  // ═══════════════════════════════════════════════
  function renderMessage(msg) {
    const area = document.getElementById('message-area');
    const isSent = msg.isMine;
    const isBurn = msg.isBurn;

    const div = document.createElement('div');
    div.id = 'wrap-' + msg.id;
    div.className = 'msg-wrap ' + (isSent ? 'sent' : 'received');

    // 气泡内容
    let bubbleClass = 'msg-bubble';
    if (isBurn) bubbleClass += ' burn';
    if (STATE.pendingBurns[msg.id]) bubbleClass += ' burning';

    const burnBadge = isBurn
      ? `<div class="msg-meta"><span class="msg-status burning" id="status-${msg.id}">🔥</span></div>`
      : `<div class="msg-meta"><span class="msg-status ${msg.status}" id="status-${msg.id}">${msg.isMine ? '✓' : ''}</span></div>`;

    let countdown = '';
    if (isBurn && !msg.isMine) {
      countdown = `<div class="countdown-bar"><div class="countdown-progress" id="progress-${msg.id}" style="width:100%"></div></div>`;
    }

    div.innerHTML = `
      <div class="${bubbleClass}" id="bubble-${msg.id}">${escapeHtml(msg.text)}</div>
      ${countdown}
      ${burnBadge}
    `;

    // 移除初始占位符
    const init = area.querySelector('.msg-init');
    if (init) init.remove();

    area.appendChild(div);
  }

  function renderOnlineUsers() {
    const container = document.getElementById('online-users');
    const count = document.getElementById('online-count');
    if (!container) return;

    count.textContent = STATE.onlineUsers.length;
    container.innerHTML = '';

    STATE.onlineUsers.forEach(user => {
      if (user.username === STATE.username) return;
      const div = document.createElement('div');
      div.className = 'online-user';
      div.onclick = () => goToChatWith(user.username);
      div.innerHTML = `
        <div class="online-avatar">${user.username.charAt(0).toUpperCase()}</div>
        <div class="online-name">${escapeHtml(user.username)}</div>
      `;
      container.appendChild(div);
    });
  }

  function renderChatList() {
    const list = document.getElementById('chat-list');
    if (!list) return;

    if (STATE.messages.length === 0) {
      list.innerHTML = `
        <div class="chat-empty">
          <span>🕯️</span>
          <p>暂无消息<br><small>发送一条阅后即焚消息开启对话</small></p>
        </div>`;
      return;
    }

    // 按发送者分组
    const byUser = {};
    STATE.messages.forEach(msg => {
      const key = msg.isMine ? '我' : (msg.username || '未知');
      if (!byUser[key]) byUser[key] = [];
      byUser[key].push(msg);
    });

    list.innerHTML = '';
    Object.entries(byUser).forEach(([name, msgs]) => {
      const lastMsg = msgs[msgs.length - 1];
      const unread = msgs.filter(m => !m.isMine && m.status !== 'burned').length;
      const lastIsBurn = lastMsg.isBurn;

      const item = document.createElement('div');
      item.className = 'chat-item' + (unread > 0 ? ' unread' : '');
      item.onclick = () => goToChat();

      let preview = escapeHtml(lastMsg.text || '');
      let previewClass = 'chat-preview';

      if (lastIsBurn) {
        preview = `<span class="secret-placeholder">🔴 <span>[私密消息] 对方发送了一条阅后即焚消息</span></span>`;
        previewClass = 'chat-preview burned';
      } else if (lastMsg.status === 'burned') {
        preview = `<span style="color:var(--text-muted);font-style:italic">🔥 消息已销毁</span>`;
      }

      const timeStr = new Date(lastMsg.receivedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit', minute: '2-digit'
      });

      item.innerHTML = `
        <div class="chat-avatar ${lastIsBurn && unread > 0 ? 'burn-msg' : ''}">${name.charAt(0).toUpperCase()}</div>
        <div class="chat-info">
          <div class="chat-name">${escapeHtml(name)} ${lastIsBurn ? '<span class="badge-burn">🔥焚</span>' : ''}</div>
          <div class="${previewClass}">${preview}</div>
        </div>
        <div class="chat-meta">
          <span class="chat-time">${timeStr}</span>
          ${unread > 0 ? '<span class="unread-dot"></span>' : ''}
        </div>
      `;
      list.appendChild(item);
    });
  }

  function addSystemMsg(text, isBurnNotice) {
    const area = document.getElementById('message-area');
    if (!area) return;
    const div = document.createElement('div');
    div.className = 'system-msg' + (isBurnNotice ? ' burn-notice' : '');
    div.textContent = text;
    area.appendChild(div);
    scrollToBottom();
  }

  // ═══════════════════════════════════════════════
  // 防截屏安全（移动端核心）
  // ═══════════════════════════════════════════════
  function initSecurity() {
    if (!STATE.screenshotProtection) return;

    // Android: FLAG_SECURE 等效（通过 CSS user-select: none 和 overlay）
    // iOS: 监听截屏通知
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      // iOS 不允许直接监听截图，但可以监听 visibilitychange
    }

    // 检测页面可见性变化（切后台 = 销毁）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        burnAllMessages();
      }
    });

    // 防复制（可选）
    document.addEventListener('copy', (e) => {
      const selection = window.getSelection().toString();
      if (selection.length > 0) {
        // 在私密模式下阻止复制
        const activePage = document.querySelector('.page.active');
        if (activePage && activePage.id === 'page-chat') {
          e.preventDefault();
          toast('⚠️ 私密模式禁止复制');
        }
      }
    });

    // 键盘快捷键防截屏（桌面端）
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'PrintScreen') ||
          (e.ctrlKey && e.key === 'p') ||
          (e.ctrlKey && e.shiftKey && e.key === 's')) {
        if (STATE.screenshotProtection) {
          e.preventDefault();
          showBurnOverlay('⚠️ 截屏已被拦截');
          setTimeout(() => hideBurnOverlay(), 1500);
        }
      }
    });
  }

  function burnAllMessages() {
    Object.keys(STATE.pendingBurns).forEach(msgId => {
      burnMessage(msgId);
    });
  }

  // ═══════════════════════════════════════════════
  // 页面导航
  // ═══════════════════════════════════════════════
  function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    if (page) page.classList.add('active');
  }

  function login() {
    const username = (document.getElementById('input-username').value || '').trim();
    const room = (document.getElementById('input-room').value || 'default').trim();

    if (!username) {
      toast('⚠️ 请输入昵称');
      return;
    }

    STATE.username = username;
    STATE.room = room;
    STATE.defaultBurn = document.getElementById('toggle-default-burn')?.checked ?? true;

    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = '⏳ 连接中...';

    connect();
  }

  function goToChat() {
    showPage('chat');
    STATE.currentView = 'chat';
    document.getElementById('chat-room-name').textContent = STATE.room;
    renderChatList();
    document.getElementById('msg-input').focus();
    initSecurity();
  }

  function goToChatWith(username) {
    goToChat();
    // 可以在这里跳转到与特定用户的私聊
  }

  function goBack() {
    showPage('rooms');
    STATE.currentView = 'rooms';
    renderChatList();
  }

  // ═══════════════════════════════════════════════
  // 焚烧模式切换
  // ═══════════════════════════════════════════════
  function toggleBurnMode() {
    const isOn = document.getElementById('burn-toggle')?.checked;
    const input = document.getElementById('msg-input');
    const ttlRow = document.getElementById('ttl-row');
    const burnText = document.getElementById('burn-text');
    const burnIcon = document.getElementById('burn-icon');

    if (isOn) {
      input?.classList.add('burn-active');
      ttlRow.style.display = 'flex';
      burnText.textContent = '阅后即焚';
      burnIcon.textContent = '🔥';
    } else {
      input?.classList.remove('burn-active');
      ttlRow.style.display = 'none';
      burnText.textContent = '普通消息';
      burnIcon.textContent = '💬';
    }
  }

  function setTTL(seconds) {
    STATE.defaultTTL = parseInt(seconds);
    document.querySelectorAll('.ttl-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.ttl === String(seconds));
    });
  }

  // ═══════════════════════════════════════════════
  // 设置弹窗
  // ═══════════════════════════════════════════════
  function showBurnSettings() {
    document.getElementById('setting-default-ttl').value = STATE.defaultTTL;
    document.getElementById('setting-default-burn').checked = STATE.defaultBurn;
    document.getElementById('setting-screenshot').checked = STATE.screenshotProtection;
    document.getElementById('modal-burn-settings').classList.add('active');
  }

  function saveSettings() {
    STATE.defaultTTL = parseInt(document.getElementById('setting-default-ttl').value);
    STATE.defaultBurn = document.getElementById('setting-default-burn').checked;
    STATE.screenshotProtection = document.getElementById('setting-screenshot').checked;
    document.getElementById('burn-toggle').checked = STATE.defaultBurn;
    toggleBurnMode();
    closeModal('modal-burn-settings');
    toast('💾 设置已保存');
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
  }

  // ═══════════════════════════════════════════════
  // Toast 提示
  // ═══════════════════════════════════════════════
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  // ═══════════════════════════════════════════════
  // 焚烧覆盖层
  // ═══════════════════════════════════════════════
  function showBurnOverlay(text) {
    const el = document.getElementById('burn-overlay');
    const textEl = document.getElementById('burn-overlay-text');
    if (textEl) textEl.textContent = text || '消息正在销毁...';
    el.classList.add('active');
  }

  function hideBurnOverlay() {
    document.getElementById('burn-overlay').classList.remove('active');
  }

  // ═══════════════════════════════════════════════
  // 连接状态
  // ═══════════════════════════════════════════════
  function setConnected(status) {
    STATE.connected = status;
    const dot = document.querySelector('.dot-green, .dot-red');
    const statusEl = document.getElementById('conn-status');
    if (statusEl) {
      statusEl.innerHTML = status
        ? '<span class="dot-green"></span> 已连接'
        : '<span class="dot-red"></span> 断开中';
    }
    const btn = document.getElementById('btn-login');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>🚀</span> 进入私密聊天室';
    }
  }

  // ═══════════════════════════════════════════════
  // 工具函数
  // ═══════════════════════════════════════════════
  function scrollToBottom() {
    const area = document.getElementById('message-area');
    if (area) setTimeout(() => area.scrollTop = area.scrollHeight, 50);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
  }

  function appendLog(msg) {
    console.log('[XG]', msg);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ═══════════════════════════════════════════════
  // Service Worker 注册（PWA 离线支持）
  // ═══════════════════════════════════════════════
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(reg => appendLog('SW registered'))
        .catch(err => appendLog('SW error: ' + err));
    }
  }

  // ═══════════════════════════════════════════════
  // 公开 API（供 HTML onclick 调用）
  // ═══════════════════════════════════════════════
  window.app = {
    login,
    goToChat,
    goToChatWith,
    goBack,
    sendMessage,
    onKeyDown,
    toggleBurnMode,
    setTTL,
    showBurnSettings,
    saveSettings,
    closeModal,
  };

  // ═══════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    registerSW();
    initSecurity();

    // 绑定全局点击关闭弹窗
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
      }
    });

    // 设置默认 TTL
    setTTL(STATE.defaultTTL);

    appendLog('XG Mobile PWA ready');
  });

})();
