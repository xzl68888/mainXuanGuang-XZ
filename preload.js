// preload.js - Electron 预加载脚本 (安全桥接)

const { contextBridge, ipcRenderer } = require('electron');

// 向渲染进程暴露安全的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 获取服务器 URL
  getServerUrl: () => 'http://localhost:10000',

  // 平台信息
  platform: process.platform,

  // 安全消息发送 (预留)
  sendSecureMessage: async (messageData) => {
    return await ipcRenderer.invoke('secure-channels:send', messageData);
  },
});
