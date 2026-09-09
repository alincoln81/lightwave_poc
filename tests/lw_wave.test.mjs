import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    lw_buildSchedule,
    lw_collectOccupiedFromSockets,
    lw_activeSectionAt,
} = require('../server/lw_wave.js');

describe('lw_buildSchedule', () => {
    it('skips empty / invalid sections and staggers goAt', () => {
        const epoch = 1_000_000;
        const delayMs = 400;
        const countdownMs = 3000;
        const schedule = lw_buildSchedule(
            [{ section: '103' }, { section: '101' }, { section: '' }, { section: '103' }],
            { epoch, delayMs, countdownMs },
        );
        assert.deepEqual(schedule.map((row) => row.section), ['101', '103']);
        assert.equal(schedule[0].goAt, epoch + countdownMs);
        assert.equal(schedule[1].goAt, epoch + countdownMs + delayMs);
    });

    it('does not reserve a slot for unoccupied 102', () => {
        const epoch = 0;
        const schedule = lw_buildSchedule(['101', '103'], { epoch, delayMs: 400, countdownMs: 0 });
        assert.equal(schedule.length, 2);
        assert.equal(schedule[1].goAt - schedule[0].goAt, 400);
        assert.deepEqual(schedule.map((row) => row.section), ['101', '103']);
    });
});

describe('lw_collectOccupiedFromSockets', () => {
    it('counts joined torches with sections and ignores others', () => {
        const sockets = [
            { data: { role: 'user', torch: true, lw_section: '110' } },
            { data: { role: 'user', torch: true, lw_section: '101' } },
            { data: { role: 'user', torch: true, lw_section: '110' } },
            { data: { role: 'user', torch: false, lw_section: '102' } },
            { data: { role: 'producer', torch: true, lw_section: '101' } },
            { data: { role: 'user', torch: true, lw_section: 'nope' } },
        ];
        assert.deepEqual(lw_collectOccupiedFromSockets(sockets), [
            { section: '101', count: 1 },
            { section: '110', count: 2 },
        ]);
    });
});

describe('lw_activeSectionAt', () => {
    const schedule = [
        { section: '101', goAt: 1000 },
        { section: '110', goAt: 1400 },
    ];

    it('is null before the first GO', () => {
        assert.equal(lw_activeSectionAt(schedule, 999, 2000), null);
    });

    it('returns the current GO section', () => {
        assert.equal(lw_activeSectionAt(schedule, 1000, 2000), '101');
    });

    it('returns the later overlapping GO as the wave front', () => {
        assert.equal(lw_activeSectionAt(schedule, 1400, 2000), '110');
    });

    it('is null after the last torch window', () => {
        assert.equal(lw_activeSectionAt(schedule, 3400, 2000), null);
    });
});
