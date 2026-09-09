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
    lw_poseConfigure,
    lw_getSampleCount,
    lw_getPose,
    lw_getTravelDebug,
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
    lw_setWaveCompleteText,
    lw_setJoinedText,
    lw_showWaiting,
    lw_showJoined,
    lw_hideAll,
} from './lw_countdown.js';
import { lw_waveStart, lw_waveSetSection, lw_waveReset, lw_waveSetFollowPose } from './lw_wave.js';

export const LW_DEFAULTS = {
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
    lw_followPose: false,
    lw_offOnLower: true,
    lw_torchMinMs: 20000,
    lw_joinedText: 'Watch for your cue to raise your device!',
    lw_waveCompleteText: 'Wave Complete',
};

let active = false;
let ctx = null;
let lastFollowPose = false;
let lastPermission = null;
let debugSamples = 0;
let debugPose = 'waiting';
let lastDebugPaintAt = 0;

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
    target.lw_torchMaxMs = clampInt(src.lw_torchMaxMs, 200, 120000, target.lw_torchMaxMs ?? LW_DEFAULTS.lw_torchMaxMs);
    target.lw_torchMinMs = clampInt(src.lw_torchMinMs, 200, 120000, target.lw_torchMinMs ?? LW_DEFAULTS.lw_torchMinMs);
    target.lw_countdownSeconds = clampInt(src.lw_countdownSeconds, 1, 10, target.lw_countdownSeconds ?? LW_DEFAULTS.lw_countdownSeconds);
    target.lw_sectionDelayMs = clampInt(src.lw_sectionDelayMs, 50, 30000, target.lw_sectionDelayMs ?? LW_DEFAULTS.lw_sectionDelayMs);
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
    target.lw_raiseSensitivity = clampInt(src.lw_raiseSensitivity, 1, 10, target.lw_raiseSensitivity ?? LW_DEFAULTS.lw_raiseSensitivity);
    target.lw_lowerSensitivity = clampInt(src.lw_lowerSensitivity, 1, 10, target.lw_lowerSensitivity ?? LW_DEFAULTS.lw_lowerSensitivity);
    if (typeof src.lw_offOnlyAtMax === 'boolean') {
        target.lw_offOnlyAtMax = src.lw_offOnlyAtMax;
    } else if (typeof target.lw_offOnlyAtMax !== 'boolean') {
        target.lw_offOnlyAtMax = LW_DEFAULTS.lw_offOnlyAtMax;
    }
    if (typeof src.lw_loop === 'boolean') {
        target.lw_loop = src.lw_loop;
    } else if (typeof target.lw_loop !== 'boolean') {
        target.lw_loop = LW_DEFAULTS.lw_loop;
    }
    if (typeof src.lw_followPose === 'boolean') {
        target.lw_followPose = src.lw_followPose;
    } else if (typeof target.lw_followPose !== 'boolean') {
        target.lw_followPose = LW_DEFAULTS.lw_followPose;
    }
    if (typeof src.lw_offOnLower === 'boolean') {
        target.lw_offOnLower = src.lw_offOnLower;
    } else if (typeof target.lw_offOnLower !== 'boolean') {
        target.lw_offOnLower = LW_DEFAULTS.lw_offOnLower;
    }
    if (typeof src.lw_joinedText === 'string' && src.lw_joinedText.trim()) {
        target.lw_joinedText = src.lw_joinedText.trim();
    } else if (!target.lw_joinedText) {
        target.lw_joinedText = LW_DEFAULTS.lw_joinedText;
    }
    if (typeof src.lw_waveCompleteText === 'string' && src.lw_waveCompleteText.trim()) {
        target.lw_waveCompleteText = src.lw_waveCompleteText.trim();
    } else if (!target.lw_waveCompleteText) {
        target.lw_waveCompleteText = LW_DEFAULTS.lw_waveCompleteText;
    }
}

export function lw_followPoseEnabled(settings) {
    return settings?.lw_followPose === true;
}

function fmtTravel(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0.00';
    return n.toFixed(2);
}

/**
 * Two lines: upward travel vs raise need, downward travel vs lower need.
 * @param {{ calibrating?: boolean, pose?: string, raiseHave?: number, raiseNeed?: number, raiseLeft?: number, lowerHave?: number, lowerNeed?: number, lowerLeft?: number }} travel
 */
export function lw_travelDebugLines(travel = {}) {
    if (travel.calibrating) return 'Calibrating home hold…';
    const pose = travel.pose || 'neutral';
    const up = pose === 'raised'
        ? `Up ${fmtTravel(travel.raiseHave)} / ${fmtTravel(travel.raiseNeed)} · already raised`
        : `Up ${fmtTravel(travel.raiseHave)} / ${fmtTravel(travel.raiseNeed)} · need ${fmtTravel(travel.raiseLeft)} more`;
    const down = pose === 'raised'
        ? `Down ${fmtTravel(travel.lowerHave)} / ${fmtTravel(travel.lowerNeed)} · need ${fmtTravel(travel.lowerLeft)} more`
        : `Down ${fmtTravel(travel.lowerHave)} / ${fmtTravel(travel.lowerNeed)} · wait until raised`;
    return `${up}\n${down}`;
}

/**
 * Compact on-phone motion status. Hidden unless the producer enables debug.
 * @param {{ permission?: string, samples?: number, pose?: string, travel?: object }} input
 * @returns {string}
 */
export function lw_debugLine({ permission, samples, pose, travel } = {}) {
    const perm = permission || 'unknown';
    const n = Number(samples);
    const count = Number.isFinite(n) ? n : 0;
    if (perm === 'denied') return 'Motion: denied · fallback';
    if (perm === 'unsupported') return 'Motion: unsupported · fallback';
    if (count <= 0) return `Motion: ${perm} · samples: 0 · pose: waiting`;
    const head = `Motion: ${perm} · samples: ${count} · pose: ${pose || 'neutral'}`;
    if (!travel) return head;
    return `${head}\n${lw_travelDebugLines(travel)}`;
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
        travel: lw_getTravelDebug(),
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
            if (debugPose === 'waiting') debugPose = lw_getPose() || 'neutral';
            paintDebug();
            emitPoseLog('first-sample', {
                angleDeg: round1(metrics && metrics.angleDeg),
                torchUp: round1(metrics && metrics.torchUp),
            });
        },
        onSample: ({ pose }) => {
            debugSamples = lw_getSampleCount();
            if (pose && pose !== 'waiting') debugPose = pose;
            const now = Date.now();
            if (now - lastDebugPaintAt < 120) return;
            lastDebugPaintAt = now;
            paintDebug();
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

function applyFollowPoseUi() {
    const settings = ctx?.settings || {};
    lw_setJoinedText(settings.lw_joinedText || LW_DEFAULTS.lw_joinedText);
    lw_showJoined();
}

function applyTimingFromSettings() {
    const settings = ctx?.settings || {};
    const follow = lw_followPoseEnabled(settings);
    lw_setWaitingText(settings.lw_waitingText || LW_DEFAULTS.lw_waitingText);
    lw_setWaveCompleteText(settings.lw_waveCompleteText || LW_DEFAULTS.lw_waveCompleteText);
    lw_setJoinedText(settings.lw_joinedText || LW_DEFAULTS.lw_joinedText);
    lw_setCountdownSeconds(settings.lw_countdownSeconds || LW_DEFAULTS.lw_countdownSeconds);
    lw_torchConfigure({
        maxMs: settings.lw_torchMaxMs || LW_DEFAULTS.lw_torchMaxMs,
        minMs: settings.lw_torchMinMs || LW_DEFAULTS.lw_torchMinMs,
        fallback: lastPermission === 'denied' || lastPermission === 'unsupported',
        requireRaise: settings.lw_requireRaise !== false,
        offOnlyAtMax: settings.lw_offOnlyAtMax === true,
        followPose: follow,
        offOnLower: settings.lw_offOnLower !== false,
    });
    lw_poseConfigure({
        raiseSensitivity: settings.lw_raiseSensitivity,
        lowerSensitivity: settings.lw_lowerSensitivity,
    });
    lw_waveSetFollowPose(follow);
    if (follow) {
        applyFollowPoseUi();
    } else if (lastFollowPose && active) {
        const section = ctx?.section || null;
        if (section) lw_showWaiting(section);
        else lw_hideAll();
    }
    lastFollowPose = follow;
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

    const follow = lw_followPoseEnabled(nextCtx.settings);
    if (follow) {
        lw_waveSetSection(null);
        applyFollowPoseUi();
    } else {
        const existing = nextCtx.section || lw_resolveSection(ctx.token);
        if (existing) {
            assignSection(existing);
        } else {
            lw_waveSetSection(null);
            lw_showWaiting('');
        }
    }

    if (lastPermission === 'granted') {
        lw_poseStart(poseReporterOptions());
        lw_torchConfigure({ fallback: false });
    } else if (lastPermission === 'denied' || lastPermission === 'unsupported') {
        lw_torchConfigure({ fallback: true });
    }

    debugSamples = lw_getSampleCount();
    if (debugSamples > 0) {
        debugPose = lw_getPose() || 'neutral';
    } else if (!debugPose) {
        debugPose = 'waiting';
    }
    paintDebug();
    emitPoseLog('permission');
    if (debugSamples > 0) {
        emitPoseLog('first-sample');
    }

    if (follow) {
        await lw_torchSetRaised(lw_getPose() === 'raised');
    } else {
        await lw_torchOff();
    }
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
    lastFollowPose = false;
    debugSamples = 0;
    debugPose = 'waiting';
    lastDebugPaintAt = 0;
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
        if (active) {
            const follow = lw_followPoseEnabled(nextCtx.settings);
            const leavingFollow = lastFollowPose && !follow;
            applyTimingFromSettings();
            if (follow) {
                await lw_torchSetRaised(lw_getPose() === 'raised');
            } else if (leavingFollow) {
                await lw_torchOff();
            }
            return;
        }
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
