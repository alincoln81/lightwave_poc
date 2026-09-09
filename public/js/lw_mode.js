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
    lw_showWaiting,
    lw_hideAll,
} from './lw_countdown.js';
import { lw_waveStart, lw_waveSetSection, lw_waveReset } from './lw_wave.js';

export const LW_DEFAULTS = {
    lw_torchMaxMs: 2000,
    lw_countdownSeconds: 3,
    lw_sectionDelayMs: 400,
    lw_waitingText: "You're in section {section}. Get ready.",
    lw_requireRaise: true,
};

let active = false;
let ctx = null;
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
    if (typeof src.lw_requireRaise === 'boolean') {
        target.lw_requireRaise = src.lw_requireRaise;
    } else if (typeof target.lw_requireRaise !== 'boolean') {
        target.lw_requireRaise = LW_DEFAULTS.lw_requireRaise;
    }
}

function applyTimingFromSettings() {
    const settings = ctx?.settings || {};
    lw_setWaitingText(settings.lw_waitingText || LW_DEFAULTS.lw_waitingText);
    lw_setCountdownSeconds(settings.lw_countdownSeconds || LW_DEFAULTS.lw_countdownSeconds);
    lw_torchConfigure({
        maxMs: settings.lw_torchMaxMs || LW_DEFAULTS.lw_torchMaxMs,
        fallback: lastPermission === 'denied' || lastPermission === 'unsupported',
        requireRaise: settings.lw_requireRaise !== false,
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

function joinSectionRow() {
    return document.getElementById('lw_join-section');
}

function joinSectionInput() {
    return document.getElementById('lw_section-input');
}

function joinSectionError() {
    return document.getElementById('lw_section-error');
}

export function lw_showJoinSection(show) {
    const row = joinSectionRow();
    if (!row) return;
    row.style.display = show ? 'flex' : 'none';
}

export function lw_prefillJoinSection(token) {
    const input = joinSectionInput();
    if (!input) return;
    const existing = lw_resolveSection(token);
    if (existing) input.value = existing;
    const errorEl = joinSectionError();
    if (errorEl) errorEl.hidden = true;
}

/**
 * Validate the join-page section field. Returns the normalized section or null.
 * @param {string} token
 * @returns {string|null}
 */
export function lw_captureJoinSection(token) {
    const input = joinSectionInput();
    const errorEl = joinSectionError();
    const normalized = lw_normalizeSection(input ? input.value : '');
    if (!normalized) {
        if (errorEl) errorEl.hidden = false;
        if (input) input.focus();
        return null;
    }
    if (errorEl) errorEl.hidden = true;
    if (input) input.value = normalized;
    lw_rememberSection(token, normalized);
    return normalized;
}

export function lw_commitJoinSection(socket, token, section) {
    const remembered = lw_rememberSection(token, section);
    if (!remembered) return null;
    lw_emitSection(socket, token, remembered);
    lw_waveSetSection(remembered);
    return remembered;
}

/**
 * Request motion from the Join tap (same user gesture). Never shows a second button.
 * Denied / missing sensors use the GO fallback flash.
 * @returns {Promise<'granted'|'denied'|'unsupported'>}
 */
export async function lw_prepareMotionFromJoin() {
    if (lw_needsMotionPermission()) {
        const result = await lw_requestMotionPermission();
        lastPermission = result;
        clientLog({ type: 'lw_motion-permission', result });
        if (result === 'granted') {
            lw_poseStart({ onPose });
            lw_torchConfigure({ fallback: false });
        } else {
            lw_torchConfigure({ fallback: true });
        }
        return result;
    }
    lastPermission = typeof DeviceMotionEvent === 'undefined' ? 'unsupported' : 'granted';
    clientLog({ type: 'lw_motion-permission', result: lastPermission });
    if (lastPermission === 'unsupported') {
        lw_torchConfigure({ fallback: true });
        return lastPermission;
    }
    lw_poseStart({ onPose });
    lw_torchConfigure({ fallback: false });
    return lastPermission;
}

function assignSection(section) {
    if (!ctx) return;
    const remembered = lw_commitJoinSection(ctx.socket, ctx.token, section);
    if (remembered) lw_showWaiting(remembered);
}

async function lw_start(nextCtx) {
    ctx = nextCtx;
    applyTimingFromSettings();
    lw_waveStart(ctx.socket);

    const existing = nextCtx.section || lw_resolveSection(ctx.token);
    if (existing) {
        assignSection(existing);
    } else {
        lw_waveSetSection(null);
        lw_showWaiting('');
    }

    if (lastPermission === 'granted') {
        lw_poseStart({ onPose });
        lw_torchConfigure({ fallback: false });
    } else if (lastPermission === 'denied' || lastPermission === 'unsupported') {
        lw_torchConfigure({ fallback: true });
    }

    await lw_torchOff();
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
