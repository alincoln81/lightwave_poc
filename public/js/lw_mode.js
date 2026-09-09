/**
 * Lightwave mode controller: start/stop vs the existing lightshow.
 */

import {
    lw_normalizeSection,
    lw_resolveSection,
    lw_rememberSection,
    lw_emitSection,
} from './lw_section.js';
import {
    lw_needsMotionPermission,
    lw_requestMotionPermission,
    lw_poseStart,
    lw_poseStop,
} from './lw_pose.js';
import {
    lw_torchConfigure,
    lw_torchSetRaised,
    lw_torchReset,
    lw_torchOff,
} from './lw_torch.js';
import {
    lw_setWaitingText,
    lw_setCountdownSeconds,
    lw_showOverlay,
    lw_showSectionForm,
    lw_showMotionButton,
    lw_showWaiting,
    lw_hideAll,
    lw_setOverlayText,
} from './lw_countdown.js';
import { lw_waveStart, lw_waveSetSection, lw_waveReset } from './lw_wave.js';

export const LW_DEFAULTS = {
    lw_torchMaxMs: 2000,
    lw_countdownSeconds: 3,
    lw_sectionDelayMs: 400,
    lw_waitingText: "You're in section {section}. Get ready.",
};

let active = false;
let ctx = null;
let sectionBound = false;
let motionBound = false;
let lastPermission = null;

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

export function lw_isActive() {
    return active;
}

export function lw_normalizeMode(mode) {
    return mode === 'lightwave' ? 'lightwave' : 'default';
}

export function lw_applyLightwaveSettings(target, settings) {
    if (!target) return;
    const src = settings || {};
    target.mode = lw_normalizeMode(src.mode);
    target.lw_torchMaxMs = clampInt(src.lw_torchMaxMs, 200, 10000, target.lw_torchMaxMs ?? LW_DEFAULTS.lw_torchMaxMs);
    target.lw_countdownSeconds = clampInt(src.lw_countdownSeconds, 1, 10, target.lw_countdownSeconds ?? LW_DEFAULTS.lw_countdownSeconds);
    target.lw_sectionDelayMs = clampInt(src.lw_sectionDelayMs, 50, 5000, target.lw_sectionDelayMs ?? LW_DEFAULTS.lw_sectionDelayMs);
    if (typeof src.lw_waitingText === 'string' && src.lw_waitingText.trim()) {
        target.lw_waitingText = src.lw_waitingText.trim();
    } else if (!target.lw_waitingText) {
        target.lw_waitingText = LW_DEFAULTS.lw_waitingText;
    }
}

function applyTimingFromSettings() {
    const settings = ctx?.settings || {};
    lw_setWaitingText(settings.lw_waitingText || LW_DEFAULTS.lw_waitingText);
    lw_setCountdownSeconds(settings.lw_countdownSeconds || LW_DEFAULTS.lw_countdownSeconds);
    lw_torchConfigure({
        maxMs: settings.lw_torchMaxMs || LW_DEFAULTS.lw_torchMaxMs,
        fallback: lastPermission === 'denied' || lastPermission === 'unsupported',
    });
}

function clientLog(data) {
    if (ctx && typeof ctx.log === 'function') {
        ctx.log(data);
        return;
    }
    console.log('### lw_', data);
}

async function onPose(pose) {
    await lw_torchSetRaised(pose === 'raised');
}

function bindSectionForm() {
    if (sectionBound) return;
    const form = document.getElementById('lw_section-form');
    if (!form) return;
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.getElementById('lw_section-input');
        const errorEl = document.getElementById('lw_section-error');
        const normalized = lw_normalizeSection(input ? input.value : '');
        if (!normalized) {
            if (errorEl) {
                errorEl.hidden = false;
            }
            return;
        }
        if (errorEl) errorEl.hidden = true;
        assignSection(normalized);
    });
    sectionBound = true;
}

function bindMotionButton() {
    if (motionBound) return;
    const btn = document.getElementById('lw_enable-motion');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const result = await lw_requestMotionPermission();
        lastPermission = result;
        clientLog({ type: 'lw_motion-permission', result });
        applyTimingFromSettings();
        if (result === 'granted') {
            lw_showMotionButton(false);
            lw_poseStart({ onPose });
            lw_torchConfigure({ fallback: false });
        } else {
            lw_showMotionButton(false);
            lw_torchConfigure({ fallback: true });
        }
    });
    motionBound = true;
}

function assignSection(section) {
    if (!ctx) return;
    const remembered = lw_rememberSection(ctx.token, section);
    lw_emitSection(ctx.socket, ctx.token, remembered);
    lw_waveSetSection(remembered);
    lw_showSectionForm(false);
    lw_showWaiting(remembered);
}

async function startPoseFromJoin() {
    if (lw_needsMotionPermission()) {
        const result = await lw_requestMotionPermission();
        lastPermission = result;
        clientLog({ type: 'lw_motion-permission', result });
        if (result === 'granted') {
            lw_poseStart({ onPose });
            lw_torchConfigure({ fallback: false });
            lw_showMotionButton(false);
            return;
        }
        if (result === 'denied') {
            lw_torchConfigure({ fallback: true });
            lw_showMotionButton(true);
            return;
        }
    }
    lastPermission = typeof DeviceMotionEvent === 'undefined' ? 'unsupported' : 'granted';
    if (lastPermission === 'unsupported') {
        lw_torchConfigure({ fallback: true });
        clientLog({ type: 'lw_motion-permission', result: 'unsupported' });
        return;
    }
    lw_poseStart({ onPose });
    lw_torchConfigure({ fallback: false });
}

async function lw_start(nextCtx) {
    ctx = nextCtx;
    applyTimingFromSettings();
    bindSectionForm();
    bindMotionButton();
    lw_showOverlay(true);
    lw_waveStart(ctx.socket);

    if (!active) {
        await startPoseFromJoin();
    }

    const existing = lw_resolveSection(ctx.token);
    if (existing) {
        assignSection(existing);
    } else {
        lw_waveSetSection(null);
        lw_setOverlayText('Enter your section number');
        lw_showSectionForm(true);
    }

    active = true;
}

async function lw_stopInternal() {
    await lw_waveReset();
    lw_poseStop();
    await lw_torchOff();
    lw_torchReset();
    lw_hideAll();
    lastPermission = null;
    active = false;
}

/**
 * Start or stop Lightwave to match joined + unlocked + mode.
 * @param {{ socket: object, token: string, settings: object, joined: boolean, locked: boolean, log?: Function }} nextCtx
 */
export async function lw_sync(nextCtx) {
    ctx = nextCtx;
    const shouldRun = !!(nextCtx.joined && !nextCtx.locked && lw_normalizeMode(nextCtx.settings?.mode) === 'lightwave');
    if (shouldRun) {
        await lw_start(nextCtx);
        return;
    }
    if (active) {
        await lw_stopInternal();
    }
}

export async function lw_stop() {
    if (!active && !ctx) {
        await lw_torchOff();
        lw_hideAll();
        return;
    }
    await lw_stopInternal();
}
