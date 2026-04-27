// ── Firebase Initialization (login page) ─────────────────────
const _loginFirebaseConfig = {
    apiKey: "AIzaSyBclTC8gK3QKi1X6Q-YCK2jT38yJ83xOcQ",
    authDomain: "chat-app-a0f95.firebaseapp.com",
    projectId: "chat-app-a0f95",
    storageBucket: "chat-app-a0f95.appspot.com",
    messagingSenderId: "754786153113",
    appId: "1:754786153113:web:7543bfb097732ad229fe08",
    measurementId: "G-JFKWR83KYJ"
};

if (!firebase.apps.length) {
    firebase.initializeApp(_loginFirebaseConfig);
}

const auth = firebase.auth();

// ── Loading overlay — hides the login card while Firebase checks for a
//    persisted session. Removed as soon as we know there is no active user.
//    Without this the login button flashes briefly on every browser open
//    even when the user is already signed in and about to be redirected.
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
        await auth.signOut();
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
        await auth.signOut();
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
        const result   = await auth.signInWithPopup(provider);
        await sendLoginOtp(result.user);
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please try again.');
    }
};

// ── Bootstrap: setPersistence MUST complete before onAuthStateChanged is
//    registered. If we register the listener first, Firebase may restore the
//    session under the wrong persistence type (SESSION instead of LOCAL),
//    meaning the session dies when the browser tab closes.
//
//    Flow on every page load:
//      1. Overlay shown (login card hidden underneath).
//      2. setPersistence(LOCAL) completes.
//      3. onAuthStateChanged fires:
//         a. user == null  → no session → remove overlay, show login card.
//         b. user exists + isLoginVerified → redirect to chat.html silently.
//         c. user exists but NOT verified → OTP not done yet (e.g. localStorage
//            cleared) → show OTP modal on top of overlay.
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(err => console.warn('Firebase persistence setup failed:', err))
    .finally(() => {
        auth.onAuthStateChanged(user => {
            if (!user) {
                // No active session — reveal the login card.
                hideLoadingOverlay();
                return;
            }

            if (isLoginVerified(user.uid)) {
                // Active session + OTP already verified on this device →
                // skip login entirely and go straight to the app.
                window.location.href = 'chat.html';
                return;
            }

            // Active Firebase session but localStorage flag missing
            // (cleared storage, new device, etc.) — require OTP again.
            hideLoadingOverlay();
            sendLoginOtp(user);
        });
    });
