/*
Quick tuning tips
If you see…	                           Raise / Lower
too few flashes	                       Lower sensitivityFactor (1.25 → 1.15) or hpCutoff (300 Hz)
flashes firing on every hi‑hat	       Raise sensitivityFactor or minOff; or revert frameSize to 1024
flashes lagging behind the music	     Smaller frameSize (512) can help; also ensure phone clock ticks match timeline playback (setTimeout isn’t perfect)
*/

/*  torch-worker.js  – beat‑detect → torch timeline (browser worker)  */
self.onmessage = ({ data }) => {
    const { samples, sampleRate, options = {} } = data;
    const timeline = buildTimeline(samples, sampleRate, options);
    self.postMessage(timeline);                 // ← [{torch,duration}, …]
  };
  
  /* ─────────────────────────────────────────────────────────── */
  
  function buildTimeline(
    samples,
    sr,
    {
      /* tweakables */
      frameSize         = 512,   // 512 ≈ 11.6 ms @ 44.1 kHz (finer resolution)
      hpCutoff          = 400,   // Hz – drop sub‑bass
      sensitivityFactor = 1.25,  // < 1.5 → more peaks, > 1.5 → fewer
      alphaEMA          = 0.05,  // dynamic threshold smoothing (0.01–0.1)
      minOff            = 30,    // ms
      minOn             = 20,    // ms
      maxOn             = 120    // ms
    } = {}
  ) {
    /* 1. high‑pass ---------------------------------------------------- */
    const hp = highpass(samples, sr, hpCutoff);
  
    /* 2. per‑frame RMS envelope -------------------------------------- */
    const rms  = frameRMS(hp, frameSize);
    const maxE = Math.max(...rms);
    const norm = rms.map(e => e / maxE);          // 0‑1
  
    /* 3. dynamic threshold + local‑max peak pick --------------------- */
    const peaks = [];
    let ema = norm[0];
    for (let i = 1; i < norm.length - 1; i++) {
      ema = alphaEMA * norm[i] + (1 - alphaEMA) * ema;
      const thr = ema * sensitivityFactor;
      if (norm[i] > thr && norm[i] >= norm[i - 1] && norm[i] >= norm[i + 1]) {
        peaks.push({ idx: i, strength: norm[i] });
      }
    }
  
    /* 4. build torch timeline ---------------------------------------- */
    const frameDurMs = (frameSize / sr) * 1000;
    const timeline   = [];
    let cursorMs     = 0;
  
    const addSeg = (torch, dur) => {
      dur = Math.round(dur);
      if (dur <= 0) return;
      const last = timeline[timeline.length - 1];
      if (last && last.torch === torch) last.duration += dur;
      else timeline.push({ torch, duration: dur });
      cursorMs += dur;
    };
  
    peaks.forEach(({ idx, strength }) => {
      const tMs    = idx * frameDurMs;
      const offDur = tMs - cursorMs;
      if (offDur >= minOff) addSeg(false, offDur);
  
      const onDur  = Math.max(minOn,
                      Math.min(maxOn,
                        minOn + strength * (maxOn - minOn)));
      addSeg(true, onDur);
    });
  
    /* tail‑end off */
    const totalMs = (samples.length / sr) * 1000;
    if (totalMs - cursorMs > 0) addSeg(false, totalMs - cursorMs);
  
    return timeline;
  }
  
  /* ───── helper DSP utils ───── */
  
  function highpass(buf, sr, fc) {
    const out   = new Float32Array(buf.length);
    const RC    = 1 / (2 * Math.PI * fc);
    const dt    = 1 / sr;
    const alpha = RC / (RC + dt);
    let yPrev = 0, xPrev = buf[0];
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      const y = alpha * (yPrev + x - xPrev);
      out[i]  = y;
      yPrev   = y;
      xPrev   = x;
    }
    return out;
  }
  
  function frameRMS(buf, size) {
    const out = [];
    for (let i = 0; i < buf.length; i += size) {
      let sum = 0;
      const len = Math.min(size, buf.length - i);
      for (let j = 0; j < len; j++) sum += buf[i + j] ** 2;
      out.push(Math.sqrt(sum / len));
    }
    return out;
  }
  