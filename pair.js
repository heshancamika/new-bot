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

const mongoUri = 'mongodb+srv://sampathvimukthi_db_user:Kavi123@cluster0.r9le3wy.mongodb.net/';
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

function generateListMessage(text, buttonTitle, sections) {
    return {
        text: text,
        footer: config.BOT_FOOTER,
        title: buttonTitle,
        buttonText: "Select",
        sections: sections
    };
}

function generateButtonMessage(content, buttons, image = null) {
    const message = {
        text: content,
        footer: config.BOT_FOOTER,
        buttons: buttons,
        headerType: 1
    };
    if (image) {
        message.headerType = 4;
        message.image = typeof image === 'string' ? { url: image } : image;
    }
    return message;
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
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const caption = formatMessage(
        '*Connected Successful ✅*',
        ` ❗Number: ${number}\n 🧚‍♂️ Status: Online`,
        `${config.BOT_FOOTER}`
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.IMAGE_PATH },
                    caption
                }
            );
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

            if (!messageId) {
                console.warn('No valid newsletterServerId found:', message);
                return;
            }

            let retries = config.MAX_RETRIES;
            while (retries > 0) {
                try {
                    await socket.newsletterReactMessage(
                        config.NEWSLETTER_JID,
                        messageId.toString(),
                        randomEmoji
                    );
                    console.log(`Reacted to newsletter message ${messageId} with ${randomEmoji}`);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to react to newsletter message ${messageId}, retries left: ${retries}`, error.message);
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
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            const autoReact = getSetting('AUTO_REACT') || 'on';
            if (autoReact === 'on' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
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
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
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
            await socket.sendMessage(userJid, {
                image: { url: config.IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function fetchNews() {
    try {
        const response = await axios.get(config.NEWS_JSON_URL);
        return response.data || [];
    } catch (error) {
        console.error('Failed to fetch news from raw JSON URL:', error.message);
        return [];
    }
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
                    const content = `*© 𝐏ᴏᴡᴇʀᴅ 𝐁ʏ hashen ❛🧚‍♂️*\n` +
                                   `*𝐁ᴏᴛ 𝐎ᴡɴᴇʀ :- hashen*\n` +
                                   `*𝐎ᴡᴇɴʀ 𝐍ᴜᴍʙᴇʀ :- 94729101856.\n` +
                                   `*ᴍɪɴɪ ꜱɪᴛᴇ*\n` +
                                   `> https://hashen-mini-bot.onrender.com/`;
                    const footer = config.BOT_FOOTER;

                    await socket.sendMessage(sender, {
                        image: { url: config.BUTTON_IMAGES.ALIVE },
                        caption: formatMessage(title, content, footer),
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

                    await socket.sendMessage(sender, {
                        react: { text: "😻", key: msg.key }
                    });

                    const kariyane = `┏━❐  \`ᴀʟʟ ᴍᴇɴᴜ\`
┃ *⭔ ʙᴏᴛ ɴᴀᴍᴇ - HASHEN-x-ᴍɪɴɪ*
┃ *⭔ ᴘʟᴀᴛꜰʀᴏᴍ - Heroku*
┃ *⭔ ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s
┗━❐




╭─═❮ ⚡ ʙᴏᴛ ᴍᴇɴᴜ ⚡ ❯═━───❖
┣📌 𝑺ʏꜱᴛᴇᴍ
*│ 🟢 .ᴀʟɪᴠᴇ →*
┣ ʙᴏᴛ ᴏɴʟɪɴᴇ ᴄʜᴇᴄᴋ
*│ 📶 .ᴘɪɴɢ →*
┣ ꜱᴘᴇᴇᴅ ᴛᴇꜱᴛ
*│ ⚙️ .ꜱʏꜱᴛᴇᴍ →*
┣ ʙᴏᴛ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ
*│ 👑 .ᴏᴡɴᴇʀ →*
┣ ꜱʜᴏᴡ ʙᴏᴛ ᴏᴡɴᴇʀꜱ
┢━━━━━━━━━━━━━━━━━━━━➢
┡🎵 𝑴ᴇᴅɪᴀ
*│ 🎼 .ꜱᴏɴɢ <ɴᴀᴍᴇ>  →*
┣ ᴅᴏᴡɴʟᴏᴀᴅ ꜱᴏɴɢ
*│ 📘 .ꜰʙ <ᴜʀʟ> →*
┣ ꜰᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏ ᴅᴏᴡɴ
*│ 🎶 .ᴛɪᴋᴛᴏᴋꜱᴇᴀʀᴄʜ <ɴᴀᴍᴇ> →*
┣  ꜱᴇᴀʀᴄʜ ᴛɪᴋᴛᴏᴋ
*│ 🎵 .ᴛɪᴋᴛᴏᴋ <ᴜʀʟ> →*
┣ ᴛɪᴋᴛᴏᴋ ᴅʟ
*│ 📲 .ᴀᴘᴋ <ɴᴀᴍᴇ> →*
┣ ᴀᴘᴋ ᴅᴏᴡɴʟᴏᴀᴅ
┢━━━━━━━━━━━━━━━━━━━━➢
┡🛠 𝑻ᴏᴏʟꜱ
*│ 📦 .ɴᴘᴍ <ᴘᴀᴄᴋᴀɢᴇ> →*
┣ ɢᴇᴛ ɴᴘᴍ ɪɴꜰᴏ
*│ 🔍 .ɢᴏᴏɢʟᴇ <ǫᴜᴇʀʏ> →*
┣ ɢᴏᴏɢʟᴇ ꜱᴇᴀʀᴄʜ
*│ 🤖 .ᴀɪ <ᴘʀᴏᴍᴘᴛ> →*
┣ ᴄʜᴀᴛ ᴡɪᴛʜ ᴀɪ
*│ 🖼️ .ɢᴇᴛᴅᴘ <ᴊɪᴅ> →*
┣ ɢᴇᴛ ᴘʀᴏꜰɪʟᴇ ᴘɪᴄ
*│ 💥 .ʙᴏᴏᴍ <ɴᴜᴍ|ᴄᴏᴜɴᴛ> →*
┣ ʙᴏᴏᴍ ɴᴜᴍʙᴇʀ
┢━━━━━━━━━━━━━━━━━━━━➢
┡🔗 𝑾ʜᴀᴛꜱᴀᴘᴘ
*│ 🔗 .ᴘᴀɪʀ <ᴄᴏᴅᴇ> →*
┣ ᴘᴀɪʀ ꜱᴇꜱꜱɪᴏɴ
*│ 🆔 .ᴊɪᴅ →*
┣ ɢᴇᴛ ᴄʜᴀᴛ ᴊɪᴅ
*│ 📡 .ᴄɪᴅ <ʟɪɴᴋ> →*
┣ ɢᴇᴛ ᴄʜᴀɴɴᴇʟ ɪɴꜰᴏ
╰━━━━━━━━━━━━━━━━━━━┈⊷`;

                    await socket.sendMessage(sender, {
                        image: { url: "https://files.catbox.moe/riqrud.jpg" },
                        caption: kariyane,
                        contextInfo: {
                            mentionedJid: ['94729101856@s.whatsapp.net'],
                            groupMentions: [],
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
                            return await socket.sendMessage(sender, {
                                text: "🎶 *කරුණාකර ගීතයේ නමක් හෝ YouTube link එකක් දෙන්න!*\n\nඋදාහරණයක්:\n`.song shape of you`"
                            }, { quoted: msg });
                        }

                        const search = await yts(q);

                        if (!search.videos || search.videos.length === 0) {
                            return await socket.sendMessage(sender, { text: "*❌ ගීතය හමුනොවුණා. වෙනත් නමක් උත්සහ කරන්න!*" }, { quoted: msg });
                        }

                        const data = search.videos[0];
                        const ytUrl = data.url;

                        const api = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${ytUrl}&format=mp3&apikey=sadiya`;
                        const { data: apiRes } = await axios.get(api);

                        if (!apiRes?.status || !apiRes.result?.download) {
                            return await socket.sendMessage(sender, { text: "❌ ගීතය බාගත කළ නොහැක. වෙනත් එකක් උත්සහ කරන්න!" }, { quoted: msg });
                        }

                        const result = apiRes.result;

                        const caption = `╭───────────────╮
🎶 *Title:* ${data.title}
⏱️ *Duration:* ${data.timestamp}
👁️ *Views:* ${data.views}
📅 *Released:* ${data.ago}
╰───────────────╯`;

                        await socket.sendMessage(sender, {
                            image: { url: result.thumbnail },
                            caption: caption,
                        });

                        await socket.sendMessage(sender, {
                            audio: { url: result.download },
                            mimetype: "audio/mpeg",
                            fileName: `${data.title}.mp3`,
                        });

                    } catch (e) {
                        console.error(e);
                        await socket.sendMessage(sender, { text: "❌ *දෝෂයකි!* කරුණාකර පසුව නැවත උත්සහ කරන්න." }, { quoted: msg });
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
                    await socket.sendMessage(sender, {
                        react: { text: "👤", key: msg.key }
                    });

                    const ownerContact = {
                        contacts: {
                            displayName: 'My Contacts',
                            contacts: [
                                {
                                    vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:ᴊᴇꜱᴛᴇʀ\nTEL;TYPE=Coder,VOICE:94788770020\nEND:VCARD',
                                },
                                {
                                    vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:ᴅᴇᴡᴡ\nTEL;TYPE=Coder,VOICE:+94775877546\nEND:VCARD',
                                },
                            ],
                        },
                    };

                    const ownerLocation = {
                        location: {
                            degreesLatitude: 6.9271,
                            degreesLongitude: 80.5550,
                            name: 'deww Address',
                            address: 'Kurunegala, Sri Lanka',
                        },
                    };

                    await socket.sendMessage(sender, ownerContact);
                    await socket.sendMessage(sender, ownerLocation);
                    break;
                }

                case 'fb':
                case 'fbdl':
                case 'facebook': {
                    try {
                        const fbUrl = args.join(" ");
                        if (!fbUrl) {
                            return await socket.sendMessage(sender, { text: '*𝐏ℓєαʂє 𝐏ɼ๏νιɖє 𝐀 fb҇ 𝐕ιɖє๏ ๏ɼ ɼєєℓ 𝐔ɼℓ..*' }, { quoted: msg });
                        }

                        const apiKey = 'e276311658d835109c';
                        const apiUrl = `https://api.nexoracle.com/downloader/facebook?apikey=${apiKey}&url=${encodeURIComponent(fbUrl)}`;
                        const response = await axios.get(apiUrl);

                        if (!response.data || !response.data.result || !response.data.result.sd) {
                            return await socket.sendMessage(sender, { text: '*❌ Invalid or unsupported Facebook video URL.*' }, { quoted: msg });
                        }

                        const { sd } = response.data.result;

                        await socket.sendMessage(sender, {
                            video: { url: sd },
                            caption: `*❒🚀 HASHEN X FB VIDEO DL 🚀❒*`,
                        });

                    } catch (error) {
                        console.error('Error downloading Facebook video:', error);
                        await socket.sendMessage(sender, { text: '❌ Unable to download the Facebook video. Please try again later.' }, { quoted: msg });
                    }
                    break;
                }

                case 'system': {
                    const title = "*❗ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ ❗*";
                    let totalStorage = Math.floor(os.totalmem() / 1024 / 1024) + 'MB';
                    let freeStorage = Math.floor(os.freemem() / 1024 / 1024) + 'MB';
                    let cpuModel = os.cpus()[0].model;
                    let cpuSpeed = os.cpus()[0].speed / 1000;
                    let cpuCount = os.cpus().length;

                    let content = `
  ◦ *Runtime*: ${runtime(process.uptime())}
  ◦ *Total Ram*: ${totalStorage}
  ◦ *CPU Speed*: ${cpuSpeed} GHz
  ◦ *Number of CPU Cores*: ${cpuCount} 
`;

                    await socket.sendMessage(sender, {
                        image: { url: `https://files.catbox.moe/czzhiv.jpg` },
                        caption: formatMessage(title, content, config.BOT_FOOTER)
                    });
                    break;
                }

                case 'npm': {
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    const packageName = q.replace(/^[.\/!]npm\s*/i, '').trim();

                    if (!packageName) {
                        return await socket.sendMessage(sender, {
                            text: '📦 *Usage:* .npm <package-name>\n\nExample: .npm express'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: `🔎 Searching npm for: *${packageName}*`
                        }, { quoted: msg });

                        const apiUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
                        const { data, status } = await axios.get(apiUrl);

                        if (status !== 200) {
                            return await socket.sendMessage(sender, {
                                text: '🚫 Package not found.'
                            }, { quoted: msg });
                        }

                        const latestVersion = data["dist-tags"]?.latest || 'N/A';
                        const description = data.description || 'No description available.';
                        const npmUrl = `https://www.npmjs.com/package/${packageName}`;
                        const license = data.license || 'Unknown';
                        const repository = data.repository ? data.repository.url.replace('git+', '').replace('.git', '') : 'Not available';

                        const caption = `
📦 *NPM Package Search*

🔰 *Package:* ${packageName}
📄 *Description:* ${description}
⏸️ *Latest Version:* ${latestVersion}
🪪 *License:* ${license}
🪩 *Repository:* ${repository}
🔗 *NPM URL:* ${npmUrl}
`;

                        await socket.sendMessage(sender, {
                            text: caption,
                            contextInfo: {
                                mentionedJid: [msg.key.participant || sender],
                                forwardingScore: 999,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363421849015331@newsletter',
                                    newsletterName: '𝐒ᴇɴᴜ-𝐱-𝐌ɪɴɪ-𝐁ᴏᴛ',
                                    serverMessageId: 143
                                }
                            }
                        }, { quoted: msg });

                    } catch (err) {
                        console.error("NPM command error:", err);
                        await socket.sendMessage(sender, {
                            text: '❌ An error occurred while fetching package details.'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'tiktoksearch': {
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    const query = q.replace(/^[.\/!]tiktoksearch|tiks\s*/i, '').trim();

                    if (!query) {
                        return await socket.sendMessage(sender, {
                            text: '🌸 *Usage:* .tiktoksearch <query>\n\nExample: .tiktoksearch funny dance'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: `🔎 Searching TikTok for: *${query}*`
                        }, { quoted: msg });

                        const apiUrl = `https://apis-starlights-team.koyeb.app/starlight/tiktoksearch?text=${encodeURIComponent(query)}`;
                        const { data } = await axios.get(apiUrl);

                        if (!data?.status || !data?.data || data.data.length === 0) {
                            return await socket.sendMessage(sender, {
                                text: '❌ No results found.'
                            }, { quoted: msg });
                        }

                        const results = data.data.slice(0, 7).sort(() => Math.random() - 0.5);

                        for (const video of results) {
                            const caption = `🌸 *TikTok Video Result*\n\n` +
                                           `📖 *Title:* ${video.title || 'Unknown'}\n` +
                                           `👤 *Author:* ${video.author?.nickname || video.author || 'Unknown'}\n` +
                                           `⏱ *Duration:* ${video.duration || 'Unknown'}\n` +
                                           `🔗 *URL:* ${video.link || 'N/A'}\n`;

                            if (video.nowm) {
                                await socket.sendMessage(sender, {
                                    video: { url: video.nowm },
                                    caption: caption,
                                    contextInfo: { mentionedJid: [msg.key.participant || sender] }
                                }, { quoted: msg });
                            } else {
                                await socket.sendMessage(sender, {
                                    text: `❌ Failed to retrieve video for "${video.title || 'Unknown'}"`
                                }, { quoted: msg });
                            }
                        }

                    } catch (err) {
                        console.error("TikTokSearch command error:", err);
                        await socket.sendMessage(sender, {
                            text: '❌ An error occurred while searching TikTok.'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'dailyfact': {
                    // dailyfact command - placeholder, requires external implementation
                    await socket.sendMessage(sender, {
                        text: "❌ Daily fact feature is not configured yet."
                    }, { quoted: msg });
                    break;
                }

                case 'apk': {
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    const query = q.replace(/^[.\/!]apk\s*/i, '').trim();

                    if (!query) {
                        await socket.sendMessage(sender, {
                            text: "*🔍 Please provide an app name to search.*\n\n_Usage:_\n.apk Instagram"
                        });
                        break;
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: "⬇️", key: msg.key } });

                        const apiUrl = `http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=1`;
                        const response = await axios.get(apiUrl);
                        const data = response.data;

                        if (!data.datalist || !data.datalist.list || !data.datalist.list.length) {
                            await socket.sendMessage(sender, { text: "❌ *No APK found for your query.*" });
                            break;
                        }

                        const app = data.datalist.list[0];
                        const sizeMB = (app.size / (1024 * 1024)).toFixed(2);

                        const caption = `
🎮 *App Name:* ${app.name}
📦 *Package:* ${app.package}
📅 *Last Updated:* ${app.updated}
📁 *Size:* ${sizeMB} MB

> > 𝐏ᴏᴡᴇʀᴅ ʙʏ 𝐒ᴇɴᴜ x 𝐌ɪɴɪ ❗
                        `.trim();

                        await socket.sendMessage(sender, { react: { text: "⬆️", key: msg.key } });

                        await socket.sendMessage(sender, {
                            document: { url: app.file.path_alt },
                            fileName: `${app.name}.apk`,
                            mimetype: 'application/vnd.android.package-archive',
                            caption,
                            contextInfo: {
                                externalAdReply: {
                                    title: app.name,
                                    body: "Download via",
                                    mediaType: 1,
                                    sourceUrl: app.file.path_alt,
                                    thumbnailUrl: app.icon,
                                    renderLargerThumbnail: true,
                                    showAdAttribution: true
                                }
                            },
                            quoted: msg
                        });

                        await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } });

                    } catch (e) {
                        console.error(e);
                        await socket.sendMessage(sender, {
                            text: "❌ *Error occurred while downloading the APK.*\n\n_" + e.message + "_"
                        });
                    }
                    break;
                }

                case 'boom': {
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text || '';
                    const parts = q.replace(/^[.\/!]boom\s*/i, '').split(',').map(x => x?.trim());
                    const target = parts[0];
                    const text = parts[1];
                    const count = parseInt(parts[2]) || 5;

                    if (!target || !text) {
                        return await socket.sendMessage(sender, {
                            text: '📌 *Usage:* .boom <number>,<message>,<count>\n\nExample:\n.boom 94xxxxxxxxx,Hello,5'
                        }, { quoted: msg });
                    }

                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

                    if (count > 20) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Limit is 20 messages per bomb.*'
                        }, { quoted: msg });
                    }

                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text });
                        await delay(700);
                    }

                    await socket.sendMessage(sender, {
                        text: `✅ Bomb sent to ${target} — ${count}x`
                    }, { quoted: msg });
                    break;
                }

                case 'pair': {
                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    const pairNumber = q.replace(/^[.\/!]pair\s*/i, '').trim();

                    if (!pairNumber) {
                        return await socket.sendMessage(sender, {
                            text: '*📌 Usage:* .pair +94788770020'
                        }, { quoted: msg });
                    }

                    try {
                        const url = `https://dinu-3ab31409578e.herokuapp.com/code?number=${encodeURIComponent(pairNumber)}`;
                        const response = await fetch(url);
                        const bodyText = await response.text();

                        let result;
                        try {
                            result = JSON.parse(bodyText);
                        } catch (e) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Invalid response from server.'
                            }, { quoted: msg });
                        }

                        if (!result || !result.code) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Failed to retrieve pairing code.'
                            }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, {
                            text: `*01 📋 Copy This Code*\n*02 🔗 Go to Link Device*\n*03 ✂️ Paste the Code*\n\n> After Your Bot Deploy...  ✅\n\n*🔑 Your pairing code is:* ${result.code}`
                        }, { quoted: msg });

                        await sleep(2000);

                        await socket.sendMessage(sender, {
                            text: `${result.code}`
                        }, { quoted: msg });

                    } catch (err) {
                        console.error("❌ Pair Command Error:", err);
                        await socket.sendMessage(sender, {
                            text: '❌ An error occurred. Please try again later.'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'jid': {
                    try {
                        await socket.sendMessage(sender, {
                            text: `${sender}`
                        });
                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, {
                            text: 'Error while retrieving the JID!'
                        });
                    }
                    break;
                }

                case 'ai': {
                    const GEMINI_API_KEY = 'AIzaSyBdBivCo6jWSchTb8meP7VyxbHpoNY_qfQ';
                    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    if (!q || q.trim() === '') {
                        return await socket.sendMessage(sender, { text: "Hy i am Freedom ai ❗" }, { quoted: msg });
                    }

                    const prompt = `ඔබ සැබෑ ගැහැනු ලමයෙකු මෙන් හැසිරිය යුතුය. ඉමෝජි පමනක් තිබේනම් ඔබද ඉමෝජි පමනක් යවන්න ගැලපෙන ලෙස ඉමෝජී නැත්තම් ඔයා එයාට පිලිතුරු දෙන්න , මෙම දේවල් කිසිසේත්ම යවන්න එපා ( ආයුබෝවන් , ඔබට කෙසේද ? , කතාකරන්න , ඕනේ ? , කොහොමද ? , කෙසේද ? , කැමතිද ? ,) මිනිසුන්ට ඇති හැඟීම්, දැනීම්, සහ සංවේදීතාවය අනුව පිළිතුරු ලබාදිය යුතුය. User Message: ${q}`;

                    const payload = {
                        contents: [{ parts: [{ text: prompt }] }]
                    };

                    try {
                        const response = await axios.post(GEMINI_API_URL, payload, {
                            headers: { "Content-Type": "application/json" }
                        });

                        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;

                        if (!aiResponse) {
                            return await socket.sendMessage(sender, { text: "❌ Error." }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, { text: aiResponse }, { quoted: msg });

                    } catch (err) {
                        console.error("Gemini Error:", err.response?.data || err.message);
                        await socket.sendMessage(sender, { text: "❌ Error" }, { quoted: msg });
                    }
                    break;
                }

                case 'cid': {
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    const channelLink = q.replace(/^[.\/!]cid\s*/i, '').trim();

                    if (!channelLink) {
                        return await socket.sendMessage(sender, {
                            text: '❎ Please provide a WhatsApp Channel link.\n\n📌 *Example:* .cid https://whatsapp.com/channel/123456789'
                        }, { quoted: msg });
                    }

                    const match = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/);
                    if (!match) {
                        return await socket.sendMessage(sender, {
                            text: '⚠️ *Invalid channel link format.*'
                        }, { quoted: msg });
                    }

                    const inviteId = match[1];

                    try {
                        await socket.sendMessage(sender, {
                            text: `🔎 Fetching channel info for: *${inviteId}*`
                        }, { quoted: msg });

                        const metadata = await socket.newsletterMetadata("invite", inviteId);

                        if (!metadata || !metadata.id) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Channel not found or inaccessible.'
                            }, { quoted: msg });
                        }

                        const infoText = `
📡 *WhatsApp Channel Info*

🆔 *ID:* ${metadata.id}
📌 *Name:* ${metadata.name}
👥 *Followers:* ${metadata.subscribers?.toLocaleString() || 'N/A'}
📅 *Created on:* ${metadata.creation_time ? new Date(metadata.creation_time * 1000).toLocaleString("id-ID") : 'Unknown'}
`;

                        if (metadata.preview) {
                            await socket.sendMessage(sender, {
                                image: { url: `https://pps.whatsapp.net${metadata.preview}` },
                                caption: infoText
                            }, { quoted: msg });
                        } else {
                            await socket.sendMessage(sender, { text: infoText }, { quoted: msg });
                        }

                    } catch (err) {
                        console.error("CID command error:", err);
                        await socket.sendMessage(sender, {
                            text: '⚠️ An unexpected error occurred while fetching channel info.'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'getdp':
                case 'getpp':
                case 'getprofile': {
                    try {
                        if (!args[0]) {
                            return await socket.sendMessage(sender, {
                                text: "🔥 Please provide a phone number\n\nExample: .getdp 94788770020"
                            });
                        }

                        let targetJid = args[0].replace(/[^0-9]/g, "") + "@s.whatsapp.net";

                        await socket.sendMessage(sender, { text: "🔍 Fetching profile picture..." });

                        let ppUrl;
                        try {
                            ppUrl = await socket.profilePictureUrl(targetJid, "image");
                        } catch (e) {
                            return await socket.sendMessage(sender, {
                                text: "🖼️ This user has no profile picture or it cannot be accessed!"
                            });
                        }

                        await socket.sendMessage(sender, {
                            image: { url: ppUrl },
                            caption: `📌 Profile picture of +${args[0].replace(/[^0-9]/g, "")}`,
                            contextInfo: {
                                forwardingScore: 999,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363421468247130@newsletter',
                                    newsletterName: '-HASHEN-x-𝐌ɪɴɪ-𝐁ᴏᴛ',
                                    serverMessageId: 143
                                }
                            }
                        });

                    } catch (e) {
                        console.error('Error in getdp case:', e);
                        await socket.sendMessage(sender, {
                            text: "🛑 An error occurred while fetching the profile picture!"
                        });
                    }
                    break;
                }

                case 'channelreact':
                case 'creact':
                case 'chr':
                case 'react': {
                    try {
                        const q = msg.message?.conversation ||
                                  msg.message?.extendedTextMessage?.text || '';

                        const qArgs = q.replace(/^[.\/!]\w+\s*/i, '').trim();

                        if (!qArgs) {
                            await socket.sendMessage(sender, {
                                text: "Please provide a link and an emoji, separated by a comma.\n\nUsage: .channelreact <channel_link>,<emoji>"
                            });
                            break;
                        }

                        let [linkPart, emoji] = qArgs.split(",");
                        if (!linkPart || !emoji) {
                            await socket.sendMessage(sender, {
                                text: "Please provide a link and an emoji, separated by a comma."
                            });
                            break;
                        }

                        linkPart = linkPart.trim();
                        emoji = emoji.trim();

                        if (!linkPart.includes('whatsapp.com/channel/')) {
                            await socket.sendMessage(sender, {
                                text: "❌ Invalid channel link format."
                            });
                            break;
                        }

                        const urlParts = linkPart.split("/");
                        const channelIndex = urlParts.findIndex(part => part === 'channel');

                        if (channelIndex === -1 || channelIndex + 2 >= urlParts.length) {
                            await socket.sendMessage(sender, {
                                text: "❌ Invalid channel link format."
                            });
                            break;
                        }

                        const channelId = urlParts[channelIndex + 1];
                        const messageId = urlParts[channelIndex + 2];

                        if (!channelId || !messageId) {
                            await socket.sendMessage(sender, {
                                text: "❌ Could not extract channel ID and message ID."
                            });
                            break;
                        }

                        await socket.sendMessage(sender, {
                            text: `🔄 Processing reaction ${emoji}...`
                        });

                        let res2;
                        try {
                            res2 = await socket.newsletterMetadata("invite", channelId);
                        } catch (metadataError) {
                            await socket.sendMessage(sender, {
                                text: "❌ Failed to get channel information."
                            });
                            break;
                        }

                        if (!res2 || !res2.id) {
                            await socket.sendMessage(sender, {
                                text: "❌ Failed to get channel information."
                            });
                            break;
                        }

                        await socket.newsletterReactMessage(res2.id, messageId, emoji);

                        await socket.sendMessage(sender, {
                            text: `✅ Successfully reacted with ${emoji}!`
                        });

                    } catch (error) {
                        console.error(`Error in 'channelreact' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: `❌ Error: ${error.message}`
                        });
                    }
                    break;
                }

                case 'tiktok':
                case 'ttdl':
                case 'tt':
                case 'tiktokdl': {
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    const link = q.replace(/^[.\/!](tiktok|ttdl|tt|tiktokdl)\s*/i, '').trim();

                    if (!link) {
                        return await socket.sendMessage(sender, {
                            text: '📌 *Usage:* .tiktok <link>'
                        }, { quoted: msg });
                    }

                    if (!link.includes('tiktok.com')) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Invalid TikTok link.*'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '⏳ Downloading video, please wait...'
                        }, { quoted: msg });

                        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`;
                        const { data } = await axios.get(apiUrl);

                        if (!data?.status || !data?.data) {
                            return await socket.sendMessage(sender, {
                                text: '❌ Failed to fetch TikTok video.'
                            }, { quoted: msg });
                        }

                        const { title, like, comment, share, author, meta } = data.data;
                        const video = meta.media.find(v => v.type === "video");

                        if (!video || !video.org) {
                            return await socket.sendMessage(sender, {
                                text: '❌ No downloadable video found.'
                            }, { quoted: msg });
                        }

                        const caption = `🎵 *TIKTOK DOWNLOADR*\n\n` +
                                        `👤 *User:* ${author.nickname} (@${author.username})\n` +
                                        `📖 *Title:* ${title}\n` +
                                        `👍 *Likes:* ${like}\n💬 *Comments:* ${comment}\n🔁 *Shares:* ${share}`;

                        await socket.sendMessage(sender, {
                            video: { url: video.org },
                            caption: caption,
                            contextInfo: { mentionedJid: [msg.key.participant || sender] }
                        }, { quoted: msg });

                    } catch (err) {
                        console.error("TikTok command error:", err);
                        await socket.sendMessage(sender, {
                            text: `❌ An error occurred:\n${err.message}`
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'google':
                case 'gsearch':
                case 'search': {
                    try {
                        if (!args || args.length === 0) {
                            await socket.sendMessage(sender, {
                                text: '⚠️ *Please provide a search query.*\n\n*Example:*\n.google how to code in javascript'
                            });
                            break;
                        }

                        const query = args.join(" ");
                        const apiKey = "AIzaSyDMbI3nvmQUrfjoCJYLS69Lej1hSXQjnWI";
                        const cx = "baf9bdb0c631236e5";
                        const apiUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}`;

                        const response = await axios.get(apiUrl);

                        if (response.status !== 200 || !response.data.items || response.data.items.length === 0) {
                            await socket.sendMessage(sender, {
                                text: `⚠️ *No results found for:* ${query}`
                            });
                            break;
                        }

                        let results = `🔍 *Google Search Results for:* "${query}"\n\n`;
                        response.data.items.slice(0, 5).forEach((item, index) => {
                            results += `*${index + 1}. ${item.title}*\n\n🔗 ${item.link}\n\n📝 ${item.snippet}\n\n`;
                        });

                        const firstResult = response.data.items[0];
                        const thumbnailUrl = firstResult.pagemap?.cse_image?.[0]?.src ||
                                            firstResult.pagemap?.cse_thumbnail?.[0]?.src ||
                                            'https://via.placeholder.com/150';

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: results.trim()
                        });

                    } catch (error) {
                        console.error(`Error in Google search: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: `⚠️ *An error occurred while fetching search results.*\n\n${error.message}`
                        });
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
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    `${config.BOT_FOOTER}`
                )
            });
        }
    });
}

// FIX: autoReact undefined bug fix — getSetting use කළා
function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            const autoReact = getSetting('AUTO_REACT') || 'on';
            if (autoReact === 'on') {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
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
        const collection = db.collection('sessions');
        await collection.deleteOne({ number: sanitizedNumber });
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
            {
                $rename: { "creds": `delete_creds${count}` },
                $set: { active: false }
            }
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
        const collection = db.collection('sessions');
        const doc = await collection.findOne({ number: sanitizedNumber, active: true });
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
                console.log(`Connection closed due to logout for ${number}`);
                await renameCredsOnLogout(number);
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
            } else {
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    try {
        await initUserEnvIfMissing(sanitizedNumber);
    } catch (e) {
        console.error('initUserEnvIfMissing error:', e);
    }

    try {
        await initEnvsettings(sanitizedNumber);
    } catch (e) {
        console.error('initEnvsettings error:', e);
    }

    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        await fs.ensureDir(sessionPath);
        await fs.writeFile(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: true,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code, retries left: ${retries}`, error.message);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        } else {
            if (!res.headersSent) {
                res.send({ status: 'already_paired', message: 'Session restored and connecting' });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            const db = await initMongo();
            const collection = db.collection('sessions');
            const sessionId = uuidv4();
            await collection.updateOne(
                { number: sanitizedNumber },
                {
                    $set: {
                        sessionId,
                        number: sanitizedNumber,
                        creds: fileContent,
                        active: true,
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );
            console.log(`Saved creds for ${sanitizedNumber} with sessionId ${sessionId}`);
        });

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
                        console.log('✅ Auto-followed newsletter & reacted ❤️');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    await socket.sendMessage(userJid, {
                        image: { url: config.IMAGE_PATH },
                        caption: formatMessage(
                            '*ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴍꜱɢ*',
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n\n📋 Available Commands:\n📌${config.PREFIX}alive\n📌${config.PREFIX}menu\n📌${config.PREFIX}song\n📌${config.PREFIX}pair`,
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
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'Free-Bot-Session'}`);
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
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const forceRepair = force === 'true';
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    if (activeSockets.has(sanitizedNumber)) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    if (forceRepair) {
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        await deleteSessionFromMongo(sanitizedNumber);
        if (fs.existsSync(sessionPath)) {
            await fs.remove(sessionPath);
        }
        console.log(`Forced re-pair for ${sanitizedNumber}: deleted old session`);
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: 'BOT is running',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        const promises = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            promises.push(
                EmpirePair(number, mockRes)
                    .then(() => ({ number, status: 'connection_initiated' }))
                    .catch(error => ({ number, status: 'failed', error: error.message }))
            );
        }

        const promiseResults = await Promise.all(promises);
        results.push(...promiseResults);

        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const db = await initMongo();
        const collection = db.collection('sessions');
        const docs = await collection.find({ active: true }).toArray();

        if (docs.length === 0) {
            return res.status(404).send({ error: 'No active sessions found in MongoDB' });
        }

        const results = [];
        const promises = [];
        for (const doc of docs) {
            const number = doc.number;
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            promises.push(
                EmpirePair(number, mockRes)
                    .then(() => ({ number, status: 'connection_initiated' }))
                    .catch(error => ({ number, status: 'failed', error: error.message }))
            );
        }

        const promiseResults = await Promise.all(promises);
        results.push(...promiseResults);

        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
    client.close();
});

process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'BOT-session'}`);
});

// Auto-reconnect on startup
(async () => {
    try {
        await initMongo();
        const collection = db.collection('sessions');
        const docs = await collection.find({ active: true }).toArray();
        for (const doc of docs) {
            const number = doc.number;
            if (!activeSockets.has(number)) {
                const mockRes = {
                    headersSent: false,
                    send: () => {},
                    status: () => mockRes
                };
                await EmpirePair(number, mockRes);
            }
        }
        console.log('Auto-reconnect completed on startup');
    } catch (error) {
        console.error('Failed to auto-reconnect on startup:', error);
    }
})();

module.exports = router;
