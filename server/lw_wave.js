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
 * @param {Array<{ data?: { role?: string, torch?: boolean, lw_section?: string } }>} sockets
 * @returns {{ section: string, count: number }[]}
 */
function lw_collectOccupiedFromSockets(sockets) {
    const counts = {};
    if (!Array.isArray(sockets)) return [];
    for (const socket of sockets) {
        const data = socket && socket.data ? socket.data : {};
        if (data.role !== 'user' || !data.torch) continue;
        const section = lw_normalizeSection(data.lw_section);
        if (!section) continue;
        counts[section] = (counts[section] || 0) + 1;
    }
    return Object.keys(counts)
        .sort(lw_compareSections)
        .map((section) => ({ section, count: counts[section] }));
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

function lw_emitStatus(io, token) {
    const occupied = lw_collectOccupied(io, token);
    const sockets = lw_socketsInRoom(io, token);
    for (const socket of sockets) {
        if (socket.data && socket.data.role === 'producer') {
            socket.emit('lw_wave-status', { occupied });
        }
    }
    return occupied;
}

function lw_startWave(io, token, timing = {}) {
    const torchMax = Number(timing.lw_torchMaxMs);
    const countdownSeconds = Number(timing.lw_countdownSeconds);
    const delayMs = Number(timing.lw_sectionDelayMs);
    const lw_torchMaxMs = Number.isFinite(torchMax) ? torchMax : 2000;
    const lw_countdownSeconds = Number.isFinite(countdownSeconds) ? countdownSeconds : 3;
    const lw_sectionDelayMs = Number.isFinite(delayMs) ? delayMs : 400;
    const sentAt = Date.now();
    const waveId = `lw_${sentAt}`;
    const occupied = lw_collectOccupied(io, token);
    const schedule = lw_buildSchedule(occupied, {
        epoch: sentAt,
        delayMs: lw_sectionDelayMs,
        countdownMs: lw_countdownSeconds * 1000,
    });
    const sockets = lw_socketsInRoom(io, token);
    for (const row of schedule) {
        const cue = {
            waveId,
            section: row.section,
            goAt: row.goAt,
            sentAt,
            lw_torchMaxMs,
            lw_countdownSeconds,
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
    const id = waveId || `lw_${Date.now()}`;
    if (io && token) {
        io.to(token).emit('lw_wave-stop', { token, waveId: id });
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
    lw_emitStatus,
    lw_startWave,
    lw_stopWave,
};
