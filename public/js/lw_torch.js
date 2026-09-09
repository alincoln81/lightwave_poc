/**
 * Lightwave torch gate: ON only during the GO window, never longer than
 * lw_torchMaxMs after torch-on. When requireRaise is true, also needs a
 * raised pose (or sensor fallback). When false, GO turns the torch on.
 * followPose skips the GO window and max cap: on while raised, off while not.
 */

let goActive = false;
let raised = false;
let fallback = false;
let requireRaise = true;
let offOnlyAtMax = false;
let followPose = false;
let offOnLower = true;
let maxMs = 3000;
let minMs = 20000;
let followOffMs = null;
let torchOnAt = null;
let desiredOn = false;
let capTimer = null;

/**
 * Inclusive random off delay for follow-pose timed mode.
 * @param {number} min
 * @param {number} max
 */
export function lw_pickFollowOffMs(min, max) {
    const a = Math.round(Number(min));
    const b = Math.round(Number(max));
    const first = Number.isFinite(a) ? a : 20000;
    const second = Number.isFinite(b) ? b : first;
    const lo = Math.min(first, second);
    const hi = Math.max(first, second);
    if (hi <= lo) return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Pure gate used by tests and the live controller.
 * elapsedMs is time since torch turned on (0 if off).
 * @param {{ goActive: boolean, raised: boolean, fallback: boolean, elapsedMs: number, maxMs: number, requireRaise?: boolean, offOnlyAtMax?: boolean, latched?: boolean, followPose?: boolean, offOnLower?: boolean }} input
 * @returns {boolean}
 */
export function lw_shouldTorchBeOn({
    goActive: go,
    raised: isRaised,
    fallback: useFallback,
    elapsedMs,
    maxMs: cap,
    requireRaise: needRaise = true,
    offOnlyAtMax: keepUntilMax = false,
    latched = false,
    followPose: poseOnly = false,
    offOnLower: dropTurnsOff = true,
}) {
    if (poseOnly) {
        if (dropTurnsOff) return !!isRaised;
        const limit = Number.isFinite(cap) ? cap : 3000;
        if (Number.isFinite(elapsedMs) && elapsedMs >= limit) return false;
        if (isRaised) return true;
        return !!latched;
    }
    if (!go) return false;
    const limit = Number.isFinite(cap) ? cap : 3000;
    if (Number.isFinite(elapsedMs) && elapsedMs >= limit) return false;
    if (needRaise === false) return true;
    if (useFallback) return true;
    if (isRaised) return true;
    return !!(keepUntilMax && latched);
}

function elapsedSinceOn(now = Date.now()) {
    if (torchOnAt === null) return 0;
    return now - torchOnAt;
}

function clearCapTimer() {
    if (capTimer !== null) {
        clearTimeout(capTimer);
        capTimer = null;
    }
}

async function applyDesired() {
    const shouldOn = lw_shouldTorchBeOn({
        goActive,
        raised,
        fallback,
        elapsedMs: elapsedSinceOn(),
        maxMs: followPose && !offOnLower && followOffMs !== null ? followOffMs : maxMs,
        requireRaise,
        offOnlyAtMax,
        followPose,
        offOnLower,
        latched: torchOnAt !== null,
    });
    if (shouldOn === desiredOn && !(shouldOn && torchOnAt === null)) {
        if (!shouldOn && torchOnAt !== null) {
            torchOnAt = null;
        }
        return;
    }
    desiredOn = shouldOn;
    const { setTorch } = await import('./camera-torch-access.js');
    if (shouldOn) {
        if (torchOnAt === null) {
            torchOnAt = Date.now();
            if (followPose && !offOnLower) {
                followOffMs = lw_pickFollowOffMs(minMs, maxMs);
            }
        }
        clearCapTimer();
        const timedFollow = followPose && !offOnLower;
        if (!followPose || timedFollow) {
            const limit = timedFollow && followOffMs !== null ? followOffMs : maxMs;
            const remaining = Math.max(0, limit - elapsedSinceOn());
            capTimer = setTimeout(() => {
                capTimer = null;
                applyDesired();
            }, remaining);
        }
        await setTorch(true);
    } else {
        torchOnAt = null;
        followOffMs = null;
        clearCapTimer();
        await setTorch(false);
    }
}

export function lw_torchConfigure({
    maxMs: nextMax,
    fallback: nextFallback,
    requireRaise: nextRequireRaise,
    offOnlyAtMax: nextOffOnlyAtMax,
    followPose: nextFollowPose,
    offOnLower: nextOffOnLower,
    minMs: nextMin,
} = {}) {
    if (Number.isFinite(nextMax)) maxMs = nextMax;
    if (Number.isFinite(nextMin)) minMs = nextMin;
    if (typeof nextFallback === 'boolean') fallback = nextFallback;
    if (typeof nextRequireRaise === 'boolean') requireRaise = nextRequireRaise;
    if (typeof nextOffOnlyAtMax === 'boolean') offOnlyAtMax = nextOffOnlyAtMax;
    if (typeof nextFollowPose === 'boolean') followPose = nextFollowPose;
    if (typeof nextOffOnLower === 'boolean') offOnLower = nextOffOnLower;
}

export async function lw_torchSetGoActive(active) {
    goActive = !!active;
    if (!goActive) {
        torchOnAt = null;
        clearCapTimer();
    }
    await applyDesired();
}

export async function lw_torchSetRaised(isRaised) {
    raised = !!isRaised;
    await applyDesired();
}

export async function lw_torchOff() {
    goActive = false;
    torchOnAt = null;
    followOffMs = null;
    desiredOn = false;
    clearCapTimer();
    const { setTorch } = await import('./camera-torch-access.js');
    await setTorch(false);
}

export function lw_torchReset() {
    goActive = false;
    raised = false;
    fallback = false;
    requireRaise = true;
    offOnlyAtMax = false;
    followPose = false;
    offOnLower = true;
    maxMs = 3000;
    minMs = 20000;
    followOffMs = null;
    torchOnAt = null;
    desiredOn = false;
    clearCapTimer();
}
