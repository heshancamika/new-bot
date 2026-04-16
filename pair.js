

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const axios = require('axios');
const yts = require('yt-search');
const os = require('os');
const { initUserEnvIfMissing } = require('./settingsdb');
const { initEnvsettings, getSetting } = require('./settings');

// ==================== CONFIGURATION ====================
const config = {
    BOT_NAME: 'SHADOW-X-MINI',
    OWNER_NUMBER: '94729101856',
    BOT_FOOTER: '> © SHADOW x ᴍɪɴɪ ʙᴏᴛ',
    PREFIX: '.',
    MAX_RETRIES: 3,
    ADMIN_LIST_PATH: './admin.json',
    IMAGE_PATH: 'https://files.catbox.moe/riqrud.jpg',
    MENU_IMAGE: 'https://files.catbox.moe/riqrud.jpg',
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/Cp3Gab6TUCLA9SMpY48chd',
    NEWSLETTER_JID: '120363424090172812@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_LIKE_EMOJI: ['🧩', '🍉', '💜', '🌸', '🪴', '💊', '💫', '🍂', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🤖', '🚩', '🥰', '🗿', '💜', '💙', '🌝', '🖤', '💚']
};

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');

// ==================== MONGODB SETUP ====================
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

const mongoUri = 'mongodb+srv://theekshanarathnaweera7_db_user:xmoXPcCYrgZdRpqH@adhinew.ss1amdm.mongodb.net/adhinew';
const client = new MongoClient(mongoUri);
let db;

async function initMongo() {
    if (!db) {
        await client.connect();
        db = client.db('data1');
        await db.collection('sessions').createIndex({ number: 1 });
        console.log('✅ MongoDB connected');
    }
    return db;
}

// ==================== SESSION STORAGE ====================
const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

async function saveSessionToMongo(number, credsData) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const collection = db.collection('sessions');
        await collection.updateOne(
            { number: sanitizedNumber },
            {
                $set: {
                    number: sanitizedNumber,
                    creds: credsData,
                    active: true,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );
        console.log(`✅ Session saved for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to save session:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        const collection = db.collection('sessions');
        const doc = await collection.findOne({ number: sanitizedNumber, active: true });
        if (doc && doc.creds) {
            return JSON.parse(doc.creds);
        }
        return null;
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function deleteSessionFromMongo(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const db = await initMongo();
        await db.collection('sessions').deleteOne({ number: sanitizedNumber });
        console.log(`🗑️ Session deleted for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to delete session:', error);
    }
}

// ==================== UTILITY FUNCTIONS ====================
function formatMessage(title, content, footer) {
    return `${title}\n\n${content}\n\n${footer}`;
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        return [];
    }
}

function runtime(seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d ? d + 'd ' : ''}${h ? h + 'h ' : ''}${m ? m + 'm ' : ''}${s}s`;
}

// ==================== HANDLERS ====================
async function setupStatusHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast') return;

        try {
            if (config.AUTO_VIEW_STATUS === 'true') {
                await socket.readMessages([message.key]);
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                await socket.sendMessage(
                    message.key.remoteJid,
                    { react: { text: randomEmoji, key: message.key } },
                    { statusJidList: [message.key.participant] }
                );
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function setupMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const deletionTime = getSriLankaTimestamp();

        const adminMsg = formatMessage(
            '╭──◯',
            `│ \`D E L E T E\`\n│ *⦁ From :* ${messageKey.remoteJid}\n│ *⦁ Time:* ${deletionTime}\n╰──◯`,
            config.BOT_FOOTER
        );

        try {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.IMAGE_PATH },
                caption: adminMsg
            });
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) return { status: 'failed', error: 'Invalid invite link' };

    const inviteCode = inviteCodeMatch[1];
    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) return { status: 'success', gid: response.gid };
            throw new Error('No group ID');
        } catch (error) {
            retries--;
            if (retries === 0) return { status: 'failed', error: error.message };
            await delay(2000);
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const caption = formatMessage(
        '*Connected Successful ✅*',
        `❗Number: ${number}\n🧚‍♂️ Status: Online\n${groupResult.status === 'success' ? '✓ Group joined' : '✗ Group join failed'}`,
        config.BOT_FOOTER
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(`${admin}@s.whatsapp.net`, {
                image: { url: config.IMAGE_PATH },
                caption
            });
        } catch (error) {
            console.error(`Failed to send to admin ${admin}:`, error);
        }
    }
}

// ==================== COMMAND HANDLERS ====================
async function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        let command = null;
        let args = [];
        let sender = msg.key.remoteJid;

        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (messageText.startsWith(config.PREFIX)) {
            const parts = messageText.slice(config.PREFIX.length).trim().split(/\s+/);
            command = parts[0].toLowerCase();
            args = parts.slice(1);
        }

        if (!command) return;

        const reply = async (text) => {
            await socket.sendMessage(sender, { text }, { quoted: msg });
        };

        try {
            switch (command) {
                case 'alive':
                    await socket.sendMessage(sender, {
                        image: { url: config.MENU_IMAGE },
                        caption: formatMessage(
                            '*❛SHADOW X MINI 🧚‍♂️❛*',
                            `*© ᴘᴏᴡᴇʀᴇᴅ ʙʏ shadow*\n*👑 Owner:* +94729101856\n*⚙️ Status:* Online\n*📟 Prefix:* ${config.PREFIX}`,
                            config.BOT_FOOTER
                        )
                    });
                    break;

                case 'menu':
                    await socket.sendMessage(sender, { react: { text: "😻", key: msg.key } });
                    const menuText = `┏━❐  \`ᴀʟʟ ᴍᴇɴᴜ\`
┃ *⭔ ʙᴏᴛ ɴᴀᴍᴇ - SHADOW-x-ᴍɪɴɪ*
┃ *⭔ ᴏᴡɴᴇʀ - +94729101856*
┗━❐

╭─═❮ ⚡ ʙᴏᴛ ᴍᴇɴᴜ ⚡ ❯═━───❖
┣📌 𝑺ʏꜱᴛᴇᴍ
│ 🟢 .ᴀʟɪᴠᴇ → ʙᴏᴛ ᴏɴʟɪɴᴇ ᴄʜᴇᴄᴋ
│ 📶 .ᴘɪɴɢ → ꜱᴘᴇᴇᴅ ᴛᴇꜱᴛ
│ ⚙️ .ꜱʏꜱᴛᴇᴍ → ʙᴏᴛ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ
│ 👑 .ᴏᴡɴᴇʀ → ꜱʜᴏᴡ ʙᴏᴛ ᴏᴡɴᴇʀꜱ
┢━━━━━━━━━━━━━━━━━━━━➢
┡🎵 𝑴ᴇᴅɪᴀ
│ 🎼 .ꜱᴏɴɢ <ɴᴀᴍᴇ> → ᴅᴏᴡɴʟᴏᴀᴅ ꜱᴏɴɢ
│ 📘 .ꜰʙ <ᴜʀʟ> → ꜰᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏ ᴅʟ
│ 🎶 .ᴛɪᴋᴛᴏᴋꜱᴇᴀʀᴄʜ <ɴᴀᴍᴇ> → ꜱᴇᴀʀᴄʜ ᴛɪᴋᴛᴏᴋ
│ 🎵 .ᴛɪᴋᴛᴏᴋ <ᴜʀʟ> → ᴛɪᴋᴛᴏᴋ ᴅʟ
│ 📲 .ᴀᴘᴋ <ɴᴀᴍᴇ> → ᴀᴘᴋ ᴅᴏᴡɴʟᴏᴀᴅ
┢━━━━━━━━━━━━━━━━━━━━➢
┡🛠 𝑻ᴏᴏʟꜱ
│ 📦 .ɴᴘᴍ <ᴘᴀᴄᴋᴀɢᴇ> → ɴᴘᴍ ɪɴꜰᴏ
│ 🔍 .ɢᴏᴏɢʟᴇ <ǫᴜᴇʀʏ> → ɢᴏᴏɢʟᴇ ꜱᴇᴀʀᴄʜ
│ 🤖 .ᴀɪ <ᴘʀᴏᴍᴘᴛ> → ᴄʜᴀᴛ ᴡɪᴛʜ ᴀɪ
│ 🖼️ .ɢᴇᴛᴅᴘ <ɴᴜᴍʙᴇʀ> → ɢᴇᴛ ᴘʀᴏꜰɪʟᴇ ᴘɪᴄ
│ 💥 .ʙᴏᴏᴍ <ɴᴜᴍ|ᴄᴏᴜɴᴛ> → ʙᴏᴏᴍ ɴᴜᴍʙᴇʀ
┢━━━━━━━━━━━━━━━━━━━━➢
┡🔗 𝑾ʜᴀᴛꜱᴀᴘᴘ
│ 🔗 .ᴘᴀɪʀ <ᴄᴏᴅᴇ> → ᴘᴀɪʀ ꜱᴇꜱꜱɪᴏɴ
│ 🆔 .ᴊɪᴅ → ɢᴇᴛ ᴄʜᴀᴛ ᴊɪᴅ
│ 📡 .ᴄɪᴅ <ʟɪɴᴋ> → ɢᴇᴛ ᴄʜᴀɴɴᴇʟ ɪɴꜰᴏ
╰━━━━━━━━━━━━━━━━━━━┈⊷`;

                    await socket.sendMessage(sender, {
                        image: { url: config.MENU_IMAGE },
                        caption: menuText,
                        contextInfo: {
                            externalAdReply: {
                                title: 'ᴍᴜʟᴛɪ ᴅᴇᴠɪᴄᴇ ᴍɪɴɪ ᴡʜᴀᴛꜱᴀᴘᴘ ʙᴏᴛ',
                                body: 'SHADOW-x-ᴍɪɴɪ-ᴠ1',
                                mediaType: 1,
                                thumbnailUrl: config.MENU_IMAGE,
                                sourceUrl: "https://shadow-mini-bot.onrender.com/"
                            }
                        }
                    });
                    break;

                case 'ping':
                    const start = Date.now();
                    await reply('*_Pinging..._* ❗');
                    const end = Date.now();
                    await reply(`❗ *Pong ${end - start} Ms*`);
                    break;

                case 'owner':
                    await socket.sendMessage(sender, { react: { text: "👤", key: msg.key } });
                    await socket.sendMessage(sender, {
                        contacts: {
                            displayName: 'Owner Contact',
                            contacts: [{
                                vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:SHADOW OWNER\nTEL:+94729101856\nEND:VCARD'
                            }]
                        }
                    });
                    break;

                case 'system':
                    const totalMem = Math.floor(os.totalmem() / 1024 / 1024) + 'MB';
                    const freeMem = Math.floor(os.freemem() / 1024 / 1024) + 'MB';
                    const cpuModel = os.cpus()[0].model;
                    await socket.sendMessage(sender, {
                        image: { url: config.MENU_IMAGE },
                        caption: formatMessage(
                            '*❗ ꜱʏꜱᴛᴇᴍ ɪɴꜰᴏ ❗*',
                            `◦ *Runtime*: ${runtime(process.uptime())}\n◦ *Total Ram*: ${totalMem}\n◦ *Free Ram*: ${freeMem}\n◦ *CPU*: ${cpuModel}`,
                            config.BOT_FOOTER
                        )
                    });
                    break;

                case 'song':
                    const query = args.join(" ");
                    if (!query) return reply("*🎶 කරුණාකර ගීතයේ නමක් දෙන්න!*\n\n`.song shape of you`");

                    const search = await yts(query);
                    if (!search.videos || !search.videos.length) return reply("*❌ ගීතය හමුනොවුණා.*");

                    const songData = search.videos[0];
                    const apiUrl = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${songData.url}&format=mp3&apikey=sadiya`;
                    const { data } = await axios.get(apiUrl);

                    if (!data?.status || !data.result?.download) return reply("❌ ගීතය බාගත කළ නොහැක.");

                    await socket.sendMessage(sender, {
                        image: { url: data.result.thumbnail },
                        caption: `🎶 *Title:* ${songData.title}\n⏱️ *Duration:* ${songData.timestamp}`
                    });
                    await socket.sendMessage(sender, {
                        audio: { url: data.result.download },
                        mimetype: "audio/mpeg",
                        fileName: `${songData.title}.mp3`
                    });
                    break;

                case 'fb':
                case 'fbdl':
                case 'facebook':
                    const fbUrl = args.join(" ");
                    if (!fbUrl) return reply('*Please provide a Facebook video URL.*');

                    const fbApi = `https://api.nexoracle.com/downloader/facebook?apikey=e276311658d835109c&url=${encodeURIComponent(fbUrl)}`;
                    const fbRes = await axios.get(fbApi);
                    if (!fbRes.data?.result?.sd) return reply('*❌ Invalid Facebook URL.*');

                    await socket.sendMessage(sender, {
                        video: { url: fbRes.data.result.sd },
                        caption: `*❒🚀 SHADOW X FB VIDEO DL 🚀❒*`
                    });
                    break;

                case 'google':
                case 'gsearch':
                    if (!args.length) return reply('⚠️ *Please provide a search query.*\n\n*.google how to code*');

                    const googleQuery = args.join(" ");
                    const googleApi = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(googleQuery)}&key=AIzaSyDMbI3nvmQUrfjoCJYLS69Lej1hSXQjnWI&cx=baf9bdb0c631236e5`;
                    const googleRes = await axios.get(googleApi);

                    if (!googleRes.data.items || !googleRes.data.items.length) return reply(`⚠️ *No results for:* ${googleQuery}`);

                    let results = `🔍 *Google Search Results for:* "${googleQuery}"\n\n`;
                    googleRes.data.items.slice(0, 5).forEach((item, idx) => {
                        results += `*${idx + 1}. ${item.title}*\n🔗 ${item.link}\n📝 ${item.snippet}\n\n`;
                    });
                    await socket.sendMessage(sender, { text: results });
                    break;

                case 'ai':
                    const prompt = args.join(" ");
                    if (!prompt) return reply("Hy i am Shadow AI ❗");

                    const geminiApi = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyBdBivCo6jWSchTb8meP7VyxbHpoNY_qfQ`;
                    const geminiRes = await axios.post(geminiApi, {
                        contents: [{ parts: [{ text: `You are SHADOW AI, reply in Sinhala/English: ${prompt}` }] }]
                    }, { headers: { "Content-Type": "application/json" } });

                    const aiResponse = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    await reply(aiResponse || "❌ Error.");
                    break;

                case 'tiktok':
                case 'tt':
                    const tiktokUrl = args.join(" ");
                    if (!tiktokUrl || !tiktokUrl.includes('tiktok.com')) return reply("❌ Please provide a valid TikTok link.");

                    const ttApi = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(tiktokUrl)}`;
                    const ttRes = await axios.get(ttApi);

                    if (!ttRes.data?.status || !ttRes.data?.data) return reply("❌ Failed to fetch TikTok video.");

                    const videoData = ttRes.data.data;
                    const videoUrl = videoData.meta.media.find(v => v.type === "video")?.org;
                    if (!videoUrl) return reply("❌ No video found.");

                    await socket.sendMessage(sender, {
                        video: { url: videoUrl },
                        caption: `🎵 *TikTok Video*\n👤 *User:* ${videoData.author.nickname}\n👍 *Likes:* ${videoData.like}`
                    });
                    break;

                case 'apk':
                    const appName = args.join(" ");
                    if (!appName) return reply("*🔍 Please provide an app name.*\n\n.apk Instagram");

                    const apkApi = `http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(appName)}/limit=1`;
                    const apkRes = await axios.get(apkApi);

                    if (!apkRes.data.datalist?.list?.length) return reply("❌ *No APK found.*");

                    const apkApp = apkRes.data.datalist.list[0];
                    await socket.sendMessage(sender, {
                        document: { url: apkApp.file.path_alt },
                        fileName: `${apkApp.name}.apk`,
                        mimetype: 'application/vnd.android.package-archive',
                        caption: `🎮 *App Name:* ${apkApp.name}\n📦 *Package:* ${apkApp.package}\n📁 *Size:* ${(apkApp.size / (1024 * 1024)).toFixed(2)} MB`
                    });
                    break;

                case 'npm':
                    const pkgName = args.join(" ");
                    if (!pkgName) return reply('📦 *Usage:* .npm <package-name>\n\nExample: .npm express');

                    const npmApi = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}`;
                    const npmRes = await axios.get(npmApi);
                    if (!npmRes.data) return reply('🚫 Package not found.');

                    await reply(`📦 *NPM Package:* ${pkgName}\n📄 *Description:* ${npmRes.data.description || 'N/A'}\n⏸️ *Latest:* ${npmRes.data["dist-tags"]?.latest || 'N/A'}\n🔗 *URL:* https://www.npmjs.com/package/${pkgName}`);
                    break;

                case 'tiktoksearch':
                    const searchTerm = args.join(" ");
                    if (!searchTerm) return reply('🌸 *Usage:* .tiktoksearch <query>');

                    const ttSearchApi = `https://apis-starlights-team.koyeb.app/starlight/tiktoksearch?text=${encodeURIComponent(searchTerm)}`;
                    const ttSearchRes = await axios.get(ttSearchApi);

                    if (!ttSearchRes.data?.status || !ttSearchRes.data.data?.length) return reply('❌ No results found.');

                    for (const video of ttSearchRes.data.data.slice(0, 3)) {
                        if (video.nowm) {
                            await socket.sendMessage(sender, {
                                video: { url: video.nowm },
                                caption: `🌸 *Title:* ${video.title}\n👤 *Author:* ${video.author?.nickname || 'Unknown'}`
                            });
                        }
                    }
                    break;

                case 'pair':
                    const pairNumber = args[0];
                    if (!pairNumber) return reply('*📌 Usage:* .pair +94788770020');

                    const pairApi = `https://dinu-3ab31409578e.herokuapp.com/code?number=${encodeURIComponent(pairNumber)}`;
                    const pairRes = await axios.get(pairApi);

                    if (!pairRes.data?.code) return reply('❌ Failed to retrieve pairing code.');

                    await reply(`*🔑 Your pairing code is:* ${pairRes.data.code}\n\n1. Copy this code\n2. Go to Linked Devices\n3. Paste the code`);
                    break;

                case 'jid':
                    await reply(sender);
                    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    break;

                case 'cid':
                    const channelLink = args[0];
                    if (!channelLink || !channelLink.includes('whatsapp.com/channel/')) return reply('❎ *Usage:* .cid https://whatsapp.com/channel/xxxxx');

                    const inviteId = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/)[1];
                    const metadata = await socket.newsletterMetadata("invite", inviteId);

                    await reply(`📡 *Channel Info*\n🆔 *ID:* ${metadata.id}\n📌 *Name:* ${metadata.name}\n👥 *Followers:* ${metadata.subscribers?.toLocaleString() || 'N/A'}`);
                    break;

                case 'getdp':
                case 'getpp':
                    const targetNumber = args[0]?.replace(/[^0-9]/g, "");
                    if (!targetNumber) return reply("🔥 *Usage:* .getdp 94788770020");

                    const targetJid = targetNumber + "@s.whatsapp.net";
                    let ppUrl;
                    try {
                        ppUrl = await socket.profilePictureUrl(targetJid, "image");
                    } catch (e) {
                        return reply("🖼️ No profile picture found.");
                    }

                    await socket.sendMessage(sender, {
                        image: { url: ppUrl },
                        caption: `📌 Profile picture of +${targetNumber}`
                    });
                    break;

                case 'boom':
                case 'bomb':
                    const bombArgs = args.join(" ").split(',');
                    if (bombArgs.length < 3) return reply('📌 *Usage:* .boom number,message,count\n\nExample: .boom 94788770020,Hello,5');

                    const bombNumber = bombArgs[0].replace(/[^0-9]/g, "");
                    const bombMsg = bombArgs[1];
                    const bombCount = Math.min(parseInt(bombArgs[2]) || 5, 20);
                    const bombJid = bombNumber + "@s.whatsapp.net";

                    for (let i = 0; i < bombCount; i++) {
                        await socket.sendMessage(bombJid, { text: bombMsg });
                        await delay(700);
                    }
                    await reply(`✅ Bomb sent to ${bombNumber} — ${bombCount}x`);
                    break;

                default:
                    break;
            }
        } catch (error) {
            console.error('Command error:', error);
            await reply('❌ An error occurred. Please try again.');
        }
    });
}

// ==================== PAIRING FUNCTION ====================
async function shadowPair(number, res, type = 'code') {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    try {
        await initUserEnvIfMissing(sanitizedNumber);
        await initEnvsettings(sanitizedNumber);

        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

        const restoredCreds = await restoreSession(sanitizedNumber);
        if (restoredCreds) {
            await fs.ensureDir(sessionPath);
            await fs.writeFile(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const logger = pino({ level: 'fatal' });

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

        setupStatusHandlers(socket, sanitizedNumber);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageRevocation(socket, sanitizedNumber);

        // ==================== PAIRING CODE ====================
        let pairingCode = null;

        if (type === 'code') {
            if (!socket.authState.creds.registered) {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await delay(1500);
                        pairingCode = await socket.requestPairingCode(sanitizedNumber);
                        console.log(`✅ Pairing code generated for ${sanitizedNumber}: ${pairingCode}`);
                        break;
                    } catch (err) {
                        console.error(`❌ Pairing code attempt failed (${retries} retries left):`, err.message);
                        retries--;
                        await delay(2000);
                    }
                }
            } else {
                console.log(`⚠️ Number ${sanitizedNumber} is already registered`);
            }

            if (!res.headersSent) {
                if (pairingCode) {
                    res.send({ code: pairingCode });
                } else {
                    res.status(500).send({ error: 'Failed to generate pairing code. Please try again.' });
                }
            }
        }

        // ==================== CREDS UPDATE ====================
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            try {
                const credsFile = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
                await saveSessionToMongo(sanitizedNumber, credsFile);
            } catch (e) {
                console.error('Creds save error:', e);
            }
        });

        // ==================== CONNECTION OPEN ====================
        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);
                    const groupResult = await joinGroup(socket);

                    try {
                        await socket.newsletterFollow(config.NEWSLETTER_JID);
                    } catch (e) {}

                    activeSockets.set(sanitizedNumber, socket);

                    await socket.sendMessage(userJid, {
                        image: { url: config.MENU_IMAGE },
                        caption: formatMessage(
                            '*ᴄᴏɴɴᴇᴄᴛᴇᴅ ᴍꜱɢ*',
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n🍁 Bot: ${config.BOT_NAME}`,
                            config.BOT_FOOTER
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

        // ==================== CONNECTION CLOSE ====================
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === 401) {
                    await deleteSessionFromMongo(sanitizedNumber);
                    activeSockets.delete(sanitizedNumber);
                } else {
                    activeSockets.delete(sanitizedNumber);
                    const mockRes = { headersSent: true, send: () => {}, status: () => ({ send: () => {} }) };
                    setTimeout(() => shadowPair(number, mockRes, 'code'), 5000);
                }
            }
        });

    } catch (err) {
        console.error(`shadowPair error for ${sanitizedNumber}:`, err);
        if (!res.headersSent) {
            res.status(500).send({ error: 'Internal server error' });
        }
    }
}

// ==================== ROUTES ====================
router.get('/', async (req, res) => {
    const { number, type } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const pairType = type === 'qr' ? 'qr' : 'code';

    if (activeSockets.has(sanitizedNumber)) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await shadowPair(number, res, pairType);
});

router.get('/active', (req, res) => {
    res.send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.send({
        status: 'active',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
        const results = [];

        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }
            const mockRes = { headersSent: true, send: () => {}, status: () => ({ send: () => {} }) };
            shadowPair(number, mockRes, 'code');
            results.push({ number, status: 'connection_initiated' });
        }

        res.send({ status: 'success', connections: results });
    } catch (error) {
        res.status(500).send({ error: 'Failed to connect bots' });
    }
});

// ==================== CLEANUP ====================
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws?.close();
        activeSockets.delete(number);
    });
    client.close();
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

// ==================== AUTO-RECONNECT ====================
(async () => {
    try {
        await initMongo();
        const collection = db.collection('sessions');
        const docs = await collection.find({ active: true }).toArray();
        for (const doc of docs) {
            if (!activeSockets.has(doc.number)) {
                const mockRes = { headersSent: true, send: () => {}, status: () => ({ send: () => {} }) };
                await shadowPair(doc.number, mockRes, 'code');
            }
        }
        console.log('✅ Auto-reconnect completed');
    } catch (error) {
        console.error('Auto-reconnect failed:', error);
    }
})();

module.exports = router;




