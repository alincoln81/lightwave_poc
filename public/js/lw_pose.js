/**
 * Lightwave pose: raised when the camera end (portrait top) lifts
 * upward; lowered when the charging-port end / phone body drops down.
 * Exit is motion-only so orientation wobble cannot flicker the torch.
 */

const MIN_G = 6;
const DEFAULT_RAISE_SENSITIVITY = 5;
const DEFAULT_LOWER_SENSITIVITY = 5;
const HEARTBEAT_MS = 2000;
const NO_SAMPLE_MS = 3000;
const CALIBRATE_SAMPLES = 10;
const CALIBRATE_MS = 200;
const GRAVITY_TAU_SEC = 0.22;
const TRAVEL_DECAY_TAU_SEC = 0.12;
const MAX_DT_SEC = 0.05;
const MIN_DT_SEC = 0.008;
const DEADZONE_MS2 = 0.45;

let listening = false;
let pose = 'neutral';
let sampleCount = 0;
let lastMetrics = { angleDeg: 0, torchUp: 0, ok: false, raiseTravel: 0, lowerTravel: 0 };
let onChange = null;
let onFirstSample = null;
let onHeartbeat = null;
let onNoSample = null;
let motionHandler = null;
let heartbeatTimer = null;
let noSampleTimer = null;
let liveThresholds = null;
let tracker = null;
let lastSampleAt = 0;

function clampSensitivity(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(10, Math.max(1, Math.round(n)));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Map 1–10 producer sliders to raise/lower gesture thresholds.
 * Higher raise = shorter upward travel to turn on.
 * Higher lower = shorter downward travel to turn off.
 * Defaults are 5 / 5. Raise travel stays shorter than lower travel at the same slider.
 * @param {number} raiseSensitivity
 * @param {number} lowerSensitivity
 */
export function lw_thresholdsFromSensitivity(raiseSensitivity, lowerSensitivity) {
    const raise = clampSensitivity(raiseSensitivity, DEFAULT_RAISE_SENSITIVITY);
    const lower = clampSensitivity(lowerSensitivity, DEFAULT_LOWER_SENSITIVITY);
    const tRaise = (raise - 1) / 9;
    const tLower = (lower - 1) / 9;
    return {
        enterAngleDeg: lerp(82, 18, tRaise),
        enterTorchUp: lerp(0.5, 0.06, tRaise),
        raiseAccel: lerp(2.4, 0.7, tRaise),
        raiseTravel: lerp(0.55, 0.12, tRaise),
        raiseHoldMs: lerp(140, 40, tRaise),
        lowerAccel: lerp(2.8, 1.1, tLower),
        lowerTravel: lerp(1.15, 0.28, tLower),
        lowerHoldMs: lerp(280, 80, tLower),
        orientConfirmMs: lerp(220, 70, tRaise),
    };
}

export function lw_poseConfigure({ raiseSensitivity, lowerSensitivity } = {}) {
    liveThresholds = lw_thresholdsFromSensitivity(
        raiseSensitivity ?? DEFAULT_RAISE_SENSITIVITY,
        lowerSensitivity ?? DEFAULT_LOWER_SENSITIVITY,
    );
}

liveThresholds = lw_thresholdsFromSensitivity(DEFAULT_RAISE_SENSITIVITY, DEFAULT_LOWER_SENSITIVITY);

/**
 * @param {{ gx: number, gy: number, gz: number }} g
 * @returns {{ angleDeg: number, torchUp: number, ok: boolean }}
 */
export function lw_poseMetrics({ gx, gy, gz }) {
    const mag = Math.hypot(Number(gx) || 0, Number(gy) || 0, Number(gz) || 0);
    if (!mag || mag < MIN_G) {
        return { angleDeg: 0, torchUp: 0, ok: false };
    }
    const ny = gy / mag;
    const nz = gz / mag;
    const uprightDot = Math.min(1, Math.max(-1, -ny));
    const angleDeg = Math.acos(uprightDot) * (180 / Math.PI);
    return { angleDeg, torchUp: nz, ok: true };
}

/**
 * Portrait camera-end already pointing up / phone inverted.
 * Used only to enter raised (people who lifted before GO), never to exit.
 * @param {{ gx: number, gy: number, gz: number }} g
 * @param {object} [thresholds]
 * @returns {boolean}
 */
export function lw_orientationLooksRaised(g, thresholds = liveThresholds) {
    const { angleDeg, torchUp, ok } = lw_poseMetrics(g);
    if (!ok) return false;
    const enterAngle = Number(thresholds?.enterAngleDeg);
    const enterTorch = Number(thresholds?.enterTorchUp);
    return angleDeg > enterAngle || torchUp > enterTorch;
}

/**
 * @returns {{
 *   pose: 'raised'|'lowered',
 *   gravX: number, gravY: number, gravZ: number,
 *   raiseTravel: number, lowerTravel: number,
 *   raiseHoldMs: number, lowerHoldMs: number, orientHoldMs: number,
 *   gravReady: boolean,
 * }}
 */
export function lw_createPoseState() {
    return {
        pose: 'neutral',
        gravX: 0,
        gravY: -9.8,
        gravZ: 0,
        raiseTravel: 0,
        lowerTravel: 0,
        raiseHoldMs: 0,
        lowerHoldMs: 0,
        orientHoldMs: 0,
        gravReady: false,
        baselineReady: false,
        calibSamples: 0,
        calibMs: 0,
        sumGx: 0,
        sumGy: 0,
        sumGz: 0,
        baseGx: 0,
        baseGy: -9.8,
        baseGz: 0,
    };
}

function decayTravel(value, dtSec) {
    return value * Math.exp(-dtSec / TRAVEL_DECAY_TAU_SEC);
}

function finiteAccel(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function linearFromSample(sample, state) {
    const residual = {
        x: (Number(sample.gx) || 0) - state.gravX,
        y: (Number(sample.gy) || 0) - state.gravY,
        z: (Number(sample.gz) || 0) - state.gravZ,
    };
    const ax = finiteAccel(sample.ax);
    const ay = finiteAccel(sample.ay);
    const az = finiteAccel(sample.az);
    if (ax === null || ay === null || az === null) return residual;
    const linMag = Math.hypot(ax, ay, az);
    const resMag = Math.hypot(residual.x, residual.y, residual.z);
    if (linMag >= 0.2 || resMag < 0.35) {
        return { x: ax, y: ay, z: az };
    }
    return residual;
}

function updateGravity(state, sample, dtSec) {
    const gx = Number(sample.gx);
    const gy = Number(sample.gy);
    const gz = Number(sample.gz);
    if (!Number.isFinite(gx) || !Number.isFinite(gy) || !Number.isFinite(gz)) return;
    if (!state.gravReady) {
        state.gravX = gx;
        state.gravY = gy;
        state.gravZ = gz;
        state.gravReady = true;
        return;
    }
    const alpha = 1 - Math.exp(-dtSec / GRAVITY_TAU_SEC);
    state.gravX += alpha * (gx - state.gravX);
    state.gravY += alpha * (gy - state.gravY);
    state.gravZ += alpha * (gz - state.gravZ);
}

/**
 * World-up linear accel, plus extra when the portrait top (camera) lifts.
 * Positive = going up. Negative = coming down.
 */
function worldUpAccel(lin, state) {
    const mag = Math.hypot(state.gravX, state.gravY, state.gravZ);
    if (!mag) return 0;
    const upX = -state.gravX / mag;
    const upY = -state.gravY / mag;
    const upZ = -state.gravZ / mag;
    const upA = lin.x * upX + lin.y * upY + lin.z * upZ;
    const topAlongUp = Math.max(0, upY) * lin.y;
    return upA + 0.35 * Math.max(0, topAlongUp);
}

function finishCalibration(state, thresholds) {
    const n = state.calibSamples || 1;
    state.baseGx = state.sumGx / n;
    state.baseGy = state.sumGy / n;
    state.baseGz = state.sumGz / n;
    state.baselineReady = true;
    const initial = {
        gx: state.baseGx,
        gy: state.baseGy,
        gz: state.baseGz,
    };
    state.pose = lw_orientationLooksRaised(initial, thresholds) ? 'raised' : 'lowered';
}

/**
 * Raised vs the captured home hold, or an already-overhead posture.
 * @param {{ gx: number, gy: number, gz: number }} sample
 * @param {ReturnType<typeof lw_createPoseState>} state
 * @param {object} thresholds
 */
export function lw_looksRaisedFromInitial(sample, state, thresholds) {
    const current = { gx: sample.gx, gy: sample.gy, gz: sample.gz };
    if (lw_orientationLooksRaised(current, thresholds)) return true;
    const now = lw_poseMetrics(current);
    const home = lw_poseMetrics({
        gx: state.baseGx,
        gy: state.baseGy,
        gz: state.baseGz,
    });
    if (!now.ok || !home.ok) return false;
    const needAngle = Number(thresholds.enterAngleDeg) * 0.4 + 6;
    const needTorch = Number(thresholds.enterTorchUp) * 0.5 + 0.05;
    return (now.angleDeg - home.angleDeg) >= needAngle
        || (now.torchUp - home.torchUp) >= needTorch;
}

function collectBaseline(state, sample, dtSec) {
    const gx = Number(sample.gx);
    const gy = Number(sample.gy);
    const gz = Number(sample.gz);
    if (!Number.isFinite(gx) || !Number.isFinite(gy) || !Number.isFinite(gz)) {
        return false;
    }
    const mag = Math.hypot(gx, gy, gz);
    if (mag < MIN_G) return false;
    state.sumGx += gx;
    state.sumGy += gy;
    state.sumGz += gz;
    state.calibSamples += 1;
    state.calibMs += dtSec * 1000;
    return state.calibSamples >= CALIBRATE_SAMPLES && state.calibMs >= CALIBRATE_MS;
}

/**
 * Advance the pose tracker by one motion sample.
 * Starts neutral while the first samples capture the home hold, then
 * classifies raised/lowered from that initial position. Raise is a short
 * camera-end lift from home; lower is a longer downward drop only.
 * @param {ReturnType<typeof lw_createPoseState>} state
 * @param {{ gx: number, gy: number, gz: number, ax?: number, ay?: number, az?: number, dtSec?: number }} sample
 * @param {object} [thresholds]
 * @returns {'raised'|'lowered'|'neutral'}
 */
export function lw_advancePose(state, sample, thresholds = liveThresholds) {
    const dtSec = Math.min(MAX_DT_SEC, Math.max(MIN_DT_SEC, Number(sample?.dtSec) || 1 / 60));
    if (!state.baselineReady) {
        state.pose = 'neutral';
        updateGravity(state, sample, dtSec);
        if (collectBaseline(state, sample, dtSec)) {
            finishCalibration(state, thresholds);
        }
        return state.pose;
    }
    updateGravity(state, sample, dtSec);
    const lin = linearFromSample(sample, state);
    const upA = worldUpAccel(lin, state);
    const raiseA = upA;
    const lowerA = -upA;
    const nowRaised = state.pose === 'raised';

    if (!nowRaised) {
        state.lowerTravel = 0;
        state.lowerHoldMs = 0;
        if (raiseA > thresholds.raiseAccel && raiseA > DEADZONE_MS2) {
            state.raiseTravel += raiseA * dtSec;
            state.raiseHoldMs += dtSec * 1000;
        } else {
            state.raiseTravel = decayTravel(state.raiseTravel, dtSec);
            state.raiseHoldMs = 0;
        }
        const looksUp = lw_looksRaisedFromInitial(sample, state, thresholds);
        if (looksUp) {
            state.orientHoldMs += dtSec * 1000;
        } else {
            state.orientHoldMs = 0;
        }
        const lifted = state.raiseTravel >= thresholds.raiseTravel
            && state.raiseHoldMs >= thresholds.raiseHoldMs;
        const alreadyUp = state.orientHoldMs >= thresholds.orientConfirmMs;
        if (lifted || alreadyUp) {
            state.pose = 'raised';
            state.raiseTravel = 0;
            state.raiseHoldMs = 0;
            state.orientHoldMs = 0;
            state.lowerTravel = 0;
            state.lowerHoldMs = 0;
        }
        return state.pose;
    }

    state.raiseTravel = 0;
    state.raiseHoldMs = 0;
    state.orientHoldMs = 0;
    if (lowerA > thresholds.lowerAccel && lowerA > DEADZONE_MS2) {
        state.lowerTravel += lowerA * dtSec;
        state.lowerHoldMs += dtSec * 1000;
    } else {
        state.lowerTravel = decayTravel(state.lowerTravel, dtSec);
        state.lowerHoldMs = 0;
    }
    if (state.lowerTravel >= thresholds.lowerTravel && state.lowerHoldMs >= thresholds.lowerHoldMs) {
        state.pose = 'lowered';
        state.lowerTravel = 0;
        state.lowerHoldMs = 0;
    }
    return state.pose;
}

/**
 * Snapshot orientation helper (enter-only). Live torch uses {@link lw_advancePose}.
 * @param {{ gx: number, gy: number, gz: number }} g
 * @param {'raised'|'lowered'} previous
 * @returns {'raised'|'lowered'|'unknown'}
 */
export function lw_classifyPose(g, previous = 'lowered', thresholds = liveThresholds) {
    const { ok } = lw_poseMetrics(g);
    if (!ok) return 'unknown';
    if (previous === 'raised') return 'raised';
    return lw_orientationLooksRaised(g, thresholds) ? 'raised' : 'lowered';
}

export function lw_needsMotionPermission() {
    return typeof DeviceMotionEvent !== 'undefined'
        && typeof DeviceMotionEvent.requestPermission === 'function';
}

/**
 * Request iOS motion permission. Must run from a user gesture.
 * @returns {Promise<'granted'|'denied'|'unsupported'>}
 */
export async function lw_requestMotionPermission() {
    if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const result = await DeviceMotionEvent.requestPermission();
            if (result === 'granted') {
                if (typeof DeviceOrientationEvent !== 'undefined'
                    && typeof DeviceOrientationEvent.requestPermission === 'function') {
                    try { await DeviceOrientationEvent.requestPermission(); } catch { /* optional */ }
                }
                return 'granted';
            }
            return 'denied';
        } catch {
            return 'denied';
        }
    }
    return 'granted';
}

function bindReporter(options = {}) {
    onChange = typeof options.onPose === 'function' ? options.onPose : onChange;
    onFirstSample = typeof options.onFirstSample === 'function' ? options.onFirstSample : onFirstSample;
    onHeartbeat = typeof options.onHeartbeat === 'function' ? options.onHeartbeat : onHeartbeat;
    onNoSample = typeof options.onNoSample === 'function' ? options.onNoSample : onNoSample;
}

function reporterSnapshot() {
    return {
        samples: sampleCount,
        pose,
        angleDeg: lastMetrics.angleDeg,
        torchUp: lastMetrics.torchUp,
        raiseTravel: lastMetrics.raiseTravel,
        lowerTravel: lastMetrics.lowerTravel,
    };
}

function clearReporterTimers() {
    if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    if (noSampleTimer !== null) {
        clearTimeout(noSampleTimer);
        noSampleTimer = null;
    }
}

function resetLiveTracker() {
    tracker = lw_createPoseState();
    pose = 'neutral';
    sampleCount = 0;
    lastSampleAt = 0;
    lastMetrics = { angleDeg: 0, torchUp: 0, ok: false, raiseTravel: 0, lowerTravel: 0 };
}

/**
 * @param {{
 *   onPose?: (pose: 'raised'|'lowered') => void,
 *   onFirstSample?: (info: { metrics: object, pose: string }) => void,
 *   onHeartbeat?: (info: { samples: number, pose: string, angleDeg: number, torchUp: number }) => void,
 *   onNoSample?: () => void,
 * }} options
 */
export function lw_poseStart(options = {}) {
    bindReporter(options);
    if (listening) return;
    resetLiveTracker();
    motionHandler = (event) => {
        const inc = event.accelerationIncludingGravity;
        if (!inc) return;
        const now = Date.now();
        const dtSec = lastSampleAt
            ? Math.min(MAX_DT_SEC, Math.max(MIN_DT_SEC, (now - lastSampleAt) / 1000))
            : 1 / 60;
        lastSampleAt = now;
        const lin = event.acceleration;
        const sample = {
            gx: inc.x,
            gy: inc.y,
            gz: inc.z,
            ax: lin ? lin.x : undefined,
            ay: lin ? lin.y : undefined,
            az: lin ? lin.z : undefined,
            dtSec,
        };
        const metrics = lw_poseMetrics({ gx: inc.x, gy: inc.y, gz: inc.z });
        const next = lw_advancePose(tracker, sample, liveThresholds);
        lastMetrics = {
            ...metrics,
            raiseTravel: tracker.raiseTravel,
            lowerTravel: tracker.lowerTravel,
        };
        sampleCount += 1;
        if (sampleCount === 1 && onFirstSample) {
            onFirstSample({ metrics: lastMetrics, pose });
        }
        if (next === pose) return;
        pose = next;
        if (onChange) onChange(pose);
    };
    window.addEventListener('devicemotion', motionHandler);
    listening = true;
    heartbeatTimer = setInterval(() => {
        if (onHeartbeat) onHeartbeat(reporterSnapshot());
    }, HEARTBEAT_MS);
    noSampleTimer = setTimeout(() => {
        noSampleTimer = null;
        if (sampleCount === 0 && onNoSample) onNoSample();
    }, NO_SAMPLE_MS);
}

export function lw_poseStop() {
    if (motionHandler) {
        window.removeEventListener('devicemotion', motionHandler);
    }
    clearReporterTimers();
    motionHandler = null;
    onChange = null;
    onFirstSample = null;
    onHeartbeat = null;
    onNoSample = null;
    listening = false;
    resetLiveTracker();
}

export function lw_getPose() {
    return pose;
}

export function lw_getSampleCount() {
    return sampleCount;
}

export function lw_getLastMetrics() {
    return lastMetrics;
}
