import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { lw_normalizeSection, lw_compareSections } from '../public/js/lw_section.js';

const require = createRequire(import.meta.url);
const server = require('../server/lw_wave.js');

describe('lw_normalizeSection (client)', () => {
    it('accepts 142 and 142A', () => {
        assert.equal(lw_normalizeSection('142'), '142');
        assert.equal(lw_normalizeSection('142a'), '142A');
        assert.equal(lw_normalizeSection(' 142A '), '142A');
    });

    it('rejects blank, letters-only, and hyphenated values', () => {
        assert.equal(lw_normalizeSection(''), null);
        assert.equal(lw_normalizeSection('   '), null);
        assert.equal(lw_normalizeSection('abc'), null);
        assert.equal(lw_normalizeSection('14-2'), null);
        assert.equal(lw_normalizeSection(null), null);
    });
});

describe('lw_compareSections (client)', () => {
    it('sorts numeric prefixes then optional letter', () => {
        const list = ['142A', '110', '101', '142', '102'];
        list.sort(lw_compareSections);
        assert.deepEqual(list, ['101', '102', '110', '142', '142A']);
    });
});

describe('lw_compareSections (server)', () => {
    it('matches client sort rules', () => {
        const list = ['142A', '110', '101', '142', '102'];
        list.sort(server.lw_compareSections);
        assert.deepEqual(list, ['101', '102', '110', '142', '142A']);
        assert.equal(server.lw_normalizeSection('142a'), '142A');
        assert.equal(server.lw_normalizeSection('14-2'), null);
    });
});
