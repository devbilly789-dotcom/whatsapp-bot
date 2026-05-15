const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// SHOP CONFIGURATION
// ============================================

const SHOP_NAME = "Billy's Shop";
const OWNER_NUMBER = '254114245222';
const CURRENCY = 'KES';

// Products with discount eligibility
const PRODUCTS = [
    { id: 1, name: 'Wireless Earbuds', price: 1500, category: 'Electronics', description: 'Bluetooth 5.0, 20hr battery', inStock: true, allowDiscount: true, minPrice: 1200 },
    { id: 2, name: 'Phone Case', price: 500, category: 'Accessories', description: 'Shockproof, all models', inStock: true, allowDiscount: true, minPrice: 400 },
    { id: 3, name: 'Power Bank 20000mAh', price: 2500, category: 'Electronics', description: 'Fast charging, dual USB', inStock: true, allowDiscount: false, minPrice: 2500 },
    { id: 4, name: 'USB-C Cable', price: 300, category: 'Accessories', description: 'Braided, 2 meters', inStock: true, allowDiscount: true, minPrice: 250 },
    { id: 5, name: 'Screen Protector', price: 400, category: 'Accessories', description: 'Tempered glass', inStock: false, allowDiscount: true, minPrice: 350 },
    { id: 6, name: 'Bluetooth Speaker', price: 3500, category: 'Electronics', description: 'Waterproof, 12hr playtime', inStock: true, allowDiscount: true, minPrice: 3000 },
    { id: 7, name: 'Laptop Stand', price: 1200, category: 'Office', description: 'Adjustable, aluminum', inStock: true, allowDiscount: true, minPrice: 1000 },
    { id: 8, name: 'Webcam HD', price: 4500, category: 'Electronics', description: '1080p, built-in mic', inStock: true, allowDiscount: false, minPrice: 4500 }
];

// Discount codes
const DISCOUNT_CODES = {
    'BILLY10': { discount: 0.10, type: 'percentage', description: '10% off your order' },
    'SAVE20': { discount: 0.20, type: 'percentage', description: '20% off your order' },
    'WELCOME': { discount: 0.15, type: 'percentage', description: '15% off for new customers' },
    'FLASH50': { discount: 0.50, type: 'percentage', description: '50% flash sale (limited time)' }
};

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
            orderHistory: [],
            discountCode: null,
            bargainingProduct: null
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

// ============================================
// RESPONSE BUILDERS
// ============================================

function buildWelcome() {
    return getGreeting() + '!\n\nWelcome to ' + SHOP_NAME + '\n\nI can help you:\n' +
           '- Browse products (ask "what do you sell")\n' +
           '- Check prices (ask "how much is [product]")\n' +
           '- Get price list (say "send me pricelist")\n' +
           '- Bargain (say "can I get a discount on [product]")\n' +
           '- Place orders (say "I want [product]")\n' +
           '- Get info (ask "business hours" or "delivery")\n\n' +
           'What would you like to do?';
}

function buildProducts() {
    let msg = 'Our Products:\n\n';
    PRODUCTS.forEach(p => {
        const stock = p.inStock ? 'In Stock' : 'Out of Stock';
        const discount = p.allowDiscount ? ' (Discount available)' : '';
        msg += p.id + '. ' + p.name + '\n';
        msg += '   Price: ' + formatPrice(p.price) + discount + '\n';
        msg += '   Category: ' + p.category + '\n';
        msg += '   ' + p.description + '\n';
        msg += '   Status: ' + stock + '\n\n';
    });
    msg += 'To order, say "I want [product name]"\n';
    msg += 'For discounts, say "can you give me a discount on [product]"';
    return msg;
}

function buildPriceList() {
    let msg = '*PRICE LIST*\n';
    msg += '============\n\n';

    const categories = [...new Set(PRODUCTS.map(p => p.category))];

    categories.forEach(cat => {
        msg += cat.toUpperCase() + ':\n';
        msg += '-'.repeat(cat.length + 1) + '\n';

        PRODUCTS.filter(p => p.category === cat).forEach(p => {
            const stock = p.inStock ? '' : ' [OUT OF STOCK]';
            const discount = p.allowDiscount ? ' *' : '';
            msg += p.id + '. ' + p.name + '\n';
            msg += '   Price: ' + formatPrice(p.price) + discount + stock + '\n';
            if (p.allowDiscount) {
                msg += '   Bargain price: from ' + formatPrice(p.minPrice) + '\n';
            }
            msg += '\n';
        });
    });

    msg += '============\n';
    msg += '* = Discount/bargain available\n';
    msg += '\nFor details, ask "tell me about [product name]"\n';
    msg += 'To bargain, say "can I get [product] for [price]?"';

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
    msg += 'Status: ' + (p.inStock ? 'In Stock' : 'Out of Stock') + '\n';

    if (p.allowDiscount) {
        msg += '\n*Discount Available!*\n';
        msg += 'You can bargain from ' + formatPrice(p.minPrice) + '\n';
        msg += 'Say "can you give me a discount?"\n';
    } else {
        msg += '\n*Fixed Price* (no discounts)\n';
    }

    msg += '\nTo buy, say "I want ' + p.name + '"';
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
        const discount = p.allowDiscount ? ' *' : '';
        msg += p.id + '. ' + p.name + ' - ' + formatPrice(p.price) + discount + '\n';
    });
    msg += '\n* = Discount available';
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
        const price = item.discountedPrice || product.price;
        const subtotal = price * item.qty;
        total += subtotal;

        msg += (i + 1) + '. ' + product.name + '\n';
        if (item.discountedPrice) {
            msg += '   ~~' + formatPrice(product.price) + '~~ ' + formatPrice(item.discountedPrice) + ' (discounted)\n';
        } else {
            msg += '   ' + formatPrice(product.price) + '\n';
        }
        msg += '   Qty: ' + item.qty + ' = ' + formatPrice(subtotal) + '\n\n';
    });

    // Apply discount code if any
    let finalTotal = total;
    if (session.discountCode && DISCOUNT_CODES[session.discountCode]) {
        const discount = DISCOUNT_CODES[session.discountCode];
        const savings = Math.round(total * discount.discount);
        finalTotal = total - savings;
        msg += 'Subtotal: ' + formatPrice(total) + '\n';
        msg += 'Discount (' + session.discountCode + '): -' + formatPrice(savings) + '\n';
    }

    msg += '\n*Total: ' + formatPrice(finalTotal) + '*\n\n';
    msg += 'Say "checkout" to place your order\n';
    msg += 'Or "apply code [CODE]" for discount';

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
    if (!product.inStock) return 'Sorry, ' + product.name + ' is currently out of stock.';

    const existing = session.cart.find(item => item.id === product.id);
    if (existing) {
        existing.qty += qty;
    } else {
        session.cart.push({ id: product.id, qty, discountedPrice: null });
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

function applyDiscountCode(code, session) {
    const upperCode = code.toUpperCase();

    if (!DISCOUNT_CODES[upperCode]) {
        let msg = 'Invalid discount code.\n\n';
        msg += 'Available codes:\n';
        Object.entries(DISCOUNT_CODES).forEach(([code, info]) => {
            msg += code + ' - ' + info.description + '\n';
        });
        return msg;
    }

    session.discountCode = upperCode;
    return 'Discount code ' + upperCode + ' applied!\n' +
           DISCOUNT_CODES[upperCode].description + '\n\n' +
           'Say "view cart" to see updated total.';
}

function doCheckout(session) {
    if (!session.cart || session.cart.length === 0) {
        return 'Your cart is empty.';
    }

    let total = 0;
    let orderDetails = '';

    session.cart.forEach(item => {
        const product = PRODUCTS.find(p => p.id === item.id);
        const price = item.discountedPrice || product.price;
        const subtotal = price * item.qty;
        total += subtotal;
        orderDetails += product.name + ' x ' + item.qty + ' = ' + formatPrice(subtotal) + '\n';
    });

    // Apply discount code
    let finalTotal = total;
    let discountInfo = '';
    if (session.discountCode && DISCOUNT_CODES[session.discountCode]) {
        const discount = DISCOUNT_CODES[session.discountCode];
        const savings = Math.round(total * discount.discount);
        finalTotal = total - savings;
        discountInfo = 'Discount (' + session.discountCode + '): -' + formatPrice(savings) + '\n';
    }

    const orderId = 'ORD-' + Date.now().toString().slice(-6);
    session.orderHistory.push({ 
        id: orderId, 
        items: [...session.cart], 
        total: finalTotal, 
        originalTotal: total,
        discountCode: session.discountCode,
        date: new Date() 
    });

    // Clear cart and discount
    session.cart = [];
    session.discountCode = null;

    let msg = 'Order Placed Successfully!\n\n';
    msg += 'Order ID: ' + orderId + '\n';
    msg += 'Items:\n' + orderDetails + '\n';
    if (discountInfo) msg += discountInfo + '\n';
    msg += 'Total: ' + formatPrice(finalTotal) + '\n\n';
    msg += 'Payment Options:\n' + PAYMENT_METHODS.join('\n') + '\n\n';
    msg += 'Send payment confirmation to +' + OWNER_NUMBER;

    return msg;
}

// BARGAINING FUNCTION
function handleBargain(input, session) {
    // Extract product and offered price
    const bargainMatch = input.match(/(?:can i get|give me|sell me|how about|what about|i'll take)\s+(.+?)\s+(?:for|at)\s+(?:kes\s+)?(\d+)/i);

    if (!bargainMatch) {
        // Just asking about discount without specific price
        const productMatch = input.match(/(?:discount on|bargain for|cheaper price for|reduce price of)\s+(.+)/i);
        if (productMatch) {
            const product = findProduct(productMatch[1]);
            if (!product) return 'Sorry, I could not find that product.';
            if (!product.allowDiscount) return 'Sorry, ' + product.name + ' is already at the best price. No discounts available.';
            if (!product.inStock) return 'Sorry, ' + product.name + ' is out of stock.';

            session.bargainingProduct = product.id;
            return product.name + '\n\n' +
                   'Original price: ' + formatPrice(product.price) + '\n' +
                   'Lowest I can go: ' + formatPrice(product.minPrice) + '\n\n' +
                   'What price did you have in mind?\n' +
                   'Say something like "I will take it for ' + formatPrice(product.minPrice + 100) + '"';
        }

        return 'To bargain, say:\n' +
               '"Can I get [product] for [price]?"\n' +
               'Example: "Can I get earbuds for 1300?"';
    }

    const productName = bargainMatch[1];
    const offeredPrice = parseInt(bargainMatch[2]);
    const product = findProduct(productName);

    if (!product) return 'Sorry, I could not find "' + productName + '".';
    if (!product.allowDiscount) return 'Sorry, ' + product.name + ' is fixed at ' + formatPrice(product.price) + '. No discounts available.';
    if (!product.inStock) return 'Sorry, ' + product.name + ' is out of stock.';

    // Check if offered price is acceptable
    if (offeredPrice >= product.minPrice) {
        // Accept the offer
        const existing = session.cart.find(item => item.id === product.id);
        if (existing) {
            existing.discountedPrice = offeredPrice;
        } else {
            session.cart.push({ id: product.id, qty: 1, discountedPrice: offeredPrice });
        }

        const savings = product.price - offeredPrice;
        return 'Deal! ' + product.name + ' for ' + formatPrice(offeredPrice) + '\n' +
               'You saved ' + formatPrice(savings) + '!\n\n' +
               'Added to your cart. Say "view cart" to checkout.';
    } else {
        // Counter offer
        const counterPrice = Math.round((product.price + offeredPrice) / 2);
        session.bargainingProduct = product.id;

        return 'Hmm, ' + formatPrice(offeredPrice) + ' is too low for ' + product.name + '.\n\n' +
               'How about ' + formatPrice(counterPrice) + '?\n' +
               'Say "yes" to accept or "how about [price]" to counter.';
    }
}

function findProduct(nameOrId) {
    const id = parseInt(nameOrId);
    if (!isNaN(id)) {
        return PRODUCTS.find(x => x.id === id);
    }
    return PRODUCTS.find(p => p.name.toLowerCase().includes(nameOrId.toLowerCase()));
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
           'Q: Do you offer discounts?\n' +
           'A: Yes! Some products are negotiable. Ask "can I get a discount?"\n\n' +
           'Q: Minimum order amount?\n' +
           'A: No minimum!';
}

function buildHelp() {
    return 'How to Use This Shop:\n\n' +
           'Shopping:\n' +
           '- "what do you sell" - Browse products\n' +
           '- "send me pricelist" - Get price list\n' +
           '- "how much is power bank" - Check price\n' +
           '- "I want earbuds" - Add to cart\n' +
           '- "view cart" - See your cart\n' +
           '- "checkout" - Place order\n\n' +
           'Bargaining & Discounts:\n' +
           '- "can I get earbuds for 1300" - Bargain\n' +
           '- "any discount on phone case" - Ask discount\n' +
           '- "apply code BILLY10" - Use discount code\n\n' +
           'Info:\n' +
           '- "business hours" - Opening times\n' +
           '- "do you deliver" - Delivery info\n' +
           '- "payment options" - How to pay\n\n' +
           'Support:\n' +
           '- "faq" - Common questions\n' +
           '- "I need help" - Talk to human';
}

// ============================================
// MESSAGE PROCESSOR
// ============================================

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

    // Price list
    if (/(pricelist|price list|send me prices|all prices|catalog|price catalog)/.test(text)) {
        return buildPriceList();
    }

    // Products
    if (/(what do you sell|show me products|what products|list products|what do you have|what's available|show everything)/.test(text)) {
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

    // Bargaining
    if (/(bargain|discount|cheaper|reduce price|lower price|negotiate|best price|deal|offer)/.test(text)) {
        return handleBargain(text, session);
    }

    // Accept bargain counter
    if (/^(yes|okay|ok|deal|sure|fine|accepted)/.test(text) && session.bargainingProduct) {
        const product = PRODUCTS.find(p => p.id === session.bargainingProduct);
        session.bargainingProduct = null;
        if (product) {
            return 'Great! ' + product.name + ' has been added to your cart at the agreed price.\n\nSay "view cart" to checkout.';
        }
    }

    // Apply discount code
    const codeMatch = text.match(/(?:apply code|use code|code|promo|coupon)\s+([a-z0-9]+)/i);
    if (codeMatch) {
        return applyDiscountCode(codeMatch[1], session);
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
           '- Prices: "send me pricelist"\n' +
           '- Bargain: "can I get discount on [product]"\n' +
           '- Help: "I need help"\n\n' +
           'Or type "help" to see all options.';
}

// ============================================
// WHATSAPP CONNECTION
// ============================================

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

// ============================================
// SIMPLE FRONTEND
// ============================================

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
