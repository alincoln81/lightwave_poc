# Recording Feature

## Overview

The recording feature allows event participants to capture photos and short videos during an active light show. It is controlled by a two-level gate:

1. **Deployment gate** (`gateRecordingEnabled`) — set by admins on the helper page; enables the feature for a given deployment
2. **Event toggle** (`recordingEnabled` + `maxRecordingDuration`) — set by producers in the Input Builder tab; controls whether recording is active for the current event and how long recordings can be

---

## Data Model

### Deployment document (`deployments/{firestoreRoot}` in Firestore)

| Field                  | Type    | Default | Description                                                               |
|------------------------|---------|---------|---------------------------------------------------------------------------|
| `gateRecordingEnabled` | boolean | `false` | Admin-only gate; enables the recording section on the producer page       |
| `isMLB`                | boolean | `false` | Shows MLB legal footer on participant page (moved here from settings doc) |

### Settings document (`{firestoreRoot}/settings` in Firestore)

| Field                  | Type    | Default | Description                                           |
|------------------------|---------|---------|-------------------------------------------------------|
| `recordingEnabled`     | boolean | `false` | Producer-controlled toggle for recording availability |
| `maxRecordingDuration` | number  | `30`    | Max recording duration in seconds (10–600)            |

---

## Architecture

```text
Helper page
  └─ helper-update-deployment-flags socket event
       └─ updateDeploymentFlags() in database.js
            └─ updates Firestore deployments/{firestoreRoot}
                 └─ server cache refreshed

Producer page
  └─ receives gateRecordingEnabled as 6th arg of assets-settings-programs
  └─ shows/hides Recording section in Input Builder tab
  └─ update-settings socket event saves recordingEnabled + maxRecordingDuration

User page
  └─ receives settings with effective maxRecordingDuration
       (0 if gate or toggle is off; actual value if both are on)
  └─ recording-container shown only when:
       joined === true AND maxRecordingDuration > 0
```

---

## User Experience

### Recording Button

The recording button is positioned centrally near the bottom of the screen (like native camera apps). It is only visible while:

- The user has joined the light show (torch connected)
- `maxRecordingDuration > 0` (both gate and toggle are on)

### Photo Capture (single tap)

A short tap (< 200ms) captures the current camera frame as a JPEG and saves it to the camera roll via the Web Share API (download fallback on unsupported browsers).

### Video Recording (press and hold)

Pressing and holding (≥ 200ms) starts video recording. An arc animation around the button drains to indicate remaining time.

- **Release to stop**: releasing the button stops the recording and saves
- **Slide to lock**: while holding, slide the thumb left toward the lock icon to enter locked mode. In locked mode, the recording continues after releasing the thumb. A stop icon replaces the record icon; tapping it stops the recording.
- **Auto-stop**: if `maxRecordingDuration` seconds elapse, recording stops automatically

After saving, the UI resets and recording can be repeated.

### File Formats

| Platform       | Video format | Photo format |
|----------------|--------------|--------------|
| iOS Safari     | `video/mp4`  | `image/jpeg` |
| Android Chrome | `video/webm` | `image/jpeg` |

---

## Socket Events

| Event                            | Direction     | Payload                                                       | Description              |
|----------------------------------|---------------|---------------------------------------------------------------|--------------------------|
| `helper-update-deployment-flags` | client→server | `{ firestoreRoot, flags: { isMLB?, gateRecordingEnabled? } }` | Updates deployment flags |

---

## Files Changed

| File                               | Change                                                                                                                                                     |
|------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `server/database.js`               | Added `updateDeploymentFlags()`; added `recordingEnabled`/`maxRecordingDuration` to `setSettings()`; removed `isMLB` from settings doc writes              |
| `server/app.js`                    | Added `helper-update-deployment-flags` handler; added `buildUserSettings()` for per-role settings injection; changed settings broadcast to per-socket loop |
| `public/helper.html`               | Added MLB and Recording Gate columns to deployments table                                                                                                  |
| `public/js/helper.js`              | Added per-row toggles for `isMLB` and `gateRecordingEnabled`                                                                                               |
| `public/producer.html`             | Added Recording section to Input Builder tab                                                                                                               |
| `public/js/producer.js`            | Wired recording inputs; handles `gateRecordingEnabled` flag                                                                                                |
| `public/index.html`                | Added recording button, lock zone, hidden video and canvas elements                                                                                        |
| `public/js/recording.js`           | New module: photo capture, video recording, touch gestures, arc timer, save logic                                                                          |
| `public/js/user.js`                | Integrated recording module; show/hide recording UI on play/stop events                                                                                    |
| `public/js/camera-torch-access.js` | Added `getCameraStream()` export                                                                                                                           |
| `src/styles/_user.scss`            | Added recording button, arc, and lock zone styles                                                                                                          |
