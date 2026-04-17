const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const axios = require('axios');
const yts = require('yt-search');
const fetch = require('node-fetch');
const os = require('os');
const { initUserEnvIfMissing } = require('./settingsdb');
const { initEnvsettings, getSetting } = require('./settings');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['🧩', '🉐', '💜', '🌸', '🪴', '💊', '💫', '🍂', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🤖', '🚩', '🥰', '🗿', '💜', '💙', '🌍', '🖤', '💚'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/Cp3Gab6TUCLA9SMpY48chd',
    ADMIN_LIST_PATH: './admin.json',
    IMAGE_PATH: 'https://files.catbox.moe/riqrud.jpg',
    NEWSLETTER_JID: '120363424090172812@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    BOT_NAME: 'HASHEN-X-MINI-V1',
    OWNER_NAME: '#hashen',
    OWNER_NUMBER: '94729101856',
    BOT_VERSION: '1.0.0',
    BOT_FOOTER: '> © HASHEN x ᴍɪɴɪ ʙᴏᴛ',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb7CLEtBKfi6ShfE6W31',
    BUTTON_IMAGES: {
        ALIVE: 'https://files.catbox.moe/riqrud.jpg',
        MENU: 'https://files.catbox.moe/riqrud.jpg',
        OWNER: 'https://files.catbox.moe/riqrud.jpg',
        SONG: 'https://files.catbox.moe/riqrud.jpg',
        VIDEO: 'https://files.catbox.moe/riqrud.jpg'
    }
};

// MongoDB Setup
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

const mongoUri = 'mongodb+srv://heshancamika_db_user:XM8EiSj9zHJLeMuG@cluster0.nimdgb1.mongodb.net/?appName=Cluster0';
const client = new MongoClient(mongoUri);
let db;

async function initMongo() {
    if (!db) {
        await client.connect();
        db = client.db('data1');
        await db.collection('sessions').createIndex({ number: 1 });
    }
    return db;
}

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `${title}\n\n${content}\n\n${footer}`;
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

function runtime(seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const dDisplay = d > 0 ? d + (d === 1 ? " day, " : " days, ") : "";
    const hDisplay = h > 0 ? h + (h === 1 ? " hour, " : " hours, ") : "";
    const mDisplay = m > 0 ? m + (m === 1 ? " minute, " : " minutes, ") : "";
    const sDisplay = s > 0 ? s + (s === 1 ? " second" : " seconds") : "";
    return dDisplay + hDisplay + mDisplay + sDisplay;
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) return { status: 'failed', error: 'Invalid group invite link' };
    const inviteCode = inviteCodeMatch[1];
    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) return { status: 'success', gid: response.gid };
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) errorMessage = 'Bot is not authorized to join';
            else if (error.message.includes('conflict')) errorMessage = 'Bot is already a member';
            else if (error.message.includes('gone')) errorMessage = 'Invite link invalid or expired';
            if (retries === 0) return { status: 'failed', error: errorMessage };
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const caption = formatMessage(
        '*Connected Successful ✅*',
        ` ◉Number: ${number}\n 🧚‍♂️ Status: Online`,
        `${config.BOT_FOOTER}`
    );
    for (const admin of admins) {
        try {
            await socket.sendMessage(`${admin}@s.whatsapp.net`, { image: { url: config.IMAGE_PATH }, caption });
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== config.NEWSLETTER_JID) return;
        try {
            const randomEmoji = '❤️‍🩹';
            const messageId = message.newsletterServerId;
            if (!messageId) return;
            let retries = config.MAX_RETRIES;
            while (retries > 0) {
                try {
                    await socket.newsletterReactMessage(config.NEWSLETTER_JID, messageId.toString(), randomEmoji);
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
        } catch (error) {
            console.error('Newsletter reaction error:', error);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
        try {
            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try { await socket.readMessages([message.key]); break; }
                    catch (error) {
                        retries--;
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        break;
                    } catch (error) {
                        retries--;
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;
        const messageKey = keys[0];
        try {
            const userJid = jidNormalizedUser(socket.user.id);
            const deletionTime = getSriLankaTimestamp();
            const message = formatMessage(
                '╭──◯',
                `│ \`D E L E T E\`\n│ *⦿ From :* ${messageKey.remoteJid}\n│ *⦿ Time:* ${deletionTime}\n│ *⦿ Type: Normal*\n╰──◯`,
                `${config.BOT_FOOTER}`
            );
            await socket.sendMessage(userJid, { image: { url: config.IMAGE_PATH }, caption: message });
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        let command = null;
        let args = [];
        let sender = msg.key.remoteJid;

        if (msg.message.conversation || msg.message.extendedTextMessage?.text) {
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            if (text.startsWith(config.PREFIX)) {
                const parts = text.slice(config.PREFIX.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        } else if (msg.message.buttonsResponseMessage) {
            const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
            if (buttonId && buttonId.startsWith(config.PREFIX)) {
                const parts = buttonId.slice(config.PREFIX.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        }

        if (!command) return;

        try {
            switch (command) {
                case 'alive': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);
                    const title = '*⛩HASHEN X MINI V1 🧚‍♂️⛩*';
                    const content = `*© ᴘᴏᴡᴇʀᴅ ʙʏ hashen ⛩🧚‍♂️*\n*ʙᴏᴛ ᴏᴡɴᴇʀ :- hashen*\n*ᴏᴡᴇɴʀ ɴᴜᴍʙᴇʀ :- 94729101856.*\n*ᴍɪɴɪ sɪᴛᴇ*\n> https://hashen-mini-bot.onrender.com/`;
                    await socket.sendMessage(sender, {
                        image: { url: config.BUTTON_IMAGES.ALIVE },
                        caption: formatMessage(title, content, config.BOT_FOOTER),
                        buttons: [
                            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: 'MENU' }, type: 1 },
                            { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: 'PING' }, type: 1 }
                        ],
                        quoted: msg
                    });
                    break;
                }

                case 'menu': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);
                    await socket.sendMessage(sender, { react: { text: "😻", key: msg.key } });
                    const kariyane = `┏┳━ \`ᴀʟʟ ᴍᴇɴᴜ\`\n┃ *✭ ʙᴏᴛ ɴᴀᴍᴇ - HASHEN-x-ᴍɪɴɪ*\n┃ *✭ ᴘʟᴀᴛꜰʀᴏᴍ - Heroku*\n┃ *✭ ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s\n┗━┛\n\n\n\n\n╭─╼® ⚡ ʙᴏᴛ ᴍᴇɴᴜ ⚡ ¯╼─────▌\n┣📌 𝑺ʏsᴛᴇᴍ\n*│ 🟢 .ᴀʟɪᴠᴇ →*\n┣ ʙᴏᴛ ᴏɴʟɪɴᴇ ᴄʜᴇᴄᴋ\n*│ 📶 .ᴘɪɴɢ →*\n┣ sᴘᴇᴇᴅ ᴛᴇsᴛ\n*│ ⚙️ .sʏsᴛᴇᴍ →*\n┣ ʙᴏᴛ sʏsᴛᴇᴍ ɪɴꜰᴏ\n*│ 👑 .ᴏᴡɴᴇʀ →*\n┣ sʜᴏᴡ ʙᴏᴛ ᴏᴡɴᴇʀs\n┢━━━━━━━━━━━━━━━━━━━━━➢\n┡🎵 𝑴ᴇᴅɪᴀ\n*│ 🎼 .sᴏɴɢ <ɴᴀᴍᴇ>  →*\n┣ ᴅᴏᴡɴʟᴏᴀᴅ sᴏɴɢ\n*│ 📘 .ꜰʙ <ᴜʀʟ> →*\n┣ ꜰᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏ ᴅᴏᴡɴ\n*│ 🎶 .ᴛɪᴋᴛᴏᴋsᴇᴀʀᴄʜ <ɴᴀᴍᴇ> →*\n┣  sᴇᴀʀᴄʜ ᴛɪᴋᴛᴏᴋ\n*│ 🎵 .ᴛɪᴋᴛᴏᴋ <ᴜʀʟ> →*\n┣ ᴛɪᴋᴛᴏᴋ ᴅʟ\n*│ 📲 .ᴀᴘᴋ <ɴᴀᴍᴇ> →*\n┣ ᴀᴘᴋ ᴅᴏᴡɴʟᴏᴀᴅ\n┢━━━━━━━━━━━━━━━━━━━━━➢\n┡🛠 𝑻ᴏᴏʟs\n*│ 📦 .ɴᴘᴍ <ᴘᴀᴄᴋᴀɢᴇ> →*\n┣ ɢᴇᴛ ɴᴘᴍ ɪɴꜰᴏ\n*│ 🔍 .ɢᴏᴏɢʟᴇ <ǫᴜᴇʀʏ> →*\n┣ ɢᴏᴏɢʟᴇ sᴇᴀʀᴄʜ\n*│ 🤖 .ᴀɪ <ᴘʀᴏᴍᴘᴛ> →*\n┣ ᴄʜᴀᴛ ᴡɪᴛʜ ᴀɪ\n*│ 🖼️ .ɢᴇᴛᴅᴘ <ᴊɪᴅ> →*\n┣ ɢᴇᴛ ᴘʀᴏꜰɪʟᴇ ᴘɪᴄ\n*│ 💥 .ʙᴏᴏᴍ <ɴᴜᴍ|ᴄᴏᴜɴᴛ> →*\n┣ ʙᴏᴏᴍ ɴᴜᴍʙᴇʀ\n┢━━━━━━━━━━━━━━━━━━━━━➢\n┡📗 𝑾ʜᴀᴛsᴀᴘᴘ\n*│ 📗 .ᴘᴀɪʀ <ᴄᴏᴅᴇ> →*\n┣ ᴘᴀɪʀ sᴇssɪᴏɴ\n*│ 🆔 .ᴊɪᴅ →*\n┣ ɢᴇᴛ ᴄʜᴀᴛ ᴊɪᴅ\n*│ 📡 .ᴄɪᴅ <ʟɪɴᴋ> →*\n┣ ɢᴇᴛ ᴄʜᴀɴɴᴇʟ ɪɴꜰᴏ\n╰━━━━━━━━━━━━━━━━━━━━━ˈ⊷`;
                    await socket.sendMessage(sender, {
                        image: { url: "https://files.catbox.moe/riqrud.jpg" },
                        caption: kariyane,
                        contextInfo: {
                            mentionedJid: ['94729101856@s.whatsapp.net'],
                            forwardingScore: 999,
                            isForwarded: false,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363424090172812@newsletter',
                                newsletterName: "HASHEN-𝐗-ᴍɪɴɪ-𝐁ᴏᴛ",
                                serverMessageId: 999
                            },
                            externalAdReply: {
                                title: 'ᴍᴜʟᴛɪ ᴅᴇᴠɪᴄᴇ ᴍɪɴɪ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛ',
                                body: 'HASHEN-x-ᴍɪɴɪ-ʙ 1',
                                mediaType: 1,
                                sourceUrl: "https://hashen-mini-bot.onrender.com/",
                                thumbnailUrl: 'https://files.catbox.moe/riqrud.jpg',
                                renderLargerThumbnail: false,
                                showAdAttribution: false
                            }
                        }
                    });
                    break;
                }

                case 'song': {
                    try {
                        const q = args.join(" ");
                        if (!q || q.trim() === "") {
                            return await socket.sendMessage(sender, { text: "🎶 *කරුණාකර ගීතයේ නමක් හෝ YouTube link එකක් දෙන්න!*" }, { quoted: msg });
                        }
                        const search = await yts(q);
                        if (!search.videos || search.videos.length === 0) {
                            return await socket.sendMessage(sender, { text: "*❌ ගීතය හමුනොවුණා.*" }, { quoted: msg });
                        }
                        const data = search.videos[0];
                        const ytUrl = data.url;
                        const api = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${ytUrl}&format=mp3&apikey=sadiya`;
                        const { data: apiRes } = await axios.get(api);
                        if (!apiRes?.status || !apiRes.result?.download) {
                            return await socket.sendMessage(sender, { text: "❌ ගීතය බාගත කළ නොහැක." }, { quoted: msg });
                        }
                        const result = apiRes.result;
                        const caption = `╭───────────────╮\n🎶 *Title:* ${data.title}\n⏱️ *Duration:* ${data.timestamp}\n👁️ *Views:* ${data.views}\n📅 *Released:* ${data.ago}\n╰───────────────╯`;
                        await socket.sendMessage(sender, { image: { url: result.thumbnail }, caption });
                        await socket.sendMessage(sender, { audio: { url: result.download }, mimetype: "audio/mpeg", fileName: `${data.title}.mp3` });
                    } catch (e) {
                        console.error(e);
                        await socket.sendMessage(sender, { text: "❌ *දෝෂයක්!*" }, { quoted: msg });
                    }
                    break;
                }

                case 'ping': {
                    var inital = new Date().getTime();
                    let ping = await socket.sendMessage(sender, { text: '*_Pinging to Module..._* ◉' });
                    var final = new Date().getTime();
                    await socket.sendMessage(sender, { text: '【 █▒▒▒▒▒▒▒▒▒▒▒】10%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '【 ████▒▒▒▒▒▒▒▒】30%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '【 ███████▒▒▒▒▒】50%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '【 ██████████▒▒】80%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '【 ████████████】100%', edit: ping.key });
                    return await socket.sendMessage(sender, { text: '◉ *Pong ' + (final - inital) + ' Ms*', edit: ping.key });
                }

                case 'owner': {
                    await socket.sendMessage(sender, { react: { text: "👤", key: msg.key } });
                    const ownerContact = {
                        contacts: {
                            displayName: 'My Contacts',
                            contacts: [
                                { vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:ᴊᴇsᴛᴇʀ\nTEL;TYPE=Coder,VOICE:94788770020\nEND:VCARD' },
                                { vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:ᴅᴇᴡᴡ\nTEL;TYPE=Coder,VOICE:+94775877546\nEND:VCARD' }
                            ]
                        }
                    };
                    await socket.sendMessage(sender, ownerContact);
                    break;
                }

                case 'fb':
                case 'fbdl':
                case 'facebook': {
                    try {
                        const fbUrl = args.join(" ");
                        if (!fbUrl) return await socket.sendMessage(sender, { text: '*Please provide a fb video url..*' }, { quoted: msg });
                        const apiKey = 'e276311658d835109c';
                        const apiUrl = `https://api.nexoracle.com/downloader/facebook?apikey=${apiKey}&url=${encodeURIComponent(fbUrl)}`;
                        const response = await axios.get(apiUrl);
                        if (!response.data?.result?.sd) return await socket.sendMessage(sender, { text: '*❌ Invalid or unsupported Facebook video URL.*' }, { quoted: msg });
                        await socket.sendMessage(sender, { video: { url: response.data.result.sd }, caption: `*⑇🚀 HASHEN X FB VIDEO DL 🚀⑇*` });
                    } catch (error) {
                        console.error('Error downloading Facebook video:', error);
                        await socket.sendMessage(sender, { text: '❌ Unable to download the Facebook video.' }, { quoted: msg });
                    }
                    break;
                }

                case 'system': {
                    const title = "*◉ sʏsᴛᴇᴍ ɪɴꜰᴏ ◉*";
                    let totalStorage = Math.floor(os.totalmem() / 1024 / 1024) + 'MB';
                    let cpuSpeed = os.cpus()[0].speed / 1000;
                    let cpuCount = os.cpus().length;
                    let content = `\n  ◦ *Runtime*: ${runtime(process.uptime())}\n  ◦ *Total Ram*: ${totalStorage}\n  ◦ *CPU Speed*: ${cpuSpeed} GHz\n  ◦ *Number of CPU Cores*: ${cpuCount}\n`;
                    await socket.sendMessage(sender, { image: { url: `https://files.catbox.moe/czzhiv.jpg` }, caption: formatMessage(title, content, config.BOT_FOOTER) });
                    break;
                }

                case 'npm': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]npm\s*/i, '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: '📦 *Usage:* .npm <package-name>' }, { quoted: msg });
                    try {
                        const { data, status } = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(q)}`);
                        if (status !== 200) return await socket.sendMessage(sender, { text: '🚫 Package not found.' }, { quoted: msg });
                        const latestVersion = data["dist-tags"]?.latest || 'N/A';
                        const description = data.description || 'No description available.';
                        const license = data.license || 'Unknown';
                        const repository = data.repository ? data.repository.url.replace('git+', '').replace('.git', '') : 'Not available';
                        const caption = `\n📦 *NPM Package Search*\n\n📰 *Package:* ${q}\n📄 *Description:* ${description}\n⸏️ *Latest Version:* ${latestVersion}\n🪪 *License:* ${license}\n🪩 *Repository:* ${repository}\n🔗 *NPM URL:* https://www.npmjs.com/package/${q}\n`;
                        await socket.sendMessage(sender, { text: caption }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ An error occurred while fetching package details.' }, { quoted: msg });
                    }
                    break;
                }

                case 'tiktoksearch': {
                    const query = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]tiktoksearch\s*/i, '').trim();
                    if (!query) return await socket.sendMessage(sender, { text: '🌸 *Usage:* .tiktoksearch <query>' }, { quoted: msg });
                    try {
                        const { data } = await axios.get(`https://apis-starlights-team.koyeb.app/starlight/tiktoksearch?text=${encodeURIComponent(query)}`);
                        if (!data?.status || !data?.data || data.data.length === 0) return await socket.sendMessage(sender, { text: '❌ No results found.' }, { quoted: msg });
                        const results = data.data.slice(0, 5);
                        for (const video of results) {
                            const caption = `🌸 *TikTok Video Result*\n\n📖 *Title:* ${video.title || 'Unknown'}\n👤 *Author:* ${video.author?.nickname || 'Unknown'}\n⏱ *Duration:* ${video.duration || 'Unknown'}\n🔗 *URL:* ${video.link || 'N/A'}`;
                            if (video.nowm) {
                                await socket.sendMessage(sender, { video: { url: video.nowm }, caption }, { quoted: msg });
                            }
                        }
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ An error occurred while searching TikTok.' }, { quoted: msg });
                    }
                    break;
                }

                case 'apk': {
                    const query = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]apk\s*/i, '').trim();
                    if (!query) { await socket.sendMessage(sender, { text: "*🔍 Please provide an app name.\n\n_Usage:_\n.apk Instagram" }); break; }
                    try {
                        await socket.sendMessage(sender, { react: { text: "⬇️", key: msg.key } });
                        const response = await axios.get(`http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=1`);
                        const data = response.data;
                        if (!data.datalist?.list?.length) { await socket.sendMessage(sender, { text: "❌ *No APK found.*" }); break; }
                        const app = data.datalist.list[0];
                        const sizeMB = (app.size / (1024 * 1024)).toFixed(2);
                        const caption = `🎮 *App Name:* ${app.name}\n📦 *Package:* ${app.package}\n📅 *Last Updated:* ${app.updated}\n📐 *Size:* ${sizeMB} MB\n\n> > ᴘᴏᴡᴇʀᴅ ʙʏ ᴍᴇɴᴜ x ᴍɪɴɪ ◉`;
                        await socket.sendMessage(sender, { react: { text: "⬆️", key: msg.key } });
                        await socket.sendMessage(sender, { document: { url: app.file.path_alt }, fileName: `${app.name}.apk`, mimetype: 'application/vnd.android.package-archive', caption, quoted: msg });
                        await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: "❌ *Error occurred while downloading the APK.*" });
                    }
                    break;
                }

                case 'boom': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '');
                    const parts = q.replace(/^[.\/!]boom\s*/i, '').split(',').map(x => x?.trim());
                    const target = parts[0];
                    const text = parts[1];
                    const count = parseInt(parts[2]) || 5;
                    if (!target || !text) return await socket.sendMessage(sender, { text: '📌 *Usage:* .boom <number>,<message>,<count>' }, { quoted: msg });
                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                    if (count > 20) return await socket.sendMessage(sender, { text: '❌ *Limit is 20 messages per bomb.*' }, { quoted: msg });
                    for (let i = 0; i < count; i++) { await socket.sendMessage(jid, { text }); await delay(700); }
                    await socket.sendMessage(sender, { text: `✅ Bomb sent to ${target} – ${count}x` }, { quoted: msg });
                    break;
                }

                case 'pair': {
                    const pairNumber = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]pair\s*/i, '').trim();
                    if (!pairNumber) return await socket.sendMessage(sender, { text: '*📌 Usage:* .pair +94788770020' }, { quoted: msg });
                    try {
                        const url = `https://dinu-3ab31409578e.herokuapp.com/code?number=${encodeURIComponent(pairNumber)}`;
                        const response = await fetch(url);
                        const bodyText = await response.text();
                        let result;
                        try { result = JSON.parse(bodyText); } catch (e) { return await socket.sendMessage(sender, { text: '❌ Invalid response from server.' }, { quoted: msg }); }
                        if (!result?.code) return await socket.sendMessage(sender, { text: '❌ Failed to retrieve pairing code.' }, { quoted: msg });
                        await socket.sendMessage(sender, { text: `*01 📋 Copy This Code*\n*02 🔗 Go to Link Device*\n*03 ✂️ Paste the Code*\n\n*🔑 Your pairing code is:* ${result.code}` }, { quoted: msg });
                        await delay(2000);
                        await socket.sendMessage(sender, { text: `${result.code}` }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ An error occurred. Please try again later.' }, { quoted: msg });
                    }
                    break;
                }

                case 'jid': {
                    try { await socket.sendMessage(sender, { text: `${sender}` }); }
                    catch (e) { await socket.sendMessage(sender, { text: 'Error while retrieving the JID!' }); }
                    break;
                }

                case 'ai': {
                    const GEMINI_API_KEY = 'AIzaSyBdBivCo6jWSchTb8meP7VyxbHpoNY_qfQ';
                    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '');
                    if (!q || q.trim() === '') return await socket.sendMessage(sender, { text: "Hy i am Freedom ai ◉" }, { quoted: msg });
                    const prompt = `ඔබ සාබ ගෝහාණු ලමයෙකු මෙන් හාසිරිය යුතුය. User Message: ${q}`;
                    try {
                        const response = await axios.post(GEMINI_API_URL, { contents: [{ parts: [{ text: prompt }] }] }, { headers: { "Content-Type": "application/json" } });
                        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (!aiResponse) return await socket.sendMessage(sender, { text: "❌ Error." }, { quoted: msg });
                        await socket.sendMessage(sender, { text: aiResponse }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: "❌ Error" }, { quoted: msg });
                    }
                    break;
                }

                case 'cid': {
                    const channelLink = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]cid\s*/i, '').trim();
                    if (!channelLink) return await socket.sendMessage(sender, { text: '⎈ Please provide a WhatsApp Channel link.' }, { quoted: msg });
                    const match = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/);
                    if (!match) return await socket.sendMessage(sender, { text: '⚠️ *Invalid channel link format.*' }, { quoted: msg });
                    const inviteId = match[1];
                    try {
                        const metadata = await socket.newsletterMetadata("invite", inviteId);
                        if (!metadata?.id) return await socket.sendMessage(sender, { text: '❌ Channel not found.' }, { quoted: msg });
                        const infoText = `\n📡 *WhatsApp Channel Info*\n\n🆔 *ID:* ${metadata.id}\n📌 *Name:* ${metadata.name}\n👥 *Followers:* ${metadata.subscribers?.toLocaleString() || 'N/A'}\n`;
                        if (metadata.preview) {
                            await socket.sendMessage(sender, { image: { url: `https://pps.whatsapp.net${metadata.preview}` }, caption: infoText }, { quoted: msg });
                        } else {
                            await socket.sendMessage(sender, { text: infoText }, { quoted: msg });
                        }
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '⚠️ An unexpected error occurred.' }, { quoted: msg });
                    }
                    break;
                }

                case 'getdp':
                case 'getpp':
                case 'getprofile': {
                    try {
                        if (!args[0]) return await socket.sendMessage(sender, { text: "🔥 Please provide a phone number\n\nExample: .getdp 94788770020" });
                        let targetJid = args[0].replace(/[^0-9]/g, "") + "@s.whatsapp.net";
                        let ppUrl;
                        try { ppUrl = await socket.profilePictureUrl(targetJid, "image"); }
                        catch (e) { return await socket.sendMessage(sender, { text: "🖼️ No profile picture or cannot be accessed!" }); }
                        await socket.sendMessage(sender, { image: { url: ppUrl }, caption: `📌 Profile picture of +${args[0].replace(/[^0-9]/g, "")}` });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: "🛑 An error occurred!" });
                    }
                    break;
                }

                case 'tiktok':
                case 'ttdl':
                case 'tt':
                case 'tiktokdl': {
                    const link = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!](tiktok|ttdl|tt|tiktokdl)\s*/i, '').trim();
                    if (!link) return await socket.sendMessage(sender, { text: '📌 *Usage:* .tiktok <link>' }, { quoted: msg });
                    if (!link.includes('tiktok.com')) return await socket.sendMessage(sender, { text: '❌ *Invalid TikTok link.*' }, { quoted: msg });
                    try {
                        await socket.sendMessage(sender, { text: '⏳ Downloading...' }, { quoted: msg });
                        const { data } = await axios.get(`https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`);
                        if (!data?.status || !data?.data) return await socket.sendMessage(sender, { text: '❌ Failed to fetch TikTok video.' }, { quoted: msg });
                        const { title, like, comment, share, author, meta } = data.data;
                        const video = meta.media.find(v => v.type === "video");
                        if (!video?.org) return await socket.sendMessage(sender, { text: '❌ No downloadable video found.' }, { quoted: msg });
                        const caption = `🎵 *TIKTOK DOWNLOADR*\n\n👤 *User:* ${author.nickname}\n📖 *Title:* ${title}\n👍 *Likes:* ${like}`;
                        await socket.sendMessage(sender, { video: { url: video.org }, caption }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: `❌ An error occurred:\n${err.message}` }, { quoted: msg });
                    }
                    break;
                }

                case 'google':
                case 'gsearch':
                case 'search': {
                    try {
                        if (!args || args.length === 0) { await socket.sendMessage(sender, { text: '⚠️ *Please provide a search query.*' }); break; }
                        const query = args.join(" ");
                        const apiKey = "AIzaSyDMbI3nvmQUrfjoCJYLS69Lej1hSXQjnWI";
                        const cx = "baf9bdb0c631236e5";
                        const response = await axios.get(`https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}`);
                        if (response.status !== 200 || !response.data.items?.length) { await socket.sendMessage(sender, { text: `⚠️ *No results found for:* ${query}` }); break; }
                        let results = `🔍 *Google Search Results for:* "${query}"\n\n`;
                        response.data.items.slice(0, 5).forEach((item, index) => { results += `*${index + 1}. ${item.title}*\n\n🔗 ${item.link}\n\n📝 ${item.snippet}\n\n`; });
                        const firstResult = response.data.items[0];
                        const thumbnailUrl = firstResult.pagemap?.cse_image?.[0]?.src || 'https://via.placeholder.com/150';
                        await socket.sendMessage(sender, { image: { url: thumbnailUrl }, caption: results.trim() });
                    } catch (error) {
                        await socket.sendMessage(sender, { text: `⚠️ *An error occurred.*\n\n${error.message}` });
                    }
                    break;
                }

                default:
                    break;
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.IMAGE_PATH },
                caption: formatMessage('❌ ERROR', 'An error occurred. Please try again.', `${config.BOT_FOOTER}`)
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
        try {
            const autoReact = getSetting('AUTO_REACT') || 'on';
            if (autoReact === 'on') {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
            }
        } catch (error) {
            console.error('Failed to set recording presence:', error);
        }
    });
}

async function deleteSessionFromMongo(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        await db.collection('sessions').deleteOne({ number: sanitizedNumber });
        console.log(`Deleted session for ${sanitizedNumber} from MongoDB`);
    } catch (error) {
        console.error('Failed to delete session from MongoDB:', error);
    }
}

async function renameCredsOnLogout(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const collection = db.collection('sessions');
        const count = (await collection.countDocuments({ active: false })) + 1;
        await collection.updateOne(
            { number: sanitizedNumber },
            { $rename: { "creds": `delete_creds${count}` }, $set: { active: false } }
        );
        console.log(`Renamed creds for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to rename creds on logout:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const doc = await db.collection('sessions').findOne({ number: sanitizedNumber, active: true });
        if (!doc || !doc.creds) return null;
        return JSON.parse(doc.creds);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

function setupAutoRestart(socket, number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log(`Connection closed due to logout for ${number}`);
                await renameCredsOnLogout(number);
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
            } else {
                console.log(`Connection lost for ${number}, attempting to reconnect in 5s...`);
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
                await delay(5000);
                const mockRes = { headersSent: true, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

// =============================================
// MAIN PAIRING FUNCTION — Official Baileys Pattern
// =============================================
async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    try { await initUserEnvIfMissing(sanitizedNumber); } catch (e) { console.error('initUserEnvIfMissing error:', e); }
    try { await initEnvsettings(sanitizedNumber); } catch (e) { console.error('initEnvsettings error:', e); }

    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    // Restore session from MongoDB if no local session exists
    const localCredsExist = fs.existsSync(path.join(sessionPath, 'creds.json'));
    if (!localCredsExist) {
        const restoredCreds = await restoreSession(sanitizedNumber);
        if (restoredCreds) {
            await fs.ensureDir(sessionPath);
            await fs.writeFile(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
            console.log(`Successfully restored session for ${sanitizedNumber}`);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: 'silent' });

    try {
        // KEY FIX 1: markOnlineOnConnect: false — WhatsApp notification receive කරන්න
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari'),
            markOnlineOnConnect: false,   // ← WhatsApp "Link a device" notification fix
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

=======================// KEY FIX 2: Official Baileys pattern — socket create කළාට පස්සෙ directly call
        // Event listener ඇතුළෙ නෙවෙයි — Baileys internally timing handle කරනවා
        if (!socket.authState.creds.registered) {
    await delay(1500);
    try {
        const code = await socket.requestPairingCode(sanitizedNumber);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log(`✅ Pairing code for ${sanitizedNumber}: ${formattedCode}`);
        if (!res.headersSent) res.send({ code: formattedCode });
    } catch (error) {
        console.error('❌ Failed to request pairing code:', error.message);
        if (!res.headersSent) res.status(500).send({ error: 'Failed to generate pairing code. Please try again.' });
    }
} else {
///===================================// Session already exists — already paired
            if (!res.headersSent) {
                res.send({ status: 'already_paired', message: 'Session restored and connecting' });
            }
        }

        // Creds save + MongoDB sync
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            try {
                const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
                const database = await initMongo();
                const sessionId = uuidv4();
                await database.collection('sessions').updateOne(
                    { number: sanitizedNumber },
                    { $set: { sessionId, number: sanitizedNumber, creds: fileContent, active: true, updatedAt: new Date() } },
                    { upsert: true }
                );
                console.log(`Saved creds for ${sanitizedNumber}`);
            } catch (e) {
                console.error('Failed to save creds to MongoDB:', e);
            }
        });

        // On connection open
        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);
                    const groupResult = await joinGroup(socket);

                    try {
                        await socket.newsletterFollow(config.NEWSLETTER_JID);
                        await socket.sendMessage(config.NEWSLETTER_JID, { react: { text: '❤️', key: { id: config.NEWSLETTER_MESSAGE_ID } } });
                        console.log('✅ Auto-followed newsletter');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    await socket.sendMessage(userJid, {
                        image: { url: config.IMAGE_PATH },
                        caption: formatMessage(
                            '*ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴍsɢ*',
                            `✅ Successfully connected!\n\n📢 Number: ${sanitizedNumber}\n\n📋 Available Commands:\n📌${config.PREFIX}alive\n📌${config.PREFIX}menu\n📌${config.PREFIX}song\n📌${config.PREFIX}pair`,
                            '╾╾╾'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                    }
                } catch (error) {
                    console.error('Connection open error:', error);
                }
            }
        });

    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

// Routes
router.get('/', async (req, res) => {
    const { number, force } = req.query;
    if (!number) return res.status(400).send({ error: 'Number parameter is required' });

    const forceRepair = force === 'true';
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    if (activeSockets.has(sanitizedNumber) && !forceRepair) {
        return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
    }

    if (forceRepair) {
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        await deleteSessionFromMongo(sanitizedNumber);
        if (fs.existsSync(sessionPath)) await fs.remove(sessionPath);
        activeSockets.delete(sanitizedNumber);
        socketCreationTime.delete(sanitizedNumber);
        console.log(`Forced re-pair for ${sanitizedNumber}: deleted old session`);
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({ count: activeSockets.size, numbers: Array.from(activeSockets.keys()) });
});

router.get('/ping', (req, res) => {
    res.status(200).send({ status: 'active', message: 'BOT is running', activesession: activeSockets.size });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) return res.status(404).send({ error: 'No numbers found' });
        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) return res.status(404).send({ error: 'No numbers found' });
        const results = [];
        const promises = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
            const mockRes = { headersSent: true, send: () => {}, status: () => mockRes };
            promises.push(EmpirePair(number, mockRes).then(() => ({ number, status: 'connection_initiated' })).catch(error => ({ number, status: 'failed', error: error.message })));
        }
        results.push(...await Promise.all(promises));
        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const database = await initMongo();
        const docs = await database.collection('sessions').find({ active: true }).toArray();
        if (docs.length === 0) return res.status(404).send({ error: 'No active sessions found' });
        const results = [];
        const promises = [];
        for (const doc of docs) {
            const number = doc.number;
            if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
            const mockRes = { headersSent: true, send: () => {}, status: () => mockRes };
            promises.push(EmpirePair(number, mockRes).then(() => ({ number, status: 'connection_initiated' })).catch(error => ({ number, status: 'failed', error: error.message })));
        }
        results.push(...await Promise.all(promises));
        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) return res.status(400).send({ error: 'Number and target are required' });
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) return res.status(404).send({ error: 'No active session found' });
    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({ status: 'success', number: target, about: aboutStatus, setAt });
    } catch (error) {
        res.status(500).send({ status: 'error', message: `Failed to fetch About status.` });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        try { socket.ws.close(); } catch (e) {}
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    try { fs.emptyDirSync(SESSION_BASE_PATH); } catch (e) {}
    try { client.close(); } catch (e) {}
});

process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
});

// Auto-reconnect on startup
(async () => {
    try {
        const database = await initMongo();
        const docs = await database.collection('sessions').find({ active: true }).toArray();
        console.log(`Found ${docs.length} active sessions to reconnect`);
        for (const doc of docs) {
            const number = doc.number;
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: true, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                await delay(3000);
            }
        }
        console.log('Auto-reconnect completed on startup');
    } catch (error) {
        console.error('Failed to auto-reconnect on startup:', error);
    }
})();

module.exports = router;

