/**
 * Local test-mode lock: when APP_MODE=test, only the sandbox org/token
 * is visible and writable. Live deployments stay in Firebase but this
 * process will not load, route, or write them.
 */

const APP_MODE = String(process.env.APP_MODE || 'live').trim().toLowerCase();
const TEST_TOKEN = String(process.env.TEST_TOKEN || 'lwtest_k8m2n4p6q').trim();
const TEST_FIRESTORE_ROOT = String(process.env.TEST_FIRESTORE_ROOT || 'lwLocalTest').trim();
const TEST_DISPLAY_NAME = String(process.env.TEST_DISPLAY_NAME || 'Lightwave Local Test').trim();

function isTestMode() {
    return APP_MODE === 'test';
}

function getTestDeployment() {
    return {
        token: TEST_TOKEN,
        firestoreRoot: TEST_FIRESTORE_ROOT,
        displayName: TEST_DISPLAY_NAME,
        isMLB: false,
        requestMic: false,
        gateRecordingEnabled: false,
        recordingSlider: true,
    };
}

function isAllowedToken(token) {
    if (!isTestMode()) return true;
    return typeof token === 'string' && token === TEST_TOKEN;
}

function isAllowedFirestoreRoot(root) {
    if (!isTestMode()) return true;
    return typeof root === 'string' && root === TEST_FIRESTORE_ROOT;
}

function assertWritableRoot(root) {
    if (isAllowedFirestoreRoot(root)) {
        return { ok: true };
    }
    return {
        ok: false,
        error: `APP_MODE=test blocks access to firestoreRoot "${root}". Only "${TEST_FIRESTORE_ROOT}" is allowed.`,
    };
}

function assertCopyAllowed(fromCollection, toCollection) {
    if (!isTestMode()) return { ok: true };
    const fromOk = fromCollection === 'baseSettings' || fromCollection === TEST_FIRESTORE_ROOT;
    const toOk = toCollection === TEST_FIRESTORE_ROOT;
    if (fromOk && toOk) return { ok: true };
    return {
        ok: false,
        error: `APP_MODE=test blocks copy from "${fromCollection}" to "${toCollection}".`,
    };
}

function logTestModeBanner() {
    if (!isTestMode()) return;
    console.log('============================================================');
    console.log('APP_MODE=test — live deployments are locked out of this process');
    console.log(`  token:          ${TEST_TOKEN}`);
    console.log(`  firestoreRoot:  ${TEST_FIRESTORE_ROOT}`);
    console.log(`  displayName:    ${TEST_DISPLAY_NAME}`);
    console.log(`  participant:    http://localhost:${process.env.PORT || 3000}/go/i/${TEST_TOKEN}`);
    console.log(`  producer:       http://localhost:${process.env.PORT || 3000}/producer/${TEST_TOKEN}`);
    console.log(`  helper:         http://localhost:${process.env.PORT || 3000}/helper/${TEST_TOKEN}`);
    console.log('============================================================');
}

module.exports = {
    APP_MODE,
    TEST_TOKEN,
    TEST_FIRESTORE_ROOT,
    TEST_DISPLAY_NAME,
    isTestMode,
    getTestDeployment,
    isAllowedToken,
    isAllowedFirestoreRoot,
    assertWritableRoot,
    assertCopyAllowed,
    logTestModeBanner,
};
