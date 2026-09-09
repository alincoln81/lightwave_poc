import { startTorchFlow, leaveTorchFlow, setTorch, getCameraStream } from './camera-torch-access.js';
import { enableWakeLock, disableWakeLock } from './wake-lock.js';
import { onTimeline, clearAllIntervalsAndTimeouts } from './timeline.js';
import { initRecording, handleTouchStart, handleTouchMove, handleTouchEnd, handlePendingMediaClick, clearPendingMediaAndResetUI, hasPendingMedia, registerOnPendingMediaCleared } from './recording.js';
import {
    lw_sync,
    lw_stop,
    lw_isActive,
    lw_applyLightwaveSettings,
    lw_normalizeMode,
    lw_showJoinSection,
    lw_prefillJoinSection,
    lw_captureJoinSection,
    lw_commitJoinSection,
    lw_prepareMotionFromJoin,
} from './lw_mode.js';
/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Socket.IO                                                                                            */
/* --------------------------------------------------------------------------------------------------------------- */
const socket = io();
/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize the connection ID, assets, connection counts, playlist, settings, and programs                       */
/* --------------------------------------------------------------------------------------------------------------- */
const session = {
  assets: null,
  settings: {
    joinButtonColor: null,
    joinButtonText: null,
    joinTextColor: null,
    leaveButtonColor: null,
    leaveButtonText: null,
    leaveTextColor: null,
    infoTextOnboarding: null,
    infoTextJoined: null,
    infoTextJoinFailed: null,
    infoTextColor: null,
    maxRecordingDuration: 0,
    recordingEnabled: false,
    recordButtonColor: '#ffffff',
    recordDownloadColor: '#D52265',
    photoInstructions: 'Tap for photo',
    videoInstructions: 'Hold for video',
    downloadInstructions: 'Tap the icon to download your recording',
    autoRedirect: true,
    showTitleImage: true,
    showBackgroundImage: true,
    showEndCardImage: true,
    hideTitle: false,
    footerLinkColor: '#D52265',
    footerTextColor: '#C5C5C5',
    endCardDownloadPrompt: 'Thanks for participating, to download your video press the button below.',
    rotateDeviceMessage: 'Please rotate your phone',
    supportEmail: 'VixiSuiteSupport@thefamousgroup.com',
    joinRequiresConsent: false,
    mode: 'default',
    lw_torchMaxMs: 3000,
    lw_countdownSeconds: 3,
    lw_sectionDelayMs: 400,
    lw_waitingText: "You're in section {section}. Get ready.",
    lw_requireRaise: true,
    lw_debugOverlay: false,
    lw_raiseSensitivity: 5,
    lw_lowerSensitivity: 5,
    lw_offOnlyAtMax: false,
    lw_loop: false,
  },
  displayName: null
}

let joined = false;   // true if the user has pressed the join button
let joinInProgress = false; // true while join click handler is awaiting torch flow
let joinAttempted = false; // true if the user has attempted to join the light show
let pendingShowEnd = false; // true if stop/show-end arrived before settings were loaded
let settingsLoaded = false; // true once assets-settings has been processed
let showingEndCard = false; // true when end card overlay is visible (show locked)

let connectionId = null;
let joinButton = null;
let infoContainer = null;
let infoText = null;
let leaveButton = null;
let deviceType = null;
/** Microphone stream when requestMic was used on join; stopped when show is locked. */
let micStream = null;

/** Legacy paint error (second fallback after one participant-entry attempt). */
const LEGACY_PARTICIPANT_ERROR_PAINT = 'https://lightshow.vs2-uswest2-prod.vixisuite.cloud/paint/error.html';
/** Participant app origin (first fallback for socket token-not-found). */
const PARTICIPANT_USER_APP_ORIGIN = 'https://vixi-lightshow.onrender.com';

function participantEntryUrlForToken(tokenStr) {
    if (!tokenStr || typeof tokenStr !== 'string') {
        return `${PARTICIPANT_USER_APP_ORIGIN}/`;
    }
    return `${PARTICIPANT_USER_APP_ORIGIN}/go/i/${encodeURIComponent(tokenStr)}`;
}

const DEBUG_MODE_ENABLED = window.__APP_CONFIG__?.debugMode;
console.log('### DEBUG_MODE_ENABLED: ', DEBUG_MODE_ENABLED);
/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Helper                                                                                               */
/* --------------------------------------------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    console.log('User loaded');
    if(DEBUG_MODE_ENABLED) {
        console.log('DEBUG MODE ENABLED');
    }

    infoContainer = document.getElementById('info-container');
    infoText = document.getElementById('info-text');
    joinButton = document.getElementById('join-button');
    const joinConsentCheckbox = document.getElementById('join-consent-checkbox');
    if (joinConsentCheckbox) {
        joinConsentCheckbox.addEventListener('change', () => {
            if (joined || !session.settings.joinRequiresConsent) {
                return;
            }
            const ok = joinConsentCheckbox.checked;
            joinButton.disabled = !ok;
            joinButton.style.opacity = ok ? '' : '0.55';
            joinButton.style.pointerEvents = ok ? 'auto' : 'none';
            joinButton.style.cursor = ok ? '' : 'not-allowed';
        });
    }
    const lwSectionInput = document.getElementById('lw_section-input');
    if (lwSectionInput) {
        lwSectionInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                joinButton.click();
            }
        });
    }
    joinButton.addEventListener('click', async () => {
        //console.log('Join button clicked', token, Date.now());
        if (session.settings.joinRequiresConsent) {
            const cb = document.getElementById('join-consent-checkbox');
            if (!cb || !cb.checked) {
                return;
            }
        }
        const lightwaveOn = lw_normalizeMode(session.settings.mode) === 'lightwave';
        let pendingSection = null;
        if (lightwaveOn) {
            pendingSection = lw_captureJoinSection(token);
            if (!pendingSection) {
                return;
            }
        }
        const originalJoinButtonText = joinButton.innerHTML;
        joinInProgress = true;
        joinButton.disabled = true;
        joinButton.style.pointerEvents = 'none';
        joinButton.innerHTML = '<div uk-spinner></div> Joining...';
        if (lightwaveOn) {
            try {
                await lw_prepareMotionFromJoin();
            } catch (_) {
                // Fallback flash still works if motion is denied or missing.
            }
        }
        const requestMic = session.settings.requestMic;
        let result = null;

        if (requestMic) {
            try {
                result = await startTorchFlow({ requestMic: true });
                if (result && result.ok) {
                    // Combined path: one prompt; no micStream (stream managed by leaveTorchFlow)
                } else {
                    result = null;
                }
            } catch (_) {
                result = null;
            }
            if (result === null) {
                // Fallback: camera/torch first, then mic separately
                result = await startTorchFlow();
                if (result && result.ok) {
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        micStream = stream;
                    } catch (_) {
                        micStream = null;
                    }
                    result = { ...result, micGranted: !!micStream };
                }
            }
        } else {
            result = await startTorchFlow();
            if (result && result.micGranted === undefined) result = { ...result, micGranted: false };
        }

        // notify server on "join attempt"
        if (result && result.ok) {
            console.log('🔦 Torch connected 🔦');
            const payload = { ...result };
            if (payload.micGranted === undefined) payload.micGranted = false;
            socket.emit('torch-connected', token, Date.now(), payload);
            console.log('🔦 full: ', result);
            joined = true;
            joinAttempted = true;
            deviceType = result.device;

            log({
                'type': 'torch-connected',
                'ok': result.ok,
                'cameraPosition': result.cameraPosition,
                'micGranted': payload.micGranted
            });

            // enable screen wake lock after torch/camera access success
            joinButton.innerHTML = originalJoinButtonText;
            joinButton.style.display = 'none';
            const joinConsentRowOk = document.getElementById('join-consent-row');
            if (joinConsentRowOk) joinConsentRowOk.style.display = 'none';
            // Keep leave button hidden per requirements
            leaveButton.style.display = 'none';
            lw_showJoinSection(false);
            if (pendingSection) {
                lw_commitJoinSection(socket, token, pendingSection);
            }
            if (lightwaveOn) {
                infoText.style.display = 'none';
                try { await setTorch(false); } catch (_) {}
            } else {
                infoText.innerHTML = session.settings.infoTextJoined;
                infoText.style.display = 'block';
            }
            try { await enableWakeLock(); } catch (_) {}
            joinInProgress = false;
            updateRecordingUI();
            await syncLightwave(pendingSection);
        } else {
            joined = false;
            joinAttempted = true;
            console.error('🚫🔦 Torch not connected 🔦🚫');
            console.error('🚫🔦 full: ', result);
            socket.emit('torch-connect-failed', token, Date.now(), result);
            joinButton.innerHTML = originalJoinButtonText;
            infoText.innerHTML = session.settings.infoTextJoinFailed;
            joinInProgress = false;
            updateJoinConsentUI();
        }
    });

    leaveButton = document.getElementById('leave-button');
    leaveButton.addEventListener('click', async () => {
        console.log('Leave button clicked', token, Date.now());
        socket.emit('torch-disconnected', token, Date.now());
        const originalLeaveButtonText = leaveButton.innerHTML;
        leaveButton.innerHTML = '<div uk-spinner></div> Leaving...';
        await setTorch(false);
        await leaveTorchFlow();
        try { await disableWakeLock(); } catch (_) {}
        joined = false;
        joinAttempted = false;
        await lw_stop();
        leaveButton.innerHTML = originalLeaveButtonText;
        infoContainer.style.display = 'flex';
        joinButton.style.display = 'block';
        // Re-enable join button after leaving
        joinButton.disabled = false;
        joinButton.style.pointerEvents = 'auto';
        leaveButton.style.display = 'none';
        infoText.innerHTML = session.settings.infoTextOnboarding;
        updateJoinConsentUI();
        updateLwJoinSectionUi();
        updateRecordingUI();
    });

    // Recording button touch and click events (click used on iOS for pending-media share so share sheet opens on first tap)
    const recordingBtn = document.getElementById('recording-btn');
    if (recordingBtn) {
        recordingBtn.addEventListener('touchstart', handleTouchStart, { passive: false });
        recordingBtn.addEventListener('touchmove',  handleTouchMove,  { passive: false });
        recordingBtn.addEventListener('touchend',   handleTouchEnd);
        recordingBtn.addEventListener('click', handlePendingMediaClick);
    }
    document.addEventListener('recording-pending-media-shown', () => {
        updateRecordingUI(false);
    });
    // Hide footer until we have settings and know visibility (avoids flash when !isMLB and not joined)
    const pageFooter = document.getElementById('page-footer');
    if (pageFooter) {
        pageFooter.style.display = 'none';
    }

    initOrientationLockAndOverlay();
});

/* --------------------------------------------------------------------------------------------------------------- */
/* Orientation lock and landscape overlay                                                                         */
/* --------------------------------------------------------------------------------------------------------------- */
const ROTATE_DEVICE_MESSAGE_DEFAULT = 'Please rotate your phone';
let orientationLocked = false;
let useRotateOverlay = false;

function updateRotateOverlayVisibility() {
    const overlay = document.getElementById('rotate-device-overlay');
    const messageEl = document.getElementById('rotate-device-message');
    if (!overlay || !messageEl) return;
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    if (isLandscape && useRotateOverlay) {
        const text = (session.settings && typeof session.settings.rotateDeviceMessage === 'string' && session.settings.rotateDeviceMessage.trim() !== '')
            ? session.settings.rotateDeviceMessage
            : ROTATE_DEVICE_MESSAGE_DEFAULT;
        messageEl.textContent = text;
        overlay.style.display = 'flex';
        overlay.setAttribute('aria-hidden', 'false');
    } else {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
    }
}

function initOrientationLockAndOverlay() {
    if (typeof screen === 'undefined' || !screen.orientation || typeof screen.orientation.lock !== 'function') {
        useRotateOverlay = true;
        updateRotateOverlayVisibility();
    } else {
        try {
            screen.orientation.lock('portrait').then(() => {
                orientationLocked = true;
                useRotateOverlay = false;
            }).catch(() => {
                orientationLocked = false;
                useRotateOverlay = true;
                updateRotateOverlayVisibility();
            });
        } catch (_) {
            useRotateOverlay = true;
            updateRotateOverlayVisibility();
        }
    }

    const onOrientationChange = () => {
        if (!orientationLocked) {
            updateRotateOverlayVisibility();
        }
    };

    window.addEventListener('orientationchange', onOrientationChange);
    window.addEventListener('resize', onOrientationChange);

    window.addEventListener('beforeunload', () => {
        if (orientationLocked && typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.unlock === 'function') {
            try { screen.orientation.unlock(); } catch (_) {}
        }
    });
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Announce the User to the server once the connection is established                                              */
/* --------------------------------------------------------------------------------------------------------------- */
//get the token from the url path
let token = window.location.pathname.split('/').pop();
if (!token) {
    token = window.__APP_CONFIG__?.testToken || 'gej2qhxkV6pdve2h';
}
console.log('Token: ', token);

/* --------------------------------------------------------------------------------------------------------------- */
/* Server ready                                                                                                    */
/* --------------------------------------------------------------------------------------------------------------- */
socket.on('server-ready', (timestamp, id) => {
    // convert timestamp to human readable date
    const date = new Date(timestamp);
    const humanReadableDate = date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' });
    connectionId = id;

    console.log('Server ready, announcing user', humanReadableDate, connectionId);
    socket.emit('user-connected', token, Date.now());
});

socket.on('token-not-found', (payloadToken) => {
    console.error('Token not found');
    const t = typeof payloadToken === 'string' && payloadToken.trim() ? payloadToken.trim() : token;
    const storageKey = `vixi-pf-${t}`;
    try {
        if (sessionStorage.getItem(storageKey)) {
            window.location.href = LEGACY_PARTICIPANT_ERROR_PAINT;
            return;
        }
        sessionStorage.setItem(storageKey, '1');
    } catch (_) {
        window.location.href = LEGACY_PARTICIPANT_ERROR_PAINT;
        return;
    }
    window.location.href = participantEntryUrlForToken(t);
});
/* --------------------------------------------------------------------------------------------------------------- */
/* SOCKET EVENTS                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
socket.on('assets', (assets) => {
    console.log('Assets after update', assets);
    session.assets = assets;
    seedEndCardFromBackground(session.assets);
    displayAssets(session.assets);
});

const safeDuration = (duration) => {
  if (typeof duration === 'number') {
    return Math.max(0, Math.floor(duration))
  }
  return 0
}

/** Seed endCardImage.url from backgroundImage.url when producer has not set an end card yet. */
function seedEndCardFromBackground(assets) {
  if (!assets || !assets.input) return;
  if (!assets.input.endCardImage || !assets.input.endCardImage.url) {
    assets.input.endCardImage = assets.input.endCardImage || {};
    assets.input.endCardImage.url = assets.input.backgroundImage?.url || assets.input.endCardImage?.url;
  }
}

socket.on('settings', (settings) => {
    console.log('Settings after update', settings);
    session.settings.joinButtonColor = settings.joinButtonColor || '#D52265';
    session.settings.joinButtonText = settings.joinButtonText || 'Join Light Show';
    session.settings.joinTextColor = settings.joinTextColor || '#FFFFFF';
    session.settings.leaveButtonColor = settings.leaveButtonColor || '#D52265';
    session.settings.leaveButtonText = settings.leaveButtonText || 'Leave Light Show';
    session.settings.leaveTextColor = settings.leaveTextColor || '#FFFFFF';
    session.settings.infoTextOnboarding = settings.infoTextOnboarding || 'Participating in Vixi Light Show requires access to your camera and flashlight. Please tap the button below to begin.';
    session.settings.infoTextJoined = settings.infoTextJoined || 'You are now participating in the Light Show, enjoy!';
    session.settings.infoTextJoinFailed = settings.infoTextJoinFailed || 'Unable to connect to your camera or flashlight. Please try again.';
    session.settings.infoTextColor = settings.infoTextColor || '#FFFFFF';
    session.settings.infoTextBgColor = settings.infoTextBgColor || 'rgba(0, 0, 0, 0.1)';
    session.settings.redirectUrl = settings.redirectUrl || null;
    session.settings.isMLB = settings.isMLB || false;
    session.settings.maxRecordingDuration = safeDuration(settings.maxRecordingDuration);
    session.settings.recordingEnabled = !!settings.recordingEnabled;
    // Recording UX fields
    session.settings.recordButtonColor = settings.recordButtonColor || '#D52265';
    session.settings.recordDownloadColor = settings.recordDownloadColor || '#FF3B30';
    session.settings.photoInstructions = typeof settings.photoInstructions === 'string' ? settings.photoInstructions : 'Tap for photo';
    session.settings.videoInstructions = typeof settings.videoInstructions === 'string' ? settings.videoInstructions : 'Hold for video';
    session.settings.downloadInstructions = typeof settings.downloadInstructions === 'string' ? settings.downloadInstructions : 'Tap the icon to download your recording';
    session.settings.endCardDownloadPrompt = typeof settings.endCardDownloadPrompt === 'string' ? settings.endCardDownloadPrompt : 'Thanks for participating, to download your video press the button below.';
    session.settings.footerTextColor = settings.footerTextColor || '#C5C5C5';
    session.settings.footerLinkColor = settings.footerLinkColor || '#D52265';
    session.settings.rotateDeviceMessage = typeof settings.rotateDeviceMessage === 'string' ? settings.rotateDeviceMessage : ROTATE_DEVICE_MESSAGE_DEFAULT;
    session.settings.requestMic = !!settings.requestMic;
    // New flags
    session.settings.autoRedirect = settings.autoRedirect !== undefined ? !!settings.autoRedirect : true;
    session.settings.showTitleImage = settings.showTitleImage !== false;
    session.settings.showBackgroundImage = settings.showBackgroundImage !== false;
    session.settings.showEndCardImage = settings.showEndCardImage !== false;
    session.settings.hideTitle = !!settings.hideTitle;
    session.settings.locked = !!settings.locked;
    session.settings.showLockedMessage = typeof settings.showLockedMessage === 'string' ? settings.showLockedMessage : 'The LightShow is not currently active';
    mergeSupportEmailAndConsentFromPayload(settings);
    lw_applyLightwaveSettings(session.settings, settings);

    if (session.settings.locked) {
        console.log('### [settings] SHOW-LOCKED');
        applyUserMlbSupportLinkHref();
        handleShowEnd(session.settings, session.assets);
        return;
    }

    displaySettings(session.settings);
    updateRotateOverlayVisibility();
    updateRecordingUI();
    syncLightwave();
});

socket.on('assets-settings', (assets, settings, displayName) => {
    
    if (pendingShowEnd) {
        pendingShowEnd = false;
        return;
    }
    console.log('### ASSETS', assets);
    console.log('### SETTINGS', settings);
    console.log('### DISPLAY NAME', displayName);
    session.assets = assets;
    seedEndCardFromBackground(session.assets);

    session.settings.joinButtonColor = settings.joinButtonColor || '#D52265';
    session.settings.joinButtonText = settings.joinButtonText || 'Join Light Show';
    session.settings.joinTextColor = settings.joinTextColor || '#FFFFFF';
    session.settings.leaveButtonColor = settings.leaveButtonColor || '#D52265';
    session.settings.leaveButtonText = settings.leaveButtonText || 'Leave Light Show';
    session.settings.leaveTextColor = settings.leaveTextColor || '#FFFFFF';
    session.settings.infoTextOnboarding = settings.infoTextOnboarding || 'Participating in Vixi Light Show requires access to your camera and flashlight. Please tap the button below to begin.';
    session.settings.infoTextJoined = settings.infoTextJoined || 'You are now participating in the Light Show, enjoy!';
    session.settings.infoTextJoinFailed = settings.infoTextJoinFailed || 'Unable to connect to your camera or flashlight. Please try again.';
    session.settings.infoTextColor = settings.infoTextColor || '#FFFFFF';
    session.settings.infoTextBgColor = settings.infoTextBgColor || 'rgba(0, 0, 0, 0.1)';
    session.settings.redirectUrl = settings.redirectUrl || null;
    session.settings.isMLB = settings.isMLB || false;
    session.settings.maxRecordingDuration = safeDuration(settings.maxRecordingDuration);
    session.settings.recordingEnabled = !!settings.recordingEnabled;
    // Recording UX fields
    session.settings.recordButtonColor = settings.recordButtonColor || '#D52265';
    session.settings.recordDownloadColor = settings.recordDownloadColor || '#FF3B30';
    session.settings.photoInstructions = typeof settings.photoInstructions === 'string' ? settings.photoInstructions : 'Tap for photo';
    session.settings.videoInstructions = typeof settings.videoInstructions === 'string' ? settings.videoInstructions : 'Hold for video';
    session.settings.downloadInstructions = typeof settings.downloadInstructions === 'string' ? settings.downloadInstructions : 'Tap the icon to download your recording';
    session.settings.endCardDownloadPrompt = typeof settings.endCardDownloadPrompt === 'string' ? settings.endCardDownloadPrompt : 'Thanks for participating, to download your video press the button below.';
    session.settings.footerTextColor = settings.footerTextColor || '#C5C5C5';
    session.settings.footerLinkColor = settings.footerLinkColor || '#D52265';
    session.settings.rotateDeviceMessage = typeof settings.rotateDeviceMessage === 'string' ? settings.rotateDeviceMessage : ROTATE_DEVICE_MESSAGE_DEFAULT;
    session.settings.requestMic = !!settings.requestMic;
    session.settings.autoRedirect = settings.autoRedirect !== undefined ? !!settings.autoRedirect : true;
    session.settings.showTitleImage = settings.showTitleImage !== false;
    session.settings.showBackgroundImage = settings.showBackgroundImage !== false;
    session.settings.showEndCardImage = settings.showEndCardImage !== false;
    session.settings.hideTitle = !!settings.hideTitle;
    session.displayName = displayName;
    settingsLoaded = true;
    session.settings.locked = !!settings.locked;
    session.settings.showLockedMessage = typeof settings.showLockedMessage === 'string' ? settings.showLockedMessage : 'The LightShow is not currently active';
    mergeSupportEmailAndConsentFromPayload(settings);
    lw_applyLightwaveSettings(session.settings, settings);

    if (session.settings.locked) {
        console.log('### [assets-settings] SHOW-LOCKED');
        applyUserMlbSupportLinkHref();
        handleShowEnd(session.settings, session.assets);
        return;
    }

    displayAssets(session.assets);
    displaySettings(session.settings);
    updateRotateOverlayVisibility();
    updateRecordingUI();
    syncLightwave();
});

/* --------------------------------------------------------------------------------------------------------------- */
/* DISPLAY ASSETS                                                                                                  */
/* --------------------------------------------------------------------------------------------------------------- */
function displayAssets(assets) {
    //console.log('Displaying assets');
    if (!assets?.input) return;
    const bg = assets.input.backgroundImage?.url;
    const title = assets.input.titleImage?.url;
    // To visualise triggers via timeline.js - comment out bg image.
    const bodyEl = document.getElementById('background-container');
    const titleEl = document.getElementById('title-container');
    const pageHeader = document.getElementById('page-header');
    if (bodyEl) {
        if (session.settings.showBackgroundImage && bg) {
            bodyEl.style.backgroundImage = `url(${bg})`;
        } else {
            bodyEl.style.backgroundImage = 'none';
        }
    }
    if (titleEl) {
        if (session.settings.showTitleImage && !session.settings.hideTitle && title) {
            titleEl.style.backgroundImage = `url(${title})`;
            titleEl.style.display = '';
        } else {
            titleEl.style.display = 'none';
        }
    }
    if (pageHeader) {
        const showHeader = session.settings.showTitleImage && !session.settings.hideTitle;
        pageHeader.style.display = showHeader ? '' : 'none';
    }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Support link + join consent                                                                                     */
/* --------------------------------------------------------------------------------------------------------------- */
function mergeSupportEmailAndConsentFromPayload(settings) {
    if (!settings) return;
    const raw = settings.supportEmail;
    let se = typeof raw === 'string' ? raw.trim().replace(/^mailto:/i, '') : '';
    if (!se) {
        se = 'VixiSuiteSupport@thefamousgroup.com';
    }
    session.settings.supportEmail = se;
    session.settings.joinRequiresConsent = settings.joinRequiresConsent === true;
    applyUserMlbSupportLinkHref();
}

function userSupportMailtoHref() {
    const t = (session.settings.supportEmail || '').trim();
    if (!t) {
        return 'mailto:VixiSuiteSupport@thefamousgroup.com';
    }
    return `mailto:${t}`;
}

function applyUserMlbSupportLinkHref() {
    const a = document.getElementById('mlb-footer-support-link');
    if (a) {
        a.setAttribute('href', userSupportMailtoHref());
    }
}

function updateJoinConsentUI() {
    if (joinInProgress) {
        return;
    }
    const row = document.getElementById('join-consent-row');
    const cb = document.getElementById('join-consent-checkbox');
    const jb = joinButton || document.getElementById('join-button');
    if (!jb) {
        return;
    }
    if (joined) {
        if (row) row.style.display = 'none';
        return;
    }
    if (session.settings.joinRequiresConsent) {
        if (row) row.style.display = 'block';
        if (cb) cb.checked = false;
        jb.disabled = true;
        jb.style.opacity = '0.55';
        jb.style.pointerEvents = 'none';
        jb.style.cursor = 'not-allowed';
    } else {
        if (row) row.style.display = 'none';
        if (cb) cb.checked = false;
        jb.disabled = false;
        jb.style.opacity = '';
        jb.style.pointerEvents = 'auto';
        jb.style.cursor = '';
    }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* DISPLAY SETTINGS                                                                                                */
/* --------------------------------------------------------------------------------------------------------------- */
function displaySettings(settings) {
    //console.log('Displaying Settings: ', settings);
    if (!settings) return;

    if(joinButton === null) {
        joinButton = document.getElementById('join-button');
    }
    if(leaveButton === null) {
        leaveButton = document.getElementById('leave-button');
    }
    if(infoText === null) {
        infoText = document.getElementById('info-text');
    }

    if (settings.joinButtonColor) {
      //console.log('Join button color: ', settings.joinButtonColor, typeof settings.joinButtonColor);
        joinButton.style.backgroundColor = settings.joinButtonColor;
        joinButton.style.borderColor = settings.joinButtonColor;
        if (!joined) {
            joinButton.style.display = 'block';
        } else {
            joinButton.style.display = 'none';
        }
    }
    {
        const accent = (settings.joinButtonColor && String(settings.joinButtonColor).trim()) || '#D52265';
        document.body.style.setProperty('--join-checkbox-checked-bg', accent.startsWith('#') ? accent : `#${accent}`);
    }
    if (settings.joinButtonText) {
      //console.log('Join button text: ', settings.joinButtonText, typeof settings.joinButtonText);
        joinButton.innerHTML = '<span class="mdi mdi-flash"></span>' + settings.joinButtonText;
    }
    if (settings.joinTextColor) {
      //console.log('Join button text color: ', settings.joinTextColor, typeof settings.joinTextColor);
        joinButton.style.color = settings.joinTextColor;
    }
    if (settings.leaveButtonColor) {
      //console.log('Leave button color: ', settings.leaveButtonColor, typeof settings.leaveButtonColor);
        leaveButton.style.backgroundColor = settings.leaveButtonColor;
        leaveButton.style.borderColor = settings.leaveButtonColor;
        // Always hidden
        leaveButton.style.display = 'none';
    }
    if (settings.leaveTextColor) {
      //console.log('Leave button text color: ', settings.leaveTextColor, typeof settings.leaveTextColor);
        leaveButton.style.color = settings.leaveTextColor;
    }
    if (settings.leaveButtonText) {
      //console.log('Leave button text: ', settings.leaveButtonText, typeof settings.leaveButtonText);
        leaveButton.innerHTML = '<span class="mdi mdi-exit-to-app"></span>' + settings.leaveButtonText;
    }

    const hideJoinedCopy = lw_normalizeMode(settings.mode) === 'lightwave' && joined;
    if (joined) {
        if (!hideJoinedCopy && settings.infoTextJoined) {
            //console.log('Info text joined: ', settings.infoTextJoined, typeof settings.infoTextJoined);
            infoText.innerHTML = settings.infoTextJoined;
        }
    } else if (joinAttempted) {
        if (settings.infoTextJoinFailed) {
            //console.log('Info text join failed: ', settings.infoTextJoinFailed, typeof settings.infoTextJoinFailed);
            infoText.innerHTML = settings.infoTextJoinFailed;
        }
    } else {
        if (settings.infoTextOnboarding) {
            //console.log('Info text onboarding: ', settings.infoTextOnboarding, typeof settings.infoTextOnboarding);
            infoText.innerHTML = settings.infoTextOnboarding;
        }
    }
    {
        const infoColor = settings.infoTextColor || '#FFFFFF';
        infoText.style.color = infoColor;
        const consentLabel = document.getElementById('join-consent-label');
        if (consentLabel) consentLabel.style.color = infoColor;
    }
    // Info container background color (always use infoTextBgColor)
    if (settings.infoTextBgColor !== undefined && settings.infoTextBgColor !== null) {
        if (infoContainer) infoContainer.style.backgroundColor = settings.infoTextBgColor;
        // Also expose as CSS variable for themes
        //infoText.style.setProperty('--info-text-bg', settings.infoTextBgColor);
    }
    infoText.style.display = hideJoinedCopy ? 'none' : 'block';

    applyUserMlbSupportLinkHref();
    updateJoinConsentUI();
    updateLwJoinSectionUi();

    if (settings.isMLB) {
        //console.log('MLB enabled');
        const mlbFooter = document.getElementById('mlb-footer');
        mlbFooter.style.display = 'block';
    } else {
        //console.log('MLB disabled');
    }
    // Footer text/link colors and footer visibility
    const pageFooter = document.getElementById('page-footer');
    if (pageFooter) {
        // Hide footer when: !isMLB and (recording disabled, or recording enabled but not joined yet)
        const recordingEnabled = !!settings.recordingEnabled;
        const showFooter = settings.isMLB || (recordingEnabled && joined);
        pageFooter.style.display = showFooter ? '' : 'none';
        const footerText = typeof settings.footerTextColor === 'string' && settings.footerTextColor.trim()
            ? settings.footerTextColor.trim()
            : '#C5C5C5';
        const footerLink = typeof settings.footerLinkColor === 'string' && settings.footerLinkColor.trim()
            ? settings.footerLinkColor.trim()
            : '#D52265';
        pageFooter.style.setProperty('--footer-text-color', footerText);
        pageFooter.style.color = footerText;
        pageFooter.style.setProperty('--footer-link-color', footerLink);
    }
    // When recording enabled, joined, and !isMLB: hide space-container (only show footer-camera-controls)
    const spaceContainer = document.getElementById('space-container');
    if (spaceContainer) {
        const recordingEnabled = !!settings.recordingEnabled;
        const hideSpaceContainer = recordingEnabled && joined && !settings.isMLB;
        spaceContainer.style.display = hideSpaceContainer ? 'none' : '';
    }
    // Header/title visibility and background visibility
    const pageHeader = document.getElementById('page-header');
    const bodyEl = document.getElementById('background-container');
    const titleEl = document.getElementById('title-container');
    if (pageHeader) {
        const hideHeader = !!settings.hideTitle || !settings.showTitleImage;
        pageHeader.style.display = hideHeader ? 'none' : '';
    }
    if (bodyEl) {
        if (!settings.showBackgroundImage) {
            bodyEl.style.backgroundImage = 'none';
        } else if (session.assets?.input?.backgroundImage?.url) {
            bodyEl.style.backgroundImage = `url(${session.assets.input.backgroundImage.url})`;
        }
    }
    if (titleEl) {
        if (!settings.showTitleImage || settings.hideTitle) {
            titleEl.style.display = 'none';
        } else {
            titleEl.style.display = '';
        }
        if (session.assets?.input?.titleImage?.url && titleEl.style.display !== 'none') {
            titleEl.style.backgroundImage = `url(${session.assets.input.titleImage.url})`;
        }
    }
}
/* --------------------------------------------------------------------------------------------------------------- */
/* PLAY                                                                                                            */
/* --------------------------------------------------------------------------------------------------------------- */
function updateLwJoinSectionUi() {
    const lightwaveOn = lw_normalizeMode(session.settings.mode) === 'lightwave';
    const show = lightwaveOn && !joined && !session.settings.locked;
    lw_showJoinSection(show);
    if (show) {
        lw_prefillJoinSection(token);
    }
}

function syncLightwave(section) {
    return lw_sync({
        socket,
        token,
        settings: session.settings,
        joined,
        locked: !!session.settings.locked,
        log,
        section,
    });
}

socket.on("play", (data) => {
    console.log('### PLAY: ', data);
    console.log('### JOINED: ', joined);
    console.log('### DEVICE TYPE: ', deviceType);
    if(joined && !lw_isActive()) {
        onTimeline(data, joined, DEBUG_MODE_ENABLED, deviceType);
    }
    updateRecordingUI();
});

/* --------------------------------------------------------------------------------------------------------------- */
/* SHOW END                                                                                                        */
/* --------------------------------------------------------------------------------------------------------------- */
async function handleShowEnd(settings = session.settings, assets = session.assets) {
    try {
        // --- Teardown ---
        console.log('### [handleShowEnd] Show ended or locked when joined');
        socket.emit('torch-disconnected', token, Date.now());
        socket.emit('user-disconnected', token, Date.now());
        await lw_stop();
        await clearAllIntervalsAndTimeouts();
        await leaveTorchFlow();
        await setTorch(false);
        clearPendingMediaAndResetUI();
        if (micStream) {
            try {
                micStream.getTracks().forEach((t) => t.stop());
            } catch (_) {}
            micStream = null;
        }
        //console.log('### [handleShowEnd] Teardown complete');

        const url = settings && settings.redirectUrl ? settings.redirectUrl : null;
        const isMLB = !!(settings && settings.isMLB);
        const autoRedirect = !!(settings && settings.autoRedirect);
        //console.log('### [handleShowEnd] url:', url, 'isMLB:', isMLB, 'autoRedirect:', autoRedirect);

        // If autoRedirect is true, url is set, and isMLB is false, redirect to the url
        if (autoRedirect && url !== null && !isMLB) {
            //console.log('[handleShowEnd] Auto-redirect, redirecting now');
            window.location.replace(url);
            return;
        } else {
            //console.log('### [handleShowEnd] No redirect, showing end card');

            const pageHeader = document.getElementById('page-header');
            if (pageHeader) {
                pageHeader.style.display = 'block';
            }

            const pageTitle = document.getElementById('title-container');
            if (pageTitle && assets?.input?.titleImage?.url) {
                pageTitle.style.backgroundImage = `url(${assets?.input?.titleImage?.url})`;
            }

            //set the background image
            const background = document.getElementById('background-container');
            if (background) {
                if (assets?.input?.endCardImage?.url) {
                    background.style.backgroundImage = `url(${assets?.input?.endCardImage?.url})`;
                    //console.log('### [handleShowEnd] Background image set');
                }
            }
            
            //if not MLB && url is set, add a click event to the background to redirect to the url
            if (background && !isMLB && url) {
                //console.log('### [handleShowEnd] Adding click event to background to redirect to url');
                background.addEventListener('click', () => {
                    window.location.replace(url);
                });
            }

            //if the recording button is visible, hide it
            const footerCameraControls = document.getElementById('footer-camera-controls');
            if (footerCameraControls) {
                footerCameraControls.style.display = 'none';
            }

            //if join button is visible, hide it
            const joinButton = document.getElementById('join-button');
            if (joinButton) {
                joinButton.style.display = 'none';
            }
            lw_showJoinSection(false);
            const infoContainer = document.getElementById('info-container');
            const infoText = document.getElementById('info-text');
            //console.log('### [handleShowEnd] infoContainer:', infoContainer);
            //console.log('### [handleShowEnd] infoText:', infoText);
            if (infoContainer ) {
                infoContainer.style.display = 'flex';
                if (settings?.infoTextBgColor) {
                    infoContainer.style.backgroundColor = settings?.infoTextBgColor;
                }
                
                if (infoText) {
                    //console.log('### [handleShowEnd] infoText found');
                    //console.log('### [handleShowEnd] showLockedMessage:', settings?.showLockedMessage);
                    if (settings?.showLockedMessage) {
                        //console.log('### [handleShowEnd] showLockedMessage found', settings?.showLockedMessage);
                        infoText.innerHTML = settings?.showLockedMessage;
                    }
                    if (settings?.infoTextColor) {
                        infoText.style.color = settings?.infoTextColor;
                        //console.log('### [handleShowEnd] infoTextColor found', settings?.infoTextColor);
                    }
                    infoText.style.display = 'block';
                    //console.log('### [handleShowEnd] infoText display set to none');
                }
            }

            if (!isMLB) {
                //console.log('### [handleShowEnd] Non-MLB end card');
            } else {
                //console.log('### [handleShowEnd] MLB end card');
                
                const pageFooter = document.getElementById('page-footer');
                if (pageFooter) {
                    pageFooter.style.display = 'block';

                    const mlbFooter = document.getElementById('mlb-footer');
                    if (mlbFooter) {
                        mlbFooter.style.display = 'block';
                        const ft = typeof settings?.footerTextColor === 'string' && settings.footerTextColor.trim()
                            ? settings.footerTextColor.trim()
                            : '#C5C5C5';
                        const fl = typeof settings?.footerLinkColor === 'string' && settings.footerLinkColor.trim()
                            ? settings.footerLinkColor.trim()
                            : '#D52265';
                        mlbFooter.style.setProperty('--footer-text-color', ft);
                        mlbFooter.style.setProperty('--footer-link-color', fl);
                    }
                }

            }
        }

    } catch (err) {
        console.error('[handleShowEnd] Error', err);
    }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* STOP                                                                                                            */
/* --------------------------------------------------------------------------------------------------------------- */
socket.on('stop', async (type) => {
    updateRecordingUI(true);
    if (type === 'effect-end') {
        console.log('Stopping timeline, Effect ended', type);
        await clearAllIntervalsAndTimeouts();
    } else if (type === 'show-end') {
        // If settings haven't loaded yet, defer until assets-settings arrives
        if (!settingsLoaded) {
            console.log('Show ended before settings loaded, deferring');
            pendingShowEnd = true;
            return;
        }
    } else {
        console.error('Stopping timeline, invalid type: ', type);
    }
});

socket.on('show-locked', (settings, assets) => {
    if (settings) {
        mergeSupportEmailAndConsentFromPayload(settings);
    }
    updateRecordingUI(true);
    pendingShowEnd = true;
    console.log('### We got SHOW-LOCKED');
    console.log('### SETTINGS', settings);
    console.log('### ASSETS', assets);
    handleShowEnd(settings, assets);
});

socket.on('show-unlocked', () => {
    // Producer unlocked the show; refresh so the user gets a fresh join experience
    window.location.reload();
});

/* --------------------------------------------------------------------------------------------------------------- */
/* RECORDING UI                                                                                                    */
/* --------------------------------------------------------------------------------------------------------------- */
function updateRecordingUI(showEnd = false) {
    const cameraWrapper = document.getElementById('camera-preview-wrapper');
    const videoEl       = document.getElementById('recording-video');
    const overlayEl     = document.getElementById('overlay');
    const footerControls = document.querySelector('.footer-camera-controls');
    const pageFooter = document.getElementById('page-footer');
    if (!cameraWrapper) return;

    // Only boolean true means "show locked / tear down recording UI". If this handler is
    // used as a DOM event listener, the first arg is an Event (truthy) — must not hide UI.
    const hideRecordingChrome = showEnd === true;

    const shouldShow = joined && !!session.settings.recordingEnabled;

    // Footer visibility: show when MLB, or when recording enabled and joined (then show footer with camera controls + space-container)
    if (pageFooter) {
        const recordingEnabled = !!session.settings.recordingEnabled;
        const showFooter = session.settings.isMLB || (recordingEnabled && joined);
        pageFooter.style.display = showFooter ? '' : 'none';
    }
    const spaceContainer = document.getElementById('space-container');
    if (spaceContainer) {
        const recordingEnabled = !!session.settings.recordingEnabled;
        const hideSpaceContainer = recordingEnabled && joined && !session.settings.isMLB;
        spaceContainer.style.display = hideSpaceContainer ? 'none' : '';
    }

    if (shouldShow && !hideRecordingChrome) {
        // Apply theme colors to recording UI (on body so footer inherits)
        const root = document.getElementById('background-container') || document.body;
        root.style.setProperty('--recording-accent', session.settings.recordButtonColor || '#FF3B30');
        root.style.setProperty('--recording-text', session.settings.joinTextColor || '#FFFFFF');
        root.style.setProperty('--record-download-color', session.settings.recordDownloadColor || '#FF3B30');
        cameraWrapper.style.setProperty('--recording-accent', session.settings.recordButtonColor || session.settings.joinButtonColor || '#FF3B30');
        cameraWrapper.style.setProperty('--recording-text', session.settings.joinTextColor || '#FFFFFF');

        // Show camera preview; hide info text (leave button stays visible)
        cameraWrapper.style.display = 'flex';
        if (infoContainer) infoContainer.style.display = 'none';
        overlayEl?.classList.add('recording-mode');
        if (footerControls) footerControls.style.display = 'flex';

        // Attach stream to video element
        if (videoEl) {
            const stream = getCameraStream();
            if (stream && videoEl.srcObject !== stream) {
                videoEl.srcObject = stream;
                videoEl.play().catch(() => {});
            }
        }
        const getAudioStreamForRecording = () => {
            const cam = getCameraStream();
            if (cam && typeof cam.getAudioTracks === 'function') {
                const tracks = cam.getAudioTracks();
                if (tracks && tracks.length > 0) return cam;
            }
            if (micStream) return micStream;
            return null;
        };
        initRecording(videoEl, document.getElementById('recording-canvas'), session.settings.maxRecordingDuration, getAudioStreamForRecording);
        registerOnPendingMediaCleared(updateRecordingUI);

        // Set hint text inside the frosted panel (download instructions when download icon is shown, else tap/hold)
        const hintEl = document.getElementById('recording-hint');
        if (hintEl) {
            if (hasPendingMedia()) {
                hintEl.textContent = session.settings.downloadInstructions || 'Tap the icon to download your recording';
            } else {
                const photo = session.settings.photoInstructions || 'Tap for photo';
                const video = session.settings.videoInstructions || 'Hold for video';
                hintEl.innerHTML = `${photo} • ${video}`;
            }
        }
    } else {
        // Hide camera preview; restore info text
        cameraWrapper.style.display = 'none';
        if (infoContainer) infoContainer.style.display = 'flex';
        overlayEl?.classList.remove('recording-mode');
        if (footerControls) footerControls.style.display = 'none';
    }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* LOG                                                                                                             */
/* --------------------------------------------------------------------------------------------------------------- */
export function log(data) {
    //console.log('### LOG: ', data);
    //socket.emit('log', data);
}

/* --------------------------------------------------------------------------------------------------------------- */
/* FOR LOAD TESTING ONLY                                                                                           */
/* --------------------------------------------------------------------------------------------------------------- */
socket.on('load-test:pong', (data, timestamp) => {
    console.log('Load test pong', data, timestamp);
});
