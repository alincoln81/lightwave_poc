import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lw_shouldTorchBeOn } from '../public/js/lw_torch.js';
import { lw_classifyPose, lw_thresholdsFromSensitivity } from '../public/js/lw_pose.js';
import { lw_countdownLabel, lw_lowerPhoneCopy, lw_waveCompleteCopy } from '../public/js/lw_countdown.js';

describe('lw_shouldTorchBeOn', () => {
    const maxMs = 2000;

    it('stays off before GO', () => {
        assert.equal(lw_shouldTorchBeOn({ goActive: false, raised: true, fallback: false, elapsedMs: 0, maxMs }), false);
    });

    it('stays off when GO and lowered without fallback', () => {
        assert.equal(lw_shouldTorchBeOn({ goActive: true, raised: false, fallback: false, elapsedMs: 0, maxMs }), false);
    });

    it('turns on when GO and raised', () => {
        assert.equal(lw_shouldTorchBeOn({ goActive: true, raised: true, fallback: false, elapsedMs: 0, maxMs }), true);
    });

    it('turns on when GO and fallback even if lowered', () => {
        assert.equal(lw_shouldTorchBeOn({ goActive: true, raised: false, fallback: true, elapsedMs: 100, maxMs }), true);
    });

    it('turns off at maxMs', () => {
        assert.equal(lw_shouldTorchBeOn({ goActive: true, raised: true, fallback: false, elapsedMs: 2000, maxMs }), false);
        assert.equal(lw_shouldTorchBeOn({ goActive: true, raised: false, fallback: true, elapsedMs: 2000, maxMs }), false);
    });

    it('turns off when the GO window ends', () => {
        assert.equal(lw_shouldTorchBeOn({ goActive: false, raised: true, fallback: true, elapsedMs: 100, maxMs }), false);
    });

    it('allows a new GO while still raised', () => {
        assert.equal(lw_shouldTorchBeOn({ goActive: true, raised: true, fallback: false, elapsedMs: 0, maxMs }), true);
    });

    it('turns on at GO when requireRaise is false even if lowered', () => {
        assert.equal(lw_shouldTorchBeOn({
            goActive: true,
            raised: false,
            fallback: false,
            elapsedMs: 0,
            maxMs,
            requireRaise: false,
        }), true);
    });

    it('stays off before GO when requireRaise is false', () => {
        assert.equal(lw_shouldTorchBeOn({
            goActive: false,
            raised: false,
            fallback: false,
            elapsedMs: 0,
            maxMs,
            requireRaise: false,
        }), false);
    });

    it('stays on after lower when offOnlyAtMax is latched', () => {
        assert.equal(lw_shouldTorchBeOn({
            goActive: true,
            raised: false,
            fallback: false,
            elapsedMs: 400,
            maxMs,
            requireRaise: true,
            offOnlyAtMax: true,
            latched: true,
        }), true);
    });

    it('still turns off at max when offOnlyAtMax is latched', () => {
        assert.equal(lw_shouldTorchBeOn({
            goActive: true,
            raised: false,
            fallback: false,
            elapsedMs: 2000,
            maxMs,
            requireRaise: true,
            offOnlyAtMax: true,
            latched: true,
        }), false);
    });
});

describe('lw_classifyPose', () => {
    it('treats upright gravity as lowered', () => {
        assert.equal(lw_classifyPose({ gx: 0, gy: -9.8, gz: 0 }, 'lowered'), 'lowered');
    });

    it('treats inverted / torch-up as raised', () => {
        assert.equal(lw_classifyPose({ gx: 0, gy: 9.8, gz: 0 }, 'lowered'), 'raised');
        assert.equal(lw_classifyPose({ gx: 0, gy: 0, gz: 9.8 }, 'lowered'), 'raised');
    });

    it('treats a subtle tilt as raised when raise sensitivity is high', () => {
        const deg = 25 * (Math.PI / 180);
        const g = { gx: 0, gy: -9.8 * Math.cos(deg), gz: 9.8 * Math.sin(deg) };
        const easy = lw_thresholdsFromSensitivity(10, 2);
        const hard = lw_thresholdsFromSensitivity(1, 2);
        assert.equal(lw_classifyPose(g, 'lowered', easy), 'raised');
        assert.equal(lw_classifyPose(g, 'lowered', hard), 'lowered');
    });

    it('needs an extreme drop to lower when lower sensitivity is low', () => {
        const slight = 28 * (Math.PI / 180);
        const slightG = { gx: 0, gy: -9.8 * Math.cos(slight), gz: 9.8 * Math.sin(slight) };
        const upright = { gx: 0, gy: -9.8, gz: 0 };
        const extreme = lw_thresholdsFromSensitivity(8, 1);
        assert.equal(lw_classifyPose(slightG, 'raised', extreme), 'raised');
        assert.equal(lw_classifyPose(upright, 'raised', extreme), 'lowered');
    });
});

describe('lw_countdown overlay copy', () => {
    it('counts down then GO', () => {
        assert.equal(lw_countdownLabel(3), 'Raise phone in 3');
        assert.equal(lw_countdownLabel(1), 'Raise phone in 1');
        assert.equal(lw_countdownLabel(0), 'GO');
    });

    it('tells the participant to lower after the flash', () => {
        assert.equal(lw_lowerPhoneCopy(), 'Lower your Phone');
    });

    it('shows Wave Complete after the section pass', () => {
        assert.equal(lw_waveCompleteCopy(), 'Wave Complete');
    });
});
