/**
 * Lightwave client: receive cues, compensate send delay, drive countdown + torch window.
 */

import {
    lw_startCountdown,
    lw_stopCountdown,
    lw_showWaiting,
    lw_showLowerPhone,
    lw_showWaveComplete,
    lw_setCountdownSeconds,
} from './lw_countdown.js';
import { lw_torchConfigure, lw_torchSetGoActive, lw_torchSetRaised, lw_torchOff } from './lw_torch.js';
import { lw_getPose } from './lw_pose.js';

let socketRef = null;
let mySection = null;
let activeWaveId = null;
let goTimer = null;
let endTimer = null;
let lowerTimer = null;
let cueHandler = null;
let stopHandler = null;
let followPose = false;

const LW_LOWER_HOLD_MS = 2500;

/**
 * Map server goAt onto local clock using sentAt vs receive time.
 * @param {{ goAt: number, sentAt: number }} cue
 * @param {number} receivedAt
 * @returns {number}
 */
export function lw_localGoAt(cue, receivedAt = Date.now()) {
    const goAt = Number(cue?.goAt);
    const sentAt = Number(cue?.sentAt);
    if (!Number.isFinite(goAt) || !Number.isFinite(sentAt)) return receivedAt;
    const delayFromSend = goAt - sentAt;
    return receivedAt + delayFromSend;
}

function clearWaveTimers() {
    if (goTimer !== null) {
        clearTimeout(goTimer);
        goTimer = null;
    }
    if (endTimer !== null) {
        clearTimeout(endTimer);
        endTimer = null;
    }
    if (lowerTimer !== null) {
        clearTimeout(lowerTimer);
        lowerTimer = null;
    }
}

async function endGoWindow() {
    endTimer = null;
    await lw_torchSetGoActive(false);
    lw_showLowerPhone();
    lowerTimer = setTimeout(() => {
        lowerTimer = null;
        lw_showWaveComplete();
    }, LW_LOWER_HOLD_MS);
}

export function lw_waveSetFollowPose(enabled) {
    followPose = enabled === true;
}

async function handleCue(cue) {
    if (followPose) return;
    if (!cue || cue.section !== mySection) return;
    if (activeWaveId && cue.waveId && cue.waveId === activeWaveId) {
        // Same wave duplicate
    }
    activeWaveId = cue.waveId || activeWaveId;
    const receivedAt = Date.now();
    const localGo = lw_localGoAt(cue, receivedAt);
    const torchMax = Number(cue.lw_torchMaxMs);
    const countdownSec = Number(cue.lw_countdownSeconds);
    lw_torchConfigure({
        maxMs: Number.isFinite(torchMax) ? torchMax : 3500,
        requireRaise: cue.lw_requireRaise !== false,
        offOnlyAtMax: cue.lw_offOnlyAtMax === true,
    });
    if (Number.isFinite(countdownSec)) {
        lw_setCountdownSeconds(countdownSec);
    }
    clearWaveTimers();
    await lw_torchSetGoActive(false);
    lw_startCountdown(localGo, mySection);

    const untilGo = Math.max(0, localGo - Date.now());
    goTimer = setTimeout(async () => {
        goTimer = null;
        await lw_torchSetRaised(lw_getPose() === 'raised');
        await lw_torchSetGoActive(true);
        const windowMs = Number.isFinite(torchMax) ? torchMax : 3500;
        endTimer = setTimeout(() => {
            endGoWindow();
        }, windowMs);
    }, untilGo);
}

async function handleStop(payload) {
    if (payload?.waveId && activeWaveId && payload.waveId !== activeWaveId) return;
    activeWaveId = null;
    clearWaveTimers();
    await lw_torchOff();
    lw_stopCountdown(true);
}

export function lw_waveSetSection(section) {
    mySection = section || null;
}

export function lw_waveStart(socket) {
    if (socketRef === socket && cueHandler) return;
    lw_waveStopListeners();
    socketRef = socket;
    cueHandler = (cue) => {
        handleCue(cue);
    };
    stopHandler = (payload) => {
        handleStop(payload);
    };
    socket.on('lw_wave-cue', cueHandler);
    socket.on('lw_wave-stop', stopHandler);
}

export function lw_waveStopListeners() {
    if (socketRef && cueHandler) {
        socketRef.off('lw_wave-cue', cueHandler);
        socketRef.off('lw_wave-stop', stopHandler);
    }
    cueHandler = null;
    stopHandler = null;
    socketRef = null;
}

export async function lw_waveReset() {
    activeWaveId = null;
    followPose = false;
    clearWaveTimers();
    await lw_torchOff();
    lw_stopCountdown(false);
    lw_waveStopListeners();
}
