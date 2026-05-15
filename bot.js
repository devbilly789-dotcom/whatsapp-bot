const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

const OWNER_NUMBER = '254114245222';
const PREFIX = '!';

let currentQR = null;
let sock = null;
let botReady = false;
let connectionStatus = 'initializing';

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
    connectionStatus = 'connecting';

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
            connectionStatus = 'qr_ready';
            console.log('\n📲 QR CODE READY - Visit / to scan\n');
        }
        if (connection === 'close') {
            botReady = false;
            currentQR = null;
            connectionStatus = 'disconnected';
            setTimeout(startBot, 5000);
        }
        if (connection === 'open') {
            console.log('\n✅ BOT CONNECTED!');
            console.log('📱 Number:', sock.user.id.split(':')[0]);
            botReady = true;
            currentQR = null;
            connectionStatus = 'connected';
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

// ========== FRONTEND HTML/CSS ==========

const getHomePage = (qrDataUrl, status) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🤖 WhatsApp Bot</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 24px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            text-align: center;
        }

        .logo {
            font-size: 60px;
            margin-bottom: 10px;
        }

        h1 {
            color: #1a1a2e;
            font-size: 28px;
            margin-bottom: 8px;
        }

        .subtitle {
            color: #666;
            font-size: 14px;
            margin-bottom: 30px;
        }

        .status-badge {
            display: inline-block;
            padding: 8px 20px;
            border-radius: 50px;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 25px;
        }

        .status-connected {
            background: #d4edda;
            color: #155724;
        }

        .status-connecting {
            background: #fff3cd;
            color: #856404;
        }

        .status-qr {
            background: #cce5ff;
            color: #004085;
        }

        .qr-container {
            background: #f8f9fa;
            border-radius: 16px;
            padding: 30px;
            margin-bottom: 25px;
        }

        .qr-container img {
            width: 100%;
            max-width: 280px;
            border-radius: 12px;
            background: white;
            padding: 15px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }

        .qr-placeholder {
            width: 280px;
            height: 280px;
            margin: 0 auto;
            background: #e9ecef;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 60px;
        }

        .steps {
            text-align: left;
            background: #f8f9fa;
            border-radius: 16px;
            padding: 25px;
            margin-bottom: 20px;
        }

        .steps h3 {
            color: #1a1a2e;
            margin-bottom: 15px;
            font-size: 16px;
        }

        .steps ol {
            padding-left: 20px;
            color: #555;
        }

        .steps li {
            margin: 10px 0;
            line-height: 1.6;
        }

        .btn {
            display: inline-block;
            padding: 14px 35px;
            border-radius: 50px;
            font-size: 16px;
            font-weight: 600;
            text-decoration: none;
            border: none;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }

        .btn-secondary {
            background: #e9ecef;
            color: #495057;
            margin-left: 10px;
        }

        .btn-secondary:hover {
            background: #dee2e6;
        }

        .footer {
            margin-top: 25px;
            padding-top: 20px;
            border-top: 1px solid #e9ecef;
            color: #888;
            font-size: 12px;
        }

        .pulse {
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }

        .connected-info {
            background: #d4edda;
            border-radius: 16px;
            padding: 30px;
            margin-bottom: 20px;
        }

        .connected-info h2 {
            color: #155724;
            margin-bottom: 10px;
        }

        .connected-info p {
            color: #155724;
            opacity: 0.8;
        }

        .phone-number {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
            margin: 15px 0;
        }

        @media (max-width: 480px) {
            .container {
                padding: 25px;
            }
            h1 {
                font-size: 24px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🤖</div>
        <h1>WhatsApp Bot</h1>
        <p class="subtitle">Powered by Baileys & Node.js</p>

        ${status === 'connected' ? `
        <span class="status-badge status-connected">● Online</span>

        <div class="connected-info">
            <h2>✅ Bot Connected!</h2>
            <p>Your bot is live and ready to chat</p>
            <div class="phone-number">+${OWNER_NUMBER}</div>
            <p>Message this number to interact with the bot</p>
        </div>

        <div class="steps">
            <h3>📝 Available Commands</h3>
            <ol>
                <li><strong>!help</strong> - Show all commands</li>
                <li><strong>!time</strong> - Current time</li>
                <li><strong>!joke</strong> - Random joke</li>
                <li><strong>!echo &lt;text&gt;</strong> - Repeat message</li>
                <li><strong>!weather &lt;city&gt;</strong> - Weather info</li>
                <li><strong>!calc &lt;expr&gt;</strong> - Calculator</li>
                <li><strong>!coin</strong> - Flip a coin</li>
            </ol>
        </div>

        <button class="btn btn-secondary" onclick="location.reload()">🔄 Refresh Status</button>
        ` : status === 'qr_ready' ? `
        <span class="status-badge status-qr">📲 Scan QR Code</span>

        <div class="qr-container">
            <img src="${qrDataUrl}" alt="WhatsApp QR Code">
        </div>

        <div class="steps">
            <h3>📱 How to Connect</h3>
            <ol>
                <li>Open <strong>WhatsApp</strong> on your phone</li>
                <li>Tap <strong>⋮</strong> → <strong>Settings</strong> → <strong>Linked Devices</strong></li>
                <li>Tap <strong>"Link a Device"</strong></li>
                <li>Point camera at the QR code above</li>
                <li>Wait for "Connected" confirmation</li>
            </ol>
        </div>

        <button class="btn btn-primary" onclick="location.reload()">🔄 Refresh QR Code</button>
        ` : `
        <span class="status-badge status-connecting pulse">⏳ Connecting...</span>

        <div class="qr-placeholder">
            ⏳
        </div>

        <p style="color: #666; margin: 20px 0;">Please wait while the bot initializes...</p>

        <button class="btn btn-secondary" onclick="location.reload()">🔄 Refresh</button>
        `}

        <div class="footer">
            <p>🔒 Secure Connection • 🚀 Real-time Messaging</p>
            <p>Built with ❤️ using Baileys</p>
        </div>
    </div>
</body>
</html>
`;

// ========== ROUTES ==========

app.get('/', async (req, res) => {
    let qrDataUrl = null;

    if (currentQR) {
        try {
            qrDataUrl = await QRCode.toDataURL(currentQR, { 
                width: 300,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' }
            });
        } catch (err) {
            console.error('QR generation failed:', err);
        }
    }

    res.send(getHomePage(qrDataUrl, connectionStatus));
});

app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        botReady,
        owner: OWNER_NUMBER,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => res.json({ status: 'ok', botReady }));

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`📱 Open: https://your-url.onrender.com`);
    startBot();
});
