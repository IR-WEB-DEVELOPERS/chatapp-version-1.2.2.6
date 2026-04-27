// ── Loading overlay — shown immediately so the login card never flashes
//    while Firebase is checking for a persisted session.
(function injectLoadingOverlay() {
    const el = document.createElement('div');
    el.id = 'authCheckOverlay';
    el.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:9999',
        'background:var(--bg,#0f172a)',
        'display:flex', 'align-items:center',
        'justify-content:center', 'flex-direction:column', 'gap:16px'
    ].join(';');
    el.innerHTML = `
        <div style="width:44px;height:44px;border:3px solid #6366f1;
             border-top-color:transparent;border-radius:50%;
             animation:_ld_spin 0.7s linear infinite;"></div>
        <p style="color:#94a3b8;font-size:14px;margin:0;">Checking session…</p>
        <style>@keyframes _ld_spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(el);
})();

function hideLoadingOverlay() {
    document.getElementById('authCheckOverlay')?.remove();
}

// ── Firebase init — config comes from window.__ENV__ injected by server.js.
//    No values are hardcoded here; change them only in .env on the server.
const _firebaseConfig = {
    apiKey:            window.__ENV__?.FIREBASE_API_KEY             || '',
    authDomain:        window.__ENV__?.FIREBASE_AUTH_DOMAIN         || '',
    projectId:         window.__ENV__?.FIREBASE_PROJECT_ID          || '',
    storageBucket:     window.__ENV__?.FIREBASE_STORAGE_BUCKET      || '',
    messagingSenderId: window.__ENV__?.FIREBASE_MESSAGING_SENDER_ID || '',
    appId:             window.__ENV__?.FIREBASE_APP_ID              || '',
    measurementId:     window.__ENV__?.FIREBASE_MEASUREMENT_ID      || '',
};

if (!firebase.apps.length) {
    firebase.initializeApp(_firebaseConfig);
}

// ─────────────────────────────────────────────────────────────
const LOGIN_VERIFIED_PREFIX = 'educhat_login_otp_verified_';

let currentOtp       = '';
let currentOtpExpiry = 0;
let resendTimer      = null;
let pendingUser      = null;
let otpSendInFlight  = false;
let lastOtpKey       = '';

function markLoginVerified(uid) {
    localStorage.setItem(`${LOGIN_VERIFIED_PREFIX}${uid}`, 'true');
    localStorage.setItem('educhat_last_verified_uid', uid);
}

function isLoginVerified(uid) {
    return localStorage.getItem(`${LOGIN_VERIFIED_PREFIX}${uid}`) === 'true';
}

function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function ensureOtpModal() {
    let modal = document.getElementById('loginOtpModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'loginOtpModal';
    modal.className = 'login-otp-overlay';
    modal.innerHTML = `
        <div class="login-otp-card">
            <div class="login-otp-header">
                <div>
                    <h3>Email OTP Verification</h3>
                    <p>Enter the 6-digit OTP sent to your email.</p>
                </div>
                <button id="closeLoginOtp" class="login-otp-close" type="button">&times;</button>
            </div>
            <div class="login-otp-body">
                <div class="login-otp-email" id="loginOtpEmail"></div>
                <input id="loginOtpInput" class="login-otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="000000">
                <div id="loginOtpError" class="login-otp-error"></div>
                <button id="verifyLoginOtp" class="login-otp-primary" type="button">Verify OTP</button>
                <button id="resendLoginOtp" class="login-otp-secondary" type="button">Resend OTP</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('closeLoginOtp').addEventListener('click', async () => {
        modal.style.display = 'none';
        clearInterval(resendTimer);
        await firebase.auth().signOut();
        pendingUser     = null;
        otpSendInFlight = false;
        lastOtpKey      = '';
    });
    document.getElementById('verifyLoginOtp').addEventListener('click', verifyLoginOtp);
    document.getElementById('resendLoginOtp').addEventListener('click', () => sendLoginOtp(pendingUser));
    document.getElementById('loginOtpInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verifyLoginOtp();
    });

    return modal;
}

async function sendLoginOtp(user) {
    if (!user?.email) {
        alert('No email found for this account.');
        await firebase.auth().signOut();
        return;
    }
    const existingModal = document.getElementById('loginOtpModal');
    const key = `${user.uid}:${user.email}`;
    if (otpSendInFlight || (lastOtpKey === key && existingModal?.style.display === 'flex')) return;

    otpSendInFlight  = true;
    lastOtpKey       = key;
    pendingUser      = user;
    currentOtp       = '';
    currentOtpExpiry = 0;

    let response;
    try {
        response = await fetch('/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: user.uid, email: user.email, purpose: 'login' })
        }).then(r => r.json());
    } catch (err) {
        console.error('Backend OTP send failed:', err);
        response = { ok: false, error: 'Failed to send OTP. Check SMTP settings.' };
    }

    if (!response?.ok) {
        otpSendInFlight = false;
        lastOtpKey      = '';
        alert(response?.error || 'Failed to send OTP.');
        return;
    }

    const modal = ensureOtpModal();
    document.getElementById('loginOtpEmail').textContent = user.email;
    document.getElementById('loginOtpInput').value       = '';
    document.getElementById('loginOtpError').textContent = '';
    modal.style.display = 'flex';
    document.getElementById('loginOtpInput').focus();
    startResendCountdown();
    otpSendInFlight = false;
}

function startResendCountdown() {
    let seconds = 60;
    const resendBtn = document.getElementById('resendLoginOtp');
    resendBtn.disabled    = true;
    resendBtn.textContent = `Resend OTP (${seconds}s)`;
    clearInterval(resendTimer);
    resendTimer = setInterval(() => {
        seconds--;
        resendBtn.textContent = `Resend OTP (${seconds}s)`;
        if (seconds <= 0) {
            clearInterval(resendTimer);
            resendBtn.disabled    = false;
            resendBtn.textContent = 'Resend OTP';
        }
    }, 1000);
}

async function verifyLoginOtp() {
    const input = (document.getElementById('loginOtpInput')?.value || '').trim();
    const error = document.getElementById('loginOtpError');
    if (!/^\d{6}$/.test(input)) {
        error.textContent = 'Enter a valid 6-digit OTP.';
        return;
    }

    let valid = input === currentOtp && Date.now() < currentOtpExpiry;
    try {
        const result = await fetch('/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uid:     pendingUser.uid,
                email:   pendingUser.email,
                purpose: 'login',
                code:    input
            })
        }).then(r => r.json());
        valid = !!result.ok;
        if (!valid && result.error) error.textContent = result.error;
    } catch (err) {
        console.warn('Backend OTP verify failed, using browser fallback OTP:', err);
    }

    if (!valid) {
        if (!error.textContent) error.textContent = 'Invalid or expired OTP.';
        return;
    }

    clearInterval(resendTimer);
    markLoginVerified(pendingUser.uid);
    window.location.href = 'chat.html';
}

document.getElementById('googleLogin').onclick = async () => {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result   = await firebase.auth().signInWithPopup(provider);
        await sendLoginOtp(result.user);
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please try again.');
    }
};

// ── Bootstrap: setPersistence(LOCAL) first, then watch auth state ─────────
// setPersistence must complete before onAuthStateChanged is registered so
// Firebase restores the session under the correct persistence type.
firebase.auth()
    .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(err => console.warn('Firebase persistence setup failed:', err))
    .finally(() => {
        firebase.auth().onAuthStateChanged(user => {
            if (!user) {
                hideLoadingOverlay();
                return;
            }
            if (isLoginVerified(user.uid)) {
                // Session active + OTP already done → straight to app.
                window.location.href = 'chat.html';
                return;
            }
            // Session exists but OTP flag missing (cleared storage, new device).
            hideLoadingOverlay();
            sendLoginOtp(user);
        });
    });
