const { updateSessionWithConnections } = require('./database');

let snapshotsByToken = {};
/* --------------------------------------------------------------------------------------------------------------- */
/* Helpers                                                                                                         */
/* --------------------------------------------------------------------------------------------------------------- */
function formatMsToHHMMSS(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '00:00:00';
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Create blank snapshot                                                                                           */
/* --------------------------------------------------------------------------------------------------------------- */
async function createBlankSnapshot() {
    const snapshot = {
        sessionId: null,
        token: null,
        display_name: null,
        firestore_root: null,
        unlockedAt: null, // Human readable date
        lockedAt: null, // Human readable date
        aggregates: {
          users:        { highest: 0, torchHighest: 0 }
        },
        effects: {
            totalPlayDuration: 0, // total play duration of all effects in ms
            // effect_name: { startDateTime: "Human readable date", stopDateTime: "Human readable date", active: boolean, playDuration: number (ms) }
        }, 
        errors: { 
            count: 0, 
            sockets: {} // socket_id: { torchError: socket.data.torchError, device: socket.data.device, message: socket.data.message, timestamp: "Human readable date" }
        }
    }
    return snapshot;
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Create snapshot                                                                                                 */
/* --------------------------------------------------------------------------------------------------------------- */
async function updateSnapshot(socket, action) {

    if (!snapshotsByToken[socket.data.token]) {
        snapshotsByToken[socket.data.token] = await createBlankSnapshot();
        snapshotsByToken[socket.data.token].sessionId = String(Date.now());
        snapshotsByToken[socket.data.token].unlockedAt = null;
        snapshotsByToken[socket.data.token].token = socket.data.token;
        snapshotsByToken[socket.data.token].display_name = socket.data.displayName;
        snapshotsByToken[socket.data.token].firestore_root = socket.data.firestoreRoot;
        snapshotsByToken[socket.data.token].lockedAt = null;
    }
    switch (action) {
        case 'user_connected':
            {
                snapshotsByToken[socket.data.token].aggregates.users.highest ++;
                // Do not log roles for user
            }
            break;
        case 'user_disconnected':
            {
                // Do not log roles for user
            }
            break;
        case 'producer_connected':
            {
                // Do not log roles for producer
            }
            break;
        case 'producer_disconnected':
            {
                // Do not log roles for producer
            }
            break;
        case 'output_connected':
            {
                // Do not log roles for output
            }
            break;
        case 'output_disconnected':
            {
                // Do not log roles for output
            }
            break;
        case 'helper_connected':
            {
                // Do not log roles for helper
            }
            break;
        case 'helper_disconnected':
            {
                // Do not log roles for helper
            }
            break;
        case 'torch_connected':
            {
                snapshotsByToken[socket.data.token].aggregates.users.torchHighest ++;
                // Do not log roles for torch
            }
            break;
        case 'torch_disconnected':
            {
                // Do not log roles for torch
            }
            break;
        case 'torch-connect-failed':
            snapshotsByToken[socket.data.token].errors.count++;
            snapshotsByToken[socket.data.token].errors.sockets[socket.id] = { 
                torchError: socket.data.torchError, 
                device: socket.data.device, 
                message: socket.data.message, 
                timestamp: socket.data.torchDisconnectedAt };
            // Do not log roles for torch
            break;
        case 'effect':
            // loop through effects and aggregate durations
            if (!snapshotsByToken[socket.data.token].effects) {
                snapshotsByToken[socket.data.token].effects = {};
            }
            if (!Array.isArray(socket.data.effects) || socket.data.effects.length === 0) {
                break;
            }
            let totalPlayDurationMs = 0;
            for (let effect of socket.data.effects) {
                const hasStart = typeof effect.startDateTime === 'number';
                const hasStop = typeof effect.stopDateTime === 'number';
                const startDateTime = hasStart ? new Date(effect.startDateTime).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' }) : null;
                const stopDateTime = hasStop ? new Date(effect.stopDateTime).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' }) : null;
                let playDurationMs = 0;
                if (hasStart && hasStop) {
                    playDurationMs = Math.max(0, effect.stopDateTime - effect.startDateTime);
                }
                totalPlayDurationMs += playDurationMs;
                snapshotsByToken[socket.data.token].effects[effect.name] = {
                    startDateTime,
                    stopDateTime,
                    active: !!effect.active,
                    playDuration: formatMsToHHMMSS(playDurationMs)
                };
            }
            snapshotsByToken[socket.data.token].effects.totalPlayDuration = formatMsToHHMMSS(totalPlayDurationMs);
            break;
        case 'unlock':
            snapshotsByToken[socket.data.token].unlockedAt = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' });
            break;
        case 'lock':
            snapshotsByToken[socket.data.token].lockedAt = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' });
            //if aggregates.users.highest is > 0 update firebase
            if (snapshotsByToken[socket.data.token].aggregates.users.highest > 0) {
                await updateFirebase(snapshotsByToken[socket.data.token]);
            } else {
                delete snapshotsByToken[socket.data.token];
            }
            break;
        default:
            console.error('### Invalid action', action, 'Display Name:', socket.data.displayName, 'Token:', socket.data.token);
            break;
    }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Normalize snapshot                                                                                             */
/* --------------------------------------------------------------------------------------------------------------- */
async function normalizeSnapshot(snapshot) {
    // deep clone minimal structure we persist
    // Do not log roles

    return {
        lockedAt: snapshot.lockedAt ?? null,
        token: snapshot.token,
        display_name: snapshot.display_name,
        firestore_root: snapshot.firestore_root,
        unlockedAt: snapshot.unlockedAt ?? null,
        aggregates: snapshot.aggregates || { users: { highest: 0, torchHighest: 0 } },
        effects: snapshot.effects || { totalPlayDuration: 0 },
        sessionId: snapshot.sessionId,
        errors: snapshot.errors || { count: 0, sockets: {} }
    };
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Write snapshots to firestore                                                                                    */
/* --------------------------------------------------------------------------------------------------------------- */
async function updateFirebase(snapshot) {
    if (!snapshot) return;
    const normalizedSnapshot = await normalizeSnapshot(snapshot);
    if (!normalizedSnapshot) return;

    try {
        const firestoreRoot = typeof normalizedSnapshot.firestore_root === 'string' ? normalizedSnapshot.firestore_root : '';
        const sessionId = typeof normalizedSnapshot.sessionId === 'string' ? normalizedSnapshot.sessionId : String(normalizedSnapshot.sessionId || '');
        const safeDisplay = typeof normalizedSnapshot.display_name === 'string' ? normalizedSnapshot.display_name : '';
        const display_name = safeDisplay ? safeDisplay.replace(/\s+/g, '').charAt(0).toLowerCase() + safeDisplay.replace(/\s+/g, '').slice(1) : '';
        if (!firestoreRoot || !sessionId || !display_name) {
            return console.error('### Error writing snapshot to firestore', 'Missing required fields', { firestoreRoot, sessionId, display_name });
        }
        let result = await updateSessionWithConnections(firestoreRoot, normalizedSnapshot, sessionId, display_name);
        if (result.success) {
            delete snapshotsByToken[normalizedSnapshot.token];
        } else {
            console.error('### Error writing snapshot to firestore', firestoreRoot, sessionId, display_name, result.error);
        }
    } catch (e) {
        console.error('### Error writing snapshot to firestore', e);
    }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Export                                                                                                          */
/* --------------------------------------------------------------------------------------------------------------- */
module.exports = {
    updateSnapshot
};