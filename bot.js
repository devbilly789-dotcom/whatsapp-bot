const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

const OWNER_NUMBER = '254114245222';
const PREFIX = '!';

const commands = {
    help: () => `*🤖 WhatsApp Bot*\n\n!help - Menu\n!time - Time\n!joke - Joke\n!echo <text> - Repeat\n!weather <city> - Weather\n!calc <expr> - Calculator\n!coin - Flip coin`,
    time: () => `🕐 ${new Date().toLocaleString()}`,
    joke: () => {
        const jokes = [
            "Why do programmers prefer dark mode? Because light attracts bugs!",
            "Why did the developer go broke? He used up all his cache!",
            "What's a computer's favorite snack? Microchips!"
        ];
        return jokes[Math.floor(Math.random() * jokes.length)];
    },
    echo: (args) => args ? `📢 ${args}` : "Usage: !echo hello",
    weather: (args) => args ? `🌤️ ${args}: ${Math.floor(Math.random() * 30 + 10)}°C` : "Usage: !weather Nairobi",
    calc: (args) => { try { return `🧮 ${args} = ${eval(args)}`; } catch { return "Invalid"; } },
    coin: () => `🪙 ${Math.random() > 0.5 ? 'Heads' : 'Tails'}`
};

let sock = null;
let botReady = false;

async function startBot() {
    console.log('🚀 Starting WhatsApp Bot...');
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    // Use pino logger to fix the compatibility issue
    const logger = pino({ level: 'silent' });
    
    sock = makeWASocket({
        version,
        auth: state,
        logger,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', ({ connection, qr }) => {
        if (qr) {
            console.log('\n📲 SCAN QR CODE WITH WHATSAPP\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('❌ Disconnected. Reconnecting:', shouldReconnect);
            botReady = false;
            if (shouldReconnect) setTimeout(startBot, 5000);
        }
        if (connection === 'open') {
            console.log('\n✅ BOT CONNECTED!');
            console.log('📱 Number:', sock.user.id.split(':')[0]);
            botReady = true;
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            const from = msg.key.remoteJid;
            console.log(`📩 ${text}`);
            
            let reply = null;
            if (text.startsWith(PREFIX)) {
                const [cmd, ...rest] = text.slice(1).split(' ');
                reply = commands[cmd] ? commands[cmd](rest.join(' ')) : '❓ Unknown';
            }
            if (reply) {
                await sock.sendMessage(from, { text: reply });
                console.log(`✅ ${reply.slice(0,50)}`);
            }
        }
    });
}

app.get('/', (req, res) => res.json({ status: botReady ? 'online' : 'connecting' }));
app.get('/health', (req, res) => res.json({ status: 'ok', botReady }));

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    startBot();
});
