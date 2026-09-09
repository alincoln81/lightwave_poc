import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lw_debugLine } from '../public/js/lw_mode.js';

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
});
