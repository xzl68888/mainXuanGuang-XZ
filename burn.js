// burn.js - 集成 WebRTC 的主消息处理程序

function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    返回 div.innerHTML；
}

let sessionKey = null;
let connectedPeers = [];

异步函数 initApp() {
    sessionKey = await CryptoModule.generateKey();
    updateStatus('加密已准备就绪 - 连接开始');

    // 设置 WebRTC 回调
    如果 (window.webrtc) {
        window.webrtc.onMessage((peerId, msg) => {
            handleIncomingMessage(peerId, msg);
        });
        window.webrtc.onConnect((peerId) => {
            connectedPeers.push(peerId);
            updateStatus('已连接：' + connectedPeers.length + ' 个对等节点');
        });
        window.webrtc.onDisconnect((peerId) => {
            connectedPeers = connectedPeers.filter(id => id !== peerId);
            updateStatus('剩余对等节点数 - ' + connectedPeers.length + ' 个对等节点');
        });
    }
}

function updateStatus(text) {
    const statusBar = document.getElementById('statusBar');
    if (statusBar) statusBar.textContent = 文本;
}

异步函数 handleIncomingMessage(peerId, encryptedMsg) {
    尝试 {
        const data = JSON.parse(encryptedMsg);
        const decryptedText = await CryptoModule.decryptMessage(data.encrypted, sessionKey, data.iv);
        displayMessage(decryptedText, data.timer || 30, '已接收');
    } catch (e) {
        console.error('解密错误：', e);
    }
}

function displayMessage(text, timer, type) {
    const chatBox = document.getElementById('chatBox');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ' + type;
    msgDiv.innerHTML = `
        <div class="crypto-tag">端到端加密</div>
        <div class="text-content">${escapeHtml(text)}</div>
        <div class="timer-bar" style="transition: width ${timer}s linear"></div>
    `;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    setTimeout(() => {
        const bar = msgDiv.querySelector('.timer-bar');
        如果 (bar) bar.style.width = '0%';
    }, 10);

    setTimeout(() => {
        msgDiv.style.filter = 'blur(20px) brightness(1.5)';
        msgDiv.style.opacity = '0';
        msgDiv.style.transform = 'scale(1.2)';
        setTimeout(() => msgDiv.remove(), 1000);
    }, timer * 1000);
}

异步函数 sendMessage() {
    const input = document.getElementById('messageInput');
    const timer = parseInt(document.getElementById('timerSelect').value, 10);

    如果 (!input.value || !sessionKey) 返回；

    const rawText = input.value;
    input.value = '';

    const { encrypted, iv } = await CryptoModule.encryptMessage(rawText, sessionKey);
    const msgData = JSON.stringify({ encrypted, iv, timer });

    // 如果已连接，则通过 WebRTC 发送
    如果 (window.webrtc && connectedPeers.length > 0) {
        window.webrtc.sendToAll(msgData);
    }

    // 本地显示
    displayMessage(rawText, timer, '已发送');
}

// WebRTC 连接函数（通过 UI 调用）
异步函数 createOffer() {
    如果 (!window.webrtc) 返回 alert('WebRTC 不可用');
    const result = await window.webrtc.createOffer();
    document.getElementById('offerOutput').value = result.offer;
    document.getElementById('currentPeerId').value = result.peerId;
    updateStatus('Offer 已创建 - 复制并发送给对方');
}

异步函数 handleOffer() {
    如果 (!window.webrtc) 返回 alert('WebRTC 不可用');
    const offer = document.getElementById('offerInput').value;
    如果 (!offer) 返回 alert('请先粘贴报价');
    const result = await window.webrtc.handleOffer(offer);
    document.getElementById('answerOutput').value = result.answer;
    updateStatus('答案已创建 - 复制并发送');
}

异步函数 applyAnswer() {
    如果 (!window.webrtc) 返回 alert('WebRTC 不可用');
    const peerId = document.getElementById('currentPeerId').value;
    const answer = document.getElementById('answerInput').value;
    如果 (!answer) 返回 alert('请先粘贴答案');
    window.webrtc.applyAnswer(peerId, answer);
    updateStatus('正在连接...');
}

initApp();

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('sendBtn');
    如果 (btn) btn.addEventListener('click', sendMessage);
    const input = document.getElementById('messageInput');
    if (input) input.addEventListener('keydown', (e) => {
        如果 (e.key === 'Enter') sendMessage();
    });
});
