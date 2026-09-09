/**
 * Lightwave participant overlay: waiting, section form, countdown, GO.
 */

const LW_COUNTDOWN_TICK_MS = 200;

let tickTimer = null;
let localGoAt = null;
let countdownSeconds = 3;
let waitingTemplate = "You're in section {section}. Get ready.";
let sectionLabel = '';

function overlayEl() {
    return document.getElementById('lw_overlay');
}

function textEl() {
    return document.getElementById('lw_overlay-text');
}

function formEl() {
    return document.getElementById('lw_section-form');
}

function motionBtn() {
    return document.getElementById('lw_enable-motion');
}

export function lw_setWaitingText(template) {
    if (typeof template === 'string' && template.trim()) {
        waitingTemplate = template;
    }
}

export function lw_setCountdownSeconds(seconds) {
    const n = Number(seconds);
    if (Number.isFinite(n) && n >= 1 && n <= 10) {
        countdownSeconds = Math.round(n);
    }
}

export function lw_showOverlay(show) {
    const el = overlayEl();
    if (!el) return;
    el.style.display = show ? 'flex' : 'none';
    el.setAttribute('aria-hidden', show ? 'false' : 'true');
}

export function lw_setOverlayText(text) {
    const el = textEl();
    if (el) el.textContent = text;
}

export function lw_showSectionForm(show) {
    const form = formEl();
    if (form) form.style.display = show ? 'flex' : 'none';
}

export function lw_showMotionButton(show) {
    const btn = motionBtn();
    if (btn) btn.style.display = show ? 'inline-flex' : 'none';
}

export function lw_waitingCopy(section) {
    const value = section || sectionLabel || '';
    return waitingTemplate.replaceAll('{section}', value);
}

export function lw_showWaiting(section) {
    if (section) sectionLabel = section;
    lw_showSectionForm(false);
    lw_setOverlayText(lw_waitingCopy(sectionLabel));
    lw_showOverlay(true);
}

export function lw_countdownLabel(remainingSec) {
    if (remainingSec >= 1) {
        return `Raise phone in ${remainingSec}`;
    }
    return 'GO';
}

export function lw_lowerPhoneCopy() {
    return 'Lower your Phone';
}

export function lw_showLowerPhone() {
    lw_stopCountdown(false);
    lw_showSectionForm(false);
    lw_setOverlayText(lw_lowerPhoneCopy());
    lw_showOverlay(true);
}

export function lw_waveCompleteCopy() {
    return 'Wave Complete';
}

export function lw_showWaveComplete() {
    lw_stopCountdown(false);
    lw_showSectionForm(false);
    lw_setOverlayText(lw_waveCompleteCopy());
    lw_showOverlay(true);
}

function paintFromNow(now) {
    if (localGoAt === null) return;
    const remainingMs = localGoAt - now;
    const countdownMs = countdownSeconds * 1000;
    if (remainingMs >= countdownMs) {
        lw_setOverlayText(lw_waitingCopy(sectionLabel));
        return;
    }
    if (remainingMs > 0) {
        const sec = Math.ceil(remainingMs / 1000);
        lw_setOverlayText(lw_countdownLabel(sec));
        return;
    }
    lw_setOverlayText('Raise your phone!');
}

export function lw_startCountdown(goAtMs, section) {
    if (section) sectionLabel = section;
    localGoAt = goAtMs;
    lw_showSectionForm(false);
    lw_showOverlay(true);
    paintFromNow(Date.now());
    if (tickTimer !== null) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
        paintFromNow(Date.now());
    }, LW_COUNTDOWN_TICK_MS);
}

export function lw_stopCountdown(backToWaiting = true) {
    localGoAt = null;
    if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
    if (backToWaiting && sectionLabel) {
        lw_showWaiting(sectionLabel);
    }
}

export function lw_hideAll() {
    lw_stopCountdown(false);
    lw_showSectionForm(false);
    lw_showMotionButton(false);
    lw_showOverlay(false);
    sectionLabel = '';
}
