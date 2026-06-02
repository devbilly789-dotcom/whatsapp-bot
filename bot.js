const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// BODA BODA BOT - MERU SAFERIDE
// ============================================

const OWNER_NUMBER = '254114245222';
const ADMIN_NUMBER = '254114245222';
const BOT_NAME = 'Meru SafeRide';

// Locations
const LOCATIONS = [
    'Meru Town', 'Makutano', 'Kaaga', 'Kathwana', 'Timau',
    'Maua', 'Nkuene', 'Giaki', 'Kianjai', 'Nkubu', 'Mitunguu'
];

// Pricing (KES)
const BASE_PRICES = {
    'Meru Town-Makutano': { day: 100, night: 120 },
    'Meru Town-Kaaga': { day: 150, night: 180 },
    'Meru Town-Kathwana': { day: 200, night: 240 },
    'Meru Town-Timau': { day: 250, night: 300 },
    'Meru Town-Maua': { day: 300, night: 360 },
    'Makutano-Kaaga': { day: 80, night: 96 },
    'Makutano-Kathwana': { day: 120, night: 144 },
    'Kaaga-Timau': { day: 180, night: 216 },
    'Kathwana-Maua': { day: 150, night: 180 },
    'Nkuene-Giaki': { day: 60, night: 72 },
    'Kianjai-Nkubu': { day: 100, night: 120 },
    'Mitunguu-Meru Town': { day: 120, night: 144 }
};

const WITHIN_AREA_PRICE = { day: 50, night: 60 };
const LONG_DISTANCE_BASE = { day: 200, night: 240 };

// Demo riders
let riders = [
    {
        id: 'RID-001',
        name: 'Peter Kariuki',
        phone: '254101646251',
        idNumber: '12345678',
        bikeNumber: 'KME 123A',
        location: 'Meru Town',
        status: 'available',
        rating: 4.8,
        tripsCompleted: 200,
        registered: true,
        verified: true,
        registrationStep: 'complete'
    },
    {
        id: 'RID-002',
        name: 'John Mutua',
        phone: '254717059203',
        idNumber: '87654321',
        bikeNumber: 'KME 456B',
        location: 'Makutano',
        status: 'available',
        rating: 4.5,
        tripsCompleted: 150,
        registered: true,
        verified: true,
        registrationStep: 'complete'
    }
];

// Active trips
let activeTrips = {};

// Pending registrations
let pendingRegistrations = {};

// QR code storage for web display
let qrCodeData = null;
let qrGeneratedAt = null;

// ============================================
// HELPER FUNCTIONS
// ============================================

function isNightTime() {
    const hour = new Date().getHours();
    return hour >= 20 || hour < 6;
}

function getPrice(from, to) {
    const key1 = from + '-' + to;
    const key2 = to + '-' + from;
    const isNight = isNightTime();

    if (BASE_PRICES[key1]) {
        return BASE_PRICES[key1][isNight ? 'night' : 'day'];
    }
    if (BASE_PRICES[key2]) {
        return BASE_PRICES[key2][isNight ? 'night' : 'day'];
    }
    if (from === to) {
        return WITHIN_AREA_PRICE[isNight ? 'night' : 'day'];
    }
    return LONG_DISTANCE_BASE[isNight ? 'night' : 'day'];
}

function findRider(location) {
    return riders.find(r => r.location === location && r.status === 'available' && r.registered && r.verified);
}

function generateTripId() {
    return 'TRP-' + Math.floor(10000000 + Math.random() * 90000000);
}

function cleanPhone(phone) {
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('0')) p = '254' + p.substring(1);
    if (!p.startsWith('254')) p = '254' + p;
    return p;
}

function formatPhone(phone) {
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('254')) return '0' + p.substring(3);
    return p;
}

function getTimeGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

// ============================================
// REGISTRATION FLOW
// ============================================

function handleRegistration(from, text, sock) {
    const phone = cleanPhone(from);
    const reg = pendingRegistrations[phone];

    if (!reg) {
        pendingRegistrations[phone] = { step: 'start', phone: phone };
        return 'Welcome to SafeRide Rider Registration!\n\nTo register as a rider, I need some details:\n\nStep 1/5: What is your FULL NAME?\n(Example: Peter Kariuki)';
    }

    if (reg.step === 'start') {
        reg.name = text.trim();
        reg.step = 'id';
        return 'Step 2/5: What is your NATIONAL ID NUMBER?\n(Example: 12345678)';
    }

    if (reg.step === 'id') {
        if (!/^\d{7,8}$/.test(text.trim())) {
            return 'Invalid ID number. Please enter a valid 7-8 digit ID number.';
        }
        reg.idNumber = text.trim();
        reg.step = 'bike';
        return 'Step 3/5: What is your MOTORBIKE NUMBER PLATE?\n(Example: KME 123A)';
    }

    if (reg.step === 'bike') {
        reg.bikeNumber = text.trim().toUpperCase();
        reg.step = 'location';
        return 'Step 4/5: Which area do you operate in?\n\n' + LOCATIONS.join(', ') + '\n\nReply with your area.';
    }

    if (reg.step === 'location') {
        const loc = text.trim();
        if (!LOCATIONS.includes(loc)) {
            return 'Invalid area. Please choose from:\n' + LOCATIONS.join(', ');
        }
        reg.location = loc;
        reg.step = 'photo';
        return 'Step 5/5: Please send a CLEAR PHOTO of your motorbike showing the NUMBER PLATE.\n\nReply "done" when you have sent the photo, or type "skip" to continue without photo (admin will verify later).';
    }

    if (reg.step === 'photo') {
        if (text.toLowerCase() === 'skip') {
            reg.photoSent = false;
        } else {
            reg.photoSent = true;
        }

        const riderId = 'RID-' + String(riders.length + 1).padStart(3, '0');
        const newRider = {
            id: riderId,
            name: reg.name,
            phone: phone,
            idNumber: reg.idNumber,
            bikeNumber: reg.bikeNumber,
            location: reg.location,
            status: 'offline',
            rating: 0,
            tripsCompleted: 0,
            registered: true,
            verified: false,
            registrationStep: 'complete',
            photoSent: reg.photoSent,
            registeredAt: new Date().toISOString()
        };

        riders.push(newRider);
        delete pendingRegistrations[phone];

        const adminMsg = 'New Rider Registration!\n\nName: ' + reg.name + '\nPhone: ' + formatPhone(phone) + '\nID: ' + reg.idNumber + '\nBike: ' + reg.bikeNumber + '\nLocation: ' + reg.location + '\nPhoto: ' + (reg.photoSent ? 'Sent' : 'Skipped') + '\n\nReply "verify ' + riderId + '" to approve.';
        sock.sendMessage(ADMIN_NUMBER + '@s.whatsapp.net', { text: adminMsg });

        return 'Registration Complete!\n\nYour Details:\nName: ' + reg.name + '\nRider ID: ' + riderId + '\nBike: ' + reg.bikeNumber + '\nLocation: ' + reg.location + '\n\nStatus: PENDING VERIFICATION\nAn admin will verify your details within 24 hours.\n\nOnce verified, you will receive ride requests automatically.\n\nTo go online and start receiving trips, reply "go online".';
    }

    return 'Registration error. Please start over by typing "register".';
}

// ============================================
// RIDER COMMANDS
// ============================================

function handleRiderCommand(from, text, sock) {
    const phone = cleanPhone(from);
    const rider = riders.find(r => r.phone === phone);

    if (!rider) {
        return 'You are not registered as a rider. Reply "register" to sign up.';
    }

    const cmd = text.toLowerCase().trim();

    if (cmd === 'go online' || cmd === 'online') {
        if (!rider.verified) {
            return 'Your account is pending verification. Please wait for admin approval.';
        }
        rider.status = 'available';
        return 'You are now ONLINE!\n\nYou will receive ride requests for ' + rider.location + '.\n\nReply "go offline" to stop receiving requests.';
    }

    if (cmd === 'go offline' || cmd === 'offline') {
        rider.status = 'offline';
        return 'You are now OFFLINE.\n\nYou will not receive ride requests.\nReply "go online" to start receiving trips again.';
    }

    if (cmd === 'my status') {
        return 'Your Status:\nName: ' + rider.name + '\nID: ' + rider.id + '\nStatus: ' + rider.status.toUpperCase() + '\nRating: ' + (rider.rating || 'N/A') + '/5\nTrips: ' + rider.tripsCompleted + '\nVerified: ' + (rider.verified ? 'Yes' : 'Pending');
    }

    if (cmd === 'accept') {
        const trip = Object.values(activeTrips).find(t => t.riderPhone === phone && t.status === 'pending');
        if (!trip) return 'No pending trip requests.';

        trip.status = 'accepted';
        trip.riderAcceptedAt = new Date().toISOString();

        const customerMsg = 'Trip Accepted!\n\nRider: ' + rider.name + '\nRating: ' + rider.rating + '/5\nTrips: ' + rider.tripsCompleted + '\nBike: ' + rider.bikeNumber + '\n\nPrice: ' + trip.price + ' KES\n\nRider is on the way! ETA: 3-5 minutes.\n\nTrip ID: ' + trip.id;
        sock.sendMessage(trip.customerPhone + '@s.whatsapp.net', { text: customerMsg });

        return 'Trip Accepted!\n\nCustomer: ' + trip.customerName + '\nFrom: ' + trip.from + '\nTo: ' + trip.to + '\nPrice: ' + trip.price + ' KES\n\nGo pick up the customer now.\nReply "arrived" when you reach the pickup point.';
    }

    if (cmd === 'decline') {
        const trip = Object.values(activeTrips).find(t => t.riderPhone === phone && t.status === 'pending');
        if (!trip) return 'No pending trip requests.';

        trip.status = 'declined';
        rider.status = 'available';

        const altRider = findRider(trip.from);
        if (altRider) {
            trip.riderId = altRider.id;
            trip.riderPhone = altRider.phone;
            trip.status = 'pending';

            const riderAlert = 'New Ride Request!\n\nFrom: ' + trip.from + '\nTo: ' + trip.to + '\nPrice: ' + trip.price + ' KES\nCustomer: ' + trip.customerName + '\n\nReply "accept" or "decline".';
            sock.sendMessage(altRider.phone + '@s.whatsapp.net', { text: riderAlert });

            return 'Trip declined. Another rider has been notified.';
        }

        const customerMsg = 'Sorry, no riders available right now.\nPlease try again in a few minutes or call our hotline.';
        sock.sendMessage(trip.customerPhone + '@s.whatsapp.net', { text: customerMsg });

        delete activeTrips[trip.id];
        return 'Trip declined. Customer has been notified.';
    }

    if (cmd === 'arrived') {
        const trip = Object.values(activeTrips).find(t => t.riderPhone === phone && t.status === 'accepted');
        if (!trip) return 'No active trip found.';

        trip.status = 'arrived';

        const customerMsg = 'Your rider has ARRIVED!\n\nRider: ' + rider.name + '\nBike: ' + rider.bikeNumber + '\n\nPlease meet your rider at the pickup point.\nPrice: ' + trip.price + ' KES';
        sock.sendMessage(trip.customerPhone + '@s.whatsapp.net', { text: customerMsg });

        return 'Customer notified. Start the trip now.\nReply "complete" when the trip is finished.';
    }

    if (cmd === 'complete') {
        const trip = Object.values(activeTrips).find(t => t.riderPhone === phone && (t.status === 'arrived' || t.status === 'in-progress'));
        if (!trip) return 'No active trip found.';

        trip.status = 'completed';
        trip.completedAt = new Date().toISOString();
        rider.tripsCompleted += 1;
        rider.status = 'available';

        const customerMsg = 'Trip Completed!\n\nFrom: ' + trip.from + '\nTo: ' + trip.to + '\nPrice: ' + trip.price + ' KES\n\nPlease pay the rider now.\n\nRate your ride (1-5):\nReply with a number 1-5.';
        sock.sendMessage(trip.customerPhone + '@s.whatsapp.net', { text: customerMsg });

        return 'Trip completed!\nPrice: ' + trip.price + ' KES\nCollect payment from customer.';
    }

    if (cmd === 'cancel trip') {
        const trip = Object.values(activeTrips).find(t => t.riderPhone === phone && t.status !== 'completed');
        if (!trip) return 'No active trip to cancel.';

        trip.status = 'cancelled';
        rider.status = 'available';

        const customerMsg = 'Your trip has been cancelled by the rider.\nWe apologize for the inconvenience.\nPlease request a new ride.';
        sock.sendMessage(trip.customerPhone + '@s.whatsapp.net', { text: customerMsg });

        delete activeTrips[trip.id];
        return 'Trip cancelled. Customer has been notified.';
    }

    return 'Rider Commands:\ngo online - Start receiving trips\ngo offline - Stop receiving trips\nmy status - View your info\naccept - Accept a trip\ndecline - Decline a trip\narrived - Notify customer you arrived\ncomplete - Finish trip\ncancel trip - Cancel current trip';
}

// ============================================
// CUSTOMER COMMANDS
// ============================================

function handleCustomerCommand(from, text, sock) {
    const phone = cleanPhone(from);
    const lower = text.toLowerCase().trim();

    const activeTrip = Object.values(activeTrips).find(t => t.customerPhone === phone && t.status !== 'completed' && t.status !== 'cancelled');

    if (/^[1-5]$/.test(text.trim()) && !activeTrip) {
        const completedTrip = Object.values(activeTrips).find(t => t.customerPhone === phone && t.status === 'completed' && !t.customerRated);
        if (completedTrip) {
            completedTrip.customerRated = true;
            completedTrip.customerRating = parseInt(text.trim());

            const rider = riders.find(r => r.id === completedTrip.riderId);
            if (rider) {
                const totalRating = (rider.rating * rider.tripsCompleted + completedTrip.customerRating) / (rider.tripsCompleted + 1);
                rider.rating = Math.round(totalRating * 10) / 10;
            }

            return 'Thank you for rating!\nYou rated: ' + text.trim() + '/5\n\nYour feedback helps us improve SafeRide.';
        }
    }

    if (lower === 'sos' || lower === 'emergency' || lower === 'help emergency') {
        const sosMsg = 'EMERGENCY ALERT!\n\nCustomer: ' + formatPhone(phone) + '\nTime: ' + new Date().toLocaleString() + '\n\nIf you are in danger:\n1. Share your live location\n2. Call police: 999 or 112\n3. Call SafeRide Admin: ' + formatPhone(ADMIN_NUMBER) + '\n\nWe are tracking your trip and have alerted authorities.';

        sock.sendMessage(ADMIN_NUMBER + '@s.whatsapp.net', { text: sosMsg });

        if (activeTrip) {
            const rider = riders.find(r => r.id === activeTrip.riderId);
            if (rider) {
                sock.sendMessage(rider.phone + '@s.whatsapp.net', { text: 'EMERGENCY ALERT: Your customer has triggered an SOS. Please ensure their safety and contact admin immediately.' });
            }
        }

        return 'EMERGENCY ALERT SENT!\n\nAdmin has been notified.\n\nEmergency Numbers:\nPolice: 999 / 112\nSafeRide Admin: ' + formatPhone(ADMIN_NUMBER) + '\n\nStay safe. Help is on the way.';
    }

    if (lower === 'share trip' || lower === 'share') {
        if (!activeTrip) return 'No active trip to share.\nBook a ride first by typing your route.';

        const rider = riders.find(r => r.id === activeTrip.riderId);
        const shareMsg = 'SafeRide Trip Share\n\nTrip ID: ' + activeTrip.id + '\nFrom: ' + activeTrip.from + '\nTo: ' + activeTrip.to + '\nPrice: ' + activeTrip.price + ' KES\nRider: ' + (rider ? rider.name : 'Assigned') + '\nStatus: ' + activeTrip.status.toUpperCase() + '\n\nTrack: https://whatsapp-bot-1-p25f.onrender.com/trip/' + activeTrip.id;

        return 'Share this message with your family/friends:\n\n' + shareMsg + '\n\nThey can track your trip in real-time.';
    }

    if (lower === 'cancel trip' || lower === 'cancel') {
        if (!activeTrip) return 'No active trip to cancel.';

        activeTrip.status = 'cancelled';

        if (activeTrip.riderPhone) {
            const rider = riders.find(r => r.phone === activeTrip.riderPhone);
            if (rider) rider.status = 'available';
            sock.sendMessage(activeTrip.riderPhone + '@s.whatsapp.net', { text: 'Trip ' + activeTrip.id + ' has been cancelled by the customer.' });
        }

        delete activeTrips[activeTrip.id];
        return 'Trip cancelled successfully.\nYou can book a new ride anytime.';
    }

    if (lower === 'trip status' || lower === 'status') {
        if (!activeTrip) return 'No active trip.\nBook a ride by typing: "I need a ride from [location] to [location]"';

        const rider = riders.find(r => r.id === activeTrip.riderId);
        let statusMsg = 'Trip Status: ' + activeTrip.id + '\nFrom: ' + activeTrip.from + '\nTo: ' + activeTrip.to + '\nPrice: ' + activeTrip.price + ' KES\nStatus: ' + activeTrip.status.toUpperCase();

        if (rider && activeTrip.status !== 'pending') {
            statusMsg += '\nRider: ' + rider.name + '\nBike: ' + rider.bikeNumber;
        }

        return statusMsg;
    }

    if (lower === 'rider info' || lower === 'my rider') {
        if (!activeTrip) return 'No active trip.\nBook a ride first.';

        const rider = riders.find(r => r.id === activeTrip.riderId);
        if (!rider) return 'Rider information not available yet.';

        return 'Your Rider:\nName: ' + rider.name + '\nRating: ' + rider.rating + '/5\nTrips Completed: ' + rider.tripsCompleted + '\nBike Number: ' + rider.bikeNumber + '\n\nIf you feel unsafe, reply "SOS" immediately.';
    }

    if (lower.startsWith('price') || lower.startsWith('how much')) {
        const match = text.match(/from\s+(.+?)\s+to\s+(.+)/i);
        if (!match) {
            return 'To get a price estimate, type:\n"Price from [location] to [location]"\n\nExample: "Price from Meru Town to Makutano"\n\nAvailable locations:\n' + LOCATIONS.join(', ');
        }

        const from = match[1].trim();
        const to = match[2].trim();

        if (!LOCATIONS.includes(from) || !LOCATIONS.includes(to)) {
            return 'Invalid location. Available locations:\n' + LOCATIONS.join(', ');
        }

        const price = getPrice(from, to);
        const isNight = isNightTime();

        return 'Price Estimate\n\nFrom: ' + from + '\nTo: ' + to + '\nTime: ' + (isNight ? 'Night (8PM - 6AM)' : 'Day (6AM - 8PM)') + '\n\nPrice: ' + price + ' KES\n\nNight rides have a small +20% premium for rider safety.';
    }

    if (lower === 'locations' || lower === 'areas') {
        return 'We operate in these areas:\n\n' + LOCATIONS.map((l, i) => (i + 1) + '. ' + l).join('\n') + '\n\nType "price from [area] to [area]" for fare estimate.';
    }

    if (lower.includes('night') && lower.includes('price')) {
        return 'Fair Night Pricing\n\nWe charge only +20% at night to ensure:\n1. Rider safety compensation\n2. Fair prices for customers\n3. No exploitation\n\nExample:\nMeru Town to Makutano:\nDay: 100 KES\nNight: 120 KES (only +20 KES)\n\nThis is much fairer than riders charging double or triple at night!';
    }

    if (lower === 'help') {
        return '*Meru SafeRide - Help*\n\n*Book a Ride:*\n"I need a ride from [location] to [location]"\n\n*Check Price:*\n"Price from [location] to [location]"\n\n*Trip Status:*\n"trip status"\n\n*Safety:*\n"SOS" - Emergency alert\n"share trip" - Share with family\n"rider info" - Rider details\n\n*Other:*\n"locations" - Service areas\n"night pricing" - Fair night rates\n"cancel trip" - Cancel booking\n\nAvailable locations:\n' + LOCATIONS.slice(0, 5).join(', ') + '...';
    }

    return null;
}

// ============================================
// BOOK RIDE
// ============================================

function bookRide(from, text, sock) {
    const phone = cleanPhone(from);

    const patterns = [
        /(?:need|want|book)\s+a?\s*ride\s+from\s+(.+?)\s+to\s+(.+)/i,
        /ride\s+from\s+(.+?)\s+to\s+(.+)/i,
        /from\s+(.+?)\s+to\s+(.+?)(?:\s+now)?/i,
        /(.+?)\s+to\s+(.+)/i
    ];

    let fromLoc = null, toLoc = null;
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            fromLoc = match[1].trim();
            toLoc = match[2].trim();
            break;
        }
    }

    if (!fromLoc || !toLoc) {
        return 'To book a ride, type:\n"I need a ride from [location] to [location]"\n\nExample: "I need a ride from Meru Town to Makutano"\n\nAvailable locations:\n' + LOCATIONS.join(', ');
    }

    if (!LOCATIONS.includes(fromLoc) || !LOCATIONS.includes(toLoc)) {
        return 'Invalid location. We operate in:\n' + LOCATIONS.join(', ') + '\n\nPlease check spelling or type "locations" for the list.';
    }

    const rider = findRider(fromLoc);
    if (!rider) {
        return 'Sorry, no riders available in ' + fromLoc + ' right now.\n\nOptions:\n1. Try a nearby location\n2. Call our hotline: ' + formatPhone(ADMIN_NUMBER) + '\n3. Try again in a few minutes';
    }

    const price = getPrice(fromLoc, toLoc);
    const tripId = generateTripId();
    const isNight = isNightTime();

    activeTrips[tripId] = {
        id: tripId,
        customerPhone: phone,
        customerName: 'Customer',
        from: fromLoc,
        to: toLoc,
        price: price,
        riderId: rider.id,
        riderPhone: rider.phone,
        status: 'pending',
        createdAt: new Date().toISOString(),
        isNight: isNight
    };

    rider.status = 'busy';

    const riderAlert = 'New Ride Request!\n\nTrip ID: ' + tripId + '\nFrom: ' + fromLoc + '\nTo: ' + toLoc + '\nPrice: ' + price + ' KES' + (isNight ? ' (Night Rate)' : '') + '\n\nReply "accept" or "decline" within 2 minutes.';
    sock.sendMessage(rider.phone + '@s.whatsapp.net', { text: riderAlert });

    return 'Booking Requested!\n\nTrip ID: ' + tripId + '\nFrom: ' + fromLoc + '\nTo: ' + toLoc + '\nPrice: ' + price + ' KES' + (isNight ? '\n(Night Rate - Fair +20%)' : '') + '\n\nRider: ' + rider.name + '\nRating: ' + rider.rating + '/5\nTrips: ' + rider.tripsCompleted + '\n\nWaiting for rider to accept...\n\nReply "cancel trip" to cancel.\nReply "SOS" for emergency.';
}

// ============================================
// MAIN MESSAGE HANDLER
// ============================================

function processMessage(from, text, sock) {
    const phone = cleanPhone(from);
    const lower = text.toLowerCase().trim();

    if (phone === ADMIN_NUMBER) {
        if (lower.startsWith('verify ')) {
            const riderId = text.split(' ')[1];
            const rider = riders.find(r => r.id === riderId);
            if (rider) {
                rider.verified = true;
                sock.sendMessage(rider.phone + '@s.whatsapp.net', { text: 'Congratulations! Your SafeRide account has been VERIFIED!\n\nYou can now go online and start receiving ride requests.\nReply "go online" to begin.' });
                return 'Rider ' + riderId + ' verified successfully.';
            }
            return 'Rider not found.';
        }

        if (lower === 'all riders') {
            return 'All Riders (' + riders.length + '):\n\n' + riders.map(r => r.id + ' | ' + r.name + ' | ' + r.location + ' | ' + r.status + ' | Verified: ' + r.verified).join('\n');
        }

        if (lower === 'all trips') {
            const trips = Object.values(activeTrips);
            if (trips.length === 0) return 'No active trips.';
            return 'Active Trips (' + trips.length + '):\n\n' + trips.map(t => t.id + ' | ' + t.from + '->' + t.to + ' | ' + t.status + ' | ' + t.price + ' KES').join('\n');
        }
    }

    if (lower === 'register' || lower === 'register rider' || lower === 'signup') {
        return handleRegistration(from, text, sock);
    }

    if (pendingRegistrations[phone]) {
        return handleRegistration(from, text, sock);
    }

    const rider = riders.find(r => r.phone === phone);
    if (rider) {
        const riderResponse = handleRiderCommand(from, text, sock);
        if (riderResponse) return riderResponse;
    }

    const customerResponse = handleCustomerCommand(from, text, sock);
    if (customerResponse) return customerResponse;

    if (lower.includes('ride') || lower.includes('need') || lower.includes('want') || lower.includes('book') || (LOCATIONS.some(l => lower.includes(l.toLowerCase())) && lower.includes('to'))) {
        return bookRide(from, text, sock);
    }

    if (['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'].some(w => lower.includes(w))) {
        return getTimeGreeting() + '! Welcome to Meru SafeRide!\n\nYour safe and affordable boda boda service.\n\nI can help you:\n1. Book a ride\n2. Check prices\n3. Find service areas\n\nJust type your route like:\n"I need a ride from Meru Town to Makutano"\n\nOr reply "help" for all options.';
    }

    if (['bye', 'goodbye', 'see you'].some(w => lower.includes(w))) {
        return 'Goodbye! Ride safe with Meru SafeRide.\nReply anytime to book your next ride.';
    }

    if (['thank', 'thanks', 'asante'].some(w => lower.includes(w))) {
        return 'You are welcome! Your safety is our priority.\nRide with Meru SafeRide anytime.';
    }

    if (['how are you', 'how r u'].some(w => lower.includes(w))) {
        return 'I am doing great! Ready to help you get a safe ride.\nWhere would you like to go today?';
    }

    return 'I did not understand that.\n\nTo book a ride, type:\n"I need a ride from [location] to [location]"\n\nOr reply "help" for all options.';
}

// ============================================
// WHATSAPP CONNECTION
// ============================================

let sock = null;
let botReady = false;
let qrCodeData = null;
let qrGeneratedAt = null;
let connectionAttempts = 0;

async function startBot() {
    connectionAttempts++;
    console.log('Starting SafeRide Bot... Attempt ' + connectionAttempts);

    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        const { version } = await fetchLatestBaileysVersion();

        const logger = pino({ level: 'silent' });

        sock = makeWASocket({
            version,
            auth: state,
            logger,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            syncFullHistory: false,
            markOnlineOnConnect: true
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, qr, lastDisconnect } = update;

            if (qr) {
                qrCodeData = qr;
                qrGeneratedAt = Date.now();
                console.log('\n=== QR CODE GENERATED ===');
                console.log('Visit your site to scan the QR code');
                console.log('QR expires in ~60 seconds - scan quickly!\n');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                botReady = false;
                qrCodeData = null;
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed. Reconnecting:', shouldReconnect);
                if (shouldReconnect) {
                    setTimeout(startBot, 5000);
                }
            }

            if (connection === 'open') {
                console.log('\n=== SAFE RIDE BOT CONNECTED ===');
                console.log('Phone:', sock.user.id.split(':')[0]);
                botReady = true;
                qrCodeData = null;
                qrGeneratedAt = null;
                connectionAttempts = 0;
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.key.fromMe && m.type === 'notify') {
                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                const from = msg.key.remoteJid;

                console.log('Message from', from, ':', text.substring(0, 50));

                const reply = processMessage(from, text, sock);
                if (reply) {
                    await sock.sendMessage(from, { text: reply });
                }
            }
        });

    } catch (err) {
        console.error('Bot start error:', err);
        setTimeout(startBot, 10000);
    }
}

// ============================================
// WEB SERVER WITH QR DISPLAY
// ============================================

function getStatusHTML() {
    const isOnline = botReady;
    const hasQR = !!qrCodeData;
    const qrAge = qrGeneratedAt ? Math.floor((Date.now() - qrGeneratedAt) / 1000) : 0;
    const qrExpired = qrAge > 60;

    let statusBadge, statusText, bodyContent;

    if (isOnline) {
        statusBadge = '#22c55e';
        statusText = 'ONLINE';
        bodyContent = '<div style="text-align:center;padding:30px;">' +
            '<div style="font-size:64px;margin-bottom:10px;">&#128663;</div>' +
            '<h2 style="color:#22c55e;margin:5px 0;">Bot Connected!</h2>' +
            '<p style="color:#666;font-size:16px;">Meru SafeRide is active</p>' +
            '<div style="background:#f0fdf4;border:1px solid #22c55e;border-radius:10px;padding:15px;margin:20px 0;text-align:left;">' +
            '<p><strong>Number:</strong> +254114245222</p>' +
            '<p><strong>Riders:</strong> ' + riders.length + '</p>' +
            '<p><strong>Active Trips:</strong> ' + Object.keys(activeTrips).length + '</p>' +
            '</div>' +
            '<p style="color:#888;font-size:13px;">The bot is receiving messages on WhatsApp</p>' +
            '</div>';
    } else if (hasQR && !qrExpired) {
        statusBadge = '#f59e0b';
        statusText = 'SCAN QR CODE';
        bodyContent = '<div style="text-align:center;padding:20px;">' +
            '<h2 style="color:#f59e0b;margin-bottom:5px;">&#128241; Scan to Connect</h2>' +
            '<p style="color:#666;font-size:14px;margin-bottom:15px;">Open WhatsApp > Settings > Linked Devices > Link a Device</p>' +
            '<div style="background:#fff;border:3px solid #f59e0b;border-radius:15px;padding:20px;display:inline-block;margin:10px auto;">' +
            '<div style="font-family:monospace;font-size:10px;line-height:10px;white-space:pre;letter-spacing:1px;">' + 
            qrcode.generate(qrCodeData, { small: true }) + '</div>' +
            '</div>' +
            '<p style="color:#dc2626;font-size:14px;font-weight:bold;margin-top:10px;">&#9200; QR expires in ' + (60 - qrAge) + ' seconds!</p>' +
            '<p style="color:#888;font-size:12px;margin-top:15px;">If QR expired, <a href="/restart" style="color:#667eea;">click here to refresh</a></p>' +
            '</div>';
    } else if (hasQR && qrExpired) {
        statusBadge = '#dc2626';
        statusText = 'QR EXPIRED';
        bodyContent = '<div style="text-align:center;padding:40px;">' +
            '<div style="font-size:48px;margin-bottom:10px;">&#9200;</div>' +
            '<h2 style="color:#dc2626;">QR Code Expired</h2>' +
            '<p style="color:#666;">The QR code has expired. Please restart the bot to get a new one.</p>' +
            '<a href="/restart" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 30px;border-radius:25px;text-decoration:none;font-weight:bold;margin-top:20px;">Restart Bot</a>' +
            '</div>';
    } else {
        statusBadge = '#f59e0b';
        statusText = 'CONNECTING...';
        bodyContent = '<div style="text-align:center;padding:40px;">' +
            '<div style="font-size:48px;margin-bottom:10px;animation:spin 2s linear infinite;">&#128260;</div>' +
            '<h2 style="color:#f59e0b;">Connecting to WhatsApp...</h2>' +
            '<p style="color:#666;">Please wait while we initialize the connection.</p>' +
            '<p style="color:#888;font-size:13px;margin-top:20px;">If this takes too long, <a href="/restart" style="color:#667eea;">restart the bot</a></p>' +
            '</div>';
    }

    return '<!DOCTYPE html>' +
        '<html><head><title>Meru SafeRide</title>' +
        '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>' +
        '*{margin:0;padding:0;box-sizing:border-box;}' +
        'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}' +
        '.card{background:#fff;border-radius:20px;box-shadow:0 25px 80px rgba(0,0,0,0.3);max-width:480px;width:100%;overflow:hidden;}' +
        '.header{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:30px;text-align:center;}' +
        '.header h1{margin:0;font-size:26px;letter-spacing:0.5px;}' +
        '.header p{margin:8px 0 0;font-size:14px;opacity:0.9;}' +
        '.status-badge{display:inline-block;padding:8px 24px;border-radius:50px;font-size:13px;font-weight:bold;margin-top:12px;background:' + statusBadge + ';color:#fff;box-shadow:0 4px 15px rgba(0,0,0,0.2);}' +
        '.body{padding:0;}' +
        '@keyframes spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}' +
        '.footer{background:#f8f9fa;padding:15px;text-align:center;font-size:12px;color:#888;border-top:1px solid #e5e7eb;}' +
        '</style></head><body>' +
        '<div class="card"><div class="header"><h1>&#127757; Meru SafeRide</h1><p>Safe Boda Boda Service</p><span class="status-badge">' + statusText + '</span></div>' +
        '<div class="body">' + bodyContent + '</div>' +
        '<div class="footer">Meru SafeRide Bot | +254114245222 | <a href="/health" style="color:#667eea;">Health Check</a></div>' +
        '</div></body></html>';
}

app.get('/', (req, res) => {
    res.send(getStatusHTML());
});

app.get('/qr', (req, res) => {
    if (!qrCodeData) {
        return res.send('<html><body style="padding:40px;text-align:center;font-family:Arial;"><h2>No QR Code Available</h2><p>The bot may already be connected or still initializing.</p><p><a href="/">Go to home page</a></p></body></html>');
    }

    const qrAscii = qrcode.generate(qrCodeData, { small: true });
    res.send('<html><head><title>QR Code - Meru SafeRide</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
        '<body style="font-family:monospace;padding:20px;background:#000;color:#0f0;text-align:center;">' +
        '<h2 style="color:#fff;margin-bottom:10px;">&#128241; Scan with WhatsApp</h2>' +
        '<pre style="font-size:8px;line-height:8px;display:inline-block;background:#fff;padding:15px;border-radius:10px;color:#000;">' + qrAscii + '</pre>' +
        '<p style="color:#fff;margin-top:15px;font-size:14px;font-family:Arial;">1. Open WhatsApp<br>2. Settings > Linked Devices<br>3. Link a Device<br>4. Point camera at this code</p>' +
        '<p style="color:#ff0;font-family:Arial;font-size:13px;margin-top:10px;">&#9200; QR expires in 60 seconds!</p>' +
        '<p style="margin-top:20px;"><a href="/" style="color:#667eea;font-family:Arial;">Back to Home</a></p>' +
        '</body></html>');
});

app.get('/restart', (req, res) => {
    qrCodeData = null;
    qrGeneratedAt = null;
    botReady = false;
    if (sock) {
        try { sock.end(); } catch(e) {}
    }
    setTimeout(startBot, 2000);
    res.send('<html><body style="padding:40px;text-align:center;font-family:Arial;"><h2>Restarting Bot...</h2><p>Please wait 10 seconds and refresh the page.</p><p><a href="/">Go to home page</a></p><script>setTimeout(function(){window.location="/";},10000);</script></body></html>');
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        botReady, 
        hasQR: !!qrCodeData,
        qrAge: qrGeneratedAt ? Math.floor((Date.now() - qrGeneratedAt) / 1000) : null,
        riders: riders.length,
        activeTrips: Object.keys(activeTrips).length,
        timestamp: new Date().toISOString()
    });
});

app.get('/trip/:id', (req, res) => {
    const trip = activeTrips[req.params.id];
    if (!trip) return res.send('Trip not found');

    const rider = riders.find(r => r.id === trip.riderId);
    res.send('<!DOCTYPE html><html><head><title>Trip ' + trip.id + '</title><style>body{font-family:Arial;padding:40px;background:#f5f5f5;}.card{background:#fff;padding:30px;border-radius:10px;max-width:400px;margin:0 auto;}</style></head><body><div class="card"><h2>Trip ' + trip.id + '</h2><p><strong>From:</strong> ' + trip.from + '</p><p><strong>To:</strong> ' + trip.to + '</p><p><strong>Price:</strong> ' + trip.price + ' KES</p><p><strong>Status:</strong> ' + trip.status + '</p><p><strong>Rider:</strong> ' + (rider ? rider.name : 'Pending') + '</p><p><strong>Time:</strong> ' + new Date(trip.createdAt).toLocaleString() + '</p></div></body></html>');
});

app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
    console.log('Visit: https://whatsapp-bot-1-p25f.onrender.com');
    startBot();
});
