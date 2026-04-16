# 🤖 SHADOW-X-MINI WhatsApp Bot

A powerful multi-device WhatsApp bot with advanced features.

## ✨ Features

- 🔗 **Dual Pairing Methods** - Connect via 8-digit code OR QR code
- 👁️ **Auto Status View** - Automatically views status updates
- ❤️ **Auto React** - Random reactions to statuses
- 🗑️ **Anti Delete** - Notifies when messages are deleted
- 🎵 **Media Download** - Songs, TikTok, Facebook videos
- 🤖 **AI Chat** - Gemini-powered conversational AI
- 🔍 **Google Search** - Search the web directly
- 📦 **NPM Package Info** - Get package details
- 📲 **APK Download** - Download Android apps
- 🎮 **Boom/Bomb** - Bulk message sender
- 🆔 **JID & CID** - Get chat/Channel IDs
- 🖼️ **Profile Picture** - Download any user's DP

## 📋 Commands

| Command | Description |
|---------|-------------|
| `.alive` | Check bot status |
| `.menu` | Show all commands |
| `.ping` | Check bot speed |
| `.owner` | Show bot owner |
| `.system` | System information |
| `.song <name>` | Download song |
| `.fb <url>` | Download Facebook video |
| `.tiktok <url>` | Download TikTok video |
| `.tiktoksearch <query>` | Search TikTok |
| `.apk <name>` | Download APK |
| `.npm <package>` | NPM package info |
| `.google <query>` | Google search |
| `.ai <prompt>` | Chat with AI |
| `.getdp <number>` | Get profile picture |
| `.boom <number>,<msg>,<count>` | Bulk message |
| `.pair <code>` | Pair device |
| `.jid` | Get JID |
| `.cid <link>` | Get channel info |

## 🚀 Deployment

### Deploy on Render
1. Create a new Web Service
2. Connect your GitHub repository
3. Build Command: `npm install`
4. Start Command: `npm start`

### Deploy on Heroku
```bash
heroku create your-bot-name
git push heroku main
