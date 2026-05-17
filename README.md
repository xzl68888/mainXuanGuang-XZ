# XuanGuang Group - 加密自焚终端

## 简介

XuanGuang Group 是一款专注于隐私保护的桌面通讯应用，提供端到端加密的「阅后即焚」消息服务。

## 功能特性

- 🔐 端到端加密 - AES-GCM 256位算法
- ⏱️ 定时销毁 - 10秒/30秒/60秒可选
- 💨 消散动画 - 优雅的模糊消失效果
- 🎨 现代化 UI - Telegram 风格界面
- 💻 桌面应用 - 基于 Electron 构建

## 快速开始

```bash
npm install
npm start
npm run dist
```

## 安全修复说明

| 项目 | 修复前 | 修复后 |
|------|--------|--------|
| nodeIntegration | `true` ⚠️ | `false` ✅ |
| contextIsolation | `false` ⚠️ | `true` ✅ |
| sandbox | 未设置 ⚠️ | `true` ✅ |
| preload | 无 ⚠️ | `preload.js` ✅ |
| CSP | 无 / `unsafe-inline` ⚠️ | `script-src 'self'` ✅ |
| inline-js | `onclick=` ⚠️ | `addEventListener` ✅ |
| XSS 防护 | 无 ⚠️ | `escapeHtml()` ✅ |

## 许可证

MIT License

：根 {
    --brand-cyan: #88eeff;
    --bg-dark: #0e1621;
    --panel-bg: #17212b;
}

身体 {
    边距：0；
    background: #0e1621 url('bg.jpg.jpg') no-repeat center center fixed;
    background-size: cover;
    颜色：白色；
    font-family: 'Segoe UI', sans-serif;
}
body::before {
    内容： '';
    位置：固定；
    插入：0；
    背景色：rgba(14, 22, 33, 0.55);
    z-index：0；
}
.app-container {
    显示方式：flex；
    弯曲方向：柱；
    高度：100vh；
    位置：相对；
    z-index：1；
}

.brand-header {
    显示方式：flex；
    align-items: center;
    内边距：15px；
    background: var(--panel-bg);
    border-bottom: 2px solid var(--brand-cyan);
}
.app-logo {
    宽度：45像素；
    高度：45像素；
    圆角半径：8px；
    margin-right: 15px;
    border: 1px solid var(--brand-cyan);
    object-fit: 覆盖;
}
.brand-info h1 { font-size: 18px; margin: 0; color: var(--brand-cyan); letter-spacing: 2px; }
.brand-info span { font-size: 10px; opacity: 0.6; }

.connection-panel { padding: 10px 15px; background: #1c2733; border-bottom: 1px solid #2f3e4c; }
.status-bar { font-size: 12px; color: var(--brand-cyan); }

.chat-area { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px; }
。信息 {
    最大宽度：70%；
    内边距：12px；
    圆角半径：12px；
    背景色：#182533；
    位置：相对；
    过渡：全部缓动 0.8 秒；
    动画：淡入 0.3 秒，缓出；
}
.sent { align-self: flex-end; background: #2b5278; border-right: 3px solid var(--brand-cyan); }

.crypto-tag { font-size: 10px; color: var(--brand-cyan); margin-bottom: 5px; opacity: 0.8; }
.text-content { word-break: break-word; }
.timer-bar { height: 2px; background: var(--brand-cyan); width: 100%; margin-top: 8px; border-radius: 2px; }

.input-area { padding: 20px; background: var(--panel-bg); display: flex; gap: 10px; align-items: center; }
select { background: #242f3d; border: 1px solid #2f3e4c; color: white; padding: 10px; border-radius: 5px; }
输入 {
    弹性：1；
    背景色：#242f3d；
    border: 1px solid #2f3e4c;
    颜色：白色；
    内边距：10px；
    圆角半径：5px；
}
.send-btn {
    背景色：var(--brand-cyan);
    颜色：#000；
    字体粗细：粗体；
    边框：无；
    padding: 0 25px;
    圆角半径：5px；
    光标：指针；
    高度：40像素；
}
.send-btn:hover { background: #aaf5ff; }

@keyframes fadeIn {
    从 { opacity: 0; transform: translateY(10px); }
    设置为 { opacity: 1; transform: translateY(0); }
    
