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
    AUTO_LIKE_EMOJI: ['ðŸ§©', 'ðŸ‰', 'ðŸ’œ', 'ðŸŒ¸', 'ðŸª´', 'ðŸ’Š', 'ðŸ’«', 'ðŸ‚', 'ðŸŒŸ', 'ðŸŽ‹', 'ðŸ˜¶â€ðŸŒ«ï¸', 'ðŸ«€', 'ðŸ§¿', 'ðŸ‘€', 'ðŸ¤–', 'ðŸš©', 'ðŸ¥°', 'ðŸ—¿', 'ðŸ’œ', 'ðŸ’™', 'ðŸŒ', 'ðŸ–¤', 'ðŸ’š'],
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
    BOT_FOOTER: '> Â© HASHEN x á´ÉªÉ´Éª Ê™á´á´›',
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
        '*Connected Successful âœ…*',
        ` â—Number: ${number}\n ðŸ§šâ€â™‚ï¸ Status: Online`,
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
            const emojis = ['â¤ï¸â€ðŸ©¹'];
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
            'â•­â”€â”€â—¯',
            `â”‚ \`D E L E T E\`\nâ”‚ *â¦ From :* ${messageKey.remoteJid}\nâ”‚ *â¦ Time:* ${deletionTime}\nâ”‚ *â¦ Type: Normal*\nâ•°â”€â”€â—¯`,
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

                    const title = '*â›HASHEN X MINI V1 ðŸ§šâ€â™‚ï¸â›*';
                    const content = `*Â© ðá´á´¡á´‡Ê€á´… ðÊ hashen â›ðŸ§šâ€â™‚ï¸*\n` +
                                   `*ðá´á´› ðŽá´¡É´á´‡Ê€ :- hashen*\n` +
                                   `*ðŽá´¡á´‡É´Ê€ ðá´œá´Ê™á´‡Ê€ :- 94729101856.\n` +
                                   `*á´ÉªÉ´Éª êœ±Éªá´›á´‡*\n` +
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
                        react: { text: "ðŸ˜»", key: msg.key }
                    });

                    const kariyane = `â”â”â  \`á´€ÊŸÊŸ á´á´‡É´á´œ\`
â”ƒ *â­” Ê™á´á´› É´á´€á´á´‡ - HASHEN-x-á´ÉªÉ´Éª*
â”ƒ *â­” á´˜ÊŸá´€á´›êœ°Ê€á´á´ - Heroku*
â”ƒ *â­” á´œá´˜á´›Éªá´á´‡:* ${hours}h ${minutes}m ${seconds}s
â”—â”â




â•­â”€â•â® âš¡ Ê™á´á´› á´á´‡É´á´œ âš¡ â¯â•â”â”€â”€â”€â–
â”£ðŸ“Œ ð‘ºÊêœ±á´›á´‡á´
*â”‚ ðŸŸ¢ .á´€ÊŸÉªá´ á´‡ â†’*
â”£ Ê™á´á´› á´É´ÊŸÉªÉ´á´‡ á´„Êœá´‡á´„á´‹
*â”‚ ðŸ“¶ .á´˜ÉªÉ´É¢ â†’*
â”£ êœ±á´˜á´‡á´‡á´… á´›á´‡êœ±á´›
*â”‚ âš™ï¸ .êœ±Êêœ±á´›á´‡á´ â†’*
â”£ Ê™á´á´› êœ±Êêœ±á´›á´‡á´ ÉªÉ´êœ°á´
*â”‚ ðŸ‘‘ .á´á´¡É´á´‡Ê€ â†’*
â”£ êœ±Êœá´á´¡ Ê™á´á´› á´á´¡É´á´‡Ê€êœ±
â”¢â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”âž¢
â”¡ðŸŽµ ð‘´á´‡á´…Éªá´€
*â”‚ ðŸŽ¼ .êœ±á´É´É¢ <É´á´€á´á´‡>  â†’*
â”£ á´…á´á´¡É´ÊŸá´á´€á´… êœ±á´É´É¢
*â”‚ ðŸ“˜ .êœ°Ê™ <á´œÊ€ÊŸ> â†’*
â”£ êœ°á´€á´„á´‡Ê™á´á´á´‹ á´ Éªá´…á´‡á´ á´…á´á´¡É´
*â”‚ ðŸŽ¶ .á´›Éªá´‹á´›á´á´‹êœ±á´‡á´€Ê€á´„Êœ <É´á´€á´á´‡> â†’*
â”£  êœ±á´‡á´€Ê€á´„Êœ á´›Éªá´‹á´›á´á´‹
*â”‚ ðŸŽµ .á´›Éªá´‹á´›á´á´‹ <á´œÊ€ÊŸ> â†’*
â”£ á´›Éªá´‹á´›á´á´‹ á´…ÊŸ
*â”‚ ðŸ“² .á´€á´˜á´‹ <É´á´€á´á´‡> â†’*
â”£ á´€á´˜á´‹ á´…á´á´¡É´ÊŸá´á´€á´…
â”¢â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”âž¢
â”¡ðŸ›  ð‘»á´á´ÊŸêœ±
*â”‚ ðŸ“¦ .É´á´˜á´ <á´˜á´€á´„á´‹á´€É¢á´‡> â†’*
â”£ É¢á´‡á´› É´á´˜á´ ÉªÉ´êœ°á´
*â”‚ ðŸ” .É¢á´á´É¢ÊŸá´‡ <Ç«á´œá´‡Ê€Ê> â†’*
â”£ É¢á´á´É¢ÊŸá´‡ êœ±á´‡á´€Ê€á´„Êœ
*â”‚ ðŸ¤– .á´€Éª <á´˜Ê€á´á´á´˜á´›> â†’*
â”£ á´„Êœá´€á´› á´¡Éªá´›Êœ á´€Éª
*â”‚ ðŸ–¼ï¸ .É¢á´‡á´›á´…á´˜ <á´ŠÉªá´…> â†’*
â”£ É¢á´‡á´› á´˜Ê€á´êœ°ÉªÊŸá´‡ á´˜Éªá´„
*â”‚ ðŸ’¥ .Ê™á´á´á´ <É´á´œá´|á´„á´á´œÉ´á´›> â†’*
â”£ Ê™á´á´á´ É´á´œá´Ê™á´‡Ê€
â”¢â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”âž¢
â”¡ðŸ”— ð‘¾Êœá´€á´›êœ±á´€á´˜á´˜
*â”‚ ðŸ”— .á´˜á´€ÉªÊ€ <á´„á´á´…á´‡> â†’*
â”£ á´˜á´€ÉªÊ€ êœ±á´‡êœ±êœ±Éªá´É´
*â”‚ ðŸ†” .á´ŠÉªá´… â†’*
â”£ É¢á´‡á´› á´„Êœá´€á´› á´ŠÉªá´…
*â”‚ ðŸ“¡ .á´„Éªá´… <ÊŸÉªÉ´á´‹> â†’*
â”£ É¢á´‡á´› á´„Êœá´€É´É´á´‡ÊŸ ÉªÉ´êœ°á´
â•°â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”ˆâŠ·`;

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
                                newsletterName: "HASHEN-ð±-ðŒÉªÉ´Éª-ðá´á´›",
                                serverMessageId: 999
                            },
                            externalAdReply: {
                                title: 'á´á´œÊŸá´›Éª á´…á´‡á´ Éªá´„á´‡ á´ÉªÉ´Éª á´¡Êœá´€á´›êœ±á´€á´˜á´˜ Ê™á´á´›',
                                body: 'HASHEN-x-á´ÉªÉ´Éª-á´ 1',
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
                                text: "ðŸŽ¶ *à¶šà¶»à·”à¶«à·à¶šà¶» à¶œà·“à¶­à¶ºà·š à¶±à¶¸à¶šà·Š à·„à· YouTube link à¶‘à¶šà¶šà·Š à¶¯à·™à¶±à·Šà¶±!*\n\nà¶‹à¶¯à·à·„à¶»à¶«à¶ºà¶šà·Š:\n`.song shape of you`"
                            }, { quoted: msg });
                        }

                        const search = await yts(q);

                        if (!search.videos || search.videos.length === 0) {
                            return await socket.sendMessage(sender, { text: "*âŒ à¶œà·“à¶­à¶º à·„à¶¸à·”à¶±à·œà·€à·”à¶«à·. à·€à·™à¶±à¶­à·Š à¶±à¶¸à¶šà·Š à¶‹à¶­à·Šà·ƒà·„ à¶šà¶»à¶±à·Šà¶±!*" }, { quoted: msg });
                        }

                        const data = search.videos[0];
                        const ytUrl = data.url;

                        const api = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${ytUrl}&format=mp3&apikey=sadiya`;
                        const { data: apiRes } = await axios.get(api);

                        if (!apiRes?.status || !apiRes.result?.download) {
                            return await socket.sendMessage(sender, { text: "âŒ à¶œà·“à¶­à¶º à¶¶à·à¶œà¶­ à¶šà·… à¶±à·œà·„à·à¶š. à·€à·™à¶±à¶­à·Š à¶‘à¶šà¶šà·Š à¶‹à¶­à·Šà·ƒà·„ à¶šà¶»à¶±à·Šà¶±!" }, { quoted: msg });
                        }

                        const result = apiRes.result;

                        const caption = `â•­â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•®
ðŸŽ¶ *Title:* ${data.title}
â±ï¸ *Duration:* ${data.timestamp}
ðŸ‘ï¸ *Views:* ${data.views}
ðŸ“… *Released:* ${data.ago}
â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯`;

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
                        await socket.sendMessage(sender, { text: "âŒ *à¶¯à·à·‚à¶ºà¶šà·’!* à¶šà¶»à·”à¶«à·à¶šà¶» à¶´à·ƒà·”à·€ à¶±à·à·€à¶­ à¶‹à¶­à·Šà·ƒà·„ à¶šà¶»à¶±à·Šà¶±." }, { quoted: msg });
                    }
                    break;
                }

                case 'ping': {
                    var inital = new Date().getTime();
                    let ping = await socket.sendMessage(sender, { text: '*_Pinging to Module..._* â—' });
                    var final = new Date().getTime();
                    await socket.sendMessage(sender, { text: 'ã€Š â–ˆâ–’â–’â–’â–’â–’â–’â–’â–’â–’â–’â–’ã€‹10%', edit: ping.key });
                    await socket.sendMessage(sender, { text: 'ã€Š â–ˆâ–ˆâ–ˆâ–ˆâ–’â–’â–’â–’â–’â–’â–’â–’ã€‹30%', edit: ping.key });
                    await socket.sendMessage(sender, { text: 'ã€Š â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–’â–’â–’â–’â–’ã€‹50%', edit: ping.key });
                    await socket.sendMessage(sender, { text: 'ã€Š â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–’â–’ã€‹80%', edit: ping.key });
                    await socket.sendMessage(sender, { text: 'ã€Š â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆã€‹100%', edit: ping.key });
                    return await socket.sendMessage(sender, { text: 'â— *Pong ' + (final - inital) + ' Ms*', edit: ping.key });
                }

                case 'owner': {
                    await socket.sendMessage(sender, {
                        react: { text: "ðŸ‘¤", key: msg.key }
                    });

                    const ownerContact = {
                        contacts: {
                            displayName: 'My Contacts',
                            contacts: [
                                {
                                    vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:á´Šá´‡êœ±á´›á´‡Ê€\nTEL;TYPE=Coder,VOICE:94788770020\nEND:VCARD',
                                },
                                {
                                    vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:á´…á´‡á´¡á´¡\nTEL;TYPE=Coder,VOICE:+94775877546\nEND:VCARD',
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
                            return await socket.sendMessage(sender, { text: '*ðâ„“Ñ”Î±Ê‚Ñ” ðÉ¼à¹Î½Î¹É–Ñ” ð€ fbÒ‡ ð•Î¹É–Ñ”à¹ à¹É¼ É¼Ñ”Ñ”â„“ ð”É¼â„“..*' }, { quoted: msg });
                        }

                        const apiKey = 'e276311658d835109c';
                        const apiUrl = `https://api.nexoracle.com/downloader/facebook?apikey=${apiKey}&url=${encodeURIComponent(fbUrl)}`;
                        const response = await axios.get(apiUrl);

                        if (!response.data || !response.data.result || !response.data.result.sd) {
                            return await socket.sendMessage(sender, { text: '*âŒ Invalid or unsupported Facebook video URL.*' }, { quoted: msg });
                        }

                        const { sd } = response.data.result;

                        await socket.sendMessage(sender, {
                            video: { url: sd },
                            caption: `*â’ðŸš€ HASHEN X FB VIDEO DL ðŸš€â’*`,
                        });

                    } catch (error) {
                        console.error('Error downloading Facebook video:', error);
                        await socket.sendMessage(sender, { text: 'âŒ Unable to download the Facebook video. Please try again later.' }, { quoted: msg });
                    }
                    break;
                }

                case 'system': {
                    const title = "*â— êœ±Êêœ±á´›á´‡á´ ÉªÉ´êœ°á´ â—*";
                    let totalStorage = Math.floor(os.totalmem() / 1024 / 1024) + 'MB';
                    let freeStorage = Math.floor(os.freemem() / 1024 / 1024) + 'MB';
                    let cpuModel = os.cpus()[0].model;
                    let cpuSpeed = os.cpus()[0].speed / 1000;
                    let cpuCount = os.cpus().length;

                    let content = `
  â—¦ *Runtime*: ${runtime(process.uptime())}
  â—¦ *Total Ram*: ${totalStorage}
  â—¦ *CPU Speed*: ${cpuSpeed} GHz
  â—¦ *Number of CPU Cores*: ${cpuCount} 
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
                            text: 'ðŸ“¦ *Usage:* .npm <package-name>\n\nExample: .npm express'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: `ðŸ”Ž Searching npm for: *${packageName}*`
                        }, { quoted: msg });

                        const apiUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
                        const { data, status } = await axios.get(apiUrl);

                        if (status !== 200) {
                            return await socket.sendMessage(sender, {
                                text: 'ðŸš« Package not found.'
                            }, { quoted: msg });
                        }

                        const latestVersion = data["dist-tags"]?.latest || 'N/A';
                        const description = data.description || 'No description available.';
                        const npmUrl = `https://www.npmjs.com/package/${packageName}`;
                        const license = data.license || 'Unknown';
                        const repository = data.repository ? data.repository.url.replace('git+', '').replace('.git', '') : 'Not available';

                        const caption = `
ðŸ“¦ *NPM Package Search*

ðŸ”° *Package:* ${packageName}
ðŸ“„ *Description:* ${description}
â¸ï¸ *Latest Version:* ${latestVersion}
ðŸªª *License:* ${license}
ðŸª© *Repository:* ${repository}
ðŸ”— *NPM URL:* ${npmUrl}
`;

                        await socket.sendMessage(sender, {
                            text: caption,
                            contextInfo: {
                                mentionedJid: [msg.key.participant || sender],
                                forwardingScore: 999,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363421849015331@newsletter',
                                    newsletterName: 'ð’á´‡É´á´œ-ð±-ðŒÉªÉ´Éª-ðá´á´›',
                                    serverMessageId: 143
                                }
                            }
                        }, { quoted: msg });

                    } catch (err) {
                        console.error("NPM command error:", err);
                        await socket.sendMessage(sender, {
                            text: 'âŒ An error occurred while fetching package details.'
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
                            text: 'ðŸŒ¸ *Usage:* .tiktoksearch <query>\n\nExample: .tiktoksearch funny dance'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: `ðŸ”Ž Searching TikTok for: *${query}*`
                        }, { quoted: msg });

                        const apiUrl = `https://apis-starlights-team.koyeb.app/starlight/tiktoksearch?text=${encodeURIComponent(query)}`;
                        const { data } = await axios.get(apiUrl);

                        if (!data?.status || !data?.data || data.data.length === 0) {
                            return await socket.sendMessage(sender, {
                                text: 'âŒ No results found.'
                            }, { quoted: msg });
                        }

                        const results = data.data.slice(0, 7).sort(() => Math.random() - 0.5);

                        for (const video of results) {
                            const caption = `ðŸŒ¸ *TikTok Video Result*\n\n` +
                                           `ðŸ“– *Title:* ${video.title || 'Unknown'}\n` +
                                           `ðŸ‘¤ *Author:* ${video.author?.nickname || video.author || 'Unknown'}\n` +
                                           `â± *Duration:* ${video.duration || 'Unknown'}\n` +
                                           `ðŸ”— *URL:* ${video.link || 'N/A'}\n`;

                            if (video.nowm) {
                                await socket.sendMessage(sender, {
                                    video: { url: video.nowm },
                                    caption: caption,
                                    contextInfo: { mentionedJid: [msg.key.participant || sender] }
                                }, { quoted: msg });
                            } else {
                                await socket.sendMessage(sender, {
                                    text: `âŒ Failed to retrieve video for "${video.title || 'Unknown'}"`
                                }, { quoted: msg });
                            }
                        }

                    } catch (err) {
                        console.error("TikTokSearch command error:", err);
                        await socket.sendMessage(sender, {
                            text: 'âŒ An error occurred while searching TikTok.'
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'dailyfact': {
                    await socket.sendMessage(sender, {
                        text: "âŒ Daily fact feature is not configured yet."
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
                            text: "*ðŸ” Please provide an app name to search.*\n\n_Usage:_\n.apk Instagram"
                        });
                        break;
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: "â¬‡ï¸", key: msg.key } });

                        const apiUrl = `http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=1`;
                        const response = await axios.get(apiUrl);
                        const data = response.data;

                        if (!data.datalist || !data.datalist.list || !data.datalist.list.length) {
                            await socket.sendMessage(sender, { text: "âŒ *No APK found for your query.*" });
                            break;
                        }

                        const app = data.datalist.list[0];
                        const sizeMB = (app.size / (1024 * 1024)).toFixed(2);

                        const caption = `
ðŸŽ® *App Name:* ${app.name}
ðŸ“¦ *Package:* ${app.package}
ðŸ“… *Last Updated:* ${app.updated}
ðŸ“ *Size:* ${sizeMB} MB

> > ðá´á´¡á´‡Ê€á´… Ê™Ê ð’á´‡É´á´œ x ðŒÉªÉ´Éª â—
                        `.trim();

                        await socket.sendMessage(sender, { react: { text: "â¬†ï¸", key: msg.key } });

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

                        await socket.sendMessage(sender, { react: { text: "âœ…", key: msg.key } });

                    } catch (e) {
                        console.error(e);
                        await socket.sendMessage(sender, {
                            text: "âŒ *Error occurred while downloading the APK.*\n\n_" + e.message + "_"
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
                            text: 'ðŸ“Œ *Usage:* .boom <number>,<message>,<count>\n\nExample:\n.boom 94xxxxxxxxx,Hello,5'
                        }, { quoted: msg });
                    }

                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

                    if (count > 20) {
                        return await socket.sendMessage(sender, {
                            text: 'âŒ *Limit is 20 messages per bomb.*'
                        }, { quoted: msg });
                    }

                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text });
                        await delay(700);
                    }

                    await socket.sendMessage(sender, {
                        text: `âœ… Bomb sent to ${target} â€” ${count}x`
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
                            text: '*ðŸ“Œ Usage:* .pair +94788770020'
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
                                text: 'âŒ Invalid response from server.'
                            }, { quoted: msg });
                        }

                        if (!result || !result.code) {
                            return await socket.sendMessage(sender, {
                                text: 'âŒ Failed to retrieve pairing code.'
                            }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, {
                            text: `*01 ðŸ“‹ Copy This Code*\n*02 ðŸ”— Go to Link Device*\n*03 âœ‚ï¸ Paste the Code*\n\n> After Your Bot Deploy...  âœ…\n\n*ðŸ”‘ Your pairing code is:* ${result.code}`
                        }, { quoted: msg });

                        await sleep(2000);

                        await socket.sendMessage(sender, {
                            text: `${result.code}`
                        }, { quoted: msg });

                    } catch (err) {
                        console.error("âŒ Pair Command Error:", err);
                        await socket.sendMessage(sender, {
                            text: 'âŒ An error occurred. Please try again later.'
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
                        return await socket.sendMessage(sender, { text: "Hy i am Freedom ai â—" }, { quoted: msg });
                    }

                    const prompt = `à¶”à¶¶ à·ƒà·à¶¶à·‘ à¶œà·à·„à·à¶±à·” à¶½à¶¸à¶ºà·™à¶šà·” à¶¸à·™à¶±à·Š à·„à·à·ƒà·’à¶»à·’à¶º à¶ºà·”à¶­à·”à¶º. à¶‰à¶¸à·à¶¢à·’ à¶´à¶¸à¶±à¶šà·Š à¶­à·’à¶¶à·šà¶±à¶¸à·Š à¶”à¶¶à¶¯ à¶‰à¶¸à·à¶¢à·’ à¶´à¶¸à¶±à¶šà·Š à¶ºà·€à¶±à·Šà¶± à¶œà·à¶½à¶´à·™à¶± à¶½à·™à·ƒ à¶‰à¶¸à·à¶¢à·“ à¶±à·à¶­à·Šà¶­à¶¸à·Š à¶”à¶ºà· à¶‘à¶ºà·à¶§ à¶´à·’à¶½à·’à¶­à·”à¶»à·” à¶¯à·™à¶±à·Šà¶± , à¶¸à·™à¶¸ à¶¯à·šà·€à¶½à·Š à¶šà·’à·ƒà·’à·ƒà·šà¶­à·Šà¶¸ à¶ºà·€à¶±à·Šà¶± à¶‘à¶´à· ( à¶†à¶ºà·”à¶¶à·à·€à¶±à·Š , à¶”à¶¶à¶§ à¶šà·™à·ƒà·šà¶¯ ? , à¶šà¶­à·à¶šà¶»à¶±à·Šà¶± , à¶•à¶±à·š ? , à¶šà·œà·„à·œà¶¸à¶¯ ? , à¶šà·™à·ƒà·šà¶¯ ? , à¶šà·à¶¸à¶­à·’à¶¯ ? ,) à¶¸à·’à¶±à·’à·ƒà·”à¶±à·Šà¶§ à¶‡à¶­à·’ à·„à·à¶Ÿà·“à¶¸à·Š, à¶¯à·à¶±à·“à¶¸à·Š, à·ƒà·„ à·ƒà¶‚à·€à·šà¶¯à·“à¶­à·à·€à¶º à¶…à¶±à·”à·€ à¶´à·’à·…à·’à¶­à·”à¶»à·” à¶½à¶¶à·à¶¯à·’à¶º à¶ºà·”à¶­à·”à¶º. User Message: ${q}`;

                    const payload = {
                        contents: [{ parts: [{ text: prompt }] }]
                    };

                    try {
                        const response = await axios.post(GEMINI_API_URL, payload, {
                            headers: { "Content-Type": "application/json" }
                        });

                        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;

                        if (!aiResponse) {
                            return await socket.sendMessage(sender, { text: "âŒ Error." }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, { text: aiResponse }, { quoted: msg });

                    } catch (err) {
                        console.error("Gemini Error:", err.response?.data || err.message);
                        await socket.sendMessage(sender, { text: "âŒ Error" }, { quoted: msg });
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
                            text: 'âŽ Please provide a WhatsApp Channel link.\n\nðŸ“Œ *Example:* .cid https://whatsapp.com/channel/123456789'
                        }, { quoted: msg });
                    }

                    const match = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/);
                    if (!match) {
                        return await socket.sendMessage(sender, {
                            text: 'âš ï¸ *Invalid channel link format.*'
                        }, { quoted: msg });
                    }

                    const inviteId = match[1];

                    try {
                        await socket.sendMessage(sender, {
                            text: `ðŸ”Ž Fetching channel info for: *${inviteId}*`
                        }, { quoted: msg });

                        const metadata = await socket.newsletterMetadata("invite", inviteId);

                        if (!metadata || !metadata.id) {
                            return await socket.sendMessage(sender, {
                                text: 'âŒ Channel not found or inaccessible.'
                            }, { quoted: msg });
                        }

                        const infoText = `
ðŸ“¡ *WhatsApp Channel Info*

ðŸ†” *ID:* ${metadata.id}
ðŸ“Œ *Name:* ${metadata.name}
ðŸ‘¥ *Followers:* ${metadata.subscribers?.toLocaleString() || 'N/A'}
ðŸ“… *Created on:* ${metadata.creation_time ? new Date(metadata.creation_time * 1000).toLocaleString("id-ID") : 'Unknown'}
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
                            text: 'âš ï¸ An unexpected error occurred while fetching channel info.'
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
                                text: "ðŸ”¥ Please provide a phone number\n\nExample: .getdp 94788770020"
                            });
                        }

                        let targetJid = args[0].replace(/[^0-9]/g, "") + "@s.whatsapp.net";

                        await socket.sendMessage(sender, { text: "ðŸ” Fetching profile picture..." });

                        let ppUrl;
                        try {
                            ppUrl = await socket.profilePictureUrl(targetJid, "image");
                        } catch (e) {
                            return await socket.sendMessage(sender, {
                                text: "ðŸ–¼ï¸ This user has no profile picture or it cannot be accessed!"
                            });
                        }

                        await socket.sendMessage(sender, {
                            image: { url: ppUrl },
                            caption: `ðŸ“Œ Profile picture of +${args[0].replace(/[^0-9]/g, "")}`,
                            contextInfo: {
                                forwardingScore: 999,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363421468247130@newsletter',
                                    newsletterName: '-HASHEN-x-ðŒÉªÉ´Éª-ðá´á´›',
                                    serverMessageId: 143
                                }
                            }
                        });

                    } catch (e) {
                        console.error('Error in getdp case:', e);
                        await socket.sendMessage(sender, {
                            text: "ðŸ›‘ An error occurred while fetching the profile picture!"
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
                                text: "âŒ Invalid channel link format."
                            });
                            break;
                        }

                        const urlParts = linkPart.split("/");
                        const channelIndex = urlParts.findIndex(part => part === 'channel');

                        if (channelIndex === -1 || channelIndex + 2 >= urlParts.length) {
                            await socket.sendMessage(sender, {
                                text: "âŒ Invalid channel link format."
                            });
                            break;
                        }

                        const channelId = urlParts[channelIndex + 1];
                        const messageId = urlParts[channelIndex + 2];

                        if (!channelId || !messageId) {
                            await socket.sendMessage(sender, {
                                text: "âŒ Could not extract channel ID and message ID."
                            });
                            break;
                        }

                        await socket.sendMessage(sender, {
                            text: `ðŸ”„ Processing reaction ${emoji}...`
                        });

                        let res2;
                        try {
                            res2 = await socket.newsletterMetadata("invite", channelId);
                        } catch (metadataError) {
                            await socket.sendMessage(sender, {
                                text: "âŒ Failed to get channel information."
                            });
                            break;
                        }

                        if (!res2 || !res2.id) {
                            await socket.sendMessage(sender, {
                                text: "âŒ Failed to get channel information."
                            });
                            break;
                        }

                        await socket.newsletterReactMessage(res2.id, messageId, emoji);

                        await socket.sendMessage(sender, {
                            text: `âœ… Successfully reacted with ${emoji}!`
                        });

                    } catch (error) {
                        console.error(`Error in 'channelreact' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: `âŒ Error: ${error.message}`
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
                            text: 'ðŸ“Œ *Usage:* .tiktok <link>'
                        }, { quoted: msg });
                    }

                    if (!link.includes('tiktok.com')) {
                        return await socket.sendMessage(sender, {
                            text: 'âŒ *Invalid TikTok link.*'
                        }, { quoted: msg });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: 'â³ Downloading video, please wait...'
                        }, { quoted: msg });

                        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`;
                        const { data } = await axios.get(apiUrl);

                        if (!data?.status || !data?.data) {
                            return await socket.sendMessage(sender, {
                                text: 'âŒ Failed to fetch TikTok video.'
                            }, { quoted: msg });
                        }

                        const { title, like, comment, share, author, meta } = data.data;
                        const video = meta.media.find(v => v.type === "video");

                        if (!video || !video.org) {
                            return await socket.sendMessage(sender, {
                                text: 'âŒ No downloadable video found.'
                            }, { quoted: msg });
                        }

                        const caption = `ðŸŽµ *TIKTOK DOWNLOADR*\n\n` +
                                        `ðŸ‘¤ *User:* ${author.nickname} (@${author.username})\n` +
                                        `ðŸ“– *Title:* ${title}\n` +
                                        `ðŸ‘ *Likes:* ${like}\nðŸ’¬ *Comments:* ${comment}\nðŸ” *Shares:* ${share}`;

                        await socket.sendMessage(sender, {
                            video: { url: video.org },
                            caption: caption,
                            contextInfo: { mentionedJid: [msg.key.participant || sender] }
                        }, { quoted: msg });

                    } catch (err) {
                        console.error("TikTok command error:", err);
                        await socket.sendMessage(sender, {
                            text: `âŒ An error occurred:\n${err.message}`
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
                                text: 'âš ï¸ *Please provide a search query.*\n\n*Example:*\n.google how to code in javascript'
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
                                text: `âš ï¸ *No results found for:* ${query}`
                            });
                            break;
                        }

                        let results = `ðŸ” *Google Search Results for:* "${query}"\n\n`;
                        response.data.items.slice(0, 5).forEach((item, index) => {
                            results += `*${index + 1}. ${item.title}*\n\nðŸ”— ${item.link}\n\nðŸ“ ${item.snippet}\n\n`;
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
                            text: `âš ï¸ *An error occurred while fetching search results.*\n\n${error.message}`
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
                    'âŒ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    `${config.BOT_FOOTER}`
                )
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

// =============================================
// MAIN FIX: EmpirePair function - pairing code
// =============================================
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
            printQRInTerminal: false,
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

        // =============================================
        // FIX: Correct pairing code request logic
        // creds.registered false à¶±à¶¸à·Š à¶´à¶¸à¶«à¶šà·Š pairing code à¶‰à¶½à·Šà¶½à¶±à·€à·
        // connection 'open' à·€à·™à¶±à·Šà¶±à¶­à·Š à¶šà¶½à·’à¶±à·Š 'connecting' stage à¶‘à¶šà¶¯à·“à¶¸
        // requestPairingCode() call à¶šà·’à¶»à·“à¶¸à·™à¶±à·Š WhatsApp app à¶‘à¶šà¶§
        // "Enter code to link new device" notification à¶‘à¶±à·€à·
        // =============================================
        if (!socket.authState.creds.registered) {
            let pairingCodeRequested = false; // duplicate request prevent à¶šà·’à¶»à·“à¶¸à¶§

            socket.ev.on('connection.update', async (update) => {
                const { connection } = update;

                // 'connecting' state à¶½à·à¶¶à·™à¶±à¶šà·œà¶§ pairing code request à¶šà¶»à¶±à·€à·
                if (connection === 'connecting' && !pairingCodeRequested) {
                    pairingCodeRequested = true;
                    try {
                        // WhatsApp server side process à·€à·™à¶±à·Šà¶±à¶§ à¶§à·’à¶šà¶šà·Š wait à¶šà¶»à¶±à·€à·
                        await delay(5000);

                        const code = await socket.requestPairingCode(sanitizedNumber);
                        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                        console.log(`âœ… Pairing code for ${sanitizedNumber}: ${formattedCode}`);

                        if (!res.headersSent) {
                            res.send({ code: formattedCode });
                        }
                    } catch (error) {
                        console.error('âŒ Failed to request pairing code:', error.message);
                        pairingCodeRequested = false; // retry allow à¶šà·’à¶»à·“à¶¸à¶§ reset
                        if (!res.headersSent) {
                            res.status(500).send({ error: 'Failed to generate pairing code. Please try again.' });
                        }
                    }
                }
            });
        } else {
            // Already paired session
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
                        await socket.sendMessage(config.NEWSLETTER_JID, { react: { text: 'â¤ï¸', key: { id: config.NEWSLETTER_MESSAGE_ID } } });
                        console.log('âœ… Auto-followed newsletter & reacted â¤ï¸');
                    } catch (error) {
                        console.error('âŒ Newsletter error:', error.message);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    await socket.sendMessage(userJid, {
                        image: { url: config.IMAGE_PATH },
                        caption: formatMessage(
                            '*á´„á´É´É´á´‡á´„á´›á´‡á´… á´êœ±É¢*',
                            `âœ… Successfully connected!\n\nðŸ”¢ Number: ${sanitizedNumber}\n\nðŸ“‹ Available Commands:\nðŸ“Œ${config.PREFIX}alive\nðŸ“Œ${config.PREFIX}menu\nðŸ“Œ${config.PREFIX}song\nðŸ“Œ${config.PREFIX}pair`,
                            'â•¾â•¾â•¾'
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
