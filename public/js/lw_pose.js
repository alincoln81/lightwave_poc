/**
 * Lightwave pose classifier: eye-level / lowered vs arm-raised (overhead).
 * Accelerometer cannot measure height; raised is inferred from orientation
 * (phone inverted or torch pointed upward — typical stadium flashlight pose).
 */

const MIN_G = 6;
const DEFAULT_RAISE_SENSITIVITY = 8;
const DEFAULT_LOWER_SENSITIVITY = 2;
const HEARTBEAT_MS = 2000;
const NO_SAMPLE_MS = 3000;

let listening = false;
let pose = 'lowered';
let sampleCount = 0;
let lastMetrics = { angleDeg: 0, torchUp: 0, ok: false };
let onChange = null;
let onFirstSample = null;
let onHeartbeat = null;
let onNoSample = null;
let motionHandler = null;
let heartbeatTimer = null;
let noSampleTimer = null;
let liveThresholds = null;

function clampSensitivity(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(10, Math.max(1, Math.round(n)));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Map 1–10 producer sliders to enter/exit thresholds.
 * Higher raise = easier / more subtle to turn on.
 * Higher lower = easier to turn off; low = must drop almost upright.
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
        exitAngleDeg: lerp(8, 48, tLower),
        exitTorchUp: lerp(0.06, 0.28, tLower),
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
 * Classify a single sample. Pass previous pose for hysteresis.
 * @param {{ gx: number, gy: number, gz: number }} g
 * @param {'raised'|'lowered'} previous
 * @returns {'raised'|'lowered'|'unknown'}
 */
export function lw_classifyPose(g, previous = 'lowered', thresholds = liveThresholds) {
    const { angleDeg, torchUp, ok } = lw_poseMetrics(g);
    if (!ok) return 'unknown';
    const enterAngle = Number(thresholds?.enterAngleDeg);
    const exitAngle = Number(thresholds?.exitAngleDeg);
    const enterTorch = Number(thresholds?.enterTorchUp);
    const exitTorch = Number(thresholds?.exitTorchUp);
    if (previous === 'raised') {
        if (angleDeg < exitAngle && torchUp < exitTorch) return 'lowered';
        return 'raised';
    }
    if (angleDeg > enterAngle || torchUp > enterTorch) return 'raised';
    return 'lowered';
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
    if (typeof DeviceMotionEvent.requestPermission !== 'function') return 'granted';
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

function gravityFromEvent(event) {
    const g = event.accelerationIncludingGravity;
    if (!g) return null;
    return { gx: g.x, gy: g.y, gz: g.z };
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
    pose = 'lowered';
    sampleCount = 0;
    lastMetrics = { angleDeg: 0, torchUp: 0, ok: false };
    motionHandler = (event) => {
        const g = gravityFromEvent(event);
        if (!g) return;
        lastMetrics = lw_poseMetrics(g);
        sampleCount += 1;
        if (sampleCount === 1 && onFirstSample) {
            onFirstSample({ metrics: lastMetrics, pose });
        }
        const next = lw_classifyPose(g, pose);
        if (next === 'unknown' || next === pose) return;
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
    pose = 'lowered';
    sampleCount = 0;
    lastMetrics = { angleDeg: 0, torchUp: 0, ok: false };
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
