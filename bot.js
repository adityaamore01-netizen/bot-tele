// bot.js
require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const BOT_TOKEN = process.env.BOT_TOKEN; // from BotFather
const PORT = process.env.PORT || 3000;
const RESELLER_BASE = process.env.RESELLER_BASE || ''; // optional
const RESELLER_KEY = process.env.RESELLER_KEY || '';   // optional
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change_me';

// validate token
if (!BOT_TOKEN) {
  console.error('ERROR: set BOT_TOKEN in .env');
  process.exit(1);
}

// init bot
const bot = new Telegraf(BOT_TOKEN);

// init express
const app = express();
app.use(bodyParser.json());

// open sqlite db
let db;
(async () => {
  db = await open({
    filename: './db.sqlite',
    driver: sqlite3.Database
  });
  await db.exec(`CREATE TABLE IF NOT EXISTS topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT,
    server_id TEXT,
    txn_id TEXT,
    amount TEXT,
    provider TEXT,
    created_at TEXT
  )`);
})();

// --- Helper: map reseller response to our shape (customize per provider) ---
function mapResellerAccount(json, player_id, server_id) {
  // adapt this mapping to your provider's response fields
  return {
    nickname: json.nickname || json.playerName || `Player${player_id}`,
    userId: player_id,
    server: server_id,
    created_at: json.created_at || null,
    bind: json.bind || null,
    first_topup: json.first_topup || null,
    first_txn_id: json.first_txn_id || null
  };
}

// --- Bot commands ---

bot.start((ctx) => {
  ctx.replyWithMarkdown(
    "*MLBB Account Checker Bot*\n\n" +
    "Usage:\n" +
    "`/cek <player_id> <server_id>` - check account info\n" +
    "`/bind <player_id> <server_id>` - check bind status\n" +
    "`/firsttopup <player_id> <server_id>` - show first top-up (if recorded)\n\n" +
    "Example: `/cek 12345678 2012`"
  );
});

// /cek command
bot.command('cek', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 2) return ctx.reply('Format: /cek <player_id> <server_id>');
  const [player_id, server_id] = args;

  // basic validation
  if (!/^\d+$/.test(player_id) || !/^\d+$/.test(server_id)) {
    return ctx.reply('Player ID and Server ID harus angka.');
  }

  // 1) try reseller if configured
  if (RESELLER_BASE && RESELLER_KEY) {
    try {
      const url = `${RESELLER_BASE}/validate?player_id=${encodeURIComponent(player_id)}&server_id=${encodeURIComponent(server_id)}`;
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${RESELLER_KEY}` } });
      if (r.ok) {
        const json = await r.json();
        const data = mapResellerAccount(json, player_id, server_id);
        // check DB for first topup
        const row = await db.get("SELECT * FROM topups WHERE player_id = ? AND server_id = ? ORDER BY id ASC LIMIT 1", [player_id, server_id]);
        if (row) {
          data.first_topup = row.amount;
          data.first_txn_id = row.txn_id;
        }
        return ctx.reply(formatAccountMessage(data));
      }
    } catch (e) {
      console.warn('Reseller fetch error', e.message);
      // continue to fallback
    }
  }

  // fallback mock (no reseller)
  const mock = {
    nickname: `Player${player_id}`,
    userId: player_id,
    server: server_id,
    created_at: '2020-01-01',
    bind: { moonton: false, google: false, tiktok: false, facebook: false },
    first_topup: null,
    first_txn_id: null
  };
  const row = await db.get("SELECT * FROM topups WHERE player_id = ? AND server_id = ? ORDER BY id ASC LIMIT 1", [player_id, server_id]);
  if (row) {
    mock.first_topup = row.amount;
    mock.first_txn_id = row.txn_id;
  }
  return ctx.reply(formatAccountMessage(mock));
});

// /bind command
bot.command('bind', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 2) return ctx.reply('Format: /bind <player_id> <server_id>');
  const [player_id, server_id] = args;

  // Try reseller bind endpoint if available
  if (RESELLER_BASE && RESELLER_KEY) {
    try {
      const url = `${RESELLER_BASE}/bind?player_id=${encodeURIComponent(player_id)}&server_id=${encodeURIComponent(server_id)}`;
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${RESELLER_KEY}` } });
      if (r.ok) {
        const json = await r.json();
        return ctx.reply(formatBindMessage(json.bind || {}));
      }
    } catch (e) {
      console.warn('Reseller bind error', e.message);
    }
  }

  // fallback
  return ctx.reply(formatBindMessage({ moonton: false, google: false, tiktok: false, facebook: false }));
});

// /firsttopup command
bot.command('firsttopup', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 2) return ctx.reply('Format: /firsttopup <player_id> <server_id>');
  const [player_id, server_id] = args;

  const row = await db.get("SELECT * FROM topups WHERE player_id = ? AND server_id = ? ORDER BY id ASC LIMIT 1", [player_id, server_id]);
  if (!row) return ctx.reply('Belum ada catatan top-up untuk akun ini.');
  const msg = `First Top-up:\nTxn ID: ${row.txn_id}\nAmount: ${row.amount}\nProvider: ${row.provider || '-'}\nAt: ${row.created_at}`;
  return ctx.reply(msg);
});

// Helper: format messages
function formatBindMessage(bind) {
  return `Bind status:\nMoonton: ${bind.moonton ? 'Yes' : 'No'}\nGoogle: ${bind.google ? 'Yes' : 'No'}\nTikTok: ${bind.tiktok ? 'Yes' : 'No'}\nFacebook: ${bind.facebook ? 'Yes' : 'No'}`;
}

function formatAccountMessage(data) {
  return [
    `Nickname: ${data.nickname || '-'}`,
    `Player ID: ${data.userId || '-'}`,
    `Server: ${data.server || '-'}`,
    `Created: ${data.created_at || '-'}`,
    `First Top-up: ${data.first_topup || '-'}`,
    `First TXN ID: ${data.first_txn_id || '-'}`,
    `Bind: ${formatBindString(data.bind || {})}`
  ].join('\n');
}

function formatBindString(bind) {
  return `Moonton:${bind.moonton ? 'Y' : 'N'} Google:${bind.google ? 'Y' : 'N'} TikTok:${bind.tiktok ? 'Y' : 'N'} Facebook:${bind.facebook ? 'Y' : 'N'}`;
}

// --- Webhook endpoint for providers to POST topup info ---
// Expected JSON body:
// {
//   "player_id":"12345",
//   "server_id":"2012",
//   "txn_id":"TXN123",
//   "amount":"50 Diamonds",
//   "provider":"MyProvider"
// }
// Header: x-webhook-secret: <WEBHOOK_SECRET>
app.post('/webhook/topup', async (req, res) => {
  const secret = req.headers['x-webhook-secret'] || '';
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return res.status(403).json({ status: 'error', message: 'forbidden' });
  }

  const { player_id, server_id, txn_id, amount, provider } = req.body;
  if (!player_id || !server_id || !txn_id) {
    return res.status(400).json({ status: 'error', message: 'missing fields' });
  }

  const created_at = new Date().toISOString();
  await db.run(
    'INSERT INTO topups (player_id, server_id, txn_id, amount, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [player_id, server_id, txn_id, amount || '-', provider || '-', created_at]
  );

  // Optionally: notify admin chat (if ADMIN_CHAT_ID set)
  if (process.env.ADMIN_CHAT_ID) {
    const adminId = process.env.ADMIN_CHAT_ID;
    const msg = `New topup recorded:\nPlayer: ${player_id}-${server_id}\nTxn: ${txn_id}\nAmount: ${amount}\nProvider: ${provider}\nAt: ${created_at}`;
    try { await bot.telegram.sendMessage(adminId, msg); } catch (e) { console.warn('Notify admin failed', e.message); }
  }

  return res.json({ status: 'ok' });
});

// start express server
app.get('/', (req, res) => res.send('MLBB Telegram Bot running'));
app.listen(PORT, () => {
  console.log('HTTP server listening on', PORT);
  // start bot after server listening
  bot.launch();
  console.log('Telegram bot launched');
});

// Graceful stop
process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
