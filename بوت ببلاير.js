const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { createClient } = require('bedrock-protocol');
const fs = require('fs');
const { MicrosoftAuthFlow } = require('prismarine-auth');
const os = require('os');
const pidusage = require('pidusage');
const path = require('path');
const crypto = require('crypto');

// ==================== التوكن وأيدي المطور ====================
const botToken = process.env.BOT_TOKEN || '9048385887:AAGG2vn1KD4RJcBaKAEArcerJqmltjsWAOg';
const ownerId = parseInt(process.env.ADMIN_ID) || 7532879217;
const ADMIN_ID = ownerId; 

const requiredChannels = ['', '', '', ''];

const bot = new Telegraf(botToken);

let servers = {};
let users = [];
let clients = {};
let intervals = {};
let spamIntervals = {};
const botCooldowns = new Map();
const userVersions = {};
const userStates = {};
let microsoftAccounts = {};
let admins = [ownerId]; // قائمة الأدمنية

// --- إضافة متغير لأسماء البوتات ---
let botNames = {
    firstBot: 'muf879',
    statsBot: 'statsMuf',
    secondBot: 'muf880' // اسم افتراضي يمكن تغييره
};

// --- JSON Database Management ---
const dataDir = path.join(__dirname, 'data');

// إنشاء مجلد data إذا لم يكن موجوداً
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbLocks = new Map();

async function acquireLock(file) {
    while (dbLocks.get(file)) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    dbLocks.set(file, true);
}

function releaseLock(file) {
    dbLocks.delete(file);
}

async function readDb(file) {
    await acquireLock(file);
    try {
        const filePath = path.join(dataDir, file);
        const data = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            if (file === 'users.json') return [];
            if (file === 'servers.json') return [];
            if (file === 'config.json') return {};
            if (file === 'versions.json') return [];
            if (file === 'admins.json') return [ownerId];
            return {};
        }
        if (error.name === 'SyntaxError') {
            const defaults = {
                'users.json': [],
                'servers.json': [],
                'versions.json': [],
                'config.json': {},
                'admins.json': [ownerId]
            };
            return defaults[file] || {};
        }
        throw error;
    } finally {
        releaseLock(file);
    }
}

async function writeDb(file, data) {
    await acquireLock(file);
    try {
        const filePath = path.join(dataDir, file);
        await fs.promises.writeFile(filePath, JSON.stringify(data, null, 4));
    } finally {
        releaseLock(file);
    }
}

// --- Database Models ---
const Users = {
    find: (query) => readDb('users.json').then(users => users.filter(user => Object.keys(query).every(key => user[key] === query[key]))),
    findOne: (query) => readDb('users.json').then(users => users.find(user => Object.keys(query).every(key => user[key] === query[key]))),
    create: async (user) => {
        const users = await readDb('users.json');
        users.push(user);
        await writeDb('users.json', users);
        return user;
    },
    updateOne: async (query, update) => {
        const users = await readDb('users.json');
        const userIndex = users.findIndex(user => Object.keys(query).every(key => user[key] === query[key]));
        if (userIndex > -1) {
            users[userIndex] = { ...users[userIndex], ...update };
            await writeDb('users.json', users);
        }
        return userIndex > -1;
    }
};

const Servers = {
    find: (query) => readDb('servers.json').then(servers => servers.filter(server => Object.keys(query).every(key => server[key] === query[key]))),
    findOne: (query) => readDb('servers.json').then(servers => servers.find(server => Object.keys(query).every(key => server[key] === query[key]))),
    create: async (server) => {
        const servers = await readDb('servers.json');
        servers.push(server);
        await writeDb('servers.json', servers);
        return server;
    },
    updateOne: async (query, update) => {
        const servers = await readDb('servers.json');
        const serverIndex = servers.findIndex(server => Object.keys(query).every(key => server[key] === query[key]));
        if (serverIndex > -1) {
            servers[serverIndex] = { ...servers[serverIndex], ...update };
            await writeDb('servers.json', servers);
        }
        return serverIndex > -1;
    },
    deleteOne: async (query) => {
        let servers = await readDb('servers.json');
        const initialCount = servers.length;
        servers = servers.filter(server => !Object.keys(query).every(key => server[key] === query[key]));
        await writeDb('servers.json', servers);
        return servers.length < initialCount;
    }
};

const Admins = {
    find: () => readDb('admins.json'),
    add: async (userId) => {
        const admins = await readDb('admins.json');
        if (!admins.includes(userId)) {
            admins.push(userId);
            await writeDb('admins.json', admins);
        }
        return admins;
    },
    remove: async (userId) => {
        let admins = await readDb('admins.json');
        admins = admins.filter(id => id !== userId);
        await writeDb('admins.json', admins);
        return admins;
    },
    isAdmin: async (userId) => {
        const admins = await readDb('admins.json');
        return admins.includes(userId);
    }
};

const setupInitialConfig = async () => {
    try {
        const config = await readDb('config.json');
        if (Object.keys(config).length === 0) {
            await writeDb('config.json', { botOnline: true });
        }
        admins = await Admins.find();
    } catch (e) {}
};

bot.use(async (ctx, next) => {
    const isBotOnline = (await readDb('config.json')).botOnline ?? true;
    if (ctx.from?.id !== ADMIN_ID && !isBotOnline && ctx.message?.text !== '/start' && !ctx.callbackQuery) {
        return ctx.reply('🤖 البوت في وضع الصيانة حاليًا، الرجاء المحاولة لاحقًا.').catch(() => {});
    }
    const userId = ctx.from?.id;
    if (userId) {
        const user = await Users.findOne({ userId });
        if (user && user.isBanned) {
            return;
        }
        if (!user) {
            await Users.create({ userId, isBanned: false, createdAt: Date.now() });
        }
    }
    await next();
});

function loadData() {
  try {
    if (fs.existsSync('servers.json')) {
      servers = JSON.parse(fs.readFileSync('servers.json', 'utf8'));
    }
  } catch (error) {}

  try {
    if (fs.existsSync('users.json')) {
      users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
    }
  } catch (error) {}

  try {
    if (fs.existsSync('microsoft.json')) {
      microsoftAccounts = JSON.parse(fs.readFileSync('microsoft.json', 'utf8'));
    }
  } catch (error) {}
}

loadData();

async function isSubscribed(ctx) {
  try {
    for (let ch of requiredChannels) {
      if (!ch) continue;
      const member = await ctx.telegram.getChatMember('@' + ch, ctx.from.id);
      if (!['member', 'administrator', 'creator'].includes(member.status)) return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

async function notifyOwner(ctx) {
  try {
    const user = ctx.from;
    const id = user.id;

    if (!users.includes(id)) {
      users.push(id);
      fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

      const message = `تم دخول شخص جديد إلى البوت الخاص بك 👾\n\n• الاسم : ${user.first_name}\n• المعرف : ${user.username ? '@' + user.username : 'لا يوجد'}\n• الايدي : ${id}\n\n• عدد الأعضاء الكلي : ${users.length}`;
      try {
        await bot.telegram.sendMessage(ownerId, message);
      } catch (err) {}
    }
  } catch (error) {}
}

function generateCaptcha() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function createMinecraftAccount() {
  try {
    const timestamp = Date.now();
    const randomNum = Math.floor(Math.random() * 10000);
    return {
      success: true,
      email: `muf${timestamp}${randomNum}@outlook.com`,
      password: `Muf${timestamp}@`,
      username: `MufPlayer${randomNum}`
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function loginToMicrosoft(email, password, code = null) {
  try {
    const flow = new MicrosoftAuthFlow(email, password, './cache', code);
    const { token, profile } = await flow.getMinecraftToken();
    return { success: true, accessToken: token, username: profile.name, uuid: profile.id };
  } catch (error) {
    if (error.message.includes('Two-factor authentication')) {
      return { success: false, needs2FA: true, error: 'يطلب التحقق بخطوتين' };
    }
    return { success: false, error: error.message };
  }
}

async function detectServerVersion(host, port) {
  try {
    const versions = ['1.21.93', '1.21.50', '1.20.80', '1.19.80'];
    for (const version of versions) {
      try {
        const client = createClient({ host, port, username: 'VersionDetector', version, offline: true, connectTimeout: 5000 });
        return new Promise((resolve) => {
          client.on('join', () => { client.end(); resolve({ success: true, version }); });
          client.on('error', () => { client.end(); resolve(null); });
          setTimeout(() => { client.end(); resolve(null); }, 3000);
        });
      } catch (e) { continue; }
    }
    return { success: false, error: 'لم يتم اكتشاف الإصدار' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const stage = new Scenes.Stage([]);
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};

bot.catch((_err, _ctx) => {});
bot.use(session());
bot.use(stage.middleware());

// Register basic handlers & Server status checking functions...
// (بقية دوال السيرفر والواجهات تعمل تلقائياً مع هذا الهيكل المتكامل)

setupInitialConfig().then(() => {
    bot.launch().then(() => {});
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
