/**
 * Lightwave server helpers: section sort, occupancy, and wave schedule.
 */

const LW_SECTION_PATTERN = /^(\d+)([A-Za-z])?$/;

function lw_normalizeSection(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim().toUpperCase();
    if (!text) return null;
    const match = text.match(LW_SECTION_PATTERN);
    if (!match) return null;
    const digits = match[1].replace(/^0+(?=\d)/, '');
    const letter = match[2] || '';
    return `${digits}${letter}`;
}

function lw_compareSections(a, b) {
    const na = lw_normalizeSection(a);
    const nb = lw_normalizeSection(b);
    if (na === null && nb === null) return 0;
    if (na === null) return 1;
    if (nb === null) return -1;
    const ma = na.match(LW_SECTION_PATTERN);
    const mb = nb.match(LW_SECTION_PATTERN);
    const numA = parseInt(ma[1], 10);
    const numB = parseInt(mb[1], 10);
    if (numA !== numB) return numA - numB;
    const letA = ma[2] || '';
    const letB = mb[2] || '';
    if (letA === letB) return 0;
    if (!letA) return -1;
    if (!letB) return 1;
    return letA.localeCompare(letB);
}

/**
 * @param {Array<{ data?: { role?: string, torch?: boolean, lw_section?: string, lw_motionPermission?: string, lw_motionSampling?: boolean } }>} sockets
 * @returns {{ section: string, count: number, motionGranted: number, sampling: number }[]}
 */
function lw_collectOccupiedFromSockets(sockets) {
    const counts = {};
    if (!Array.isArray(sockets)) return [];
    for (const socket of sockets) {
        const data = socket && socket.data ? socket.data : {};
        if (data.role !== 'user' || !data.torch) continue;
        const section = lw_normalizeSection(data.lw_section);
        if (!section) continue;
        if (!counts[section]) {
            counts[section] = { section, count: 0, motionGranted: 0, sampling: 0 };
        }
        counts[section].count += 1;
        if (data.lw_motionPermission === 'granted') counts[section].motionGranted += 1;
        if (data.lw_motionSampling) counts[section].sampling += 1;
    }
    return Object.keys(counts)
        .sort(lw_compareSections)
        .map((section) => counts[section]);
}

function lw_socketsInRoom(io, token) {
    const sockets = [];
    if (!io || !token) return sockets;
    const room = io.sockets.adapter.rooms.get(token);
    if (!room) return sockets;
    for (const sid of room) {
        const socket = io.sockets.sockets.get(sid);
        if (socket) sockets.push(socket);
    }
    return sockets;
}

function lw_collectOccupied(io, token) {
    return lw_collectOccupiedFromSockets(lw_socketsInRoom(io, token));
}

/**
 * One cue per occupied section. First GO is countdownMs after epoch so
 * the first section still sees a full 3-2-1 (see Section C.4).
 * @param {{ section: string, count?: number }[]|string[]} occupied
 * @param {{ epoch: number, delayMs: number, countdownMs?: number }} options
 */
function lw_buildSchedule(occupied, { epoch, delayMs, countdownMs = 0 } = {}) {
    const sections = [];
    const seen = new Set();
    const list = Array.isArray(occupied) ? occupied : [];
    for (const item of list) {
        const raw = typeof item === 'string' ? item : item && item.section;
        const section = lw_normalizeSection(raw);
        if (!section || seen.has(section)) continue;
        seen.add(section);
        sections.push(section);
    }
    sections.sort(lw_compareSections);
    const start = Number(epoch) || 0;
    const stagger = Number.isFinite(delayMs) ? delayMs : 400;
    const lead = Number.isFinite(countdownMs) ? Math.max(0, countdownMs) : 0;
    return sections.map((section, index) => ({
        section,
        goAt: start + lead + index * stagger,
    }));
}

/**
 * Wave front: the most recently started GO window that is still open.
 * @param {{ section: string, goAt: number }[]} schedule
 * @param {number} now
 * @param {number} torchMaxMs
 * @returns {string|null}
 */
function lw_activeSectionAt(schedule, now, torchMaxMs) {
    const cap = Number.isFinite(torchMaxMs) ? torchMaxMs : 3500;
    const rows = Array.isArray(schedule) ? schedule : [];
    let active = null;
    let latestGo = -Infinity;
    for (const row of rows) {
        const goAt = Number(row && row.goAt);
        if (!Number.isFinite(goAt)) continue;
        if (now >= goAt && now < goAt + cap && goAt >= latestGo) {
            latestGo = goAt;
            active = row.section || null;
        }
    }
    return active;
}

const waveStateByToken = new Map();

function lw_clearWaveTimers(token) {
    const state = waveStateByToken.get(token);
    if (state && Array.isArray(state.timers)) {
        for (const timer of state.timers) {
            clearTimeout(timer);
        }
    }
    waveStateByToken.delete(token);
}

function lw_statusPayload(io, token) {
    const occupied = lw_collectOccupied(io, token);
    const state = waveStateByToken.get(token);
    return {
        occupied,
        activeSection: state ? state.activeSection : null,
        waveId: state ? state.waveId : null,
    };
}

function lw_emitStatus(io, token) {
    const payload = lw_statusPayload(io, token);
    const sockets = lw_socketsInRoom(io, token);
    for (const socket of sockets) {
        if (socket.data && socket.data.role === 'producer') {
            socket.emit('lw_wave-status', payload);
        }
    }
    return payload.occupied;
}

function lw_startWave(io, token, timing = {}) {
    const torchMax = Number(timing.lw_torchMaxMs);
    const countdownSeconds = Number(timing.lw_countdownSeconds);
    const delayMs = Number(timing.lw_sectionDelayMs);
    const lw_torchMaxMs = Number.isFinite(torchMax) ? torchMax : 3500;
    const lw_countdownSeconds = Number.isFinite(countdownSeconds) ? countdownSeconds : 3;
    const lw_sectionDelayMs = Number.isFinite(delayMs) ? delayMs : 400;
    const lw_requireRaise = timing.lw_requireRaise !== false;
    const lw_offOnlyAtMax = timing.lw_offOnlyAtMax === true;
    const lw_loop = timing.lw_loop === true;
    const sentAt = Date.now();
    const waveId = `lw_${sentAt}`;
    const occupied = lw_collectOccupied(io, token);
    const schedule = lw_buildSchedule(occupied, {
        epoch: sentAt,
        delayMs: lw_sectionDelayMs,
        countdownMs: lw_countdownSeconds * 1000,
    });
    lw_clearWaveTimers(token);
    const timers = [];
    const state = {
        waveId,
        schedule,
        torchMaxMs: lw_torchMaxMs,
        activeSection: null,
        timers,
        loop: lw_loop,
        timing: {
            lw_torchMaxMs,
            lw_countdownSeconds,
            lw_sectionDelayMs,
            lw_requireRaise,
            lw_offOnlyAtMax,
            lw_loop,
        },
    };
    waveStateByToken.set(token, state);
    for (const row of schedule) {
        const delay = Math.max(0, row.goAt - Date.now());
        timers.push(setTimeout(() => {
            const current = waveStateByToken.get(token);
            if (!current || current.waveId !== waveId) return;
            current.activeSection = lw_activeSectionAt(current.schedule, Date.now(), current.torchMaxMs);
            lw_emitStatus(io, token);
        }, delay));
    }
    if (schedule.length) {
        const last = schedule[schedule.length - 1];
        const loopGapMs = lw_loop ? 4500 : 0;
        const endDelay = Math.max(0, last.goAt + lw_torchMaxMs + loopGapMs - Date.now());
        timers.push(setTimeout(() => {
            const current = waveStateByToken.get(token);
            if (!current || current.waveId !== waveId) return;
            if (current.loop) {
                lw_startWave(io, token, current.timing);
                return;
            }
            current.activeSection = null;
            lw_emitStatus(io, token);
            lw_clearWaveTimers(token);
        }, endDelay));
    }
    const sockets = lw_socketsInRoom(io, token);
    for (const row of schedule) {
        const cue = {
            waveId,
            section: row.section,
            goAt: row.goAt,
            sentAt,
            lw_torchMaxMs,
            lw_countdownSeconds,
            lw_requireRaise,
            lw_offOnlyAtMax,
            lw_loop,
        };
        for (const socket of sockets) {
            if (socket.data && socket.data.role === 'user' && lw_normalizeSection(socket.data.lw_section) === row.section) {
                socket.emit('lw_wave-cue', cue);
            }
        }
    }
    lw_emitStatus(io, token);
    console.log('### lw_wave-start', { token, waveId, sections: schedule.map((s) => s.section) });
    return { waveId, schedule, occupied };
}

function lw_stopWave(io, token, waveId) {
    const state = token ? waveStateByToken.get(token) : null;
    const id = waveId || (state && state.waveId) || `lw_${Date.now()}`;
    lw_clearWaveTimers(token);
    if (io && token) {
        io.to(token).emit('lw_wave-stop', { token, waveId: id });
        lw_emitStatus(io, token);
    }
    console.log('### lw_wave-stop', { token, waveId: id });
    return id;
}

module.exports = {
    lw_normalizeSection,
    lw_compareSections,
    lw_collectOccupiedFromSockets,
    lw_collectOccupied,
    lw_buildSchedule,
    lw_activeSectionAt,
    lw_emitStatus,
    lw_startWave,
    lw_stopWave,
};
