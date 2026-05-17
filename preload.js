// preload.js - 向渲染器暴露 API
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const WebRTCManager = require(path.join(__dirname, 'webrtc-manager.js'));

const manager = new WebRTCManager();

contextBridge.exposeInMainWorld('webrtc', {
    onMessage: (cb) => manager.onMessage(cb),
    onConnect: (cb) => manager.onConnect(cb),
    onDisconnect: (cb) => manager.onDisconnect(cb),
    createOffer: () => manager.createOffer(),
    handleOffer: (offer) => manager.handleOffer(offer),
    applyAnswer: (peerId, 答案) => manager.applyAnswer(peerId, 答案),
    sendToAll: (msg) => manager.sendToAll(msg),
    sendTo: (peerId, msg) => manager.sendTo(peerId, msg),
    disconnectAll: () => manager.disconnectAll(),
    getMyId: () => manager.myId
});

contextBridge.exposeInMainWorld('electronAPI', {
    getServerUrl: () => 'http://localhost:3000',
    sendSecureMessage: async (messageData) => {
        return await ipcRenderer.invoke('secure-channels:send', messageData);
    }
