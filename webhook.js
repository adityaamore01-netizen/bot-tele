 import { Telegraf } from "telegraf";
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply("Bot berhasil berjalan di Vercel!")); bot.on("text", (ctx) => ctx.reply("Pesan diterima: " + ctx.message.text));

export default async function handler(req, res) { if (req.method === "POST") { try { await bot.handleUpdate(req.body); return res.status(200).end(); } catch (err) { console.error(err); return res.status(500).send("Webhook error"); } }

return res.status(200).send("Bot Telegram using Webhook is running."); }

// === .env (tempatkan di Vercel Environment Variables, bukan di repo) === // BOT_TOKEN=xxxx
