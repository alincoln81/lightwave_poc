import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('testMode guards', () => {
    it('allows any root when APP_MODE is not test', () => {
        const previous = process.env.APP_MODE;
        process.env.APP_MODE = 'live';
        delete require.cache[require.resolve('../server/testMode.js')];
        const live = require('../server/testMode.js');
        assert.equal(live.isTestMode(), false);
        assert.equal(live.assertWritableRoot('someLiveOrg').ok, true);
        if (previous === undefined) delete process.env.APP_MODE;
        else process.env.APP_MODE = previous;
        delete require.cache[require.resolve('../server/testMode.js')];
    });

    it('blocks other orgs when APP_MODE=test', () => {
        const previous = process.env.APP_MODE;
        process.env.APP_MODE = 'test';
        process.env.TEST_TOKEN = 'lwtest_k8m2n4p6q';
        process.env.TEST_FIRESTORE_ROOT = 'lwLocalTest';
        delete require.cache[require.resolve('../server/testMode.js')];
        const test = require('../server/testMode.js');
        assert.equal(test.isTestMode(), true);
        assert.equal(test.isAllowedToken('lwtest_k8m2n4p6q'), true);
        assert.equal(test.isAllowedToken('gej2qhxkV6pdve2h'), false);
        assert.equal(test.assertWritableRoot('lwLocalTest').ok, true);
        assert.equal(test.assertWritableRoot('lightShow').ok, false);
        assert.equal(test.assertCopyAllowed('baseSettings', 'lwLocalTest').ok, true);
        assert.equal(test.assertCopyAllowed('baseSettings', 'lightShow').ok, false);
        if (previous === undefined) delete process.env.APP_MODE;
        else process.env.APP_MODE = previous;
        delete require.cache[require.resolve('../server/testMode.js')];
    });
});
