const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONFIGURATION
// ============================================

const OWNER_NUMBER = '254114245222';
const BOT_NAME = '🤖 WhatsApp Bot';
const PREFIX = '!';

// ============================================
// COMMANDS
// ============================================

const commands = {
    help: () => `*${BOT_NAME}*

*Commands:*
${PREFIX}help - Show this menu
${PREFIX}time - Current time
${PREFIX}joke - Random joke
${PREFIX}echo <text> - Repeat text
${PREFIX}weather <city> - Weather info
${PREFIX}calc <expression> - Calculator
${PREFIX}coin - Flip a coin
${PREFIX}owner - Bot owner info
${PREFIX}ping - Check bot status

_Type ${PREFIX}menu for quick options_`,

    time: () => {
        const now = new Date();
        return `🕐 *Current Time*\n${now.toLocaleString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })}\nTimezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    },

    joke: () => {
        const jokes = [
            "Why do programmers prefer dark mode? Because light attracts bugs! 🐛",
            "Why did the developer go broke? Because he used up all his cache! 💰",
            "How many programmers does it take to change a light bulb? None, that's a hardware problem! 💡",
            "Why do Java developers wear glasses? Because they don't C#! 👓",
            "What's a computer's favorite snack? Microchips! 🍟",
            "Why was the function sad? It didn't get any calls! 📞",
            "What do you call a snake that writes software? A Python developer! 🐍",
            "Why did the database admin leave his wife? She had too many relationships! 💔"
        ];
        return jokes[Math.floor(Math.random() * jokes.length)];
    },

    echo: (args) => {
        if (!args) return "❌ Usage: " + PREFIX + "echo Hello World";
        return `📢 *Echo:*\n${args}`;
    },

    weather: (args) => {
        if (!args) return "❌ Usage: " + PREFIX + "weather Nairobi";
        const temp = Math.floor(Math.random() * 30) + 10;
        const conditions = ['Sunny ☀️', 'Cloudy ☁️', 'Rainy 🌧️', 'Windy 💨'];
        const condition = conditions[Math.floor(Math.random() * conditions.length)];
        const humidity = Math.floor(Math.random() * 50) + 30;
        return `🌤️ *Weather for ${args}*\n\n🌡️ Temperature: ${temp}°C\n☁️ Condition: ${condition}\n💧 Humidity: ${humidity}%\n\n_Note: Demo data._`;
    },

    calc: (args) => {
        if (!args) return "❌ Usage: " + PREFIX + "calc 2+2*5";
        try {
            const allowed = /^[\d\s+\-*/().]+$/;
            if (!allowed.test(args)) return "❌ Invalid characters. Only numbers and + - * / ( ) allowed.";
            const result = eval(args);
            return `🧮 *Result*\n${args} = ${result}`;
        } catch (e) {
            return `❌ Error: ${e.message}`;
        }
    },

    coin: () => `🪙 *Coin Flip*\nResult: ${Math.random() > 0.5 ? 'Heads' : 'Tails'}`,

    owner: () => `👤 *Bot Owner*\n\nNumber: +${OWNER_NUMBER}\nStatus: Online ✅\n\nType ${PREFIX}help for commands.`,

    ping: () => `🏓 *Pong!*\nBot is running and responsive.`,

    menu: () => `📋 *Quick Menu*\n\nReply with a number:\n1️⃣ Help\n2️⃣ Current Time\n3️⃣ Random Joke\n4️⃣ Weather\n5️⃣ Calculator\n6️⃣ Coin Flip\n7️⃣ Owner Info`
};

// ============================================
// NATURAL LANGUAGE
// ============================================

function handleNaturalLanguage(text) {
    const lower = text.toLowerCase();
    if (['hello', 'hi', 'hey', 'hola', 'yo'].some(w => lower.includes(w))) {
        return `👋 Hello! I'm ${BOT_NAME}. Type ${PREFIX}help to see what I can do!`;
    }
    if (['bye', 'goodbye', 'see you', 'cya'].some(w => lower.includes(w))) {
        return "👋 Goodbye! Have a great day!";
    }
    if (['thank', 'thanks', 'gracias', 'asante'].some(w => lower.includes(w))) {
        return "🙏 You're welcome! Happy to help.";
    }
    if (['1', '2', '3', '4', '5', '6', '7'].includes(text.trim())) {
        const menuMap = { '1': 'help', '2': 'time', '3': 'joke', '4': 'weather', '5': 'calc', '6': 'coin', '7': 'owner' };
        return commands[menuMap[text.trim()]]();
    }
    if (['who are you', 'what are you', 'your name'].some(w => lower.includes(w))) {
        return `🤖 I'm ${BOT_NAME}, running on a server via Baileys!`;
    }
    if (['how are you', 'how r u'].some(w => lower.includes(w))) {
        return "🤖 I'm doing great! Ready to help you.";
    }
    return null;
}

// ============================================
// WHATSAPP CONNECTION
// ============================================

let sock = null;
let botReady = false;

async function startBot() {
    console.log('🚀 Starting WhatsApp Bot...');
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        logger: { level: 'silent' }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n📲 SCAN QR CODE WITH YOUR WHATSAPP\n');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Connection closed. Reconnecting:', shouldReconnect);
            botReady = false;
            if (shouldReconnect) setTimeout(startBot, 5000);
        } else if (connection === 'open') {
            console.log('\n✅ BOT CONNECTED!');
            console.log('📱 Number:', sock.user.id.split(':')[0]);
            botReady = true;
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            try {
                const text = msg.message?.conversation || 
                            msg.message?.extendedTextMessage?.text || 
                            msg.message?.imageMessage?.caption || '';
                const from = msg.key.remoteJid;
                const sender = msg.pushName || 'Unknown';
                
                console.log(`\n📩 ${sender}: ${text}`);

                let reply = null;
                const lowerText = text.toLowerCase().trim();
                
                if (lowerText.startsWith(PREFIX)) {
                    const args = text.slice(PREFIX.length).trim();
                    const cmdName = args.split(' ')[0].toLowerCase();
                    const cmdArgs = args.slice(cmdName.length).trim();
                    const cmd = commands[cmdName];
                    reply = cmd ? cmd(cmdArgs) : `❓ Unknown command. Type ${PREFIX}help`;
                } else {
                    reply = handleNaturalLanguage(text);
                }
                
                if (reply) {
                    await sock.sendMessage(from, { text: reply });
                    console.log(`✅ Replied: ${reply.slice(0, 60)}...`);
                }
            } catch (err) {
                console.error('❌ Error:', err);
            }
        }
    });
}

// ============================================
// EXPRESS SERVER (for Render health checks)
// ============================================

app.get('/', (req, res) => {
    res.json({
        status: botReady ? 'online' : 'connecting',
        bot: BOT_NAME,
        owner: OWNER_NUMBER,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', botReady });
});

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    startBot();
});