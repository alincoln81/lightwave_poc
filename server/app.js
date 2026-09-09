/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize allowed origins                                                                                     */
/* --------------------------------------------------------------------------------------------------------------- */
const allowedOrigins = [
    'https://www.api.vixisuite.thefamousgroup.com',
    'https://api.vixisuite.thefamousgroup.com',
    'https://www.lightshow.vixisuite.thefamousgroup.com',
    'https://lightshow.vixisuite.thefamousgroup.com',
    'https://lightshow.vs2-uswest2-prod.vixisuite.cloud',
    'https://vixi-lightshow.onrender.com',
    'https://vixi-lightshow-dev.onrender.com',
    'http://localhost:3000'
];

/** Participant entry host (first fallback when token invalid on /go/i/:token). */
const PARTICIPANT_USER_APP_ORIGIN = 'https://vixi-lightshow.onrender.com';
/** Legacy paint error page (second fallback after retry=1 still invalid, and non-entry errors). */
const LEGACY_PARTICIPANT_ERROR_PAINT = 'https://lightshow.vs2-uswest2-prod.vixisuite.cloud/paint/error.html';

/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Express & Socket.IO                                                                                  */
/* --------------------------------------------------------------------------------------------------------------- */
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const distPath = path.join(__dirname, '../dist');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    maxHttpBufferSize: 10 * 1024 * 1024, // 10MB limit
    transports: ['websocket','polling'],
    perMessageDeflate: false, // avoids some proxy/header quirks
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },
    allowRequest: (req, fn) => {
        // Observe what's actually arriving at the Node app
        const ua = req.headers['user-agent'];
        const hv = req.httpVersion;
        const up = req.headers['Upgrade'];
        const con = req.headers['Connection'];
        const raw = req.rawHeaders;
        const reqURL = req.url;
        const reqIP = req.ip;

        if(DEBUG_MODE_ENABLED || hv !== '1.1') {
            console.log('[WS allowRequest]', { httpVersion: hv, url: reqURL, ip: reqIP, host: req.headers.host, ua });
        }
        fn(null, true);
    }
}); 

// Utilities for richer diagnostics on handshake failures
function sanitizeHeaders(headers) {
    try {
        const sensitive = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization']);
        const output = {};
        for (const [key, value] of Object.entries(headers || {})) {
            const lower = key.toLowerCase();
            if (sensitive.has(lower)) {
                if (typeof value === 'string') {
                    output[key] = '[redacted]';
                } else if (Array.isArray(value)) {
                    output[key] = value.map(() => '[redacted]');
                } else if (value && typeof value === 'object') {
                    output[key] = '[redacted]';
                } else {
                    output[key] = '[redacted]';
                }
            } else {
                output[key] = value;
            }
        }
        return output;
    } catch (_) {
        return { error: 'failed to sanitize headers' };
    }
}

function getRemoteAddressChain(req) {
    const chain = [];
    try {
        const xff = (req.headers && req.headers['x-forwarded-for']) || '';
        if (typeof xff === 'string' && xff.length > 0) {
            for (const part of xff.split(',')) {
                const ip = part && part.trim();
                if (ip) chain.push(ip);
            }
        }
        const realIp = req.headers && (req.headers['x-real-ip'] || req.headers['cf-connecting-ip']);
        if (realIp && !chain.includes(realIp)) chain.push(realIp);
        const direct = req.socket && req.socket.remoteAddress;
        if (direct && !chain.includes(direct)) chain.push(direct);
    } catch (_) {}
    return chain;
}

function getRequestContext(req) {
    const ips = getRemoteAddressChain(req);
    return {
        method: req.method,
        url: req.url,
        httpVersion: req.httpVersion,
        host: req.headers && req.headers.host,
        origin: req.headers && req.headers.origin,
        referer: req.headers && (req.headers.referer || req.headers.referrer),
        userAgent: req.headers && req.headers['user-agent'],
        upgrade: req.headers && req.headers.upgrade,
        connection: req.headers && req.headers.connection,
        transport: (req._query && req._query.transport) || undefined,
        secure: !!(req.socket && req.socket.encrypted),
        ip: ips[0],
        ipChain: ips
    };
}

// Log and downgrade failures to 4xx instead of 500s that bubble to the platform
io.engine.on('connection_error', (err) => {
    // err = { req, code, message, context }
    const req = err && err.req;
    const details = {
        code: err && err.code,
        message: err && err.message,
        context: err && err.context,
        request: req ? getRequestContext(req) : undefined,
        headers: req ? (typeof DEBUG_MODE_ENABLED !== 'undefined' && DEBUG_MODE_ENABLED ? sanitizeHeaders(req.headers) : undefined) : undefined,
        stack: err && err.stack ? err.stack : undefined
    };
    console.error('### [Engine.IO connection_error]', details);
});

// Optional: keep slow/odd proxies from tripping Node’s default timeouts
server.headersTimeout = 65000;  // default 60s; keep it >= requestTimeout + a bit
server.requestTimeout = 60000;  // handshake patience

// Global process-level error handlers
process.on('unhandledRejection', (reason) => {
    console.error('### Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('### Uncaught Exception:', error);
});

// Capture lower-level server errors that might bypass Express
server.on('clientError', (err, socket) => {
    try {
        console.error('### HTTP clientError:', err?.message || err);
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    } catch (_) {}
});
server.on('error', (err) => {
    console.error('### HTTP server error:', err?.message || err);
});

app.use(express.json());                         // <─ parses application/json
app.use(express.urlencoded({ extended: true })); // <─ parses form bodies

/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize variables                                                                                            */
/* --------------------------------------------------------------------------------------------------------------- */
let deploymentsCache = [];
let tokensCache = [];           //tokensCache (only valid https://www.api.vixisuite.thefamousgroup.com/[token]) that have been loaded from the deployments db
let timelines = {};             //Timelines are stored against the token (only valid https://www.api.vixisuite.thefamousgroup.com/[token])
let pingIntervals = {};        //Ping intervals are stored against the token (only valid https://www.api.vixisuite.thefamousgroup.com/[token])
let DEBUG_MODE_ENABLED = process.env.DEBUG_MODE_ENABLED.toLowerCase() === 'true';  //Enable/Disable debug mode (set to false in production)
let LOCAL_STATS_INTERVAL = parseInt(process.env.LOCAL_STATS_INTERVAL || '20000'); // Local stats update interval in milliseconds (default 20 seconds)

//console.log('### process.env.DEBUG_MODE_ENABLED: ', process.env.DEBUG_MODE_ENABLED);
console.log('### DEBUG_MODE_ENABLED: ', DEBUG_MODE_ENABLED);
//console.log('### process.env.LOCAL_STATS_INTERVAL: ', process.env.LOCAL_STATS_INTERVAL);
console.log('### LOCAL_STATS_INTERVAL: ', LOCAL_STATS_INTERVAL);

/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Firebase + GET & SET functions                                                                       */
/* --------------------------------------------------------------------------------------------------------------- */
const { getLocalStats, setLocalStats } = require('./localStats.js');
//const { updateSnapshot } = require('./stats.js');
const { registerTestHandlers } = require('./test.js');

const { 
    initFirebase, 
    getAssets, getPrograms, getSettings, getDatabases,
    setAssets, setPrograms, setSettings,
    copyCollection, createDeploymentsDb, updateDeploymentsDb, getAllDeployments,
    checkFirestoreRootCollection, updateDeploymentFlags
} = require('./database.js');
const lwWave = require('./lw_wave.js');
const lwModeByToken = {};
const {
    isTestMode,
    getTestDeployment,
    isAllowedToken,
    logTestModeBanner,
    TEST_TOKEN,
} = require('./testMode.js');

(async () => {
    let firebase = await initFirebase();
    console.log('Firebase project: ', firebase.firebaseApp._options.projectId);
    //console.log('Databases: ', firebase.db);
})();

app.get("/config.js", (req, res) => {
    // Do not cache config/bootstrap: it can change between deploys (e.g. debugMode).
    // Caching would cause stale config after a Render deploy and confuse clients.
    res.setHeader('Cache-Control', 'no-store');
    res.type("application/javascript");
    res.send(`window.__APP_CONFIG__ = {
      debugMode: ${DEBUG_MODE_ENABLED},
      appMode: ${JSON.stringify(isTestMode() ? 'test' : 'live')},
      testToken: ${isTestMode() ? JSON.stringify(TEST_TOKEN) : 'null'}
    };`);
  });

/* --------------------------------------------------------------------------------------------------------------- */
/* Serve static files                                                                                              */
/* --------------------------------------------------------------------------------------------------------------- */
// Cache strategy for Render and CDNs (e.g. Cloudflare):
// - HTML/app shell must never be cached (no-store). Otherwise after a deploy users get
//   old HTML that references old asset URLs, causing stale deploys and broken loads.
// - Hashed static assets (filenames containing a content hash, e.g. main-abc12def.css,
//   user-abc12def.js) are immutable: we can cache them for 1 year. Each deploy produces
//   new hashes, so HTML (no-store) always points at the latest assets.
// - Other static files (vendor, images) get long cache; config/bootstrap endpoints use no-store.
// Normalize repeated slashes to avoid 404s from malformed paths like //paint/error.html
app.use((req, res, next) => {
    if (req.url && req.url.includes('//')) {
        const qIndex = req.url.indexOf('?');
        const pathOnly = qIndex === -1 ? req.url : req.url.slice(0, qIndex);
        const query = qIndex === -1 ? '' : req.url.slice(qIndex);
        const normalizedPath = pathOnly.replace(/\/{2,}/g, '/');
        req.url = normalizedPath + query;
    }
    next();
}); 

// Serve built assets first, then raw public as fallback
// Serve dist if present; otherwise serve public. On error, fall back to public.
try {
    //const distPath = path.join(__dirname, '../dist');
    if (fs.existsSync(distPath)) {
        app.use(express.static(distPath, {
            etag: true,
            lastModified: true,
            setHeaders: (res, filePath) => {
                if (filePath.endsWith('.html')) {
                    // HTML must not be cached so every request gets the latest shell and asset URLs.
                    res.setHeader('Cache-Control', 'no-store');
                } else if (/[.-][a-zA-Z0-9]{8,}\.(js|css)$/i.test(path.basename(filePath))) {
                    // Content-hashed assets (e.g. user-abc12def.js, main-abc12def.css) are immutable.
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                } else if (/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp)$/i.test(filePath)) {
                    // Other static assets: long cache (1 year). Hashed assets handled above.
                    res.setHeader('Cache-Control', 'public, max-age=31536000');
                } else {
                    res.setHeader('Cache-Control', 'public, max-age=31536000');
                }
            }
        }));
    } else {
        throw new Error('Dist path not found');
        //app.use(express.static(path.join(distPath)));
    }
} catch(ex) {
    console.error('### Error serving static files', ex);
}
//app.use('/node_modules', express.static(path.join(__dirname, '../node_modules')));

// Explicitly short-circuit requests for the Material Design Icons sourcemap
app.get('/vendor/mdi/css/materialdesignicons.css.map', (req, res) => {
    res.status(204).end();
});

// Serve Apple Touch Icons to avoid 404s from iOS/Safari automatic requests
app.get('/favicon.ico', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.sendFile(path.join(distPath, 'assets/images/favicon.png'));
});

app.get('/apple-touch-icon.png', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.sendFile(path.join(distPath, 'assets/images/favicon.png'));
});
app.get('/apple-touch-icon-precomposed.png', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.sendFile(path.join(distPath, 'assets/images/favicon.png'));
});
app.get('/apple-touch-icon-120x120-precomposed.png', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.sendFile(path.join(distPath, 'assets/images/favicon.png'));
});

// robots.txt to discourage social preview crawlers that cause noisy requests
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(
        `User-agent: *
        Disallow: /
        `
    );
});

/* --------------------------------------------------------------------------------------------------------------- */
/* Routes                                                                                                          */
/* --------------------------------------------------------------------------------------------------------------- */
async function refreshDeploymentsCache() {
    if (isTestMode()) {
        const test = getTestDeployment();
        deploymentsCache = [test];
        tokensCache = [test.token];
        return;
    }

    const res = await getAllDeployments();

    //console.log('### refreshDeploymentsCache: res: ', res);

    if (res && res.success) {
        deploymentsCache = res.deployments || [];
        //console.log('### SUCCESS refreshDeploymentsCache: Deployments cache: ', deploymentsCache);
        // also update tokens array
        tokensCache = deploymentsCache.map(d => d.token);
        //console.log('### SUCCESS refreshDeploymentsCache: Tokens cache: ', tokensCache);
    } else {
        console.error('### ERROR refreshDeploymentsCache: Failed to load deployments from Firestore', res?.error);
        deploymentsCache = [];
        tokensCache = [];
    }
}
//refreshDeploymentsCache();

// Function to check if a token is valid
async function isValidToken(token) {
    if (!token || typeof token !== 'string') {
        console.error('### isValidToken: Tokens cache not found');
        return false
    }
    if (!isAllowedToken(token)) {
        console.warn('### isValidToken: rejected in APP_MODE=test', token);
        return false;
    }
    await refreshDeploymentsCache();
    //console.log('### isValidToken: Tokens cache: ', tokensCache);
    if (tokensCache.includes(token)) {
        //console.log('### isValidToken: Token found in tokens cache', 'token:', token);
        return true;
    } 
    return false;  
}
// Helper to safely send HTML files from dist.
// Sets Cache-Control: no-store so the app shell is never cached (prevents stale deploys on Render).
function safeSendFile(res, fileName, statusCode = 200) {
    res.setHeader('Cache-Control', 'no-store');
    const sendFrom = (base) => new Promise((resolve, reject) => {
        res.status(statusCode).sendFile(path.join(base, fileName), (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
    return sendFrom(distPath)
        .catch((err) => {
            console.error('### Error sending file:', err, 'fileName:', fileName, 'statusCode:', statusCode);
            res.redirect(LEGACY_PARTICIPANT_ERROR_PAINT);
        });
}

if(DEBUG_MODE_ENABLED) {
    app.get('/', async (req, res) => {
        await safeSendFile(res, 'index.html', 200);
    });
}
app.get('/go/i/:token', async (req, res) => {
    const token = req.params.token;
    if (await isValidToken(token)) {
        await safeSendFile(res, 'index.html', 200);
    } else {
        const retry = req.query && req.query.retry;
        res.status(302);
        if (retry === '1' || retry === 'true') {
            res.redirect(LEGACY_PARTICIPANT_ERROR_PAINT);
        } else {
            res.redirect(`${PARTICIPANT_USER_APP_ORIGIN}/go/i/${encodeURIComponent(token)}?retry=1`);
        }
    }
});

app.get('/producer/:token', async (req, res) => {
    const token = req.params.token;
    //console.log('### Producer token: ', token);
    if (await isValidToken(token)) {
        await safeSendFile(res, 'producer.html', 200);
    } else {
        res.status(404);
        await safeSendFile(res, '500.html', 404);
    }
});

app.get('/output/:token', async (req, res) => {
    const token = req.params.token;
    if (await isValidToken(token)) {
        await safeSendFile(res, 'output.html', 200);
    } else {
        res.status(404);
        await safeSendFile(res, '500.html', 404);
    }
});

app.get('/helper/:token', async (req, res) => {
    const token = req.params.token;
    if (await isValidToken(token)) {
        await safeSendFile(res, 'helper.html', 200);
    } else {
        res.status(404);
        await safeSendFile(res, '500.html', 404);
    }
});

// place this middleware BEFORE the 404 catch-all
app.use((req, res, next) => {
    if (req.url.startsWith('/socket.io/')) {
      // Let the Socket.IO server handle this; don't touch
      return next(); 
    }
    next();
});

// catch-all → serve custom error page so provider page is avoided
app.use(async (req, res) => {
        res.status(302);
        res.redirect(LEGACY_PARTICIPANT_ERROR_PAINT);
});

app.use(async (err, req, res, next) => {
    // Log for you, but don’t leak internals
    console.error(err);
  
    // If headers already sent, let Express finish
    if (res.headersSent) return next(err);
  
    res.status(302);
    res.redirect(LEGACY_PARTICIPANT_ERROR_PAINT);
});

/* --------------------------------------------------------------------------------------------------------------- */
/* Socket.IO connection handling                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
io.on('connection', async (socket) => {
    await refreshDeploymentsCache();

    /* ----------------------------------------------------------------------------- */
    /* Load test                                                                     */
    /* ----------------------------------------------------------------------------- */
    if(DEBUG_MODE_ENABLED) {
        registerTestHandlers(socket, {
            convertTimestampToHumanReadableDate,
            //updateSnapshot,
            getFirebaseAssets,
            getFirebaseSettings,
            setLocalStats
        });
    }
    /* ----------------------------------------------------------------------------- */
    /* Socket error handling                                                         */
    /* ----------------------------------------------------------------------------- */
    socket.on('error', (err) => {
        const token = socket.data.token; //get the token from the socket data
        const firestoreRoot = socket.data.firestoreRoot; //get the firestore root from the socket data
        //log the error
        if(token) {
            console.error('### Socket error:', err, ', socket.id:', socket.id, ', token:', token, ', Project Name:', firestoreRoot);
        } else {
            console.error('### Socket error:', err, ', socket.id:', socket.id, ', no token found');
        }
    });

    /* ----------------------------------------------------------------------------- */
    /* DEBUG: Log messages from the user                                             */
    /* ----------------------------------------------------------------------------- */
    socket.on('log', (log) => {
        if(DEBUG_MODE_ENABLED) {
            console.debug('DEBUG: User', 'Project Name:', socket.data.firestoreRoot, ', socketId:', socket.id, ', Log:', log);
        }
    });

    /* ----------------------------------------------------------------------------- */
    /* Helper (add new deployment to the deployments db)                             */
    /* ----------------------------------------------------------------------------- */
    socket.on('helper-add-deployment', async (data, ack) => {
        if (isTestMode()) {
            if (typeof ack === 'function') return ack({ success: false, error: 'APP_MODE=test blocks adding deployments' });
            return;
        }
        try {
            // Validate
            const isValid = data && typeof data === 'object' &&
                typeof data.displayName === 'string' && data.displayName.trim() !== '' &&
                typeof data.firestoreRoot === 'string' && data.firestoreRoot.trim() !== '' &&
                typeof data.token === 'string' && data.token.trim() !== '';
            if (!isValid) {
                if (typeof ack === 'function') return ack({ success: false, error: 'Invalid deployment data' });
                return;
            }
            const result = await updateDeploymentsDb({
                displayName: data.displayName.trim(),
                firestoreRoot: data.firestoreRoot.trim(),
                token: data.token.trim()
            });
            if (!(result && result.success)) {
                if (typeof ack === 'function') return ack({ success: false, error: result?.error || 'Failed to add deployment' });
                return;
            }

            // After success, copy default templates from 'baseSettings' to the new firestoreRoot
            try {
                const copyRes = await copyCollection('baseSettings', data.firestoreRoot.trim());
                if (!(copyRes && copyRes.success)) {
                    if (typeof ack === 'function') return ack({ success: false, error: copyRes?.error || 'Failed to copy default collection' });
                    return;
                }
                // Refresh deployments list for this helper client from Firestore
                await refreshDeploymentsCache();
                socket.emit('deployments', deploymentsCache);
            } catch (copyErr) {
                if (typeof ack === 'function') return ack({ success: false, error: copyErr?.message || String(copyErr) });
                return;
            }

            if (typeof ack === 'function') return ack({ success: true });
        } catch (err) {
            console.error('### helper-add-deployment error', err);
            if (typeof ack === 'function') return ack({ success: false, error: err?.message || String(err) });
        }
    });

    /* ----------------------------------------------------------------------------- */
    /* Helper (update deployment feature flags: isMLB, gateRecordingEnabled)        */
    /* ----------------------------------------------------------------------------- */
    socket.on('helper-update-deployment-flags', async ({ firestoreRoot, flags } = {}, ack) => {
        console.log('### helper-update-deployment-flags', firestoreRoot, flags);
        if (isTestMode()) {
            if (typeof ack === 'function') return ack({ success: false, error: 'APP_MODE=test blocks updating live deployment flags' });
            return;
        }
        try {
            if (!firestoreRoot || typeof firestoreRoot !== 'string' || !flags || typeof flags !== 'object') {
                if (typeof ack === 'function') return ack({ success: false, error: 'Invalid firestoreRoot or flags' });
                return;
            }
            const allowedKeys = ['isMLB', 'gateRecordingEnabled', 'requestMic', 'recordingSlider'];
            const sanitized = {};
            for (const key of allowedKeys) {
                if (key in flags) sanitized[key] = Boolean(flags[key]);
            }
            if (Object.keys(sanitized).length === 0) {
                if (typeof ack === 'function') return ack({ success: false, error: 'No valid flags provided' });
                return;
            }
            const result = await updateDeploymentFlags(firestoreRoot, sanitized);
            if (!result.success) {
                if (typeof ack === 'function') return ack({ success: false, error: result.error || 'Failed to update flags' });
                return;
            }
            await refreshDeploymentsCache();
            // Push updated flags to all connected sockets in this deployment's room
            const updatedEntry = deploymentsCache.find(e => e && e.firestoreRoot === firestoreRoot);
            if (updatedEntry?.token) {
                try {
                    const freshSettings = await getFirebaseSettings(updatedEntry.token, firestoreRoot);
                    console.log('### freshSettings', freshSettings);
                    const room = io.sockets.adapter.rooms.get(updatedEntry.token);
                    if (room) {
                        for (const sid of room) {
                            const s = io.sockets.sockets.get(sid);
                            if (!s) continue;
                            if (s.data.role === 'user' || s.data.role === 'output') {
                                s.emit('settings', buildUserSettings(freshSettings, updatedEntry));
                            } else if (s.data.role === 'producer') {
                                s.emit('settings', Object.assign({}, freshSettings, {
                                    isMLB: updatedEntry.isMLB || false,
                                    gateRecordingEnabled: updatedEntry.gateRecordingEnabled || false,
                                    requestMic: updatedEntry.requestMic || false,
                                    recordingSlider: updatedEntry.recordingSlider !== false
                                }));
                            }
                        }
                    }
                } catch (broadcastErr) {
                    console.error('### helper-update-deployment-flags broadcast error', broadcastErr);
                }
            }
            if (typeof ack === 'function') return ack({ success: true });
        } catch (err) {
            console.error('### helper-update-deployment-flags error', err);
            if (typeof ack === 'function') return ack({ success: false, error: err?.message || String(err) });
        }
    });

    /* ----------------------------------------------------------------------------- */
    /* Connection & settings                                                         */
    /* ----------------------------------------------------------------------------- */
    socket.on('output-connected', (token, timestamp) => {
        checkTokenAndJoinRoom(token, socket,'output', timestamp)
    });

    socket.on('helper-connected', async (token, timestamp) => {
        checkTokenAndJoinRoom(token, socket,'helper', timestamp)
    });

    socket.on('producer-connected', async (token, timestamp) => {
        checkTokenAndJoinRoom(token, socket,'producer', timestamp)
    });

    socket.on('user-connected', async (token, timestamp) => {
        checkTokenAndJoinRoom(token, socket,'user', timestamp)
    });

    socket.on('torch-connected', async (token, timestamp, full) => {
        const humanReadableDate = convertTimestampToHumanReadableDate(timestamp);
        socket.data.torch = true;
        socket.data.token = token;
        socket.data.torchConnectedAt = humanReadableDate;
        socket.data.full = full;

        console.log('### torch-connected', { token, cameraPosition: full?.cameraPosition, strategy: full?.strategy, captureSettings: full?.captureSettings, resolutionFlipped: full?.resolutionFlipped });
        if (full?.resolutionFlipped) console.log('### camera resolution was flipped (landscape -> retried with width/height swapped)');

        //console.log('### torch-connected: timelines[token]: ', timelines[token]);
        if(timelines[token] && lwModeByToken[token] !== 'lightwave') {
            //console.log('### torch-connected & timelines[token] exists');
            socket.emit('play', {timeline: timelines[token], sentAt: timelines[token].startTime});
        }
        try {
            lwWave.lw_emitStatus(io, token);
        } catch (e) {
            console.error('### lw_emitStatus error (torch-connected)', e);
        }
        /*
        try {
            updateSnapshot(socket, 'torch_connected');
        } catch (e) {
            console.error('### torch_connected snapshot error', e);
        }
        */

        try {
            await setLocalStats(socket.data, 'torch_connected');
        } catch (e) {
            console.error('### setLocalStats error (torch_connected)', socket.data, 'error:', e);
        }
    });

    socket.on('torch-connect-failed', async (token, timestamp, full) => {
        const humanReadableDate = convertTimestampToHumanReadableDate(timestamp);
        socket.data.torchConnectedAt = null;
        socket.data.torchDisconnectedAt = humanReadableDate;
        socket.data.torch = false;
        socket.data.token = token;
        socket.data.full = full || {};
        console.log('### torch-connect-failed', { token, message: full?.message, cameraPosition: full?.cameraPosition, strategy: full?.strategy, captureSettings: full?.captureSettings, attemptsCount: full?.attempts?.length });
        const attempts = Array.isArray(full?.attempts) ? full.attempts : [];
        socket.data.torchError = attempts[2]?.error || attempts[1]?.error || attempts[0]?.error || 'Unknown error';
        socket.data.device = full?.device || 'Unknown device';
        socket.data.message = full?.message || 'Unknown message';
        /*
        try {
            updateSnapshot(socket, 'torch-connect-failed');
        } catch (e) {
            console.error('### torch-connect-failed snapshot error', e);
        }
        */
        try {
            await setLocalStats(socket.data, 'torch_connect_failed');
        } catch (e) {
            console.error('### setLocalStats error (torch_connect_failed)', socket.data, 'error:', e);
        }
    });

    socket.on('torch-disconnected', async (token, timestamp) => {
        const humanReadableDate = convertTimestampToHumanReadableDate(timestamp);
        socket.data.torch = false; 
        socket.data.torchDisconnectedAt = humanReadableDate;
        try {
            await setLocalStats(socket.data, 'torch_disconnected');
        } catch (e) {
            console.error('### setLocalStats error (torch_disconnected)', socket.data, 'error:', e);
        }
    });
    /* ----------------------------------------------------------------------------- */
    /* Producer Controls                                                             */
    /* ----------------------------------------------------------------------------- */
    /*
    socket.on('android-playback-lead-ms', (token, androidPlaybackLeadMs) => {
        socket.data.androidPlaybackLeadMs = androidPlaybackLeadMs;
        console.log('Android playback lead ms: ', androidPlaybackLeadMs);
        io.to(token).emit('android-playback-lead-ms', androidPlaybackLeadMs);
    });
    */

    socket.on('lock', async (token, timestamp) => {
        
        if(socket.data.effects) {
            socket.data.effects.forEach(effect => {
                if(effect.active) {
                    effect.stopDateTime = Date.now();
                    effect.active = false;
                }
            });
        }
        if(pingIntervals[token]) {delete pingIntervals[token];} //delete the ping interval from the pingIntervals object if the type is show-end
        // Notify all clients in the room (including users) so they show end card
        console.log('### emitting stop show-end to all clients in the room', token);
        io.to(token).emit('stop', 'show-end');
        const humanReadableDate = convertTimestampToHumanReadableDate(timestamp);
        /*
        try {
            updateSnapshot(socket, 'lock');
        } catch (e) {
            console.error('### lock snapshot error', e);
        }
            */
        try {
            await setLocalStats(socket.data, 'lock');
        } catch (e) {
            console.error('### setLocalStats error (lock)', socket.data, 'error:', e);
        }


    });

    socket.on('unlock', async (token, timestamp) => {
        /*
        try {
            updateSnapshot(socket, 'unlock');
        } catch (e) {
            console.error('### unlock snapshot error', e);
        }
        */
        try {
            await setLocalStats(socket.data, 'unlock');
        } catch (e) {
            console.error('### setLocalStats error (unlock)', socket.data, 'error:', e);
        }
        // Notify users already on the page so they can refresh and rejoin the unlocked show
        if (token) io.to(token).emit('show-unlocked');
    });

    socket.on('lw_pose-log', (payload = {}) => {
        const kinds = new Set(['permission', 'first-sample', 'no-sample', 'pose', 'heartbeat', 'stop']);
        const kind = payload && payload.kind;
        if (!kinds.has(kind)) return;
        if (typeof payload.permission === 'string') {
            socket.data.lw_motionPermission = payload.permission;
        }
        const samples = Number(payload.samples);
        if (kind === 'first-sample' || (Number.isFinite(samples) && samples > 0)) {
            socket.data.lw_motionSampling = true;
        }
        console.log('### lw_pose', {
            token: socket.data.token,
            socketId: socket.id,
            section: socket.data.lw_section || null,
            kind,
            permission: payload.permission,
            pose: payload.pose,
            samples: Number.isFinite(samples) ? samples : payload.samples,
            angleDeg: payload.angleDeg,
            torchUp: payload.torchUp,
        });
        if (kind === 'permission' || kind === 'first-sample' || kind === 'no-sample') {
            try {
                lwWave.lw_emitStatus(io, socket.data.token);
            } catch (e) {
                console.error('### lw_emitStatus error (lw_pose-log)', e);
            }
        }
    });

    socket.on('lw_section', (payload = {}) => {
        const token = payload.token || socket.data.token;
        if (socket.data.role !== 'user') return;
        const section = lwWave.lw_normalizeSection(payload.section);
        if (!section) return;
        socket.data.lw_section = section;
        socket.data.token = token || socket.data.token;
        try {
            lwWave.lw_emitStatus(io, socket.data.token);
        } catch (e) {
            console.error('### lw_emitStatus error (lw_section)', e);
        }
    });

    socket.on('lw_wave-start', (payload = {}) => {
        if (socket.data.role !== 'producer') return;
        const token = payload.token || socket.data.token;
        if (!token) return;
        lwWave.lw_startWave(io, token, payload);
    });

    socket.on('lw_wave-stop', (payload = {}) => {
        if (socket.data.role !== 'producer') return;
        const token = payload.token || socket.data.token;
        if (!token) return;
        lwWave.lw_stopWave(io, token, payload.waveId);
    });

    socket.on('play-program', (token, program) => {
        if (lwModeByToken[token] === 'lightwave') {
            console.log('### play-program ignored, lightwave mode', token);
            return;
        }
        socket.data.effects ??= [];
        // stop any active effects on this socket (bookkeeping only)
        for (const e of socket.data.effects) {
            if (e.active) {
                e.stopDateTime = Date.now();
                e.active = false;
            }
        }
        const effect = {
            name: program.name,
            startDateTime: Date.now(),
            stopDateTime: null,
            active: true,
        };
        socket.data.effects.push(effect);

        // Always loop; remove consumer-facing loop flag
        const prog = {
            ...program,
            loop       : true,
            startDelay : 0, //(parseInt(program.startDelay || 0, 10) + TIMELINE_LEAD_MS),
            startDateTime: Date.now(), // anchor on server wallclock
        };
        const timeline = buildDJTimeline(prog);
        timelines[token] = timeline;
        io.to(token).emit('play', {timeline: timeline, sentAt: timeline.startTime});
        /*
        try {
            updateSnapshot(socket, 'effect');
        } catch (e) {
            console.error('### effect snapshot error', e);
        }
        */
    });

    socket.on('stop-program', (token, program, type) => {

        if (!Array.isArray(socket.data.effects)) {
            socket.data.effects = [];
        }
        const effect = socket.data.effects.find(effect => effect && effect.name === program && effect.active);
        if(!effect) {
            //console.error('### Effect not found', 'token:', token, ', program:', program);
        } else {
            effect.stopDateTime = Date.now();
            effect.active = false;
        }

        //console.log('Stop program', ', token:', token, ', program:', program, ', type:', type);
        delete timelines[token]; //delete the timeline from the timelines object
        io.to(token).emit('stop', type); //send the stop event to all connected sockets with the matching token
        /*
        try {
            updateSnapshot(socket, 'effect');
        } catch (e) {
            console.error('### effect snapshot error', e);
        }
        */
    });
    
    socket.on('update-settings', async (token, settings) => {
        //console.log('### update-settings', settings);
        try {
            setFirebaseSettings(socket, settings, 'update');
        } catch (e) {
            console.error('### setFirebaseSettings snapshot error', e);
        }
    });

    socket.on('update-images', async (token, data) => {
        try {
            setFirebaseAssets(socket, data);
        } catch (e) {
            console.error('### setFirebaseAssets snapshot error', e);
        }
    });

    socket.on('update-programs', async (token, programs) => {
        try {
            setFirebasePrograms(socket, programs);
        } catch (e) {
            console.error('### setFirebasePrograms snapshot error', e);
        }
    });

    /* ----------------------------------------------------------------------------- */
    /* Disconnections                                                                */
    /* ----------------------------------------------------------------------------- */
    socket.on('disconnect', async () => {
        
        if(socket.data.role === 'user') {
            try {
                await setLocalStats(socket.data, 'user_disconnected');
                if(socket.data.torch) {
                    try {
                        await setLocalStats(socket.data, 'torch_disconnected');
                    } catch (e) {
                        console.error('### setLocalStats error (torch_disconnected)', socket.data, 'error:', e);
                    }
                }
            } catch (e) {
                    console.error('### setLocalStats error (user_disconnected)', socket.data, 'error:', e);
            }
        }
        
        //console.log('### DISCONNECT, socket._events:', socket._events);     // log the socket events
        //console.log('### DISCONNECT, socket.data:', socket.data);           // log the socket data
        
        const token = socket.data.token;                        // get the token from the socket data
        
        if (token === undefined || token === null || token === '') {
            console.error('### DISCONNECT, token is undefined, null, or empty', socket.data);
        } else {
            //console.log('### DISCONNECT, token:', token);       // log the token
            //console.log('### DISCONNECT from the room:', io.sockets.adapter.rooms.get(token));       // log the room

            const room = io.sockets.adapter.rooms.get(token);   // get the room from the token
            //console.log('### DISCONNECT, room:', room);         // log the room after leaving the room (is it empty?)
            
            if (room === undefined || room.size === 0) {
                console.log('### ROOM EMPTY, REMOVED FROM CONNECTIONS', 'firestoreRoot:', socket.data.firestoreRoot, 'displayName:', socket.data.displayName);

                try {
                    await setLocalStats(socket.data, 'lock');
                } catch (e) {
                    console.error('### setLocalStats error (lock - empty room)', socket.data, 'error:', e);
                }

                if(socket.data.firestoreRoot !== undefined && socket.data.firestoreRoot !== null && socket.data.firestoreRoot !== '') {
                    try {
                        setLockedStateSingle(socket.data.firestoreRoot);
                    } catch (e) {
                        console.error('### setLockedStateSingle error', 'error:', e, 'socket.data:', socket.data);
                    }
                } else {
                    console.error('### setLockedStateSingle error, firestoreRoot is undefined, null, or empty', socket.data);
                }
            } else if (socket.data.role === 'user') {
                try {
                    lwWave.lw_emitStatus(io, token);
                } catch (e) {
                    console.error('### lw_emitStatus error (disconnect)', e);
                }
            }
        }
    });

    /* ----------------------------------------------------------------------------- */
    /* Server ready                                                                  */
    /* ----------------------------------------------------------------------------- */
    socket.emit('server-ready', Date.now(), socket.id);
});

/* --------------------------------------------------------------------------------------------------------------- */
/* Functions                                                                                                       */
/* --------------------------------------------------------------------------------------------------------------- */
function convertTimestampToHumanReadableDate(timestamp) {
    const date = new Date(timestamp);
    const humanReadableDate = date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' });
    return humanReadableDate;
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Build user-facing settings (injects deployment flags, gates maxRecordingDuration)                              */
/* --------------------------------------------------------------------------------------------------------------- */
function buildUserSettings(settings, deploymentEntry) {
    const s = Object.assign({}, settings);
    s.isMLB = deploymentEntry?.isMLB || false;
    s.requestMic = deploymentEntry?.requestMic || false;
    const recordingGated = deploymentEntry?.gateRecordingEnabled && s.recordingEnabled;
    if (recordingGated) {
        s.maxRecordingDuration = deploymentEntry?.recordingSlider === false
            ? 30
            : (typeof s.maxRecordingDuration === 'number' ? s.maxRecordingDuration : 30);
    } else {
        s.maxRecordingDuration = 0;
    }
    return s;
}

async function checkTokenAndJoinRoom(token, socket, role, timestamp) {

    // ensure token is in the tokens array
    if (!await isValidToken(token)) {
        console.error('### checkTokenAndJoinRoom: Token not found', 'token:', token, 'role:', role);
        socket.emit('token-not-found', token);
        //disconnect the socket
        socket.disconnect(true);
        return;
    }

    socket.join(token);
    socket.data.role = role;
    socket.data.startedAt = convertTimestampToHumanReadableDate(timestamp);
    socket.data.token = token;
    
    const entry = deploymentsCache.find(entry => entry && entry.token === token);
    if (!entry) {
        console.error('### checkTokenAndJoinRoom: Token not found', 'token:', token, 'role:', role);
        socket.emit('token-not-found', token);
        socket.disconnect(true);
        return;
    }

    const checkFirestoreRootCollectionResult = await checkFirestoreRootCollection(entry.firestoreRoot);
    if (!checkFirestoreRootCollectionResult.success) {
        console.error('### checkTokenAndJoinRoom: Firestore root collection not found', 'firestoreRoot:', entry.firestoreRoot);
    }
    
    socket.data.firestoreRoot = entry.firestoreRoot;
    socket.data.displayName = entry.displayName;

    if(role === 'user') {
        try {
            await setLocalStats(socket.data, 'user_connected');
        } catch (e) {
            console.error('### setLocalStats error (user_connected)', socket.data, 'error:', e);
        }

        /*
        try {
            updateSnapshot(socket, 'user_connected');
        } catch (e) {
            console.error('### user_connected snapshot error', e);
        }
        */
    } 

    let assets = await getFirebaseAssets(token, socket.data.firestoreRoot);
    let customPrograms = null;
    let defaultPrograms = null;
    let settings = await getFirebaseSettings(token, socket.data.firestoreRoot);
    lwModeByToken[token] = settings && settings.mode === 'lightwave' ? 'lightwave' : 'default';
    
    if (role === 'producer') {
        defaultPrograms = await getFirebaseProgramsDefault(token, 'lightShow');
        customPrograms = await getFirebasePrograms(token, socket.data.firestoreRoot);
        const producerSettings = Object.assign({}, settings, {
            isMLB: entry.isMLB || false,
            gateRecordingEnabled: entry.gateRecordingEnabled || false,
            requestMic: entry.requestMic || false,
            recordingSlider: entry.recordingSlider !== false
        });
        const gateRecordingEnabled = entry.gateRecordingEnabled || false;
        socket.emit('assets-settings-programs', assets, producerSettings, customPrograms, defaultPrograms, socket.data.displayName || 'Unknown', gateRecordingEnabled);
        try {
            lwWave.lw_emitStatus(io, token);
        } catch (e) {
            console.error('### lw_emitStatus error (producer-connected)', e);
        }
    } else if ( role === 'helper') {
        // send the full deployments list from Firestore to the helper
        await refreshDeploymentsCache();
        socket.emit('deployments', deploymentsCache);
        socket.emit('display-name', socket.data.displayName || 'Unknown');
    } else if (role === 'output' || role === 'user') {
        //add the isMLB flag to the settings
        settings.isMLB = entry.isMLB;
        // If the show is locked, send stop before assets so the user never sees the join UI
        if (role === 'user' && settings && settings.locked) {
            //console.log('### Show is locked, sending show-locked to user', 'token:', token);
            //console.log('### Auto redirect', settings.autoRedirect);
            //console.log('### MLB', settings.isMLB);
            //console.log('### Redirect URL', settings.redirectUrl);
            console.log('### isMLB',entry.displayName, entry.isMLB);

            //socket.emit('stop', 'show-end');
            socket.emit('show-locked', settings, assets);
            return;
        }
        socket.emit('assets-settings', assets, buildUserSettings(settings, entry), socket.data.displayName || 'Unknown');
    } else {
        console.error('### Invalid role', 'token:', token, 'role:', role, 'firestoreRoot:', socket.data.firestoreRoot, 'displayName:', socket.data.displayName);
    }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* List Rooms                                                                                                      */
/* --------------------------------------------------------------------------------------------------------------- */
async function listRooms() {
    if(tokensCache.length === 0 || tokensCache.length === undefined || tokensCache.length === null) {
        await refreshDeploymentsCache();
    }
    //loop through all the tokens, for each token find the corresponding room and log each room, the room name, the number of sockets in the room, the role of the sockets in the room, and the torch state
    for (var i = 0; i < tokensCache.length; i++) {
        const entry = deploymentsCache.find(entry => entry && entry.token === tokensCache[i]);

        //check to see if the there is a room for the token
        if(io.sockets.adapter.rooms.get(tokensCache[i])) {
            let userCount = 0;
            let producerCount = 0;
            let outputCount = 0;
            let helperCount = 0;
            let torchCount = 0;
            const room = io.sockets.adapter.rooms.get(tokensCache[i]);
            let displayName = '';

            if (entry) {
                displayName = entry.displayName;
            }

            console.log('---------------------------');
            console.log(displayName, ' connections:', room.size);
            //console.log('Total connections in room:', room.size);
            //loop through the room and log the socket id and the data of the socket
            for (const socketId of room) {
                const socket = io.sockets.sockets.get(socketId);
                //count the number of sockets in the room by the role of the socket
                if(socket.data.role === 'user') {
                    userCount++;
                    if(socket.data.torch) {
                        torchCount++;
                    }
                } else if(socket.data.role === 'producer') {
                    producerCount++;
                } else if(socket.data.role === 'output') {
                    outputCount++;
                } else if(socket.data.role === 'helper') {
                    helperCount++;
                } 
                //console.log('---------------------------');
                //console.log('Socket.id:', socket.id);
                //console.log('Socket:', socket.data);
            }
            //console.log('---------------------------');
            //console.log('Users:', userCount);
            //console.log('Torches:', torchCount);
            //console.log('Producers:', producerCount);
            //console.log('Outputs:', outputCount);
            //console.log('Helpers:', helperCount);
            //console.log('---------------------------');
        } else {
            //if there is no room for the token, set the settings.locked to true for the firestoreRoot associated with this token
            // use entry.firestoreRoot to get the firestoreRoot
            if (entry) {
                try {
                    setLockedStateSingle(entry.firestoreRoot);
                } catch (e) {
                    console.error('### setLockedStateSingle snapshot error', e);
                }
            } else {
                logError('No entry found for token', 'token:', tokensCache[i]);
            }
        }
    }
}

// set an interval to list the rooms every 10 seconds
//setInterval(listRooms, 10000);
// on startup check the locked state of the rooms
listRooms();

/* --------------------------------------------------------------------------------------------------------------- */
/* GET Functions                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
async function getFirebaseAssets(token, firestoreRoot) {
    const assets = await getAssets(firestoreRoot);
    if (assets.success) {
        return assets.assets;
    } else {
        logError('get assets', token, firestoreRoot);
        return null;
    }
}

async function getFirebaseProgramsDefault(token, firestoreRoot) {
    const programs = await getPrograms(firestoreRoot);
    if (programs.success) {
        return programs.programs.default;
    } else {
        logError('get programs default', token, firestoreRoot);
        return null;
    }
}

async function getFirebasePrograms(token, firestoreRoot) {
    const programs = await getPrograms(firestoreRoot);
    if (programs.success) {
        return programs.programs.custom;
    } else {
        logError('get programs custom', token, firestoreRoot);
        return null;
    }
}

async function getFirebaseSettings(token, firestoreRoot) {
    const result = await getSettings(firestoreRoot);
    if (result.success) {
        return result.settings;
    } else {
        logError('get settings', token, firestoreRoot);
        return null;
    }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* SET Functions                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
async function setFirebaseSettings(socket, settings, type) {
    //console.log('### Set settings settings', settings);
    //console.log('### Set settings type', type);
    const result = await setSettings(settings, socket.data.firestoreRoot, type);
    //console.log('### Set settings result', result);
    if(result.success) {
        //console.log('### Set settings SUCCESS', 'token:', socket.data.token);
        const freshSettings = await getFirebaseSettings(socket.data.token, socket.data.firestoreRoot);
        const token = socket.data.token;
        lwModeByToken[token] = freshSettings && freshSettings.mode === 'lightwave' ? 'lightwave' : 'default';
        if (lwModeByToken[token] !== 'lightwave') {
            try {
                lwWave.lw_stopWave(io, token);
            } catch (e) {
                console.error('### lw_stopWave error (mode off)', e);
            }
        }
        const entry = deploymentsCache.find(e => e && e.token === token);
        // Broadcast per-socket so users receive deployment-gated settings (isMLB, maxRecordingDuration)
        const room = io.sockets.adapter.rooms.get(token);
        if (room) {
            for (const sid of room) {
                const s = io.sockets.sockets.get(sid);
                if (!s) continue;
                if (s.data.role === 'user' || s.data.role === 'output') {
                    s.emit('settings', buildUserSettings(freshSettings, entry));
                } else if (s.data.role === 'producer') {
                    s.emit('settings', Object.assign({}, freshSettings, {
                        isMLB: entry?.isMLB || false,
                        gateRecordingEnabled: entry?.gateRecordingEnabled || false,
                        requestMic: entry?.requestMic || false,
                        recordingSlider: entry?.recordingSlider !== false
                    }));
                }
            }
        }
    } else {
        logError('Set settings', socket.data.token, socket.data.firestoreRoot);
    }
}

async function setFirebaseAssets(socket, data) {
    const result = await setAssets(data, socket.data.firestoreRoot);
    if(result.success) {
        //console.log('### Set assets SUCCESS', 'token:', socket.data.token);
        let assets = await getFirebaseAssets(socket.data.token, socket.data.firestoreRoot);
        let token = socket.data.token;
        io.to(token).emit('assets', assets);
    } else {
        logError('Set assets', socket.data.token, socket.data.firestoreRoot);
    }
}

async function setFirebasePrograms(socket, programs) {
    const result = await setPrograms(programs, socket.data.firestoreRoot);
    if(result.success) {
        //console.log('### Set programs SUCCESS', 'token:', socket.data.token);
        let programs = await getFirebasePrograms(socket.data.token, socket.data.firestoreRoot);
        let token = socket.data.token;
        if(programs) {
            //console.log('### Get programs SUCCESS', programs);
            let token = socket.data.token;
            const room = io.sockets.adapter.rooms.get(token);
            if (room && room.size > 0) {
                for (const socketId of room) {
                    const socket = io.sockets.sockets.get(socketId);
                    if(socket?.data?.role === 'producer') {
                        socket.emit('custom-programs', programs);
                    }
                }
            }
        } else {
            logError('get programs', socket.data.token, socket.data.firestoreRoot);
        }
    } else {
        logError('Set programs', socket.data.token, socket.data.firestoreRoot);
    }
}

async function setLockedStateSingle(firestoreRoot) {
    
    const collectionCheckResult = await checkFirestoreRootCollection(firestoreRoot);
    if(!collectionCheckResult.success) {
        console.error('### setLockedStateSingle: Firestore root collection not found', 'firestoreRoot:', firestoreRoot);
        return;
    }

    const settings = {
        locked: true
    };
    const result = await setSettings(settings, firestoreRoot, 'addLockedState');
    if(result.success) {
        //console.log('### Set locked state SUCCESS', 'firestoreRoot:', firestoreRoot);
    } else {
        logError('Set locked state', firestoreRoot);
    }
}
/* --------------------------------------------------------------------------------------------------------------- */
/* Build DJ Timeline                                                                                              */
/* --------------------------------------------------------------------------------------------------------------- */
function buildDJTimeline(data) {
    const startTime  = data.startDateTime;
    const timeline   = [];
    let cursor       = startTime;
    let loopDuration = 0;
  
    for (const effect of data.playlist) {
      const start = cursor;
      const end   = start + effect.duration;
      timeline.push({ ...effect, start, end });
      cursor       = end;
      loopDuration += effect.duration;
    }
  
    return {
      name        : data.name,
      startTime,              // absolute wallclock (ms)
      timeline,               // absolute ms for 1 cycle
      loop        : true,     // always true
      maxLoops    : Infinity,
      loopDuration
    };
  }

/* --------------------------------------------------------------------------------------------------------------- */
/* ERROR LOGGING                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
async function logError(functionName, token, firestoreRoot) {
    console.error('### Failed to ', functionName, ', token:', token, ', firestoreRoot:', firestoreRoot);
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Memory usage && LOGGING                                                                                         */
/* --------------------------------------------------------------------------------------------------------------- */
function logMemoryUsage() {
    console.log('Memory Usage:');
    const memoryUsage = process.memoryUsage();
    console.log(`RSS: ${formatBytes(memoryUsage.rss)}`);
    console.log(`Heap Total: ${formatBytes(memoryUsage.heapTotal)}`);
    console.log(`Heap Used: ${formatBytes(memoryUsage.heapUsed)}`);
    console.log(`External: ${formatBytes(memoryUsage.external)}`);
    console.log('---------------------------');
    //getLocalStats();
}
  
function formatBytes(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}
  
// Log memory usage: call once and then every 30 seconds
//logMemoryUsage();
//setInterval(logMemoryUsage, 30000);

//log the local stats
getLocalStats();
setInterval(getLocalStats, LOCAL_STATS_INTERVAL);

/* --------------------------------------------------------------------------------------------------------------- */
/* Start server                                                                                                    */
/* --------------------------------------------------------------------------------------------------------------- */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  logTestModeBanner();
});  

/* --------------------------------------------------------------------------------------------------------------- */
/* TEMPORARY: SET LOCKED STATE                                                                                     */
/* --------------------------------------------------------------------------------------------------------------- */
function asStringArray(deployments) {
    if (Array.isArray(deployments)) return deployments;
    if (deployments && typeof deployments === 'object') return Object.values(deployments);
    return [];
}
  
/*
async function setLockedState(deployments) {
    const list = asStringArray(deployments);
    //itterate through the deployments object
    for (const entry of list[0]) {
        setLockedStateSingle(entry);
    }
}
*/
/*
async function getDatabasesFromFireStore() {
    let result = await getDatabases();
    //console.log('Databases from FireStore: ', result.deployments);
    setLockedState(result.deployments);
}
*/
/*
async function createDeploymentsDbFromPathsData() {
    //read the paths.json file
    const pathsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'paths.json'), 'utf8'));
    if(!pathsData) {
        console.log('### Failed to read paths.json file');
        return;
    }
    //console.log('Paths data: ', pathsData);
    //create the deployments db
    let result = await createDeploymentsDb(pathsData);
    if(!result.success) {
        console.log('### Create deployments db FAILED', 'data:', pathsData);
    }
}
*/
//copyFirestoreCollection('baseSettings', 'deployments');
//getDatabasesFromFireStore();
//setLockedState(); 
//createDeploymentsDbFromPathsData();

/* --------------------------------------------------------------------------------------------------------------- */
/* TEMPORARY: Import orgsAndTickets.js (optional)                                                                  */
/* --------------------------------------------------------------------------------------------------------------- */
//const { mappedOrgsAndTickets } = require('./orgsAndTickets.js');
/*
async function importOrgsAndTickets() {
    
    if(!mappedOrgsAndTickets) {
        console.log('### Mapped orgs and tickets not found');
        return;
    }
    // call a firebase function to update the deployments db with the mappedOrgsAndTickets

    //console.log('### Import orgs and tickets', 'mappedOrgsAndTickets:', mappedOrgsAndTickets);
    const result = await createDeploymentsDb(mappedOrgsAndTickets);
    if(!result.success) {
        console.log('### Import orgs and tickets FAILED', 'result:', result);
    } else {
        console.log('### Import orgs and tickets SUCCESS', 'result:', result);
    }
}
*/
//importOrgsAndTickets();

/* --------------------------------------------------------------------------------------------------------------- */
/* TEMPORARY: SET MLB STATE                                                                                        */
/* --------------------------------------------------------------------------------------------------------------- */
/*
async function setMLBState() {
    await refreshDeploymentsCache();
    //itterate through the deploymentsCache array
    for (const entry of deploymentsCache) {
        
        if (entry.displayName === 'Orioles - Baltimore' || entry.displayName === 'Nationals - Washington' || entry.displayName === 'Braves - Atlanta') {
            const settings = {
                isMLB: true
            };
            await setSettings(settings, entry.firestoreRoot, 'addMLBState');
        } else {
            const settings = {
                isMLB: false
            };
            await setSettings(settings, entry.firestoreRoot, 'addMLBState');
        }
        //Get the settings from the firestore root
        const settings = await getSettings(entry.firestoreRoot);
        console.log('### setMLBState: settings', settings);
    }

}
*/
//setMLBState();