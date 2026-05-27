// simple_wa_checker.js
// Simple & Professional WhatsApp Checker Bot

const { Telegraf } = require('telegraf');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const http = require('http');

// ================= CONFIG =================

const BOT_TOKEN = '7557246575:AAGJ9GaGAWfuIzyZgQdcgIUMgZlgVkTl02o';
const ADMIN_ID = 5624278091;

const PORT = process.env.PORT || 3000;
const AUTH_FOLDER = './auth';

// ================= SERVER =================

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot Running');
}).listen(PORT);

console.log(`🚀 Server running on ${PORT}`);

// ================= BOT =================

const bot = new Telegraf(BOT_TOKEN);

let sock;
let isConnected = false;

// ================= CONNECT WHATSAPP =================

async function startWhatsApp(ctx = null) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Safari')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      // QR CODE
      if (qr && ctx) {
        console.log('📲 QR Generated');

        try {
          const qrImage = await QRCode.toBuffer(qr);

          await ctx.replyWithPhoto(
            { source: qrImage },
            { caption: '📲 Scan QR Code to connect WhatsApp' }
          );

        } catch (e) {
          await ctx.reply(`QR:\n${qr}`);
        }
      }

      // CONNECTED
      if (connection === 'open') {
        isConnected = true;

        console.log('✅ WhatsApp Connected');

        if (ctx) {
          await ctx.reply('✅ WhatsApp Connected Successfully!');
        }
      }

      // DISCONNECTED
      if (connection === 'close') {
        isConnected = false;

        const reason = lastDisconnect?.error?.output?.statusCode;

        console.log('❌ WhatsApp Disconnected');

        // LOGOUT
        if (reason === DisconnectReason.loggedOut) {
          console.log('⚠️ Logged Out');

          fs.rmSync(AUTH_FOLDER, {
            recursive: true,
            force: true
          });

          sock = null;

          if (ctx) {
            await ctx.reply('❌ WhatsApp Logged Out');
          }

        } else {
          // AUTO RECONNECT
          console.log('🔄 Reconnecting...');

          sock = null;

          setTimeout(() => {
            startWhatsApp();
          }, 5000);
        }
      }
    });

  } catch (err) {
    console.log('ERROR:', err);

    if (ctx) {
      ctx.reply('❌ Connection Failed');
    }
  }
}

// ================= AUTO CONNECT =================

if (fs.existsSync(AUTH_FOLDER)) {
  startWhatsApp();
}

// ================= COMMANDS =================

// START
bot.start(async (ctx) => {
  await ctx.reply(
`🤖 Simple WhatsApp Checker Bot

Commands:

/connect - Connect WhatsApp
/disconnect - Logout WhatsApp
/status - Check Status

📞 Send any number to check WhatsApp`
  );
});

// CONNECT
bot.command('connect', async (ctx) => {

  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply('❌ Admin Only');
  }

  if (isConnected) {
    return ctx.reply('✅ Already Connected');
  }

  await ctx.reply('🔄 Connecting WhatsApp...');

  startWhatsApp(ctx);
});

// DISCONNECT
bot.command('disconnect', async (ctx) => {

  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply('❌ Admin Only');
  }

  try {

    if (sock) {
      await sock.logout();
    }

    fs.rmSync(AUTH_FOLDER, {
      recursive: true,
      force: true
    });

    sock = null;
    isConnected = false;

    await ctx.reply('✅ WhatsApp Disconnected');

  } catch (e) {
    await ctx.reply('❌ Disconnect Failed');
  }
});

// STATUS
bot.command('status', async (ctx) => {

  await ctx.reply(
`📊 Status

WhatsApp: ${isConnected ? '✅ Connected' : '❌ Disconnected'}
Bot: ✅ Running`
  );
});

// ================= NUMBER CHECKER =================

function extractNumbers(text) {

  const found = text.match(/\+?\d{10,15}/g) || [];

  return [...new Set(found.map(n => {
    const clean = n.replace(/\D/g, '');

    if (clean.length === 10) {
      return '1' + clean;
    }

    return clean;
  }))];
}

bot.on('text', async (ctx) => {

  if (ctx.message.text.startsWith('/')) return;

  if (!isConnected || !sock) {
    return ctx.reply('❌ WhatsApp Not Connected');
  }

  const numbers = extractNumbers(ctx.message.text);

  if (numbers.length === 0) {
    return ctx.reply('❌ No Valid Numbers Found');
  }

  const checking = await ctx.reply(
    `🔍 Checking ${numbers.length} Numbers...`
  );

  let fresh = [];
  let registered = [];
  let errors = [];

  // FAST CHECK
  const results = await Promise.allSettled(

    numbers.map(async (num) => {

      try {

        const result = await sock.onWhatsApp(num);

        if (result?.[0]?.exists) {
          registered.push('+' + num);
        } else {
          fresh.push('+' + num);
        }

      } catch {
        errors.push('+' + num);
      }
    })
  );

  try {
    await ctx.deleteMessage(checking.message_id);
  } catch {}

  let msg = '';

  if (registered.length > 0) {
    msg += `🚫 Registered (${registered.length})\n`;
    msg += registered.join('\n');
    msg += '\n\n';
  }

  if (fresh.length > 0) {
    msg += `✅ Fresh (${fresh.length})\n`;
    msg += fresh.join('\n');
    msg += '\n\n';
  }

  if (errors.length > 0) {
    msg += `⚠️ Errors (${errors.length})\n`;
    msg += errors.join('\n');
  }

  await ctx.reply(msg || '❌ No Results');
});

// ================= START BOT =================

bot.launch()
.then(() => {
  console.log('🤖 Telegram Bot Started');
})
.catch(console.log);

// ================= EXIT SAFETY =================

process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);
