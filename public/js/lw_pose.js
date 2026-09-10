/**
 * Lightwave pose: raised on a real camera-end lift or a held overhead /
 * inverted pose. Lowered on world-down travel or rotating back toward
 * the home hold. A modest tilt does not raise. After lower, raise is
 * locked briefly so the same motion cannot bounce straight back up.
 */

const MIN_G = 6;
const DEFAULT_RAISE_SENSITIVITY = 5;
const DEFAULT_LOWER_SENSITIVITY = 5;
const HEARTBEAT_MS = 2000;
const NO_SAMPLE_MS = 3000;
const CALIBRATE_SAMPLES = 10;
const CALIBRATE_MS = 200;
const GRAVITY_TAU_SEC = 0.5;
const TRAVEL_DECAY_TAU_SEC = 0.12;
const LOWER_DECAY_TAU_SEC = 0.32;
const MAX_DT_SEC = 0.05;
const MIN_DT_SEC = 0.008;
const DEADZONE_MS2 = 0.45;
/** After a lower, ignore raise / overhead hold until this many ms pass. */
export const LW_RAISE_REARM_MS = 550;

let listening = false;
let pose = 'neutral';
let sampleCount = 0;
let lastMetrics = { angleDeg: 0, torchUp: 0, ok: false, raiseTravel: 0, lowerTravel: 0 };
let onChange = null;
let onFirstSample = null;
let onSample = null;
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
 * Higher slider = easier (less travel / hold). Raise stays stricter than
 * lower at the same slider so a lean does not fire and a normal drop does.
 * @param {number} raiseSensitivity
 * @param {number} lowerSensitivity
 */
export function lw_thresholdsFromSensitivity(raiseSensitivity, lowerSensitivity) {
    const raise = clampSensitivity(raiseSensitivity, DEFAULT_RAISE_SENSITIVITY);
    const lower = clampSensitivity(lowerSensitivity, DEFAULT_LOWER_SENSITIVITY);
    const tRaise = (raise - 1) / 9;
    const tLower = (lower - 1) / 9;
    return {
        enterAngleDeg: lerp(105, 62, tRaise),
        enterTorchUp: lerp(0.88, 0.72, tRaise),
        raiseAccel: lerp(3.6, 1.5, tRaise),
        raiseTravel: lerp(1.20, 0.34, tRaise),
        raiseHoldMs: lerp(260, 80, tRaise),
        lowerAccel: lerp(1.15, 0.20, tLower),
        lowerTravel: lerp(0.32, 0.045, tLower),
        lowerHoldMs: lerp(100, 20, tLower),
        orientConfirmMs: lerp(360, 160, tRaise),
    };
}

export function lw_poseConfigure({ raiseSensitivity, lowerSensitivity } = {}) {
    liveThresholds = lw_thresholdsFromSensitivity(
        raiseSensitivity ?? DEFAULT_RAISE_SENSITIVITY,
        lowerSensitivity ?? DEFAULT_LOWER_SENSITIVITY,
    );
}

liveThresholds = lw_thresholdsFromSensitivity(DEFAULT_RAISE_SENSITIVITY, DEFAULT_LOWER_SENSITIVITY);

function clampTravel(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * How much upward / downward travel has been accumulated vs the current sliders.
 * @param {ReturnType<typeof lw_createPoseState>|null} state
 * @param {object} [thresholds]
 */
export function lw_travelProgress(state, thresholds = liveThresholds) {
    const raiseNeed = clampTravel(thresholds?.raiseTravel);
    const lowerNeed = clampTravel(thresholds?.lowerTravel);
    const raiseHave = clampTravel(state?.raiseTravel);
    const lowerHave = clampTravel(state?.lowerTravel);
    return {
        calibrating: !state || !state.baselineReady,
        pose: state?.pose || 'neutral',
        raiseHave,
        raiseNeed,
        raiseLeft: Math.max(0, raiseNeed - raiseHave),
        lowerHave,
        lowerNeed,
        lowerLeft: Math.max(0, lowerNeed - lowerHave),
    };
}

export function lw_getTravelDebug() {
    return lw_travelProgress(tracker, liveThresholds);
}

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
 *   lastAngleDeg: number|null, raiseLockMs: number, gravReady: boolean,
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
        lastAngleDeg: null,
        raiseLockMs: 0,
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

function worldUpUnit(state) {
    const mag = Math.hypot(state.gravX, state.gravY, state.gravZ);
    if (!mag) return { x: 0, y: 1, z: 0 };
    return {
        x: -state.gravX / mag,
        y: -state.gravY / mag,
        z: -state.gravZ / mag,
    };
}

function accelAlong(lin, axis) {
    return lin.x * axis.x + lin.y * axis.y + lin.z * axis.z;
}

/**
 * Camera end (portrait +Y) lifting along world-up.
 */
function raiseSignal(lin, state) {
    const up = worldUpUnit(state);
    const upA = accelAlong(lin, up);
    const topUp = Math.max(0, up.y) * Math.max(0, lin.y);
    return upA + 0.35 * topUp;
}

/**
 * Whole-phone / charging-port end moving toward the ground.
 * Does not reuse the raise bonus, so a drop is not cancelled by top-end math.
 */
function lowerSignal(lin, state) {
    const up = worldUpUnit(state);
    const worldDown = -accelAlong(lin, up);
    const bottomDown = Math.max(0, -lin.y) * Math.max(0, up.y);
    const topTowardGround = Math.max(0, lin.y) * Math.max(0, -up.y);
    return worldDown + 0.55 * bottomDown + 0.55 * topTowardGround;
}

function decayLowerTravel(value, dtSec) {
    return value * Math.exp(-dtSec / LOWER_DECAY_TAU_SEC);
}

/**
 * Degrees returned toward the home hold this sample. Used because people
 * usually lower by rotating the phone back down, not a sharp drop.
 */
function homeReturnDeg(sample, state) {
    const now = lw_poseMetrics({ gx: sample.gx, gy: sample.gy, gz: sample.gz });
    if (!now.ok) return 0;
    const prev = Number(state.lastAngleDeg);
    state.lastAngleDeg = now.angleDeg;
    if (!Number.isFinite(prev)) return 0;
    const home = lw_poseMetrics({
        gx: state.baseGx,
        gy: state.baseGy,
        gz: state.baseGz,
    });
    const homeAngle = home.ok ? home.angleDeg : 0;
    if (now.angleDeg + 8 < homeAngle) return 0;
    if (prev < homeAngle + 18) return 0;
    return Math.min(10, Math.max(0, prev - now.angleDeg));
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
 * Already-overhead / inverted. Modest tilts from home do not count —
 * those were firing raised without a real lift.
 * @param {{ gx: number, gy: number, gz: number }} sample
 * @param {ReturnType<typeof lw_createPoseState>} _state
 * @param {object} thresholds
 */
export function lw_looksRaisedFromInitial(sample, _state, thresholds) {
    return lw_orientationLooksRaised({
        gx: sample.gx,
        gy: sample.gy,
        gz: sample.gz,
    }, thresholds);
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
 * classifies raised/lowered from that initial position. Raise needs a
 * real camera-end lift or a held overhead / inverted pose. Lower is
 * world-down travel plus rotating back toward the home hold. After a
 * lower, raise is locked for {@link LW_RAISE_REARM_MS}.
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
    const raiseA = raiseSignal(lin, state);
    const lowerA = lowerSignal(lin, state);
    const nowRaised = state.pose === 'raised';

    if (!nowRaised) {
        state.lowerTravel = 0;
        state.lowerHoldMs = 0;
        if (state.raiseLockMs > 0) {
            state.raiseLockMs = Math.max(0, state.raiseLockMs - dtSec * 1000);
            state.raiseTravel = 0;
            state.raiseHoldMs = 0;
            state.orientHoldMs = 0;
            return state.pose;
        }
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
            const now = lw_poseMetrics({ gx: sample.gx, gy: sample.gy, gz: sample.gz });
            state.lastAngleDeg = now.ok ? now.angleDeg : null;
        }
        return state.pose;
    }

    state.raiseTravel = 0;
    state.raiseHoldMs = 0;
    state.orientHoldMs = 0;
    const closingDeg = homeReturnDeg(sample, state);
    const accelOk = lowerA > Math.max(thresholds.lowerAccel, DEADZONE_MS2);
    if (accelOk || closingDeg > 0.35) {
        state.lowerTravel += lowerA * dtSec + closingDeg * 0.018;
        state.lowerHoldMs += dtSec * 1000;
    } else {
        state.lowerTravel = decayLowerTravel(state.lowerTravel, dtSec);
        state.lowerHoldMs = Math.max(0, state.lowerHoldMs - dtSec * 400);
    }
    if (state.lowerTravel >= thresholds.lowerTravel && state.lowerHoldMs >= thresholds.lowerHoldMs) {
        state.pose = 'lowered';
        state.lowerTravel = 0;
        state.lowerHoldMs = 0;
        state.lastAngleDeg = null;
        state.raiseLockMs = LW_RAISE_REARM_MS;
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
    onSample = typeof options.onSample === 'function' ? options.onSample : onSample;
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
        if (onSample) onSample({ metrics: lastMetrics, pose: next, travel: lw_getTravelDebug() });
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
    onSample = null;
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
