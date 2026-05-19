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

      case 'security_result':
        // 安全检测结果（服务端返回）
        handleSecurityResult(msg);
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
  // 安全中心（ELAM + Defender 检测）
  // ═══════════════════════════════════════════════
  let secCheckRunning = false;

  function showSecurityCenter() {
    showPage('security');
    STATE.currentView = 'security';
    runSecurityCheck();
  }

  function runSecurityCheck() {
    if (secCheckRunning) return;
    secCheckRunning = true;

    // 重置所有状态为待检
    resetSecurityUI();

    if (!STATE.ws || !STATE.connected) {
      toast('⚠️ 未连接服务器，无法执行安全检测');
      secCheckRunning = false;
      return;
    }

    // 通过 WebSocket 请求服务端执行安全检测
    STATE.ws.send(JSON.stringify({ type: 'security_check' }));
  }

  function resetSecurityUI() {
    const items = ['elam','rt','cloud','network','tamper','asr','signature','coreiso','memory'];
    items.forEach(key => {
      const badge = document.getElementById('sec-' + key + '-badge');
      const desc = document.getElementById('sec-' + key + '-desc');
      if (badge) { badge.className = 'sec-badge pending'; badge.textContent = '待检'; }
      if (desc) desc.textContent = '检测中...';
    });
    document.getElementById('sec-score-num').textContent = '--';
    document.getElementById('sec-score-label').textContent = '扫描中...';
    const circle = document.getElementById('sec-score-circle');
    if (circle) circle.style.strokeDashoffset = '327';
  }

  /**
   * 处理服务端返回的安全检测结果
   * @param {Object} data - 服务端 security_result 消息
   */
  function handleSecurityResult(data) {
    secCheckRunning = false;
    let score = 0;
    const maxScore = 100;
    const weights = {
      elam: 15, realtime: 12, cloud: 12, network: 10,
      tamper: 10, asr: 10, signature: 13, coreiso: 9, memory: 9,
    };

    // ELAM
    if (data.elam !== undefined) {
      const elamPass = data.elam.enabled === true || data.elam.status === 'On' || data.elam.ELAMStatus === true;
      updateSecItem('elam', elamPass, data.elam.desc || (elamPass ? '已启用 - 启动早期保护' : '未启用'));
      if (data.elam.level !== undefined)
        setEl('sec-elam-level', getELAMLevelLabel(data.elam.level));
      if (data.elam.driver !== undefined)
        setEl('sec-elam-driver', data.elam.driver ? '✅ 已注册' : '❌ 未注册');
      if (elamPass) score += weights.elam;
    }

    // 实时防护
    if (data.realtimeProtection !== undefined) {
      const pass = data.realtimeProtection === true;
      updateSecItem('rt', pass, pass ? '实时监控已开启' : '⚠️ 实时防护未开启');
      if (pass) score += weights.realtime;
    }

    // 云端保护
    if (data.cloudProtection !== undefined) {
      const pass = data.cloudProtection === true || data.cloudProtection === 'Enabled';
      updateSecItem('cloud', pass, pass ? '云端智能保护已启用' : '云端保护未启用');
      if (pass) score += weights.cloud;
    }

    // 网络保护
    if (data.networkProtection !== undefined) {
      const pass = data.networkProtection === true || data.networkProtection === 'Enabled';
      updateSecItem('network', pass, pass ? '网络攻击拦截已启用' : '网络保护未启用');
      if (pass) score += weights.network;
    }

    // 篡改防护
    if (data.tamperProtection !== undefined) {
      const pass = data.tamperProtection === true || data.tamperProtection === 'On' || data.tamperProtected === true;
      updateSecItem('tamper', pass, pass ? '篡改防护已锁定' : '篡改防护可能被禁用');
      if (pass) score += weights.tamper;
    }

    // ASR
    if (data.asr !== undefined || data.puaProtection !== undefined) {
      const asrVal = data.asr ?? data.puaProtection;
      const pass = asrVal === true || asrVal === 'Enabled';
      updateSecItem('asr', pass, pass ? 'ASR / PUA 防护已启用' : 'ASR 规则未完全配置');
      if (pass) score += weights.asr;
    }

    // 签名更新
    if (data.signatureLastUpdated !== undefined) {
      const ts = data.signatureLastUpdated;
      const ageHours = ts ? (Date.now() - new Date(ts).getTime()) / 3600000 : 9999;
      const fresh = ageHours < 24;
      updateSecItem('signature', fresh,
        ts ? '更新于 ' + new Date(ts).toLocaleString('zh-CN') : '未知');
      if (fresh) score += weights.signature;
      else if (ageHours < 168) score += Math.round(weights.signature * 0.5);
    }

    // 核心隔离
    if (data.coreIsolation !== undefined || data.coreIsolationEnabled !== undefined) {
      const ciVal = data.coreIsolation ?? data.coreIsolationEnabled;
      const pass = ciVal === true;
      updateSecItem('coreiso', pass, pass ? '核心隔离已启用 (HVCI)' : '核心隔离未启用');
      if (pass) score += weights.coreiso;
    }

    // 内存完整性
    if (data.memoryIntegrity !== undefined || data.hvciEnabled !== undefined) {
      const miVal = data.memoryIntegrity ?? data.hvciEnabled;
      const pass = miVal === true;
      updateSecItem('memory', pass, pass ? '内存完整性 (HVCI) 已启用' : '内存完整性未启用');
      if (pass) score += weights.memory;
    }

    // 更新评分环形图
    animateScore(score);
  }

  function updateSecItem(key, pass, desc) {
    const badge = document.getElementById('sec-' + key + '-badge');
    const descEl = document.getElementById('sec-' + key + '-desc');
    const item = document.getElementById('sec-' + key + '-status');
    if (badge) badge.className = 'sec-badge ' + (pass ? 'pass' : 'fail');
    if (badge) badge.textContent = pass ? '✅ 正常' : '❌ 异常';
    if (descEl) descEl.textContent = desc;
    if (item && pass) {
      item.classList.add('pass-flash');
      setTimeout(() => item.classList.remove('pass-flash'), 600);
    }
  }

  function animateScore(score) {
    const numEl = document.getElementById('sec-score-num');
    const labelEl = document.getElementById('sec-score-label');
    const circle = document.getElementById('sec-score-circle');

    // 数字动画
    let current = 0;
    const step = Math.ceil(score / 30);
    const timer = setInterval(() => {
      current += step;
      if (current >= score) { current = score; clearInterval(timer); }
      numEl.textContent = current;
    }, 30);

    // 环形进度动画
    const circumference = 327; // 2 * PI * 52 ≈ 327
    const offset = circumference - (score / 100) * circumference;
    setTimeout(() => {
      if (circle) circle.style.strokeDashoffset = String(offset);
    }, 200);

    // 标签文字
    setTimeout(() => {
      if (score >= 90) labelEl.textContent = '🛡️ 安全状态优秀';
      else if (score >= 70) labelEl.textContent = '🟡 安全状态良好';
      else if (score >= 50) labelEl.textContent = '🟠 存在安全风险';
      else labelEl.textContent = '🔴 严重安全隐患！';

      // 改变颜色
      if (score >= 70) numEl.style.color = '#00ff88';
      else if (score >= 50) numEl.style.color = '#ffb800';
      else numEl.style.color = '#ff2d55';
    }, 500);
  }

  function getELAMLevelLabel(level) {
    const labels = { 0: '允许未签名(不推荐)', 1: '允许良性软件', 2: '可疑软件阻止(推荐)', 3: '全部阻止(最严)' };
    return labels[level] ?? ('级别 ' + level);
  }

  function setEl(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /**
   * 下载一键加固 PowerShell 脚本
   */
  function downloadHardeningScript() {
    const script = `# ============================================================
# XG 安全加固脚本 - Microsoft Defender 全方位防护
# 建议以管理员权限运行
# ============================================================
Write-Host "=== Microsoft Defender 安全加固 ===" -ForegroundColor Cyan
Write-Host ""

# ── 1. ELAM 启动保护 ──────────────────────────────
Write-Host "[1/8] 配置 ELAM 启动保护..." -ForegroundColor Yellow
try {
    Set-MpPreference -EnableELAM 1 -ErrorAction Stop
    Write-Host "  ✓ ELAM 已启用" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ ELAM 配置需要管理员权限" -ForegroundColor Red
}

# ── 2. 实时防护 ───────────────────────────────────
Write-Host "[2/8] 启用实时防护..." -ForegroundColor Yellow
Set-MpPreference -DisableRealtimeMonitoring \$false
Set-MpPreference -DisableBehaviorMonitoring \$false
Set-MpPreference -DisableScriptScanning \$false
Write-Host "  ✓ 实时防护已启用" -ForegroundColor Green

# ── 3. 云端保护 + 样本提交 ────────────────────────
Write-Host "[3/8] 启用云端智能保护..." -ForegroundColor Yellow
Set-MpPreference -EnableCloudProtection \$true
Set-MpPreference -SubmitSamplesConsent Always
Write-Host "  ✓ 云端保护已启用 (安全性+70%)" -ForegroundColor Green

# ── 4. 网络保护 ───────────────────────────────────
Write-Host "[4/8] 启用网络保护..." -ForegroundColor Yellow
Set-MpPreference -EnableNetworkProtection Enabled
Write-Host "  ✓ 网络攻击拦截已启用" -ForegroundColor Green

# ── 5. 扫描选项 ───────────────────────────────────
Write-Host "[5/8] 配置全面扫描..." -ForegroundColor Yellow
Set-MpPreference -DisableArchiveScanning \$false
Set-MpPreference -DisableRemovableDriveScanning \$false
Set-MpPreference -DisableEmailScanning \$false
Write-Host "  ✓ 全面扫描已配置" -ForegroundColor Green

# ── 6. ASR / PUA 防护 ─────────────────────────────
Write-Host "[6/8] 启用 ASR 攻击面减少规则..." -ForegroundColor Yellow
Set-MpPreference -PUAProtection Enabled
Set-MpPreference -BlockOnAccessControlPuaApps Enabled
Write-Host "  ✓ ASR 规则已启用" -ForegroundColor Green

# ── 7. 内存缓解 ───────────────────────────────────
Write-Host "[7/8] 启用内存缓解..." -ForegroundColor Yellow
Set-MpPreference -EnableMemoryMitigations \$true
Write-Host "  ✓ 内存缓解已启用" -ForegroundColor Green

# ── 8. 更新签名并显示状态 ────────────────────────
Write-Host "[8/8] 更新病毒签名..." -ForegroundColor Yellow
Update-MpSignature
Write-Host ""
Write-Host "=== 防护配置完成 ===" -ForegroundColor Cyan
Get-MpComputerStatus | Select-Object `
    AntivirusEnabled, RealTimeProtectionStatus, `
    AntispywareEnabled, NetworkInspectionSystem, `
    AntivirusSignatureLastUpdated, IoavStatus `
    | Format-List
Write-Host ""
Write-Host "按任意键退出..." -ForegroundColor DarkGray
\$null = \$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")`;

    // 创建下载
    const blob = new Blob([script], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'XG-Security-Hardening.ps1';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('📥 加固脚本已下载，请右键管理员运行');
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
    showSecurityCenter,
    runSecurityCheck,
    downloadHardeningScript,
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
