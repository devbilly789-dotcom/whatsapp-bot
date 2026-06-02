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

        // Complete registration
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

        // Notify admin
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

    // Check for active trip
    const activeTrip = Object.values(activeTrips).find(t => t.customerPhone === phone && t.status !== 'completed' && t.status !== 'cancelled');

    // Rating after trip
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

    // SOS / Emergency
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

    // Share trip
    if (lower === 'share trip' || lower === 'share') {
        if (!activeTrip) return 'No active trip to share.\nBook a ride first by typing your route.';

        const rider = riders.find(r => r.id === activeTrip.riderId);
        const shareMsg = 'SafeRide Trip Share\n\nTrip ID: ' + activeTrip.id + '\nFrom: ' + activeTrip.from + '\nTo: ' + activeTrip.to + '\nPrice: ' + activeTrip.price + ' KES\nRider: ' + (rider ? rider.name : 'Assigned') + '\nStatus: ' + activeTrip.status.toUpperCase() + '\n\nTrack: https://whatsapp-bot-1-p25f.onrender.com/trip/' + activeTrip.id;

        return 'Share this message with your family/friends:\n\n' + shareMsg + '\n\nThey can track your trip in real-time.';
    }

    // Cancel trip
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

    // Trip status
    if (lower === 'trip status' || lower === 'status') {
        if (!activeTrip) return 'No active trip.\nBook a ride by typing: "I need a ride from [location] to [location]"';

        const rider = riders.find(r => r.id === activeTrip.riderId);
        let statusMsg = 'Trip Status: ' + activeTrip.id + '\nFrom: ' + activeTrip.from + '\nTo: ' + activeTrip.to + '\nPrice: ' + activeTrip.price + ' KES\nStatus: ' + activeTrip.status.toUpperCase();

        if (rider && activeTrip.status !== 'pending') {
            statusMsg += '\nRider: ' + rider.name + '\nBike: ' + rider.bikeNumber;
        }

        return statusMsg;
    }

    // Rider info
    if (lower === 'rider info' || lower === 'my rider') {
        if (!activeTrip) return 'No active trip.\nBook a ride first.';

        const rider = riders.find(r => r.id === activeTrip.riderId);
        if (!rider) return 'Rider information not available yet.';

        return 'Your Rider:\nName: ' + rider.name + '\nRating: ' + rider.rating + '/5\nTrips Completed: ' + rider.tripsCompleted + '\nBike Number: ' + rider.bikeNumber + '\n\nIf you feel unsafe, reply "SOS" immediately.';
    }

    // Price estimate
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

    // Locations list
    if (lower === 'locations' || lower === 'areas') {
        return 'We operate in these areas:\n\n' + LOCATIONS.map((l, i) => (i + 1) + '. ' + l).join('\n') + '\n\nType "price from [area] to [area]" for fare estimate.';
    }

    // Night pricing info
    if (lower.includes('night') && lower.includes('price')) {
        return 'Fair Night Pricing\n\nWe charge only +20% at night to ensure:\n1. Rider safety compensation\n2. Fair prices for customers\n3. No exploitation\n\nExample:\nMeru Town to Makutano:\nDay: 100 KES\nNight: 120 KES (only +20 KES)\n\nThis is much fairer than riders charging double or triple at night!';
    }

    // Help
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

    // Notify rider
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

    // Admin commands
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

    // Registration flow
    if (lower === 'register' || lower === 'register rider' || lower === 'signup') {
        return handleRegistration(from, text, sock);
    }

    if (pendingRegistrations[phone]) {
        return handleRegistration(from, text, sock);
    }

    // Rider commands
    const rider = riders.find(r => r.phone === phone);
    if (rider) {
        const riderResponse = handleRiderCommand(from, text, sock);
        if (riderResponse) return riderResponse;
    }

    // Customer commands
    const customerResponse = handleCustomerCommand(from, text, sock);
    if (customerResponse) return customerResponse;

    // Book ride patterns
    if (lower.includes('ride') || lower.includes('need') || lower.includes('want') || lower.includes('book') || (LOCATIONS.some(l => lower.includes(l.toLowerCase())) && lower.includes('to'))) {
        return bookRide(from, text, sock);
    }

    // Natural language
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
let currentQR = null;

async function startBot() {
    console.log('Starting SafeRide Bot...');

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
            console.log('\nQR CODE - Visit /qr to scan\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            botReady = false;
            currentQR = null;
            setTimeout(startBot, 5000);
        }
        if (connection === 'open') {
            console.log('\nSafeRide Bot Connected!');
            console.log('Number:', sock.user.id.split(':')[0]);
            botReady = true;
            currentQR = null;
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            const from = msg.key.remoteJid;

            console.log('Message from', from, ':', text);

            const reply = processMessage(from, text, sock);
            if (reply) {
                await sock.sendMessage(from, { text: reply });
            }
        }
    });
}

// ============================================
// WEB SERVER
// ============================================

app.get('/', (req, res) => {
    const status = botReady ? 'online' : 'connecting';
    const statusColor = botReady ? '#22c55e' : '#f59e0b';

    let body = '';
    if (currentQR) {
        body = '<div style="text-align:center;padding:40px;"><h2>Scan QR Code with WhatsApp</h2><p>Open WhatsApp > Settings > Linked Devices > Link a Device</p><p style="color:#666;font-size:12px;margin-top:20px;">QR code generated. Refresh if needed.</p></div>';
    } else if (botReady) {
        body = '<div style="text-align:center;padding:40px;"><h1 style="color:#22c55e;">Online</h1><p>Meru SafeRide Bot is running</p><p>Number: +254114245222</p><p>Riders: ' + riders.length + ' | Active Trips: ' + Object.keys(activeTrips).length + '</p></div>';
    } else {
        body = '<div style="text-align:center;padding:40px;"><h2>Connecting...</h2><p>Please wait while the bot initializes.</p></div>';
    }

    res.send('<!DOCTYPE html><html><head><title>Meru SafeRide</title><style>body{font-family:Arial,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;}.card{background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:500px;width:90%;overflow:hidden;}.header{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:30px;text-align:center;}.header h1{margin:0;font-size:28px;}.status-badge{display:inline-block;padding:8px 20px;border-radius:50px;font-size:14px;font-weight:bold;margin-top:10px;background:' + statusColor + ';color:#fff;}.body{padding:30px;}</style></head><body><div class="card"><div class="header"><h1>Meru SafeRide</h1><span class="status-badge">' + status.toUpperCase() + '</span></div><div class="body">' + body + '</div></div></body></html>');
});

app.get('/health', (req, res) => res.json({ status: 'ok', botReady }));

app.get('/trip/:id', (req, res) => {
    const trip = activeTrips[req.params.id];
    if (!trip) return res.send('Trip not found');

    const rider = riders.find(r => r.id === trip.riderId);
    res.send('<!DOCTYPE html><html><head><title>Trip ' + trip.id + '</title><style>body{font-family:Arial;padding:40px;background:#f5f5f5;}.card{background:#fff;padding:30px;border-radius:10px;max-width:400px;margin:0 auto;}</style></head><body><div class="card"><h2>Trip ' + trip.id + '</h2><p><strong>From:</strong> ' + trip.from + '</p><p><strong>To:</strong> ' + trip.to + '</p><p><strong>Price:</strong> ' + trip.price + ' KES</p><p><strong>Status:</strong> ' + trip.status + '</p><p><strong>Rider:</strong> ' + (rider ? rider.name : 'Pending') + '</p><p><strong>Time:</strong> ' + new Date(trip.createdAt).toLocaleString() + '</p></div></body></html>');
});

app.listen(PORT, () => {
    console.log('Server on port ' + PORT);
    startBot();
});
