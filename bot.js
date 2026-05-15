const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// SHOP CONFIGURATION
// ============================================

const SHOP_NAME = "🏪 Billy's Shop";
const SHOP_TAGLINE = 'Quality products at great prices!';
const OWNER_NUMBER = '254114245222';
const CURRENCY = 'KES';

const BUSINESS_HOURS = {
    monday: '8:00 AM - 6:00 PM',
    tuesday: '8:00 AM - 6:00 PM',
    wednesday: '8:00 AM - 6:00 PM',
    thursday: '8:00 AM - 6:00 PM',
    friday: '8:00 AM - 8:00 PM',
    saturday: '9:00 AM - 5:00 PM',
    sunday: 'Closed'
};

const SHOP_LOCATION = 'Nairobi, Kenya';
const DELIVERY_INFO = 'We deliver within Nairobi for KES 200. Outside Nairobi KES 500.';

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

const PAYMENT_METHODS = ['💳 M-Pesa', '💳 Bank Transfer', '💳 Cash on Delivery'];

// ============================================
// BOT STATE
// ============================================

let currentQR = null;
let sock = null;
let botReady = false;
let connectionStatus = 'initializing';
const customerSessions = {};

// ============================================
// HELPERS
// ============================================

function getSession(jid) {
    if (!customerSessions[jid]) {
        customerSessions[jid] = {
            cart: [],
            lastActivity: Date.now(),
            awaiting: null,
            orderHistory: [],
            context: null
        };
    }
    return customerSessions[jid];
}

function formatPrice(price) {
    return `${CURRENCY} ${price.toLocaleString()}`;
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

// ============================================
// RESPONSES
// ============================================

function getWelcome() {
    return `👋 *${getGreeting()}!*

` +
           `Welcome to *${SHOP_NAME}* 🎉
` +
           `${SHOP_TAGLINE}

` +
           `I can help you:
` +
           `• 🛍️ *Browse products* - just ask "what do you sell?"
` +
           `• 💰 *Check prices* - ask "how much is [product]?"
` +
           `• 🛒 *Place orders* - say "I want to buy [product]"
` +
           `• 📦 *Delivery info* - ask "do you deliver?"
` +
           `• 💬 *Talk to human* - say "I need help"

` +
           `What would you like to do today?`;
}

function getProducts() {
    let msg = `*📦 Our Products*

`;
    PRODUCTS.forEach(p => {
        const stock = p.inStock ? '✅' : '❌';
        msg += `${stock} *${p.id}.* ${p.name}
   💰 ${formatPrice(p.price)} | ${p.category}
   ${p.description}

`;
    });
    msg += `To order, just say *"I want [product name]"* or *"buy [number]"*
`;
    msg += `For details, ask *"tell me about [product]"*`;
    return msg;
}

function getProductDetails(nameOrId) {
    const id = parseInt(nameOrId);
    let p;

    if (!isNaN(id)) {
        p = PRODUCTS.find(x => x.id === id);
    } else {
        const search = nameOrId.toLowerCase();
        p = PRODUCTS.find(x => x.name.toLowerCase().includes(search));
    }

    if (!p) return `❌ I couldn't find "${nameOrId}".

Ask me *"what do you sell?"* to see our products.`;

    return `*📱 ${p.name}*

` +
           `💰 Price: *${formatPrice(p.price)}*
` +
           `📂 Category: ${p.category}
` +
           `📝 ${p.description}
` +
           `${p.inStock ? '✅ In Stock' : '❌ Out of Stock'}

` +
           `To buy this, just say *"I want ${p.name}"* or *"add ${p.id} to cart"*`;
}

function getCategories() {
    const cats = [...new Set(PRODUCTS.map(p => p.category))];
    let msg = `*📂 Categories*

`;
    cats.forEach((cat, i) => {
        const items = PRODUCTS.filter(p => p.category === cat);
        msg += `${i + 1}. *${cat}* (${items.length} items)
`;
        items.slice(0, 3).forEach(p => msg += `   • ${p.name} - ${formatPrice(p.price)}
`);
        if (items.length > 3) msg += `   • ...and ${items.length - 3} more
`;
        msg += `
`;
    });
    return msg;
}

function searchProducts(term) {
    const results = PRODUCTS.filter(p => 
        p.name.toLowerCase().includes(term) || 
        p.description.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term)
    );

    if (results.length === 0) return `❌ No products found for "${term}".

Ask *"what do you sell?"* to see everything.`;

    let msg = `*🔍 Results for "${term}"*

`;
    results.forEach(p => {
        msg += `*${p.id}.* ${p.name} - ${formatPrice(p.price)}
`;
    });
    msg += `
To buy, say *"I want [product name]"*`;
    return msg;
}

function getCart(session) {
    if (!session.cart || session.cart.length === 0) {
        return `🛒 *Your cart is empty*

Browse products by asking *"what do you sell?"*
Or search with *"show me [product]"*`;
    }

    let total = 0;
    let msg = `🛒 *Your Cart*

`;
    session.cart.forEach((item, i) => {
        const product = PRODUCTS.find(p => p.id === item.id);
        const subtotal = product.price * item.qty;
        total += subtotal;
        msg += `${i + 1}. ${product.name}
   ${item.qty} × ${formatPrice(product.price)} = ${formatPrice(subtotal)}
`;
    });
    msg += `
*Total: ${formatPrice(total)}*

`;
    msg += `Say *"checkout"* or *"place order"* to complete your purchase`;
    return msg;
}

function addToCart(input, session) {
    // Try to find product by name or ID
    let product;
    let qty = 1;

    // Check if input starts with a number (ID)
    const idMatch = input.match(/^(\d+)/);
    if (idMatch) {
        const id = parseInt(idMatch[1]);
        product = PRODUCTS.find(p => p.id === id);
        // Check for quantity after ID
        const qtyMatch = input.match(/\d+\s+(\d+)/);
        if (qtyMatch) qty = parseInt(qtyMatch[1]);
    } else {
        // Search by name
        const search = input.toLowerCase();
        product = PRODUCTS.find(p => p.name.toLowerCase().includes(search));
    }

    if (!product) return `❌ I couldn't find "${input}".

Ask *"what do you sell?"* to see our products.`;
    if (!product.inStock) return `❌ Sorry, ${product.name} is currently out of stock.`;

    const existing = session.cart.find(item => item.id === product.id);
    if (existing) {
        existing.qty += qty;
    } else {
        session.cart.push({ id: product.id, qty });
    }

    return `✅ Added ${qty} × ${product.name} to your cart!

` +
           `Say *"view cart"* to see your items, or *"checkout"* to order.`;
}

function removeFromCart(input, session) {
    const index = parseInt(input) - 1;
    if (isNaN(index) || index < 0 || index >= session.cart.length) {
        return `❌ Invalid item number. Say *"view cart"* to see your items.`;
    }
    const removed = session.cart.splice(index, 1)[0];
    const product = PRODUCTS.find(p => p.id === removed.id);
    return `🗑️ Removed ${product.name} from cart.

Say *"view cart"* to see updated cart.`;
}

function checkout(session) {
    if (!session.cart || session.cart.length === 0) {
        return `❌ Your cart is empty.

Browse products by asking *"what do you sell?"*`;
    }

    let total = 0;
    let orderDetails = '';
    session.cart.forEach(item => {
        const product = PRODUCTS.find(p => p.id === item.id);
        const subtotal = product.price * item.qty;
        total += subtotal;
        orderDetails += `${product.name} × ${item.qty} = ${formatPrice(subtotal)}
`;
    });

    const orderId = 'ORD-' + Date.now().toString().slice(-6);
    session.orderHistory.push({ id: orderId, items: [...session.cart], total, date: new Date() });
    session.cart = [];

    return `🎉 *Order Placed Successfully!*

` +
           `*Order ID:* ${orderId}
` +
           `*Total:* ${formatPrice(total)}

` +
           `*Items:*
${orderDetails}
` +
           `*Payment Options:*
${PAYMENT_METHODS.join('
')}

` +
           `Please send payment confirmation to +${OWNER_NUMBER}
` +
           `Track with *"track ${orderId}"*`;
}

function getHours() {
    let msg = `*🕐 Business Hours*

`;
    Object.entries(BUSINESS_HOURS).forEach(([day, hours]) => {
        msg += `*${day.charAt(0).toUpperCase() + day.slice(1)}:* ${hours}
`;
    });
    return msg;
}

function getLocation() {
    return `*📍 Our Location*

${SHOP_LOCATION}

We offer delivery services. Ask *"do you deliver?"* for details.`;
}

function getDelivery() {
    return `*🚚 Delivery Information*

${DELIVERY_INFO}

` +
           `Delivery time: 1-3 business days within Nairobi.
` +
           `Same-day delivery available for orders before 2 PM.

` +
           `Ask *"how much is delivery to [area]?"* for specific rates.`;
}

function getPayment() {
    return `*💳 Payment Methods*

${PAYMENT_METHODS.join('
')}

` +
           `After payment, send confirmation screenshot to this number.
` +
           `Your order will be processed within 24 hours.`;
}

function getContact() {
    return `*📞 Contact Us*

` +
           `Phone/WhatsApp: +${OWNER_NUMBER}
` +
           `Location: ${SHOP_LOCATION}

` +
           `Business Hours: ${BUSINESS_HOURS.monday}

` +
           `Say *"I need help"* to speak with a real person.`;
}

function getFAQ() {
    return `*❓ Frequently Asked Questions*

` +
           `*Q: How long does delivery take?*
A: 1-3 days in Nairobi

` +
           `*Q: Can I return items?*
A: Yes, within 7 days with receipt

` +
           `*Q: Do you offer warranties?*
A: Yes, 6 months on electronics

` +
           `*Q: Minimum order amount?*
A: No minimum!

` +
           `Say *"I need help"* for more assistance.`;
}

function getHuman() {
    return `👨‍💼 *Connecting to Human Support*

` +
           `A representative will contact you shortly.

` +
           `For urgent matters, call: +${OWNER_NUMBER}

` +
           `Please describe your issue while you wait.`;
}

function getHelp() {
    return `*🤖 How to Use This Shop*

` +
           `Just chat naturally! Here are examples:

` +
           `🛍️ *Shopping:*
` +
           `• "what do you sell?"
` +
           `• "show me electronics"
` +
           `• "how much is power bank?"
` +
           `• "I want to buy earbuds"
` +
           `• "add phone case to cart"
` +
           `• "view my cart"
` +
           `• "checkout" or "place order"

` +
           `📋 *Info:*
` +
           `• "business hours"
` +
           `• "where are you located?"
` +
           `• "do you deliver?"
` +
           `• "payment options"

` +
           `❓ *Support:*
` +
           `• "faq"
` +
           `• "track ORD-123456"
` +
           `• "I need help" (human)`;
}

// ============================================
// MESSAGE PROCESSOR - CONVERSATIONAL
// ============================================

function processMessage(text, session) {
    text = text.trim().toLowerCase();

    // Greetings
    if (/^(hi|hello|hey|hola|yo|good morning|good afternoon|good evening|howdy)/.test(text)) {
        return getWelcome();
    }

    // Help
    if (/^(help|menu|commands|how to|how do i|what can you do|show me help)/.test(text)) {
        return getHelp();
    }

    // Products / Catalog
    if (/(what do you sell|show me products|what products|catalog|list products|what do you have|what's available|show everything)/.test(text)) {
        return getProducts();
    }

    // Categories
    if (/(categories|types of products|what categories|sections)/.test(text)) {
        return getCategories();
    }

    // Search
    const searchMatch = text.match(/(?:search|find|look for|do you have|got any)\s+(.+)/);
    if (searchMatch) {
        return searchProducts(searchMatch[1].trim());
    }

    // Product details
    const detailMatch = text.match(/(?:tell me about|details on|info about|what is|describe)\s+(.+)/);
    if (detailMatch) {
        return getProductDetails(detailMatch[1].trim());
    }

    // Price check
    const priceMatch = text.match(/(?:how much is|what's the price of|price of|cost of|how much for)\s+(.+)/);
    if (priceMatch) {
        return getProductDetails(priceMatch[1].trim());
    }

    // Add to cart - various ways
    const buyPatterns = [
        /^(?:i want|i'd like|give me|add|buy|purchase|get)\s+(.+)/,
        /^(?:add\s+)(\d+)\s+(?:of\s+)?(.+)/,
        /^(?:i want)\s+(\d+)\s+(?:pieces?|units?|qty|of)\s+(.+)/
    ];

    for (const pattern of buyPatterns) {
        const match = text.match(pattern);
        if (match) {
            // If matched "add 2 power bank"
            if (match[2]) {
                return addToCart(`${match[1]} ${match[2]}`, session);
            }
            return addToCart(match[1], session);
        }
    }

    // View cart
    if (/(view cart|show cart|my cart|what's in my cart|cart items)/.test(text)) {
        return getCart(session);
    }

    // Remove from cart
    const removeMatch = text.match(/(?:remove|delete|take out)\s+(?:item\s+)?(\d+|.+)/);
    if (removeMatch) {
        return removeFromCart(removeMatch[1], session);
    }

    // Checkout
    if (/(checkout|place order|complete order|pay|i'm ready|finish order)/.test(text)) {
        return checkout(session);
    }

    // Business hours
    if (/(business hours|opening hours|when are you open|what time|hours of operation|are you open)/.test(text)) {
        return getHours();
    }

    // Location
    if (/(where are you|location|address|where is the shop|how to find you|directions)/.test(text)) {
        return getLocation();
    }

    // Delivery
    if (/(delivery|shipping|do you deliver|deliver to|send to|courier)/.test(text)) {
        return getDelivery();
    }

    // Payment
    if (/(payment|how do i pay|pay with|mpesa|bank transfer|cash|payment methods)/.test(text)) {
        return getPayment();
    }

    // Contact
    if (/(contact|phone|call|reach you|whatsapp|how to contact)/.test(text)) {
        return getContact();
    }

    // FAQ
    if (/(faq|frequently asked|common questions|questions)/.test(text)) {
        return getFAQ();
    }

    // Track order
    const trackMatch = text.match(/(?:track|status of|where is my|check)\s+(?:order\s+)?(ord-\d+|\d+)/i);
    if (trackMatch) {
        return `📦 *Order Tracking: ${trackMatch[1].toUpperCase()}*

` +
               `Status: 🚚 Out for Delivery
` +
               `Estimated: Today by 6 PM

` +
               `Updates will be sent to this number.`;
    }

    // Human support
    if (/(human|person|real person|agent|representative|i need help|speak to someone|talk to someone|support)/.test(text)) {
        return getHuman();
    }

    // Thanks
    if (/(thank|thanks|asante|shukran|grateful)/.test(text)) {
        return `🙏 You're very welcome!

` +
               `Thanks for choosing ${SHOP_NAME}. Have a great day!

` +
               `Feel free to message anytime for more shopping. 🛍️`;
    }

    // Goodbye
    if (/(bye|goodbye|see you|later|talk soon|have a good one)/.test(text)) {
        return `👋 Goodbye! Thanks for visiting ${SHOP_NAME}.

` +
               `We're here whenever you need us. Have a wonderful day! 🎉`;
    }

    // Fallback - try to be helpful
    return `🤔 I'm not sure I understood that.

` +
           `I can help you with:
` +
           `• 🛍️ *Shopping* - "what do you sell?"
` +
           `• 💰 *Prices* - "how much is [product]?"
` +
           `• 📦 *Delivery* - "do you deliver?"
` +
           `• ❓ *Help* - "I need help"

` +
           `Or type *"help"* to see all options.`;
}

// ============================================
// WHATSAPP CONNECTION
// ============================================

async function startBot() {
    console.log('🚀 Starting ' + SHOP_NAME + ' Bot...');
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
            console.log('
📲 QR CODE READY
');
        }
        if (connection === 'close') {
            botReady = false;
            currentQR = null;
            connectionStatus = 'disconnected';
            setTimeout(startBot, 5000);
        }
        if (connection === 'open') {
            console.log('
✅ BOT CONNECTED!');
            console.log('📱 Number:', sock.user.id.split(':')[0]);
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

            console.log(`
📩 ${sender}: ${text}`);

            const session = getSession(from);
            const reply = processMessage(text, session);

            if (reply) {
                await sock.sendMessage(from, { text: reply });
                console.log(`✅ Replied: ${reply.slice(0, 60)}...`);
            }
        }
    });
}

// ============================================
// FRONTEND
// ============================================

const getHomePage = (qrDataUrl, status) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${SHOP_NAME} - WhatsApp Shop</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
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
        .shop-icon { font-size: 60px; margin-bottom: 10px; }
        h1 { color: #1a1a2e; font-size: 26px; margin-bottom: 5px; }
        .tagline { color: #888; font-size: 14px; margin-bottom: 20px; }
        .status-badge {
            display: inline-block;
            padding: 8px 20px;
            border-radius: 50px;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 25px;
        }
        .status-connected { background: #d4edda; color: #155724; }
        .status-connecting { background: #fff3cd; color: #856404; }
        .status-qr { background: #cce5ff; color: #004085; }
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
        .info-box {
            text-align: left;
            background: #f8f9fa;
            border-radius: 16px;
            padding: 25px;
            margin-bottom: 20px;
        }
        .info-box h3 { color: #1a1a2e; margin-bottom: 15px; font-size: 16px; }
        .info-box ol { padding-left: 20px; color: #555; }
        .info-box li { margin: 8px 0; line-height: 1.5; }
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
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3); }
        .btn-secondary {
            background: #e9ecef;
            color: #495057;
            margin-left: 10px;
        }
        .products-preview {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin: 20px 0;
        }
        .product-card {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 12px;
            text-align: left;
        }
        .product-card h4 { font-size: 14px; color: #1a1a2e; margin-bottom: 5px; }
        .product-card p { font-size: 12px; color: #667eea; font-weight: bold; }
        .footer {
            margin-top: 25px;
            padding-top: 20px;
            border-top: 1px solid #e9ecef;
            color: #888;
            font-size: 12px;
        }
        .chat-example {
            background: #e8f5e9;
            border-radius: 12px;
            padding: 15px;
            margin: 15px 0;
            text-align: left;
        }
        .chat-example p { color: #2e7d32; font-size: 13px; margin: 5px 0; }
        @media (max-width: 480px) {
            .container { padding: 25px; }
            h1 { font-size: 22px; }
            .products-preview { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="shop-icon">🏪</div>
        <h1>${SHOP_NAME}</h1>
        <p class="tagline">${SHOP_TAGLINE}</p>

        ${status === 'connected' ? `
        <span class="status-badge status-connected">● Online</span>

        <div class="info-box">
            <h3>✅ Bot Connected!</h3>
            <p style="color: #155724; margin-bottom: 15px;">Your shop assistant is live and ready to take orders.</p>
            <p><strong>📱 WhatsApp:</strong> +${OWNER_NUMBER}</p>
            <p><strong>📍 Location:</strong> ${SHOP_LOCATION}</p>
            <p><strong>🕐 Hours:</strong> ${BUSINESS_HOURS.monday}</p>
        </div>

        <div class="info-box">
            <h3>💬 How Customers Chat</h3>
            <div class="chat-example">
                <p><strong>Customer:</strong> hello</p>
                <p><strong>Bot:</strong> 👋 Good morning! Welcome...</p>
                <p><strong>Customer:</strong> what do you sell?</p>
                <p><strong>Bot:</strong> 📦 Our Products...</p>
                <p><strong>Customer:</strong> i want power bank</p>
                <p><strong>Bot:</strong> ✅ Added to cart!</p>
                <p><strong>Customer:</strong> checkout</p>
                <p><strong>Bot:</strong> 🎉 Order placed!</p>
            </div>
        </div>

        <div class="info-box">
            <h3>🛍️ Featured Products</h3>
            <div class="products-preview">
                <div class="product-card"><h4>Wireless Earbuds</h4><p>KES 1,500</p></div>
                <div class="product-card"><h4>Power Bank</h4><p>KES 2,500</p></div>
                <div class="product-card"><h4>Phone Case</h4><p>KES 500</p></div>
                <div class="product-card"><h4>USB-C Cable</h4><p>KES 300</p></div>
            </div>
        </div>

        <button class="btn btn-secondary" onclick="location.reload()">🔄 Refresh</button>
        ` : status === 'qr_ready' ? `
        <span class="status-badge status-qr">📲 Scan to Connect</span>

        <div class="qr-container">
            <img src="${qrDataUrl}" alt="WhatsApp QR Code">
        </div>

        <div class="info-box">
            <h3>📱 How to Connect</h3>
            <ol>
                <li>Open <strong>WhatsApp</strong> on your phone</li>
                <li>Tap <strong>⋮ → Settings → Linked Devices</strong></li>
                <li>Tap <strong>"Link a Device"</strong></li>
                <li>Point camera at the QR code above</li>
                <li>Wait for "Connected" confirmation</li>
            </ol>
        </div>

        <button class="btn btn-primary" onclick="location.reload()">🔄 Refresh QR</button>
        ` : `
        <span class="status-badge status-connecting">⏳ Initializing...</span>

        <div style="padding: 40px; color: #666;">
            <p>Please wait while the bot connects to WhatsApp...</p>
            <p style="margin-top: 15px; font-size: 14px;">This may take a few seconds</p>
        </div>

        <button class="btn btn-secondary" onclick="location.reload()">🔄 Refresh</button>
        `}

        <div class="footer">
            <p>🏪 ${SHOP_NAME} • 💬 Conversational Commerce</p>
            <p>Built with ❤️ using Baileys</p>
        </div>
    </div>
</body>
</html>
`;

app.get('/', async (req, res) => {
    let qrDataUrl = null;
    if (currentQR) {
        try {
            qrDataUrl = await QRCode.toDataURL(currentQR, { 
                width: 300, margin: 2,
                color: { dark: '#000000', light: '#ffffff' }
            });
        } catch (err) { console.error('QR error:', err); }
    }
    res.send(getHomePage(qrDataUrl, connectionStatus));
});

app.get('/api/status', (req, res) => {
    res.json({ status: connectionStatus, botReady, owner: OWNER_NUMBER, shop: SHOP_NAME });
});

app.get('/health', (req, res) => res.json({ status: 'ok', botReady }));

app.listen(PORT, () => {
    console.log(`🌐 ${SHOP_NAME} Server on port ${PORT}`);
    console.log(`📱 URL: https://your-url.onrender.com`);
    startBot();
});
