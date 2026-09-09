/* --------------------------------------------------------------------------------------------------------------- */
/* Recording Module                                                                                                */
/* Handles photo capture, video recording, slide-to-lock gesture, arc timer, and media save.                      */
/* --------------------------------------------------------------------------------------------------------------- */

// SVG arc constants (r=44, circumference = 2π×44)
const ARC_CIRCUMFERENCE = 2 * Math.PI * 44; // ≈ 276.46

// State
let videoEl = null;
let canvasEl = null;
let maxDurationSecs = 30;
/** Optional: () => MediaStream | null — called when starting video recording to add audio tracks to the output. */
let getAudioStream = null;

let recorder = null;
let recordingChunks = [];
let recordingStartTime = 0;
let recordingTimer = null;
let isRecording = false;
let isLocked = false;
let videoDrawLoopId = null; // rAF id for portrait canvas draw loop

// Touch state
let touchStartTime = 0;
let touchStartX = 0;
let holdTimer = null;         // fires after 200ms to transition from tap to hold
let lockIntent = false;       // true when thumb has slid to lock zone

// Pending save — deferred until next tap so Web Share API has a fresh user gesture
let pendingMedia = null; // { blob, filename }
let shareOnStop = false; // true when stop was triggered by a tap (user gesture still active)
let onPendingMediaClearedCallback = null;

// DOM refs (resolved lazily)
let btnEl = null;
let arcProgressEl = null;
let lockZoneEl = null;
let stopIconEl = null;
let saveIconEl = null;
let shareOverlayEl = null;
let shareOverlayBtnEl = null;

const HOLD_THRESHOLD_MS = 200;   // below this = tap (photo), above = hold (video)
const LOCK_SLIDE_PX = 60;        // px left of button center to trigger lock

/** True when running on iOS (iPhone/iPad). Used to avoid download fallback so share sheet is used consistently. */
function isIOS() {
    if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Public API                                                                                                      */
/* --------------------------------------------------------------------------------------------------------------- */

/**
 * Call once when the recording UI becomes visible.
 * Re-calling with new maxDuration is safe (resets state if not recording).
 * @param {HTMLVideoElement} video
 * @param {HTMLCanvasElement} canvas
 * @param {number} maxDuration
 * @param {(() => MediaStream | null)|undefined} optionalGetAudioStream - called when starting video recording; audio tracks are added to the recorded output.
 */
export function initRecording(video, canvas, maxDuration, optionalGetAudioStream) {
    videoEl = video;
    canvasEl = canvas;
    maxDurationSecs = maxDuration || 30;
    getAudioStream = typeof optionalGetAudioStream === 'function' ? optionalGetAudioStream : null;

    // Resolve DOM refs once
    btnEl         = btnEl         || document.getElementById('recording-btn');
    arcProgressEl = arcProgressEl || document.getElementById('recording-arc')?.querySelector('.arc-progress');
    lockZoneEl    = lockZoneEl    || document.getElementById('lock-zone');
    stopIconEl    = stopIconEl    || btnEl?.querySelector('.recording-icon-stop');
    saveIconEl    = saveIconEl    || btnEl?.querySelector('.recording-icon-save');
    shareOverlayEl = shareOverlayEl || document.getElementById('recording-share-overlay');
    shareOverlayBtnEl = shareOverlayBtnEl || document.getElementById('recording-share-overlay-btn');

    // Hide progress arc when idle so the text-colored bg arc shows
    if (!isRecording) {
        setArcProgress(1);
    }
}

export function hasPendingMedia() {
    return pendingMedia !== null;
}

export function registerOnPendingMediaCleared(callback) {
    onPendingMediaClearedCallback = callback;
}

/**
 * Call from a click handler when there is pending media. On iOS the share sheet must be opened
 * from a click event (not touchstart) to work on first tap.
 */
export function handlePendingMediaClick(e) {
    if (!pendingMedia || !e.target.closest('#recording-btn-wrapper')) return;
    e.preventDefault();
    e.stopPropagation();
    hideAllIcons();
    const { blob, filename } = pendingMedia;
    saveMedia(blob, filename)
        .then((usedShare) => {
            if (usedShare !== true) resetUI();
        })
        .catch((err) => {
            if (isIOS()) {
                pendingMedia = { blob, filename };
                showSaveIcon();
                console.warn('[recording] Share failed on click, keeping download icon for retry:', err?.name, err?.message);
            } else {
                resetUI();
            }
        });
}

export function handleTouchStart(e) {
    if (!btnEl || !e.target.closest('#recording-btn-wrapper')) return;
    // On iOS, Web Share requires the call from a *click* event. Skip handling pending media here
    // so the synthetic click will fire and we open the share sheet in the click handler (first tap).
    if (pendingMedia && isIOS()) {
        return;
    }
    e.preventDefault();

    // Pending save — tap triggers share/download (non-iOS: share from touchstart).
    if (pendingMedia) {
        hideAllIcons();
        const { blob, filename } = pendingMedia;
        saveMedia(blob, filename)
            .then((usedShare) => {
                if (usedShare !== true) resetUI();
            })
            .catch((err) => {
                if (isIOS()) {
                    pendingMedia = { blob, filename };
                    showSaveIcon();
                    console.warn('[recording] Share failed on tap, keeping download icon for retry:', err?.name, err?.message);
                } else {
                    resetUI();
                }
            });
        return;
    }

    touchStartTime = Date.now();
    touchStartX    = e.touches[0]?.clientX ?? 0;
    lockIntent     = false;

    if (isLocked) {
        // In locked mode, any tap on the button stops recording
        // Flag to try sharing immediately while user gesture is still active
        shareOnStop = true;
        stopVideoRecording();
        return;
    }

    // Set hold timer — if still pressed after threshold, start video recording
    holdTimer = setTimeout(() => {
        holdTimer = null;
        // Show lock zone now that hold is confirmed
        if (lockZoneEl) {
            lockZoneEl.style.display = 'flex';
            lockZoneEl.classList.remove('lock-active');
        }
        startVideoRecording();
    }, HOLD_THRESHOLD_MS);
}

export function handleTouchMove(e) {
    if (!isRecording) return;
    e.preventDefault();

    const currentX = e.touches[0]?.clientX ?? 0;
    const deltaX   = touchStartX - currentX; // positive = moved left

    if (deltaX >= LOCK_SLIDE_PX) {
        lockIntent = true;
        if (lockZoneEl) lockZoneEl.classList.add('lock-active');
    } else {
        lockIntent = false;
        if (lockZoneEl) lockZoneEl.classList.remove('lock-active');
    }
}

export function handleTouchEnd(e) {
    const elapsed = Date.now() - touchStartTime;

    if (holdTimer !== null) {
        // Released before hold threshold — it was a tap
        clearTimeout(holdTimer);
        holdTimer = null;
        hideLockZone();
        capturePhoto();
        return;
    }

    if (!isRecording) return;

    if (lockIntent) {
        // Slide-to-lock: enter locked mode, keep recording
        isLocked = true;
        lockIntent = false;
        hideLockZone();
        showStopIcon();
    } else {
        // Normal release: stop recording and hide lock zone
        hideLockZone();
        shareOnStop = true;
        stopVideoRecording();
    }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Photo Capture                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */

/**
 * Compute center-crop params to produce a 2:3 portrait output at up to 480×720.
 * Falls back to 2:3 at source size, then to portrait if source is wider than tall.
 */
function getPortraitCropParams(vw, vh) {
    const ratio = 2 / 3; // target W:H
    let srcW, srcH;
    if (vw / vh <= ratio) {
        // Narrower than 2:3 (e.g. 9:16): use full width, crop height to 2:3
        srcW = vw;
        srcH = Math.min(vh, Math.round(vw / ratio));
    } else {
        // Wider than 2:3 (landscape or square): use full height, crop width to 2:3
        srcH = vh;
        srcW = Math.round(vh * ratio);
    }
    const srcX = Math.round((vw - srcW) / 2);
    const srcY = Math.round((vh - srcH) / 2);
    // Scale to 480×720 max, never upscale
    const scale = Math.min(1, 480 / srcW, 720 / srcH);
    const dstW  = Math.round(srcW * scale);
    const dstH  = Math.round(srcH * scale);
    return { srcX, srcY, srcW, srcH, dstW, dstH };
}

/** Show 0.2s white flash overlay, then run callback (e.g. before opening share). */
function showPhotoFlashThen(callback) {
    const overlay = document.getElementById('photo-flash-overlay');
    if (overlay) {
        overlay.style.opacity = '1';
        setTimeout(() => {
            overlay.style.opacity = '0';
            if (typeof callback === 'function') callback();
        }, 200);
    } else {
        if (typeof callback === 'function') callback();
    }
}

function capturePhoto() {
    if (!videoEl || !canvasEl) return;

    const vw = videoEl.videoWidth  || 640;
    const vh = videoEl.videoHeight || 480;
    const { srcX, srcY, srcW, srcH, dstW, dstH } = getPortraitCropParams(vw, vh);

    canvasEl.width  = dstW;
    canvasEl.height = dstH;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH);

    showPhotoFlashThen(() => {
        canvasEl.toBlob(async (blob) => {
            if (!blob) return;
            const filename = `vixi-photo-${Date.now()}.jpg`;
            const shared = await tryImmediateShare(blob, filename);
            if (!shared) {
                pendingMedia = { blob, filename };
                showSaveIcon();
            }
        }, 'image/jpeg', 0.92);
    });
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Video Recording (portrait via canvas)                                                                            */
/* --------------------------------------------------------------------------------------------------------------- */
const PORTRAIT_WIDTH = 480;
const PORTRAIT_HEIGHT = 720;
const CAPTURE_FPS = 30;

/** Draw one frame from videoEl to canvas — same as preview (no rotation). Center-crop to 2:3 portrait. */
function drawPortraitFrame() {
    if (!videoEl || !canvasEl || !videoEl.videoWidth) return;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    // Record exactly what is seen: center-crop to 2:3 (no rotation)
    const { srcX, srcY, srcW, srcH } = getPortraitCropParams(vw, vh);
    ctx.drawImage(videoEl, srcX, srcY, srcW, srcH, 0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
}

function videoDrawLoop() {
    if (!isRecording) {
        videoDrawLoopId = null;
        return;
    }
    drawPortraitFrame();
    videoDrawLoopId = requestAnimationFrame(videoDrawLoop);
}

function startVideoRecording() {
    if (isRecording) return;
    if (!videoEl?.srcObject || !canvasEl) return;

    canvasEl.width = PORTRAIT_WIDTH;
    canvasEl.height = PORTRAIT_HEIGHT;
    drawPortraitFrame();

    const canvasStream = canvasEl.captureStream(CAPTURE_FPS);
    let streamToRecord = canvasStream;
    if (getAudioStream) {
        const audioStream = getAudioStream();
        if (audioStream && typeof audioStream.getAudioTracks === 'function') {
            const audioTracks = audioStream.getAudioTracks();
            if (audioTracks && audioTracks.length > 0) {
                const combined = new MediaStream();
                const videoTracks = canvasStream.getVideoTracks();
                if (videoTracks && videoTracks.length > 0) combined.addTrack(videoTracks[0]);
                for (let i = 0; i < audioTracks.length; i++) combined.addTrack(audioTracks[i]);
                streamToRecord = combined;
            }
        }
    }
    const mimeType = pickMimeType();
    try {
        recorder = new MediaRecorder(streamToRecord, mimeType ? { mimeType } : {});
    } catch (_) {
        recorder = new MediaRecorder(streamToRecord);
    }

    recordingChunks = [];
    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordingChunks.push(e.data);
    };
    recorder.onstop = onRecordingStopped;

    recorder.start(100);
    isRecording = true;
    recordingStartTime = Date.now();
    videoDrawLoopId = requestAnimationFrame(videoDrawLoop);

    if (btnEl) btnEl.classList.add('recording-active');
    hideLockZone();
    startArcTimer();
}

function stopVideoRecording() {
    if (!isRecording || !recorder) return;
    clearInterval(recordingTimer);
    recordingTimer = null;
    isRecording = false;
    isLocked = false;
    if (videoDrawLoopId !== null) {
        cancelAnimationFrame(videoDrawLoopId);
        videoDrawLoopId = null;
    }
    recorder.stop();
}

async function onRecordingStopped() {
    const mimeType = recorder?.mimeType || 'video/mp4';
    const ext      = mimeType.includes('webm') ? 'webm' : 'mp4';
    const blob     = new Blob(recordingChunks, { type: mimeType });
    recordingChunks = [];
    const filename = `vixi-recording-${Date.now()}.${ext}`;

    if (shareOnStop) {
        shareOnStop = false;
        // On iOS, blob is ready after async boundary — no user gesture. Show download icon in recording button (recordDownloadColor); user tap opens sheet.
        if (isIOS()) {
            pendingMedia = { blob, filename };
            showSaveIcon();
            return;
        }
        // Non-iOS: try immediate share while gesture may still be valid
        const shared = await tryImmediateShare(blob, filename);
        if (shared) return;
    }

    pendingMedia = { blob, filename };
    showSaveIcon();
}

function pickMimeType() {
    const candidates = ['video/mp4', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Arc Timer                                                                                                       */
/* --------------------------------------------------------------------------------------------------------------- */
function startArcTimer() {
    // Immediately set to full (0 offset = fully drawn)
    setArcProgress(0);

    recordingTimer = setInterval(() => {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        const ratio   = Math.min(elapsed / maxDurationSecs, 1);
        setArcProgress(ratio);

        if (elapsed >= maxDurationSecs) {
            stopVideoRecording();
        }
    }, 100);
}

/**
 * ratio: 0 = full arc (recording just started), 1 = empty arc (time is up).
 */
function setArcProgress(ratio) {
    if (!arcProgressEl) return;
    arcProgressEl.style.strokeDashoffset = ARC_CIRCUMFERENCE * ratio;
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Save Media                                                                                                      */
/* --------------------------------------------------------------------------------------------------------------- */

/**
 * Run when the share sheet has closed (share promise resolved or user cancelled).
 * Schedules resetUI on the next tick so the next photo/recording gets a clean state
 * and the share sheet can open immediately (avoids stale state on iOS).
 */
function scheduleResetAfterShareSheetClosed() {
    console.log('[recording] Share sheet closed, scheduling reset for next capture');
    setTimeout(() => {
        resetUI();
    }, 0);
}

/**
 * Attempt Web Share API immediately (requires active user gesture).
 * Returns true if shared successfully, false if not available or failed.
 */
async function tryImmediateShare(blob, filename) {
    if (!navigator.share) return false;
    // Strip codec params (e.g. "video/webm;codecs=vp9" → "video/webm")
    const mimeType = (blob.type || '').split(';')[0] || 'application/octet-stream';
    const file = new File([blob], filename, { type: mimeType });
    try {
        // Skip canShare() gate — iOS Safari returns false for video files even though
        // share() works fine. Rely on the try/catch instead.
        await navigator.share({ files: [file] });
        // Share sheet closed (user shared). Reset state on next tick so next capture is clean.
        scheduleResetAfterShareSheetClosed();
        return true;
    } catch (err) {
        if (err?.name === 'AbortError') {
            // Share sheet closed (user cancelled). Still reset so next capture is clean.
            scheduleResetAfterShareSheetClosed();
            return true;
        }
        console.warn('Immediate share failed, deferring to save icon:', err);
    }
    return false;
}

/**
 * Invoke share (or download fallback) in the same tick as the user gesture so iOS opens the sheet on first tap.
 * @returns {Promise<boolean>} true if share sheet was used (reset scheduled); false if download fallback was used (caller should reset).
 */
function saveMedia(blob, filename) {
    const mimeType = (blob.type || '').split(';')[0] || 'application/octet-stream';
    const file = new File([blob], filename, { type: mimeType });
    if (navigator.share) {
        // Call share() synchronously (no await) so it runs in the same event turn as the tap.
        return navigator.share({ files: [file] })
            .then(() => {
                scheduleResetAfterShareSheetClosed();
                return true;
            })
            .catch((err) => {
                if (err?.name === 'AbortError') {
                    scheduleResetAfterShareSheetClosed();
                    return true;
                }
                console.warn('[recording] Web Share API failed:', err?.name, err?.message);
                if (isIOS()) throw err;
                console.warn('[recording] Falling back to download (non-iOS)');
                doDownloadFallback(blob, filename);
                return false;
            });
    }
    doDownloadFallback(blob, filename);
    return Promise.resolve(false);
}

function doDownloadFallback(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* --------------------------------------------------------------------------------------------------------------- */
/* UI Helpers                                                                                                      */
/* --------------------------------------------------------------------------------------------------------------- */
function showStopIcon() {
    if (stopIconEl) stopIconEl.style.display = '';
    if (saveIconEl) saveIconEl.style.display = 'none';
}

function hideAllIcons() {
    if (stopIconEl) stopIconEl.style.display = 'none';
    if (saveIconEl) saveIconEl.style.display = 'none';
}

function showSaveIcon() {
    if (stopIconEl) stopIconEl.style.display = 'none';
    if (saveIconEl) saveIconEl.style.display = '';
    if (btnEl)      btnEl.classList.remove('recording-active');
    document.body.classList.add('recording-pending-download');
    try {
        document.dispatchEvent(new CustomEvent('recording-pending-media-shown'));
    } catch (_) {}
}

function hideLockZone() {
    if (lockZoneEl) {
        lockZoneEl.style.display = 'none';
        lockZoneEl.classList.remove('lock-active');
    }
}

/** Show "Share" overlay (iOS two-step). User tap on button opens share sheet. */
function showShareOverlay(blob, filename) {
    hideAllIcons();
    if (btnEl) btnEl.classList.remove('recording-active');
    document.body.classList.add('recording-pending-download');
    const row = document.getElementById('recording-btn-row');
    if (row) row.style.display = 'none';
    if (shareOverlayEl) shareOverlayEl.style.display = 'block';
    if (!shareOverlayBtnEl) return;
    const once = () => {
        shareOverlayBtnEl.removeEventListener('click', once);
        saveMedia(blob, filename)
            .then((usedShare) => {
                hideShareOverlay();
                if (usedShare !== true) resetUI();
            })
            .catch(() => {
                hideShareOverlay();
                resetUI();
            });
    };
    shareOverlayBtnEl.addEventListener('click', once);
}

function hideShareOverlay() {
    if (shareOverlayEl) shareOverlayEl.style.display = 'none';
    const row = document.getElementById('recording-btn-row');
    if (row) row.style.display = 'flex';
}

/** Internal: reset button/UI state and recording state. Optionally invoke pending-cleared callback. */
function doResetUI(invokeClearedCallback) {
    hideShareOverlay();
    if (btnEl) btnEl.classList.remove('recording-active');
    document.body.classList.remove('recording-pending-download');
    hideAllIcons();
    hideLockZone();
    setArcProgress(1);
    isRecording  = false;
    isLocked     = false;
    lockIntent   = false;
    shareOnStop  = false;
    pendingMedia = null;
    recorder     = null;
    recordingChunks = [];
    if (invokeClearedCallback && onPendingMediaClearedCallback) {
        const cb = onPendingMediaClearedCallback;
        onPendingMediaClearedCallback = null;
        cb();
    } else {
        onPendingMediaClearedCallback = null;
    }
}

/**
 * Clear all recording and pending state so the next capture gets a clean flow.
 * Ensures iOS can open the share sheet again on subsequent use (no stale state).
 */
function resetUI() {
    doResetUI(true);
}

/**
 * Dump pending media and reset record button to idle (e.g. when show ends).
 * Does not invoke the onPendingMediaCleared callback. Use when show is locked
 * and we no longer offer download; keeps UI clean without triggering redirect logic.
 */
export function clearPendingMediaAndResetUI() {
    doResetUI(false);
}
