/**
 * Lightwave section identity: validate, persist, and sort section IDs.
 * Pattern: one or more digits plus an optional single letter (142, 142A).
 */

const LW_SECTION_PATTERN = /^(\d+)([A-Za-z])?$/;

/**
 * @param {unknown} raw
 * @returns {string|null} Normalized section (digits + optional uppercase letter) or null
 */
export function lw_normalizeSection(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim().toUpperCase();
    if (!text) return null;
    const match = text.match(LW_SECTION_PATTERN);
    if (!match) return null;
    const digits = match[1].replace(/^0+(?=\d)/, '');
    const letter = match[2] || '';
    return `${digits}${letter}`;
}

/**
 * Sort: numeric prefix ascending, then letter (none before A).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function lw_compareSections(a, b) {
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

export function lw_storageKey(token) {
    return `lw_section:${token}`;
}

export function lw_sectionFromQuery(search = window.location.search) {
    try {
        const params = new URLSearchParams(search);
        return lw_normalizeSection(params.get('lw_section'));
    } catch {
        return null;
    }
}

export function lw_sectionFromStorage(token) {
    if (!token) return null;
    try {
        return lw_normalizeSection(sessionStorage.getItem(lw_storageKey(token)));
    } catch {
        return null;
    }
}

export function lw_rememberSection(token, section) {
    const normalized = lw_normalizeSection(section);
    if (!token || !normalized) return null;
    try {
        sessionStorage.setItem(lw_storageKey(token), normalized);
    } catch {
        // Ignore quota / private mode
    }
    return normalized;
}

/**
 * Resolve section: query → sessionStorage → null (caller shows the form).
 * @param {string} token
 * @returns {string|null}
 */
export function lw_resolveSection(token) {
    return lw_sectionFromQuery() || lw_sectionFromStorage(token);
}

export function lw_emitSection(socket, token, section) {
    const normalized = lw_normalizeSection(section);
    if (!socket || !token || !normalized) return null;
    socket.emit('lw_section', { token, section: normalized });
    return normalized;
}
