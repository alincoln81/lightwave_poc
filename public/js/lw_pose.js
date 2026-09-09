/**
 * Lightwave pose classifier: eye-level / lowered vs arm-raised (overhead).
 * Accelerometer cannot measure height; raised is inferred from orientation
 * (phone inverted or torch pointed upward — typical stadium flashlight pose).
 */

const ENTER_ANGLE_DEG = 70;
const EXIT_ANGLE_DEG = 50;
const ENTER_TORCH_UP = 0.35;
const EXIT_TORCH_UP = 0.15;
const MIN_G = 6;

let listening = false;
let pose = 'lowered';
let onChange = null;
let motionHandler = null;

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
export function lw_classifyPose(g, previous = 'lowered') {
    const { angleDeg, torchUp, ok } = lw_poseMetrics(g);
    if (!ok) return 'unknown';
    if (previous === 'raised') {
        if (angleDeg < EXIT_ANGLE_DEG && torchUp < EXIT_TORCH_UP) return 'lowered';
        return 'raised';
    }
    if (angleDeg > ENTER_ANGLE_DEG || torchUp > ENTER_TORCH_UP) return 'raised';
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

/**
 * @param {{ onPose: (pose: 'raised'|'lowered') => void }} options
 */
export function lw_poseStart(options = {}) {
    if (listening) {
        if (typeof options.onPose === 'function') onChange = options.onPose;
        return;
    }
    onChange = typeof options.onPose === 'function' ? options.onPose : null;
    pose = 'lowered';
    motionHandler = (event) => {
        const g = gravityFromEvent(event);
        if (!g) return;
        const next = lw_classifyPose(g, pose);
        if (next === 'unknown' || next === pose) return;
        pose = next;
        if (onChange) onChange(pose);
    };
    window.addEventListener('devicemotion', motionHandler);
    listening = true;
}

export function lw_poseStop() {
    if (motionHandler) {
        window.removeEventListener('devicemotion', motionHandler);
    }
    motionHandler = null;
    onChange = null;
    listening = false;
    pose = 'lowered';
}

export function lw_getPose() {
    return pose;
}
