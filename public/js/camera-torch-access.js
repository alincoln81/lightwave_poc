// camera-torch-access.js
import { getDeviceInfo } from './device-info.js';

// ---------- State ----------
let stream = null;
let track  = null;
let starting = false;
let requestMic = false;

// Expose current track and stream for read-only needs
export function getCurrentTrack() { return track; }
export function getCameraStream() { return stream; }

// Torch helper the rest of the app can use
export async function setTorch(on) {
  if (!track) return {ok: false, error: 'No track'};
  try {
    const caps = track.getCapabilities?.() || {};
    if (!caps.torch) return {ok: false, error: 'No torch'};
    await track.applyConstraints({ advanced: [{ torch: !!on }] });
    return {ok: true, error: null};
  } catch {
    return {ok: false, error: 'Failed to set torch'};
  }
}

export async function leaveTorchFlow() {
  try {
    if (track) {
      track.applyConstraints?.({ advanced: [{ torch: false }] }).catch(()=>{});
    }
  } catch {}
  try {
    stream?.getTracks?.().forEach(t => t.stop());
  } catch {}
  stream = null;
  track  = null;
}

// ---------- Internals ----------
const hasMedia = () => !!(navigator.mediaDevices?.getUserMedia);

// Preferred resolution/framerate for recording quality.
// Using 'ideal' so the browser negotiates the closest match without throwing.
const VIDEO_HINTS = {
    width:     { ideal: 1920, max: 1920 },
    height:    { ideal: 1080, min: 1080 },
    frameRate: { ideal: 60, min: 24 }
};
// For retry when stream comes back landscape: request with width/height constraints swapped.
const VIDEO_HINTS_FLIPPED = {
    width:     { ideal: 1080, min: 1080 },
    height:    { ideal: 1920, max: 1920 },
    frameRate: VIDEO_HINTS.frameRate
};
const canEnumerate = () => !!(navigator.mediaDevices?.enumerateDevices);

/**
 * Get the actual width/height of the stream by playing it in a temporary video element.
 * Call before attaching; if width > height we ditch the stream and retry with VIDEO_HINTS_FLIPPED.
 */
async function getStreamDimensions(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  try {
    await video.play();
  } catch {}
  await new Promise((resolve) => {
    const done = () => resolve();
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      done();
      return;
    }
    video.addEventListener('loadedmetadata', done, { once: true });
    video.addEventListener('loadeddata', done, { once: true });
    setTimeout(done, 3000);
  });
  const width = video.videoWidth || 0;
  const height = video.videoHeight || 0;
  video.srcObject = null;
  return { width, height };
}

const hasTorch = (t) => {
  try { return !!t.getCapabilities?.().torch; } catch { return false; }
};

function cameraPositionOf(t) {
  try {
    const facing = (t?.getSettings?.().facingMode || '').toString();
    if (/environment|rear|back/i.test(facing)) return 'rear';
    if (/user|front|face/i.test(facing)) return 'front';
  } catch {}
  const label = (t?.label || '').toString();
  if (/back|rear|environment/i.test(label)) return 'rear';
  if (/front|user|face/i.test(label)) return 'front';
  return 'unknown';
}

/** Read actual resolution and frame rate from the track for server logging. */
function getTrackCaptureSettings(t) {
  if (!t) return null;
  try {
    const s = t.getSettings?.() || {};
    return {
      width: s.width ?? null,
      height: s.height ?? null,
      frameRate: s.frameRate ?? null,
      deviceId: s.deviceId ?? null,
      facingMode: s.facingMode ?? null,
      label: (t.label != null && t.label !== '') ? t.label : null
    };
  } catch {
    return null;
  }
}

function attach(s) {
  stream = s;
  track = s.getVideoTracks?.()[0] || null;
}

async function enableTorchNow() {
  if (!track) return false;
  if (!hasTorch(track)) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: true }] });
    return true;
  } catch {
    return false;
  }
}

async function tryDirectEnvTorch() {
  let s = null;
  let strategy = 'direct-env+torch';
  let resolutionFlipped = false;
  const hintsList = [VIDEO_HINTS, VIDEO_HINTS_FLIPPED];
  for (const hints of hintsList) {
    try {
      s = await navigator.mediaDevices.getUserMedia({
        video: { ...hints, facingMode: { exact: 'environment' }, advanced: [{ torch: true }] },
        audio: requestMic
      });
    } catch {
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: { ...hints, facingMode: { ideal: 'environment' }, advanced: [{ torch: true }] },
          audio: requestMic
        });
      } catch {
        try {
          s = await navigator.mediaDevices.getUserMedia({
            video: { ...hints, facingMode: { exact: 'user' }, advanced: [{ torch: true }] },
            audio: requestMic
          });
          strategy = 'direct-user+torch';
        } catch { /* no stream */ }
      }
    }
    if (!s) continue;
    const dims = await getStreamDimensions(s);
    if (dims.width > dims.height) {
      if (hints === VIDEO_HINTS_FLIPPED) break;
      s.getTracks().forEach((t) => t.stop());
      s = null;
      continue;
    }
    if (hints === VIDEO_HINTS_FLIPPED) resolutionFlipped = true;
    break;
  }
  if (s) attach(s);
  const torchOn = await enableTorchNow();
  const cameraPosition = cameraPositionOf(track);
  return { strategy, torchOn, cameraPosition, resolutionFlipped };
}

async function tryEnvThenEnable() {
  let s = null;
  let strategy = 'env-then-enable';
  let resolutionFlipped = false;
  const hintsList = [VIDEO_HINTS, VIDEO_HINTS_FLIPPED];
  for (const hints of hintsList) {
    try {
      s = await navigator.mediaDevices.getUserMedia({
        video: { ...hints, facingMode: { exact: 'environment' } },
        audio: requestMic
      });
    } catch {
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: { ...hints, facingMode: { ideal: 'environment' } },
          audio: requestMic
        });
      } catch {
        try {
          s = await navigator.mediaDevices.getUserMedia({
            video: { ...hints, facingMode: { exact: 'user' } },
            audio: requestMic
          });
          strategy = 'user-then-enable';
        } catch { /* no stream */ }
      }
    }
    if (!s) continue;
    const dims = await getStreamDimensions(s);
    if (dims.width > dims.height) {
      if (hints === VIDEO_HINTS_FLIPPED) break;
      s.getTracks().forEach((t) => t.stop());
      s = null;
      continue;
    }
    if (hints === VIDEO_HINTS_FLIPPED) resolutionFlipped = true;
    break;
  }
  if (s) attach(s);
  const torchOn = await enableTorchNow();
  const cameraPosition = cameraPositionOf(track);
  return { strategy, torchOn, cameraPosition, resolutionFlipped };
}

async function tryEnumerateTorchCapable() {
  if (!canEnumerate()) throw new Error('enumerateDevices unsupported');

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === 'videoinput').sort((a,b) => {
    const ab = /back|rear|environment/i.test(a.label || '');
    const bb = /back|rear|environment/i.test(b.label || '');
    return (bb - ab);
  });

  for (const cam of cams) {
    const hintsList = [VIDEO_HINTS, VIDEO_HINTS_FLIPPED];
    for (const hints of hintsList) {
      try {
        let s = await navigator.mediaDevices.getUserMedia({
          video: { ...hints, deviceId: { exact: cam.deviceId } },
          audio: requestMic
        });
        const t = s.getVideoTracks()[0];
        if (!t) { s.getTracks().forEach(x=>x.stop()); continue; }
        if (!hasTorch(t)) { s.getTracks().forEach(x=>x.stop()); continue; }
        const dims = await getStreamDimensions(s);
        if (dims.width > dims.height && hints === VIDEO_HINTS) {
          s.getTracks().forEach((x) => x.stop());
          continue;
        }
        attach(s);
        const torchOn = await enableTorchNow();
        const cameraPosition = cameraPositionOf(track);
        const resolutionFlipped = (hints === VIDEO_HINTS_FLIPPED);
        return { strategy: 'enumerate-torch-capable', torchOn, cameraPosition, resolutionFlipped };
      } catch { /* keep trying */ }
    }
  }
  throw new Error('No torch-capable cameras found');
}

async function recordAttempt(success, extra = {}) {
  try {
    const device = await getDeviceInfo();
    const payload = { success, device, ...extra };
    //success ? console.info('torch access result', payload)
    //        : console.error('failed to get access', payload);

    // Optional: central telemetry
  } catch {
    success ? console.info('torch access result (device info unavailable)', extra)
            : console.error('failed to get access (device info unavailable)', extra);
  }
}

function getMicGranted() {
  if (!requestMic || !stream) return false;
  const tracks = stream.getAudioTracks && stream.getAudioTracks();
  return !!(tracks && tracks.length > 0);
}

// ---------- Public: start flow ----------
export async function startTorchFlow(options) {
  requestMic = options && options.requestMic === true;

  // If a start is already in progress, wait briefly so we can reuse any stream once available
  if (starting && !stream) {
    await new Promise(r => setTimeout(r, 100));
  }

  // If we already have an active stream/track, treat as connected (idempotent)
  if (stream && track) {
    const device = await getDeviceInfo().catch(() => null);
    let torchOn = false;
    try { torchOn = await enableTorchNow(); } catch {}
    const hasCam = true;
    const hasTch = hasTorch(track);
    const cameraPosition = cameraPositionOf(track);
    const captureSettings = getTrackCaptureSettings(track);
    const out = {
      ok: true,
      device,
      message: 'Already connected',
      strategy: 'already-connected',
      hasCamera: hasCam,
      hasTorch: hasTch,
      cameraPosition,
      captureSettings,
      resolutionFlipped: false,
      attempts: [{ step: 'already-connected', ok: true, details: { torchOn } }]
    };
    if (requestMic) out.micGranted = getMicGranted();
    return out;
  }

  if (!hasMedia()) {
    await recordAttempt(false, {
      message: 'MediaDevices.getUserMedia not supported',
      attempts: []
    });
    const device = await getDeviceInfo().catch(() => null);
    return {
      ok: false,
      device,
      message: 'MediaDevices.getUserMedia not supported',
      strategy: null,
      hasCamera: false,
      hasTorch: false,
      attempts: []
    };
  }

  starting = true;
  const attempts = [];
  try {
    try {
      const r1 = await tryDirectEnvTorch();
      const ok1 = !!track && !!r1.torchOn;
      attempts.push({ step: r1.strategy, ok: ok1, details: { torchOn: r1.torchOn } });
      const device1 = await getDeviceInfo();
      const message1 = ok1 ? 'Connected' : 'Camera connected but torch unavailable';
      const captureSettings1 = getTrackCaptureSettings(track);
      await recordAttempt(ok1, { message: message1, strategy: r1.strategy, hasCamera: !!track, hasTorch: !!r1.torchOn, cameraPosition: r1.cameraPosition, captureSettings: captureSettings1, attempts });
      if (ok1) {
        const out1 = { ok: true, device: device1, message: message1, strategy: r1.strategy, hasCamera: !!track, hasTorch: !!r1.torchOn, cameraPosition: r1.cameraPosition, captureSettings: captureSettings1, resolutionFlipped: r1.resolutionFlipped, attempts };
        if (requestMic) out1.micGranted = getMicGranted();
        return out1;
      }
      await leaveTorchFlow();
    } catch (e1) {
      attempts.push({ step: 'direct-env+torch', ok: false, error: String(e1) });
      await leaveTorchFlow();
    }

    try {
      const r2 = await tryEnvThenEnable();
      const ok2 = !!track && !!r2.torchOn;
      attempts.push({ step: r2.strategy, ok: ok2, details: { torchOn: r2.torchOn } });
      const device2 = await getDeviceInfo();
      const message2 = ok2 ? 'Connected' : 'Camera connected but torch unavailable';
      const captureSettings2 = getTrackCaptureSettings(track);
      await recordAttempt(ok2, { message: message2, strategy: r2.strategy, hasCamera: !!track, hasTorch: !!r2.torchOn, cameraPosition: r2.cameraPosition, captureSettings: captureSettings2, attempts });
      if (ok2) {
        const out2 = { ok: true, device: device2, message: message2, strategy: r2.strategy, hasCamera: !!track, hasTorch: !!r2.torchOn, cameraPosition: r2.cameraPosition, captureSettings: captureSettings2, resolutionFlipped: r2.resolutionFlipped, attempts };
        if (requestMic) out2.micGranted = getMicGranted();
        return out2;
      }
      await leaveTorchFlow();
    } catch (e2) {
      attempts.push({ step: 'env-then-enable', ok: false, error: String(e2) });
      await leaveTorchFlow();
    }

    try {
      const r3 = await tryEnumerateTorchCapable();
      const ok3 = !!track && !!r3.torchOn;
      attempts.push({ step: r3.strategy, ok: ok3, details: { torchOn: r3.torchOn } });
      const device3 = await getDeviceInfo();
      const message3 = ok3 ? 'Connected' : 'Camera connected but torch unavailable';
      const captureSettings3 = getTrackCaptureSettings(track);
      await recordAttempt(ok3, { message: message3, strategy: r3.strategy, hasCamera: !!track, hasTorch: !!r3.torchOn, cameraPosition: r3.cameraPosition, captureSettings: captureSettings3, attempts });
      if (ok3) {
        const out3 = { ok: true, device: device3, message: message3, strategy: r3.strategy, hasCamera: !!track, hasTorch: !!r3.torchOn, cameraPosition: r3.cameraPosition, captureSettings: captureSettings3, resolutionFlipped: r3.resolutionFlipped, attempts };
        if (requestMic) out3.micGranted = getMicGranted();
        return out3;
      }
    } catch (e3) {
      attempts.push({ step: 'enumerate-torch-capable', ok: false, error: String(e3) });
    }

    // Exhausted all
    await leaveTorchFlow();
    const device = await getDeviceInfo();
    const message = 'Failed to connect to camera and/or torch after all strategies.';
    await recordAttempt(false, { message, attempts });
    return { ok: false, device, message, strategy: null, hasCamera: false, hasTorch: false, attempts };
  } finally {
    starting = false;
  }
}
