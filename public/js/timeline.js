import { setTorch } from './camera-torch-access.js';
import { getDeviceInfo, isAndroid } from './device-info.js';
import { log } from './user.js';

let intervals = [];
let timeouts = [];
let timers = [];

let device = null;
let joined = false;

const ANDROID_DELAY_MS = 100
const ANDROID_TORCH_DURATION_AVG_MS = 13
const INITAL_ANDROID_DELAY_MS = ANDROID_DELAY_MS + ANDROID_TORCH_DURATION_AVG_MS;
getDeviceInfo().catch(() => null)

const currentTimeline = {
    loopDuration: 0,
    looping: false,
    maxLoops: Infinity,
    timeline: [],
    startTime: 0,
    sentAt: 0,
    name: '',
    offset: 0,
    torchDelay: isAndroid() ? INITAL_ANDROID_DELAY_MS : 0,
    five_delays: [INITAL_ANDROID_DELAY_MS],
}
const applyInitialOffsets = () => {
  if (isAndroid()) {
    currentTimeline.torchDelay = INITAL_ANDROID_DELAY_MS;
    currentTimeline.five_delays = [INITAL_ANDROID_DELAY_MS]
  }
}

applyInitialOffsets();

const bg = document.getElementById('background-container')

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && joined && currentTimeline.timeline.length > 0) {
      try { playFromCurrentPosition(); } catch {}
    }
});
window.addEventListener('focus', () => { if (joined && currentTimeline.timeline.length > 0) playFromCurrentPosition(); });


// How far ahead of the target start we should trigger the torch.
// We clamp just to avoid wild values from a noisy first sample.
const MAX_TORCH_LEAD_MS = 60; // tune if you like
function getTorchLeadMs() {
  //const d = Number(currentTimeline.torchDelay || 0);
  //if (!isFinite(d) || d < 0) return 0;
  //return Math.min(d, MAX_TORCH_LEAD_MS);
  return 0;
}

function normalizeTimeline(list, anchorStart) {
    //console.log('### Normalizing timeline: ', list);
    //console.log('### Anchor Start: ', anchorStart);
    if (!Array.isArray(list)) {
      console.warn('### normalizeTimeline expected an array, got:', typeof list);
      return [];
    }
    return list.map((s, i) => ({
      ...s,
      index: i,
      startOffset: s.start - anchorStart,
      endOffset:   s.end   - anchorStart,
      duration:    s.end - s.start
    }));
}

export async function onTimeline(data, joinedState, DEBUG_MODE_ENABLED = true, deviceType) {
    //console.log('### PLAYING TIMELINE', data);
    device = deviceType;
    joined = joinedState;

    //console.log('### Joined: ', joined);
    //console.log('### DEBUG_MODE_ENABLED: ', DEBUG_MODE_ENABLED);
    //console.log('### Device Type: ', device);
    //console.log('### Data: ', data);

   // If joined or if DEBUG_MODE_ENABLED is true
    if (joined || DEBUG_MODE_ENABLED) {
        // Bail out of any current process (intervals/timeouts/timers) before restarting
        try { clearAllIntervalsAndTimeouts(); } catch (_) {}

        currentTimeline.loopDuration = data.timeline.loopDuration;
        // Ensure we pass the segments array to normalizeTimeline
        const segments = Array.isArray(data.timeline?.timeline) ? data.timeline.timeline : (Array.isArray(data.timeline) ? data.timeline : []);
        currentTimeline.timeline = normalizeTimeline(segments, data.timeline.startTime);
        //console.log('### Normalized Timeline: ', currentTimeline.timeline);
        currentTimeline.looping = Boolean(data.timeline?.loop);
        if (Number.isFinite(data.timeline?.maxLoops)) currentTimeline.maxLoops = data.timeline.maxLoops;
        currentTimeline.startTime = data.timeline.startTime;
        currentTimeline.sentAt = data.sentAt;
        currentTimeline.name = data.timeline.name;
    
        const torchActionTime = performance.now(); // time of torch action

        console.log('### Now Playing: ', currentTimeline.name);

        if (data.timeline.name === 'on') {
            const result = await setTorch(true);
            // get the average torch delay based on all the previous torch delay + the current torch delay / 2
            // if the previous torch delay is 0, then just use the current torch delay
            if (currentTimeline.torchDelay === 0) {
                currentTimeline.torchDelay = (performance.now() - torchActionTime);
            } else {
                currentTimeline.torchDelay = (currentTimeline.torchDelay + (performance.now() - torchActionTime)) / 2;
            }

            if (!result.ok)
                console.warn('### Error setting torch (on): ', result.error);
            return;
        } else if (data.timeline.name === 'off') {
            const result = await setTorch(false);
            if (currentTimeline.torchDelay === 0) {
                currentTimeline.torchDelay = (performance.now() - torchActionTime);
            } else {
                currentTimeline.torchDelay = (currentTimeline.torchDelay + (performance.now() - torchActionTime)) / 2;
            }

            if (!result.ok)
                console.warn('### Error setting torch (off): ', result.error);
            return;
        } else {
            currentTimeline.offset = Date.now() - data.sentAt; //diff btween server send and client now
            playFromCurrentPosition(); // play from current position
        }
    } else {
        console.warn('### NOT JOINED, NOT PLAYING TIMELINE');
    }
};

/* Clear all intervals */
export function clearAllIntervalsAndTimeouts() {
    intervals.forEach(interval => clearInterval(interval));
    intervals = [];
    timeouts.forEach(timeout => clearTimeout(timeout));
    timeouts = [];
    timers.forEach(timer => clearTimeout(timer));
    timers = [];
    currentTimeline.loopDuration = 0;
    currentTimeline.looping = false;
    currentTimeline.maxLoops = Infinity;
    currentTimeline.timeline = [];
    currentTimeline.startTime = 0;
    currentTimeline.sentAt = 0;
    currentTimeline.offset = 0;
    currentTimeline.torchDelay = 0;
    applyInitialOffsets()
}
  
  /* timeline handlers */
const mod = (x, m) => ((x % m) + m) % m;

  /* Core playback */
function playFromCurrentPosition() {
    // Clear current timers
    timers.forEach(clearTimeout);
    timers.length = 0;
  
    if (currentTimeline.loopDuration <= 0 || !currentTimeline.timeline.length) {
      console.warn("Invalid loopDuration or empty timeline");
      return;
    }
  
    const lead = getTorchLeadMs();
    // serverNow tells us where to start playing from
    const serverNow = currentTimeline.startTime + currentTimeline.offset + Date.now();
    // if not started yet, wait until the first segment starts
    const totalElapsed = serverNow - currentTimeline.startTime;
    if (totalElapsed < 0) {
      const delay = Math.max(0, currentTimeline.startTime - serverNow) - lead;
      timers.push(setTimeout(playFromCurrentPosition, delay));
      return;
    }

    // calculate how many loops have been done & check if we should stop
    const loopsDone = Math.floor(totalElapsed / currentTimeline.loopDuration);
    if (!currentTimeline.looping && loopsDone >= currentTimeline.maxLoops) return;
  
    // Normalize position in loop to [0, loopDuration)
    const posInLoop = mod(totalElapsed, currentTimeline.loopDuration);
  
    // Find active segment using relative offsets
    let segIdx = currentTimeline.timeline.findIndex(s =>
      posInLoop >= s.startOffset && posInLoop < s.endOffset
    );
  
    // If exactly at the loop end boundary, jump to first segment
    if (segIdx === -1 && posInLoop === 0) segIdx = 0;
  
    // If no segment (gap), schedule to the next segment start (early by 'lead')
    if (segIdx === -1) {
      // Find the next segment start in this loop
      const nextInLoop = currentTimeline.timeline.find(s => s.startOffset > posInLoop);
      let targetAbs;
      if (nextInLoop) {
        targetAbs = currentTimeline.startTime + loopsDone * currentTimeline.loopDuration + nextInLoop.startOffset;
      } else {
        // No more segments in this loop — go to next loop's first segment
        targetAbs = currentTimeline.startTime + (loopsDone + 1) * currentTimeline.loopDuration + currentTimeline.timeline[0].startOffset;
      }
      const delay = Math.max(0, targetAbs - serverNow) - lead;
      timers.push(setTimeout(playFromCurrentPosition, delay));
      return;
    }
  
    const seg = currentTimeline.timeline[segIdx];
    const timeIntoSeg   = posInLoop - seg.startOffset;
    const timeLeftInSeg = seg.duration - timeIntoSeg;
  
    // Enter current segment immediately
    applyEffect(seg, timeLeftInSeg);
  
    // Schedule rest of this loop at absolute times (early by 'lead')
    for (let i = segIdx + 1; i < currentTimeline.timeline.length; i++) {
      const targetAbs = currentTimeline.startTime + loopsDone * currentTimeline.loopDuration + currentTimeline.timeline[i].startOffset;
      //const delay     = Math.max(0, targetAbs - (Date.now() + (offset ?? 0)));
      const delay     = Math.max(0, targetAbs - serverNow) - lead;
      timers.push(setTimeout(() => applyEffect(currentTimeline.timeline[i], currentTimeline.timeline[i].duration), delay));
    }
  
    // Queue the next loop start if needed (absolute scheduling)
    if (currentTimeline.looping && loopsDone + 1 < currentTimeline.maxLoops) {
      const nextLoopAbs = currentTimeline.startTime + (loopsDone + 1) * currentTimeline.loopDuration + currentTimeline.timeline[0].startOffset;
      const delay       = Math.max(0, nextLoopAbs - serverNow) - lead;
      timers.push(setTimeout(playFromCurrentPosition, delay));
    }
  
    // Ensure OFF during end-of-loop gaps (if any)
    const lastSeg = currentTimeline.timeline[currentTimeline.timeline.length - 1];
    if (lastSeg?.torch && lastSeg.endOffset < currentTimeline.loopDuration) {
      const offAtAbs    = currentTimeline.startTime + loopsDone * currentTimeline.loopDuration + lastSeg.endOffset;
      const offDelay    = Math.max(0, offAtAbs - serverNow) - lead;
      timers.push(setTimeout(() => { setTorch(false).catch(() => {}); }, offDelay));
    }
}

/* Do the thing */
async function applyEffect(segment, remainingDuration = 0) {
    try {

      const applyStartPerf = performance.now();
      /*
      log({
        'action': 'applyEffect',
        'remaingeffectDuration': remainingDuration,
        'torchDelay': currentTimeline.torchDelay,
        'now': applyStartPerf,
        'segment': segment,
      });
      */
      const result = await setTorch(segment.torch);
      // Enable to visualize the trigger time.
      // new Promise((r) => {
      //   setTimeout(() => {
      //     bg.style.background = segment.torch === true ? '#fff' : '#000'
      //     r()
      //   }, 100
      // )
      // })
        if (result.ok) {
          currentTimeline.five_delays = [
              ...currentTimeline.five_delays.slice(-5),
              (performance.now() - applyStartPerf)
          ]

          currentTimeline.torchDelay = 
            currentTimeline.five_delays.reduce((p, c) => p + c, 0) / 
              currentTimeline.five_delays.length + 
            (isAndroid() ? ANDROID_DELAY_MS : 0 );

          console.log('### setTorch delay: ', currentTimeline.torchDelay);
        } else {
            console.warn('### Error setting torch: ', result.error);
        }
        /*
        log({
            'type': 'torch-applyEffect',
            'action': 'error - failed',
            'error': result.error,
            'at': Date.now(),
            'device': device || 'Unknown device',
            'torch': segment.torch,
            'delay': currentTimeline.torchDelay
        });
        */
    } catch (_) { 
        console.warn('### Error applying effect: ', _);
        /*
        log({
            'type': 'torch-applyEffect',
            'action': 'error - catch',
            'error': _,
            'at': Date.now(),
            'device': device || 'Unknown device',
            'torch': segment.torch,
            'delay': currentTimeline.torchDelay
        });
        */
    }
  }