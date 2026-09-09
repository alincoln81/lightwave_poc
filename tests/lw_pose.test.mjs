import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lw_debugLine, lw_travelDebugLines } from '../public/js/lw_mode.js';
import { lw_travelProgress, lw_thresholdsFromSensitivity } from '../public/js/lw_pose.js';

describe('lw_debugLine', () => {
    it('shows waiting when granted but no samples', () => {
        assert.equal(
            lw_debugLine({ permission: 'granted', samples: 0, pose: 'waiting' }),
            'Motion: granted · samples: 0 · pose: waiting',
        );
    });

    it('shows pose once samples arrive', () => {
        assert.equal(
            lw_debugLine({ permission: 'granted', samples: 18, pose: 'raised' }),
            'Motion: granted · samples: 18 · pose: raised',
        );
    });

    it('shows denied fallback', () => {
        assert.equal(
            lw_debugLine({ permission: 'denied', samples: 0 }),
            'Motion: denied · fallback',
        );
    });

    it('shows unsupported fallback', () => {
        assert.equal(
            lw_debugLine({ permission: 'unsupported', samples: 0 }),
            'Motion: unsupported · fallback',
        );
    });

    it('appends travel remaining once samples exist', () => {
        const travel = {
            calibrating: false,
            pose: 'lowered',
            raiseHave: 0.12,
            raiseNeed: 0.57,
            raiseLeft: 0.45,
            lowerHave: 0,
            lowerNeed: 0.45,
            lowerLeft: 0.45,
        };
        assert.equal(
            lw_debugLine({ permission: 'granted', samples: 18, pose: 'lowered', travel }),
            'Motion: granted · samples: 18 · pose: lowered\n'
            + 'Up 0.12 / 0.57 · need 0.45 more\n'
            + 'Down 0.00 / 0.45 · wait until raised',
        );
    });
});

describe('lw_travelProgress', () => {
    it('reports how much more travel is needed', () => {
        const thresholds = lw_thresholdsFromSensitivity(5, 5);
        const progress = lw_travelProgress({
            pose: 'lowered',
            baselineReady: true,
            raiseTravel: 0.1,
            lowerTravel: 0,
        }, thresholds);
        assert.equal(progress.calibrating, false);
        assert.ok(progress.raiseNeed > progress.raiseHave);
        assert.equal(progress.raiseLeft, progress.raiseNeed - progress.raiseHave);
        assert.match(lw_travelDebugLines(progress), /need .* more/);
    });
});
