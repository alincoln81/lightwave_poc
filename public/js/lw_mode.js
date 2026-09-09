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
    lw_getSampleCount,
    lw_getPose,
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
    lw_debugOverlay: false,
};

let active = false;
let ctx = null;
let lastPermission = null;
let debugSamples = 0;
let debugPose = 'waiting';

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
    if (typeof src.lw_debugOverlay === 'boolean') {
        target.lw_debugOverlay = src.lw_debugOverlay;
    } else if (typeof target.lw_debugOverlay !== 'boolean') {
        target.lw_debugOverlay = LW_DEFAULTS.lw_debugOverlay;
    }
}

/**
 * Compact on-phone motion status. Hidden unless the producer enables debug.
 * @param {{ permission?: string, samples?: number, pose?: string }} input
 * @returns {string}
 */
export function lw_debugLine({ permission, samples, pose } = {}) {
    const perm = permission || 'unknown';
    const n = Number(samples);
    const count = Number.isFinite(n) ? n : 0;
    if (perm === 'denied') return 'Motion: denied · fallback';
    if (perm === 'unsupported') return 'Motion: unsupported · fallback';
    if (count <= 0) return `Motion: ${perm} · samples: 0 · pose: waiting`;
    return `Motion: ${perm} · samples: ${count} · pose: ${pose || 'lowered'}`;
}

function round1(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10) / 10;
}

function debugEl() {
    return document.getElementById('lw_debug');
}

function paintDebug() {
    const el = debugEl();
    if (!el) return;
    const show = !!(ctx?.settings?.lw_debugOverlay);
    el.hidden = !show;
    if (!show) {
        el.textContent = '';
        return;
    }
    el.textContent = lw_debugLine({
        permission: lastPermission,
        samples: debugSamples,
        pose: debugPose,
    });
}

function emitPoseLog(kind, extra = {}) {
    const socket = ctx && ctx.socket;
    if (!socket || typeof socket.emit !== 'function') return;
    const payload = {
        kind,
        permission: lastPermission,
        pose: debugPose,
        samples: debugSamples,
    };
    if (extra.angleDeg !== undefined) payload.angleDeg = extra.angleDeg;
    if (extra.torchUp !== undefined) payload.torchUp = extra.torchUp;
    if (extra.pose) payload.pose = extra.pose;
    socket.emit('lw_pose-log', payload);
}

function poseReporterOptions() {
    return {
        onPose: async (pose) => {
            debugPose = pose;
            paintDebug();
            emitPoseLog('pose', { pose });
            await lw_torchSetRaised(pose === 'raised');
        },
        onFirstSample: ({ metrics }) => {
            debugSamples = Math.max(debugSamples, 1);
            if (debugPose === 'waiting') debugPose = lw_getPose() || 'lowered';
            paintDebug();
            emitPoseLog('first-sample', {
                angleDeg: round1(metrics && metrics.angleDeg),
                torchUp: round1(metrics && metrics.torchUp),
            });
        },
        onHeartbeat: (info) => {
            debugSamples = Number(info && info.samples) || debugSamples;
            if (info && info.pose && info.pose !== 'waiting') debugPose = info.pose;
            emitPoseLog('heartbeat', {
                angleDeg: round1(info && info.angleDeg),
                torchUp: round1(info && info.torchUp),
            });
        },
        onNoSample: () => {
            emitPoseLog('no-sample');
        },
    };
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
    paintDebug();
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
        paintDebug();
        if (result === 'granted') {
            lw_poseStart(poseReporterOptions());
            lw_torchConfigure({ fallback: false });
        } else {
            lw_torchConfigure({ fallback: true });
        }
        return result;
    }
    lastPermission = typeof DeviceMotionEvent === 'undefined' ? 'unsupported' : 'granted';
    paintDebug();
    if (lastPermission === 'unsupported') {
        lw_torchConfigure({ fallback: true });
        return lastPermission;
    }
    lw_poseStart(poseReporterOptions());
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
        lw_poseStart(poseReporterOptions());
        lw_torchConfigure({ fallback: false });
    } else if (lastPermission === 'denied' || lastPermission === 'unsupported') {
        lw_torchConfigure({ fallback: true });
    }

    debugSamples = lw_getSampleCount();
    if (debugSamples > 0) {
        debugPose = lw_getPose() || 'lowered';
    } else if (!debugPose) {
        debugPose = 'waiting';
    }
    paintDebug();
    emitPoseLog('permission');
    if (debugSamples > 0) {
        emitPoseLog('first-sample');
    }

    await lw_torchOff();
    active = true;
}

async function lw_stopInternal() {
    emitPoseLog('stop');
    await lw_waveReset();
    lw_poseStop();
    await lw_torchOff();
    lw_torchReset();
    lw_hideAll();
    lastPermission = null;
    debugSamples = 0;
    debugPose = 'waiting';
    paintDebug();
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
