/* ============================================================
   WanderAI – app.js  (fixed)
   MindTrip-style chat + Gemini 2.5 Flash
   ============================================================ */

// ══════════════════ STATE ══════════════════
// No API key here — Gemini calls go through /api/gemini, a serverless
// function that holds the key server-side (see api/gemini.js). A static
// site has no way to call a paid third-party API directly without
// exposing the key to every visitor, so this is the only correct place
// for it to live.
const State = {
    currentTrip: null,
    trips: [],
    activeTrip: null,
    isGenerating: false,
};

// ══════════════════ PERSISTENCE ══════════════════
const STORAGE_KEY = 'wanderai_trips_v1';

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            trips: State.trips,
            activeTrip: State.activeTrip,
        }));
    } catch (e) {
        console.warn('Could not save trips to localStorage:', e.message);
    }
}

function loadState() {
    let raw;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
        console.warn('Could not read trips from localStorage:', e.message);
        return;
    }
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.trips)) {
            State.trips = parsed.trips;
            State.activeTrip = parsed.activeTrip || (parsed.trips[0] && parsed.trips[0].id) || null;
            // Rebuild the msgId -> tripData lookup used by showDetailPanel,
            // since tripDataMap itself isn't persisted (it's derived).
            State.trips.forEach(trip => {
                (trip.messages || []).forEach(m => {
                    if (m.tripData) tripDataMap[String(m.id).replace('.', '_')] = m.tripData;
                });
            });
        }
    } catch (e) {
        console.warn('Corrupt trip data in localStorage, ignoring:', e.message);
    }
}

// ══════════════════ PAGE MANAGEMENT ══════════════════
function openApp() {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('app-page').classList.remove('hidden');
    if (State.trips.length === 0) {
        newChat();
    } else {
        if (!getActiveTrip()) State.activeTrip = State.trips[0].id;
        renderSidebar();
        refreshChatUI();
    }
}

function goHome() {
    document.getElementById('app-page').classList.add('hidden');
    document.getElementById('landing-page').classList.remove('hidden');
}

function toggleSidebar() {
    const sb = document.querySelector('.sidebar');
    if (window.innerWidth <= 600) {
        sb.classList.toggle('mobile-open');
    } else {
        sb.classList.toggle('collapsed');
    }
}

// ══════════════════ TRIP MANAGEMENT ══════════════════
function newChat() {
    const id = 'trip_' + Date.now();
    const trip = { id, title: 'New Trip', messages: [], tripData: null };
    State.trips.unshift(trip);
    State.activeTrip = id;
    renderSidebar();
    refreshChatUI();
    resetResultsPanel();
    saveState();
}

function setActiveTrip(id) {
    State.activeTrip = id;
    refreshChatUI();
    renderSidebar();
    saveState();
}

function getActiveTrip() {
    return State.trips.find(t => t.id === State.activeTrip) || null;
}

function refreshChatUI() {
    const trip = getActiveTrip();
    if (!trip) return;

    document.getElementById('app-topbar-title').textContent = trip.title;

    const welcome = document.getElementById('chat-welcome');
    const messages = document.getElementById('chat-messages');

    if (trip.messages.length === 0) {
        welcome.style.display = 'flex';
        messages.innerHTML = '';
    } else {
        welcome.style.display = 'none';
        renderMessages(trip.messages);
    }

    if (trip.tripData) {
        populateResultsPanel(trip.tripData);
        document.getElementById('btn-export').style.display = '';
        document.getElementById('btn-print').style.display = '';
    } else {
        resetResultsPanel();
        document.getElementById('btn-export').style.display = 'none';
        document.getElementById('btn-print').style.display = 'none';
    }
}

let renamingTripId = null;
let pendingDeleteId = null;
let pendingDeleteTimer = null;

function renderSidebar() {
    const container = document.getElementById('sb-trips');
    if (!container) return;
    if (State.trips.length === 0) {
        container.innerHTML = '<div style="padding:10px 12px;font-size:12px;color:var(--text-muted)">No trips yet</div>';
        return;
    }
    container.innerHTML = State.trips.map(t => {
        const titleHtml = t.id === renamingTripId
            ? `<input class="sb-trip-rename-input" data-trip-id="${escHtml(t.id)}" value="${escHtml(t.title)}"
                 style="flex:1;min-width:0;background:transparent;border:1px solid currentColor;border-radius:4px;color:inherit;font:inherit;padding:2px 4px">`
            : `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escHtml(t.title)}</span>`;
        const deleteBtnHtml = t.id === pendingDeleteId
            ? `<button class="sb-trip-action" data-action="delete" data-trip-id="${escHtml(t.id)}" title="Click again to confirm"
                 style="background:none;border:1px solid #ef4444;border-radius:4px;cursor:pointer;font-size:10px;color:#ef4444;padding:2px 5px;white-space:nowrap">Confirm?</button>`
            : `<button class="sb-trip-action" data-action="delete" data-trip-id="${escHtml(t.id)}" title="Delete" style="background:none;border:none;cursor:pointer;font-size:12px;opacity:0.65;padding:2px">🗑️</button>`;
        return `
        <div class="sb-trip-item ${t.id === State.activeTrip ? 'active' : ''}" data-trip-id="${escHtml(t.id)}">
            <span class="sb-trip-icon">✈️</span>
            ${titleHtml}
            <div class="sb-trip-actions" style="display:flex;gap:2px;flex-shrink:0;align-items:center">
                <button class="sb-trip-action" data-action="rename" data-trip-id="${escHtml(t.id)}" title="Rename" style="background:none;border:none;cursor:pointer;font-size:12px;opacity:0.65;padding:2px">✏️</button>
                ${deleteBtnHtml}
            </div>
        </div>`;
    }).join('');

    if (renamingTripId) {
        const input = container.querySelector('.sb-trip-rename-input');
        if (input) { input.focus(); input.select(); }
    }
}

function startRenameTrip(id) {
    renamingTripId = id;
    renderSidebar();
}

function commitRenameTrip(id, newTitle) {
    const trip = State.trips.find(t => t.id === id);
    renamingTripId = null;
    if (trip) {
        const trimmed = newTitle.trim();
        if (trimmed) trip.title = trimmed;
        if (trip.id === State.activeTrip) document.getElementById('app-topbar-title').textContent = trip.title;
    }
    renderSidebar();
    saveState();
}

// Click-to-arm, click-again-to-confirm — avoids a native confirm() dialog,
// which blocks the entire page (including any automated testing of it)
// until manually dismissed, and is jarring UX in a single-page app.
function deleteTrip(id) {
    const trip = State.trips.find(t => t.id === id);
    if (!trip) return;

    if (pendingDeleteId !== id) {
        pendingDeleteId = id;
        renderSidebar();
        clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = setTimeout(() => { pendingDeleteId = null; renderSidebar(); }, 3000);
        return;
    }

    clearTimeout(pendingDeleteTimer);
    pendingDeleteId = null;
    State.trips = State.trips.filter(t => t.id !== id);
    if (State.activeTrip === id) {
        if (State.trips.length) {
            State.activeTrip = State.trips[0].id;
            refreshChatUI();
        } else {
            newChat();
            return;
        }
    }
    renderSidebar();
    saveState();
}

// ══════════════════ SEND MESSAGE ══════════════════
async function sendMessage() {
    if (State.isGenerating) return;

    const inputEl = document.getElementById('chat-input');
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    autoResize(inputEl);

    const trip = getActiveTrip();
    if (!trip) return;

    // Hide welcome
    document.getElementById('chat-welcome').style.display = 'none';

    // Add user message & render
    pushMsg(trip, 'user', text, null);
    renderMessages(trip.messages);
    scrollChatBottom();
    saveState();

    // Update sidebar title
    if (trip.title === 'New Trip') {
        trip.title = text.length > 40 ? text.slice(0, 40) + '...' : text;
        document.getElementById('app-topbar-title').textContent = trip.title;
        renderSidebar();
    }

    // Lock UI & show typing
    State.isGenerating = true;
    document.getElementById('chat-send-btn').disabled = true;
    showTyping();

    try {
        const rawText = await callGemini(text, trip.tripData);
        removeTyping();

        const parsed = tryParseTrip(rawText);

        if (parsed) {
            trip.tripData = parsed;
            State.currentTrip = parsed;
            pushMsg(trip, 'ai', null, parsed);
            populateResultsPanel(parsed);
            document.getElementById('btn-export').style.display = '';
            document.getElementById('btn-print').style.display = '';
        } else {
            pushMsg(trip, 'ai', rawText, null);
        }

        renderMessages(trip.messages);
        scrollChatBottom();

    } catch (err) {
        removeTyping();
        console.error('WanderAI error:', err);
        pushMsg(trip, 'ai', `❌ **Error:** ${err.message}\n\nPlease check your API key and try again.`, null);
        renderMessages(trip.messages);
        scrollChatBottom();
    } finally {
        State.isGenerating = false;
        document.getElementById('chat-send-btn').disabled = false;
        saveState();
    }
}

function handleInputKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function useSuggestion(btn) {
    const input = document.getElementById('chat-input');
    input.value = btn.textContent.trim();
    autoResize(input);
    input.focus();
    sendMessage();
}

function startInspiredTrip(destination, style) {
    openApp();
    setTimeout(() => {
        const input = document.getElementById('chat-input');
        input.value = `Plan a complete ${style} trip to ${destination} with budget breakdown`;
        autoResize(input);
        sendMessage();
    }, 300);
}

// ══════════════════ GEMINI API ══════════════════
async function callGemini(userMsg, existingTripData) {
    const isRefinement = !!existingTripData;
    const isTripQuery = /plan|trip|travel|visit|itinerary|vacation|holiday|tour|days in|days at|week in|weekend|destination|explore|go to/i.test(userMsg);

    const prompt = isRefinement
        ? buildRefinementPrompt(existingTripData, userMsg)
        : isTripQuery
            ? buildTripPrompt(userMsg)
            : `You are WanderAI, a friendly AI travel assistant. Answer this travel question helpfully and concisely:\n\n${userMsg}`;

    const fallback = () => isRefinement ? getMockRefinementResponse(existingTripData) : getMockTripResponse(userMsg);

    try {
        const res = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            console.warn('Gemini API failed:', errData);
            return fallback();
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            console.warn('Gemini response missing text, using fallback');
            return fallback();
        }
        return text;
    } catch (err) {
        console.warn('Gemini fetch failed:', err);
        return fallback();
    }
}

// A refinement request follows up on an existing trip ("make day 3 more
// relaxed", "swap in vegetarian restaurants") rather than starting a new
// one — so it sends the current trip JSON back to Gemini and asks for a
// complete updated version, instead of building a fresh-trip prompt.
function buildRefinementPrompt(tripData, userMsg) {
    const { isMockFallback, ...cleanTripData } = tripData;
    return `You are WanderAI, an expert AI travel planner. You previously generated this trip plan as JSON:

${JSON.stringify(cleanTripData, null, 2)}

The user now wants this change: "${userMsg}"

Apply the requested change to the plan above. Keep everything else the same unless the change logically affects it (e.g. changing the number of days should adjust the itinerary array length; changing the budget level should adjust cost estimates accordingly).

Respond ONLY with the complete, updated JSON object in the exact same structure as above — no explanation text, no markdown code fences, no extra characters before or after the JSON.`;
}

// If Gemini is unavailable mid-refinement, return the trip unchanged
// (flagged as a fallback) rather than a generic, unrelated mock trip.
function getMockRefinementResponse(existingTripData) {
    return JSON.stringify({ ...existingTripData, isMockFallback: true });
}

function buildTripPrompt(userMsg) {
    return `You are WanderAI, an expert AI travel planner. The user wants: "${userMsg}"

Respond ONLY with a single valid JSON object — no explanation text, no markdown code fences, no extra characters before or after the JSON.

Use this exact JSON structure:
{
  "tripTitle": "🌴 5 Days in Goa",
  "destination": "Goa, India",
  "duration": "5 Days",
  "travellers": "Couple",
  "budgetLevel": "Moderate",
  "style": "Beach & Relaxation",
  "summary": "A perfect tropical getaway with golden beaches, vibrant nightlife, and rich Portuguese heritage.",
  "quickStats": {
    "totalEstimatedCost": "₹55,000",
    "perPersonCost": "₹27,500 per person",
    "bestTimeToVisit": "November to February",
    "difficulty": "Easy"
  },
  "itinerary": [
    {
      "day": 1,
      "date": "2025-12-01",
      "title": "Arrival & North Goa Vibes",
      "theme": "Check-in & Explore",
      "timeBlocks": [
        { "time": "10:00 AM", "activity": "Arrive at Goa Airport", "description": "Take a pre-paid taxi to your hotel (~₹500). Check in and freshen up.", "tags": ["Transport", "Check-in"] },
        { "time": "1:00 PM", "activity": "Lunch at Infantaria", "description": "Famous bakery cafe in Calangute. Try the chicken cafreal and bebinca dessert. Budget ~₹600/person.", "tags": ["Food"] },
        { "time": "3:00 PM", "activity": "Calangute Beach", "description": "Relax on Goa's most popular beach. Rent beach chairs (₹100). Try water sports — parasailing ~₹800.", "tags": ["Beach", "Activity"] },
        { "time": "7:00 PM", "activity": "Sunset at Baga Beach", "description": "Walk 2km north to Baga for a spectacular sunset. Watch the fishing boats return.", "tags": ["Sightseeing"] },
        { "time": "9:00 PM", "activity": "Dinner at Brittos", "description": "Iconic beachside restaurant. Must try: grilled kingfish and prawn balchao. Budget ~₹1,200/person.", "tags": ["Food", "Nightlife"] }
      ]
    }
  ],
  "budget": {
    "totalMin": "₹48,000",
    "totalMax": "₹62,000",
    "perPersonMin": "₹24,000",
    "perPersonMax": "₹31,000",
    "breakdown": [
      { "category": "Flights", "icon": "✈️", "amount": "₹14,000", "percentage": 26 },
      { "category": "Accommodation", "icon": "🏨", "amount": "₹18,000", "percentage": 33 },
      { "category": "Food & Dining", "icon": "🍽️", "amount": "₹10,000", "percentage": 18 },
      { "category": "Activities", "icon": "🎭", "amount": "₹8,000", "percentage": 14 },
      { "category": "Shopping & Misc", "icon": "🛍️", "amount": "₹5,000", "percentage": 9 }
    ],
    "savingTips": [
      "Book flights 3-4 weeks in advance for up to 40% savings",
      "Stay in North Goa guesthouses instead of resorts — same beach access at half the cost",
      "Eat at local beach shacks instead of restaurants — fresher seafood, lower prices"
    ]
  },
  "weather": {
    "season": "Winter (Nov–Feb)",
    "temperature": "22°C – 32°C",
    "conditions": "Sunny with cool evenings",
    "emoji": "☀️",
    "humidity": "55%",
    "rainfall": "Very Low",
    "windSpeed": "15 km/h",
    "uvIndex": "High",
    "description": "December is peak season in Goa with perfect beach weather. Days are warm and sunny, evenings are pleasantly cool. Ideal for outdoor activities.",
    "packingList": ["🕶️ Sunglasses", "🧴 SPF 50 Sunscreen", "👙 Swimwear", "👟 Comfortable sandals", "💊 Medicine kit", "📱 Power bank", "💳 Travel cards", "🧴 Insect repellent"]
  },
  "food": {
    "restaurants": [
      { "name": "Brittos", "cuisine": "Goan Seafood", "rating": "4.6 ⭐", "priceRange": "₹₹₹", "description": "Iconic beachside restaurant famous for fresh seafood and live music" },
      { "name": "Infantaria", "cuisine": "Goan-Portuguese", "rating": "4.4 ⭐", "priceRange": "₹₹", "description": "Famous bakery with authentic Goan snacks and bebinca pastries" },
      { "name": "Gunpowder", "cuisine": "South Indian", "rating": "4.5 ⭐", "priceRange": "₹₹", "description": "Best Kerala and Coorgi cuisine in Goa, hidden gem in Assagao" },
      { "name": "Fisherman's Wharf", "cuisine": "Goan-Coastal", "rating": "4.3 ⭐", "priceRange": "₹₹₹", "description": "River-facing restaurant with excellent prawn curry and local feni" }
    ],
    "mustTryDishes": [
      { "emoji": "🦐", "name": "Prawn Balchao", "description": "Spicy and tangy Goan prawn pickle-curry — a must-try local specialty" },
      { "emoji": "🐟", "name": "Fish Cafreal", "description": "Grilled fish marinated in green masala — the signature dish of Goa" },
      { "emoji": "🍮", "name": "Bebinca", "description": "Traditional Goan layered dessert made with coconut milk and eggs" },
      { "emoji": "🥤", "name": "Feni", "description": "Local cashew spirit — try a glass of this unique Goan liquor responsibly" }
    ]
  },
  "tips": [
    { "icon": "🛵", "title": "Rent a Scooter", "description": "Best way to explore Goa is by scooter. Rent for ₹300-500/day. An international or Indian driving license is required." },
    { "icon": "💊", "title": "Stay Hydrated", "description": "Goa sun is intense. Drink 3+ litres of water daily and carry ORS packets if you plan water sports." },
    { "icon": "🏖️", "title": "North vs South Goa", "description": "North Goa (Baga, Calangute) is lively and touristy. South Goa (Palolem, Agonda) is quieter and more natural. Plan accordingly." },
    { "icon": "🌙", "title": "Avoid Peak Season Rush", "description": "Christmas and New Year weeks see prices triple. Book accommodation 2-3 months in advance if travelling in December." },
    { "icon": "💳", "title": "Carry Cash", "description": "Many beach shacks and local vendors don't accept cards. Always keep ₹2,000-3,000 cash on hand." }
  ]
}

Now generate the ACTUAL trip based on: "${userMsg}"
Return ONLY the JSON object. Fill ALL fields with real, accurate information for the destination. Make the itinerary have the correct number of days as requested.`;
}

function getMockTripResponse(userMsg) {
    const destinationMatch = userMsg.match(/to\s+([^,]+(?:,\s*[^,]+)?)/i);
    const destination = destinationMatch ? destinationMatch[1].trim() : 'Goa, India';
    const daysMatch = userMsg.match(/(\d+)\s*[-+]?\s*day/i);
    const days = daysMatch ? Math.max(2, Math.min(10, Number(daysMatch[1]))) : 5;
    const title = `🌴 ${days} Day${days === 1 ? '' : 's'} in ${destination}`;
    const summary = `A flexible ${days}-day trip plan for ${destination}, including local highlights, budget guidance, and weather-aware recommendations.`;

    const itinerary = Array.from({ length: days }, (_, idx) => {
        const day = idx + 1;
        return {
            day,
            date: '',
            title: day === 1 ? 'Arrival & Orientation' : day === days ? 'Departure Day' : `Explore Day ${day}`,
            theme: day === 1 ? 'Intro' : day === days ? 'Wrap Up' : 'Sightseeing',
            timeBlocks: [
                { time: '09:00 AM', activity: 'Breakfast and start', description: 'Enjoy a local breakfast and prepare for the day ahead.', tags: ['Food', 'Planning'] },
                { time: '11:00 AM', activity: 'Major sightseeing', description: 'Visit a headline attraction or landmark nearby.', tags: ['Sightseeing'] },
                { time: '01:30 PM', activity: 'Lunch stop', description: 'Try a recommended local restaurant or street food spot.', tags: ['Food'] },
                { time: '03:30 PM', activity: 'Afternoon activity', description: 'Continue exploring with a relaxing or adventure activity.', tags: ['Activity'] },
                { time: '07:30 PM', activity: 'Dinner and evening', description: 'Finish the day with dinner at a well-rated local spot.', tags: ['Food', 'Evening'] }
            ]
        };
    });

    const mock = {
        isMockFallback: true,
        tripTitle: title,
        destination,
        duration: `${days} Days`,
        travellers: 'Couple',
        budgetLevel: 'Moderate',
        style: 'Balanced travel',
        summary,
        quickStats: {
            totalEstimatedCost: '₹35,000',
            perPersonCost: '₹17,500 per person',
            bestTimeToVisit: 'November to February',
            difficulty: 'Easy'
        },
        itinerary,
        budget: {
            totalMin: '₹30,000',
            totalMax: '₹40,000',
            perPersonMin: '₹15,000',
            perPersonMax: '₹20,000',
            breakdown: [
                { category: 'Flights', icon: '✈️', amount: '₹12,000', percentage: 34 },
                { category: 'Accommodation', icon: '🏨', amount: '₹12,000', percentage: 34 },
                { category: 'Food & Dining', icon: '🍽️', amount: '₹6,000', percentage: 17 },
                { category: 'Activities', icon: '🎭', amount: '₹4,000', percentage: 11 },
                { category: 'Local transport', icon: '🚗', amount: '₹2,000', percentage: 6 }
            ],
            savingTips: [
                'Book flights and accommodation in advance for the best rates.',
                'Use public transport or shared rides around the city.',
                'Choose local eateries for authentic meals at lower prices.'
            ]
        },
        weather: {
            season: 'Dry season',
            temperature: '22°C – 32°C',
            conditions: 'Mostly sunny with warm afternoons',
            emoji: '☀️',
            humidity: '60%',
            rainfall: 'Low',
            windSpeed: '12 km/h',
            uvIndex: 'High',
            description: `Comfortable travel weather with mostly clear skies and warm days in ${destination}.`, 
            packingList: ['🕶️ Sunglasses', '🧴 Sunscreen', '👟 Comfortable shoes', '👕 Light layers', '📱 Power bank']
        },
        food: {
            restaurants: [
                { name: 'Local favorite cafe', cuisine: 'Regional cuisine', rating: '4.5 ⭐', priceRange: '₹₹', description: 'A popular spot for local specialties and casual meals.' },
                { name: 'Signature restaurant', cuisine: 'Contemporary local', rating: '4.4 ⭐', priceRange: '₹₹₹', description: 'Well-reviewed restaurant with a curated regional menu.' }
            ],
            mustTryDishes: [
                { emoji: '🍛', name: 'Local specialty dish', description: 'A delicious and authentic regional meal.' },
                { emoji: '🥤', name: 'Popular drink', description: 'A refreshing beverage commonly enjoyed by locals.' }
            ]
        },
        tips: [
            { icon: '🛵', title: 'Use local transport', description: 'Choose local buses or shared taxis to save money and move quickly.' },
            { icon: '💳', title: 'Carry local cash', description: 'Small vendors often prefer cash for quick payments.' },
            { icon: '📅', title: 'Plan peak days', description: 'Reserve the busiest attractions or restaurants one day in advance.' }
        ]
    };

    return JSON.stringify(mock);
}

// ══════════════════ PARSE TRIP JSON ══════════════════
function tryParseTrip(text) {
    // Strip markdown code fences
    let clean = text.trim();
    clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    // Find first { to last }
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) return null;

    const jsonStr = clean.slice(start, end + 1);
    try {
        const obj = JSON.parse(jsonStr);
        // Only accept if it has itinerary array
        if (obj && Array.isArray(obj.itinerary) && obj.itinerary.length > 0) {
            return obj;
        }
        return null;
    } catch (e) {
        console.warn('JSON parse failed:', e.message);
        return null;
    }
}

// ══════════════════ RENDER MESSAGES ══════════════════
function renderMessages(messages) {
    const container = document.getElementById('chat-messages');
    container.innerHTML = messages.map(m => buildMsgHTML(m)).join('');
}

function buildMsgHTML(msg) {
    if (msg.role === 'user') {
        return `<div class="msg-row user-row">
            <div class="msg-avatar user-avatar">👤</div>
            <div class="msg-content">
                <div class="msg-name">You</div>
                <div class="msg-bubble user-bubble">${escHtml(msg.text)}</div>
            </div>
        </div>`;
    }
    // AI message with trip card
    if (msg.tripData) {
        return `<div class="msg-row">
            <div class="msg-avatar ai-avatar">✈</div>
            <div class="msg-content" style="max-width:640px;width:100%">
                <div class="msg-name">WanderAI</div>
                <div class="msg-bubble ai-bubble" style="width:100%">
                    ${buildTripCardHTML(msg.tripData, msg.id)}
                </div>
            </div>
        </div>`;
    }
    // AI plain text
    return `<div class="msg-row">
        <div class="msg-avatar ai-avatar">✈</div>
        <div class="msg-content">
            <div class="msg-name">WanderAI</div>
            <div class="msg-bubble ai-bubble">${fmtMarkdown(msg.text)}</div>
        </div>
    </div>`;
}

function buildTripCardHTML(data, msgId) {
    const days = (data.itinerary || []).slice(0, 5);
    const qs = data.quickStats || {};
    const safeId = String(msgId).replace('.', '_');

    return `<div class="trip-response">
        ${data.isMockFallback ? `<div class="mock-fallback-banner" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:10px">⚠️ AI is temporarily unavailable — showing a sample itinerary, not one generated for your specific request. Please try again shortly.</div>` : ''}
        <div class="trip-overview-bar">
            <div style="flex:1">
                <div class="to-title">${escHtml(data.tripTitle || data.destination)}</div>
                <div class="to-summary" style="margin-top:6px">${escHtml(data.summary || '')}</div>
            </div>
            <div class="to-meta" style="flex-shrink:0">
                <span class="to-tag">${escHtml(data.duration || '')}</span>
                ${qs.totalEstimatedCost ? `<span class="to-tag green">${escHtml(qs.totalEstimatedCost)}</span>` : ''}
                ${data.weather && data.weather.season ? `<span class="to-tag amber">${escHtml(data.weather.season)}</span>` : ''}
            </div>
        </div>
        ${days.length ? `<div class="day-preview-strip">
            ${days.map(d => `<div class="day-chip">
                <div class="day-chip-num">Day ${d.day}</div>
                <div class="day-chip-title">${escHtml(d.title || '')}</div>
                <div class="day-chip-sub">${escHtml(d.theme || '')}</div>
            </div>`).join('')}
            ${data.itinerary.length > 5 ? `<div class="day-chip" style="opacity:0.5;display:flex;align-items:center;justify-content:center">+${data.itinerary.length - 5} more</div>` : ''}
        </div>` : ''}
        <button class="view-plan-btn" data-msg-id="${escHtml(safeId)}">
            📋 View Full Itinerary & Details
        </button>
    </div>`;
}

// Store tripData by safeId for panel access
const tripDataMap = {};

function showDetailPanel(safeId) {
    const data = tripDataMap[safeId];
    if (!data) {
        if (State.currentTrip) {
            populateResultsPanel(State.currentTrip);
        }
        return;
    }
    populateResultsPanel(data);
    document.getElementById('results-panel').classList.remove('closed');
}

// ══════════════════ TYPING INDICATOR ══════════════════
function showTyping() {
    const c = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'msg-row';
    el.id = 'typing-row';
    el.innerHTML = `<div class="msg-avatar ai-avatar">✈</div>
        <div class="msg-content">
            <div class="msg-name">WanderAI</div>
            <div class="msg-bubble ai-bubble">
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        </div>`;
    c.appendChild(el);
    scrollChatBottom();
}

function removeTyping() {
    const el = document.getElementById('typing-row');
    if (el) el.remove();
}

function scrollChatBottom() {
    const cw = document.getElementById('chat-window');
    if (cw) cw.scrollTop = cw.scrollHeight;
}

// ══════════════════ RESULTS PANEL ══════════════════
function populateResultsPanel(data) {
    if (!data) return;
    State.currentTrip = data;

    document.getElementById('rp-title').textContent = data.tripTitle || data.destination || 'Trip Details';
    document.getElementById('results-panel').classList.remove('closed');

    // Default: itinerary tab
    const firstTab = document.querySelector('.rp-tab[data-tab="itinerary"]');
    document.querySelectorAll('.rp-tab').forEach(b => b.classList.remove('active'));
    if (firstTab) firstTab.classList.add('active');
    document.getElementById('rp-body').innerHTML = renderRPItinerary(data);
}

function resetResultsPanel() {
    document.getElementById('rp-body').innerHTML = `<div class="rp-empty"><span>🗺️</span><p>Generate a trip to see your detailed plan here</p></div>`;
    document.getElementById('rp-title').textContent = 'Trip Details';
}

function closeResultsPanel() {
    document.getElementById('results-panel').classList.add('closed');
}

function rpSwitchTab(tabId, btn) {
    document.querySelectorAll('.rp-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const data = getActiveTrip()?.tripData || State.currentTrip;
    if (!data) {
        document.getElementById('rp-body').innerHTML = `<div class="rp-empty"><span>🗺️</span><p>No trip data yet. Ask WanderAI to plan a trip!</p></div>`;
        return;
    }

    const body = document.getElementById('rp-body');
    switch (tabId) {
        case 'itinerary': body.innerHTML = renderRPItinerary(data); break;
        case 'budget':    body.innerHTML = renderRPBudget(data);    break;
        case 'weather':   body.innerHTML = renderRPWeather(data);   break;
        case 'food':      body.innerHTML = renderRPFood(data);      break;
        case 'map':       body.innerHTML = renderRPMapLoading(); loadRPMap(data); break;
        case 'tips':      body.innerHTML = renderRPTips(data);      break;
        default:          body.innerHTML = renderRPItinerary(data); break;
    }
}

// ── Itinerary ──
function renderRPItinerary(data) {
    const days = data.itinerary || [];
    const banner = data.isMockFallback
        ? `<div class="mock-fallback-banner" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;font-size:12px;margin:0 0 10px">⚠️ AI is temporarily unavailable — this is a sample itinerary, not one generated for your specific request.</div>`
        : '';
    if (!days.length) return banner + '<p style="color:var(--text-muted);font-size:13px;padding:10px">No itinerary data.</p>';
    return banner + days.map((day, i) => `
        <div class="rp-day-card">
            <div class="rp-day-header" onclick="toggleRPDay(${i})">
                <div class="rp-day-num">D${day.day}</div>
                <div class="rp-day-info">
                    <div class="rp-day-title">${escHtml(day.title || 'Day ' + day.day)}</div>
                    <div class="rp-day-theme">${escHtml(day.theme || '')}</div>
                </div>
                <div class="rp-day-toggle" id="rp-toggle-${i}">${i === 0 ? '⌄' : '›'}</div>
            </div>
            <div class="rp-day-body ${i === 0 ? 'open' : ''}" id="rp-day-${i}">
                ${(day.timeBlocks || []).map(tb => `
                    <div class="rp-time-row">
                        <div class="rp-time-lbl">${escHtml(tb.time || '')}</div>
                        <div>
                            <div class="rp-time-act">${escHtml(tb.activity || '')}</div>
                            <div class="rp-time-desc">${escHtml(tb.description || '')}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function toggleRPDay(i) {
    const body = document.getElementById(`rp-day-${i}`);
    const toggle = document.getElementById(`rp-toggle-${i}`);
    if (!body) return;
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    if (toggle) toggle.textContent = isOpen ? '›' : '⌄';
}

// ── Budget ──
function renderRPBudget(data) {
    const b = data.budget || {};
    const breakdown = b.breakdown || [];
    const tips = b.savingTips || [];
    return `<div class="rp-budget-total">
        <div class="rp-bt-label">Estimated Total Cost</div>
        <div class="rp-bt-amount">${escHtml(b.totalMin || '—')} – ${escHtml(b.totalMax || '—')}</div>
        <div class="rp-bt-sub">${escHtml(b.perPersonMin || '')} – ${escHtml(b.perPersonMax || '')} per person</div>
    </div>
    <div class="rp-section-title">Cost Breakdown</div>
    ${breakdown.map(item => `
        <div class="rp-bar-row">
            <div class="rp-bar-header">
                <span class="rp-bar-cat">${escHtml(item.icon || '')} ${escHtml(item.category)}</span>
                <span class="rp-bar-val">${escHtml(item.amount)}</span>
            </div>
            <div class="rp-bar-track"><div class="rp-bar-fill" style="width:${Number(item.percentage)||0}%"></div></div>
        </div>
    `).join('')}
    ${tips.length ? `<div class="rp-section-title">💡 Money Saving Tips</div>
    ${tips.map(t => `<div class="rp-tip-card"><div class="rp-tip-icon">💰</div><div><div class="rp-tip-desc">${escHtml(t)}</div></div></div>`).join('')}` : ''}`;
}

// ── Weather ──
function renderRPWeather(data) {
    const w = data.weather || {};
    const packing = w.packingList || [];
    return `<div class="rp-weather-card">
        <div class="rp-w-top">
            <div class="rp-w-emoji">${w.emoji || '🌤️'}</div>
            <div>
                <div class="rp-w-temp">${escHtml(w.temperature || '—')}</div>
                <div class="rp-w-cond">${escHtml(w.conditions || w.season || '—')}</div>
            </div>
        </div>
        ${w.description ? `<p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px">${escHtml(w.description)}</p>` : ''}
        <div class="rp-w-grid">
            <div class="rp-w-item"><div class="rp-w-item-lbl">Humidity</div><div class="rp-w-item-val">💧 ${escHtml(w.humidity || '—')}</div></div>
            <div class="rp-w-item"><div class="rp-w-item-lbl">Rainfall</div><div class="rp-w-item-val">🌧️ ${escHtml(w.rainfall || '—')}</div></div>
            <div class="rp-w-item"><div class="rp-w-item-lbl">Wind</div><div class="rp-w-item-val">💨 ${escHtml(w.windSpeed || '—')}</div></div>
            <div class="rp-w-item"><div class="rp-w-item-lbl">UV Index</div><div class="rp-w-item-val">☀️ ${escHtml(w.uvIndex || '—')}</div></div>
        </div>
    </div>
    ${packing.length ? `<div class="rp-section-title">🧳 Packing List</div>
    <div class="rp-pack-grid">
        ${packing.map(p => `<span class="rp-pack-tag">${escHtml(p)}</span>`).join('')}
    </div>` : ''}`;
}

// ── Food ──
function renderRPFood(data) {
    const food = data.food || {};
    const restaurants = food.restaurants || [];
    const dishes = food.mustTryDishes || [];
    return `${restaurants.length ? `<div class="rp-section-title">🍴 Top Restaurants</div>
    ${restaurants.map(r => `<div class="rp-rest-card">
        <div class="rp-rest-top">
            <div class="rp-rest-name">${escHtml(r.name)}</div>
            <div class="rp-rest-rating">${escHtml(r.rating || '')}</div>
        </div>
        <div class="rp-rest-cuisine">${escHtml(r.cuisine)}</div>
        <div class="rp-rest-desc">${escHtml(r.description || '')}</div>
        <div class="rp-rest-price">💰 ${escHtml(r.priceRange || '')}</div>
    </div>`).join('')}` : ''}
    ${dishes.length ? `<div class="rp-section-title">🌟 Must-Try Dishes</div>
    ${dishes.map(d => `<div class="rp-dish-row">
        <div class="rp-dish-emoji">${d.emoji || '🍽️'}</div>
        <div>
            <div class="rp-dish-name">${escHtml(d.name)}</div>
            <div class="rp-dish-desc">${escHtml(d.description || '')}</div>
        </div>
    </div>`).join('')}` : ''}`;
}

// ── Map ──
// Free, no-API-key map: Leaflet + OpenStreetMap tiles for rendering, and
// OSM's Nominatim for geocoding place names into coordinates. Nominatim's
// usage policy caps casual/browser use at ~1 request/second and requires
// attribution, both of which this respects (sequential lookups with a
// delay, and a visible "Map data © OpenStreetMap" credit). For real
// production traffic at scale, this should go through a small backend
// proxy with its own caching instead of calling Nominatim from the
// browser directly — fine for this app's expected usage today.
const geocodeCache = {};
let rpMap = null;
let rpMapClusterGroup = null;

const MAP_CATEGORY_STYLE = {
    Restaurant:    { emoji: '🍽️', color: '#f97316' },
    Accommodation: { emoji: '🏨', color: '#8b5cf6' },
    Attraction:    { emoji: '📍', color: '#10b981' },
    Transport:     { emoji: '🚗', color: '#64748b' },
    Destination:   { emoji: '🏁', color: '#3b82f6' },
};
const MAP_DAY_COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#84cc16'];
const colorForDay = (dayNum) => MAP_DAY_COLORS[(dayNum - 1) % MAP_DAY_COLORS.length];

// Teardrop-shaped divIcon, colored + emoji'd per category, so restaurants,
// hotels, attractions and transport are visually distinct at a glance
// instead of sharing the same default pin.
function mapDivIcon(category) {
    const style = MAP_CATEGORY_STYLE[category] || MAP_CATEGORY_STYLE.Attraction;
    return L.divIcon({
        className: 'wander-map-pin',
        html: `<div style="background:${style.color};width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.4);border:2px solid #fff"><span style="transform:rotate(45deg);font-size:13px">${style.emoji}</span></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26],
        popupAnchor: [0, -26],
    });
}

async function geocodePlace(query) {
    if (query in geocodeCache) return geocodeCache[query];
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) { geocodeCache[query] = null; return null; }
        const results = await res.json();
        const hit = (results && results[0]) ? { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) } : null;
        geocodeCache[query] = hit;
        return hit;
    } catch (e) {
        geocodeCache[query] = null;
        return null;
    }
}

// Infers a marker category from a time block's tags/text — used for
// marker styling and the category filter checkboxes.
function categorizeTimeBlock(tb) {
    const tags = (tb.tags || []).map(t => String(t).toLowerCase());
    const text = (tb.activity || '').toLowerCase();
    if (tags.includes('food')) return 'Restaurant';
    if (tags.includes('check-in') || /hotel|resort|guesthouse|hostel|check.?in/.test(text)) return 'Accommodation';
    if (tags.includes('transport')) return 'Transport';
    return 'Attraction';
}

// Every restaurant and every itinerary activity gets geocoded — no cap.
// Restaurants aren't tied to a specific day (day: null), so they always
// show regardless of the day filter; itinerary activities carry their day
// number for route-line grouping and the day filter checkboxes.
function collectMapPlaces(data) {
    const places = [];
    const seen = new Set();
    const add = (name, category, day) => {
        const clean = (name || '').trim();
        if (!clean) return;
        const key = `${clean.toLowerCase()}|${day ?? ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        places.push({ name: clean, category, day: day ?? null });
    };
    (data.food?.restaurants || []).forEach(r => add(r.name, 'Restaurant', null));
    (data.itinerary || []).forEach(day => {
        (day.timeBlocks || []).forEach(tb => add(tb.activity, categorizeTimeBlock(tb), day.day));
    });
    return places;
}

function renderRPMapLoading(doneCount, totalCount) {
    const progress = totalCount ? `<br><span style="font-size:11px;opacity:0.7">${doneCount} of ${totalCount} located…</span>` : '';
    return `<div id="rp-map-container" style="height:360px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--bg-tertiary,#1a1a1a);color:var(--text-muted);font-size:13px;text-align:center;padding:20px">📍 Locating recommended places on the map…${progress}</div>`;
}

async function loadRPMap(data) {
    const places = collectMapPlaces(data);
    const destQuery = data.destination || data.tripTitle || '';
    const isStillOnMapTab = () => document.querySelector('.rp-tab.active')?.dataset.tab === 'map';
    const body = document.getElementById('rp-body');

    const destGeo = destQuery ? await geocodePlace(destQuery) : null;
    if (!isStillOnMapTab()) return;

    const found = [];
    for (const p of places) {
        if (!isStillOnMapTab()) return;
        const geo = await geocodePlace(`${p.name}, ${destQuery}`);
        if (geo) found.push({ ...p, ...geo });
        body.innerHTML = renderRPMapLoading(found.length, places.length);
        await new Promise(r => setTimeout(r, 1100)); // respect Nominatim's ~1 req/sec policy
    }
    if (!isStillOnMapTab()) return;

    if (!destGeo && !found.length) {
        body.innerHTML = `<div class="rp-empty"><span>🗺️</span><p>Couldn't locate any places on the map for this trip.</p></div>`;
        return;
    }

    const daysPresent = [...new Set(found.filter(r => r.day != null).map(r => r.day))].sort((a, b) => a - b);
    const categoriesPresent = [...new Set(found.map(r => r.category))];

    body.innerHTML = `
        <div id="rp-map-filters" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
            ${daysPresent.map(d => `<label style="display:flex;align-items:center;gap:4px;background:var(--bg-tertiary,#222);padding:3px 9px;border-radius:12px;cursor:pointer;font-size:11px"><input type="checkbox" checked data-filter-day="${d}">Day ${d}</label>`).join('')}
            ${categoriesPresent.map(c => `<label style="display:flex;align-items:center;gap:4px;background:var(--bg-tertiary,#222);padding:3px 9px;border-radius:12px;cursor:pointer;font-size:11px"><input type="checkbox" checked data-filter-cat="${escHtml(c)}">${MAP_CATEGORY_STYLE[c]?.emoji || ''} ${escHtml(c)}</label>`).join('')}
        </div>
        <div id="rp-map-container" style="height:360px;border-radius:10px;overflow:hidden"></div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px">📍 ${found.length} of ${places.length} places located · Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</p>`;

    if (rpMap) { rpMap.remove(); rpMap = null; rpMapClusterGroup = null; }
    const map = L.map('rp-map-container');
    rpMap = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
    }).addTo(map);

    // Markers live inside a cluster group so dense areas (e.g. 10
    // restaurants in one city center) collapse into a single badge until
    // zoomed in, instead of overlapping illegibly.
    const clusterGroup = L.markerClusterGroup();
    rpMapClusterGroup = clusterGroup;
    const markerLayers = [];   // { layer, day, category } — for filtering
    const polylineLayers = []; // { layer, day }
    const boundsPoints = [];

    if (destGeo) {
        L.marker([destGeo.lat, destGeo.lon], { icon: mapDivIcon('Destination') })
            .addTo(map)
            .bindPopup(`<b>${escHtml(data.destination || 'Destination')}</b>`);
        boundsPoints.push([destGeo.lat, destGeo.lon]);
    }

    found.forEach(r => {
        const marker = L.marker([r.lat, r.lon], { icon: mapDivIcon(r.category) })
            .bindPopup(`<b>${escHtml(r.name)}</b><br>${escHtml(r.category)}${r.day != null ? ` · Day ${r.day}` : ''}`);
        clusterGroup.addLayer(marker);
        markerLayers.push({ layer: marker, day: r.day, category: r.category });
        boundsPoints.push([r.lat, r.lon]);
    });
    map.addLayer(clusterGroup);

    // Day-by-day route lines: connect each day's stops in the order they
    // appear in the itinerary, color-coded per day, so the map shows an
    // actual travel path rather than just scattered pins.
    const byDay = {};
    found.forEach(r => { if (r.day != null) (byDay[r.day] ||= []).push(r); });
    Object.entries(byDay).forEach(([day, pts]) => {
        if (pts.length < 2) return;
        const polyline = L.polyline(pts.map(p => [p.lat, p.lon]), {
            color: colorForDay(Number(day)), weight: 3, opacity: 0.7, dashArray: '6,5',
        }).addTo(map);
        polylineLayers.push({ layer: polyline, day: Number(day) });
    });

    if (boundsPoints.length > 1) map.fitBounds(boundsPoints, { padding: [30, 30] });
    else if (boundsPoints.length === 1) map.setView(boundsPoints[0], 12);
    else map.setView([20, 0], 2);

    // Day/category filter checkboxes toggle marker + route visibility.
    // Restaurants (day === null) always respect the category filter but
    // ignore the day filter, since they aren't tied to one day.
    function applyMapFilters() {
        const activeDays = new Set([...document.querySelectorAll('[data-filter-day]:checked')].map(c => Number(c.dataset.filterDay)));
        const activeCats = new Set([...document.querySelectorAll('[data-filter-cat]:checked')].map(c => c.dataset.filterCat));

        markerLayers.forEach(({ layer, day, category }) => {
            const show = (day == null || activeDays.has(day)) && activeCats.has(category);
            const has = clusterGroup.hasLayer(layer);
            if (show && !has) clusterGroup.addLayer(layer);
            if (!show && has) clusterGroup.removeLayer(layer);
        });
        polylineLayers.forEach(({ layer, day }) => {
            const show = activeDays.has(day);
            const has = map.hasLayer(layer);
            if (show && !has) layer.addTo(map);
            if (!show && has) map.removeLayer(layer);
        });
    }

    const filtersEl = document.getElementById('rp-map-filters');
    if (filtersEl) filtersEl.addEventListener('change', applyMapFilters);
}

// ── Tips ──
function renderRPTips(data) {
    const tips = data.tips || [];
    if (!tips.length) return '<p style="color:var(--text-muted);font-size:13px;padding:10px">No tips available.</p>';
    return tips.map(t => `<div class="rp-tip-card">
        <div class="rp-tip-icon">${t.icon || '💡'}</div>
        <div>
            <div class="rp-tip-title">${escHtml(t.title || '')}</div>
            <div class="rp-tip-desc">${escHtml(t.description || '')}</div>
        </div>
    </div>`).join('');
}

// ══════════════════ EXPORT / PRINT ══════════════════
function exportTrip() {
    const data = getActiveTrip()?.tripData || State.currentTrip;
    if (!data) { showToast('No trip to export'); return; }
    let out = `✈️ ${data.tripTitle}\n${'='.repeat(50)}\n${data.summary || ''}\n\n`;
    out += `Duration: ${data.duration} | Budget: ${data.quickStats?.totalEstimatedCost || ''}\n\n`;
    (data.itinerary || []).forEach(d => {
        out += `DAY ${d.day}: ${d.title}\n${'─'.repeat(40)}\n`;
        (d.timeBlocks || []).forEach(b => out += `  ${b.time}  ${b.activity}\n  ${b.description}\n\n`);
    });
    navigator.clipboard.writeText(out).then(() => showToast('📋 Copied to clipboard!')).catch(() => showToast('❌ Could not copy'));
}

function printTrip() { window.print(); }

// ══════════════════ UTILITIES ══════════════════
function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmtMarkdown(text) {
    if (!text) return '';
    return '<p>' + escHtml(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>') + '</p>';
}

let toastTimer;
function showToast(msg, dur = 3500) {
    const el = document.getElementById('toast');
    if (!el) return;
    document.getElementById('toast-msg').textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), dur);
}

// ══════════════════ DELEGATED EVENT LISTENERS ══════════════════
// Sidebar trip items and "view plan" buttons are re-created on every
// render via innerHTML, so their click handling is attached once to the
// stable parent container (which is never itself replaced) rather than
// as inline onclick="fn('${value}')" attributes. That avoids embedding
// dynamic values as JS source text inside an HTML attribute — safe today
// since these IDs are always timestamp/random-number based, but a
// fragile pattern to build on if a future ID ever contains a quote.
function initDelegatedListeners() {
    const sbTrips = document.getElementById('sb-trips');
    if (sbTrips) {
        sbTrips.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                const id = actionBtn.dataset.tripId;
                if (actionBtn.dataset.action === 'delete') deleteTrip(id);
                else if (actionBtn.dataset.action === 'rename') startRenameTrip(id);
                return;
            }
            if (e.target.closest('.sb-trip-rename-input')) return;
            const item = e.target.closest('.sb-trip-item');
            if (item && item.dataset.tripId) setActiveTrip(item.dataset.tripId);
        });

        sbTrips.addEventListener('focusout', (e) => {
            const input = e.target.closest('.sb-trip-rename-input');
            if (input) commitRenameTrip(input.dataset.tripId, input.value);
        });

        sbTrips.addEventListener('keydown', (e) => {
            const input = e.target.closest('.sb-trip-rename-input');
            if (!input) return;
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            else if (e.key === 'Escape') { renamingTripId = null; renderSidebar(); }
        });
    }

    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) {
        chatMessages.addEventListener('click', (e) => {
            const btn = e.target.closest('.view-plan-btn');
            if (btn && btn.dataset.msgId) showDetailPanel(btn.dataset.msgId);
        });
    }
}

// ══════════════════ INIT ══════════════════
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    initDelegatedListeners();
});

// Patch pushMsg after definition
function pushMsg(trip, role, text, tripData) {
    const id = Date.now() + Math.random();
    trip.messages.push({ role, text, tripData, id });
    if (tripData) {
        const safeId = String(id).replace('.', '_');
        tripDataMap[safeId] = tripData;
    }
}
