import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lw_shouldTorchBeOn } from '../public/js/lw_torch.js';
import { lw_classifyPose } from '../public/js/lw_pose.js';
import { lw_countdownLabel, lw_lowerPhoneCopy } from '../public/js/lw_countdown.js';

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
});

describe('lw_classifyPose', () => {
    it('treats upright gravity as lowered', () => {
        assert.equal(lw_classifyPose({ gx: 0, gy: -9.8, gz: 0 }, 'lowered'), 'lowered');
    });

    it('treats inverted / torch-up as raised', () => {
        assert.equal(lw_classifyPose({ gx: 0, gy: 9.8, gz: 0 }, 'lowered'), 'raised');
        assert.equal(lw_classifyPose({ gx: 0, gy: 0, gz: 9.8 }, 'lowered'), 'raised');
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
});
