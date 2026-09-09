/* --------------------------------------------------------------------------------------------------------------- */
/* Screen Wake Lock helper                                                                                         */
/* --------------------------------------------------------------------------------------------------------------- */
let wakeLock = null;

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        return { ok: false, error: 'Wake Lock API not supported' };
    }
    try {
        // Request a screen wake lock
        wakeLock = await navigator.wakeLock.request('screen');
        const onRelease = () => {
            // console.log('### Screen Wake Lock released');
        };
        try { wakeLock.addEventListener('release', onRelease); } catch (_) {}

        // Re-acquire on visibility change (common mobile behavior)
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}

async function handleVisibilityChange() {
    try {
        if (document.visibilityState === 'visible' && !wakeLock && 'wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (_) { /* ignore */ }
}

async function releaseWakeLock() {
    try {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (wakeLock) {
            await wakeLock.release();
            wakeLock = null;
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}

export async function enableWakeLock() {
    return await requestWakeLock();
}

export async function disableWakeLock() {
    return await releaseWakeLock();
}


