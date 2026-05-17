// chat-c​​lient.js - 使用 WebRTC + WebSocket 信令的聊天客户端

const serverUrl = 'http://localhost:3000';
const wsUrl = 'ws://localhost:3000';

let token = localStorage.getItem('token');
let userId = localStorage.getItem('userId');
let username = localStorage.getItem('username');
let ws = null;
let sessionKey = null;
let currentPeerId = null;
let currentPeerUsername = null;
let pendingCalls = new Map();

// 初始化
异步函数 init() {
    如果 (!token) {
        window.location = 'login.html';
        返回;
    }
    
    document.getElementById('myName').textContent = username;
    document.getElementById('myAvatar').textContent = username.charAt(0).toUpperCase();
    
    sessionKey = await CryptoModule.generateKey();
    
    setupWebRTC();
    connectWebSocket();
    setupEventListeners();
}

function setupWebRTC() {
    如果 (!window.webrtc) {
        console.error('WebRTC 不可用');
        返回;
    }
    
    window.webrtc.onMessage((peerId, msg) => {
        handleIncomingMessage(peerId, msg);
    });
    
    window.webrtc.onConnect((peerId) => {
        updateChatStatus('已连接 - 端到端加密');
    });
    
    window.webrtc.onDisconnect((peerId) => {
        updateChatStatus('已断开连接');
        if (peerId === currentPeerId) {
            currentPeerId = null;
        }
    });
}

function connectWebSocket() {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
    };
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleWebSocketMessage(msg);
    };
    
    ws.onclose = () => {
        console.log('WebSocket 已断开连接');
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (e) => console.error('WebSocket 错误：', e);
}

function handleWebSocketMessage(msg) {
    switch (msg.type) {
        case 'auth_success':
            console.log('WebSocket 已认证');
            休息;
            
        case 'user_list':
            updateUserList(msg.users);
            休息;
            
        case 'call_request':
            处理呼叫请求(msg);
            休息;
            
        case 'call_response':
            处理呼叫响应(msg);
            休息;
            
        情况'signal'：
            处理信号(msg);
            休息;
    }
}

function updateUserList(users) {
    const list = document.getElementById('userList');
    list.innerHTML = 用户
        .filter(u => u.id !== userId)
        .map(u => `
            <div class="user-item" data-id="${u.id}" data-name="${u.username}">
                <div class="avatar">${u.username.charAt(0).toUpperCase()}</div>
                <div class="name">${u.username}</div>
            </div>
        `).join('');
    
    document.querySelectorAll('.user-item').forEach(item => {
        item.addEventListener('click', () => startChat(item.dataset.id, item.dataset.name));
    });
}

异步函数 startChat(peerId, peerName) {
    currentPeerId = peerId;
    currentPeerUsername = peerName;
    
    document.getElementById('chatHeader').style.display = 'block';
    document.getElementById('inputArea').style.display = 'flex';
    document.getElementById('chatName').textContent = peerName;
    document.getElementById('messagesArea').innerHTML = '';
    
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === peerId);
    });
    
    updateChatStatus('正在连接...');
    
    // 请求呼叫
    ws.send(JSON.stringify({
        类型：'call_request'，
        targetId：peerId
    }));
}

function handleCallRequest(msg) {
    // 目前是自动接受，以后可能会添加用户界面确认
    const accept = confirm(`${msg.fromUsername} 想要聊天。接受吗？`);
    
    ws.send(JSON.stringify({
        类型：'call_response'，
        targetId: msg.fromId,
        已接受：接受
    }));
    
    如果（接受）{
        currentPeerId = msg.fromId;
        currentPeerUsername = msg.fromUsername;
        
        document.getElementById('chatHeader').style.display = 'block';
        document.getElementById('inputArea').style.display = 'flex';
        document.getElementById('chatName').textContent = msg.fromUsername;
        document.getElementById('messagesArea').innerHTML = '';
        
        updateChatStatus('正在接受连接...');
    }
}

异步函数 handleCallResponse(msg) {
    如果 (msg.accepted) {
        updateChatStatus('正在创建P2P连接...');
        
        const result = await window.webrtc.createOffer();
        当前PeerId = 结果.peerId;
        
        ws.send(JSON.stringify({
            类型：'信号'
            targetId: currentPeerId,
            数据：{ type: 'offer', offer: result.offer, peerId: result.peerId }
        }));
    } 别的 {
        updateChatStatus('通话被拒绝');
    }
}

异步函数 handleSignal(msg) {
    const data = msg.data;
    
    如果 (data.type === 'offer') {
        const result = await window.webrtc.handleOffer(data.offer);
        
        ws.send(JSON.stringify({
            类型：'信号'
            targetId: msg.fromId,
            数据：{ type: 'answer', answer: result.answer, peerId: result.peerId }
        }));
    } else if (data.type === 'answer') {
        await window.webrtc.applyAnswer(data.peerId, data.answer);
    }
}

异步函数 sendMessage() {
    const input = document.getElementById('messageInput');
    const timer = parseInt(document.getElementById('timerSelect').value, 10);
    const text = input.value.trim();
    
    如果 (!text || !sessionKey) 返回；
    
    input.value = '';
    
    const { encrypted, iv } = await CryptoModule.encryptMessage(text, sessionKey);
    const msgData = JSON.stringify({ encrypted, iv, timer });
    
    window.webrtc.sendToAll(msgData);
    
    displayMessage(text, timer, '已发送');
}

异步函数 handleIncomingMessage(peerId, msgData) {
    尝试 {
        const data = JSON.parse(msgData);
        const decrypted = await CryptoModule.decryptMessage(data.encrypted, sessionKey, data.iv);
        displayMessage(decrypted, data.timer, 'received');
    } catch (e) {
        console.error('解密错误：', e);
    }
}

function displayMessage(text, timer, type) {
    const area = document.getElementById('messagesArea');
    
    // 如果存在空状态，则清除该状态
    如果 (area.querySelector('.empty-chat')) {
        area.innerHTML = '';
    }
    
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ' + type;
    msgDiv.innerHTML = `
        <div class="text">${escapeHtml(text)}</div>
        <div class="timer">在 ${timer} 秒后自毁</div>
    `;
    area.appendChild(msgDiv);
    area.scrollTop = area.scrollHeight;
    
    // 自毁
    setTimeout(() => {
        msgDiv.style.transition = '全部 0.5 秒';
        msgDiv.style.filter = 'blur(20px)';
        msgDiv.style.opacity = '0';
        setTimeout(() => msgDiv.remove(), 500);
    }, timer * 1000);
}

function updateChatStatus(status) {
    document.getElementById('chatStatus').textContent = 状态;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    返回 div.innerHTML；
}

function setupEventListeners() {
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('messageInput').addEventListener('keydown', (e) => {
        如果 (e.key === 'Enter') sendMessage();
    });
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.clear();
        window.location = 'login.html';
    });
}

初始化();
