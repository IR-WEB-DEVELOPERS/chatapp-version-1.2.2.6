// ============================================================
//  globals.js — Shared state, Firebase init, utility helpers
// ============================================================

// ── Firebase Initialization ──────────────────────────────────
// Config is injected by the server into window.__ENV__ (see server.js
// buildEnvScript) so no values are ever hardcoded in source files.
const firebaseConfig = {
    apiKey:            window.__ENV__?.FIREBASE_API_KEY             || '',
    authDomain:        window.__ENV__?.FIREBASE_AUTH_DOMAIN         || '',
    projectId:         window.__ENV__?.FIREBASE_PROJECT_ID          || '',
    storageBucket:     window.__ENV__?.FIREBASE_STORAGE_BUCKET      || '',
    messagingSenderId: window.__ENV__?.FIREBASE_MESSAGING_SENDER_ID || '',
    appId:             window.__ENV__?.FIREBASE_APP_ID              || '',
    measurementId:     window.__ENV__?.FIREBASE_MEASUREMENT_ID      || '',
};
// Expose as a single source of truth for other scripts (e.g. pushNotifications.js)
window._firebaseConfig = firebaseConfig;

console.log('Initializing Firebase...');
try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    } else {
        firebase.app();
    }
    console.log('Firebase initialized successfully');
} catch (error) {
    console.error('Firebase initialization error:', error);
}

const auth = firebase.auth();
const db   = firebase.firestore();

// ── Global App State ─────────────────────────────────────────
let currentUser     = null;
let currentUserData = null;
let chatWithUID     = null;
let groupChatID     = null;
let unreadMap       = {};
let activeTab       = 'chats';
let notificationPermissionRequested = false;
let isGroupInfoOpen = false;
let unsubscribeDirectMessages = null;
let unsubscribeGroupMessages  = null;

// Pagination state
const MSG_PAGE_SIZE       = 30;
let directMsgLastDoc      = null;
let directMsgAllLoaded    = false;
let directMsgLoadingOlder = false;
let groupMsgLastDoc       = null;
let groupMsgAllLoaded     = false;

// Presence
let presencePollInterval = null;
const PRESENCE_POLL_MS   = 5 * 60 * 1000;

// Reply state
let replyingTo = null; // { id, text, senderName }

// Typing indicator
let typingTimeout      = null;
let unsubscribeTyping  = null;

// Pinned messages
let pinnedMessages = {};

// Voice recording
let mediaRecorder     = null;
let audioChunks       = [];
let isRecording       = false;
let recordingTimer    = null;
let recordingSeconds  = 0;

// WebRTC
let webRTCManager    = null;
let signalingManager = null;

// Friends presence
let friendsPresenceUnsubscribers = [];

// ── Escape helpers ──────────────────────────────────────────
function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
    return escapeHTML(value);
}

// ── Chat ID helper ──────────────────────────────────────────
function generateChatId(uid1, uid2) {
    return [uid1, uid2].sort().join('_');
}

function generateUsername(name) {
    return name.toLowerCase().replace(/\s/g, '') + Math.floor(Math.random() * 1000);
}

// ── Status helpers ──────────────────────────────────────────
function statusDotColor(status) {
    if (status === 'online') return '#22c55e';
    if (status === 'away')   return '#f59e0b';
    return '#9ca3af';
}

function formatStatus(status, lastSeen) {
    if (status === 'online') return '\u{1F7E2} Online';
    if (status === 'away')   return '\u{1F7E1} Away';
    if (lastSeen) {
        const date = lastSeen?.toDate ? lastSeen.toDate() : new Date(lastSeen);
        const diff = Math.floor((Date.now() - date.getTime()) / 60000);
        if (diff < 1)    return '\u26AB Just now';
        if (diff < 60)   return '\u26AB ' + diff + 'm ago';
        if (diff < 1440) return '\u26AB ' + Math.floor(diff / 60) + 'h ago';
    }
    return '\u26AB Offline';
}

function getDateLabel(date) {
    const now       = new Date();
    const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (msgDay.getTime() === today.getTime())     return 'Today';
    if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Toast shorthand (used by autoBackup + loadArchivedMessages) ──
function showToast(msg, type = 'info') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    if (window.toastManager) {
        window.toastManager.show({
            icon: icons[type] || 'ℹ️',
            title: msg,
            body: '',
            type: 'message',
            duration: 3500
        });
    }
}

// ── Enhanced cache (localStorage + TTL) ─────────────────────
const enhancedCache = {
    set(key, data, ttl = 60 * 60 * 1000) {
        try {
            localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + ttl }));
        } catch (e) { console.log('Cache set error:', e); }
    },
    get(key) {
        try {
            const item = localStorage.getItem(key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            if (Date.now() > parsed.expiry) { this.remove(key); return null; }
            return parsed.data;
        } catch (e) { console.log('Cache get error:', e); return null; }
    },
    remove(key) {
        try { localStorage.removeItem(key); } catch (e) { /**/ }
    },
    cleanup() {
        Object.keys(localStorage).forEach(key => this.get(key));
    }
};

// ── getUserData (needed by multiple modules) ─────────────────
async function getUserData(uid) {
    const cacheKey = `user_${uid}`;
    const cached   = enhancedCache.get(cacheKey);
    if (cached) return cached;

    try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            enhancedCache.set(cacheKey, userData, 30 * 60 * 1000);
            return userData;
        }
    } catch (error) {
        console.error('Error getting user data:', error);
    }
    return null;
}

// ── Expose globals ───────────────────────────────────────────
window.db             = db;
window.auth           = auth;
window.currentUser    = currentUser;
window.currentUserData = currentUserData;
window.enhancedCache  = enhancedCache;
window.getUserData    = getUserData;
window.escapeHTML     = escapeHTML;
window.escapeAttribute = escapeAttribute;
window.generateChatId = generateChatId;
window.showToast      = showToast;
window.formatStatus   = formatStatus;
window.getDateLabel   = getDateLabel;
window.statusDotColor = statusDotColor;

console.log('globals.js loaded');
