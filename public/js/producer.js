/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Socket.IO                                                                                            */
/* --------------------------------------------------------------------------------------------------------------- */
import { lw_applyLightwaveSettings, LW_DEFAULTS } from './lw_mode.js';

const socket = io();

/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize the connection ID, assets, connection counts, playlist, settings, and programs                       */
/* --------------------------------------------------------------------------------------------------------------- */

let stopBtn = null;
let unlockShowBtn = null;

let redirectUrlElement = null;

let infoTextColorPicker = null;             //Info Text Color picker
let infoTextBgColorInput = null;           //Info Text Background Color input
let infoTextOnboardingInput = null;         //Info Text Onboarding input
let infoTextJoinedInput = null;             //Info Text Joined input
let infoTextJoinFailedInput = null;         //Info Text Join Failed input
let lastValidInfoTextBgColor = 'transparent'; // Track last valid bg color for revert

let joinButtonPreview = null;               //Button
let joinButtonBackgroundColorPicker = null; //Join Button Background Color picker
let joinButtonTextInput = null;             //Join Button Text input
let joinTextColorPicker = null;             //Join Text Color picker

let leaveButtonPreview = null;              //Button
let leaveButtonBackgroundColorInput = null; //Leave Button Background Color input
let leaveButtonTextInput = null;            //Leave Button Text input
let leaveTextColorInput = null;             //Leave Text Color input

// Footer styling
let footerTextColorPicker = null;
let footerLinkColorPicker = null;
let infoTextBgColorPicker = null;
let infoTextBgAlphaInput = null;
let recordButtonColorPicker = null;
let recordDownloadColorPicker = null;
let photoInstructionsInput = null;
let videoInstructionsInput = null;
let hideTitleToggle = null;
let previewState = 'onboarding';

//Program Builder
let clipInput = null;
let clipInputBtn = null;
let clipInputText = null;
let generateBtn = null;
let customProgramsContainer = null;
let customTimeline = null;
//let programs = {};

/** When aria-pressed changes on an .asset-eye label, sync the inner span from mdi-eye to mdi-eye-off. */
function syncAssetEyeIcon(labelEl) {
    if (!labelEl || !labelEl.classList.contains('asset-eye')) return;
    const span = labelEl.querySelector('span.mdi');
    if (span) {
        const pressed = labelEl.getAttribute('aria-pressed') === 'true';
        span.classList.remove('mdi-eye', 'mdi-eye-off');
        span.classList.add(pressed ? 'mdi-eye' : 'mdi-eye-off');
    }
}
let customProgramManagerBody = null;

//let androidPlaybackLeadMs = 450;

let recordingEnabledInput = null;       // Recording enabled checkbox
let maxRecordingDurationInput = null;   // Recording duration range slider
let recordingPromptTextInput = null;    // Recording prompt text textarea

const session = {
    assets: null,
    connectionId: null,
    customPrograms: null,
    defaultPrograms: null,
    displayName: null,
    gateRecordingEnabled: false,
    settings: {
        activeProgram: null,
        favoritePrograms: [],
        joinButtonColor: '#D52265',
        joinButtonText: 'Join Light Show',
        joinTextColor: '#FFFFFF',
        leaveButtonColor: '#D52265',
        leaveButtonText: 'Leave Light Show',
        leaveTextColor: '#FFFFFF',
        infoTextOnboarding: 'Participating in Vixi Light Show requires access to your camera and flashlight. Please tap the button below to begin.',
        infoTextJoined: 'You are now participating in the LightShow, enjoy!',
        infoTextJoinFailed: 'Unable to connect to your camera or flashlight. Please try again.',
        infoTextColor: '#FFFFFF',
        locked: true,
        loop: true,
        mode: 'default',
        lw_torchMaxMs: LW_DEFAULTS.lw_torchMaxMs,
        lw_countdownSeconds: LW_DEFAULTS.lw_countdownSeconds,
        lw_sectionDelayMs: LW_DEFAULTS.lw_sectionDelayMs,
        lw_waitingText: LW_DEFAULTS.lw_waitingText,
        paused: true,
        playing: false,
        redirectUrl: null,
        startDateTime: null,
        startDelay: 0,
        recordingEnabled: false,
        maxRecordingDuration: 30, 
        isMLB: false,
        footerTextColor: '#C5C5C5',
        footerLinkColor: '#D52265',
        infoTextBgColor: 'rgba(0, 0, 0, 0.1)',
        recordButtonColor: '#D52265',
        recordDownloadColor: '#FF3B30',
        photoInstructions: 'Tap for photo',
        videoInstructions: 'Hold for video',
        downloadInstructions: 'Tap the icon to download your recording',
        endCardDownloadPrompt: 'Thanks for participating, to download your video press the button below.',
        rotateDeviceMessage: 'Please rotate your phone',
        showLockedMessage: 'The LightShow is not currently active',
        hideTitle: false,
        autoRedirect: true,
        recordingEnabled: false,
        recordingSlider: true,
        maxRecordingDuration: 30,
        supportEmail: 'VixiSuiteSupport@thefamousgroup.com',
        joinRequiresConsent: false,
    }
  }

const PAGES = {
    fiveHundred: '500.html'
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Helper                                                                                               */
/* --------------------------------------------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    console.log('Producer loaded');

    unlockShowBtn = document.getElementById('unlock-show-btn');
    unlockShowBtn.addEventListener('click', () => {
        unlockShow();
    });

    stopBtn = document.getElementById('dj-stop-btn');
    stopBtn.addEventListener('click', () => {
        stopProgram();
    });

    initLwProducerControls();

    redirectUrlElement = document.getElementById('redirect-url');
    redirectUrlElement.addEventListener('change', () => {
        //if redirect url is empty or null or undefined, set it to null
        if (redirectUrlElement.value === '' || redirectUrlElement.value === null || redirectUrlElement.value === undefined) {
            redirectUrlElement.value = null;
        } else if (!redirectUrlElement.value.startsWith('http') && !redirectUrlElement.value.startsWith('https')) {
            redirectUrlElement.value = 'https://' + redirectUrlElement.value;
        }
        console.log('Redirect URL: ', redirectUrlElement.value);
        session.settings.redirectUrl = redirectUrlElement.value;
        updateSettings();
    });

    //Info Text Inputs
    infoTextColorPicker = document.getElementById('info-text-color-color');
    infoTextBgColorInput = document.getElementById('info-text-bg-color');
    infoTextOnboardingInput = document.getElementById('info-text-onboarding');
    infoTextJoinedInput = document.getElementById('info-text-joined');
    infoTextJoinFailedInput = document.getElementById('info-text-join-failed');

    //Join Button Preview
    joinButtonPreview = document.getElementById('join-btn-preview');
    joinButtonBackgroundColorPicker = document.getElementById('join-button-color-color');
    joinButtonTextInput = document.getElementById('join-button-text');
    joinTextColorPicker = document.getElementById('join-text-color-color');

    //Leave Button Preview
    leaveButtonPreview = document.getElementById('leave-btn-preview');
    leaveButtonBackgroundColorInput = document.getElementById('leave-button-color');
    leaveButtonTextInput = document.getElementById('leave-button-text');
    leaveTextColorInput = document.getElementById('leave-text-color');

    // Footer styling inputs
    footerTextColorPicker = document.getElementById('footer-text-color-color');
    footerLinkColorPicker = document.getElementById('footer-link-color-color');
    infoTextBgColorPicker = document.getElementById('info-text-bg-color-color');
    infoTextBgAlphaInput  = document.getElementById('info-text-bg-alpha-input');
    // Recording controls
    recordButtonColorPicker = document.getElementById('record-button-color');
    recordDownloadColorPicker = document.getElementById('record-download-color');
    photoInstructionsInput = document.getElementById('photo-instructions');
    videoInstructionsInput = document.getElementById('video-instructions');
    const downloadInstructionsInput = document.getElementById('download-instructions');
    const endCardDownloadPromptInput = document.getElementById('end-card-download-prompt');
    // Title toggle (removed from UI) — no longer wired
    // Asset toggles
    const assetTitleVisible = document.getElementById('asset-title-visible');
    const assetBgVisible = document.getElementById('asset-bg-visible');
    const assetEndCardVisible = document.getElementById('asset-endcard-visible');
    // Auto-redirect
    const autoRedirectInput = document.getElementById('auto-redirect-enabled');
    const autoRedirectRow = document.getElementById('auto-redirect-row');
    const assetEndcardVisibleRow = document.getElementById('asset-endcard-visible-row');
    // Preview state buttons
    const previewStates = document.getElementById('preview-states');
    const endcardBtn = document.getElementById('preview-state-endcard');

    //Info Text Input Event Listeners
    infoTextColorPicker.addEventListener('change', () => {
        session.settings.infoTextColor = infoTextColorPicker.value;
        document.getElementById('info-text-preview').style.color = session.settings.infoTextColor;
        document.getElementById('info-text-joined-preview').style.color = session.settings.infoTextColor;
        document.getElementById('info-text-join-failed-preview').style.color = session.settings.infoTextColor;
        const previewConsentLabel = document.getElementById('preview-join-consent-label');
        if (previewConsentLabel) previewConsentLabel.style.color = session.settings.infoTextColor;
        updateSettings();
    });
    infoTextBgColorInput.addEventListener('change', () => {
        const value = (infoTextBgColorInput.value || '').trim();
        const previewContainer = document.getElementById('info-text-container');
        if (isValidCssColor(value)) {
            infoTextBgColorInput.classList.remove('uk-form-danger');
            session.settings.infoTextBgColor = value || 'transparent';
            if (previewContainer) previewContainer.style.backgroundColor = session.settings.infoTextBgColor;
            lastValidInfoTextBgColor = session.settings.infoTextBgColor;
            updateSettings();
        } else {
            infoTextBgColorInput.classList.add('uk-form-danger');
            UIkit.notification({
                message: 'Invalid color. Use hex (#RRGGBB or #RRGGBBAA) or rgba(r,g,b,a).',
                status:  'danger',
                pos:     'top-center',
                timeout: 3000
            });
            // revert visible value to last valid without saving
            if (typeof lastValidInfoTextBgColor === 'string') {
                infoTextBgColorInput.value = lastValidInfoTextBgColor;
                if (previewContainer) previewContainer.style.backgroundColor = lastValidInfoTextBgColor;
            }
        }
    });

    // RGBA pickers wiring
    // Numeric alpha input wiring for Info Text BG
    const applyInfoTextBg = () => {
        const hex = infoTextBgColorPicker?.value || '#000000';
        const n = clamp(parseInt(infoTextBgAlphaInput?.value || '100', 10), 1, 100);
        if (infoTextBgAlphaInput) infoTextBgAlphaInput.value = String(n);
        const { r, g, b } = hexToRgb(hex);
        const a = +(n / 100).toFixed(2);
        const rgba = `rgba(${r}, ${g}, ${b}, ${a})`;
        session.settings.infoTextBgColor = rgba;
        if (infoTextBgColorInput) infoTextBgColorInput.value = rgba;
        const c = document.getElementById('info-text-container');
        if (c) c.style.backgroundColor = rgba;
        lastValidInfoTextBgColor = rgba;
        updateSettings();
    };
    if (infoTextBgColorPicker) infoTextBgColorPicker.addEventListener('input', applyInfoTextBg);
    if (infoTextBgAlphaInput) infoTextBgAlphaInput.addEventListener('input', applyInfoTextBg);
    // Simple (no alpha) footer color pickers
    if (footerTextColorPicker) {
        footerTextColorPicker.addEventListener('input', () => {
            const c = footerTextColorPicker.value || '#C5C5C5';
            session.settings.footerTextColor = c;
            const previewFooter = document.getElementById('preview-page-footer');
            if (previewFooter) {
                previewFooter.style.setProperty('--footer-text-color', c);
                previewFooter.style.color = c;
            }
            updateSettings();
        });
    }
    if (footerLinkColorPicker) {
        footerLinkColorPicker.addEventListener('input', () => {
            session.settings.footerLinkColor = footerLinkColorPicker.value || '#D52265';
            updateSettings();
            const prev = document.getElementById('mlb-footer-preview');
            if (prev) {
                prev.querySelectorAll('a').forEach(a => a.style.color = session.settings.footerLinkColor);
            }
        });
    }
    infoTextOnboardingInput.addEventListener('change', () => {
        console.log('Info text onboarding changed', infoTextOnboardingInput.value);
        session.settings.infoTextOnboarding = infoTextOnboardingInput.value;
        const onboardingContent = document.getElementById('info-text-onboarding-content');
        if (onboardingContent) onboardingContent.textContent = session.settings.infoTextOnboarding;
        updateSettings();
    });

    infoTextJoinedInput.addEventListener('change', () => {
        session.settings.infoTextJoined = infoTextJoinedInput.value;
        document.getElementById('info-text-joined-preview').innerHTML = session.settings.infoTextJoined;
        updateSettings();
    });

    infoTextJoinFailedInput.addEventListener('change', () => {
        session.settings.infoTextJoinFailed = infoTextJoinFailedInput.value;
        document.getElementById('info-text-join-failed-preview').innerHTML = session.settings.infoTextJoinFailed;
        updateSettings();
    });

    const rotateDeviceMessageInput = document.getElementById('rotate-device-message');
    if (rotateDeviceMessageInput) {
        rotateDeviceMessageInput.addEventListener('change', () => {
            session.settings.rotateDeviceMessage = rotateDeviceMessageInput.value;
            updateSettings();
        });
    }

    const showLockedMessageInput = document.getElementById('show-locked-message');
    if (showLockedMessageInput) {
        showLockedMessageInput.addEventListener('change', () => {
            session.settings.showLockedMessage = showLockedMessageInput.value || 'The LightShow is not currently active';
            const showLockedPreviewEl = document.getElementById('info-text-show-locked-preview');
            if (showLockedPreviewEl) showLockedPreviewEl.textContent = (session.settings.showLockedMessage && String(session.settings.showLockedMessage).trim()) ? session.settings.showLockedMessage : 'The LightShow is not currently active';
            updateSettings();
        });
    }
    const showLockedMessageEndcardInput = document.getElementById('show-locked-message-endcard');
    if (showLockedMessageEndcardInput) {
        showLockedMessageEndcardInput.addEventListener('change', () => {
            session.settings.showLockedMessage = showLockedMessageEndcardInput.value || 'The LightShow is not currently active';
            updateSettings();
            const showLockedPreviewEl = document.getElementById('info-text-show-locked-preview');
            if (showLockedPreviewEl) showLockedPreviewEl.textContent = (session.settings.showLockedMessage && String(session.settings.showLockedMessage).trim()) ? session.settings.showLockedMessage : 'The LightShow is not currently active';
        });
    }

    //Join Button Preview Event Listeners
    joinButtonPreview.addEventListener('click', () => {
        joinButtonPreview.style.display = 'none';
        leaveButtonPreview.style.display = 'block';
        const previewEl = document.getElementById('info-text-preview');
        if (previewEl) previewEl.style.display = 'none';
        const joinedEl = document.getElementById('info-text-joined-preview');
        if (joinedEl) joinedEl.style.display = session.settings.recordingEnabled ? 'none' : 'flex';
        document.getElementById('info-text-join-failed-preview').style.display = 'none';
    });
    
    joinButtonBackgroundColorPicker.addEventListener('change', () => {
        session.settings.joinButtonColor = joinButtonBackgroundColorPicker.value;
        document.body.style.setProperty('--join-checkbox-checked-bg', session.settings.joinButtonColor);
        updateSettings();
    });
 
    joinButtonTextInput.addEventListener('change', () => {
        session.settings.joinButtonText = joinButtonTextInput.value;
        updateSettings();
    });

    joinTextColorPicker.addEventListener('change', () => {
        session.settings.joinTextColor = joinTextColorPicker.value;
        updateSettings();
    });

    const joinRequiresConsentInput = document.getElementById('join-requires-consent-enabled');
    if (joinRequiresConsentInput) {
        joinRequiresConsentInput.addEventListener('change', () => {
            session.settings.joinRequiresConsent = !!joinRequiresConsentInput.checked;
            const sw = document.getElementById('join-requires-consent-switch');
            if (sw) sw.setAttribute('aria-pressed', joinRequiresConsentInput.checked ? 'true' : 'false');
            updateSettings();
            applyPreview();
        });
    }

    const mlbSupportEmailInput = document.getElementById('mlb-support-email');
    if (mlbSupportEmailInput) {
        const applySupportFromField = () => {
            const v = (mlbSupportEmailInput.value || '').trim().replace(/^mailto:/i, '');
            session.settings.supportEmail = v || 'VixiSuiteSupport@thefamousgroup.com';
            applyMlbSupportLinkPreviewHref();
            updateSettings();
        };
        mlbSupportEmailInput.addEventListener('change', applySupportFromField);
        mlbSupportEmailInput.addEventListener('input', () => {
            const v = (mlbSupportEmailInput.value || '').trim().replace(/^mailto:/i, '');
            session.settings.supportEmail = v || 'VixiSuiteSupport@thefamousgroup.com';
            applyMlbSupportLinkPreviewHref();
        });
    }

    //Leave Button Preview Event Listeners
    leaveButtonPreview.addEventListener('click', () => {
        leaveButtonPreview.style.display = 'none';
        joinButtonPreview.style.display = 'block';
        const previewEl = document.getElementById('info-text-preview');
        if (previewEl) previewEl.style.display = 'flex';
        document.getElementById('info-text-joined-preview').style.display = 'none';
        document.getElementById('info-text-join-failed-preview').style.display = 'none';
    });

    leaveButtonTextInput.addEventListener('change', () => {
        session.settings.leaveButtonText = leaveButtonTextInput.value;
        updateSettings();
    });

    leaveButtonBackgroundColorInput.addEventListener('change', () => {
        session.settings.leaveButtonColor = leaveButtonBackgroundColorInput.value;
        updateSettings();
    });

    leaveTextColorInput.addEventListener('change', () => {
        session.settings.leaveTextColor = leaveTextColorInput.value;
        updateSettings();
    });

    // Recording button color and instructions
    if (recordButtonColorPicker) {
        recordButtonColorPicker.addEventListener('input', () => {
            session.settings.recordButtonColor = recordButtonColorPicker.value || '#D52265';
            updateSettings();
        });
    }
    if (recordDownloadColorPicker) {
        recordDownloadColorPicker.addEventListener('input', () => {
            session.settings.recordDownloadColor = recordDownloadColorPicker.value || '#FF3B30';
            updateSettings();
        });
    }
    if (photoInstructionsInput) {
        photoInstructionsInput.addEventListener('change', () => {
            session.settings.photoInstructions = photoInstructionsInput.value || 'Tap for photo';
            updateSettings();
        });
    }
    if (videoInstructionsInput) {
        videoInstructionsInput.addEventListener('change', () => {
            session.settings.videoInstructions = videoInstructionsInput.value || 'Hold for video';
            updateSettings();
        });
    }
    if (downloadInstructionsInput) {
        downloadInstructionsInput.addEventListener('change', () => {
            session.settings.downloadInstructions = downloadInstructionsInput.value || 'Tap the icon to download your recording';
            updateSettings();
        });
    }
    if (endCardDownloadPromptInput) {
        endCardDownloadPromptInput.addEventListener('change', () => {
            session.settings.endCardDownloadPrompt = endCardDownloadPromptInput.value || 'Thanks for participating, to download your video press the button below.';
            updateSettings();
        });
    }
    // Upload zones → trigger hidden file inputs
    const fileTitle = document.getElementById('asset-file-title');
    const fileBg = document.getElementById('asset-file-bg');
    const fileEnd = document.getElementById('asset-file-endcard');
    const thumbTitle = document.getElementById('asset-thumb-title');
    const thumbBg = document.getElementById('asset-thumb-bg');
    const thumbEnd = document.getElementById('asset-thumb-endcard');
    const clickInput = (el) => { if (el) el.click(); };
    if (thumbTitle && fileTitle) {
        thumbTitle.addEventListener('click', () => clickInput(fileTitle));
        thumbTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickInput(fileTitle); }});
    }
    if (thumbBg && fileBg) {
        thumbBg.addEventListener('click', () => clickInput(fileBg));
        thumbBg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickInput(fileBg); }});
    }
    if (thumbEnd && fileEnd) {
        thumbEnd.addEventListener('click', () => clickInput(fileEnd));
        thumbEnd.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickInput(fileEnd); }});
    }
    // Asset visibility listeners
    const syncAssetAria = (id) => {
        const cb = document.getElementById(id);
        const lab = document.querySelector(`label[for="${id}"]`);
        if (lab && cb) {
            lab.setAttribute('aria-pressed', cb.checked ? 'true' : 'false');
            syncAssetEyeIcon(lab);
        }
    };
    if (assetTitleVisible) {
        assetTitleVisible.addEventListener('change', () => {
            session.settings.showTitleImage = !!assetTitleVisible.checked;
            const titlePrev = document.getElementById('input-title-preview');
            const header = document.getElementById('preview-page-header');
            const shouldShowHeader = session.settings.showTitleImage && !session.settings.hideTitle;
            if (titlePrev) titlePrev.style.display = shouldShowHeader ? 'block' : 'none';
            if (header) header.style.display = shouldShowHeader ? '' : 'none';
            syncAssetAria('asset-title-visible');
            updateSettings();
        });
    }
    if (assetBgVisible) {
        assetBgVisible.addEventListener('change', () => {
            session.settings.showBackgroundImage = !!assetBgVisible.checked;
            syncAssetAria('asset-bg-visible');
            updateSettings();
            applyPreview();
        });
    }
    if (assetEndCardVisible) {
        assetEndCardVisible.addEventListener('change', () => {
            session.settings.showEndCardImage = !!assetEndCardVisible.checked;
            syncAssetAria('asset-endcard-visible');
            // Just persist; preview is handled by applyPreview for endcard state
            updateSettings();
        });
    }
    // Auto-redirect
    if (autoRedirectInput) {
        autoRedirectInput.addEventListener('change', () => {
            session.settings.autoRedirect = !!autoRedirectInput.checked;
            const switchLabel = document.getElementById('auto-redirect-switch');
            if (switchLabel) switchLabel.setAttribute('aria-pressed', autoRedirectInput.checked ? 'true' : 'false');
            // Hide End Card toggle and preview button when !isMLB and auto-redirect is on
            const hideEndcardUI = !session.settings.isMLB && session.settings.autoRedirect;
            if (assetEndcardVisibleRow) assetEndcardVisibleRow.style.display = hideEndcardUI ? 'none' : '';
            if (endcardBtn) endcardBtn.style.display = hideEndcardUI ? 'none' : '';
            updateSettings();
        });
    }
    // Preview state handling
    if (previewStates) {
        previewStates.addEventListener('click', (e) => {
            const btn = e.target?.closest('button[data-state]');
            if (!btn) return;
            previewState = btn.getAttribute('data-state') || 'onboarding';
            const buttons = Array.from(previewStates.querySelectorAll('button'));
            buttons.forEach((b) => {
                const isActive = b === btn;
                b.classList.toggle('uk-active', isActive);
                b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });
            applyPreview();
        });
        // Start with Onboarding in the selected state
        const onboardingBtn = document.getElementById('preview-state-onboarding');
        if (onboardingBtn) {
            previewStates.querySelectorAll('button').forEach((b) => {
                const isActive = b === onboardingBtn;
                b.classList.toggle('uk-active', isActive);
                b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });
        }
    }

    // Add an event listener for all inputs of type file
    document.querySelectorAll('input[type="file"]').forEach(input => {
        input.addEventListener('change', async (e) => {
            //console.log('file changed', e);
            if (e.target.id === 'clip-input') {
                saveClip(e);
            } else {
                updateImages(e);
            }
        });
    });

    // Program Generator
    clipInput = document.getElementById('clip-input');
    clipInputBtn = document.getElementById('clip-input-btn');
    clipInputText = document.getElementById('clip-input-text');
    generateBtn = document.getElementById('generate-btn');
    customProgramsContainer = document.getElementById('custom-programs');

    generateBtn.addEventListener('click', () => {
        console.log('Generate button clicked');
        generateCustomProgram();
    });

    customProgramManagerBody = document.getElementById('custom-program-manager-body');

    document.getElementById('user-link').href = `https://api.vixisuite.thefamousgroup.com/go/i/${token}`;
    document.getElementById('output-link').href = `https://lightshow.vixisuite.thefamousgroup.com/output/${token}`;

    // Recording inputs
    recordingEnabledInput = document.getElementById('recording-enabled');
    maxRecordingDurationInput = document.getElementById('max-recording-duration');

    recordingEnabledInput.addEventListener('change', () => {
        session.settings.recordingEnabled = recordingEnabledInput.checked;
        const show = recordingEnabledInput.checked;
        const options = document.getElementById('recording-options');
        if (options) options.style.display = show ? 'block' : 'none';
        const durationRow = document.getElementById('recording-duration-row');
        if (durationRow && show) {
            const useSlider = session.settings.recordingSlider !== false;
            durationRow.style.display = useSlider ? 'block' : 'none';
        }
        const infoTextJoinedContainer = document.getElementById('info-text-joined-container');
        if (infoTextJoinedContainer) infoTextJoinedContainer.style.display = show ? 'none' : '';
        applyPreview();
        updateSettings();
    });

    maxRecordingDurationInput.addEventListener('input', () => {
        document.getElementById('recording-duration-display').textContent = maxRecordingDurationInput.value;
    });

    maxRecordingDurationInput.addEventListener('change', () => {
        session.settings.maxRecordingDuration = parseInt(maxRecordingDurationInput.value, 10);
        updateSettings();
    });

    // No longer using recordingPromptText
});

/* --------------------------------------------------------------------------------------------------------------- */
/* Announce the Producer to the server once the connection is established                                          */
/* --------------------------------------------------------------------------------------------------------------- */
//get the token from the url path
const token = window.location.pathname.split('/').pop();
console.log('Token: ', token);

socket.on('server-ready', (timestamp, id) => {
    // convert timestamp to human readable date
    const date = new Date(timestamp);
    const humanReadableDate = date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' });
    session.connectionId = id;

    console.log('Server ready, announcing producer', humanReadableDate, session.connectionId);
    socket.emit('producer-connected', token, Date.now());
});

socket.on('token-not-found', (token) => {
    console.error('Token not found');
    //redirect to the dist/500.html
    window.location.href = `../${PAGES.fiveHundred}`;
});
/* --------------------------------------------------------------------------------------------------------------- */
/* SOCKET EVENTS                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
socket.on('assets-settings-programs', async (assets, settings, customPrograms, defaultPrograms, displayName, gateRecordingEnabled) => {

    session.assets = assets || null;
    session.displayName = displayName || null;
    session.customPrograms = customPrograms || null;
    session.defaultPrograms = defaultPrograms || null;
    const prevGate = !!session.gateRecordingEnabled;
    session.gateRecordingEnabled = !!gateRecordingEnabled;

    await updateSessionSettings(settings);
    console.log('### SESSION', session);

    // If recording gate just turned on for the first time, default recordingEnabled to false
    if (!prevGate && session.gateRecordingEnabled === true) {
        if (typeof settings?.recordingEnabled !== 'boolean') {
            session.settings.recordingEnabled = false;
            try { updateSettings(); } catch (_) {}
        }
    }

    handleState();
    await displayPrograms(session.defaultPrograms, 'default');
    await displayPrograms(session.customPrograms, 'custom');
    await displayAssets(session.assets);
    applyPreview();
    await renderSettings();
    await addProgramsToManager(session.customPrograms);
});

socket.on('assets', (assets) => {
    console.log('Displaying assets after update');
    session.assets = assets;
    displayAssets(session.assets);
    applyPreview();
});

socket.on('settings', async (settings) => {
    console.log('Displaying settings after update');
    await updateSessionSettings(settings);
    console.log('Session: ', session);
    handleState();
    renderSettings();
});

socket.on('custom-programs', (customPrograms) => {
    console.log('Displaying custom programs after update', customPrograms);
    session.customPrograms = customPrograms;
    displayPrograms(session.customPrograms, 'custom');
    addProgramsToManager(session.customPrograms);
});

function unlockShow() {
    console.log('Unlocking show');
    socket.emit('unlock', token, Date.now());
    session.settings.locked = false;
    updateSettings();
    handleState();
}

/* --------------------------------------------------------------------------------------------------------------- */
/* LOCK SHOW                                                                                                       */
/* --------------------------------------------------------------------------------------------------------------- */
async function updateSessionSettings(settings) {
    console.log('### Updating session settings with new settings', settings);
    session.settings.activeProgram = settings.activeProgram || null;
    session.settings.favoritePrograms = settings.favoritePrograms || [];
    session.settings.joinButtonColor = settings.joinButtonColor || '#D52265';
    session.settings.joinButtonText = settings.joinButtonText || 'Join Light Show';
    session.settings.joinTextColor = settings.joinTextColor || '#FFFFFF';
    session.settings.leaveButtonColor = settings.leaveButtonColor || '#D52265';
    session.settings.leaveButtonText = settings.leaveButtonText || 'Leave Light Show';
    session.settings.leaveTextColor = settings.leaveTextColor || '#FFFFFF';
    session.settings.infoTextOnboarding = settings.infoTextOnboarding || 'Participating in Vixi Light Show requires access to your camera and flashlight. Please tap the button below to begin.';
    session.settings.infoTextJoined = settings.infoTextJoined || 'You are now participating in the LightShow, enjoy!';
    session.settings.infoTextJoinFailed = settings.infoTextJoinFailed || 'Unable to connect to your camera or flashlight. Please try again.';
    session.settings.infoTextColor = settings.infoTextColor || '#FFFFFF';
    session.settings.infoTextBgColor = settings.infoTextBgColor || 'rgba(0, 0, 0, 0.1)';

    //if settings.[value] is null,or undefined or not a boolean, or does not exist, set it to true
    if (settings.locked === null || settings.locked === undefined || typeof settings.locked !== 'boolean') {
        settings.locked = true;
    }
    if (settings.loop === null || settings.loop === undefined || typeof settings.loop !== 'boolean') {
        settings.loop = true;
    }
    if (settings.paused === null || settings.paused === undefined || typeof settings.paused !== 'boolean') {
        settings.paused = true;
    }
    if (settings.playing === null || settings.playing === undefined || typeof settings.playing !== 'boolean') {
        settings.playing = false;
    }

    session.settings.locked = settings.locked;
    session.settings.loop = settings.loop ;
    session.settings.mode = settings.mode || 'default';
    lw_applyLightwaveSettings(session.settings, settings);
    session.settings.paused = settings.paused
    session.settings.playing = settings.playing;
    session.settings.redirectUrl = settings.redirectUrl || null;
    session.settings.startDateTime = settings.startDateTime || null;
    session.settings.startDelay = settings.startDelay || 0;
    session.settings.isMLB = settings.isMLB || false;
    session.settings.footerTextColor = settings.footerTextColor || '#C5C5C5';
    session.settings.footerLinkColor = settings.footerLinkColor || '#D52265';
    {
        const raw = settings.supportEmail;
        let se = typeof raw === 'string' ? raw.trim().replace(/^mailto:/i, '') : '';
        if (!se) {
            se = 'VixiSuiteSupport@thefamousgroup.com';
        }
        session.settings.supportEmail = se;
    }
    session.settings.joinRequiresConsent = settings.joinRequiresConsent === true;
    session.settings.recordButtonColor = settings.recordButtonColor || '#D52265';
    session.settings.recordDownloadColor = settings.recordDownloadColor || '#FF3B30';
    session.settings.photoInstructions = typeof settings.photoInstructions === 'string' ? settings.photoInstructions : 'Tap for photo';
    session.settings.videoInstructions = typeof settings.videoInstructions === 'string' ? settings.videoInstructions : 'Hold for video';
    session.settings.downloadInstructions = typeof settings.downloadInstructions === 'string' ? settings.downloadInstructions : 'Tap the icon to download your recording';
    session.settings.endCardDownloadPrompt = typeof settings.endCardDownloadPrompt === 'string' ? settings.endCardDownloadPrompt : 'Thanks for participating, to download your video press the button below.';
    session.settings.rotateDeviceMessage = typeof settings.rotateDeviceMessage === 'string' ? settings.rotateDeviceMessage : 'Please rotate your phone';
    session.settings.showLockedMessage = typeof settings.showLockedMessage === 'string' ? settings.showLockedMessage : 'The LightShow is not currently active';
    session.settings.hideTitle = !!settings.hideTitle;
    // New flags with sensible defaults
    session.settings.autoRedirect = settings.autoRedirect !== undefined ? !!settings.autoRedirect : true;
    session.settings.showTitleImage = settings.showTitleImage !== false;
    session.settings.showBackgroundImage = settings.showBackgroundImage !== false;
    session.settings.showEndCardImage = settings.showEndCardImage !== false;
    if (typeof settings.gateRecordingEnabled === 'boolean') {
        session.gateRecordingEnabled = settings.gateRecordingEnabled;
    }
    if (typeof settings.recordingSlider === 'boolean') {
        session.settings.recordingSlider = settings.recordingSlider;
    } else if ('recordingSlider' in settings) {
        session.settings.recordingSlider = settings.recordingSlider !== false;
    }
    session.settings.recordingEnabled = settings.recordingEnabled || false;
    if (session.settings.recordingSlider === false) {
        session.settings.maxRecordingDuration = 30;
    } else {
        session.settings.maxRecordingDuration = typeof settings.maxRecordingDuration === 'number' ? settings.maxRecordingDuration : 30;
    }
    // recordingPromptText deprecated

    if (!Array.isArray(session.settings?.favoritePrograms)) {
        session.settings.favoritePrograms = [];
    }
    syncLwProducerUi();
}

/* --------------------------------------------------------------------------------------------------------------- */
/* HANDLE STATE                                                                                                    */
/* --------------------------------------------------------------------------------------------------------------- */
function handleState() {
    console.log('Handling state: ', session.settings.locked);
    if (session.settings.locked) {
        document.getElementById('show-controls-overlay').style.display = 'block';
    } else {
        document.getElementById('show-controls-overlay').style.display = 'none';
    }
}
/* --------------------------------------------------------------------------------------------------------------- */
/* DISPLAY ASSETS                                                                                                  */
/* --------------------------------------------------------------------------------------------------------------- */
function displayAssets(assets) {
    //console.log('Displaying assets', assets);
    if (!assets || !assets.input) return;
    if(assets.input.backgroundImage.url) {
        const body = document.getElementById('preview-body');
        if (body) body.style.backgroundImage = `url(${assets.input.backgroundImage.url || '../assets/images/blank.png'})`;
        const bgThumb = document.getElementById('asset-thumb-bg');
        if (bgThumb) bgThumb.style.backgroundImage = `url(${assets.input.backgroundImage.url || ''})`;
    }
    if(assets.input.titleImage.url) {
        const title = document.getElementById('input-title-preview');
        if (title) title.style.backgroundImage = `url(${assets.input.titleImage.url || '../assets/images/blank.png'})`;
        const tThumb = document.getElementById('asset-thumb-title');
        if (tThumb) tThumb.style.backgroundImage = `url(${assets.input.titleImage.url || ''})`;
    }
    if (assets.input.endCardImage && assets.input.endCardImage.url) {
        const endThumb = document.getElementById('asset-thumb-endcard');
        if (endThumb) endThumb.style.backgroundImage = `url(${assets.input.endCardImage.url})`;
    } else {
        const endThumb = document.getElementById('asset-thumb-endcard');
        const fallbackUrl = assets.input.backgroundImage && assets.input.backgroundImage.url ? assets.input.backgroundImage.url : '';
        if (endThumb) endThumb.style.backgroundImage = fallbackUrl ? `url(${fallbackUrl})` : '';
    }

    if(assets.output.backgroundImage.url) document.getElementById('output-container-preview').style.backgroundImage = `url(${assets.output.backgroundImage.url || '../assets/images/blank.png'})`;
    if(assets.output.titleImage.url) document.getElementById('output-title-preview').style.backgroundImage = `url(${assets.output.titleImage.url || '../assets/images/blank.png'})`;
    if(assets.qr.url) document.getElementById('output-qr-preview').style.backgroundImage = `url(${assets.qr.url || '../assets/images/blank.png'})`;
}
/* --------------------------------------------------------------------------------------------------------------- */
/* DISPLAY SETTINGS                                                                                                */
/* --------------------------------------------------------------------------------------------------------------- */
function renderSettings() {
    console.log('Rendering settings', session.settings);
    //Update the related active programItem to active
    console.log('Displaying active program');
    const programItems = document.querySelectorAll('.uk-button-control');
    //console.log('Program items', programItems);
    programItems.forEach(item => {
        //console.log('Program item', item.getAttribute('data-program-name'));
        item.classList.remove('uk-active');
        item.setAttribute('state', 'inactive');
    });

    if (session.settings.activeProgram !== null && session.settings.activeProgram !== undefined && session.settings.activeProgram !== '') {
        programItems.forEach(item => {
            if (item.getAttribute('data-program-name') === session.settings.activeProgram) {
                item.classList.add('uk-active');
                item.setAttribute('state', 'active');
            }
        });
    }
    
    console.log('Displaying settings');
    /* ------------------------------------------------------- */
    // Set redirect url if it is set and not "" or null or undefined
    if (session.settings.redirectUrl && session.settings.redirectUrl !== "" 
        && session.settings.redirectUrl !== null && session.settings.redirectUrl !== undefined) {   
        redirectUrlElement.value = session.settings.redirectUrl;
    }


    // Set info text if it is set and not "" or null or undefined
    if (session.settings.infoTextOnboarding && session.settings.infoTextOnboarding !== ""
        && session.settings.infoTextOnboarding !== null && session.settings.infoTextOnboarding !== undefined) {
        document.getElementById('info-text-onboarding').value = session.settings.infoTextOnboarding;
        const onboardingContent = document.getElementById('info-text-onboarding-content');
        if (onboardingContent) onboardingContent.textContent = session.settings.infoTextOnboarding;
    }

    // Set info text joined if it is set and not "" or null or undefined
    if (session.settings.infoTextJoined && session.settings.infoTextJoined !== "" 
        && session.settings.infoTextJoined !== null && session.settings.infoTextJoined !== undefined) {
        document.getElementById('info-text-joined').value = session.settings.infoTextJoined;
        document.getElementById('info-text-joined-preview').innerHTML = session.settings.infoTextJoined;
    }
    
    // Set info text join failed if it is set and not "" or null or undefined
    if (session.settings.infoTextJoinFailed && session.settings.infoTextJoinFailed !== "" 
        && session.settings.infoTextJoinFailed !== null && session.settings.infoTextJoinFailed !== undefined) {
        document.getElementById('info-text-join-failed').value = session.settings.infoTextJoinFailed;
        document.getElementById('info-text-join-failed-preview').innerHTML = session.settings.infoTextJoinFailed;
    }

    const rotateDeviceMessageEl = document.getElementById('rotate-device-message');
    if (rotateDeviceMessageEl && typeof session.settings.rotateDeviceMessage === 'string') {
        rotateDeviceMessageEl.value = session.settings.rotateDeviceMessage;
    }

    const showLockedMessageEl = document.getElementById('show-locked-message');
    if (showLockedMessageEl && typeof session.settings.showLockedMessage === 'string') {
        showLockedMessageEl.value = session.settings.showLockedMessage;
    }

    // Set info text color if it is set and not "" or null or undefined
    if (session.settings.infoTextColor && session.settings.infoTextColor !== "" 
        && session.settings.infoTextColor !== null && session.settings.infoTextColor !== undefined) {
        const itc = document.getElementById('info-text-color-color');
        if (itc) itc.value = session.settings.infoTextColor;
        document.getElementById('info-text-preview').style.color = session.settings.infoTextColor;
        document.getElementById('info-text-joined-preview').style.color = session.settings.infoTextColor;
        document.getElementById('info-text-join-failed-preview').style.color = session.settings.infoTextColor;
        const previewConsentLabel = document.getElementById('preview-join-consent-label');
        if (previewConsentLabel) previewConsentLabel.style.color = session.settings.infoTextColor;
    }

    // Set info text background color
    if (session.settings.infoTextBgColor !== undefined && session.settings.infoTextBgColor !== null) {
        infoTextBgColorInput.value = session.settings.infoTextBgColor;
        const previewContainer = document.getElementById('info-text-container');
        if (previewContainer) previewContainer.style.backgroundColor = session.settings.infoTextBgColor;
        lastValidInfoTextBgColor = session.settings.infoTextBgColor;
        infoTextBgColorInput.classList.remove('uk-form-danger');
        // Initialize numeric alpha picker from existing color
        if (infoTextBgColorPicker && infoTextBgAlphaInput) {
            const parsed = parseCssColor(session.settings.infoTextBgColor);
            if (parsed) {
                infoTextBgColorPicker.value = rgbToHex(parsed.r, parsed.g, parsed.b);
                infoTextBgAlphaInput.value = String(clamp(Math.round((parsed.a ?? 1) * 100), 1, 100));
            }
        }
    }


    // Set join button color if it is set and not "" or null or undefined
    if (session.settings.joinButtonColor && session.settings.joinButtonColor !== "" 
        && session.settings.joinButtonColor !== null && session.settings.joinButtonColor !== undefined) {
            if (!session.settings.joinButtonColor.startsWith('#')) {
                session.settings.joinButtonColor = '#' + session.settings.joinButtonColor;
            }
        const jbc = document.getElementById('join-button-color-color');
        if (jbc) jbc.value = session.settings.joinButtonColor;
        document.getElementById('join-btn-preview').style.backgroundColor = session.settings.joinButtonColor;
        document.getElementById('join-btn-preview').style.borderColor = session.settings.joinButtonColor;
        document.body.style.setProperty('--join-checkbox-checked-bg', session.settings.joinButtonColor);
    } else {
        document.body.style.setProperty('--join-checkbox-checked-bg', '#D52265');
    }
    // Set join button text if it is set and not "" or null or undefined
    if (session.settings.joinButtonText && session.settings.joinButtonText !== "" 
        && session.settings.joinButtonText !== null && session.settings.joinButtonText !== undefined) {
        joinButtonTextInput.value = session.settings.joinButtonText;
        document.getElementById('join-btn-preview').innerHTML = '<span class="mdi mdi-flash"></span>' + session.settings.joinButtonText;
    }

    // Set join button text color if it is set and not "" or null or undefined
    if (session.settings.joinTextColor && session.settings.joinTextColor !== "" 
        && session.settings.joinTextColor !== null && session.settings.joinTextColor !== undefined) {
        const jtc = document.getElementById('join-text-color-color');
        if (jtc) jtc.value = session.settings.joinTextColor;
        document.getElementById('join-btn-preview').style.color = session.settings.joinTextColor;
    }

    /*
    // set leave button color if it is set and not "" or null or undefined
    if (session.settings.leaveButtonColor && session.settings.leaveButtonColor !== "" 
        && session.settings.leaveButtonColor !== null && session.settings.leaveButtonColor !== undefined) {
        leaveButtonBackgroundColorInput.value = session.settings.leaveButtonColor;
        document.getElementById('leave-btn-preview').style.backgroundColor = session.settings.leaveButtonColor;
        document.getElementById('leave-btn-preview').style.borderColor = session.settings.leaveButtonColor;
    }


    // Set leave button text color if it is set and not "" or null or undefined
    if (session.settings.leaveTextColor && session.settings.leaveTextColor !== "" 
        && session.settings.leaveTextColor !== null && session.settings.leaveTextColor !== undefined) {
        leaveTextColorInput.value = session.settings.leaveTextColor;
        document.getElementById('leave-btn-preview').style.color = session.settings.leaveTextColor;
    }

    // Set leave button text if it is set and not "" or null or undefined
    if (session.settings.leaveButtonText && session.settings.leaveButtonText !== ""
        && session.settings.leaveButtonText !== null && session.settings.leaveButtonText !== undefined) {
        leaveButtonTextInput.value = session.settings.leaveButtonText;
    }
    */
    // Recording section — only shown when deployment has gateRecordingEnabled
    const recordingSection = document.getElementById('recording-section');
    if (session.gateRecordingEnabled) {
        recordingSection.style.display = 'block';
        if (recordingEnabledInput) {
            recordingEnabledInput.checked = session.settings.recordingEnabled;
            const showRows = session.settings.recordingEnabled;
            const options = document.getElementById('recording-options');
            if (options) options.style.display = showRows ? 'block' : 'none';
            const durationRow = document.getElementById('recording-duration-row');
            const rbRow   = document.getElementById('record-button-color-row');
            const rdlRow  = document.getElementById('record-download-color-row');
            const instrRow = document.getElementById('recording-instructions-row');
            const endCardPromptRow = document.getElementById('end-card-download-prompt-row');
            const recordingSlider = session.settings.recordingSlider !== false;
            if (durationRow) {
                if (recordingSlider) {
                    durationRow.style.display = showRows ? 'block' : 'none';
                } else {
                    durationRow.style.display = 'none';
                    session.settings.maxRecordingDuration = 30;
                }
            }
            if (rbRow) rbRow.style.display = showRows ? 'block' : 'none';
            if (rdlRow) rdlRow.style.display = showRows ? 'block' : 'none';
            if (instrRow) instrRow.style.display = showRows ? 'block' : 'none';
            const downloadInstrRow = document.getElementById('recording-instructions-row-download');
            if (downloadInstrRow) downloadInstrRow.style.display = showRows ? 'flex' : 'none';
            if (endCardPromptRow) endCardPromptRow.style.display = 'none'; // Always hidden on producer
        }
        if (maxRecordingDurationInput) {
            maxRecordingDurationInput.value = session.settings.maxRecordingDuration;
            document.getElementById('recording-duration-display').textContent = session.settings.maxRecordingDuration;
        }
        if (recordButtonColorPicker) recordButtonColorPicker.value = session.settings.recordButtonColor || '#D52265';
        if (recordDownloadColorPicker) recordDownloadColorPicker.value = session.settings.recordDownloadColor || '#FF3B30';
        if (photoInstructionsInput) photoInstructionsInput.value = session.settings.photoInstructions || 'Tap for photo';
        if (videoInstructionsInput) videoInstructionsInput.value = session.settings.videoInstructions || 'Hold for video';
        const downloadInstructionsInputEl = document.getElementById('download-instructions');
        if (downloadInstructionsInputEl) downloadInstructionsInputEl.value = session.settings.downloadInstructions || 'Tap the icon to download your recording';
        const endCardDownloadPromptEl = document.getElementById('end-card-download-prompt');
        if (endCardDownloadPromptEl) endCardDownloadPromptEl.value = session.settings.endCardDownloadPrompt || 'Thanks for participating, to download your video press the button below.';
    } else {
        recordingSection.style.display = 'none';
    }

    // Footer styling visibility and values
    const footerLinkRow = document.getElementById('footer-link-color-row');
    if (footerLinkRow) footerLinkRow.style.display = session.settings.isMLB ? '' : 'none';
    const mlbSupportEmailRow = document.getElementById('mlb-support-email-row');
    if (mlbSupportEmailRow) mlbSupportEmailRow.style.display = session.settings.isMLB ? '' : 'none';
    const mlbSupportEmailEl = document.getElementById('mlb-support-email');
    if (mlbSupportEmailEl) {
        mlbSupportEmailEl.value = session.settings.supportEmail || 'VixiSuiteSupport@thefamousgroup.com';
    }
    applyMlbSupportLinkPreviewHref();
    const joinRequiresConsentEl = document.getElementById('join-requires-consent-enabled');
    if (joinRequiresConsentEl) {
        joinRequiresConsentEl.checked = !!session.settings.joinRequiresConsent;
        const jrcSw = document.getElementById('join-requires-consent-switch');
        if (jrcSw) jrcSw.setAttribute('aria-pressed', joinRequiresConsentEl.checked ? 'true' : 'false');
    }
    const showLockedMessageContainer = document.getElementById('show-locked-message-container');
    if (showLockedMessageContainer) showLockedMessageContainer.style.display = session.settings.isMLB ? '' : 'none';
    const showLockedMessageEndcardContainer = document.getElementById('show-locked-message-endcard-container');
    if (showLockedMessageEndcardContainer) showLockedMessageEndcardContainer.style.display = session.settings.autoRedirect ? 'none' : '';
    const showLockedMessageEndcardEl = document.getElementById('show-locked-message-endcard');
    if (showLockedMessageEndcardEl) {
        showLockedMessageEndcardEl.value = (session.settings.showLockedMessage && String(session.settings.showLockedMessage).trim()) ? session.settings.showLockedMessage : 'The LightShow is not currently active';
    }
    if (footerTextColorPicker) footerTextColorPicker.value = session.settings.footerTextColor || '#C5C5C5';
    if (footerLinkColorPicker) footerLinkColorPicker.value = session.settings.footerLinkColor || '#D52265';
    // MLB preview
    const mlbPrev = document.getElementById('mlb-footer-preview');
    if (mlbPrev) {
        if (session.settings.isMLB) {
            mlbPrev.style.display = 'block';
            mlbPrev.style.color = session.settings.footerTextColor || '#C5C5C5';
            mlbPrev.querySelectorAll('a').forEach(a => a.style.color = session.settings.footerLinkColor || '#D52265');
        } else {
            mlbPrev.style.display = 'none';
        }
    }
    // Apply footer CSS variables on preview footer
    const previewFooter = document.getElementById('preview-page-footer');
    if (previewFooter) {
        if (session.settings.footerTextColor) {
            previewFooter.style.setProperty('--footer-text-color', session.settings.footerTextColor);
            previewFooter.style.color = session.settings.footerTextColor;
        }
        if (session.settings.footerLinkColor) {
            previewFooter.style.setProperty('--footer-link-color', session.settings.footerLinkColor);
        }
    }
    // Hide preview footer and footer styling controls when MLB false and recording gate disabled
    const shouldHideFooter = !session.settings.isMLB && !session.gateRecordingEnabled;
    const footerHeader = document.getElementById('footer-styling-header');
    if (footerHeader) footerHeader.style.display = shouldHideFooter ? 'none' : '';
    const footerTextContainer = document.getElementById('footer-text-color-container');
    if (footerTextContainer) footerTextContainer.style.display = shouldHideFooter ? 'none' : '';
    const infoTextJoinedContainer = document.getElementById('info-text-joined-container');
    if (infoTextJoinedContainer) infoTextJoinedContainer.style.display = session.settings.recordingEnabled ? 'none' : '';
    const titlePrev = document.getElementById('input-title-preview');
    if (titlePrev) titlePrev.style.display = session.settings.hideTitle ? 'none' : 'block';

    // Asset toggles initial states
    const assetTitleVisible = document.getElementById('asset-title-visible');
    const assetBgVisible = document.getElementById('asset-bg-visible');
    const assetEndCardVisible = document.getElementById('asset-endcard-visible');
    if (assetTitleVisible) assetTitleVisible.checked = !!session.settings.showTitleImage;
    if (assetBgVisible) assetBgVisible.checked = !!session.settings.showBackgroundImage;
    if (assetEndCardVisible) assetEndCardVisible.checked = !!session.settings.showEndCardImage;
    // Apply visibility to preview
    if (titlePrev) titlePrev.style.display = session.settings.showTitleImage && !session.settings.hideTitle ? 'block' : 'none';
    // Sync aria-pressed on eye labels
    const eyeTitle = document.querySelector('label[for="asset-title-visible"]');
    const eyeBg = document.querySelector('label[for="asset-bg-visible"]');
    const eyeEnd = document.querySelector('label[for="asset-endcard-visible"]');
    if (eyeTitle && assetTitleVisible) eyeTitle.setAttribute('aria-pressed', assetTitleVisible.checked ? 'true' : 'false');
    if (eyeBg && assetBgVisible) eyeBg.setAttribute('aria-pressed', assetBgVisible.checked ? 'true' : 'false');
    if (eyeEnd && assetEndCardVisible) eyeEnd.setAttribute('aria-pressed', assetEndCardVisible.checked ? 'true' : 'false');
    [eyeTitle, eyeBg, eyeEnd].forEach((el) => { if (el && el.classList.contains('asset-eye')) syncAssetEyeIcon(el); });

    // Redirect/MLB UI visibility
    const redirectContainer = document.getElementById('redirect-url-container');
    const redirectSettings = document.getElementById('redirect-settings');
    const autoRedirectRow = document.getElementById('auto-redirect-row');
    const autoRedirectInput = document.getElementById('auto-redirect-enabled');
    const endcardBtn = document.getElementById('preview-state-endcard');
    const assetEndcardVisibleRow = document.getElementById('asset-endcard-visible-row');
    if (redirectContainer) redirectContainer.style.display = session.settings.isMLB ? 'none' : '';
    if (redirectSettings) redirectSettings.style.display = session.settings.isMLB ? 'none' : '';
    if (autoRedirectRow) autoRedirectRow.style.display = session.settings.isMLB ? 'none' : '';
    if (autoRedirectInput) {
        autoRedirectInput.checked = !!session.settings.autoRedirect;
        const switchLabel = document.getElementById('auto-redirect-switch');
        if (switchLabel) switchLabel.setAttribute('aria-pressed', session.settings.autoRedirect ? 'true' : 'false');
    }
    const hideEndcardUI = !session.settings.isMLB && session.settings.autoRedirect;
    if (endcardBtn) endcardBtn.style.display = hideEndcardUI ? 'none' : '';
    if (assetEndcardVisibleRow) assetEndcardVisibleRow.style.display = hideEndcardUI ? 'none' : '';

    // Ensure preview reflects current state
    applyPreview();
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function isValidCssColor(str) {
    if (typeof str !== 'string') return false;
    const test = document.createElement('span');
    test.style.backgroundColor = '';
    test.style.backgroundColor = str.trim();
    // backgroundColor will remain empty string if invalid
    return test.style.backgroundColor !== '';
}

function wireRgbaPicker({ colorEl, alphaEl, alphaValEl, settingKey, hiddenMirrorEl, onPreview }) {
    if (!colorEl || !alphaEl) return;
    const apply = () => {
        const hex = colorEl.value || '#000000';
        const alphaPct = clamp(parseInt(alphaEl.value || '100', 10), 0, 100);
        if (alphaValEl) alphaValEl.textContent = `${alphaPct}%`;
        const { r, g, b } = hexToRgb(hex);
        const a = +(alphaPct / 100).toFixed(2);
        const rgba = `rgba(${r}, ${g}, ${b}, ${a})`;
        session.settings[settingKey] = rgba;
        if (hiddenMirrorEl) hiddenMirrorEl.value = rgba;
        if (typeof onPreview === 'function') onPreview(rgba);
        updateSettings();
    };
    colorEl.addEventListener('input', apply);
    alphaEl.addEventListener('input', apply);
}

function applyColorToPicker(colorStr, colorEl, alphaEl, alphaValEl) {
    if (!colorEl || !alphaEl || !colorStr) return;
    const parsed = parseCssColor(colorStr);
    if (!parsed) return;
    const { r, g, b, a } = parsed;
    colorEl.value = rgbToHex(r, g, b);
    const pct = Math.round((a ?? 1) * 100);
    alphaEl.value = String(pct);
    if (alphaValEl) alphaValEl.textContent = `${pct}%`;
}

function parseCssColor(str) {
    // Use computed style to normalize
    const t = document.createElement('span');
    t.style.backgroundColor = str;
    document.body.appendChild(t);
    const cs = getComputedStyle(t).backgroundColor; // rgb(...) or rgba(...)
    document.body.removeChild(t);
    const m = cs.match(/rgba?\\((\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*([0-9\\.]+))?\\)/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

function hexToRgb(hex) {
    let h = hex.replace('#', '').trim();
    if (h.length === 3) {
        h = h.split('').map(c => c + c).join('');
    }
    const num = parseInt(h.slice(0, 6), 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex(r, g, b) {
    return (
        '#' +
        [r, g, b]
            .map(v => {
                const s = v.toString(16);
                return s.length === 1 ? '0' + s : s;
            })
            .join('')
    );
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function supportMailtoHrefFromEmail(email) {
    const t = (email || '').trim().replace(/^mailto:/i, '');
    if (!t) {
        return 'mailto:VixiSuiteSupport@thefamousgroup.com';
    }
    return `mailto:${t}`;
}

function applyMlbSupportLinkPreviewHref() {
    const a = document.getElementById('mlb-footer-support-link-preview');
    if (a) {
        a.setAttribute('href', supportMailtoHrefFromEmail(session.settings.supportEmail));
    }
}

// Apply preview state visibility
function applyPreview() {
    const onboarding = document.getElementById('info-text-preview');
    const onboardingContent = document.getElementById('info-text-onboarding-content');
    const showLockedPreview = document.getElementById('info-text-show-locked-preview');
    const joined = document.getElementById('info-text-joined-preview');
    const errorMsg = document.getElementById('info-text-join-failed-preview');
    const joinBtn = document.getElementById('join-btn-preview');
    const endcard = document.getElementById('end-card-preview');
    const header = document.getElementById('preview-page-header');
    const body = document.getElementById('preview-body');
    const infoContainer = document.getElementById('info-text-container');
    // Defaults
    if (onboarding) {
        onboarding.style.display = 'none';
        onboarding.style.backgroundColor = '';
    }
    if (onboardingContent) onboardingContent.style.display = '';
    if (showLockedPreview) showLockedPreview.style.display = 'none';
    if (joined) joined.style.display = 'none';
    if (errorMsg) errorMsg.style.display = 'none';
    if (joinBtn) joinBtn.style.display = 'none';
    const previewConsentRow = document.getElementById('preview-join-consent-row');
    if (previewConsentRow) previewConsentRow.style.display = 'none';
    if (endcard) endcard.style.display = 'none';
    if (infoContainer) infoContainer.style.display = '';
    // Restore header by default based on Title visibility
    if (header) {
        const shouldShowHeader = !!session.settings.showTitleImage && !session.settings.hideTitle;
        header.style.display = shouldShowHeader ? '' : 'none';
    }
    switch (previewState) {
        case 'joined':
            if (joined) joined.style.display = session.settings.recordingEnabled ? 'none' : 'flex';
            if (joinBtn) joinBtn.style.display = 'none';
            if (infoContainer) infoContainer.style.display = session.settings.recordingEnabled ? 'none' : '';
            if (body) {
                const bgUrl = session.assets?.input?.backgroundImage?.url;
                body.style.backgroundImage = (bgUrl && String(bgUrl).trim()) ? `url(${bgUrl})` : 'none';
            }
            break;
        case 'error':
            if (errorMsg) errorMsg.style.display = 'flex';
            if (joinBtn) joinBtn.style.display = 'block';
            if (body) {
                const bgUrl = session.assets?.input?.backgroundImage?.url;
                body.style.backgroundImage = (bgUrl && String(bgUrl).trim()) ? `url(${bgUrl})` : 'none';
            }
            break;
        case 'endcard': {
            const isMLB = !!session.settings.isMLB;
            if (onboarding) onboarding.style.display = 'none';
            const showLockedText = (session.settings.showLockedMessage && String(session.settings.showLockedMessage).trim()) ? session.settings.showLockedMessage : 'The LightShow is not currently active';
            if (showLockedPreview) {
                showLockedPreview.textContent = showLockedText;
                showLockedPreview.style.color = session.settings.infoTextColor || '#FFFFFF';
                showLockedPreview.style.display = 'flex';
            }
            if (isMLB) {
                if (header) header.style.display = '';
                if (infoContainer) infoContainer.style.display = '';
                if (onboardingContent) onboardingContent.style.display = 'none';
                if (endcard) endcard.style.display = 'none';
            } else {
                if (header) header.style.display = '';
                if (infoContainer) infoContainer.style.display = '';
                if (onboarding) onboarding.style.display = 'none';
                if (onboardingContent) onboardingContent.style.display = 'none';
                if (endcard) endcard.style.display = session.settings.autoRedirect ? 'none' : 'block';
            }
            if (body) {
                const endUrl = session.assets?.input?.endCardImage?.url;
                const bgUrl = session.assets?.input?.backgroundImage?.url;
                body.style.backgroundImage = endUrl ? `url(${endUrl})` : (bgUrl ? `url(${bgUrl})` : 'none');
            }
            break;
        }
        case 'onboarding':
        default:
            if (onboarding) onboarding.style.display = 'flex';
            if (onboardingContent) onboardingContent.style.display = '';
            if (joinBtn) joinBtn.style.display = 'block';
            if (previewConsentRow && session.settings.joinRequiresConsent) {
                previewConsentRow.style.display = 'block';
                const pcc = document.getElementById('preview-join-consent-checkbox');
                if (pcc) pcc.checked = false;
            }
            if (body) {
                const bgUrl = session.assets?.input?.backgroundImage?.url;
                body.style.backgroundImage = (bgUrl && String(bgUrl).trim()) ? `url(${bgUrl})` : 'none';
            }
            break;
    }
    // Preview footer: hide if recording disabled; hide on onboarding when isMLB false and gate enabled; show only for joined when recording enabled
    // When isMLB, show footer (and MLB legal) on all preview states: onboarding, joined, error, end card
    const previewFooter = document.getElementById('preview-page-footer');
    if (previewFooter) {
        let showFooter = false;
        if (session.settings.recordingEnabled) {
            if (previewState === 'joined') {
                showFooter = true;
            } else if (previewState === 'onboarding' && !session.settings.isMLB && session.gateRecordingEnabled) {
                showFooter = false;
            }
        }
        const showFooterContainer = showFooter || session.settings.isMLB;
        previewFooter.style.display = showFooterContainer ? '' : 'none';
        const previewRecordingControls = document.getElementById('preview-recording-controls');
        const previewRecordingHint = document.getElementById('preview-recording-hint');
        const mlbFooterPreview = document.getElementById('mlb-footer-preview');
        if (previewRecordingControls) {
            previewRecordingControls.style.display = showFooter && previewState === 'joined' ? 'flex' : 'none';
        }
        if (previewRecordingHint && showFooter && previewState === 'joined') {
            const photo = session.settings.photoInstructions || 'Tap for photo';
            const video = session.settings.videoInstructions || 'Hold for video';
            previewRecordingHint.textContent = `${photo} • ${video}`;
        }
        if (mlbFooterPreview) {
            mlbFooterPreview.style.display = session.settings.isMLB && showFooterContainer ? 'block' : 'none';
        }
    }
}
/* --------------------------------------------------------------------------------------------------------------- */
/* DISPLAY PROGRAMS                                                                                                */
/* --------------------------------------------------------------------------------------------------------------- */
function displayPrograms(programs, type) {
    //console.log('Displaying ' + type + ' programs: ' + programs);
    console.log('Displaying ' + type + ' programs');
    let container;

    // If programs is empty, return
    if (programs === null || programs === undefined || Object.keys(programs).length === 0) {
        console.log('Programs is empty');
        document.getElementById('custom-programs').innerHTML = '<p class="uk-text-muted">No Custom Effects to display, use the Program Builder to create or favorite some.</p>';
        return;
    }

    let list = sortPrograms(programs);
    if (type === 'custom') {
        container = document.getElementById('custom-programs');
        console.log('Favorite Programs: ', session.settings.favoritePrograms);
    } else if (type === 'default') {
        container = document.getElementById('dj-container');
    } else {
        console.error('Invalid Program Type:' + type);
        return;
    }
    container.innerHTML = '';
    for (const program of list) {
        let programItem = null;
        if (type === 'custom') {
            const favorites = Array.isArray(session.settings?.favoritePrograms) ? session.settings.favoritePrograms : [];
            if (!favorites.includes(program.key)) {
                // Skip non-favorited custom programs without aborting the whole render
                continue;
            }
            console.log('Program is a favorite', program.key, favorites);
            programItem = buildProgramItem(program, type);
        } else if (type === 'default') {
            programItem = buildProgramItem(program, type);
        } else {
            console.error('Invalid Program Type: ', type);
            continue;
        }
        container.appendChild(programItem);
        if (type === 'custom') {
            // Fit text to 120x120 tile after it's in the layout tree
            requestAnimationFrame(() => fitCustomProgramText(programItem));
        }
    }
}

function fitCustomProgramText(programItem) {
    const textEl = programItem.querySelector('.custom-program-name');
    if (!textEl) return;
    // Reset styles for accurate measurement
    textEl.style.margin = '0';
    textEl.style.textAlign = 'center';
    textEl.style.whiteSpace = 'wrap';
    textEl.style.wordBreak = 'normal';
    textEl.style.overflow = 'hidden';
    textEl.style.lineHeight = '1.1';

    const maxWidth = programItem.clientWidth - 12;
    const maxHeight = programItem.clientHeight - 12;
    let fontSize = 28; // start reasonably large
    const minFont = 10;
    textEl.style.fontSize = fontSize + 'px';

    // Shrink until it fits both width and height
    for (let i = 0; i < 48 && fontSize >= minFont; i++) {
        if (textEl.scrollWidth <= maxWidth && textEl.scrollHeight <= maxHeight) break;
        fontSize -= 1;
        textEl.style.fontSize = fontSize + 'px';
    }
}

function sortPrograms(programsObj) {
    let list;
    // Convert object to array and sort by order
    list = Object.entries(programsObj)
        .map(([key, value]) => ({ key, ...(value || {}) }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return list;
}

function buildProgramItem(item, type) {
    const programItem = document.createElement('div');
    programItem.classList.add('uk-button');
    programItem.classList.add('uk-button-control');
    programItem.setAttribute('data-program-name', item.key);
    programItem.setAttribute('state', 'inactive');
    let styledProgramItem = styleProgramButton(programItem, item, type);
    let styledProgramItemWithListener = addProgramItemListener(styledProgramItem, item);
    return styledProgramItemWithListener;
}

function styleProgramButton(programItem, item, type) {
    if (type === 'custom') {
        programItem.innerHTML = `
            <p class="custom-program-name">${item.name || item.key}</p>`;
    } else {
        if (item.key !== 'on' && item.key !== 'off' && item.key !== 'heartbeat') {
            programItem.innerHTML = `
                <p class="top-line">`+item.name+'</p>'+
                '<p class="uk-text-small uk-text-muted">'+item.effects[0].duration+' ms</p>';
            programItem.classList.add('with-duration');
        } else {
            let mdiClass = '';
            if (item.key === 'on')  mdiClass = 'lightbulb-on';
            else if (item.key === 'off') mdiClass = 'lightbulb-outline';
            else if (item.key === 'heartbeat') mdiClass = 'heart-pulse';

            programItem.innerHTML = `
                <p><span class="mdi mdi-${mdiClass}"></span></p>`+
                '<p class="uk-text-muted">'+item.name || item.key+'</p>';
            programItem.classList.add('with-lightbulb');
        }
    }
    return programItem;
}

function addProgramItemListener(programItem, item) {
    programItem.addEventListener('click', () => {
        if (session.settings.mode === 'lightwave') {
            return;
        }
        //console.log('Program clicked', program.key, 'state before click:', programItem.getAttribute('state'));
        //check if the programItem is active
        if (programItem.getAttribute('state') === 'active') {
            //stop the current program
            socket.emit('stop-program', token, item.key, 'effect-end');
            programItem.setAttribute('state', 'inactive');
            programItem.classList.remove('uk-active');
            session.settings.activeProgram = null;
            session.settings.startDateTime = null;
        } else {
            //play the program
            session.settings.startDateTime = Date.now();
            socket.emit('play-program', token, {
                startDelay: 0,
                startDateTime: session.settings.startDateTime,
                playlist: item.effects,
                name: item.key,
                producerPerfNow: performance.now()
              });
            //remove the active class from all programItems
            const programItems = document.querySelectorAll('.uk-button-control');
            programItems.forEach(item => {
                item.classList.remove('uk-active');
                item.setAttribute('state', 'inactive');
            });
            //add the active class to the programItem
            programItem.classList.add('uk-active');
            programItem.setAttribute('state', 'active');
            session.settings.activeProgram = item.key;
        }
        updateSettings();
    });
    return programItem;
}
/* --------------------------------------------------------------------------------------------------------------- */
/* CUSTOM PROGRAMS MANAGER (socket emit update-programs, update-settings)                                          */
/* --------------------------------------------------------------------------------------------------------------- */
function addProgramsToManager(customPrograms) {
    console.log('Adding programs to manager');
    customProgramManagerBody.innerHTML = '';

    // If customPrograms is empty, return
    if (customPrograms === null || customPrograms === undefined || Object.keys(customPrograms).length === 0) {
        console.log('Custom programs is empty');
        customProgramManagerBody.innerHTML = '<tr><td colspan="3" class="uk-text-muted">No Custom Effects to display, use the Program Builder to create some.</td></tr>';
        return;
    }

    const list = sortPrograms(customPrograms);
    for (const program of list) {
        const programItem = document.createElement('tr');
        programItem.innerHTML = `
            <td class="uk-table-shrink" uk-tooltip="title: Favoriting the program will make it appear on the Show Controls page."><button data-program-name="${program.key}" class="uk-button uk-button-default uk-button-icon custom-program-star-button"><span class="mdi mdi-eye"></span></button></td>
            <td class="uk-table-expand">${program.name || program.key}</td>
            <td class="uk-text-right uk-table-shrink" uk-tooltip="title: Deleting the program will remove it from the Program Builder & the Show Controls page."><button data-program-name="${program.key}" class="uk-button uk-button-default uk-button-icon custom-program-delete-button"><span class="mdi mdi-delete"></span></button></td>
        `;
        customProgramManagerBody.appendChild(programItem);
        // if the program is in the favorite programs list, call the addCustomProgramToShowControls function
        if (session.settings.favoritePrograms && session.settings.favoritePrograms.includes(program.key)) {
            const starButtons = document.querySelectorAll('.custom-program-star-button');
            starButtons.forEach(button => {
                if (button.getAttribute('data-program-name') === program.key) {
                    button.classList.add('uk-active');
                }
            });
        }
    }
    addProgramManagerFavoriteListeners(document.querySelectorAll('.custom-program-star-button'));
    addProgramManagerDeleteListeners(document.querySelectorAll('.custom-program-delete-button')); 
}

function addProgramManagerFavoriteListeners(starButtons) {
    starButtons.forEach(button => {
        button.addEventListener('click', () => {
            console.log('Star button clicked', button.getAttribute('data-program-name'));
            let programName = button.getAttribute('data-program-name');
            // If the button is already active, remove the program from the favorite programs list
            if (!Array.isArray(session.settings?.favoritePrograms)) {
                session.settings.favoritePrograms = [];
            }
            if (button.classList.contains('uk-active')) {
                button.classList.remove('uk-active');
                session.settings.favoritePrograms = session.settings.favoritePrograms.filter(program => program !== programName);
            } else {
                button.classList.add('uk-active');
                session.settings.favoritePrograms.push(programName);
            }
            socket.emit('update-settings', token, session.settings);
            displayPrograms(session.customPrograms, 'custom');
        });
    });
}

function addProgramManagerDeleteListeners(deleteButtons) {
    deleteButtons.forEach(button => {
        button.addEventListener('click', () => {
            console.log('Delete button clicked', button.getAttribute('data-program-name'));
            //delete the program from the programs object
            let programName = button.getAttribute('data-program-name'); 
            // send message to the server to update firebase settings with the list of favorited programs
            if (!Array.isArray(session.settings?.favoritePrograms)) {
                session.settings.favoritePrograms = [];
            }
            session.settings.favoritePrograms = session.settings.favoritePrograms.filter(program => program !== programName);
            
            // remove the program from customPrograms (object or array)
            if (Array.isArray(session.customPrograms)) {
                session.customPrograms = session.customPrograms.filter(program => program.key !== programName);
            } else if (session.customPrograms && typeof session.customPrograms === 'object') {
                delete session.customPrograms[programName];
            } else {
                console.error('Invalid customPrograms type: ', typeof session.customPrograms);
            }
            addProgramsToManager(session.customPrograms);
            socket.emit('update-settings', token, session.settings);
            socket.emit('update-programs', token, session.customPrograms);
        });
    });
}
/* --------------------------------------------------------------------------------------------------------------- */
/* CUSTOM PROGRAM BUILDER                                                                                          */
/* --------------------------------------------------------------------------------------------------------------- */
const torchWorker = new Worker('../js/torch-worker.js', { type: 'module' });
torchWorker.onmessage = ({ data: timeline }) => {
    customTimeline      = timeline;           
    //console.log('🎉 timeline ready', customTimeline);
};

async function saveClip(e) {
    console.log('Saving clip');
    customTimeline = null;                                 
    const file = e.target.files[0];
    if (!file) return;
    // 500 MB guard
    if (file.size > 524_288_000) {
      UIkit.notification({
        message: 'File size exceeds 500 MB. Please select a smaller file.',
        status:  'danger',
        pos:     'top-center',
        timeout: 3000
      });
      return;
    }
    const arrayBuffer = await file.arrayBuffer();
  
    // direct decode
    console.log('Direct decode');
    decodeAndSendToDSP(arrayBuffer);
}

let audioCtx;

async function decodeAndSendToDSP(buffer) {
    console.log('decodeAndSendToDSP');
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuf = await audioCtx.decodeAudioData(buffer);
    const samples = audioBuf.getChannelData(0).slice();

    torchWorker.postMessage(
        {
          samples,
          sampleRate: audioBuf.sampleRate,
          options: {
            /* tweak sensitivity here */
            frameSize: 512,          // finer granularity  (try 256 if still slow)
            sensitivityFactor: 1.25, // lower = more flashes, higher = fewer
            hpCutoff: 400,           // leave as‑is unless you want more bass beats
            minOff: 30,
            minOn : 20
          }
        },
        [samples.buffer]             // zero‑copy transfer
      );
}

function generateCustomProgram() {
    console.log('🎉 ----------------------------------------------------- 🎉');
    console.log('Generating program');
    console.log('Clip name', clipInputText.value);
    console.log('Custom timeline', customTimeline);
    console.log('🎉 ----------------------------------------------------- 🎉');

    if (customTimeline !== null && clipInputText.value !== '') {
        let programName = clipInputText.value.replace(/\s+/g, '').toLowerCase();
        //If the program name already exists, show a notification
        if (session.customPrograms && session.customPrograms[programName]) {
            UIkit.notification({
                message: 'Program name already exists. Please enter a different name.',
                status: 'danger',
                pos: 'top-center',
                timeout: 3000   
            });
        } else {

            //add the program to the programs object

            console.log('Adding program to customPrograms:', programName, typeof session.customPrograms);

            //if the session.customPrograms is empty or undefined, or null, create an empty object
            if (session.customPrograms === null || session.customPrograms === undefined || session.customPrograms === '') {
                session.customPrograms = {};
            }

            session.customPrograms[programName] = {
                name: clipInputText.value,
                effects: customTimeline
            }

            console.log('CustomPrograms', session.customPrograms);
        }

        //console.log('Programs', programs);
        socket.emit('update-programs', token, session.customPrograms);
    } 
    else if (customTimeline === null && clipInputText.value === '') {
        UIkit.notification({
            message: 'Please enter a program name and upload a clip',
            status: 'danger',
            pos: 'top-center',
            timeout: 3000
        });
    }
    else if (customTimeline === null) {
        UIkit.notification({
            message: 'Please upload a clip',
            status: 'danger',
            pos: 'top-center',
            timeout: 3000
        });
    } else if (clipInputText.value === '') {
        UIkit.notification({
            message: 'Please enter a program name',
            status: 'danger',
            pos: 'top-center',
            timeout: 3000
        });
    }
    clipInputText.value = '';
    customTimeline = null;
    clipInput.value = '';
}
/* --------------------------------------------------------------------------------------------------------------- */
/* UPDATE ASSETS (socket emit update-images)                                                                       */
/* --------------------------------------------------------------------------------------------------------------- */
async function updateImages(data) {
    console.log('Saving images');
    const file = data.target.files[0];
    if (!file) return;
    // Check file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB in bytes
    if (file.size > maxSize) {
        //console.error('File too large:', file.size, 'bytes');
        UIkit.notification({
            message: 'File too large. Maximum size is 10MB',
            status: 'danger',
            timeout: 5000
        });
        return;
    }
    // get the file type
    const fileType = file.type;
    // -------------------------------------------------------
    const arrayBuffer = await file.arrayBuffer();       // Read the file as ArrayBuffer
    const uint8Array = new Uint8Array(arrayBuffer);     // Convert to Uint8Array for sending
    // -------------------------------------------------------
    const input = data.target;                          // Get the button that was clicked
    const collectionName = input.dataset.collection;    // Get the data-collection
    const fieldName = input.dataset.field;              // Get the data-field
    // -------------------------------------------------------
    socket.emit('update-images', token, {
        file: uint8Array,
        collection: collectionName,
        field: fieldName,
        fileSize: file.size,
        fileType: fileType
    });
}
/* --------------------------------------------------------------------------------------------------------------- */
/* UPDATE SETTINGS (socket emit update-settings)                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
function updateSettings() {
    console.log('Updating settings');
    socket.emit('update-settings', token, session.settings);
}
/* --------------------------------------------------------------------------------------------------------------- */
/* UPDATE PROGRAMS (socket emit update-programs)                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
function updatePrograms() {
    console.log('Updating Programs');
    socket.emit('update-programs', token, session.customPrograms);
}
/* --------------------------------------------------------------------------------------------------------------- */
/* STOP PROGRAM                                                                                                    */
/* --------------------------------------------------------------------------------------------------------------- */
async function stopProgram() {
    console.log('Stopping program');
    socket.emit('stop-program', token, session.settings.activeProgram, 'show-end');
    session.settings.activeProgram = null;
    session.settings.startDateTime = null;
    session.settings.locked = true;
    await updateSettings();
    socket.emit('lock', token, Date.now());
}

function lwIsEnabled() {
    return session.settings.mode === 'lightwave';
}

function setLwProgramDisabled(disabled) {
    const dj = document.getElementById('dj-container');
    const custom = document.getElementById('custom-programs');
    if (dj) dj.classList.toggle('lw_programs-disabled', disabled);
    if (custom) custom.classList.toggle('lw_programs-disabled', disabled);
}

function renderLwOccupancy(occupied) {
    const list = document.getElementById('lw_occupancy');
    if (!list) return;
    list.innerHTML = '';
    const rows = Array.isArray(occupied) ? occupied : [];
    if (rows.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'uk-text-muted';
        empty.textContent = 'No joined sections yet';
        list.appendChild(empty);
        return;
    }
    for (const row of rows) {
        const item = document.createElement('li');
        const section = document.createElement('span');
        section.textContent = `Section ${row.section}`;
        const count = document.createElement('span');
        count.textContent = String(row.count);
        item.appendChild(section);
        item.appendChild(count);
        list.appendChild(item);
    }
}

function syncLwProducerUi() {
    const toggle = document.getElementById('lw_mode-toggle');
    const countdown = document.getElementById('lw_countdown-seconds');
    const delay = document.getElementById('lw_section-delay');
    const torchMax = document.getElementById('lw_torch-max');
    const waiting = document.getElementById('lw_waiting-text');
    const startBtn = document.getElementById('lw_wave-start');
    const stopBtnLw = document.getElementById('lw_wave-stop');
    if (toggle) toggle.checked = lwIsEnabled();
    if (countdown) countdown.value = String(session.settings.lw_countdownSeconds ?? 3);
    if (delay) delay.value = String(session.settings.lw_sectionDelayMs ?? 400);
    if (torchMax) torchMax.value = String(session.settings.lw_torchMaxMs ?? 2000);
    if (waiting) waiting.value = session.settings.lw_waitingText || LW_DEFAULTS.lw_waitingText;
    if (startBtn) startBtn.disabled = !lwIsEnabled();
    if (stopBtnLw) stopBtnLw.disabled = !lwIsEnabled();
    setLwProgramDisabled(lwIsEnabled());
}

function persistLwFromInputs() {
    const toggle = document.getElementById('lw_mode-toggle');
    const countdown = document.getElementById('lw_countdown-seconds');
    const delay = document.getElementById('lw_section-delay');
    const torchMax = document.getElementById('lw_torch-max');
    const waiting = document.getElementById('lw_waiting-text');
    const nextMode = toggle && toggle.checked ? 'lightwave' : 'default';
    const wasLightwave = session.settings.mode === 'lightwave';
    session.settings.mode = nextMode;
    lw_applyLightwaveSettings(session.settings, {
        mode: nextMode,
        lw_countdownSeconds: countdown ? countdown.value : session.settings.lw_countdownSeconds,
        lw_sectionDelayMs: delay ? delay.value : session.settings.lw_sectionDelayMs,
        lw_torchMaxMs: torchMax ? torchMax.value : session.settings.lw_torchMaxMs,
        lw_waitingText: waiting ? waiting.value : session.settings.lw_waitingText,
    });
    if (nextMode === 'lightwave' && !wasLightwave && session.settings.activeProgram) {
        socket.emit('stop-program', token, session.settings.activeProgram, 'effect-end');
        session.settings.activeProgram = null;
        session.settings.startDateTime = null;
    }
    syncLwProducerUi();
    updateSettings();
}

function initLwProducerControls() {
    const toggle = document.getElementById('lw_mode-toggle');
    const countdown = document.getElementById('lw_countdown-seconds');
    const delay = document.getElementById('lw_section-delay');
    const torchMax = document.getElementById('lw_torch-max');
    const waiting = document.getElementById('lw_waiting-text');
    const startBtn = document.getElementById('lw_wave-start');
    const stopBtnLw = document.getElementById('lw_wave-stop');
    if (toggle) toggle.addEventListener('change', persistLwFromInputs);
    if (countdown) countdown.addEventListener('change', persistLwFromInputs);
    if (delay) delay.addEventListener('change', persistLwFromInputs);
    if (torchMax) torchMax.addEventListener('change', persistLwFromInputs);
    if (waiting) waiting.addEventListener('change', persistLwFromInputs);
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (!lwIsEnabled()) return;
            socket.emit('lw_wave-start', {
                token,
                lw_torchMaxMs: session.settings.lw_torchMaxMs,
                lw_countdownSeconds: session.settings.lw_countdownSeconds,
                lw_sectionDelayMs: session.settings.lw_sectionDelayMs,
            });
        });
    }
    if (stopBtnLw) {
        stopBtnLw.addEventListener('click', () => {
            socket.emit('lw_wave-stop', { token });
        });
    }
    socket.on('lw_wave-status', (payload) => {
        renderLwOccupancy(payload && payload.occupied);
    });
    syncLwProducerUi();
}