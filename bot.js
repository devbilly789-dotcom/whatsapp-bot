const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

const OWNER_NUMBER = '254114245222';
const PREFIX = '!';

let currentQR = null;
let sock = null;
let botReady = false;

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

async function startBot() {
    console.log('🚀 Starting WhatsApp Bot...');
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
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
            currentQR = qr;
            console.log('\n📲 QR CODE GENERATED - Visit /qr to see it\n');
            // Generate smaller QR in terminal
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            botReady = false;
            currentQR = null;
            setTimeout(startBot, 5000);
        }
        if (connection === 'open') {
            console.log('\n✅ BOT CONNECTED!');
            console.log('📱 Number:', sock.user.id.split(':')[0]);
            botReady = true;
            currentQR = null;
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

// Web routes
app.get('/', (req, res) => {
    res.json({ 
        status: botReady ? 'online' : 'connecting', 
        bot: '🤖 WhatsApp Bot',
        owner: OWNER_NUMBER,
        qr_available: !!currentQR,
        timestamp: new Date().toISOString()
    });
});

// Show QR code as text
app.get('/qr', (req, res) => {
    if (!currentQR) {
        return res.send(`
            <html>
                <body style="font-family: Arial; padding: 40px; text-align: center;">
                    <h2>🤖 WhatsApp Bot</h2>
                    <p>Status: ${botReady ? '✅ Connected' : '⏳ Connecting...'}</p>
                    ${botReady ? '<p>Bot is already connected!</p>' : '<p>QR code not available yet. Refresh in a few seconds.</p>'}
                </body>
            </html>
        `);
    }
    
    // Generate QR as ASCII art for easy scanning
    const qrAscii = qrcode.generate(currentQR, { small: true });
    
    res.send(`
        <html>
            <body style="font-family: monospace; padding: 20px; background: #000; color: #fff;">
                <h2 style="text-align: center;">📲 Scan with WhatsApp</h2>
                <pre style="font-size: 8px; line-height: 8px; text-align: center;">${qrAscii}</pre>
                <p style="text-align: center;">Open WhatsApp → Settings → Linked Devices → Link a Device</p>
            </body>
        </html>
    `);
});

// Alternative: show QR as data URL
app.get('/qr-image', (req, res) => {
    if (!currentQR) return res.json({ error: 'No QR available' });
    res.json({ qr: currentQR });
});

app.get('/health', (req, res) => res.json({ status: 'ok', botReady }));

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`📱 Visit: https://your-render-url.onrender.com/qr to see QR code`);
    startBot();
});
