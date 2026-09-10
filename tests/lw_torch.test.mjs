import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lw_shouldTorchBeOn, lw_pickFollowOffMs } from '../public/js/lw_torch.js';
import {
    lw_advancePose,
    lw_createPoseState,
    LW_RAISE_REARM_MS,
    lw_orientationLooksRaised,
    lw_thresholdsFromSensitivity,
} from '../public/js/lw_pose.js';
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

    it('picks an inclusive off delay between min and max', () => {
        for (let i = 0; i < 20; i += 1) {
            const ms = lw_pickFollowOffMs(2000, 3500);
            assert.ok(ms >= 2000 && ms <= 3500);
        }
        const swapped = lw_pickFollowOffMs(4000, 2000);
        assert.ok(swapped >= 2000 && swapped <= 4000);
    });

    it('keeps follow-pose torch on after lower until the random cap', () => {
        assert.equal(lw_shouldTorchBeOn({
            goActive: false,
            raised: false,
            fallback: false,
            elapsedMs: 400,
            maxMs: 2000,
            followPose: true,
            offOnLower: false,
            latched: true,
        }), true);
        assert.equal(lw_shouldTorchBeOn({
            goActive: false,
            raised: false,
            fallback: false,
            elapsedMs: 2000,
            maxMs: 2000,
            followPose: true,
            offOnLower: false,
            latched: true,
        }), false);
    });

    it('follows raise and lower with no GO or max when followPose is on', () => {
        assert.equal(lw_shouldTorchBeOn({
            goActive: false,
            raised: true,
            fallback: false,
            elapsedMs: 0,
            maxMs,
            followPose: true,
        }), true);
        assert.equal(lw_shouldTorchBeOn({
            goActive: false,
            raised: false,
            fallback: false,
            elapsedMs: 0,
            maxMs,
            followPose: true,
        }), false);
        assert.equal(lw_shouldTorchBeOn({
            goActive: false,
            raised: true,
            fallback: false,
            elapsedMs: 9000,
            maxMs,
            followPose: true,
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

function drivePose(state, thresholds, sample, count) {
    let pose = state.pose;
    for (let i = 0; i < count; i += 1) {
        pose = lw_advancePose(state, sample, thresholds);
    }
    return pose;
}

function primedState(pose = 'lowered') {
    const state = lw_createPoseState();
    state.baselineReady = true;
    state.gravReady = true;
    state.pose = pose;
    return state;
}

function uprightSample(extra = {}) {
    return {
        gx: 0,
        gy: -9.8,
        gz: 0,
        ax: 0,
        ay: 0,
        az: 0,
        dtSec: 0.02,
        ...extra,
    };
}

describe('lw_advancePose', () => {
    it('stays neutral until the initial hold is sampled', () => {
        const state = lw_createPoseState();
        const thresholds = lw_thresholdsFromSensitivity(5, 5);
        assert.equal(state.pose, 'neutral');
        assert.equal(drivePose(state, thresholds, uprightSample(), 5), 'neutral');
    });

    it('treats a still upright phone as lowered after calibration', () => {
        const state = lw_createPoseState();
        const thresholds = lw_thresholdsFromSensitivity(5, 5);
        assert.equal(drivePose(state, thresholds, uprightSample(), 12), 'lowered');
    });

    it('treats a held inverted / torch-up posture as raised', () => {
        const thresholds = lw_thresholdsFromSensitivity(8, 2);
        const inverted = lw_createPoseState();
        assert.equal(drivePose(inverted, thresholds, uprightSample({ gy: 9.8 }), 12), 'raised');
        const torchUp = lw_createPoseState();
        assert.equal(drivePose(torchUp, thresholds, uprightSample({ gy: 0, gz: 9.8 }), 12), 'raised');
    });

    it('treats a short camera-end lift as raised when raise sensitivity is high', () => {
        const easy = lw_thresholdsFromSensitivity(10, 2);
        const hard = lw_thresholdsFromSensitivity(1, 2);
        const lift = uprightSample({ ay: 3.2 });
        const easyState = primedState('lowered');
        const hardState = primedState('lowered');
        assert.equal(drivePose(easyState, easy, lift, 4), 'raised');
        assert.equal(drivePose(hardState, hard, lift, 4), 'lowered');
    });

    it('does not lower from orientation wobble once raised', () => {
        const thresholds = lw_thresholdsFromSensitivity(8, 2);
        const state = primedState('raised');
        const wobble = 22 * (Math.PI / 180);
        const noisy = uprightSample({
            gy: -9.8 * Math.cos(wobble),
            gz: 9.8 * Math.sin(wobble),
        });
        assert.equal(drivePose(state, thresholds, noisy, 20), 'raised');
        assert.equal(drivePose(state, thresholds, uprightSample(), 20), 'raised');
    });

    it('needs a sustained downward drop to lower when lower sensitivity is low', () => {
        const extreme = lw_thresholdsFromSensitivity(8, 1);
        const easyLower = lw_thresholdsFromSensitivity(8, 10);
        const blipState = primedState('raised');
        const dropState = primedState('raised');
        const easyState = primedState('raised');
        assert.equal(drivePose(blipState, extreme, uprightSample({ ay: -1.0 }), 6), 'raised');
        assert.equal(drivePose(dropState, extreme, uprightSample({ ay: -4.2 }), 20), 'lowered');
        assert.equal(drivePose(easyState, easyLower, uprightSample({ ay: -4.2 }), 8), 'lowered');
    });

    it('tracks a moderate downward travel at lower sensitivity 8', () => {
        const mid = lw_thresholdsFromSensitivity(5, 8);
        const state = primedState('raised');
        assert.equal(drivePose(state, mid, uprightSample({ ay: -1.4 }), 16), 'lowered');
    });

    it('counts rotating back toward the home hold as a lower', () => {
        const easy = lw_thresholdsFromSensitivity(5, 8);
        const state = primedState('raised');
        state.lastAngleDeg = 180;
        let pose = state.pose;
        for (let i = 0; i <= 18; i += 1) {
            const t = i / 18;
            pose = lw_advancePose(state, uprightSample({ gy: 9.8 * (1 - 2 * t) }), easy);
        }
        assert.equal(pose, 'lowered');
    });

    it('does not treat a modest tilt as raised', () => {
        const deg = 35 * (Math.PI / 180);
        const tilt = uprightSample({
            gy: -9.8 * Math.cos(deg),
            gz: 9.8 * Math.sin(deg),
        });
        const easy = lw_thresholdsFromSensitivity(10, 2);
        const mid = lw_thresholdsFromSensitivity(5, 5);
        assert.equal(lw_orientationLooksRaised(tilt, easy), false);
        assert.equal(lw_orientationLooksRaised(tilt, mid), false);
        const easyState = lw_createPoseState();
        assert.equal(drivePose(easyState, easy, tilt, 20), 'lowered');
    });

    it('blocks raise until the rearm delay after a lower', () => {
        const easy = lw_thresholdsFromSensitivity(10, 10);
        const state = primedState('raised');
        assert.equal(drivePose(state, easy, uprightSample({ ay: -4.2 }), 16), 'lowered');
        assert.ok(state.raiseLockMs > 0);
        assert.ok(state.raiseLockMs <= LW_RAISE_REARM_MS);
        assert.equal(drivePose(state, easy, uprightSample({ ay: 3.2 }), 8), 'lowered');
        const lockSamples = Math.ceil(LW_RAISE_REARM_MS / 20) + 2;
        assert.equal(drivePose(state, easy, uprightSample(), lockSamples), 'lowered');
        assert.equal(state.raiseLockMs, 0);
        assert.equal(drivePose(state, easy, uprightSample({ ay: 3.2 }), 8), 'raised');
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
