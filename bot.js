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
// PRODUCT FINDER
// ============================================

function findProduct(input) {
    if (!input) return null;
    const search = input.toLowerCase().trim();

    // Try exact ID match first
    const id = parseInt(search);
    if (!isNaN(id)) {
        const byId = PRODUCTS.find(p => p.id === id);
        if (byId) return byId;
    }

    // Try exact name match
    let product = PRODUCTS.find(p => p.name.toLowerCase() === search);
    if (product) return product;

    // Try partial name match
    product = PRODUCTS.find(p => p.name.toLowerCase().includes(search));
    if (product) return product;

    // Try matching individual words
    const words = search.split(/\s+/);
    for (const word of words) {
        if (word.length < 3) continue; // Skip short words
        product = PRODUCTS.find(p => p.name.toLowerCase().includes(word));
        if (product) return product;
    }

    // Try category match
    product = PRODUCTS.find(p => p.category.toLowerCase().includes(search));
    if (product) return product;

    return null;
}

function findMultipleProducts(input) {
    const search = input.toLowerCase().trim();
    return PRODUCTS.filter(p => 
        p.name.toLowerCase().includes(search) ||
        p.category.toLowerCase().includes(search) ||
        p.description.toLowerCase().includes(search)
    );
}

// ============================================
// RESPONSE BUILDERS
// ============================================

function buildWelcome() {
    return getGreeting() + '! Welcome to ' + SHOP_NAME + '\n\n' +
           'I can help you:\n' +
           '- Browse products (say "show products")\n' +
           '- Get price list (say "pricelist")\n' +
           '- Buy directly (just type product name like "laptop stand")\n' +
           '- Bargain (say "laptop stand 900")\n' +
           '- Ask about delivery, hours, payment\n\n' +
           'What would you like?';
}

function buildProducts() {
    let msg = '*Our Products*\n\n';
    PRODUCTS.forEach(p => {
        const stock = p.inStock ? 'In Stock' : 'Out of Stock';
        const discount = p.allowDiscount ? ' *' : '';
        msg += p.id + '. ' + p.name + '\n';
        msg += '   Price: ' + formatPrice(p.price) + discount + '\n';
        msg += '   ' + p.description + '\n';
        msg += '   Status: ' + stock + '\n\n';
    });
    msg += '* = Discount available\n\n';
    msg += 'To buy, just type the product name\n';
    msg += 'Example: "laptop stand" or "i want earbuds"';
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
                msg += '   Bargain from: ' + formatPrice(p.minPrice) + '\n';
            }
            msg += '\n';
        });
    });

    msg += '============\n';
    msg += '* = Bargain available\n\n';
    msg += 'To buy, just type the product name\n';
    msg += 'To bargain, type: "[product] [price]"\n';
    msg += 'Example: "laptop stand 900" or "earbuds 1300"';

    return msg;
}

function buildProductDetails(product) {
    let msg = '*' + product.name + '*\n\n';
    msg += 'Price: ' + formatPrice(product.price) + '\n';
    msg += 'Category: ' + product.category + '\n';
    msg += product.description + '\n';
    msg += 'Status: ' + (product.inStock ? 'In Stock' : 'Out of Stock') + '\n';

    if (product.allowDiscount) {
        msg += '\n*Discount Available!*\n';
        msg += 'Bargain price from: ' + formatPrice(product.minPrice) + '\n';
        msg += 'Type: "' + product.name + ' [your price]" to bargain\n';
        msg += 'Example: "' + product.name + ' ' + (product.minPrice + 100) + '"';
    } else {
        msg += '\n*Fixed Price* (no discounts)';
    }

    msg += '\n\nTo buy now, just reply with the product name:\n';
    msg += '"' + product.name + '"';

    return msg;
}

function buildSearch(term) {
    const results = findMultipleProducts(term);

    if (results.length === 0) return 'No products found for "' + term + '".';

    let msg = 'Results for "' + term + '":\n\n';
    results.forEach(p => {
        const discount = p.allowDiscount ? ' *' : '';
        msg += p.id + '. ' + p.name + ' - ' + formatPrice(p.price) + discount + '\n';
    });
    msg += '\n* = Bargain available\n';
    msg += 'Type product name to buy or get details';
    return msg;
}

function buildCart(session) {
    if (!session.cart || session.cart.length === 0) {
        return 'Your cart is empty.\n\nBrowse products by saying "show products" or just type a product name like "laptop stand"';
    }

    let total = 0;
    let msg = '*Your Cart*\n\n';

    session.cart.forEach((item, i) => {
        const product = PRODUCTS.find(p => p.id === item.id);
        const price = item.discountedPrice || product.price;
        const subtotal = price * item.qty;
        total += subtotal;

        msg += (i + 1) + '. ' + product.name + '\n';
        if (item.discountedPrice) {
            msg += '   ~~' + formatPrice(product.price) + '~~ ' + formatPrice(item.discountedPrice) + ' (deal)\n';
        } else {
            msg += '   ' + formatPrice(product.price) + '\n';
        }
        msg += '   Qty: ' + item.qty + ' = ' + formatPrice(subtotal) + '\n\n';
    });

    let finalTotal = total;
    if (session.discountCode && DISCOUNT_CODES[session.discountCode]) {
        const discount = DISCOUNT_CODES[session.discountCode];
        const savings = Math.round(total * discount.discount);
        finalTotal = total - savings;
        msg += 'Subtotal: ' + formatPrice(total) + '\n';
        msg += 'Discount (' + session.discountCode + '): -' + formatPrice(savings) + '\n';
    }

    msg += '\n*Total: ' + formatPrice(finalTotal) + '*\n\n';
    msg += 'Say "checkout" to place order\n';
    msg += 'Or "apply code [CODE]" for discount';

    return msg;
}

function addToCart(product, qty, session, discountedPrice) {
    if (!product.inStock) return 'Sorry, ' + product.name + ' is currently out of stock.';

    const existing = session.cart.find(item => item.id === product.id);
    if (existing) {
        existing.qty += qty;
        if (discountedPrice) existing.discountedPrice = discountedPrice;
    } else {
        session.cart.push({ id: product.id, qty, discountedPrice: discountedPrice || null });
    }

    let msg = 'Added ' + qty + ' x ' + product.name;
    if (discountedPrice) {
        msg += ' at ' + formatPrice(discountedPrice) + ' (deal price)';
    }
    msg += '!\n\n';
    msg += 'Say "view cart" to see items\n';
    msg += 'Or type another product name to add more';
    return msg;
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
        return 'Your cart is empty. Type a product name to start shopping!';
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

    session.cart = [];
    session.discountCode = null;

    let msg = '*Order Placed Successfully!*\n\n';
    msg += 'Order ID: ' + orderId + '\n';
    msg += 'Items:\n' + orderDetails + '\n';
    if (discountInfo) msg += discountInfo + '\n';
    msg += '*Total: ' + formatPrice(finalTotal) + '*\n\n';
    msg += 'Payment Options:\n' + PAYMENT_METHODS.join('\n') + '\n\n';
    msg += 'Send payment confirmation to +' + OWNER_NUMBER;

    return msg;
}

// BARGAINING FUNCTION
function handleBargain(productName, offeredPrice, session) {
    const product = findProduct(productName);

    if (!product) {
        return 'Sorry, I could not find "' + productName + '".\n\n' +
               'Type "show products" to see what we have.';
    }

    if (!product.inStock) {
        return 'Sorry, ' + product.name + ' is currently out of stock.';
    }

    if (!product.allowDiscount) {
        return 'Sorry, ' + product.name + ' is fixed at ' + formatPrice(product.price) + '.\n' +
               'No discounts available on this item.';
    }

    // Check if offered price is acceptable
    if (offeredPrice >= product.minPrice) {
        // Accept the offer
        const savings = product.price - offeredPrice;
        const existing = session.cart.find(item => item.id === product.id);

        if (existing) {
            existing.discountedPrice = offeredPrice;
            existing.qty = 1;
        } else {
            session.cart.push({ id: product.id, qty: 1, discountedPrice: offeredPrice });
        }

        return '*Deal!* ' + product.name + ' for ' + formatPrice(offeredPrice) + '\n' +
               'You saved ' + formatPrice(savings) + '!\n\n' +
               'Added to your cart.\n' +
               'Say "view cart" to checkout or type another product.';
    } else {
        // Counter offer
        const counterPrice = Math.round((product.price + offeredPrice) / 2);
        if (counterPrice < product.minPrice) {
            return 'Sorry, ' + formatPrice(offeredPrice) + ' is too low for ' + product.name + '.\n\n' +
                   'Lowest I can go: ' + formatPrice(product.minPrice) + '\n\n' +
                   'Type: "' + product.name + ' ' + product.minPrice + '" to accept minimum price.';
        }

        session.bargainingProduct = product.id;

        return 'Hmm, ' + formatPrice(offeredPrice) + ' is too low for ' + product.name + '.\n\n' +
               'How about ' + formatPrice(counterPrice) + '?\n\n' +
               'Reply:\n' +
               '"yes" - to accept ' + formatPrice(counterPrice) + '\n' +
               '"' + product.name + ' [price]" - to counter offer';
    }
}

function acceptCounterOffer(session) {
    if (!session.bargainingProduct) {
        return 'No active bargain. Type a product name to start shopping.';
    }

    const product = PRODUCTS.find(p => p.id === session.bargainingProduct);
    if (!product) return 'Product not found.';

    // Calculate the counter price that was offered
    const counterPrice = Math.round((product.price + product.minPrice) / 2);
    const finalPrice = Math.max(counterPrice, product.minPrice);

    const existing = session.cart.find(item => item.id === product.id);
    if (existing) {
        existing.discountedPrice = finalPrice;
        existing.qty = 1;
    } else {
        session.cart.push({ id: product.id, qty: 1, discountedPrice: finalPrice });
    }

    session.bargainingProduct = null;

    return '*Deal!* ' + product.name + ' for ' + formatPrice(finalPrice) + '\n\n' +
           'Added to your cart.\n' +
           'Say "view cart" to checkout or type another product.';
}

function buildHours() {
    let msg = '*Business Hours*\n\n';
    Object.entries(BUSINESS_HOURS).forEach(([day, hours]) => {
        msg += day.charAt(0).toUpperCase() + day.slice(1) + ': ' + hours + '\n';
    });
    return msg;
}

function buildDelivery() {
    return '*Delivery Information*\n\n' +
           'Within Nairobi: KES 200\n' +
           'Outside Nairobi: KES 500\n\n' +
           'Delivery time: 1-3 business days\n' +
           'Same-day delivery for orders before 2 PM';
}

function buildPayment() {
    return '*Payment Methods*\n\n' + PAYMENT_METHODS.join('\n') + '\n\n' +
           'After payment, send confirmation to this number.';
}

function buildContact() {
    return '*Contact Us*\n\n' +
           'Phone/WhatsApp: +' + OWNER_NUMBER + '\n' +
           'Location: Nairobi, Kenya\n\n' +
           'Say "I need help" to speak with a person.';
}

function buildFAQ() {
    return '*Frequently Asked Questions*\n\n' +
           'Q: How long does delivery take?\n' +
           'A: 1-3 days in Nairobi\n\n' +
           'Q: Can I return items?\n' +
           'A: Yes, within 7 days with receipt\n\n' +
           'Q: Do you offer discounts?\n' +
           'A: Yes! Some products are negotiable.\n' +
           '   Just type: "[product] [price]"\n\n' +
           'Q: Minimum order amount?\n' +
           'A: No minimum!';
}

function buildHelp() {
    return '*How to Shop*\n\n' +
           '*Browse:*\n' +
           '- "show products" - See all products\n' +
           '- "pricelist" - Get price list\n' +
           '- "search [name]" - Find products\n\n' +
           '*Buy (easiest):*\n' +
           '- Just type product name: "laptop stand"\n' +
           '- "i want earbuds"\n' +
           '- "buy 2 phone case"\n\n' +
           '*Bargain:*\n' +
           '- "laptop stand 900"\n' +
           '- "can I get earbuds for 1300"\n\n' +
           '*Cart & Checkout:*\n' +
           '- "view cart" - See your cart\n' +
           '- "checkout" - Place order\n' +
           '- "apply code BILLY10" - Discount\n\n' +
           '*Info:*\n' +
           '- "hours", "delivery", "payment"';
}

// ============================================
// MESSAGE PROCESSOR
// ============================================

function processMessage(text, session) {
    text = text.trim();
    const lowerText = text.toLowerCase();

    // Greetings
    if (/^(hi|hello|hey|hola|yo|good morning|good afternoon|good evening|howdy)/i.test(text)) {
        return buildWelcome();
    }

    // Help
    if (/^(help|menu|commands|how to|how do i|what can you do|show me how)/i.test(text)) {
        return buildHelp();
    }

    // Price list
    if (/(pricelist|price list|send me prices|all prices|price catalog|prices)/i.test(text)) {
        return buildPriceList();
    }

    // Products
    if (/(show products|what do you sell|list products|what do you have|what's available|show everything|catalog)/i.test(text)) {
        return buildProducts();
    }

    // Categories
    if (/(categories|types of products|what categories|sections)/i.test(text)) {
        let msg = '*Categories*\n\n';
        const cats = [...new Set(PRODUCTS.map(p => p.category))];
        cats.forEach((cat, i) => {
            const count = PRODUCTS.filter(p => p.category === cat).length;
            msg += (i + 1) + '. ' + cat + ' (' + count + ' items)\n';
        });
        return msg;
    }

    // Search
    const searchMatch = text.match(/(?:search|find|look for|do you have|got any)\s+(.+)/i);
    if (searchMatch) {
        return buildSearch(searchMatch[1].trim());
    }

    // Product details request
    const detailMatch = text.match(/(?:tell me about|details on|info about|what is|describe)\s+(.+)/i);
    if (detailMatch) {
        const product = findProduct(detailMatch[1].trim());
        if (product) return buildProductDetails(product);
        return 'Sorry, I could not find "' + detailMatch[1] + '".';
    }

    // Price check
    const priceMatch = text.match(/(?:how much is|what's the price of|price of|cost of|how much for)\s+(.+)/i);
    if (priceMatch) {
        const product = findProduct(priceMatch[1].trim());
        if (product) return buildProductDetails(product);
        return 'Sorry, I could not find "' + priceMatch[1] + '".';
    }

    // Apply discount code
    const codeMatch = text.match(/(?:apply code|use code|code|promo|coupon)\s+([a-z0-9]+)/i);
    if (codeMatch) {
        return applyDiscountCode(codeMatch[1], session);
    }

    // View cart
    if (/(view cart|show cart|my cart|what's in my cart|cart items)/i.test(text)) {
        return buildCart(session);
    }

    // Remove from cart
    const removeMatch = text.match(/(?:remove|delete|take out)\s+(?:item\s+)?(\d+|.+)/i);
    if (removeMatch) {
        return removeFromCart(removeMatch[1], session);
    }

    // Checkout
    if (/(checkout|place order|complete order|pay|i'm ready|finish order)/i.test(text)) {
        return doCheckout(session);
    }

    // Accept bargain counter
    if (/^(yes|okay|ok|deal|sure|fine|accepted|accept)/i.test(text) && session.bargainingProduct) {
        return acceptCounterOffer(session);
    }

    // Decline bargain
    if (/^(no|nope|not interested|decline|pass)/i.test(text) && session.bargainingProduct) {
        session.bargainingProduct = null;
        return 'No problem! Type a product name to continue shopping or "show products" to browse.';
    }

    // Business hours
    if (/(business hours|opening hours|when are you open|what time|hours of operation|are you open)/i.test(text)) {
        return buildHours();
    }

    // Location
    if (/(where are you|location|address|where is the shop|how to find you|directions)/i.test(text)) {
        return '*Our Location*\n\nNairobi, Kenya\n\nWe offer delivery services. Ask "do you deliver" for details.';
    }

    // Delivery
    if (/(delivery|shipping|do you deliver|deliver to|send to|courier)/i.test(text)) {
        return buildDelivery();
    }

    // Payment
    if (/(payment|how do i pay|pay with|mpesa|bank transfer|cash|payment methods)/i.test(text)) {
        return buildPayment();
    }

    // Contact
    if (/(contact|phone|call|reach you|whatsapp|how to contact)/i.test(text)) {
        return buildContact();
    }

    // FAQ
    if (/(faq|frequently asked|common questions|questions)/i.test(text)) {
        return buildFAQ();
    }

    // Track order
    const trackMatch = text.match(/(?:track|status of|where is my|check)\s+(?:order\s+)?(ord-\d+|\d+)/i);
    if (trackMatch) {
        return '*Order Tracking: ' + trackMatch[1].toUpperCase() + '*\n\n' +
               'Status: Out for Delivery\n' +
               'Estimated: Today by 6 PM';
    }

    // Human support
    if (/(human|person|real person|agent|representative|i need help|speak to someone|talk to someone|support)/i.test(text)) {
        return '*Connecting to Human Support*\n\n' +
               'A representative will contact you shortly.\n\n' +
               'For urgent matters, call: +' + OWNER_NUMBER;
    }

    // Thanks
    if (/(thank|thanks|asante|shukran|grateful)/i.test(text)) {
        return 'You are very welcome!\n\n' +
               'Thanks for choosing ' + SHOP_NAME + '. Have a great day!\n\n' +
               'Feel free to message anytime for more shopping.';
    }

    // Goodbye
    if (/(bye|goodbye|see you|later|talk soon|have a good one)/i.test(text)) {
        return 'Goodbye! Thanks for visiting ' + SHOP_NAME + '.\n\n' +
               'We are here whenever you need us. Have a wonderful day!';
    }

    // ============================================
    // BARGAINING PATTERNS (check before direct product)
    // ============================================

    // Pattern: "product name price" (e.g., "laptop stand 900")
    const bargainPattern1 = text.match(/^([a-z\s]+)\s+(\d+)$/i);
    if (bargainPattern1) {
        const productName = bargainPattern1[1].trim();
        const offeredPrice = parseInt(bargainPattern1[2]);
        const product = findProduct(productName);

        if (product) {
            return handleBargain(productName, offeredPrice, session);
        }
    }

    // Pattern: "can I get [product] for/at [price]"
    const bargainPattern2 = text.match(/(?:can i get|give me|sell me|how about|what about|i'll take)\s+(.+?)\s+(?:for|at)\s+(?:kes\s+)?(\d+)/i);
    if (bargainPattern2) {
        return handleBargain(bargainPattern2[1].trim(), parseInt(bargainPattern2[2]), session);
    }

    // Pattern: "discount on [product]"
    const discountPattern = text.match(/(?:discount on|bargain for|cheaper price for|reduce price of)\s+(.+)/i);
    if (discountPattern) {
        const product = findProduct(discountPattern[1].trim());
        if (!product) return 'Sorry, I could not find that product.';
        if (!product.allowDiscount) return 'Sorry, ' + product.name + ' is fixed at ' + formatPrice(product.price) + '. No discounts available.';
        if (!product.inStock) return 'Sorry, ' + product.name + ' is out of stock.';

        session.bargainingProduct = product.id;
        return '*' + product.name + '*\n\n' +
               'Original price: ' + formatPrice(product.price) + '\n' +
               'Lowest I can go: ' + formatPrice(product.minPrice) + '\n\n' +
               'What price did you have in mind?\n' +
               'Type: "' + product.name + ' [your price]"\n' +
               'Example: "' + product.name + ' ' + (product.minPrice + 100) + '"';
    }

    // ============================================
    // DIRECT PRODUCT NAME (e.g., "laptop stand", "earbuds")
    // ============================================

    const directProduct = findProduct(text);
    if (directProduct) {
        // Check if it's a buy request with quantity
        const qtyMatch = text.match(/(\d+)\s*(?:pieces?|units?|qty)?/);
        const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

        return addToCart(directProduct, qty, session, null);
    }

    // Buy patterns with "i want", "buy", etc.
    const buyPatterns = [
        /^(?:i want|i'd like|give me|add|buy|purchase|get|need)\s+(.+)/i,
        /^(?:add\s+)(\d+)\s+(?:of\s+)?(.+)/i,
        /^(?:i want)\s+(\d+)\s+(?:pieces?|units?|qty|of)\s+(.+)/i
    ];

    for (const pattern of buyPatterns) {
        const match = text.match(pattern);
        if (match) {
            let productInput, qty = 1;

            if (match[2]) {
                // Pattern with quantity and product
                qty = parseInt(match[1]) || 1;
                productInput = match[2].trim();
            } else {
                productInput = match[1].trim();
            }

            const product = findProduct(productInput);
            if (product) {
                return addToCart(product, qty, session, null);
            }

            // If product not found, suggest search
            return 'Sorry, I could not find "' + productInput + '".\n\n' +
                   'Type "show products" to see what we have, or "search [name]" to find items.';
        }
    }

    // ============================================
    // FALLBACK
    // ============================================

    return 'I am not sure I understood "' + text + '".\n\n' +
           'Try:\n' +
           '- Type a product name: "laptop stand"\n' +
           '- "show products" to browse\n' +
           '- "laptop stand 900" to bargain\n' +
           '- "help" for all options';
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
// FRONTEND
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
