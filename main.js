const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        宽度：1000，
        高度：700，
        icon: path.join(__dirname, 'logo.jpg.jpg'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            沙箱：否
        }
    });
    win.loadFile(path.join(__dirname, 'login.html'));
}

app.whenReady().then(() => {
    创建窗口();

    // ✅ IPC 处理器：接收渲染进程的加密消息
    ipcMain.handle('secure-channels:send', async (event, messageData) => {
        console.log('🔐收到加密消息:', messageData);
        // TODO：实现的加密和发送逻辑
        // 1.使用CryptoModule加密消息
        // 2.通过WebRTC或服务器发送给对方
        返回 { success: true };
    });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
