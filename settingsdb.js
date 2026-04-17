const axios = require('axios');
const mongoose = require('mongoose');

const BASE_URL = 'https://shriiy-default-rtdb.asia-southeast1.firebasedatabase.app';
const MONGO_URI = process.env.MONGODB_URI;

// ── MongoDB connection ──────────────────────────────────────────────────────
let isConnected = false;

async function connectToDatabase() {
    if (isConnected) return;
    try {
        await mongoose.connect(MONGO_URI);
        isConnected = true;
        console.log('✅ MongoDB connected.');
    } catch (err) {
        console.error('❌ MongoDB connection failed:', err.message);
        throw err;
    }
}

// ── MongoDB auth state for Baileys ─────────────────────────────────────────
const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');

async function useMongoDBAuthState(number) {
    await connectToDatabase();
    const db = mongoose.connection.db;
    const collName = `session-${number}`;
    const collection = db.collection(collName);

    async function readData(id) {
        try {
            const doc = await collection.findOne({ _id: id });
            if (!doc || !doc.value) return null;
            return JSON.parse(doc.value, BufferJSON.reviver);
        } catch {
            return null;
        }
    }

    async function writeData(id, value) {
        try {
            await collection.updateOne(
                { _id: id },
                { $set: { value: JSON.stringify(value, BufferJSON.replacer) } },
                { upsert: true }
            );
        } catch (err) {
            console.error(`❌ writeData failed [${id}]:`, err.message);
        }
    }

    async function removeData(id) {
        try {
            await collection.deleteOne({ _id: id });
        } catch (err) {
            console.error(`❌ removeData failed [${id}]:`, err.message);
        }
    }

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                const { proto } = require('@whiskeysockets/baileys');
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            tasks.push(
                                value
                                    ? writeData(`${category}-${id}`, value)
                                    : removeData(`${category}-${id}`)
                            );
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: () => writeData('creds', creds),
    };
}

// ── delete one session ──────────────────────────────────────────────────────
async function deleteSession(number) {
    try {
        await connectToDatabase();
        const db = mongoose.connection.db;
        const collName = `session-${number}`;
        const exists = await db.listCollections({ name: collName }).hasNext();
        if (exists) {
            await db.collection(collName).deleteMany({});
            console.log(`🗑️ Session deleted for ${number}`);
        }
    } catch (err) {
        console.error(`⚠️ deleteSession failed [${number}]:`, err.message);
    }
}

// ── clear ALL sessions on startup ───────────────────────────────────────────
async function clearAllSessionsOnStartup() {
    try {
        await connectToDatabase();
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        for (const col of collections) {
            if (col.name.startsWith('session-')) {
                await db.collection(col.name).deleteMany({});
                console.log(`🗑️ Cleared: ${col.name}`);
            }
        }
        console.log('✅ All sessions cleared on startup.');
    } catch (err) {
        console.error('⚠️ clearAllSessionsOnStartup failed:', err.message);
    }
}

// ── Firebase helpers ────────────────────────────────────────────────────────
async function updateUserEnv(key, value, userId) {
    if (!userId) throw new Error("User ID missing");
    try {
        const res = await axios.put(`${BASE_URL}/${userId}/${key}.json`, JSON.stringify(value));
        return res.data;
    } catch (err) {
        console.error(`❌ Firebase updateUserEnv failed [${userId}/${key}]:`, err.message);
        return null;
    }
}

async function getUserEnv(key, userId) {
    if (!userId) throw new Error("User ID missing");
    try {
        const res = await axios.get(`${BASE_URL}/${userId}/${key}.json`);
        return res.data;
    } catch (err) {
        console.error(`❌ Firebase getUserEnv failed [${userId}/${key}]:`, err.message);
        return null;
    }
}

async function getAllUserEnv(userId) {
    if (!userId) throw new Error("User ID missing");
    try {
        const res = await axios.get(`${BASE_URL}/${userId}.json`);
        return res.data || {};
    } catch (err) {
        console.error(`❌ Firebase getAllUserEnv failed [${userId}]:`, err.message);
        return {};
    }
}

async function initUserEnvIfMissing(userId) {
    if (!userId) { console.error("❌ User ID is missing"); return; }
    const defaults = {
        AUTO_REACT: "on",
        PRESENCE_TYPE: "on",
        PRESENCE_FAKE: "both",
        ANTI_CALL: "on",
        ANTI_DELETE: "on",
        CREATE_NB: userId
    };
    try {
        for (const key in defaults) {
            const current = await getUserEnv(key, userId);
            if (current === null || current === undefined) {
                await updateUserEnv(key, defaults[key], userId);
                console.log(`✅ Initialized [${userId}] ${key} = ${defaults[key]}`);
            }
        }
    } catch (err) {
        console.error(`❌ initUserEnvIfMissing failed [${userId}]:`, err.message);
    }
}

// ── exports ─────────────────────────────────────────────────────────────────
module.exports = {
    // Firebase
    updateUserEnv,
    getUserEnv,
    getAllUserEnv,
    initUserEnvIfMissing,
    // MongoDB
    connectToDatabase,
    mongoose,
    useMongoDBAuthState,
    deleteSession,
    clearAllSessionsOnStartup
};
