# Feature Implementation — Lightwave Pose Diagnostics

> Single artifact for design through ship. Update one section at a time. Record every phase approval and substantive edit in **Section H — Changelog**.

| Field | Value |
|---|---|
| **Artifact path** | `docs/plans/2026-09-09-lightwave-pose-diagnostics-plan.md` |
| **Status** | Draft Design |
| **Owner** | Amber |
| **Created** | 2026-09-09 |
| **Last updated** | 2026-09-09 |

---

## A - Design

> `/design` owns this section. Complete Section A before requesting design approval.

### A.1 Summary

**Working title:** Lightwave Pose Diagnostics

Raise-to-light is failing in the field and we cannot see why. This pass adds **always-on server / Render logs** for permission, first sample, and pose changes, plus a **producer toggle** that optionally shows the same motion status on the phone. Camera-based raise detection is evaluated below and **not shipped in this pass** — the rear camera is already held for torch, and sky-vs-crowd vision is a poor night-stadium signal.

Parent feature: `docs/plans/2026-09-09-lightwave-mode-plan.md`.

### A.2 Purpose & success

**Why:** Testers cannot tell whether iOS/Android granted the accelerometer, whether `devicemotion` is firing, or whether the classifier thinks the phone is raised. Existing `user.js` `log()` is commented out, and the server `log` handler only prints when `DEBUG_MODE_ENABLED` is true (currently false), so nothing appears on Render.

**Success looks like:**

- Producer can turn **phone debug text** on or off (`lw_debugOverlay`). Off is the default.
- When the toggle is **on**, joined Lightwave phones show a compact status line: permission result, whether motion samples arrived, and current pose (`lowered` / `raised` / `no samples`).
- When the toggle is **off**, phones show no debug UI; the same events still go to Render.
- Render logs show a `### lw_pose` line when each participant grants/denies/lacks motion, when the first sample arrives, and when pose changes.
- We can decide from those logs whether the bug is **no permission**, **no events**, or **wrong classifier thresholds** — without building camera ML yet.

### A.3 In scope

| Item | Notes |
|---|---|
| Producer debug toggle | Lightwave tab checkbox `lw_debugOverlay` (default **off**). Persists with other `lw_*` settings. |
| On-phone status | Small `#lw_debug` line on the Lightwave overlay **only when** `lw_debugOverlay` is true. Does not replace countdown copy. |
| Permission logging | iOS `requestPermission` result, or Android/desktop implicit `granted` / `unsupported` |
| Sample + pose logging | First `devicemotion` sample; pose transitions; optional 2 s heartbeat while listening |
| Server / Render | Dedicated `lw_pose-log` socket event; server **always** `console.log`s (not gated on `DEBUG_MODE_ENABLED`) |
| Producer hint | Occupancy can show motion status per section (granted + sampling vs fallback) if already cheap |
| Alternatives write-up | Camera / orientation options documented in Architecture; recommendation recorded |

### A.4 Out of scope

| Non-goal | Reason |
|---|---|
| Camera / ML pose (MediaPipe, sky vs crowd, brightness) | See Architecture. Conflicts with rear-torch stream; unreliable at night. Defer unless logs prove sensors never fire. |
| Turning `DEBUG_MODE_ENABLED` on globally | Would flood unrelated user `log` traffic. Lightwave uses its own event. |
| Persisting pose logs to Firestore | Render stdout is enough for this test. |
| Rewriting `lw_classifyPose` thresholds | Tune only after logs show samples arriving with unexpected angles. |
| Shipping a second camera join path | Same `startTorchFlow` as today. |

### A.5 Behavior

**Rules / outcomes**

1. **Producer toggle `lw_debugOverlay`.** Default **false**. When **true**, joined Lightwave phones show one debug line testers can read without DevTools, for example: `Motion: granted · samples: 18 · pose: lowered`. When **false**, `#lw_debug` is hidden (or empty) and the phone UI is unchanged. Mid-show settings updates apply immediately: turning the toggle off hides the line; turning it on shows the latest status.
2. **Server logs are independent of the toggle.** Permission, first sample, pose change, and heartbeat always emit `lw_pose-log` whether or not the phone shows debug text.
3. **Permission states.** `granted` (iOS prompt accepted, or Android/desktop where `DeviceMotionEvent` exists and no prompt is required). `denied` (iOS prompt refused). `unsupported` (`DeviceMotionEvent` missing).
4. **Access success ≠ permission string.** After `granted`, we still wait for a real sample. Status / logs distinguish `listening, 0 samples` from `sampling`.
5. **Server logs always.** Client emits `lw_pose-log`. Server prints `### lw_pose` with token, socket id, section, and payload. Do **not** require `DEBUG_MODE_ENABLED`.
6. **Rate limit to Render.** Always log: permission result, first sample, every pose change, Lightwave start/stop. Heartbeat at most once per 2 s (include last `angleDeg` / `torchUp`). No per-frame flood.
7. **No secrets.** Payloads may include section, pose, permission, sample count, rounded metrics. No tokens-as-secrets, no camera frames, no PII beyond existing socket identity.
8. **Fallback unchanged.** Denied / unsupported / zero samples still use the existing GO fallback when `lw_requireRaise` is true. Diagnostics do not change torch rules.
9. **Camera detection is not enabled.** Recommendation: keep accelerometer; use the producer “torch after countdown” toggle if pose stays broken after logs.

**Happy path**

1. Producer opens the Lightwave tab. **Show phone debug text** is off by default.
2. Participant joins. Render already receives `### lw_pose` permission. The phone does **not** show a debug line.
3. Producer enables the toggle (settings sync). Joined phones show `Motion: granted · samples: 0 · pose: waiting`.
4. First tilt: on-phone `samples` / pose update (if toggle on). Render logs first-sample and pose regardless.
5. Producer turns the toggle off. Debug line disappears; Render logging continues.

**Integration touchpoints**

- `public/js/lw_pose.js`, `lw_mode.js`, `lw_countdown.js` / overlay HTML
- Producer Lightwave tab + `lw_applyLightwaveSettings` / `database.js` for `lw_debugOverlay`
- `public/js/user.js` `log()` stays unused; do not revive the global debug flood
- `server/app.js` new `lw_pose-log` handler
- Existing Lightwave occupancy (`lw_wave-status`) may carry `motionGranted` / `sampling` counts
- Render log viewer (stdout)

### A.6 FEAT-* map

| ID | Scope in this design |
|---|---|
| FEAT-001 | `lw_pose-log` → Render `### lw_pose` (permission, first sample, pose change, heartbeat), independent of UI |
| FEAT-002 | Producer `lw_debugOverlay` toggle; `#lw_debug` on the phone only when that setting is true |
| FEAT-003 | Optional occupancy motion counts on the producer Lightwave tab |
| N/A | Camera raise detection — not a FEAT this file |

### Users / roles

| Actor | Needs | Notes |
|---|---|---|
| Participant / tester | See own motion line **only if** the producer enabled phone debug | Same `/go/i/{token}` page |
| Engineer on Render | See every tester’s permission and pose in logs | Always, toggle does not matter |
| Producer | Turn phone debug text on/off; optional occupancy motion counts | Lightwave tab |

### Flows & UI states

**Primary flow:** 1. Join Lightwave (debug off). 2. Events print on Render only. 3. Producer enables **Show phone debug text**. 4. Status line appears. 5. Grant / skip iOS motion. 6. Tilt phone; samples and pose update on the phone and on Render.

| State | Behavior |
|---|---|
| Loading | Debug line hidden until Lightwave overlay is shown **and** `lw_debugOverlay` is true |
| Debug off | No `#lw_debug` text; server logging continues |
| Empty / waiting | If debug on: `Motion: {permission} · samples: 0 · pose: waiting` |
| Sampling | If debug on: `samples` > 0; pose `lowered` or `raised` |
| Denied / unsupported | If debug on: `Motion: denied` or `unsupported · fallback` |
| Error | Socket emit fails: if debug on, still update the on-phone line; retry is not required |
| Success | With debug on, testers can match phone line to Render; with debug off, Render only |
| Mode off | Status hidden; listeners removed (existing `lw_stop`) |

### Visual / UX references

| Artifact | Link / path |
|---|---|
| Overlay host | `public/index.html` `#lw_overlay` — add `#lw_debug` under `#lw_overlay-text` (hidden unless `lw_debugOverlay`) |
| Existing unused footer debug | `#debug-text` / `#debug-text-2` — do **not** reuse; footer is often hidden and sits under z-index 1000 |
| Producer toggle | Lightwave tab, near the mode checkbox: **Show phone debug text** → `lw_debugOverlay` |
| Producer occupancy | `public/producer.html` `#lw_occupancy` |

Keep `#lw_debug` small (muted, ~0.85rem) so countdown stays primary.

### Architecture

**What exists today**

- `lw_prepareMotionFromJoin()` requests iOS permission on the Join tap and starts `lw_poseStart`.
- `lw_poseStart` listens to `devicemotion` gravity and classifies raised vs lowered (`lw_pose.js`).
- `clientLog({ type: 'lw_motion-permission' })` calls `user.js` `log()`, which is a **no-op** (emit and `console.log` commented out).
- Server `socket.on('log')` only prints if `DEBUG_MODE_ENABLED` is true (`.env` is `false`).
- Pose transitions are never logged.

**This pass**

- `lw_pose.js` reports permission, first sample, pose, and throttled metrics to `lw_mode.js`.
- `lw_mode.js` always emits `lw_pose-log`. It paints `#lw_debug` only when `settings.lw_debugOverlay === true`.
- Producer persists `lw_debugOverlay` with other Lightwave settings (same `update-settings` path).
- `server/app.js` always logs `### lw_pose`.

**Other ways to detect “phone raised” (recommendation)**

| Approach | How it would work | Works with rear torch? | Night stadium | Verdict |
|---|---|---|---|---|
| **Accelerometer / gravity (current)** | Infer overhead from gravity axes | Yes | Yes | **Keep.** Fix visibility first; then tune thresholds if samples look wrong. |
| **DeviceOrientation (beta/gamma)** | Complementary angle | Yes | Yes | Optional helper if `devicemotion` is empty but orientation fires. Same permission on iOS. |
| **Producer “torch after countdown”** | No pose; flash at GO | Yes | Yes | **Already shipped.** Use this if sensors stay dead. |
| **Rear-camera brightness / “sky”** | Brighter or bluer frame = raised | Yes (same stream) | **Poor** — sky is dark; stands are mixed lights | Do not ship. High false on/off. |
| **Rear-camera motion / optical flow** | Detects movement, not height | Yes | Unreliable | Not a raise detector. |
| **Front-camera face / sky / MediaPipe** | See face vs ceiling | **Usually no** — one camera; torch is on the rear module | Extra battery, privacy, ML weight | Out of scope. Would drop torch or need a second stream many phones refuse. |
| **Ultrasonic / barometer height** | True height | Barometer weak indoors; no ultrasonic on web | No | Not available in a reliable web API. |

**Design decision:** Do **not** add camera-based torch gating in this pass. The rear camera is already the torch device; vision cannot reliably mean “arm above head” in a dark bowl. If Render logs show **zero samples** after `granted`, next experiment is DeviceOrientation — not ML. If logs show samples but pose never becomes `raised` when testers hold the phone overhead, **then** tune `ENTER_ANGLE_DEG` / `ENTER_TORCH_UP` in `lw_pose.js`.

### Data flow

```text
Producer: lw_debugOverlay on|off ──settings──► phones

Join tap → lw_prepareMotionFromJoin
  → permission granted|denied|unsupported
  → paint #lw_debug only if lw_debugOverlay
  → emit lw_pose-log { kind: 'permission', ... }   // always

devicemotion (first sample)
  → paint samples: 1 only if lw_debugOverlay
  → emit lw_pose-log { kind: 'first-sample', angleDeg, torchUp }   // always

pose change lowered|raised
  → paint pose only if lw_debugOverlay
  → emit lw_pose-log { kind: 'pose', pose }   // always

heartbeat ≤ 1 / 2s
  → emit lw_pose-log { kind: 'heartbeat', samples, pose, angleDeg, torchUp }

server/app.js
  → console.log('### lw_pose', { token, section, socketId, ...payload })
  → Render logs
```

### Errors & edge cases

| Scenario | Expected handling |
|---|---|
| iOS user denies motion | Status `denied · fallback`; log `permission: denied`; torch still flashes on GO if fallback is on |
| `DeviceMotionEvent` missing | Status `unsupported · fallback`; log once |
| Granted but no events (desktop, some in-app browsers) | Stay `samples: 0`; heartbeat may still say `listening`; after ~3 s log `kind: 'no-sample'` once |
| Socket down | If debug on, on-phone status still updates |
| Rapid shaking | Pose logs only on change; heartbeat capped at 2 s |
| Lightwave off / leave | Stop listener; hide `#lw_debug`; no more emits |
| Producer turns debug off mid-join | Hide `#lw_debug` immediately; emits continue |
| Producer turns debug on mid-join | Show `#lw_debug` with the latest known permission / samples / pose |
| `requireRaise` false | Diagnostics still run so we can see pose even when torch ignores it |
| Multiple tabs | Each socket logs separately |

### Open questions

| # | Question | Impact | Proposed default |
|---|---|---|---|
| 1 | Default for `lw_debugOverlay`? | Show phones stay clean vs testers forget to enable | **Off.** Producer enables for field tests. |
| 2 | Show motion counts on producer occupancy now? | Extra FEAT-003 work | **Yes** if it is one field on `lw_wave-status`; otherwise phone-toggle + Render only |
| 3 | Tune classifier in the same build if logs look obvious? | Scope creep | **No.** Log first; tune in a follow-up once we have numbers |

### Discovery risks

| Risk | L / M / H | Impact | Mitigation |
|---|---|---|---|
| iOS Safari never prompts / never fires events | H | All iPhones look “granted” or “denied” with 0 samples | Log permission **and** first-sample / no-sample |
| In-app browsers (Instagram, QR apps) block motion | H | Testers think the app is broken | Enable phone debug for that test; Render still shows `no-sample` if they forget |
| Render log volume | M | Noisy / truncated logs | Rate limit; `### lw_pose` prefix |
| Testers raise the phone still “upright” (torch forward) | M | Samples exist, pose stays lowered | Heartbeat includes `angleDeg` / `torchUp` so we can retune |
| Camera temptation | M | Breaks torch | Keep camera out of scope |

### Observability

| Signal | Why |
|---|---|
| `#lw_debug` on the phone | Only when producer enables `lw_debugOverlay` |
| `lw_debugOverlay` setting | Producer can test without shipping debug copy to a show |
| `### lw_pose` permission | Who granted / denied / unsupported |
| `### lw_pose` first-sample / no-sample | Did we actually get the accelerometer |
| `### lw_pose` pose + heartbeat metrics | Is the classifier the failure |
| Producer occupancy motion counts (if FEAT-002) | Room-level “how many can raise-to-light” |

---

## B - Plan

> `/plan` owns this section. Do not complete this section until Section A has an approval row in Section H.

### B.1 Summary & design anchor

**Design status:** Section A approved on 2026-09-09 (changelog ref `CL-003`).

**Implementation scope:** Always-on Lightwave pose logs to the server / Render; producer `lw_debugOverlay` toggle that optionally paints `#lw_debug` on the phone; occupancy rows include motion grant / sampling counts. No camera pose. No classifier retune. Do not revive `user.js` `log()`.

**FEAT IDs in scope:** `FEAT-001`, `FEAT-002`, `FEAT-003`

### B.2 Baseline

| Area | Today’s behavior / location |
|---|---|
| Pose classifier | `public/js/lw_pose.js` — `devicemotion` gravity; raised/lowered; no sample counters or emit hooks |
| Motion on join | `lw_mode.js` `lw_prepareMotionFromJoin` → `clientLog` → `user.js` `log()` which is a no-op |
| Server user logs | `server/app.js` `socket.on('log')` only prints if `DEBUG_MODE_ENABLED` (false in `.env`) |
| Settings | `lw_applyLightwaveSettings` / `database.js` persist `lw_*` but not `lw_debugOverlay` |
| Producer Lightwave tab | `public/producer.html` `#lw_card` — mode, torch trigger, timing, occupancy |
| Occupancy | `server/lw_wave.js` `lw_collectOccupiedFromSockets` → `{ section, count }` only |
| Overlay | `public/index.html` `#lw_overlay` / `#lw_overlay-text` — no debug line |
| Tests | `tests/lw_torch.test.mjs` (gate + countdown copy), `tests/lw_wave.test.mjs` (schedule / occupancy / active section) |

### B.3 Technical approach

1. **Pose reporter (`lw_pose.js`).** Track `sampleCount`, last metrics, and callbacks: first sample, pose change, 2 s heartbeat, one `no-sample` after ~3 s if still listening with zero samples. Do not change classify thresholds.
2. **Client emit (`lw_mode.js`).** On those events (plus permission and Lightwave start/stop), emit `lw_pose-log` with a small payload. Always emit while Lightwave is active. Paint `#lw_debug` only when `settings.lw_debugOverlay === true`. Export `lw_debugLine({ permission, samples, pose })` for the overlay string and unit tests.
3. **Setting.** Add `lw_debugOverlay` (boolean, default `false`) to `LW_DEFAULTS`, `lw_applyLightwaveSettings`, `user.js` / `producer.js` defaults, and `database.js` `setSettings`. Producer checkbox **Show phone debug text** on the Lightwave tab. Settings updates re-paint or hide `#lw_debug` immediately.
4. **Server (`app.js`).** New `lw_pose-log` handler: validate `kind`, copy `lw_motionPermission` / `lw_motionSampling` onto `socket.data`, `console.log('### lw_pose', …)` **without** `DEBUG_MODE_ENABLED`. Refresh occupancy on permission / first-sample / no-sample (not every heartbeat).
5. **Occupancy (FEAT-003).** Extend `lw_collectOccupiedFromSockets` rows to `{ section, count, motionGranted, sampling }`. Producer list shows those counts next to participant count.
6. **Stop / leave.** Existing `lw_stop` / `lw_poseStop` also hide `#lw_debug` and stop heartbeats.

**Notes:** Prefix remains `lw_`. Torch rules unchanged. Heartbeat metrics are rounded (1 decimal) to keep Render readable. `user.js` `log()` stays commented out.

### B.4 File manifest

| Path | Action | Purpose |
|---|---|---|
| `public/js/lw_pose.js` | Update | Sample count, first-sample / no-sample / heartbeat hooks |
| `public/js/lw_mode.js` | Update | `lw_debugOverlay`, `lw_debugLine`, emit `lw_pose-log`, paint `#lw_debug` |
| `public/js/lw_countdown.js` | Update | Optional: keep `#lw_debug` visible while overlay is shown (do not clear it on text changes) |
| `public/index.html` | Update | `#lw_debug` under `#lw_overlay-text`, hidden by default |
| `src/styles/_lw_lightwave.scss` | Update | Small muted `#lw_debug` |
| `public/producer.html` | Update | Show phone debug text checkbox |
| `public/js/producer.js` | Update | Persist / sync `lw_debugOverlay`; occupancy motion columns |
| `public/js/user.js` | Update | Default `lw_debugOverlay: false` only — do not enable `log()` |
| `server/database.js` | Update | Persist `lw_debugOverlay` |
| `server/app.js` | Update | `lw_pose-log` → always `### lw_pose`; store motion on `socket.data` |
| `server/lw_wave.js` | Update | Occupancy `motionGranted` / `sampling` |
| `tests/lw_torch.test.mjs` or `tests/lw_pose.test.mjs` | Add / Update | `lw_debugLine`; occupancy motion counts |
| `tests/lw_wave.test.mjs` | Update | Occupancy rows include motion fields |

### B.5 Interfaces & contracts

| Interface | Change | Notes |
|---|---|---|
| Settings `lw_debugOverlay` | Add boolean, default `false` | `false` if missing |
| Socket `lw_pose-log` (client → server) | Add | `{ kind, permission?, pose?, samples?, angleDeg?, torchUp? }` — `kind`: `permission` \| `first-sample` \| `no-sample` \| `pose` \| `heartbeat` \| `stop` |
| Server stdout | Add | `### lw_pose { token, socketId, section, ...payload }` always |
| Socket `lw_wave-status` occupied[] | Extend | `{ section, count, motionGranted, sampling }` — granted = permission `granted`; sampling = at least one sample |
| DOM `#lw_debug` | Add | Visible only when Lightwave overlay is on **and** `lw_debugOverlay` |

### B.6 Tooling & configuration

| Kind | Item | Change |
|---|---|---|
| Script | `N/A` | Existing `npm test` / `npm run build` |
| Dependency | `N/A` | No new packages |
| Env | `DEBUG_MODE_ENABLED` | Unchanged; `lw_pose-log` ignores it |

### B.7 Test coverage plan

**Unit**

| Add / Update | Target file(s) | Covers (risk / behavior ref) |
|---|---|---|
| Add | `tests/lw_pose.test.mjs` (or `lw_torch.test.mjs`) | `lw_debugLine` for granted/0 samples, sampling+raised, denied, unsupported |
| Update | `tests/lw_wave.test.mjs` | Occupancy counts `motionGranted` / `sampling` from `socket.data` |

**Integration / API**

| Add / Update | Target | Covers |
|---|---|---|
| N/A |  | Socket handler is covered by manual Render + unit occupancy |

**E2E**

| Add / Update | Target | Covers |
|---|---|---|
| N/A |  | Device motion not available in CI |

**Playwright**

| Add / Update | Spec / flow | Covers |
|---|---|---|
| Waive | — | Same as Lightwave mode plan: no reliable device-motion in Playwright |

**Smoke**

| Add / Update | Command / script | Covers |
|---|---|---|
| Update | `npm test` | New unit cases |
| Update | `npm run build` | Bundles include `#lw_debug` + setting |

**Manual**

| ID | Scenario | Pass criteria |
|---|---|---|
| MT-001 | Join Lightwave with debug **off** | No motion line on the phone; Render has `### lw_pose` permission |
| MT-002 | Enable **Show phone debug text** | Line appears without re-join; matches last known permission / samples / pose |
| MT-003 | Disable debug mid-join | Line hides; Render still gets pose / heartbeat |
| MT-004 | Tilt a real phone with debug on | `samples` increments; pose flips; Render `first-sample` then `pose` |
| MT-005 | Desktop / deny motion | `unsupported` or `denied`; `no-sample` after ~3 s if granted-but-silent; occupancy fallback counts |
| MT-006 | Occupancy | Producer list shows motion granted / sampling vs total in the section |

### B.8 Verification

- [ ] All B.7 rows implemented or explicitly waived with owner + reason in Section H
- [ ] Acceptance mapped to Section A success signals
- [ ] Verification commands will be recorded during build/test

### B.9 Executable checklist

- [ ] Add pose reporter hooks + `lw_debugLine` + `lw_pose-log` emit
- [ ] Persist `lw_debugOverlay`; producer checkbox; hide/show `#lw_debug` on settings
- [ ] Server always-on `### lw_pose`; occupancy motion fields
- [ ] Unit tests for debug line + occupancy motion counts
- [ ] Run `npm test` and `npm run build`; record in Section C
- [ ] Manual MT-001–MT-006 on a phone + Render (Section D)

### Assumptions & validation

| ID | Assumption | Validate by |
|----|------------| ----------- |
| A-001 | `devicemotion` is enough to diagnose; no DeviceOrientation helper this pass | MT-004 / MT-005 logs |
| A-002 | Heartbeat every 2 s is safe on Render for the test token crowd | Watch log volume on first wave |

### Data migrations & rollback

| ID | Migration | Rollback |
|----|-----------| -------- |
| N/A | New optional setting; missing key means debug off | Remove checkbox / ignore key |

### Execution risks

| ID | Risk | Mitigation |
|----|------| ---------- |
| R-001 | Heartbeats flood Render | Cap 2 s; occupancy refresh not on heartbeat |
| R-002 | Overlay text updates wipe `#lw_debug` | Separate element; never `innerHTML` the whole overlay |
| R-003 | Settings arrive before join | Apply toggle on `lw_sync` and on later `settings` |

### Decision log

| ID | Decision | Alternatives | Why chosen |
|----|----------| ------------ | ---------- |
| D-001 | Dedicated `lw_pose-log`, not `log` | Turn on `DEBUG_MODE_ENABLED` | Avoids global debug flood; always visible on Render |
| D-002 | `lw_debugOverlay` default off | Always-on phone line | A.5 / open question 1 |
| D-003 | FEAT-003 occupancy motion counts | Render-only | A.5 open question 2 — one extra pair of integers per section |
| D-004 | Playwright waived | Fake DeviceMotion in CI | Unreliable stand-in for iOS permission |

### Documentation touch list

| ID | Doc | Change |
|----|-----| ------ |
| DOC-001 | `docs/lightwave-mode.md` or README | Defer to `/document` — note debug toggle + `### lw_pose` |

---

## C - Build

> `/build` owns this section. Do not complete this section until Section B has an approval row in Section H.

### C.1 Plan anchor

- **Section B approved:** 2026-09-09 (`CL-005`)
- **FEAT IDs touched:** `FEAT-001`, `FEAT-002`, `FEAT-003`

### C.2 Outcome summary

- Joined Lightwave phones emit `lw_pose-log` (permission, first-sample, no-sample, pose, 2 s heartbeat, stop). Server always prints `### lw_pose` (not gated on `DEBUG_MODE_ENABLED`).
- Producer **Show phone debug text** (`lw_debugOverlay`, default off) shows or hides `#lw_debug` without stopping server logs.
- Occupancy rows include `motionGranted` and `sampling`; the producer list shows `motion N · sampling N`.
- `user.js` `log()` was not revived. Classifier thresholds were not changed.
- **B.9 checklist:** completed except manual MT-001–MT-006 (Section D)

### C.3 Commands run

| Command | Result | Notes |
|---|---|---|
| `npm test` | Pass | 31 tests, 0 fail |
| `npm run build` | Pass | Pre-existing producer.js duplicate-key warnings |
| `npm run lint` | Skipped | Repo has no lint script |

### C.4 Deviations from Section B

| Planned (B) | Actual | Reason | Impact |
|---|---|---|---|
| `lw_countdown.js` keep `#lw_debug` | No countdown change | `#lw_debug` is a sibling of `#lw_overlay-text`; text updates never wipe it | None |

### C.5 Skipped or deferred work

| Item | Reason | Follow-up |
|---|---|---|
| MT-001–MT-006 | Device + Render | Section D |
| Playwright | Waived in B.7 / D-004 | Confirm waiver in Section H at `/test` |
| DOC-001 | B.4 allows `/document` | `/document` |

### C.6 Failures & recovery

| Failure | Resolution | Verified |
|---|---|---|
| None |  | N/A |

### Artifacts

| ID | Kind | Link |
|----|------| ---- |
| Plan | Feature plan | `docs/plans/2026-09-09-lightwave-pose-diagnostics-plan.md` |

### Reviewer hints

- Producer Lightwave tab: **Show phone debug text**. Off = no phone line; Render still gets `### lw_pose`.
- Occupancy: `N participants · motion X · sampling Y`.
- Restart the Node server so `lw_pose-log` is registered. Search Render logs for `### lw_pose`.
- Manual phone/Render cases are Section D.

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
|---|---|
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
| CL-001 | 2026-09-09 | edit | A | Initial design: on-phone motion status, always-on `lw_pose-log` → Render, camera raise detection deferred | Amber | — |
| CL-002 | 2026-09-09 | edit | A | Producer `lw_debugOverlay` toggle: phone debug UI only when on; server logs always | Amber | — |
| CL-003 | 2026-09-09 | approval | A | Section A design approved; proceed to `/plan` | Amber | Amber |
| CL-004 | 2026-09-09 | edit | B | Implementation plan: `lw_pose-log`, `lw_debugOverlay`, occupancy motion counts; Playwright waived | Amber | — |
| CL-005 | 2026-09-09 | approval | B | Section B plan approved; proceed to `/build` | Amber | Amber |
| CL-006 | 2026-09-09 | edit | C | Build complete: `lw_pose-log`, `lw_debugOverlay`, occupancy motion counts; unit tests + production build | Amber | — |
