# XG 自焚聊天室 v2.0

**阅后即焚** - 所有消息在设定时间后自动销毁，无法恢复。

## ✨ 特性

- 🔐 **AES-256-GCM 端到端加密** - 消息在客户端加密后传输
- ⏱️ **定时销毁** - 5秒/10秒/30秒/60秒/5分钟可选
- 💬 **实时聊天** - WebSocket 实时通信，支持多房间
- 👥 **在线用户** - 实时显示房间内在线用户
- 🎨 **现代化 UI** - 深色主题，优雅动画
- 💻 **桌面支持** - 可打包为 Electron 桌面应用

## 🚀 快速开始

### 方式一：Web 模式（推荐）

```bash
# 克隆仓库
git clone https://github.com/xzl68888/mainXuanGuang-XZ.git
cd mainXuanGuang-XZ

# 启动服务器
npm start

# 浏览器访问 http://localhost:10000
```

### 方式二：Electron 桌面应用

```bash
# 安装依赖
npm install

# 启动桌面应用
npm run electron
```

## 📁 项目结构

```
mainXuanGuang-XZ/
├── server.js        # WebSocket + HTTP 服务器
├── main.js          # Electron 主进程
├── preload.js       # Electron 预加载脚本
├── module.js        # AES-GCM 加密模块
├── chat-app.js      # 聊天客户端逻辑
├── login.html       # 登录页面
├── chat.html        # 聊天主界面
├── index.html       # 旧版演示页面（保留）
├── package.json     # 项目配置
└── README.md        # 本文档
```

## 🔒 安全特性

| 特性 | 状态 |
|------|------|
| AES-256-GCM 加密 | ✅ |
| 客户端加密 | ✅ |
| 路径遍历防护 | ✅ |
| XSS 防护 (escapeHtml) | ✅ |
| 消息长度限制 | ✅ |
| TTL 范围限制 | ✅ |

## 🎯 使用说明

1. **输入用户名** - 进入登录页面，输入你的代号
2. **选择房间** - 可选填房间号，留空使用默认房间
3. **发送消息** - 输入消息，选择自毁时间，点击发送
4. **消息销毁** - 倒计时结束后，消息自动模糊消失

## 📝 更新日志

### v2.0.0 (2026-05-18)
- 🔄 完全重构，修复所有 JavaScript 语法错误
- ✨ 新增 WebSocket 实时多用户聊天
- ✨ 新增登录系统和多房间支持
- ✨ 新增在线用户列表
- 🔒 增强 AES-256-GCM 端到端加密
- 🎨 全新 UI 设计，深色主题
- 📱 响应式设计，支持移动端

### v1.0.0
- 初始版本

## 📜 License

MIT License
