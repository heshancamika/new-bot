const axios = require('axios');

const BASE_URL = 'https://shriiy-default-rtdb.asia-southeast1.firebasedatabase.app';

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
    if (!userId) {
        console.error("❌ User ID is missing");
        return;
    }

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

module.exports = {
    updateUserEnv,
    getUserEnv,
    getAllUserEnv,
    initUserEnvIfMissing
};
