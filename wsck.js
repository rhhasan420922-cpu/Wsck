// checker_super_fast.js - ULTRA FAST WhatsApp Checker
const { Telegraf } = require('telegraf');
const { makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason, fetchLatestBaileysVersion, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const http = require('http');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => { res.writeHead(200, {'Content-Type': 'text/plain'}); res.end('Bot Running\n'); });
server.listen(PORT, '0.0.0.0', () => console.log(`Server on port ${PORT}`));

const BOT_TOKEN = process.env.BOT_TOKEN || '7028850279:AAFSlSqSlTaCD_Vi9vLzxxUu94pjCeKpavk';
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || 5624278091;
const AUTH_FOLDER = 'auth_info';
const USER_DATA_FILE = 'users.json';

let sock = null, isConnected = false, qrTimeout = null;
let allowedUsers = new Set(), pendingUsers = new Set(), userNames = new Map();

function loadUsers() {
  try {
    if (fs.existsSync(USER_DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(USER_DATA_FILE, 'utf8'));
      allowedUsers = new Set(data.allowedUsers || [ADMIN_ID]);
      pendingUsers = new Set(data.pendingUsers || []);
      userNames = new Map(data.userNames || []);
    } else allowedUsers = new Set([ADMIN_ID]);
  } catch(e) { allowedUsers = new Set([ADMIN_ID]); }
}
function saveUsers() {
  try { fs.writeFileSync(USER_DATA_FILE, JSON.stringify({ allowedUsers: [...allowedUsers], pendingUsers: [...pendingUsers], userNames: [...userNames] }, null, 2)); } catch(e) {}
}
function isUserAllowed(id) { return allowedUsers.has(id); }
loadUsers();

async function getVersion() { try { return (await fetchLatestBaileysVersion()).version; } catch { return [2,2209,1]; } }
async function disconnectWA() { if(sock) try{await sock.ws.close();}catch{} sock=null; isConnected=false; if(qrTimeout) clearTimeout(qrTimeout); }

async function connectWA(ctx=null) {
  if(isConnected) { if(ctx) await ctx.reply('✅ Already connected!'); return; }
  const {state,saveCreds}=await useMultiFileAuthState(AUTH_FOLDER);
  sock=makeWASocket({ version:await getVersion(), auth:state, logger:pino({level:'silent'}), browser:Browsers.macOS('Safari'), printQRInTerminal:true });
  sock.ev.on('creds.update',saveCreds);
  sock.ev.on('connection.update', async(u)=>{
    const {connection,qr,lastDisconnect}=u;
    if(qr && ctx){
      try{
        // SUPER SMALL QR - 100px only
        const buf=await QRCode.toBuffer(qr,{ type:'png', width:100, margin:0, errorCorrectionLevel:'L' });
        await ctx.replyWithPhoto({ source:buf },{ caption:'📲 Scan QR\n\nOpen WhatsApp → Linked Devices → Link a Device\n⏳ 90s' });
      }catch(e){
        try{
          const txt=await QRCode.toString(qr,{ type:'utf8', margin:0 });
          await ctx.reply(`📲 SCAN QR\n\`\`\`\n${txt.trim()}\n\`\`\`\n⏳ 90s`,{ parse_mode:'Markdown' });
        }catch(e2){ await ctx.reply('❌ QR failed. Check console.'); }
      }
      if(qrTimeout) clearTimeout(qrTimeout);
      qrTimeout=setTimeout(()=>{ if(!isConnected){ disconnectWA(); if(ctx) ctx.reply('⏰ QR expired'); } },90000);
    }
    if(connection==='open'){ isConnected=true; if(qrTimeout) clearTimeout(qrTimeout); if(ctx) await ctx.reply('✅ WhatsApp Connected! Send numbers to check.'); }
    if(connection==='close'){
      isConnected=false;
      if(lastDisconnect?.error?.output?.statusCode===DisconnectReason.loggedOut){
        if(ctx) await ctx.reply('❌ Logged out. Send /connect');
        try{ fs.rmSync(AUTH_FOLDER,{recursive:true,force:true}); }catch(e){}
        sock=null;
      }else{ sock=null; await delay(10000); await connectWA(ctx); }
    }
  });
}

if(fs.existsSync(AUTH_FOLDER)) connectWA();

const bot = new Telegraf(BOT_TOKEN);

bot.use(async (ctx,next)=>{
  const uid=ctx.from.id;
  if(!userNames.has(uid)) userNames.set(uid,ctx.from.first_name);
  if(uid===ADMIN_ID || isUserAllowed(uid) || ctx.message?.text?.startsWith('/start')) return next();
  await ctx.reply('❌ Unauthorized. Wait for admin approval.');
  if(!pendingUsers.has(uid)){
    pendingUsers.add(uid);
    saveUsers();
    await bot.telegram.sendMessage(ADMIN_ID,`🆕 New User: ${ctx.from.first_name}\nID: ${uid}\n@${ctx.from.username||'N/A'}`,{ reply_markup:{ inline_keyboard:[[{text:'✅ Allow',callback_data:`allow_${uid}`},{text:'❌ Deny',callback_data:`deny_${uid}`}]] } });
  }
});

bot.on('callback_query',async(ctx)=>{
  const data=ctx.callbackQuery.data;
  if(ctx.callbackQuery.from.id!==ADMIN_ID) return ctx.answerCbQuery('Admin only');
  const uid=parseInt(data.split('_')[1]);
  if(data.startsWith('allow_')){
    allowedUsers.add(uid); pendingUsers.delete(uid); saveUsers();
    await ctx.answerCbQuery('✅ Allowed');
    await ctx.editMessageText(`✅ User allowed`);
    await bot.telegram.sendMessage(uid,'🎉 Access granted! Send /connect');
  }else if(data.startsWith('deny_')){
    pendingUsers.delete(uid); saveUsers();
    await ctx.answerCbQuery('❌ Denied');
    await ctx.editMessageText(`❌ User denied`);
  }
});

bot.start(async(ctx)=>{
  if(ctx.from.id===ADMIN_ID) await ctx.reply(`👋 Admin\n/connect - Link WhatsApp\n/users - Manage users\n/stats - Stats`);
  else if(isUserAllowed(ctx.from.id)) await ctx.reply(`👋 Welcome!\n1. Send /connect\n2. Send numbers to check\n\n📞 7828124894 or +18257976152`);
  else await ctx.reply(`📨 Request sent to admin. Wait for approval.`);
});

bot.command('qr',async(ctx)=>{ if(!isUserAllowed(ctx.from.id) && ctx.from.id!==ADMIN_ID) return; if(isConnected) return ctx.reply('Already connected'); await disconnectWA(); await connectWA(ctx); });
bot.command('connect',async(ctx)=>{ if(!isUserAllowed(ctx.from.id) && ctx.from.id!==ADMIN_ID) return; if(isConnected) return ctx.reply('✅ Already connected'); await ctx.reply('🔄 Connecting...'); await connectWA(ctx); });
bot.command('users',async(ctx)=>{ if(ctx.from.id!==ADMIN_ID) return; let msg='👥 Users:\n'; for(let uid of allowedUsers) if(uid!==ADMIN_ID) msg+=`✅ ${userNames.get(uid)||uid}\n`; for(let uid of pendingUsers) msg+=`⏳ ${userNames.get(uid)||uid}\n`; await ctx.reply(msg||'No users'); });
bot.command('stats',async(ctx)=>{ if(ctx.from.id!==ADMIN_ID) return; await ctx.reply(`📊 Stats:\nUsers: ${allowedUsers.size-1}\nPending: ${pendingUsers.size}\nWA: ${isConnected?'✅':'❌'}\nUptime: ${Math.floor(process.uptime()/60)}m`); });
bot.command('status',async(ctx)=>{ await ctx.reply(`WA: ${isConnected?'✅ Connected':'❌ Disconnected'}\nID: ${ctx.from.id}`); });

function extractNumbers(text){
  const nums=[...new Set((text.match(/[\+]?[1]?[-\s\.]?[(]?(\d{3})[)]?[-\s\.]?(\d{3})[-\s\.]?(\d{4})|\d{10,15}/g)||[]).map(n=>{ let d=n.replace(/\D/g,''); return d.length===10?`+1${d}`:d.length===11&&d.startsWith('1')?`+${d}`:`+${d}`; }))];
  return nums.filter(n=>n.length>=12);
}

async function checkNumbers(ctx,numbers){
  if(!isConnected||!sock) return ctx.reply('❌ Not connected. Send /connect');
  const msg=await ctx.reply(`⚡ Checking ${numbers.length} numbers...`);
  const results=[], batchSize=200;
  const chunks=[];
  for(let i=0;i<numbers.length;i+=batchSize) chunks.push(numbers.slice(i,i+batchSize));
  const chunkPromises=chunks.map(async chunk=>{
    const promises=chunk.map(async num=>{
      try{
        const res=await sock.onWhatsApp(num.replace(/\D/g,''));
        return { num, exists:Array.isArray(res)&&res.length>0&&res[0]?.exists===true };
      }catch(e){ return { num, exists:null }; }
    });
    const settled=await Promise.allSettled(promises);
    return settled.map(p=>p.status==='fulfilled'?p.value:{num:'error',exists:null});
  });
  const chunkResults=await Promise.all(chunkPromises);
  chunkResults.forEach(chunk=>results.push(...chunk));
  const lal=results.filter(r=>r.exists===true).map(r=>r.num);
  const fresh=results.filter(r=>r.exists===false).map(r=>r.num);
  try{ await ctx.deleteMessage(msg.message_id); }catch(e){}
  let out='';
  if(lal.length) out+=`🚫 Lal Baba (${lal.length}):\n${lal.join('\n')}\n\n`;
  if(fresh.length) out+=`✅ Fresh (${fresh.length}):\n${fresh.join('\n')}`;
  await ctx.reply(out||'❌ No valid numbers');
}

bot.on('text',async(ctx)=>{
  const text=ctx.message.text.trim();
  if(text.startsWith('/')) return;
  const nums=extractNumbers(text);
  if(!nums.length) return ctx.reply('❌ No valid numbers found');
  await checkNumbers(ctx,nums.slice(0,500));
});

bot.launch();
console.log('🚀 Bot Started! QR size reduced to 100px');

setInterval(()=>{ fetch(`https://${process.env.RENDER_SERVICE_NAME||'whatsapp-checker-bot'}.onrender.com`).catch(()=>{}); },5*60*1000);
