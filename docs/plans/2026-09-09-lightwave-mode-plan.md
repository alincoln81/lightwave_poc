# Feature Implementation — Lightwave Mode

> Single artifact for design through ship. Update one section at a time. Record every phase approval and substantive edit in **Section H — Changelog**.

| Field | Value |
|---|---|
| **Artifact path** | `docs/plans/2026-09-09-lightwave-mode-plan.md` |
| **Status** | Draft Design |
| **Owner** | Amber |
| **Created** | 2026-09-09 |
| **Last updated** | 2026-09-09 |

---

## A - Design

> `/design` owns this section. Complete Section A before requesting design approval.

### A.1 Summary

**Working title:** Lightwave Mode

Add a producer-controlled **Lightwave** mode to the existing Vixi LightShow participant app. When Lightwave is on, joined phones still use the current camera / torch / microphone join path, then use motion sensors to detect whether the phone is at eye level or lower versus raised above the head. A producer-triggered wave walks occupied section numbers from lowest to highest; each section sees a **Raise phone in 3, 2, 1, GO** countdown, and the torch turns on only while the arm is raised, for at most two seconds or until the arm lowers, whichever comes first. When Lightwave is off, the existing audio-timeline lightshow flow is unchanged.

All new Lightwave scripts, socket events, settings keys, DOM ids, and CSS hooks use an `lw_` prefix so the feature stays visually and technically distinct from the original lightshow.

### A.2 Purpose & success

**Why:** Event spaces want a visible stadium-style “wave” of phone flashlights that travels section by section. The current app already syncs torches to audio programs; it does not cue people to raise their phones or gate the torch on pose. Manual section entry is reliable; automatic geo-assignment is attractive but likely too inaccurate for section-level mapping in a web app (see Architecture — Location options).

**Success looks like:**

- Producer can turn Lightwave **on** or **off**. Off = today’s lightshow. On = Lightwave cues and pose-gated torch only.
- After join, a participant is assigned a section (typed, or prefilled from a URL / QR) and waits for the wave.
- When their section’s cue arrives, the screen shows **Raise phone in 3 → 2 → 1 → GO**.
- Raising the phone above eye level turns the torch on; lowering it turns the torch off immediately. The torch never stays on longer than **2 seconds** per cue.
- Occupied sections fire in ascending section order so the venue reads as a traveling wave.
- New Lightwave code lives in `lw_*` modules; existing `timeline.js` / `torch-worker.js` lightshow playback is not rewritten.

### A.3 In scope

| Item | Notes |
|---|---|
| Lightwave mode toggle | Producer setting `mode: 'lightwave'` vs `mode: 'default'` (field already exists on settings). When `lightwave`, participant ignores `play` timelines. |
| Existing join permissions | Reuse current camera / torch / mic join (`startTorchFlow`). Do not invent a second permission path. |
| Pose detection | Device motion / orientation (accelerometer + gravity). Classify **lowered** (eye level or below) vs **raised** (arm above head). |
| Pose-gated torch | Torch on only during the active GO window **and** while raised; max `lw_torchMaxMs` (default 2000); off on lower or timeout. |
| Section assignment | Required numeric (or numeric-leading) section id. Manual entry after join. Prefill from `?lw_section=` query / QR. Optional GPS **hint** the user can confirm — not silent auto-assign. |
| Wave orchestration | Producer Start / Stop Wave. Server schedules unique **occupied** sections low → high. Each client gets a personal `goAt` and runs a local countdown. |
| Countdown UI | Large, high-contrast participant overlay: “Raise phone in 3”, “2”, “1”, “GO”, then “Raise your phone!” during the torch window. |
| Producer Lightwave card | Enable mode, wave timing controls, Start / Stop, live occupied-section counts. |
| `lw_` isolation | New files `public/js/lw_*.js`, `src/styles/lw_*.scss`, socket events `lw_*`, settings `lw_*`, DOM `lw_*`. Thin hooks only in `user.js`, `producer.js`, `app.js`, `database.js`, HTML. |
| Sensor-denied fallback | If motion permission is denied or unavailable, GO still flashes the torch for up to 2s (no pose gate) so the wave still reads from the stands. |

### A.4 Out of scope

| Non-goal | Reason |
|---|---|
| Silent GPS / indoor auto-section assignment | Browser geolocation is not accurate enough for stadium/arena section IDs (see Location options). Defer true auto-assign. |
| Camera-based pose / ML (MediaPipe, face, sky detection) | Rear camera is already held for torch; overhead “sky vs crowd” is unreliable at night; extra battery and privacy cost. Revisit only if accelerometer fails in field tests. |
| BLE / Ultra-Wideband / Wi-Fi RTT beacons | Not usable on iOS Safari web apps. Native app territory. |
| Ticket / barcode / CRM seat lookup | Needs venue ticket APIs. Later phase if a partner provides section-from-ticket. |
| Rewriting audio lightshow DSP or `timeline.js` | Lightwave is a mode, not a replacement of beat-synced programs. |
| Simultaneous Lightwave + audio program playback | Mutually exclusive. Playing a program while Lightwave is on is disabled / ignored. |
| Venue-specific SVG seating maps for this pass | Nice UX; add later as a tap-to-confirm overlay once one venue map exists. |
| Changing the existing join / lock / recording / end-card flows except where mode requires it | Preserve current lightshow when mode is off. Recording may remain available if already enabled; it is not part of the wave. |

### A.5 Behavior

**Rules / outcomes**

1. **Mode gate.** `settings.mode === 'lightwave'` enables Lightwave on all joined participants for that deployment token. `settings.mode === 'default'` (or any other value) keeps today’s lightshow. Mode is set by the producer and synced through the existing settings channel.
2. **Join is unchanged.** Participants still tap Join, grant camera / torch (and mic if `requestMic`). Lightwave starts only after a successful torch connect.
3. **Section is required in Lightwave.** After join, the participant must have an `lw_section`. Sources, in order: URL `lw_section` query → last value stored for this token in `sessionStorage` → manual entry. They cannot receive a wave cue without a section.
4. **Section identity.** Sections are strings that sort **numerically** when they parse as numbers (`101` before `102` before `110`). Optional letter suffix is allowed (`142A`) and sorts after the same number without a suffix. Empty sections (no joined users) are **skipped** so the wave does not stall.
5. **Wave direction.** Lowest occupied section fires first; then the next occupied section; through the highest. Producer Start Wave creates one pass. Stop Wave cancels pending countdowns and forces torch off.
6. **Per-section timing.** Each occupied section is assigned `goAt = waveEpoch + (index * lw_sectionDelayMs)`. Countdown length is `lw_countdownSeconds` (default 3). The client starts the visible countdown at `goAt - countdownMs`. Stagger default **400 ms** so adjacent sections overlap slightly and the stands read as a ripple, not a stop-motion queue.
7. **Torch gate.** Torch turns **on** only when (a) the local GO window is active and (b) pose is **raised** (or the sensor-denied fallback is in effect). Torch turns **off** when the arm lowers, when 2 seconds have elapsed since torch-on, or when the GO window ends — whichever comes first. Raising early (before GO) does not light the torch. Raising after the window ends does not light the torch.
8. **Pose classifier.** Use `DeviceMotionEvent` gravity / `accelerationIncludingGravity` (and `DeviceOrientationEvent` as a supporting signal). **Lowered:** phone roughly upright in front of the body (eye / chest). **Raised:** phone inverted or held overhead (typical flashlight-to-the-sky pose). Use hysteresis so bouncing in the seats does not flicker the torch. iOS requires `DeviceMotionEvent.requestPermission()` / `DeviceOrientationEvent.requestPermission()` from a user gesture (the Join tap or a short “Enable motion” tap).
9. **Camera is not used for pose in this design.** Accelerometer / orientation is the source of truth. Camera remains what it is today: torch + optional recording.
10. **Clock sync.** Cues include server `sentAt` / `goAt` using the same style as existing `play` payloads so clients can compensate for travel delay. Countdown is computed locally from `goAt`, not from a server tick every second.
11. **Lightshow isolation.** While Lightwave is on, incoming `play` timeline events are ignored by the participant. Producer Play Program is disabled or no-ops. Switching mode off mid-wave stops Lightwave and restores lightshow behavior.
12. **Naming.** Every new module, event, setting, and test hook is prefixed `lw_`. Existing lightshow identifiers are not renamed.

**Happy path**

1. Producer opens the deployment, sets mode to Lightwave, optionally adjusts countdown / stagger / torch max, saves settings.
2. Participants open `/go/i/{token}` (optionally `?lw_section=142` from a posted QR). They join and grant camera / torch (/ mic). Motion permission is requested in the same gesture when required.
3. If section is missing, they enter it (e.g. `142`) and confirm. Screen shows waiting copy (“You’re in section 142. Get ready.”).
4. Producer presses **Start Wave**.
5. Server lists occupied sections, sorts ascending, assigns `goAt` values, emits `lw_wave-cue` to each participant.
6. A participant in the first section sees 3, 2, 1, GO, raises their phone; torch lights up to 2 seconds or until they lower their arm.
7. ~400 ms later the next occupied section’s GO lands, and so on, producing a visible wave.
8. Producer can Start Wave again for another pass, or turn mode off to return to the normal lightshow.

**Integration touchpoints**

- Existing Socket.IO rooms keyed by deployment `token` (`server/app.js`).
- Existing settings persist via `update-settings` / Firestore (`server/database.js`). Reuse `settings.mode`; add `lw_*` keys beside it.
- Existing participant join: `public/js/user.js` + `public/js/camera-torch-access.js` (`setTorch`).
- Producer UI: new Lightwave card on `public/producer.html` / `public/js/producer.js`.
- No new third-party SDKs. No Firebase schema beyond settings fields and optional socket-session section on the connection.

### Location options (geo vs manual) — recommendation

Browser geolocation **cannot be trusted to auto-assign stadium or arena section numbers** in a web app. Typical consumer GPS is 5–15 m outdoors in open sky and often **20–100 m+** (or a timeout) inside a bowl, under a roof, or in a dense crowd. Adjacent sections are frequently closer together than that error. Indoor arenas are worse. The Geolocation API also needs a permission prompt, can be denied, and reports a large `accuracy` radius that we would have to treat as “unknown.”

| Approach | Accuracy for **section** | Extra permission | iOS Safari web | Recommendation |
|---|---|---|---|---|
| **Manual section entry** | Exact (user / usher knowledge) | None | Yes | **Ship this.** Primary path. |
| **QR / printed URL `?lw_section=142`** at gates, section signs, or seat stickers | Exact | None | Yes | **Ship this.** Best “don’t type” option. Same page, no mapping backend. |
| **Tap a venue map** (later) | Exact if the map is right | None | Yes | Follow-up when a real seating chart exists. |
| **Ticket scan / barcode** | Exact if ticket has section | Camera | Yes | Later; needs ticket data. |
| **GPS → nearest section polygon** | Poor in-bowl; maybe “side of venue” | Geolocation | Yes, but inaccurate | **Do not silent-assign.** Optional “We think you’re near section X — confirm?” only if `accuracy` is below a strict threshold (e.g. 15 m) **and** a venue polygon file exists. |
| **Relative GPS clustering** | Still meters of error | Geolocation | Yes | Not useful for section IDs. |
| **BLE beacons / UWB** | Can be good | Web Bluetooth (limited) | **No** on iOS Safari | Out of scope for this web app. |
| **Wi-Fi / cell triangulation** | Venue-dependent | Not exposed to JS | No | Not available. |
| **Camera landmark matching** | Research-grade | Camera (already on) | Fragile | Out of scope. |

**Design decision for this feature:** v1 assignment is **manual + QR/query prefill + sessionStorage remember**. GPS auto-assign is **not** in scope. A later optional `lw_geo.js` may offer a **confirmable hint** only after a venue section-polygon file and a field accuracy test. That keeps the wave correct even if someone is standing in the concourse.

### A.6 FEAT-* map

| ID | Scope in this design |
|---|---|
| FEAT-001 | Lightwave mode toggle, settings, producer card, isolation from audio `play` timelines |
| FEAT-002 | `lw_` pose classifier + torch gate (2 s / lower-to-off) + iOS motion permission + sensor fallback |
| FEAT-003 | Section assign (manual, `?lw_section=`, sessionStorage) and occupied-section reporting to the server |
| FEAT-004 | Wave start/stop, server schedule, countdown UI, clock-compensated `goAt` |

### Users / roles

| Actor | Needs | Notes |
|---|---|---|
| Participant | Join, section, countdown, raise-to-light | Same `/go/i/{token}` URL as today |
| Producer | Mode on/off, wave timing, Start / Stop Wave, see who is in which section | Same `/producer/{token}` |
| Helper / ops | N/A this pass | No helper changes required |
| Output screen | N/A this pass | Wave is in-stadium phones, not the output page |

### Flows & UI states

**Primary flow:** 1. Producer enables Lightwave. 2. Participant joins (existing). 3. Participant confirms section. 4. Motion sensors start. 5. Wait. 6. Countdown 3-2-1-GO. 7. Raise → torch on; lower or 2 s → torch off. 8. Return to wait until the next Start Wave.

| State | Behavior |
|---|---|
| Loading | Existing join spinner; Lightwave modules idle until torch-connected **and** mode is lightwave. |
| Empty / waiting | Joined, section set, no active cue. Copy: you’re in section N, wait for the wave. Torch off. |
| Needs section | Joined but no `lw_section`. Number field + confirm. Invalid / blank blocked. |
| Needs motion (iOS) | If Join did not grant motion, a single “Enable motion” control. Deny → fallback flash on GO. |
| Countdown | Full-area overlay: “Raise phone in 3 / 2 / 1”. Not yet allowed to light. |
| GO / raise window | “GO” then “Raise your phone!”. Torch follows pose (or fallback). |
| Wave cancelled | Overlay clears; torch off; back to waiting. |
| Error | Motion or torch failure: existing join-failed path if join failed; otherwise in-overlay message, fallback flash if only motion failed. |
| Success | Visible section wave; torch respects raise / lower / 2 s cap. |
| Mode off | Lightwave UI unmounted; `timeline.js` behaves as today. |

### Visual / UX references

| Artifact | Link / path |
|---|---|
| Participant shell | `public/index.html` — add an `lw_*` overlay; do not replace the join stack |
| Producer settings cards | `public/producer.html` — new Lightwave card next to existing program / onboarding cards |
| Current torch join copy | Existing onboarding / joined strings; Lightwave-specific copy only after join when mode is on |

### Architecture

Preserve the current `public/` + `server/` + `dist/` layout (do not migrate this repo onto the Client/Server/Dist scaffold).

**New client modules (all `public/js/`):**

| Module | Responsibility |
|---|---|
| `lw_mode.js` | Read `settings.mode`; start / stop Lightwave vs lightshow; ignore `play` while on |
| `lw_section.js` | Parse / validate section; URL + sessionStorage; emit `lw_section` to server |
| `lw_pose.js` | Motion permission, gravity classifier, raised / lowered events with hysteresis |
| `lw_torch.js` | Thin wrapper around existing `setTorch` that enforces GO-window + pose + 2 s cap |
| `lw_countdown.js` | Render 3 / 2 / 1 / GO / raise prompt from `goAt` |
| `lw_wave.js` | Socket client: `lw_wave-cue`, `lw_wave-stop`, local schedule |
| `lw_geo.js` | **Stub or omit in v1.** Documented hook for a future confirmable GPS hint only |

**New styles:** `src/styles/lw_lightwave.scss` imported from `main.scss`.

**New server module:** `server/lw_wave.js` — collect occupied sections from socket data, sort, compute `goAt`, emit cues. `server/app.js` only registers `lw_*` events.

**Existing modules (thin hooks only):**

- `user.js` — after torch-connected and on settings updates, call `lw_mode` start/stop.
- `producer.js` / `producer.html` — Lightwave card; emit `lw_wave-start` / `lw_wave-stop`; persist `mode` + `lw_*` settings.
- `database.js` — persist `mode` (already does) and new `lw_*` defaults.
- `camera-torch-access.js` — unchanged public API; Lightwave calls `setTorch`.
- `timeline.js` — unchanged; simply not invoked while Lightwave is on.

**Producer settings (new keys):**

| Key | Default | Meaning |
|---|---|---|
| `mode` | `'default'` | `'lightwave'` enables the mode (existing field) |
| `lw_torchMaxMs` | `2000` | Max torch-on per cue |
| `lw_countdownSeconds` | `3` | Visible countdown length |
| `lw_sectionDelayMs` | `400` | Delay between occupied-section GO times |
| `lw_waitingText` | `You're in section {section}. Get ready.` | Waiting copy |

**Socket events (new):**

| Event | Direction | Payload (shape) |
|---|---|---|
| `lw_section` | client → server | `{ token, section }` |
| `lw_wave-start` | producer → server | `{ token, lw_torchMaxMs, lw_countdownSeconds, lw_sectionDelayMs }` |
| `lw_wave-cue` | server → participant | `{ waveId, section, goAt, sentAt, lw_torchMaxMs, lw_countdownSeconds }` |
| `lw_wave-stop` | producer → server → participants | `{ token, waveId }` |
| `lw_wave-status` | server → producer | `{ occupied: { section, count }[] }` |

### Data flow

```text
Producer: mode=lightwave ──settings──► Firestore + all sockets
Participant join (existing torch) ──► lw_mode.start()
Participant section ──lw_section──► socket.data.lw_section
Producer Start Wave ──lw_wave-start──► server/lw_wave.js
  occupied sections sorted ──lw_wave-cue(goAt)──► each participant
  client: now < goAt − 3s → wait
           countdown window → 3, 2, 1
           now >= goAt → GO window (torchMax)
             lw_pose raised → setTorch(true) until lower or 2s
Producer Stop / mode default → lw_wave-stop / lw_mode.stop → torch off
```

### Errors & edge cases

| Scenario | Expected handling |
|---|---|
| Lightwave off | No `lw_*` UI; `play` timelines work as today |
| Mode flipped mid-wave | Stop wave, torch off, switch stacks |
| Play Program while Lightwave on | Producer control disabled or no-op; participants ignore `play` |
| Missing / invalid section | Block wave participation; show entry field |
| Empty sections | Skipped in the schedule |
| Late joiner mid-wave | Get status; miss the current pass; included in the next Start Wave |
| User raises before GO | Torch stays off |
| User never raises | Torch stays off; wave continues |
| User keeps arm up past 2 s | Torch turns off at 2 s; stays off until a new GO **and** a new raise (or still-raised counts as raised for the next cue — **proposed default:** still-raised at the next GO may turn on again) |
| User lowers at 0.4 s | Torch off immediately |
| Motion permission denied | Fallback: torch on for up to 2 s at GO |
| iOS motion API missing | Same fallback |
| `setTorch` fails | Log; overlay still runs so the crowd motion remains even without light |
| Duplicate Start Wave | New `waveId` supersedes the previous schedule |
| Clock skew / slow network | Apply `sentAt` offset like existing play sync |
| Landscape | Existing rotate overlay still applies |
| Show locked / end card | Existing lock / end-card wins; Lightwave stops |

### Open questions

| # | Question | Impact | Proposed default |
|---|---|---|---|
| 1 | Confirm `settings.mode = 'lightwave'` vs a separate `lw_enabled` boolean? | Persistence / producer UI | Use existing `mode` field (`default` \| `lightwave`) plus `lw_*` timing keys |
| 2 | Allow letter suffixes (`142A`) or integers only? | Sort + entry validation | Allow `^\d+[A-Za-z]?$` |
| 3 | If the phone is still raised when the next GO arrives, flash again? | Wave look | Yes — GO + currently raised may turn torch on |
| 4 | Recording controls during Lightwave? | UI clutter | Leave recording as-is if already enabled; wave overlay sits above |
| 5 | Should Output / Helper show wave status? | Scope | No this pass |
| 6 | Default stagger 400 ms vs 200 / 800? | Visual speed of the wave | 400 ms, producer-editable |
| 7 | Add confirmable GPS hint in the same build? | Extra permission + venue data | **No.** Document only; implement after a venue polygon + field test |

### Discovery risks

| Risk | L / M / H | Impact | Mitigation |
|---|---|---|---|
| Pose thresholds differ by how people hold phones | H | Missed flashes or false-ons | Hysteresis; field-tune constants in `lw_pose.js`; sensor fallback |
| iOS motion permission ignored / not prompted from gesture | H | All iPhones on fallback (no pose gate) | Request from Join click; dedicated Enable motion button |
| Android / iOS torch already inconsistent | M | Some phones never light | Existing torch stack; wave still visible as raised arms |
| GPS temptation for auto-section | H | Wrong sections = broken wave | Manual + QR only in v1 |
| Clock skew across thousands of phones | M | Countdown / GO smear | `sentAt` compensation (same idea as `play`) |
| Producer starts audio program by habit | M | Confusing mixed cues | Disable Play while mode is lightwave |
| False raised from dancing | M | Random flashes | Hysteresis + GO window required |

### Observability

| Signal | Why |
|---|---|
| Existing `torch-connected` / `torch-connect-failed` | Join health unchanged |
| `lw_section` on socket.data | Producer occupancy + schedule |
| `lw_wave-start` / `lw_wave-stop` / `waveId` server logs | Ops can see passes |
| Client `log()` for pose permission result and fallback used | Debug iOS vs Android in the field |
| Producer `lw_wave-status` counts | Confirm the wave has people in enough sections |

---

## B - Plan

> `/plan` owns this section. Do not complete this section until Section A has an approval row in Section H.

### B.1 Summary & design anchor

**Design status:** Section A approved on 2026-09-09 (changelog ref `CL-002`).

**Implementation scope:** Add Lightwave as a producer-controlled `settings.mode` value (`lightwave` vs `default`) on the existing Vixi LightShow stack. New `lw_*` client modules, producer controls, and `server/lw_wave.js` implement section assignment, pose-gated torch, and a staggered section wave. Existing audio-timeline lightshow (`timeline.js`, `torch-worker.js`, `play` / `play-program`) stays intact and is ignored or disabled while mode is `lightwave`. No GPS auto-assign and no `lw_geo.js` in this pass.

**FEAT IDs in scope:** `FEAT-001`, `FEAT-002`, `FEAT-003`, `FEAT-004`

### B.2 Baseline

| Area | Today’s behavior / location |
|---|---|
| Participant join / torch | `public/js/user.js` Join click → `startTorchFlow` / `setTorch` in `public/js/camera-torch-access.js`. Mic optional via `settings.requestMic`. |
| Participant settings apply | `user.js` `settings` and `assets-settings` handlers copy many fields but **do not read `settings.mode`**. |
| Lightshow playback | `user.js` `socket.on("play")` calls `onTimeline` in `public/js/timeline.js` when `joined`. |
| Show lock / end | `user.js` `handleShowEnd` stops torch, leaves torch flow, clears timeline timers. |
| Producer programs | `public/js/producer.js` `addProgramItemListener` emits `play-program` / `stop-program`. |
| Producer settings persist | `producer.js` `updateSettings()` → `update-settings` → `server/app.js` `setFirebaseSettings` → `server/database.js` `setSettings` (already writes `settings.mode`). Broadcasts `settings` to the token room. |
| Producer `mode` field | Defaults to `'default'` in `producer.js`; stored in Firestore; unused by the participant app. |
| Socket rooms | `server/app.js` `checkTokenAndJoinRoom`; roles `user`, `producer`, `output`, `helper`. |
| Settings fan-out | `buildUserSettings` clones settings and injects deployment flags; `mode` would already flow through if present. |
| Client bundle | esbuild entries: `user.js`, `producer.js`, `output.js`, `helper.js`. Imported `lw_*` modules ship inside those bundles — no extra entry. |
| Styles | `src/styles/main.scss` imports `_user`, `_producer`, etc. |
| Tests | `npm test` is a stub (`echo` + exit 1). Load test only: `tests/test.yaml` (Artillery). No unit or Playwright harness. |

### B.3 Technical approach

1. **Settings contract.** Persist `mode` (`default` \| `lightwave`) plus `lw_torchMaxMs`, `lw_countdownSeconds`, `lw_sectionDelayMs`, `lw_waitingText` in `database.js` `setSettings` with A.5 defaults. Copy the same fields in `user.js` and `producer.js` settings handlers. `buildUserSettings` needs no special case — it clones the document.
2. **Mode controller (`lw_mode.js`).** `lw_start(ctx)` / `lw_stop(ctx)` mount or tear down section UI, pose, wave listeners, and overlay. While started, `lw_isActive()` is true. `user.js` `play` handler calls `onTimeline` only when `joined && !lw_isActive()`. On settings updates, lock, `handleShowEnd`, and leave: start or stop to match `mode` and joined/locked state.
3. **Section (`lw_section.js`).** Validate `^\d+[A-Za-z]?$`. Resolve in order: `?lw_section=` → `sessionStorage` key `lw_section:${token}` → manual `#lw_section-form`. Emit `lw_section` `{ token, section }`. Export `lw_normalizeSection` and `lw_compareSections` (numeric prefix, then optional letter).
4. **Server wave (`server/lw_wave.js`, CommonJS).** `lw_collectOccupied(io, token)` reads `socket.data.role === 'user'`, `socket.data.torch`, and `socket.data.lw_section`. `lw_buildSchedule(sections, { epoch, delayMs })` skips empties, sorts with the same compare rules, assigns `goAt`. `lw_wave-start` (producer only) creates `waveId`, emits `lw_wave-cue` per matching user, emits `lw_wave-status` to producers. `lw_wave-stop` broadcasts stop for that `waveId`. `lw_section` and disconnect refresh occupancy. Keep `lwModeByToken[token]` from the latest settings broadcast so `play-program` no-ops while mode is `lightwave`.
5. **Client wave + countdown (`lw_wave.js`, `lw_countdown.js`).** On `lw_wave-cue` for this client’s section, compute local `goAt` from `sentAt` / receive time (same clock idea as `play`). Drive overlay states: wait → “Raise phone in 3/2/1” → “GO” / “Raise your phone!” → waiting. `lw_wave-stop` or a newer `waveId` cancels timers and forces torch off.
6. **Pose + torch gate (`lw_pose.js`, `lw_torch.js`).** After successful join, request iOS motion permission from that gesture (or `#lw_enable-motion`). Classify gravity as raised vs lowered with hysteresis. `lw_shouldTorchBeOn({ goActive, raised, fallback, elapsedMs, maxMs })` is the only place that decides torch. Call existing `setTorch`. Fallback: if permission denied or API missing, `fallback=true` so GO flashes up to `lw_torchMaxMs`. Still-raised at the next GO may turn on again (D-003).
7. **Producer UI.** New Lightwave card on Show Controls (`producer.html`): mode toggle, timing fields, Start Wave / Stop Wave, occupancy list (`#lw_occupancy`). Changing mode or timing calls `updateSettings()`. While `mode === 'lightwave'`, program clicks in `addProgramItemListener` return early (no `play-program`). Start/Stop emit `lw_wave-start` / `lw_wave-stop` with current `lw_*` timing.
8. **Isolation rules.** Do not rewrite `timeline.js` or `torch-worker.js`. Do not add `lw_geo.js`. Recording, lock, end-card, and rotate overlay stay as they are; lock/end still wins and must `lw_stop`.

**Notes:** Preserve `public/` + `server/` + `dist/` layout. Server stays CommonJS (`require`). Client stays ESM and is pulled in through existing esbuild entries. Backwards compatible: deployments with no `lw_*` keys get defaults; `mode` other than `lightwave` is treated as default lightshow.

### B.4 File manifest

| Path | Action | Purpose |
|---|---|---|
| `public/js/lw_mode.js` | Add | Start/stop Lightwave vs lightshow; `lw_isActive()` |
| `public/js/lw_section.js` | Add | Validate/normalize/compare section; URL + sessionStorage; emit `lw_section` |
| `public/js/lw_pose.js` | Add | Motion permission; gravity classifier; raised/lowered + hysteresis |
| `public/js/lw_torch.js` | Add | GO-window + pose + 2 s cap around `setTorch` |
| `public/js/lw_countdown.js` | Add | Overlay copy: 3 / 2 / 1 / GO / raise / wait |
| `public/js/lw_wave.js` | Add | Client cue/stop listeners; local schedule; clock compensate |
| `server/lw_wave.js` | Add | Occupancy, sort, schedule, start/stop helpers (CJS) |
| `src/styles/_lw_lightwave.scss` | Add | Participant overlay + producer card (partial, `lw_` selectors) |
| `tests/lw_section.test.mjs` | Add | Section validate / compare / sort |
| `tests/lw_wave.test.mjs` | Add | Schedule, skip empty, `goAt` stagger |
| `tests/lw_torch.test.mjs` | Add | Torch gate matrix (GO, pose, fallback, timeout, lower) |
| `public/js/user.js` | Update | Import `lw_mode`; apply `mode` + `lw_*` settings; gate `play`; join/lock/end hooks |
| `public/js/producer.js` | Update | Lightwave card wiring; persist `lw_*`; disable programs when lightwave; wave emit |
| `public/index.html` | Update | Hidden `lw_*` overlay + section form (shown by `lw_mode`) |
| `public/producer.html` | Update | Lightwave card on Show Controls |
| `src/styles/main.scss` | Update | `@import '_lw_lightwave'` |
| `server/app.js` | Update | Register `lw_*` events; `play-program` no-op when `lwModeByToken` is lightwave |
| `server/database.js` | Update | Persist `lw_*` defaults beside `mode` |
| `package.json` | Update | `test` script → `node --test tests/lw_*.test.mjs` |
| `README.md` | Update | Lightwave mode, QR `?lw_section=`, producer Start Wave (doc list; can land in `/document` if deferred) |

### B.5 Interfaces & contracts

| Interface | Change | Notes |
|---|---|---|
| Firestore `settings.mode` | Use `'default'` \| `'lightwave'` | Already persisted; participant begins to honor it |
| Firestore `settings.lw_*` | Add keys | Defaults: `lw_torchMaxMs=2000`, `lw_countdownSeconds=3`, `lw_sectionDelayMs=400`, `lw_waitingText="You're in section {section}. Get ready."` |
| Socket `lw_section` | Add (user → server) | `{ token, section }` after validation. Sets `socket.data.lw_section`. |
| Socket `lw_wave-start` | Add (producer → server) | `{ token, lw_torchMaxMs, lw_countdownSeconds, lw_sectionDelayMs }` |
| Socket `lw_wave-cue` | Add (server → user) | `{ waveId, section, goAt, sentAt, lw_torchMaxMs, lw_countdownSeconds }` — only to users in that section |
| Socket `lw_wave-stop` | Add (producer → server → room) | `{ token, waveId }` |
| Socket `lw_wave-status` | Add (server → producer) | `{ occupied: [{ section, count }] }` |
| Socket `play` / `play-program` | Behavior | Client ignores `play` when Lightwave active. Server `play-program` no-ops if `lwModeByToken[token] === 'lightwave'`. |
| DOM ids | Add | `lw_overlay`, `lw_overlay-text`, `lw_section-form`, `lw_section-input`, `lw_section-submit`, `lw_enable-motion`, `lw_mode-toggle`, `lw_torch-max`, `lw_countdown-seconds`, `lw_section-delay`, `lw_waiting-text`, `lw_wave-start`, `lw_wave-stop`, `lw_occupancy` |
| sessionStorage | Add | `lw_section:${token}` |
| Query | Add | `?lw_section=142` (or `142A`) |
| `setTorch` | Unchanged | `lw_torch.js` is the only new caller besides existing timeline |

### B.6 Tooling & configuration

| Kind | Item | Change |
|---|---|---|
| Script | `package.json` `test` | Replace stub with `node --test tests/lw_*.test.mjs` |
| Script | esbuild / copy / sass | No new entries; `lw_*` imported from `user.js` / `producer.js`; SCSS via `main.scss` |
| Dependency | N/A | No new npm packages. Use Node built-in `node:test`. |
| Env | N/A | No new env vars |

### B.7 Test coverage plan

**Unit**

| Add / Update | Target file(s) | Covers (risk / behavior ref) |
|---|---|---|
| Add | `tests/lw_section.test.mjs` → `lw_normalizeSection`, `lw_compareSections` | Valid `142` / `142A`; reject blank, `abc`, `14-2`; sort `101` < `102` < `110` < `142` < `142A` |
| Add | `tests/lw_wave.test.mjs` → `lw_buildSchedule` | Empty sections skipped; `goAt = epoch + index * delay`; stable `waveId` inputs |
| Add | `tests/lw_torch.test.mjs` → `lw_shouldTorchBeOn` | Off before GO; off if lowered; on if GO+raised; on if GO+fallback; off at `maxMs`; off when GO ends; still-raised + new GO → on |

**Integration / API**

| Add / Update | Target | Covers |
|---|---|---|
| Add | `tests/lw_wave.test.mjs` occupancy helper | `lw_collectOccupied` from fake socket list (role, torch, section); producer-only start ignored in helper (no emit) |

**E2E**

| Add / Update | Target | Covers |
|---|---|---|
| N/A | Artillery `tests/test.yaml` | Load test is unrelated; do not extend this pass |

**Playwright**

| Add / Update | Spec / flow | Covers |
|---|---|---|
| Waive | Critical Lightwave UI | No Playwright harness in repo. Torch and motion need real devices. Covered by MT-001–MT-010. Waiver owner: Amber. |

**Smoke**

| Add / Update | Command / script | Covers |
|---|---|---|
| Add | `npm test` | New `lw_*` unit tests pass |
| Add | `npm run build` | esbuild + sass + dist copy succeed with new imports / SCSS |

**Manual**

| ID | Scenario | Pass criteria |
|---|---|---|
| MT-001 | Mode off | Join and play an existing effect; torch follows the audio timeline as today. No `lw_*` overlay. |
| MT-002 | Mode on, no section | After join, section form shows. Invalid input blocked. Confirming a valid section shows waiting copy with that number. |
| MT-003 | QR / query prefill | Open `/go/i/{token}?lw_section=142`, join; form skipped or prefilled; server occupancy shows 142. |
| MT-004 | Wave countdown | Two browsers/phones in sections 101 and 110. Start Wave. 101 sees 3-2-1-GO first; 110 is delayed by `lw_sectionDelayMs`. |
| MT-005 | Pose gate (Android or iOS with motion) | Raise at GO → torch on; lower → torch off immediately; keep raised → torch off at 2 s. Raise before GO → no torch. |
| MT-006 | Sensor fallback | Deny motion (or desktop). At GO, torch (or overlay) still runs for up to 2 s. |
| MT-007 | Stop / mode flip | Mid-countdown, Stop Wave or switch mode to default: overlay clears, torch off. Mode default restores program clicks. |
| MT-008 | Play Program while Lightwave on | Program buttons do not start a timeline; participant does not flash from `play`. |
| MT-009 | Lock / end card | Lock or stop-and-redirect while Lightwave is on: existing end/lock wins; Lightwave stopped; torch off. |
| MT-010 | Empty section skip | Occupied 101 and 103 only. Wave does not wait for 102. |
| MT-011 | iOS motion gesture | On iPhone Safari, Join (or Enable motion) prompts for motion; grant enables pose gate. |
| MT-012 | sessionStorage | Reload same token after entering a section; section is remembered until changed. |

### B.8 Verification

- [ ] All B.7 rows implemented or explicitly waived with owner + reason in Section H
- [ ] Acceptance mapped to Section A success signals (mode toggle, section assign, countdown, pose-gated 2 s torch, ascending occupied-section wave, `lw_*` isolation)
- [ ] Verification commands will be recorded during build/test (`npm test`, `npm run build`, MT-001–MT-012)

### B.9 Executable checklist

- [ ] Add `server/lw_wave.js` with collect / compare / schedule helpers; wire `lw_*` events and `play-program` guard in `server/app.js`
- [ ] Persist `lw_*` defaults in `server/database.js` `setSettings`
- [ ] Add client `lw_mode.js`, `lw_section.js`, `lw_pose.js`, `lw_torch.js`, `lw_countdown.js`, `lw_wave.js`
- [ ] Add `lw_*` markup to `public/index.html` and Lightwave card to `public/producer.html`
- [ ] Hook `user.js` (settings, play gate, join, lock/end) and `producer.js` (settings, disable programs, start/stop, occupancy)
- [ ] Add `src/styles/_lw_lightwave.scss` and import from `main.scss`
- [ ] Add `tests/lw_*.test.mjs` and point `package.json` `test` at `node --test tests/lw_*.test.mjs`
- [ ] Run `npm test` and `npm run build`; record results in Section C
- [ ] Run MT-001–MT-012 on at least one Android Chrome and one iOS Safari if available; record in Section D

### Assumptions & validation

| ID | Assumption | Validate by |
|----|------------| ----------- |
| A-001 | Existing `settings.mode` is safe to use as `default` \| `lightwave` | Confirm producer save/load still works; unknown values treated as default |
| A-002 | Gravity + orientation can distinguish eye-level vs overhead well enough for a stadium wave | MT-005; tune hysteresis constants in `lw_pose.js` if field test fails |
| A-003 | iOS will grant motion when requested from the Join click | MT-011; Enable motion button is the backup |
| A-004 | Clock skew is acceptable using `sentAt` the same way `play` does | MT-004 on two devices; stagger still readable |
| A-005 | Firestore settings docs can gain `lw_*` keys without a migration job | Missing keys → code defaults |

### Data migrations & rollback

| ID | Migration | Rollback |
|----|-----------| -------- |
| M-001 | No bulk migration. New keys written on next producer save; readers default when absent. | Set `mode` back to `default` (or omit). Old clients ignore `lw_*`. Remove `lw_*` files and hooks. |

### Execution risks

| ID | Risk | Mitigation |
|----|------| ---------- |
| R-001 | Pose false positives / missed raises | Hysteresis; GO window required; fallback flash; tunable constants |
| R-002 | iOS motion prompt skipped | Request from Join; dedicated `#lw_enable-motion` |
| R-003 | `play-program` still emitted from old producer tabs | Server `lwModeByToken` guard |
| R-004 | `user.js` settings duplication (two handlers) misses `mode` | Shared helper to apply `mode` + `lw_*` in both `settings` and `assets-settings` |
| R-005 | CommonJS server vs ESM client compare drift | Same documented sort rules; unit-test both compare implementations or export one tested helper used by the server tests |

### Decision log

| ID | Decision | Alternatives | Why chosen |
|----|----------| ------------ | ---------- |
| D-001 | Use existing `settings.mode` = `lightwave` \| `default` | Separate `lw_enabled` boolean | Field already persisted; matches A open question 1 |
| D-002 | Section pattern `^\d+[A-Za-z]?$` | Integers only | Allows `142A` without free-text chaos |
| D-003 | Still-raised at next GO may flash again | Require lower then raise | Wave should still light people who hold position |
| D-004 | Omit `lw_geo.js` this pass | Stub file | A open question 7; no venue polygons |
| D-005 | Waive Playwright; use `node:test` + manual device tests | Add Playwright dependency | No existing harness; torch/motion are device-bound; avoid new packages |
| D-006 | Lightwave card on Show Controls (not only Input tab) | Settings-only | Producer must Start/Stop during the show |
| D-007 | Recording left as-is if already enabled | Hide recording in Lightwave | A open question 4 |

### Documentation touch list

| ID | Doc | Change |
|----|-----| ------ |
| DOC-001 | `README.md` | Lightwave mode, `?lw_section=`, producer Start/Stop, mutual exclusion with audio programs |
| DOC-002 | `docs/lightwave-mode.md` (new, during `/document`) | Pose rules, wave timing, QR workflow, why GPS is not used |

---

## C - Build

> `/build` owns this section. Do not complete this section until Section B has an approval row in Section H.

### C.1 Plan anchor

- **Section B approved:** 2026-09-09 (`CL-004`)
- **FEAT IDs touched:** `FEAT-001`, `FEAT-002`, `FEAT-003`, `FEAT-004`

### C.2 Outcome summary

- Producer **Lightwave** tab (between Show Controls and Program Builder): mode toggle, torch trigger (raise vs after-countdown), timing, Start/Stop Wave, occupied-section counts, and the active section. `mode: 'lightwave'` persists with `lw_*` settings.
- Participants reuse the existing join/torch path. In Lightwave they enter or prefill a section, see 3-2-1-GO, and the torch is pose-gated (or fallback-flashed) for at most 2 s.
- Server `lw_wave.js` schedules occupied sections low → high and ignores `play-program` while the token is in Lightwave mode.
- `lw_*` client modules are isolated; `timeline.js` / `torch-worker.js` were not rewritten.
- **B.9 checklist:** completed except README (deferred to `/document`) and device manual tests (Section D)

### C.3 Commands run

| Command | Result | Notes |
|---|---|---|
| `npm test` | Pass | 24 tests, 0 fail (`node --test tests/lw_*.test.mjs tests/testMode.test.mjs`) |
| `npm run build` | Pass | Sass + esbuild + hashed dist. Pre-existing producer.js duplicate-key warnings (`recordingEnabled`, `maxRecordingDuration`) |
| `npm run lint` | Skipped | Repo has no lint script |

### C.4 Deviations from Section B

| Planned (B) | Actual | Reason | Impact |
|---|---|---|---|
| `goAt = waveEpoch + index * delay` | First GO is `sentAt + countdownMs + index * delay` | Literal formula made the first section’s 3-2-1 already in the past | Matches intended countdown UX |
| Client `lw_*` imported by `node:test` | Added `public/js/package.json` `{ "type": "module" }` | Root package is CommonJS; Node otherwise treats `public/js/*.js` as CJS | Tests can named-import client helpers; browser/esbuild unchanged |
| `setTorch` static import in `lw_torch.js` | Dynamic import inside apply/off | Static import pulled `camera-torch-access.js` into unit tests | Gate function stays testable in Node |
| `lw_geo.js` omitted | Omitted | B / D-004 | None |
| Pose-gated torch only | Producer `lw_requireRaise` (default true). False = torch on at GO for every phone in the section | Owner request after C | Cue and settings carry `lw_requireRaise` |
| Lightwave card on Show Controls | Own producer tab between Show Controls and Program Builder | Owner request after C | Tab ids after Lightwave shifted by one |
| Join leaves torch on (`startTorchFlow`) | After Lightwave join, `setTorch(false)` and hide `#info-text` | Owner request after C | Torch stays off until GO + raise (or countdown-only mode) |
| After GO, overlay returns to waiting | Overlay shows **Lower your Phone** then **Wave Complete** | Owner request after C | Looping returns to waiting before the next countdown |
| Fixed pose thresholds | Producer raise/lower sensitivity 1–10; default raise 8 / lower 2 | Owner request after C | Subtle raise, extreme lower |
| Orientation enter/exit hysteresis | Raise = sustained camera-end (portrait top) lift; lower = sustained downward drop only. Orientation can enter raised, never exit | Flicker while barely moving; lower was too sensitive | Torch stays on until a real drop; already-raised phones light at GO |
| Torch off on lower | Optional `lw_offOnlyAtMax` ignores lowering until torch max | Owner request after C | Checkbox on Lightwave tab |
| Single pass wave | Optional `lw_loop` restarts the occupied-section pass after a gap | Owner request after C | Stop Wave ends the loop |
| Settings update always calls `lw_start` | If already running, only re-apply timing/sensitivity | Live slider changes must not reset overlay or torch | Pose thresholds update without interrupting a pass |
| Raise 8 / lower 2 / torch 2000 / start lowered | Defaults raise 5, lower 5, torch max 3000; pose starts `neutral` until first samples set the home hold | Owner request after C | Raise/lower measured from the initial pose, not an assumed lowered start |
| Wave always requires section + countdown | Optional `lw_followPose`: torch on while raised, off while lowered; no section, waiting, or countdown | Owner request after C | Start Wave is disabled in this mode |
| Raise easier than lower at the same slider | At 5/5, raise needs more travel than lower | Raise was too hot, lower too stiff | Phone debug shows travel vs remaining |
| Single Lightwave form | Three-column studio UI; Section Wave toggle swaps wave vs free-pose fields | Owner mock | Joined text, torch min, off-on-lower, wave-complete text |
| Follow-pose torch only tracks raise/lower | If off-on-lower is off, each phone picks a random off delay between torch min and max | Owner request | Torches do not all go dark together |
| Lower is `-raiseSignal` with fast travel decay | Separate `lowerSignal` (world-down + phone-end toward ground) plus home-return rotation; slower lower decay; Lightwave tab uses the same card chrome as other tabs | Lower slider 8 still missed a normal drop because raise bonus and gravity LP hid downward motion | Down travel and rotate-back both count; wobble still cannot exit raised |

### C.5 Skipped or deferred work

| Item | Reason | Follow-up |
|---|---|---|
| `README.md` Lightwave notes (DOC-001) | B.4 allows `/document` | `/document` + `docs/lightwave-mode.md` |
| MT-001–MT-012 | Device / two-browser cases belong in `/test` | Section D |
| Playwright | Waived in B.7 | Confirm waiver in Section H at `/test` if still waived |

### C.6 Failures & recovery

| Failure | Resolution | Verified |
|---|---|---|
| `npm test` failed: client `export` seen as CJS | Added `public/js/package.json` `{ "type": "module" }` | Y — 16/16 pass |

### Artifacts

| ID | Kind | Link |
|----|------| ---- |
| Plan | Feature plan | `docs/plans/2026-09-09-lightwave-mode-plan.md` |

### Reviewer hints

- Producer: Lightwave tab. Enable mode, choose torch trigger, Start Wave. Occupancy lists counts; **Active section** updates at each GO. Program buttons on Show Controls are dimmed/disabled while Lightwave is on.
- Participant: `/go/i/{token}` or `/go/i/{token}?lw_section=142`. Join first; overlay asks for section if the query/sessionStorage is empty.
- First section still gets a full countdown because `goAt` includes `countdownMs` lead (C.4).
- Desktop / denied motion uses the 2 s fallback flash at GO.
- Do not expect silent GPS. Manual tests are Section D.

---

## D - Test

> `/test` owns this section. Do not complete this section until Section C has an approval row in Section H.

### D.1 Coverage anchor

**Maps to Section B.7:** `<ids or row refs>`

**Extra tests run (not in B.7):** `<none / list>`

### D.2 Layer summary

| Layer | Result | Evidence |
|---|---|---|
| Smoke | Pass / Fail / Skipped / N/A |  |
| Unit | Pass / Fail / Skipped / N/A |  |
| Integration / API | Pass / Fail / Skipped / N/A |  |
| E2E | Pass / Fail / Skipped / N/A |  |
| Playwright | Pass / Fail / Skipped / N/A |  |
| Manual | Pass / Fail / Skipped / N/A |  |

### D.3 Detailed results

**Unit**

| Test / file | Result | Evidence |
|---|---|---|
|  | Pass / Fail / Skipped |  |

**Integration / API**

| Test / suite | Result | Evidence |
|---|---|---|
|  | Pass / Fail / Skipped |  |

**E2E**

| Test / suite | Result | Evidence |
|---|---|---|
|  | Pass / Fail / Skipped |  |

**Playwright**

| Spec / case | Result | Evidence |
|---|---|---|
|  | Pass / Fail / Skipped |  |

**Manual**

| ID | Scenario | Tester | Result | Evidence |
|---|---|---|---|---|
| MT-001 |  |  | Pass / Fail / Skipped |  |

### D.4 Waivers

| B.7 ref | Waived why | Approver |
|---|---|---|
| N/A |  |  |

### Flakes / instability

`Use *N/A* if nothing to add`

### Regression watchlist

`Use *N/A* if nothing to add`

---

## E - Review

> `/review` owns this section. Do not complete this section until Section D has an approval row in Section H.

### E.1 Meta

| Field | Value |
|---|---|
| Reviewer(s) |  |
| Date | YYYY-MM-DD |
| Scope | PR / SHA:  |

### E.2 Outcome

**Verdict:** Approved / Approved with changes / Changes requested / Blocked

### E.3 Summary

- 

### E.4 Required changes (blockers)

| ID | Severity | Area | Finding | Required fix | Status |
|---|---|---|---|---|---|
| RB-001 | Critical / Important |  |  |  | Open / Fixed / Waived |

`None` —

### E.5 Suggestions

| ID | Suggestion | Status |
|---|---|---|
| SU-001 |  | Open / Backlog / Done |

`None` —

### Questions

`Use *N/A* if nothing to add`

### Security / privacy

`Use *N/A* if nothing to add`

### Performance

`Use *N/A* if nothing to add`

### Dependencies

`Use *N/A* if nothing to add`

---

## F - Document

> `/document` owns this section. Do not complete this section until Section E has an approval row in Section H.

### F.1 Status

**Mode:** Documented / N/A

| Document | Path or URL | What changed |
|---|---|---|
|  |  |  |

**If N/A**

| Reason | Approver |
|---|---|
|  |  |

### F.2 Coverage vs plan

| B touch-list item | Addressed (Y/N) | Where |
|---|---|---|
|  |  |  |

### Deferred doc debt

| Item | Ticket |
|---|---|
|  |  |

`Use *N/A* if nothing to add`

---

## G - Ship

> `/ship` owns this section. Do not complete this section until Section F has an approval row in Section H.

### G.1 Ship summary

- 

### G.2 Version control

| Field | Value |
|---|---|
| Branch |  |
| PR / MR |  |
| Commit(s) |  |
| Tag |  |

### G.3 Change inventory

**PR diff:** `<link>` — or table:

| Path | Change |
|---|---|---|
|  | Add / Update / Delete |

### G.4 Readiness

| Check | Required | Status | Notes |
|---|---|---|---|
| CI | Y / N | Pass / Fail / N/A |  |
| Review (E) | Y / N | Pass / Fail / N/A |  |
| Tests (D) | Y / N | Pass / Fail / N/A |  |
| Docs (F) | Y / N | Pass / Fail / N/A |  |
| Deploy / release checklist | Y / N | Pass / Fail / N/A |  |

### G.5 Post-ship

- 

### Rollback

`Use *N/A* if nothing to add`

### Customer / support comms

`Use *N/A* if nothing to add`

---

## H - Changelog

> Append-only. Records phase approvals and substantive edits.

| ID | Date | Type | Section | Description | Requester | Approver |
|---|---|---|---|---|---|---|
| CL-001 | 2026-09-09 | edit | A | Initial design draft from `/design`: Lightwave mode, pose-gated torch, section wave, geo recommendation (manual + QR, no silent GPS) | Amber | — |
| CL-002 | 2026-09-09 | approval | A | Section A design approved; proceed to `/plan` | Amber | Amber |
| CL-003 | 2026-09-09 | edit | B | Implementation plan from `/plan`: `lw_*` modules, socket/settings contracts, node:test + manual coverage, Playwright waived | Amber | — |
| CL-004 | 2026-09-09 | approval | B | Section B plan approved; proceed to `/build` | Amber | Amber |
| CL-005 | 2026-09-09 | edit | C | Build complete: Lightwave mode, wave schedule, pose-gated torch, unit tests + production build | Amber | — |
| CL-006 | 2026-09-09 | edit | C | Torch off until raise; hide joined copy; producer torch-trigger + occupancy/active section; Lightwave as its own tab | Amber | — |
| CL-007 | 2026-09-09 | edit | C | After the GO window, participant overlay shows “Lower your Phone” then returns to waiting | Amber | — |
| CL-008 | 2026-09-09 | edit | C | Raise/lower sensitivity, off-only-at-max, Wave Complete, looping wave | Amber | — |
| CL-009 | 2026-09-09 | edit | C | Motion-based raise/lower: short top-up lift vs long drop; sync pose at GO | Amber | — |
| CL-010 | 2026-09-09 | edit | C | Defaults raise/lower 5, torch max 3000; initial pose is neutral until calibrated | Amber | — |
| CL-011 | 2026-09-09 | edit | C | Follow-pose toggle: torch tracks raise/lower without section or countdown | Amber | — |
| CL-012 | 2026-09-09 | edit | C | Travel debug on phone; raise harder / lower easier at the same slider | Amber | — |
| CL-013 | 2026-09-09 | edit | C | Lightwave studio UI; joined text; random torch-off between min and max | Amber | — |
| CL-014 | 2026-09-09 | edit | C | Restore Lightwave card chrome; split raise/lower signals; count rotate-back as lower | Amber | — |
