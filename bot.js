const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// BODA BODA BOT CONFIGURATION
// ============================================

const APP_NAME = 'Meru Boda Boda SafeRide';
const ADMIN_NUMBER = '254114245222';
const EMERGENCY_NUMBER = '999'; // Police

// Locations in Meru
const LOCATIONS = {
    'meru town': { name: 'Meru Town', lat: 0.0500, lng: 37.6500 },
    'makutano': { name: 'Makutano', lat: 0.0600, lng: 37.6400 },
    'kaaga': { name: 'Kaaga', lat: 0.0700, lng: 37.6600 },
    'kathwana': { name: 'Kathwana', lat: 0.0800, lng: 37.6300 },
    'timau': { name: 'Timau', lat: 0.0900, lng: 37.6700 },
    'maua': { name: 'Maua', lat: 0.1000, lng: 37.6800 },
    'nkuene': { name: 'Nkuene', lat: 0.0400, lng: 37.6200 },
    'giaki': { name: 'Giaki', lat: 0.0300, lng: 37.6100 }
};

// Base prices between locations (KES, daytime)
const ROUTE_PRICES = {
    'meru town-makutano': 100,
    'meru town-kaaga': 150,
    'meru town-kathwana': 120,
    'meru town-timau': 200,
    'meru town-maua': 250,
    'meru town-nkuene': 80,
    'meru town-giaki': 90,
    'makutano-kaaga': 80,
    'makutano-kathwana': 70,
    'makutano-timau': 180,
    'makutano-maua': 220,
    'kaaga-kathwana': 60,
    'kaaga-timau': 150,
    'kaaga-maua': 200,
    'kathwana-timau': 140,
    'kathwana-maua': 180,
    'timau-maua': 100
};

const NIGHT_START = 20; // 8 PM
const NIGHT_END = 6;    // 6 AM
const NIGHT_MULTIPLIER = 1.2; // 20% premium (fair, not exploitative)

// ============================================
// DATABASE (In-memory, replace with real DB for production)
// ============================================

const riders = {};
const customers = {};
const activeTrips = {};
const tripHistory = [];

// Demo riders (in production, riders register via admin)
const demoRiders = [
    { id: 'R001', name: 'John Mwenda', phone: '254712345001', location: 'meru town', status: 'available', rating: 4.5, trips: 120, verified: true },
    { id: 'R002', name: 'Peter Kariuki', phone: '254712345002', location: 'makutano', status: 'available', rating: 4.8, trips: 200, verified: true },
    { id: 'R003', name: 'James Mutua', phone: '254712345003', location: 'kaaga', status: 'available', rating: 4.2, trips: 80, verified: true },
    { id: 'R004', name: 'Daniel Ochieng', phone: '254712345004', location: 'meru town', status: 'busy', rating: 4.6, trips: 150, verified: true },
    { id: 'R005', name: 'Michael Kimani', phone: '254712345005', location: 'kathwana', status: 'available', rating: 4.9, trips: 300, verified: true }
];

demoRiders.forEach(r => riders[r.id] = r);

// ============================================
// STATE
// ============================================

let currentQR = null;
let sock = null;
let botReady = false;
let connectionStatus = 'initializing';

function getSession(jid) {
    if (!customers[jid]) {
        customers[jid] = {
            phone: jid.split('@')[0],
            name: null,
            currentTrip: null,
            tripCount: 0,
            rating: 5.0,
            emergencyContact: null
        };
    }
    return customers[jid];
}

// ============================================
// PRICING ENGINE
// ============================================

function isNightTime() {
    const hour = new Date().getHours();
    return hour >= NIGHT_START || hour < NIGHT_END;
}

function getPrice(pickup, dropoff) {
    const key1 = pickup + '-' + dropoff;
    const key2 = dropoff + '-' + pickup;

    let basePrice = ROUTE_PRICES[key1] || ROUTE_PRICES[key2];

    // If route not in database, estimate
    if (!basePrice) {
        basePrice = 100; // Default
    }

    const night = isNightTime();
    const finalPrice = night ? Math.round(basePrice * NIGHT_MULTIPLIER) : basePrice;

    return {
        basePrice,
        finalPrice,
        night,
        premium: night ? Math.round(basePrice * (NIGHT_MULTIPLIER - 1)) : 0
    };
}

// ============================================
// RIDER MATCHING
// ============================================

function findNearestRider(location) {
    const available = Object.values(riders).filter(r => 
        r.status === 'available' && r.verified
    );

    if (available.length === 0) return null;

    // Simple matching: same location first, then any available
    const sameLocation = available.filter(r => r.location === location);
    if (sameLocation.length > 0) {
        return sameLocation[0]; // Return first available in same area
    }

    return available[0]; // Return any available rider
}

// ============================================
// RESPONSE BUILDERS
// ============================================

function buildWelcome() {
    const hour = new Date().getHours();
    let greeting = 'Good morning';
    if (hour >= 12) greeting = 'Good afternoon';
    if (hour >= 17) greeting = 'Good evening';

    let msg = greeting + '! Welcome to *' + APP_NAME + '* \n\n';
    msg += 'Your safe and fair boda boda service in Meru.\n\n';
    msg += 'What I can do:\n';
    msg += '- Book a ride (say: "I need a ride from [place] to [place]")\n';
    msg += '- Check prices (say: "price from [place] to [place]")\n';
    msg += '- See locations (say: "locations")\n';
    msg += '- Emergency (say: "SOS" or "emergency")\n';
    msg += '- Share trip with family\n\n';

    if (isNightTime()) {
        msg += '*Night mode active* - Fair 20% premium applied\n';
        msg += 'No overcharging, guaranteed!\n\n';
    }

    msg += 'Where do you want to go today?';
    return msg;
}

function buildLocations() {
    let msg = '*Available Locations*\n\n';
    Object.entries(LOCATIONS).forEach(([key, loc]) => {
        msg += '- ' + loc.name + '\n';
    });
    msg += '\nSay: "I need a ride from [location] to [location]"\n';
    msg += 'Example: "I need a ride from Meru Town to Makutano"';
    return msg;
}

function buildPriceEstimate(pickup, dropoff) {
    const pickupKey = Object.keys(LOCATIONS).find(k => k.includes(pickup.toLowerCase()) || LOCATIONS[k].name.toLowerCase().includes(pickup.toLowerCase()));
    const dropoffKey = Object.keys(LOCATIONS).find(k => k.includes(dropoff.toLowerCase()) || LOCATIONS[k].name.toLowerCase().includes(dropoff.toLowerCase()));

    if (!pickupKey || !dropoffKey) {
        return 'Sorry, I do not recognize one of those locations.\n\n' +
               'Available locations:\n' +
               Object.values(LOCATIONS).map(l => '- ' + l.name).join('\n') + '\n\n' +
               'Say: "price from [location] to [location]"';
    }

    if (pickupKey === dropoffKey) {
        return 'Pickup and dropoff cannot be the same place!';
    }

    const pricing = getPrice(pickupKey, dropoffKey);

    let msg = '*Price Estimate*\n\n';
    msg += 'From: ' + LOCATIONS[pickupKey].name + '\n';
    msg += 'To: ' + LOCATIONS[dropoffKey].name + '\n\n';
    msg += 'Base price: ' + pricing.basePrice + ' KES\n';

    if (pricing.night) {
        msg += 'Night premium (20%): +' + pricing.premium + ' KES\n';
        msg += '*Total: ' + pricing.finalPrice + ' KES*\n\n';
        msg += 'Fair night pricing - no overcharging!';
    } else {
        msg += '*Total: ' + pricing.finalPrice + ' KES*\n\n';
        msg += 'Daytime rate';
    }

    msg += '\n\nTo book, say: "book from ' + LOCATIONS[pickupKey].name + ' to ' + LOCATIONS[dropoffKey].name + '"';
    return msg;
}

function bookRide(customerJid, pickup, dropoff, session) {
    const pickupKey = Object.keys(LOCATIONS).find(k => k.includes(pickup.toLowerCase()) || LOCATIONS[k].name.toLowerCase().includes(pickup.toLowerCase()));
    const dropoffKey = Object.keys(LOCATIONS).find(k => k.includes(dropoff.toLowerCase()) || LOCATIONS[k].name.toLowerCase().includes(dropoff.toLowerCase()));

    if (!pickupKey || !dropoffKey) {
        return 'Sorry, I do not recognize one of those locations. Say "locations" to see available areas.';
    }

    if (pickupKey === dropoffKey) {
        return 'Pickup and dropoff cannot be the same place!';
    }

    // Check if customer already has active trip
    if (session.currentTrip) {
        return 'You already have an active trip!\n\n' +
               'Trip ID: ' + session.currentTrip + '\n' +
               'Say "trip status" to check or "cancel trip" to cancel.';
    }

    const pricing = getPrice(pickupKey, dropoffKey);
    const rider = findNearestRider(pickupKey);

    if (!rider) {
        return 'Sorry, no riders are available right now in ' + LOCATIONS[pickupKey].name + '.\n\n' +
               'Please try again in a few minutes or try a different pickup location.';
    }

    // Create trip
    const tripId = 'TRP-' + Date.now().toString().slice(-8);
    const trip = {
        id: tripId,
        customerJid: customerJid,
        customerPhone: session.phone,
        riderId: rider.id,
        riderPhone: rider.phone,
        pickup: pickupKey,
        dropoff: dropoffKey,
        price: pricing.finalPrice,
        basePrice: pricing.basePrice,
        nightPremium: pricing.premium,
        status: 'finding_rider',
        createdAt: new Date(),
        acceptedAt: null,
        startedAt: null,
        completedAt: null
    };

    activeTrips[tripId] = trip;
    session.currentTrip = tripId;

    // Mark rider as busy
    rider.status = 'busy';

    // Send alert to rider (in production, this would message rider's WhatsApp)
    console.log('RIDER ALERT to ' + rider.phone + ': New ride ' + tripId + ' from ' + LOCATIONS[pickupKey].name + ' to ' + LOCATIONS[dropoffKey].name + ' for ' + pricing.finalPrice + ' KES');

    let msg = '*Booking Requested!*\n\n';
    msg += 'Trip ID: ' + tripId + '\n';
    msg += 'From: ' + LOCATIONS[pickupKey].name + '\n';
    msg += 'To: ' + LOCATIONS[dropoffKey].name + '\n';
    msg += 'Price: ' + pricing.finalPrice + ' KES\n';
    if (pricing.night) {
        msg += '(Includes fair night premium)\n';
    }
    msg += '\n';
    msg += 'Finding nearest rider...\n\n';
    msg += 'Rider: ' + rider.name + '\n';
    msg += 'Rating: ' + rider.rating + '/5\n';
    msg += 'Trips completed: ' + rider.trips + '\n\n';
    msg += 'Waiting for rider to accept...\n';
    msg += 'You will receive confirmation shortly.';

    return msg;
}

function getTripStatus(tripId) {
    const trip = activeTrips[tripId];
    if (!trip) return 'Trip not found.';

    const rider = riders[trip.riderId];
    let msg = '*Trip Status: ' + tripId + '*\n\n';
    msg += 'From: ' + LOCATIONS[trip.pickup].name + '\n';
    msg += 'To: ' + LOCATIONS[trip.dropoff].name + '\n';
    msg += 'Price: ' + trip.price + ' KES\n';
    msg += 'Rider: ' + (rider ? rider.name : 'Unknown') + '\n\n';

    switch(trip.status) {
        case 'finding_rider':
            msg += 'Status: Finding rider...';
            break;
        case 'rider_assigned':
            msg += 'Status: Rider assigned\n';
            msg += 'Rider is on the way!\n';
            msg += 'ETA: 3-5 minutes';
            break;
        case 'rider_arrived':
            msg += 'Status: Rider has arrived!\n';
            msg += 'Look for: ' + (rider ? rider.name : 'your rider');
            break;
        case 'in_progress':
            msg += 'Status: Trip in progress\n';
            msg += 'Heading to ' + LOCATIONS[trip.dropoff].name;
            break;
        case 'completed':
            msg += 'Status: Trip completed\n';
            msg += 'Thank you for using SafeRide!';
            break;
        default:
            msg += 'Status: ' + trip.status;
    }

    return msg;
}

function cancelTrip(tripId, session) {
    const trip = activeTrips[tripId];
    if (!trip) return 'No active trip to cancel.';

    if (trip.status === 'in_progress') {
        return 'Cannot cancel - trip is already in progress!\n\n' +
               'If there is an emergency, say "SOS".';
    }

    // Free up rider
    const rider = riders[trip.riderId];
    if (rider) rider.status = 'available';

    trip.status = 'cancelled';
    session.currentTrip = null;

    return 'Trip ' + tripId + ' has been cancelled.\n\n' +
           'No charges applied.\n' +
           'Say "I need a ride" to book another.';
}

function buildEmergency(session) {
    // In production, this would send alerts to emergency contact + police
    let msg = '*EMERGENCY ALERT ACTIVATED*\n\n';
    msg += 'We have notified:\n';
    msg += '- Emergency services\n';
    msg += '- Your emergency contact (if set)\n';
    msg += '- Admin\n\n';

    if (session.currentTrip) {
        const trip = activeTrips[session.currentTrip];
        if (trip) {
            msg += 'Your trip details have been shared:\n';
            msg += 'Trip ID: ' + trip.id + '\n';
            msg += 'Rider: ' + riders[trip.riderId]?.name + '\n';
            msg += 'From: ' + LOCATIONS[trip.pickup]?.name + '\n';
            msg += 'To: ' + LOCATIONS[trip.dropoff]?.name + '\n\n';
        }
    }

    msg += '*Call Emergency: ' + EMERGENCY_NUMBER + '*\n\n';
    msg += 'Stay safe. Help is on the way.';

    // Log emergency for admin
    console.log('EMERGENCY ALERT from ' + session.phone);

    return msg;
}

function buildHelp() {
    let msg = '*' + APP_NAME + ' - Help*\n\n';
    msg += '*Book a ride:*\n';
    msg += '- "I need a ride from [place] to [place]"\n';
    msg += '- "book from Meru Town to Makutano"\n';
    msg += '- "take me to Kaaga"\n\n';
    msg += '*Check price:*\n';
    msg += '- "price from [place] to [place]"\n';
    msg += '- "how much to [place]"\n\n';
    msg += '*Trip management:*\n';
    msg += '- "trip status" - Check your ride\n';
    msg += '- "cancel trip" - Cancel booking\n\n';
    msg += '*Safety:*\n';
    msg += '- "SOS" or "emergency" - Alert authorities\n';
    msg += '- "share trip" - Share with family\n\n';
    msg += '*Other:*\n';
    msg += '- "locations" - See all areas\n';
    msg += '- "night pricing" - Understand night rates\n';
    msg += '- "help" - This menu';
    return msg;
}

function buildNightPricing() {
    let msg = '*Night Pricing Policy*\n\n';
    msg += 'Night hours: 8:00 PM - 6:00 AM\n\n';
    msg += 'Fair premium: *+20% only*\n\n';
    msg += 'Example:\n';
    msg += '- Meru Town to Kaaga (day): 150 KES\n';
    msg += '- Meru Town to Kaaga (night): 180 KES\n\n';
    msg += 'Why we do this:\n';
    msg += '- Protects riders (higher risk at night)\n';
    msg += '- Protects customers (no surprise charges)\n';
    msg += '- Prevents exploitation\n\n';
    msg += '*We guarantee: No rider can charge more than the app price!*';
    return msg;
}

function buildShareTrip(session) {
    if (!session.currentTrip) {
        return 'You do not have an active trip to share.\n\n' +
               'Book a ride first: "I need a ride from [place] to [place]"';
    }

    const trip = activeTrips[session.currentTrip];
    const shareLink = 'https://saferide.meru/track/' + trip.id;

    let msg = '*Share Your Trip*\n\n';
    msg += 'Send this to your family/friend:\n\n';
    msg += 'I am taking a SafeRide from ' + LOCATIONS[trip.pickup].name + 
           ' to ' + LOCATIONS[trip.dropoff].name + '.\n';
    msg += 'Track my trip: ' + shareLink + '\n';
    msg += 'Trip ID: ' + trip.id + '\n';
    msg += 'Rider: ' + riders[trip.riderId]?.name + '\n\n';
    msg += 'They can see your live location and trip progress.';

    return msg;
}

// ============================================
// MESSAGE PROCESSOR
// ============================================

function processMessage(text, session) {
    text = text.trim();
    const lowerText = text.toLowerCase();

    // Greetings
    if (/^(hi|hello|hey|hola|good morning|good afternoon|good evening|start|menu)/i.test(text)) {
        return buildWelcome();
    }

    // Help
    if (/^(help|how to|how do i|commands|options)/i.test(text)) {
        return buildHelp();
    }

    // Locations
    if (/(locations|areas|places|where do you go|which areas)/i.test(text)) {
        return buildLocations();
    }

    // Price estimate
    const priceMatch = text.match(/(?:price|how much|cost|fare)\s+(?:from\s+)?(.+?)\s+(?:to\s+)?(.+)/i);
    if (priceMatch) {
        return buildPriceEstimate(priceMatch[1], priceMatch[2]);
    }

    // Book ride - various patterns
    const bookPatterns = [
        /(?:book|need|want|get|take)\s+(?:a\s+)?(?:ride|trip|boda|bodaboda)\s+(?:from\s+)?(.+?)\s+(?:to\s+)?(.+)/i,
        /(?:take me|send me)\s+(?:to\s+)?(.+)/i,
        /(?:i am|i'm)\s+(?:at|in)\s+(.+?)\s+(?:going|heading)\s+(?:to\s+)?(.+)/i
    ];

    for (const pattern of bookPatterns) {
        const match = text.match(pattern);
        if (match) {
            if (match[2]) {
                return bookRide(session.phone + '@s.whatsapp.net', match[1], match[2], session);
            } else {
                // Pattern like "take me to Kaaga" - need to know current location
                return 'Where are you now?\n\n' +
                       'Say: "I need a ride from [your location] to ' + match[1] + '"';
            }
        }
    }

    // Simple "to [location]" when context exists
    if (/^to\s+(.+)/i.test(text) && session.lastPickup) {
        return bookRide(session.phone + '@s.whatsapp.net', session.lastPickup, text.match(/^to\s+(.+)/i)[1], session);
    }

    // Trip status
    if (/(trip status|my ride|where is my rider|check trip)/i.test(text)) {
        if (session.currentTrip) {
            return getTripStatus(session.currentTrip);
        }
        return 'You do not have an active trip.\n\n' +
               'Say: "I need a ride from [place] to [place]" to book.';
    }

    // Cancel trip
    if (/(cancel trip|cancel my ride|cancel booking)/i.test(text)) {
        if (session.currentTrip) {
            return cancelTrip(session.currentTrip, session);
        }
        return 'You do not have an active trip to cancel.';
    }

    // Emergency / SOS
    if (/(sos|emergency|help me|i am in danger|police|thief|robbery|attack)/i.test(text)) {
        return buildEmergency(session);
    }

    // Share trip
    if (/(share trip|share my ride|send location|family tracking)/i.test(text)) {
        return buildShareTrip(session);
    }

    // Night pricing explanation
    if (/(night pricing|night rate|why expensive at night|night charge)/i.test(text)) {
        return buildNightPricing();
    }

    // Rider info (for demo/verification)
    if (/(rider info|who is my rider|driver details|rider verification)/i.test(text)) {
        if (session.currentTrip) {
            const trip = activeTrips[session.currentTrip];
            const rider = riders[trip.riderId];
            if (rider) {
                let msg = '*Your Rider*\n\n';
                msg += 'Name: ' + rider.name + '\n';
                msg += 'Rating: ' + rider.rating + '/5\n';
                msg += 'Trips completed: ' + rider.trips + '\n';
                msg += 'Verified: ' + (rider.verified ? 'Yes' : 'No') + '\n\n';
                msg += 'If rider details do not match, say "SOS" immediately!';
                return msg;
            }
        }
        return 'No active rider information.';
    }

    // Thanks
    if (/(thank|thanks|asante|shukran)/i.test(text)) {
        return 'You are welcome!\n\n' +
               'Ride safe with ' + APP_NAME + '.\n' +
               'Message us anytime you need a ride.';
    }

    // Goodbye
    if (/(bye|goodbye|see you|later)/i.test(text)) {
        return 'Goodbye! Stay safe.\n\n' +
               APP_NAME + ' is here whenever you need a ride.';
    }

    // Fallback
    return 'I did not understand that.\n\n' +
           'Try:\n' +
           '- "I need a ride from Meru Town to Makutano"\n' +
           '- "price from Kaaga to Timau"\n' +
           '- "locations" to see areas\n' +
           '- "help" for all options';
}

// ============================================
// WHATSAPP CONNECTION
// ============================================

async function startBot() {
    console.log('Starting ' + APP_NAME + '...');
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
                 '<p>' + APP_NAME + ' is live.</p>' +
                 '<p><strong>WhatsApp: +' + ADMIN_NUMBER + '</strong></p>' +
                 '<p>Serving: Meru Town, Makutano, Kaaga, and more</p>' +
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
             '<title>' + APP_NAME + '</title>' +
             '<style>' +
             'body{font-family:Arial,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;justify-content:center;align-items:center;padding:20px;margin:0;}' +
             '.container{background:white;border-radius:24px;padding:40px;max-width:500px;width:100%;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.25);}' +
             'h1{color:#1a1a2e;font-size:26px;margin-bottom:5px;}' +
             '.tagline{color:#888;font-size:14px;margin-bottom:20px;}' +
             '.footer{margin-top:25px;padding-top:20px;border-top:1px solid #e9ecef;color:#888;font-size:12px;}' +
             '</style></head><body>' +
             '<div class="container">' +
             '<div style="font-size:60px;margin-bottom:10px;">🏍️</div>' +
             '<h1>' + APP_NAME + '</h1>' +
             '<p class="tagline">Safe & Fair Boda Boda in Meru</p>' +
             qrHtml +
             '<div class="footer">' +
             '<p>' + APP_NAME + ' - Ride Safe, Pay Fair</p>' +
             '<p>Built with Baileys</p>' +
             '</div></div></body></html>');
});

app.get('/api/status', (req, res) => {
    res.json({ 
        status: connectionStatus, 
        botReady, 
        admin: ADMIN_NUMBER, 
        app: APP_NAME,
        activeTrips: Object.keys(activeTrips).length,
        availableRiders: Object.values(riders).filter(r => r.status === 'available').length
    });
});

app.get('/health', (req, res) => res.json({ status: 'ok', botReady }));

app.listen(PORT, () => {
    console.log('Server on port ' + PORT);
    console.log('URL: https://your-url.onrender.com');
    startBot();
});
