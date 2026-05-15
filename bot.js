const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

// SHOP CONFIG
const SHOP_NAME = "Billy's Shop";
const OWNER_NUMBER = '254114245222';
const CURRENCY = 'KES';

const PRODUCTS = [
    { id: 1, name: 'Wireless Earbuds', price: 1500, category: 'Electronics', description: 'Bluetooth 5.0, 20hr battery', inStock: true },
    { id: 2, name: 'Phone Case', price: 500, category: 'Accessories', description: 'Shockproof, all models', inStock: true },
    { id: 3, name: 'Power Bank 20000mAh', price: 2500, category: 'Electronics', description: 'Fast charging, dual USB', inStock: true },
    { id: 4, name: 'USB-C Cable', price: 300, category: 'Accessories', description: 'Braided, 2 meters', inStock: true },
    { id: 5, name: 'Screen Protector', price: 400, category: 'Accessories', description: 'Tempered glass', inStock: false },
    { id: 6, name: 'Bluetooth Speaker', price: 3500, category: 'Electronics', description: 'Waterproof, 12hr playtime', inStock: true },
    { id: 7, name: 'Laptop Stand', price: 1200, category: 'Office', description: 'Adjustable, aluminum', inStock: true },
    { id: 8, name: 'Webcam HD', price: 4500, category: 'Electronics', description: '1080p, built-in mic', inStock: true }
];

const BUSINESS_HOURS = {
    monday: '8:00 AM - 6:00 PM',
    tuesday: '8:00 AM - 6:00 PM',
    wednesday: '8:00 AM - 6:00 PM',
    thursday: '8:00 AM - 6:00 PM',
    friday: '8:00 AM - 8:00 PM',
    saturday: '9:00 AM - 5:00 PM',
    sunday: 'Closed'
};

const PAYMENT_METHODS = [
    'M-Pesa',
    'Bank Transfer',
    'Cash on Delivery'
];

// STATE
let currentQR = null;
let sock = null;
let botReady = false;
let connectionStatus = 'initializing';
const customerSessions = {};

function getSession(jid) {
    if (!customerSessions[jid]) {
        customerSessions[jid] = {
            cart: [],
            lastActivity: Date.now(),
            awaiting: null,
            orderHistory: []
        };
    }
    return customerSessions[jid];
}

function formatPrice(price) {
    return CURRENCY + ' ' + price.toLocaleString();
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

// RESPONSE BUILDERS
function buildWelcome() {
    return getGreeting() + '!\n\nWelcome to ' + SHOP_NAME + '\n\nI can help you:\n' +
           '- Browse products (ask "what do you sell")\n' +
           '- Check prices (ask "how much is [product]")\n' +
           '- Place orders (say "I want [product]")\n' +
           '- Get info (ask "business hours" or "delivery")\n\n' +
           'What would you like to do?';
}

function buildProducts() {
    let msg = 'Our Products:\n\n';
    PRODUCTS.forEach(p => {
        const stock = p.inStock ? 'Yes' : 'No';
        msg += p.id + '. ' + p.name + '\n';
        msg += '   Price: ' + formatPrice(p.price) + '\n';
        msg += '   Category: ' + p.category + '\n';
        msg += '   ' + p.description + '\n';
        msg += '   In Stock: ' + stock + '\n\n';
    });
    msg += 'To order, say "I want [product name]" or "buy [number]"';
    return msg;
}

function buildProductDetails(nameOrId) {
    const id = parseInt(nameOrId);
    let p;

    if (!isNaN(id)) {
        p = PRODUCTS.find(x => x.id === id);
    } else {
        const search = nameOrId.toLowerCase();
        p = PRODUCTS.find(x => x.name.toLowerCase().includes(search));
    }

    if (!p) return 'Sorry, I could not find "' + nameOrId + '".\n\nAsk "what do you sell" to see our products.';

    let msg = p.name + '\n\n';
    msg += 'Price: ' + formatPrice(p.price) + '\n';
    msg += 'Category: ' + p.category + '\n';
    msg += p.description + '\n';
    msg += 'In Stock: ' + (p.inStock ? 'Yes' : 'No') + '\n\n';
    msg += 'To buy, say "I want ' + p.name + '"';
    return msg;
}

function buildSearch(term) {
    const results = PRODUCTS.filter(p => 
        p.name.toLowerCase().includes(term) || 
        p.description.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term)
    );

    if (results.length === 0) return 'No products found for "' + term + '".';

    let msg = 'Search results for "' + term + '":\n\n';
    results.forEach(p => {
        msg += p.id + '. ' + p.name + ' - ' + formatPrice(p.price) + '\n';
    });
    return msg;
}

function buildCart(session) {
    if (!session.cart || session.cart.length === 0) {
        return 'Your cart is empty.\n\nBrowse products by asking "what do you sell"';
    }

    let total = 0;
    let msg = 'Your Cart:\n\n';
    session.cart.forEach((item, i) => {
        const product = PRODUCTS.find(p => p.id === item.id);
        const subtotal = product.price * item.qty;
        total += subtotal;
        msg += (i + 1) + '. ' + product.name + '\n';
        msg += '   ' + item.qty + ' x ' + formatPrice(product.price) + ' = ' + formatPrice(subtotal) + '\n';
    });
    msg += '\nTotal: ' + formatPrice(total) + '\n\n';
    msg += 'Say "checkout" to place your order';
    return msg;
}

function addToCart(input, session) {
    let product;
    let qty = 1;

    // Try ID match first
    const idMatch = input.match(/^(\d+)/);
    if (idMatch) {
        const id = parseInt(idMatch[1]);
        product = PRODUCTS.find(p => p.id === id);
        const qtyMatch = input.match(/\d+\s+(\d+)/);
        if (qtyMatch) qty = parseInt(qtyMatch[1]);
    } else {
        // Search by name
        const search = input.toLowerCase();
        product = PRODUCTS.find(p => p.name.toLowerCase().includes(search));
    }

    if (!product) return 'Sorry, I could not find "' + input + '".';
    if (!product.inStock) return 'Sorry, ' + product.name + ' is out of stock.';

    const existing = session.cart.find(item => item.id === product.id);
    if (existing) {
        existing.qty += qty;
    } else {
        session.cart.push({ id: product.id, qty });
    }

    return 'Added ' + qty + ' x ' + product.name + ' to your cart!\n\n' +
           'Say "view cart" to see items, or "checkout" to order.';
}

function removeFromCart(input, session) {
    const index = parseInt(input) - 1;
    if (isNaN(index) || index < 0 || index >= session.cart.length) {
        return 'Invalid item number. Say "view cart" to see your items.';
    }
    const removed = session.cart.splice(index, 1)[0];
    const product = PRODUCTS.find(p => p.id === removed.id);
    return 'Removed ' + product.name + ' from cart.';
}

function doCheckout(session) {
    if (!session.cart || session.cart.length === 0) {
        return 'Your cart is empty.';
    }

    let total = 0;
    let orderDetails = '';
    session.cart.forEach(item => {
        const product = PRODUCTS.find(p => p.id === item.id);
        const subtotal = product.price * item.qty;
        total += subtotal;
        orderDetails += product.name + ' x ' + item.qty + ' = ' + formatPrice(subtotal) + '\n';
    });

    const orderId = 'ORD-' + Date.now().toString().slice(-6);
    session.orderHistory.push({ id: orderId, items: [...session.cart], total, date: new Date() });
    session.cart = [];

    let msg = 'Order Placed Successfully!\n\n';
    msg += 'Order ID: ' + orderId + '\n';
    msg += 'Total: ' + formatPrice(total) + '\n\n';
    msg += 'Items:\n' + orderDetails + '\n';
    msg += 'Payment Options:\n' + PAYMENT_METHODS.join('\n') + '\n\n';
    msg += 'Send payment confirmation to +' + OWNER_NUMBER;
    return msg;
}

function buildHours() {
    let msg = 'Business Hours:\n\n';
    Object.entries(BUSINESS_HOURS).forEach(([day, hours]) => {
        msg += day.charAt(0).toUpperCase() + day.slice(1) + ': ' + hours + '\n';
    });
    return msg;
}

function buildDelivery() {
    return 'Delivery Information:\n\n' +
           'We deliver within Nairobi for KES 200\n' +
           'Outside Nairobi: KES 500\n\n' +
           'Delivery time: 1-3 business days\n' +
           'Same-day delivery for orders before 2 PM';
}

function buildPayment() {
    return 'Payment Methods:\n\n' + PAYMENT_METHODS.join('\n') + '\n\n' +
           'After payment, send confirmation to this number.';
}

function buildContact() {
    return 'Contact Us:\n\n' +
           'Phone/WhatsApp: +' + OWNER_NUMBER + '\n' +
           'Location: Nairobi, Kenya\n\n' +
           'Say "I need help" to speak with a person.';
}

function buildFAQ() {
    return 'Frequently Asked Questions:\n\n' +
           'Q: How long does delivery take?\n' +
           'A: 1-3 days in Nairobi\n\n' +
           'Q: Can I return items?\n' +
           'A: Yes, within 7 days with receipt\n\n' +
           'Q: Do you offer warranties?\n' +
           'A: Yes, 6 months on electronics\n\n' +
           'Q: Minimum order amount?\n' +
           'A: No minimum!';
}

function buildHelp() {
    return 'How to Use This Shop:\n\n' +
           'Just chat naturally! Examples:\n\n' +
           'Shopping:\n' +
           '- "what do you sell"\n' +
           '- "how much is power bank"\n' +
           '- "I want to buy earbuds"\n' +
           '- "add phone case to cart"\n' +
           '- "view my cart"\n' +
           '- "checkout"\n\n' +
           'Info:\n' +
           '- "business hours"\n' +
           '- "do you deliver"\n' +
           '- "payment options"\n\n' +
           'Support:\n' +
           '- "faq"\n' +
           '- "I need help" (human)';
}

// MESSAGE PROCESSOR
function processMessage(text, session) {
    text = text.trim().toLowerCase();

    // Greetings
    if (/^(hi|hello|hey|hola|yo|good morning|good afternoon|good evening|howdy)/.test(text)) {
        return buildWelcome();
    }

    // Help
    if (/^(help|menu|commands|how to|how do i|what can you do)/.test(text)) {
        return buildHelp();
    }

    // Products
    if (/(what do you sell|show me products|what products|catalog|list products|what do you have|what's available|show everything)/.test(text)) {
        return buildProducts();
    }

    // Categories
    if (/(categories|types of products|what categories|sections)/.test(text)) {
        let msg = 'Categories:\n\n';
        const cats = [...new Set(PRODUCTS.map(p => p.category))];
        cats.forEach((cat, i) => {
            const count = PRODUCTS.filter(p => p.category === cat).length;
            msg += (i + 1) + '. ' + cat + ' (' + count + ' items)\n';
        });
        return msg;
    }

    // Search
    const searchMatch = text.match(/(?:search|find|look for|do you have|got any)\s+(.+)/);
    if (searchMatch) {
        return buildSearch(searchMatch[1].trim());
    }

    // Product details
    const detailMatch = text.match(/(?:tell me about|details on|info about|what is|describe)\s+(.+)/);
    if (detailMatch) {
        return buildProductDetails(detailMatch[1].trim());
    }

    // Price check
    const priceMatch = text.match(/(?:how much is|what's the price of|price of|cost of|how much for)\s+(.+)/);
    if (priceMatch) {
        return buildProductDetails(priceMatch[1].trim());
    }

    // Add to cart
    const buyPatterns = [
        /^(?:i want|i'd like|give me|add|buy|purchase|get)\s+(.+)/,
        /^(?:add\s+)(\d+)\s+(?:of\s+)?(.+)/,
        /^(?:i want)\s+(\d+)\s+(?:pieces?|units?|qty|of)\s+(.+)/
    ];

    for (const pattern of buyPatterns) {
        const match = text.match(pattern);
        if (match) {
            if (match[2]) {
                return addToCart(match[1] + ' ' + match[2], session);
            }
            return addToCart(match[1], session);
        }
    }

    // View cart
    if (/(view cart|show cart|my cart|what's in my cart|cart items)/.test(text)) {
        return buildCart(session);
    }

    // Remove from cart
    const removeMatch = text.match(/(?:remove|delete|take out)\s+(?:item\s+)?(\d+|.+)/);
    if (removeMatch) {
        return removeFromCart(removeMatch[1], session);
    }

    // Checkout
    if (/(checkout|place order|complete order|pay|i'm ready|finish order)/.test(text)) {
        return doCheckout(session);
    }

    // Business hours
    if (/(business hours|opening hours|when are you open|what time|hours of operation|are you open)/.test(text)) {
        return buildHours();
    }

    // Location
    if (/(where are you|location|address|where is the shop|how to find you|directions)/.test(text)) {
        return 'Our Location:\n\nNairobi, Kenya\n\nWe offer delivery services. Ask "do you deliver" for details.';
    }

    // Delivery
    if (/(delivery|shipping|do you deliver|deliver to|send to|courier)/.test(text)) {
        return buildDelivery();
    }

    // Payment
    if (/(payment|how do i pay|pay with|mpesa|bank transfer|cash|payment methods)/.test(text)) {
        return buildPayment();
    }

    // Contact
    if (/(contact|phone|call|reach you|whatsapp|how to contact)/.test(text)) {
        return buildContact();
    }

    // FAQ
    if (/(faq|frequently asked|common questions|questions)/.test(text)) {
        return buildFAQ();
    }

    // Track order
    const trackMatch = text.match(/(?:track|status of|where is my|check)\s+(?:order\s+)?(ord-\d+|\d+)/i);
    if (trackMatch) {
        return 'Order Tracking: ' + trackMatch[1].toUpperCase() + '\n\n' +
               'Status: Out for Delivery\n' +
               'Estimated: Today by 6 PM';
    }

    // Human support
    if (/(human|person|real person|agent|representative|i need help|speak to someone|talk to someone|support)/.test(text)) {
        return 'Connecting to Human Support:\n\n' +
               'A representative will contact you shortly.\n\n' +
               'For urgent matters, call: +' + OWNER_NUMBER;
    }

    // Thanks
    if (/(thank|thanks|asante|shukran|grateful)/.test(text)) {
        return 'You are very welcome!\n\n' +
               'Thanks for choosing ' + SHOP_NAME + '. Have a great day!\n\n' +
               'Feel free to message anytime for more shopping.';
    }

    // Goodbye
    if (/(bye|goodbye|see you|later|talk soon|have a good one)/.test(text)) {
        return 'Goodbye! Thanks for visiting ' + SHOP_NAME + '.\n\n' +
               'We are here whenever you need us. Have a wonderful day!';
    }

    // Fallback
    return 'I am not sure I understood that.\n\n' +
           'I can help you with:\n' +
           '- Shopping: "what do you sell"\n' +
           '- Prices: "how much is [product]"\n' +
           '- Delivery: "do you deliver"\n' +
           '- Help: "I need help"\n\n' +
           'Or type "help" to see all options.';
}

// WHATSAPP CONNECTION
async function startBot() {
    console.log('Starting ' + SHOP_NAME + ' Bot...');
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
            console.log('QR CODE READY');
        }
        if (connection === 'close') {
            botReady = false;
            currentQR = null;
            connectionStatus = 'disconnected';
            setTimeout(startBot, 5000);
        }
        if (connection === 'open') {
            console.log('BOT CONNECTED!');
            console.log('Number:', sock.user.id.split(':')[0]);
            botReady = true;
            currentQR = null;
            connectionStatus = 'connected';
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const text = msg.message?.conversation || 
                        msg.message?.extendedTextMessage?.text || '';
            const from = msg.key.remoteJid;
            const sender = msg.pushName || 'Customer';

            console.log(sender + ': ' + text);

            const session = getSession(from);
            const reply = processMessage(text, session);

            if (reply) {
                await sock.sendMessage(from, { text: reply });
                console.log('Replied: ' + reply.slice(0, 60));
            }
        }
    });
}

// SIMPLE FRONTEND
app.get('/', async (req, res) => {
    let qrHtml = '';

    if (currentQR) {
        try {
            const qrDataUrl = await QRCode.toDataURL(currentQR, { 
                width: 300, margin: 2,
                color: { dark: '#000000', light: '#ffffff' }
            });
            qrHtml = '<div style="background:#f8f9fa;padding:30px;border-radius:16px;margin:20px 0;">' +
                     '<h2>Scan QR Code with WhatsApp</h2>' +
                     '<img src="' + qrDataUrl + '" style="width:280px;border-radius:12px;background:white;padding:15px;">' +
                     '<p>Open WhatsApp > Settings > Linked Devices > Link a Device</p>' +
                     '<button onclick="location.reload()" style="padding:14px 35px;border-radius:50px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;cursor:pointer;font-size:16px;">Refresh QR</button>' +
                     '</div>';
        } catch (err) { console.error('QR error:', err); }
    } else if (botReady) {
        qrHtml = '<div style="background:#d4edda;padding:30px;border-radius:16px;margin:20px 0;color:#155724;">' +
                 '<h2>Bot Connected!</h2>' +
                 '<p>Your shop assistant is live.</p>' +
                 '<p><strong>WhatsApp: +' + OWNER_NUMBER + '</strong></p>' +
                 '<p>Location: Nairobi, Kenya</p>' +
                 '</div>';
    } else {
        qrHtml = '<div style="background:#fff3cd;padding:30px;border-radius:16px;margin:20px 0;color:#856404;">' +
                 '<h2>Connecting...</h2>' +
                 '<p>Please wait while the bot initializes.</p>' +
                 '<button onclick="location.reload()" style="padding:14px 35px;border-radius:50px;background:#e9ecef;color:#495057;border:none;cursor:pointer;font-size:16px;">Refresh</button>' +
                 '</div>';
    }

    res.send('<!DOCTYPE html>' +
             '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
             '<title>' + SHOP_NAME + '</title>' +
             '<style>' +
             'body{font-family:Arial,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;justify-content:center;align-items:center;padding:20px;margin:0;}' +
             '.container{background:white;border-radius:24px;padding:40px;max-width:500px;width:100%;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.25);}' +
             'h1{color:#1a1a2e;font-size:26px;margin-bottom:5px;}' +
             '.tagline{color:#888;font-size:14px;margin-bottom:20px;}' +
             '.footer{margin-top:25px;padding-top:20px;border-top:1px solid #e9ecef;color:#888;font-size:12px;}' +
             '</style></head><body>' +
             '<div class="container">' +
             '<div style="font-size:60px;margin-bottom:10px;">🏪</div>' +
             '<h1>' + SHOP_NAME + '</h1>' +
             '<p class="tagline">' + SHOP_NAME + ' - WhatsApp Shop</p>' +
             qrHtml +
             '<div class="footer">' +
             '<p>' + SHOP_NAME + ' - Conversational Commerce</p>' +
             '<p>Built with Baileys</p>' +
             '</div></div></body></html>');
});

app.get('/api/status', (req, res) => {
    res.json({ status: connectionStatus, botReady, owner: OWNER_NUMBER, shop: SHOP_NAME });
});

app.get('/health', (req, res) => res.json({ status: 'ok', botReady }));

app.listen(PORT, () => {
    console.log('Server on port ' + PORT);
    console.log('URL: https://your-url.onrender.com');
    startBot();
});
