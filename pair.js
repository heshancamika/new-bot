const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const crypto = require('crypto');
const axios = require('axios');
const yts = require('yt-search');
const fetch = require('node-fetch');
const os = require('os');
const ddownr = require('denethdev-ytmp3');
const apikey = `edbcfabbca5a9750`;
const { initUserEnvIfMissing } = require('./settingsdb');
const { initEnvsettings, getSetting } = require('./settings');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent
} = require('@whiskeysockets/baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['🧩', '🍉', '💜', '🌸', '🪴', '💊', '💫', '🍂', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🤖', '🚩', '🥰', '🗿', '💜', '💙', '🌝', '🖤', '💚'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/Cp3Gab6TUCLA9SMpY48chd',
    ADMIN_LIST_PATH: './admin.json',
    IMAGE_PATH: 'https://files.catbox.moe/riqrud.jpg',
    NEWSLETTER_JID: '120363424090172812@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    NEWS_JSON_URL: '',
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
            else if (error.message.includes('gone')) errorMessage = 'Group invite link is invalid or expired';
            if (retries === 0) return { status: 'failed', error: errorMessage };
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number) {
    const admins = loadAdmins();
    const caption = formatMessage(
        '*Connected Successful ✅*',
        ` ❗Number: ${number}\n 🧚‍♂️ Status: Online`,
        `${config.BOT_FOOTER}`
    );
    for (const admin of admins) {
        try {
            await socket.sendMessage(`${admin}@s.whatsapp.net`, {
                image: { url: config.IMAGE_PATH },
                caption
            });
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
            const emojis = ['❤️‍🩹'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
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
            const autoReact = getSetting('AUTO_REACT') || 'on';
            if (autoReact === 'on') await socket.sendPresenceUpdate("recording", message.key.remoteJid);
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
                        await socket.sendMessage(message.key.remoteJid, { react: { text: randomEmoji, key: message.key } }, { statusJidList: [message.key.participant] });
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
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        const message = formatMessage(
            '╭──◯',
            `│ \`D E L E T E\`\n│ *⦁ From :* ${messageKey.remoteJid}\n│ *⦁ Time:* ${deletionTime}\n│ *⦁ Type: Normal*\n╰──◯`,
            `${config.BOT_FOOTER}`
        );
        try {
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
            const text = (msg.message.conversation || msg.message.extendedTextMessage.text || '').trim();
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
                    const title = '*❛HASHEN X MINI V1 🧚‍♂️❛*';
                    const content = `*© 𝐏ᴏᴡᴇʀᴅ 𝐁ʏ hashen ❛🧚‍♂️*\n*𝐁ᴏᴛ 𝐎ᴡɴᴇʀ :- hashen*\n*𝐎ᴡᴇɴʀ 𝐍ᴜᴍʙᴇʀ :- 94729101856.*\n*ᴍɪɴɪ ꜱɪᴛᴇ*\n> https://hashen-mini-bot.onrender.com/`;
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
                    const kariyane = `┏━❐  \`ᴀʟʟ ᴍᴇɴᴜ\`\n┃ *⭔ ʙᴏᴛ ɴᴀᴍᴇ - HASHEN-x-ᴍɪɴɪ*\n┃ *⭔ ᴘʟᴀᴛꜰʀᴏᴍ - Heroku*\n┃ *⭔ ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s\n┗━❐\n\n\n\n╭─═❮ ⚡ ʙᴏᴛ ᴍᴇɴᴜ ⚡ ❯═━───❖\n┣📌 𝑺ʏꜱᴛᴇᴍ\n*│ 🟢 .ᴀʟɪᴠᴇ →*\n┣ ʙᴏᴛ ᴏɴʟɪɴᴇ ᴄʜᴇᴄᴋ\n*│ 📶 .ᴘɪɴɢ →*\n┣ ꜱᴘᴇᴇᴅ ᴛᴇꜱᴛ\n*│ ⚙️ .ꜱʏꜱᴛᴇᴍ →*\n┣ ʙᴏᴛ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ\n*│ 👑 .ᴏᴡɴᴇʀ →*\n┣ ꜱʜᴏᴡ ʙᴏᴛ ᴏᴡɴᴇʀꜱ\n┢━━━━━━━━━━━━━━━━━━━━➢\n┡🎵 𝑴ᴇᴅɪᴀ\n*│ 🎼 .ꜱᴏɴɢ <ɴᴀᴍᴇ>  →*\n┣ ᴅᴏᴡɴʟᴏᴀᴅ ꜱᴏɴɢ\n*│ 📘 .ꜰʙ <ᴜʀʟ> →*\n┣ ꜰᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏ ᴅᴏᴡɴ\n*│ 🎶 .ᴛɪᴋᴛᴏᴋꜱᴇᴀʀᴄʜ <ɴᴀᴍᴇ> →*\n┣  ꜱᴇᴀʀᴄʜ ᴛɪᴋᴛᴏᴋ\n*│ 🎵 .ᴛɪᴋᴛᴏᴋ <ᴜʀʟ> →*\n┣ ᴛɪᴋᴛᴏᴋ ᴅʟ\n*│ 📲 .ᴀᴘᴋ <ɴᴀᴍᴇ> →*\n┣ ᴀᴘᴋ ᴅᴏᴡɴʟᴏᴀᴅ\n┢━━━━━━━━━━━━━━━━━━━━➢\n┡🛠 𝑻ᴏᴏʟꜱ\n*│ 📦 .ɴᴘᴍ <ᴘᴀᴄᴋᴀɢᴇ> →*\n┣ ɢᴇᴛ ɴᴘᴍ ɪɴꜰᴏ\n*│ 🔍 .ɢᴏᴏɢʟᴇ <ǫᴜᴇʀʏ> →*\n┣ ɢᴏᴏɢʟᴇ ꜱᴇᴀʀᴄʜ\n*│ 🤖 .ᴀɪ <ᴘʀᴏᴍᴘᴛ> →*\n┣ ᴄʜᴀᴛ ᴡɪᴛʜ ᴀɪ\n*│ 🖼️ .ɢᴇᴛᴅᴘ <ᴊɪᴅ> →*\n┣ ɢᴇᴛ ᴘʀᴏꜰɪʟᴇ ᴘɪᴄ\n*│ 💥 .ʙᴏᴏᴍ <ɴᴜᴍ|ᴄᴏᴜɴᴛ> →*\n┣ ʙᴏᴏᴍ ɴᴜᴍʙᴇʀ\n┢━━━━━━━━━━━━━━━━━━━━➢\n┡🔗 𝑾ʜᴀᴛꜱᴀᴘᴘ\n*│ 🔗 .ᴘᴀɪʀ <ᴄᴏᴅᴇ> →*\n┣ ᴘᴀɪʀ ꜱᴇꜱꜱɪᴏɴ\n*│ 🆔 .ᴊɪᴅ →*\n┣ ɢᴇᴛ ᴄʜᴀᴛ ᴊɪᴅ\n*│ 📡 .ᴄɪᴅ <ʟɪɴᴋ> →*\n┣ ɢᴇᴛ ᴄʜᴀɴɴᴇʟ ɪɴꜰᴏ\n╰━━━━━━━━━━━━━━━━━━━┈⊷`;
                    await socket.sendMessage(sender, {
                        image: { url: "https://files.catbox.moe/riqrud.jpg" },
                        caption: kariyane,
                        contextInfo: {
                            mentionedJid: ['94729101856@s.whatsapp.net'],
                            forwardingScore: 999,
                            isForwarded: false,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363424090172812@newsletter',
                                newsletterName: "HASHEN-𝐱-𝐌ɪɴɪ-𝐁ᴏᴛ",
                                serverMessageId: 999
                            },
                            externalAdReply: {
                                title: 'ᴍᴜʟᴛɪ ᴅᴇᴠɪᴄᴇ ᴍɪɴɪ ᴡʜᴀᴛꜱᴀᴘᴘ ʙᴏᴛ',
                                body: 'HASHEN-x-ᴍɪɴɪ-ᴠ1',
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
                            return await socket.sendMessage(sender, { text: "🎶 *කරුණාකර ගීතයේ නමක් දෙන්න!*\n\n`.song shape of you`" }, { quoted: msg });
                        }
                        const search = await yts(q);
                        if (!search.videos || search.videos.length === 0) {
                            return await socket.sendMessage(sender, { text: "*❌ ගීතය හමුනොවුණා.*" }, { quoted: msg });
                        }
                        const data = search.videos[0];
                        const api = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${data.url}&format=mp3&apikey=sadiya`;
                        const { data: apiRes } = await axios.get(api);
                        if (!apiRes?.status || !apiRes.result?.download) {
                            return await socket.sendMessage(sender, { text: "❌ ගීතය බාගත කළ නොහැක." }, { quoted: msg });
                        }
                        const result = apiRes.result;
                        await socket.sendMessage(sender, { image: { url: result.thumbnail }, caption: `🎶 *Title:* ${data.title}\n⏱️ *Duration:* ${data.timestamp}\n👁️ *Views:* ${data.views}` });
                        await socket.sendMessage(sender, { audio: { url: result.download }, mimetype: "audio/mpeg", fileName: `${data.title}.mp3` });
                    } catch (e) {
                        console.error(e);
                        await socket.sendMessage(sender, { text: "❌ *දෝෂයකි!*" }, { quoted: msg });
                    }
                    break;
                }

                case 'ping': {
                    var inital = new Date().getTime();
                    let ping = await socket.sendMessage(sender, { text: '*_Pinging to Module..._* ❗' });
                    var final = new Date().getTime();
                    await socket.sendMessage(sender, { text: '《 █▒▒▒▒▒▒▒▒▒▒▒》10%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ████▒▒▒▒▒▒▒▒》30%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ███████▒▒▒▒▒》50%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ██████████▒▒》80%', edit: ping.key });
                    await socket.sendMessage(sender, { text: '《 ████████████》100%', edit: ping.key });
                    return await socket.sendMessage(sender, { text: '❗ *Pong ' + (final - inital) + ' Ms*', edit: ping.key });
                }

                case 'owner': {
                    await socket.sendMessage(sender, { react: { text: "👤", key: msg.key } });
                    await socket.sendMessage(sender, {
                        contacts: { displayName: 'My Contacts', contacts: [
                            { vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:ᴊᴇꜱᴛᴇʀ\nTEL;TYPE=Coder,VOICE:94788770020\nEND:VCARD' },
                            { vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:ᴅᴇᴡᴡ\nTEL;TYPE=Coder,VOICE:+94775877546\nEND:VCARD' }
                        ]}
                    });
                    await socket.sendMessage(sender, { location: { degreesLatitude: 6.9271, degreesLongitude: 80.5550, name: 'deww Address', address: 'Kurunegala, Sri Lanka' } });
                    break;
                }

                case 'fb':
                case 'fbdl':
                case 'facebook': {
                    try {
                        const fbUrl = args.join(" ");
                        if (!fbUrl) return await socket.sendMessage(sender, { text: '*Please provide a Facebook video URL.*' }, { quoted: msg });
                        const apiUrl = `https://api.nexoracle.com/downloader/facebook?apikey=e276311658d835109c&url=${encodeURIComponent(fbUrl)}`;
                        const response = await axios.get(apiUrl);
                        if (!response.data?.result?.sd) return await socket.sendMessage(sender, { text: '*❌ Invalid Facebook URL.*' }, { quoted: msg });
                        await socket.sendMessage(sender, { video: { url: response.data.result.sd }, caption: `*❒🚀 HASHEN X FB VIDEO DL 🚀❒*` });
                    } catch (error) {
                        await socket.sendMessage(sender, { text: '❌ Unable to download. Please try again.' }, { quoted: msg });
                    }
                    break;
                }

                case 'system': {
                    const cpuSpeed = os.cpus()[0].speed / 1000;
                    const cpuCount = os.cpus().length;
                    const content = `\n  ◦ *Runtime*: ${runtime(process.uptime())}\n  ◦ *Total Ram*: ${Math.floor(os.totalmem() / 1024 / 1024)}MB\n  ◦ *CPU Speed*: ${cpuSpeed} GHz\n  ◦ *CPU Cores*: ${cpuCount}`;
                    await socket.sendMessage(sender, { image: { url: 'https://files.catbox.moe/czzhiv.jpg' }, caption: formatMessage("*❗ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ ❗*", content, config.BOT_FOOTER) });
                    break;
                }

                case 'npm': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]npm\s*/i, '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: '📦 *Usage:* .npm <package-name>' }, { quoted: msg });
                    try {
                        const { data } = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(q)}`);
                        const caption = `📦 *NPM Package*\n\n🔰 *Package:* ${q}\n📄 *Description:* ${data.description || 'N/A'}\n⏸️ *Latest:* ${data["dist-tags"]?.latest || 'N/A'}\n🪪 *License:* ${data.license || 'Unknown'}\n🔗 *URL:* https://www.npmjs.com/package/${q}`;
                        await socket.sendMessage(sender, { text: caption }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ Package not found.' }, { quoted: msg });
                    }
                    break;
                }

                case 'tiktoksearch': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]tiktoksearch\s*/i, '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: '🌸 *Usage:* .tiktoksearch <query>' }, { quoted: msg });
                    try {
                        const { data } = await axios.get(`https://apis-starlights-team.koyeb.app/starlight/tiktoksearch?text=${encodeURIComponent(q)}`);
                        if (!data?.status || !data?.data?.length) return await socket.sendMessage(sender, { text: '❌ No results found.' }, { quoted: msg });
                        for (const video of data.data.slice(0, 3)) {
                            if (video.nowm) {
                                await socket.sendMessage(sender, {
                                    video: { url: video.nowm },
                                    caption: `🌸 *${video.title || 'TikTok Video'}*\n👤 ${video.author?.nickname || 'Unknown'}`
                                }, { quoted: msg });
                            }
                        }
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ Error searching TikTok.' }, { quoted: msg });
                    }
                    break;
                }

                case 'apk': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]apk\s*/i, '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: "*Usage:* .apk Instagram" });
                    try {
                        await socket.sendMessage(sender, { react: { text: "⬇️", key: msg.key } });
                        const { data } = await axios.get(`http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(q)}/limit=1`);
                        if (!data.datalist?.list?.length) return await socket.sendMessage(sender, { text: "❌ No APK found." });
                        const app = data.datalist.list[0];
                        await socket.sendMessage(sender, {
                            document: { url: app.file.path_alt },
                            fileName: `${app.name}.apk`,
                            mimetype: 'application/vnd.android.package-archive',
                            caption: `🎮 *${app.name}*\n📦 ${app.package}\n📁 ${(app.size / 1024 / 1024).toFixed(2)} MB`
                        });
                        await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: "❌ Error downloading APK." });
                    }
                    break;
                }

                case 'boom': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]boom\s*/i, '');
                    const parts = q.split(',').map(x => x?.trim());
                    const target = parts[0]; const text = parts[1]; const count = parseInt(parts[2]) || 5;
                    if (!target || !text) return await socket.sendMessage(sender, { text: '📌 *Usage:* .boom <number>,<message>,<count>' }, { quoted: msg });
                    if (count > 20) return await socket.sendMessage(sender, { text: '❌ Limit is 20.' }, { quoted: msg });
                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                    for (let i = 0; i < count; i++) { await socket.sendMessage(jid, { text }); await delay(700); }
                    await socket.sendMessage(sender, { text: `✅ Sent to ${target} — ${count}x` }, { quoted: msg });
                    break;
                }

                case 'pair': {
                    const pairNumber = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]pair\s*/i, '').trim();
                    if (!pairNumber) return await socket.sendMessage(sender, { text: '*📌 Usage:* .pair +94788770020' }, { quoted: msg });
                    try {
                        const response = await fetch(`https://dinu-3ab31409578e.herokuapp.com/code?number=${encodeURIComponent(pairNumber)}`);
                        const result = await response.json();
                        if (!result?.code) return await socket.sendMessage(sender, { text: '❌ Failed to get pairing code.' }, { quoted: msg });
                        await socket.sendMessage(sender, { text: `*🔑 Pairing Code:* ${result.code}\n\n*01* 📋 Copy code\n*02* 🔗 Go to Linked Devices\n*03* ✂️ Paste the code` }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ Error. Please try again.' }, { quoted: msg });
                    }
                    break;
                }

                case 'jid': {
                    await socket.sendMessage(sender, { text: `${sender}` });
                    break;
                }

                case 'ai': {
                    const GEMINI_API_KEY = 'AIzaSyBdBivCo6jWSchTb8meP7VyxbHpoNY_qfQ';
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: "Hy i am Freedom ai ❗" }, { quoted: msg });
                    const prompt = `ඔබ සැබෑ ගැහැනු ලමයෙකු මෙන් හැසිරිය යුතුය. User Message: ${q}`;
                    try {
                        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, { contents: [{ parts: [{ text: prompt }] }] }, { headers: { "Content-Type": "application/json" } });
                        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (!aiResponse) return await socket.sendMessage(sender, { text: "❌ Error." }, { quoted: msg });
                        await socket.sendMessage(sender, { text: aiResponse }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: "❌ Error" }, { quoted: msg });
                    }
                    break;
                }

                case 'cid': {
                    const q = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!]cid\s*/i, '').trim();
                    if (!q) return await socket.sendMessage(sender, { text: '❎ *Example:* .cid https://whatsapp.com/channel/...' }, { quoted: msg });
                    const match = q.match(/whatsapp\.com\/channel\/([\w-]+)/);
                    if (!match) return await socket.sendMessage(sender, { text: '⚠️ Invalid channel link.' }, { quoted: msg });
                    try {
                        const metadata = await socket.newsletterMetadata("invite", match[1]);
                        if (!metadata?.id) return await socket.sendMessage(sender, { text: '❌ Channel not found.' }, { quoted: msg });
                        const infoText = `📡 *Channel Info*\n\n🆔 *ID:* ${metadata.id}\n📌 *Name:* ${metadata.name}\n👥 *Followers:* ${metadata.subscribers?.toLocaleString() || 'N/A'}`;
                        await socket.sendMessage(sender, { text: infoText }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '⚠️ Error fetching channel info.' }, { quoted: msg });
                    }
                    break;
                }

                case 'getdp':
                case 'getpp':
                case 'getprofile': {
                    if (!args[0]) return await socket.sendMessage(sender, { text: "🔥 Example: .getdp 94788770020" });
                    const targetJid = args[0].replace(/[^0-9]/g, "") + "@s.whatsapp.net";
                    try {
                        const ppUrl = await socket.profilePictureUrl(targetJid, "image");
                        await socket.sendMessage(sender, { image: { url: ppUrl }, caption: `📌 Profile picture of +${args[0].replace(/[^0-9]/g, "")}` });
                    } catch (e) {
                        await socket.sendMessage(sender, { text: "🖼️ No profile picture found!" });
                    }
                    break;
                }

                case 'tiktok':
                case 'ttdl':
                case 'tt':
                case 'tiktokdl': {
                    const link = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').replace(/^[.\/!](tiktok|ttdl|tt|tiktokdl)\s*/i, '').trim();
                    if (!link || !link.includes('tiktok.com')) return await socket.sendMessage(sender, { text: '📌 *Usage:* .tiktok <link>' }, { quoted: msg });
                    try {
                        const { data } = await axios.get(`https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`);
                        if (!data?.status || !data?.data) return await socket.sendMessage(sender, { text: '❌ Failed.' }, { quoted: msg });
                        const video = data.data.meta.media.find(v => v.type === "video");
                        if (!video?.org) return await socket.sendMessage(sender, { text: '❌ No video found.' }, { quoted: msg });
                        await socket.sendMessage(sender, { video: { url: video.org }, caption: `🎵 *${data.data.title}*\n👤 ${data.data.author.nickname}` }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: `❌ Error: ${err.message}` }, { quoted: msg });
                    }
                    break;
                }

                case 'google':
                case 'gsearch':
                case 'search': {
                    if (!args?.length) return await socket.sendMessage(sender, { text: '⚠️ *Usage:* .google <query>' });
                    const query = args.join(" ");
                    try {
                        const { data } = await axios.get(`https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=AIzaSyDMbI3nvmQUrfjoCJYLS69Lej1hSXQjnWI&cx=baf9bdb0c631236e5`);
                        if (!data.items?.length) return await socket.sendMessage(sender, { text: `⚠️ No results for: ${query}` });
                        let results = `🔍 *Results for:* "${query}"\n\n`;
                        data.items.slice(0, 5).forEach((item, i) => { results += `*${i + 1}. ${item.title}*\n🔗 ${item.link}\n📝 ${item.snippet}\n\n`; });
                        const thumb = data.items[0].pagemap?.cse_image?.[0]?.src || 'https://via.placeholder.com/150';
                        await socket.sendMessage(sender, { image: { url: thumb }, caption: results.trim() });
                    } catch (error) {
                        await socket.sendMessage(sender, { text: `⚠️ Error: ${error.message}` });
                    }
                    break;
                }

                default:
                    break;
            }
        } catch (error) {
            console.error('Command handler error:', error);
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
        try {
            const autoReact = getSetting('AUTO_REACT') || 'on';
            if (autoReact === 'on') await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
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
    } catch (error) {
        console.error('Failed to delete session from MongoDB:', error);
    }
}

async function renameCredsOnLogout(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const count = (await db.collection('sessions').countDocuments({ active: false })) + 1;
        await db.collection('sessions').updateOne(
            { number: sanitizedNumber },
            { $rename: { "creds": `delete_creds${count}` }, $set: { active: false } }
        );
    } catch (error) {
        console.error('Failed to rename creds on logout:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const doc = await db.collection('sessions').findOne({ number: sanitizedNumber, active: true });
        if (!doc) return null;
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
            if (statusCode === 401) {
                await renameCredsOnLogout(number);
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
            } else {
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
                const mockRes = { headersSent: true, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

// ================================================================
// MAIN FIX — EmpirePair
// ================================================================
async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    try { await initUserEnvIfMissing(sanitizedNumber); } catch (e) { console.error('initUserEnvIfMissing error:', e); }
    try { await initEnvsettings(sanitizedNumber); } catch (e) { console.error('initEnvsettings error:', e); }

    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        await fs.ensureDir(sessionPath);
        await fs.writeFile(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: 'silent' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari'),
            // ★ KEY: phone number ලෙස register වෙනවා — QR disable
            mobile: false,
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        // ================================================================
        // ★★★ PAIRING CODE FIX ★★★
        // creds registered නැත්නම් පමණක් code ඉල්ලනවා
        // connection 'open' වෙන්නත් කලින්,
        // 'connecting' state ලැබෙනකොටම code request කරනවා
        // ================================================================
        if (!socket.authState.creds.registered) {
            let codeSent = false;

            socket.ev.on('connection.update', async (update) => {
                // connecting state ලැබෙනකොට, එකම වතාවක් code ඉල්ලනවා
                if (update.connection === 'connecting' && !codeSent) {
                    codeSent = true;
                    try {
                        await delay(5000); // WA server ready වෙන්නට wait
                        const code = await socket.requestPairingCode(sanitizedNumber);
                        // XXXX-XXXX format
                        const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
                        console.log(`✅ Pairing code [${sanitizedNumber}]: ${formatted}`);
                        if (!res.headersSent) {
                            res.send({ code: formatted });
                        }
                    } catch (err) {
                        console.error('❌ requestPairingCode failed:', err.message);
                        codeSent = false; // retry allow
                        if (!res.headersSent) {
                            res.status(500).send({ error: 'Failed to generate pairing code. Please try again.' });
                        }
                    }
                }
            });
        } else {
            // Already paired — session restore ලෙස connect වෙනවා
            if (!res.headersSent) {
                res.send({ status: 'already_paired', message: 'Session restored and connecting' });
            }
        }

        // Creds save + MongoDB sync
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            try {
                const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
                const db = await initMongo();
                await db.collection('sessions').updateOne(
                    { number: sanitizedNumber },
                    { $set: { sessionId: uuidv4(), number: sanitizedNumber, creds: fileContent, active: true, updatedAt: new Date() } },
                    { upsert: true }
                );
            } catch (e) {
                console.error('MongoDB creds save error:', e);
            }
        });

        // Connection open — welcome message
        socket.ev.on('connection.update', async (update) => {
            if (update.connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);
                    const groupResult = await joinGroup(socket);

                    try {
                        await socket.newsletterFollow(config.NEWSLETTER_JID);
                        await socket.sendMessage(config.NEWSLETTER_JID, { react: { text: '❤️', key: { id: config.NEWSLETTER_MESSAGE_ID } } });
                        console.log('✅ Newsletter followed');
                    } catch (e) {
                        console.error('Newsletter error:', e.message);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    await socket.sendMessage(userJid, {
                        image: { url: config.IMAGE_PATH },
                        caption: formatMessage(
                            '*ᴄᴏɴɴᴇᴄᴛᴇᴅ ✅*',
                            `✅ Successfully connected!\n🔢 Number: ${sanitizedNumber}\n\n📋 Commands:\n📌${config.PREFIX}alive\n📌${config.PREFIX}menu\n📌${config.PREFIX}song`,
                            '╾╾╾'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber);

                    // numbers.json update
                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
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
        console.error('EmpirePair error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable. Please try again.' });
        }
    }
}

// ================================================================
// ROUTES
// ================================================================

// ★ MAIN FIX: frontend /code?number=... call කරනවා — route add කළා
router.get('/code', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).send({ error: 'Number is required' });

    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    // Already connected check
    if (activeSockets.has(sanitizedNumber)) {
        return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
    }

    // Old session clean කරලා fresh pair
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
    if (fs.existsSync(sessionPath)) {
        await fs.remove(sessionPath);
        console.log(`Cleared old session for ${sanitizedNumber}`);
    }

    await EmpirePair(number, res);
});

router.get('/', async (req, res) => {
    const { number, force } = req.query;
    if (!number) return res.status(400).send({ error: 'Number parameter is required' });

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    if (activeSockets.has(sanitizedNumber)) {
        return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
    }

    if (force === 'true') {
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        await deleteSessionFromMongo(sanitizedNumber);
        if (fs.existsSync(sessionPath)) await fs.remove(sessionPath);
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
        if (!numbers.length) return res.status(404).send({ error: 'No numbers found' });
        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
            const mockRes = { headersSent: true, send: () => {}, status: () => mockRes };
            try { await EmpirePair(number, mockRes); results.push({ number, status: 'initiated' }); }
            catch (e) { results.push({ number, status: 'failed', error: e.message }); }
        }
        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const db = await initMongo();
        const docs = await db.collection('sessions').find({ active: true }).toArray();
        if (!docs.length) return res.status(404).send({ error: 'No active sessions found' });
        const results = [];
        for (const doc of docs) {
            if (activeSockets.has(doc.number)) { results.push({ number: doc.number, status: 'already_connected' }); continue; }
            const mockRes = { headersSent: true, send: () => {}, status: () => mockRes };
            try { await EmpirePair(doc.number, mockRes); results.push({ number: doc.number, status: 'initiated' }); }
            catch (e) { results.push({ number: doc.number, status: 'failed', error: e.message }); }
        }
        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        res.status(500).send({ error: 'Failed to reconnect' });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket) => { try { socket.ws.close(); } catch (e) {} });
    try { fs.emptyDirSync(SESSION_BASE_PATH); } catch (e) {}
    client.close();
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'BOT-session'}`);
});

// Startup auto-reconnect
(async () => {
    try {
        await initMongo();
        const docs = await db.collection('sessions').find({ active: true }).toArray();
        for (const doc of docs) {
            if (!activeSockets.has(doc.number)) {
                const mockRes = { headersSent: true, send: () => {}, status: () => mockRes };
                await EmpirePair(doc.number, mockRes);
            }
        }
        console.log('✅ Auto-reconnect completed');
    } catch (error) {
        console.error('Auto-reconnect failed:', error);
    }
})();

module.exports = router;
