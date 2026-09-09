/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Firebase                                                                                             */
/* --------------------------------------------------------------------------------------------------------------- */
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc, collection, getDocs, writeBatch } = require('firebase/firestore');
const { getStorage, ref, uploadBytes, getDownloadURL } = require('firebase/storage');
const firebaseConfig = require('./config/firebase');
const { assertWritableRoot, assertCopyAllowed } = require('./testMode.js');

let firebaseApp;
let db;
let storage;

const COLLECTION_NAME = {
  assets: 'assets',
  programs: 'programs',
  settings: 'settings',
  deployments: 'deployments',
  stats: 'stats',
  sessions: 'sessions',
  baseSettings: 'baseSettings'
};

async function initFirebase() { 
    try {
      // Check if Firebase config is complete
      const requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
      const missingFields = requiredFields.filter(field => !firebaseConfig[field]);
      
      if (missingFields.length > 0) {
        throw new Error(`Missing required Firebase configuration fields: ${missingFields.join(', ')}`);
      }
  
      // Initialize Firebase
      firebaseApp = initializeApp(firebaseConfig);
      db = getFirestore(firebaseApp);
      storage = getStorage(firebaseApp);
      return { firebaseApp, db, storage };

    } catch (error) {
      console.error('Error initializing Firebase:', error.message);
      process.exit(1); // Exit if Firebase initialization fails
    }
  }

/* -------------------------------------------------------------------------------------------------------------- */
/* GET Functions                                                                                                  */
/* --------------------------------------------------------------------------------------------------------------- */
async function getAssets (firestoreRoot) {
  let success = false;
  try {
    if (!firestoreRoot || typeof firestoreRoot !== 'string') {
      return { success, assets: null, error: 'Invalid firestoreRoot' };
    }
    const snap = await getDoc(doc(db, firestoreRoot, COLLECTION_NAME.assets))
    if (!snap.exists()) { return { success, assets: null }; }
    const assets = snap.data();
    success = true;
    return { success, assets };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, assets: null, error: ex};
    }
    return { success, assets: null, error: ex?.message};
  }
}

async function getPrograms(firestoreRoot) {
  let success = false;
  try {
    if (!firestoreRoot || typeof firestoreRoot !== 'string') {
      return { success, programs: null, error: 'Invalid firestoreRoot' };
    }
    const snap = await getDoc(doc(db, firestoreRoot, COLLECTION_NAME.programs));
    if (!snap.exists()) { return { success, programs: null }; }
    const programs = snap.data();
    success = true;
    return { success, programs };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, programs: null, error: ex};
    }
    return { success, programs: null, error: ex?.message};
  }
}

async function getSettings(firestoreRoot) {
  let success = false;
  try {
    if (!firestoreRoot || typeof firestoreRoot !== 'string') {
      return { success, settings: null, error: 'Invalid firestoreRoot' };
    }
    const snap = await getDoc(doc(db, firestoreRoot, COLLECTION_NAME.settings));
    if (!snap.exists()) { return { success, settings: null }; }
    const settings = snap.data();
    success = true;
    return { success, settings };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, settings: null, error: ex};
    }
    return { success, settings: null, error: ex?.message};
  }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* SET Functions                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
async function setAssets(data, firestoreRoot) {
  let success = false;
  try {
    const rootGuard = assertWritableRoot(firestoreRoot);
    if (!rootGuard.ok) {
      return { success, error: rootGuard.error };
    }
    if (!firestoreRoot || typeof firestoreRoot !== 'string') {
      return { success, error: 'Invalid firestoreRoot' };
    }
    if (!data || !data.collection || !data.field || !data.file || !data.fileType || typeof data.fileType !== 'string' || data.fileType.indexOf('/') === -1) {
      return { success, error: 'Invalid data for setAssets' };
    }
    const uniqueId = Date.now() + Math.random().toString(36).substring(2, 15);
    const ext = data.fileType.split('/')[1] || 'bin';
    const fileName = `${uniqueId}-${data.field}.${ext}`;

    const storageRef = ref(storage, `uploads/${data.collection}/${fileName}`);
    const uploadTask = await uploadBytes(storageRef, data.file);
    const url = await getDownloadURL(uploadTask.ref);
    console.log('File uploaded to', url);

    const snap = await getDoc(doc(db, firestoreRoot, COLLECTION_NAME.assets));
    if (!snap.exists()) { return { success }; }
    const assets = snap.data() || {};

    if (data.collection === 'qr') {
      if (!assets.qr) assets.qr = {};
      assets.qr.url = url;
    } else {
      // Ensure nested objects exist (e.g., input.endCardImage)
      if (!assets[data.collection]) assets[data.collection] = {};
      if (!assets[data.collection][data.field]) assets[data.collection][data.field] = { url: null };
      assets[data.collection][data.field].url = url;
    }

    await setDoc(doc(db, firestoreRoot, COLLECTION_NAME.assets), assets);
    success = true;
    return { success };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, error: ex};
    }
    return { success, error: ex?.message};
  }
}

async function setPrograms(data, firestoreRoot) {
  let success = false;
  try {
    const rootGuard = assertWritableRoot(firestoreRoot);
    if (!rootGuard.ok) {
      return { success, error: rootGuard.error };
    }
    if (!firestoreRoot || typeof firestoreRoot !== 'string') {
      return { success, error: 'Invalid firestoreRoot' };
    }
    if (!data) {
      return { success, error: 'Invalid data for setPrograms' };
    }
    const snap = await getDoc(doc(db, firestoreRoot, COLLECTION_NAME.programs));
    if (!snap.exists()) { return { success }; }
    const programs = snap.data();

    if (typeof programs.custom !== 'object' || Array.isArray(programs.custom)) {
      programs.custom = {};
    }

    programs.custom = data;
    await setDoc(doc(db, firestoreRoot, COLLECTION_NAME.programs), programs);
    success = true;
    return { success };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, error: ex};
    }
    return { success, error: ex?.message};
  }
}

async function setSettings(data, firestoreRoot, type) {

  //console.log('### setSettings:', 'firestoreRoot:', firestoreRoot, 'type:', type, 'data:', data);

  let success = false;
  try {
    if (!firestoreRoot || typeof firestoreRoot !== 'string') {
      return { success, settings: null, error: 'Invalid firestoreRoot' };
    }
    const rootGuard = assertWritableRoot(firestoreRoot);
    if (!rootGuard.ok) {
      return { success, settings: null, error: rootGuard.error };
    }
    if (!data) {
      return { success, settings: null, error: 'Invalid data for setSettings' };
    }

    const snap = await getDoc(doc(db, firestoreRoot, COLLECTION_NAME.settings));
    if (!snap.exists()) { return { success, settings: null }; }
    const settings = snap.data();

    if (type === 'kill') {
      settings.activeProgram = data.activeProgram;
      settings.startDateTime = data.startDateTime;
    } else if (type === 'addLockedState') {
      settings.locked = data.locked;
      /*
        if (settings.infoTextJoined === null || settings.infoTextJoined === undefined || settings.infoTextJoined === '' || 
          settings.infoTextJoined === 'You are now participating in the LightShow, enjoy!') {
            console.log('### updateAllSettings updating infoTextJoined', firestoreRoot, settings.infoTextJoined);
            settings.infoTextJoined = 'You are now participating in the Light Show, enjoy!';
            console.log('### updateAllSettings updated infoTextJoined:', settings.infoTextJoined);
        }
      */
    } else if (type === 'addMLBState') {
      // Legacy update type — kept for backward compat but isMLB now lives in deployment doc
      settings.isMLB = data.isMLB || false;
    } else {
      settings.activeProgram = data.activeProgram;
      settings.joinButtonColor = data.joinButtonColor || '#D52265';
      settings.joinButtonText = data.joinButtonText || 'Join Light Show';
      settings.joinTextColor = data.joinTextColor || '#FFFFFF';
      settings.leaveButtonColor = data.leaveButtonColor || '#D52265';
      settings.leaveButtonText = data.leaveButtonText || 'Leave Light Show';
      settings.leaveTextColor = data.leaveTextColor || '#FFFFFF';
      settings.infoTextOnboarding = data.infoTextOnboarding || 'Participating in Vixi Light Show requires access to your camera and flashlight. Please tap the button below to begin.';
      settings.infoTextJoined = data.infoTextJoined || 'You are now participating in the Light Show, enjoy!';
      settings.infoTextJoinFailed = data.infoTextJoinFailed || 'Unable to connect to your camera or flashlight. Please try again.';
      settings.infoTextColor = data.infoTextColor || '#FFFFFF';
      // New participant color settings (defaults preserved if not provided)
      if (Object.prototype.hasOwnProperty.call(data, 'infoTextBgColor')) {
        settings.infoTextBgColor = data.infoTextBgColor;
      } else if (settings.infoTextBgColor === undefined) {
        settings.infoTextBgColor = 'rgba(0, 0, 0, 0.1)';
      }
      if (typeof data.footerTextColor === 'string') {
        settings.footerTextColor = data.footerTextColor.trim() || '#C5C5C5';
      } else if (settings.footerTextColor === undefined || settings.footerTextColor === null || settings.footerTextColor === '') {
        settings.footerTextColor = '#C5C5C5';
      }
      if (typeof data.footerLinkColor === 'string') {
        settings.footerLinkColor = data.footerLinkColor.trim() || '#D52265';
      } else if (settings.footerLinkColor === undefined || settings.footerLinkColor === null || settings.footerLinkColor === '') {
        settings.footerLinkColor = '#D52265';
      }
      if (typeof data.supportEmail === 'string') {
        settings.supportEmail = data.supportEmail.trim().replace(/^mailto:/i, '') || 'VixiSuiteSupport@thefamousgroup.com';
      } else if (settings.supportEmail === undefined || settings.supportEmail === null || settings.supportEmail === '') {
        settings.supportEmail = 'VixiSuiteSupport@thefamousgroup.com';
      }
      settings.joinRequiresConsent = !!(data.joinRequiresConsent ?? settings.joinRequiresConsent);
      // Recording UI settings
      settings.recordButtonColor = data.recordButtonColor || settings.recordButtonColor || '#D52265';
      settings.recordDownloadColor = data.recordDownloadColor || settings.recordDownloadColor || '#FF3B30';
      settings.photoInstructions = typeof data.photoInstructions === 'string' ? data.photoInstructions : (settings.photoInstructions || 'Tap for photo');
      settings.videoInstructions = typeof data.videoInstructions === 'string' ? data.videoInstructions : (settings.videoInstructions || 'Hold for video');
      settings.downloadInstructions = typeof data.downloadInstructions === 'string' ? data.downloadInstructions : (settings.downloadInstructions || 'Tap the icon to download your recording');
      settings.endCardDownloadPrompt = typeof data.endCardDownloadPrompt === 'string' ? data.endCardDownloadPrompt : (settings.endCardDownloadPrompt || 'Thanks for participating, to download your video press the button below.');
      settings.rotateDeviceMessage = typeof data.rotateDeviceMessage === 'string' ? data.rotateDeviceMessage : (settings.rotateDeviceMessage || 'Please rotate your phone');
      settings.showLockedMessage = typeof data.showLockedMessage === 'string' ? data.showLockedMessage : (settings.showLockedMessage || 'The LightShow is not currently active');
      // Title visibility
      settings.hideTitle = !!(data.hideTitle ?? settings.hideTitle);
      // New flags with sensible defaults
      settings.autoRedirect = !!(data.autoRedirect ?? settings.autoRedirect ?? true);
      settings.showTitleImage = data.showTitleImage !== false ? true : false;
      settings.showBackgroundImage = data.showBackgroundImage !== false ? true : false;
      settings.showEndCardImage = data.showEndCardImage !== false ? true : false;
      settings.loop = data.loop;
      settings.mode = data.mode === 'lightwave' ? 'lightwave' : (data.mode || settings.mode || 'default');
      const lwTorch = Number(data.lw_torchMaxMs);
      settings.lw_torchMaxMs = Number.isFinite(lwTorch)
        ? Math.min(10000, Math.max(200, Math.round(lwTorch)))
        : (settings.lw_torchMaxMs ?? 3000);
      const lwCount = Number(data.lw_countdownSeconds);
      settings.lw_countdownSeconds = Number.isFinite(lwCount)
        ? Math.min(10, Math.max(1, Math.round(lwCount)))
        : (settings.lw_countdownSeconds ?? 3);
      const lwDelay = Number(data.lw_sectionDelayMs);
      settings.lw_sectionDelayMs = Number.isFinite(lwDelay)
        ? Math.min(5000, Math.max(50, Math.round(lwDelay)))
        : (settings.lw_sectionDelayMs ?? 400);
      settings.lw_waitingText = (typeof data.lw_waitingText === 'string' && data.lw_waitingText.trim())
        ? data.lw_waitingText.trim()
        : (settings.lw_waitingText || "You're in section {section}. Get ready.");
      settings.lw_requireRaise = data.lw_requireRaise !== false;
      settings.lw_debugOverlay = data.lw_debugOverlay === true;
      const lwRaise = Number(data.lw_raiseSensitivity);
      settings.lw_raiseSensitivity = Number.isFinite(lwRaise)
        ? Math.min(10, Math.max(1, Math.round(lwRaise)))
        : (settings.lw_raiseSensitivity ?? 5);
      const lwLower = Number(data.lw_lowerSensitivity);
      settings.lw_lowerSensitivity = Number.isFinite(lwLower)
        ? Math.min(10, Math.max(1, Math.round(lwLower)))
        : (settings.lw_lowerSensitivity ?? 5);
      settings.lw_offOnlyAtMax = data.lw_offOnlyAtMax === true;
      settings.lw_loop = data.lw_loop === true;
      settings.paused = data.paused;
      settings.playing = data.playing;
      settings.redirectUrl = data.redirectUrl;
      settings.startDateTime = data.startDateTime;
      settings.startDelay = data.startDelay;
      settings.favoritePrograms = data.favoritePrograms || [];
      settings.locked = data.locked;
      settings.recordingEnabled = data.recordingEnabled || false;
      settings.maxRecordingDuration = typeof data.maxRecordingDuration === 'number' ? data.maxRecordingDuration : 30;
      // recordingPromptText deprecated
    }

    await setDoc(doc(db, firestoreRoot, COLLECTION_NAME.settings), settings);
    success = true;
    return { success, settings };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, error: ex};
    }
    return { success, error: ex?.message};
  }
}
/* --------------------------------------------------------------------------------------------------------------- */
/* Export                                                                                                          */
/* --------------------------------------------------------------------------------------------------------------- */
async function getDatabases() {
  let success = false;
  try {
    const snap = await getDoc(doc(db, "lightShow", COLLECTION_NAME.deployments));
    if (!snap.exists()) { return { result: 'failed' }; }
    const deployments = snap.data();
    return { result: 'successfully-retrieved', deployments };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, error: ex};
    }
    return { success, error: ex?.message};
  }
}
/* --------------------------------------------------------------------------------------------------------------- */
/* STATS Helpers                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
function isPlainObject(obj) {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

async function updateSessionWithConnections(firestoreRoot, data, sessionId, display_name) {
  let success = false;
  try {
    if (!firestoreRoot || typeof firestoreRoot !== 'string') {
      return { success: false, error: 'Invalid firestoreRoot' };
    }
    const rootGuard = assertWritableRoot(firestoreRoot);
    if (!rootGuard.ok) {
      return { success: false, error: rootGuard.error };
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'Invalid sessionId' };
    }
    if (!display_name || typeof display_name !== 'string') {
      return { success: false, error: 'Invalid display_name' };
    }
    if (!isPlainObject(data)) {
      return { success: false, error: 'Invalid data' };
    }
    const sessionRef = doc(db, COLLECTION_NAME.stats, display_name, COLLECTION_NAME.sessions, sessionId);
    const snap = await getDoc(sessionRef);
    const session = snap.exists() ? snap.data() : {};
    session.connections = data;
    await setDoc(sessionRef, session);
    return { success: true };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, error: ex};
    }
    return { success, error: ex?.message};
  }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Copy Collection                                                                                                 */
/* --------------------------------------------------------------------------------------------------------------- */
async function copyCollection(fromCollection, toCollection) {
  let success = false;
  try {

    if (!fromCollection || typeof fromCollection !== 'string') {
      return { success, error: 'Invalid fromCollection' };
    }
    if (!toCollection || typeof toCollection !== 'string') {
      return { success, error: 'Invalid toCollection' };
    }
    const copyGuard = assertCopyAllowed(fromCollection, toCollection);
    if (!copyGuard.ok) {
      return { success, error: copyGuard.error };
    }

    const fromCollectionRef = collection(db, fromCollection);
    const querySnapshot = await getDocs(fromCollectionRef);
    if (querySnapshot.empty) {
      return { success, error: 'From collection is empty' };
    }

    //copy every document execpt for the 'deployments' in the fromCollection to the toCollection
    const deployments = querySnapshot.docs.filter((docSnap) => docSnap.id !== 'deployments');

    const batch = writeBatch(db);
    const copiedDocIds = [];
    deployments.forEach((docSnap) => {
      const targetRef = doc(db, toCollection, docSnap.id);
      batch.set(targetRef, docSnap.data());
      copiedDocIds.push(docSnap.id);
    });
    await batch.commit();
    success = true;
    return { success, count: copiedDocIds.length, ids: copiedDocIds };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, error: ex};
    }
    return { success, error: ex?.message};
  }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* UPDATE DEPLOYMENTS DB                                                                                           */
/* --------------------------------------------------------------------------------------------------------------- */
//update the deployments db with; add a single deploymentEntry object with the following structure:
// deploymentEntry: {
//   displayName: string,
//   token: string,
//   firestoreRoot: string
// }
async function updateDeploymentsDb(deploymentEntry) {
  let success = false;
  try {
    if (!deploymentEntry || typeof deploymentEntry !== 'object') {
      return { success, error: 'Invalid deploymentEntry' };
    }
    const { firestoreRoot, displayName, token } = deploymentEntry;
    if (!firestoreRoot || !token) {
      return { success, error: 'Missing firestoreRoot or token' };
    }
    const rootGuard = assertWritableRoot(firestoreRoot);
    if (!rootGuard.ok) {
      return { success, error: rootGuard.error };
    }
    const targetRef = doc(db, COLLECTION_NAME.deployments, firestoreRoot);
    await setDoc(targetRef, {
      firestoreRoot,
      token,
      displayName: displayName || firestoreRoot
    }, { merge: true });
    success = true;
    return { success, deploymentEntry };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, error: ex};
    }
    return { success, error: ex?.message};
  }
}
/* --------------------------------------------------------------------------------------------------------------- */
/* CREATE DEPLOYMENTS DB                                                                                            */
/* --------------------------------------------------------------------------------------------------------------- */
//TEMPORARY: create a new db for deployments and push the data from the paths.json file to the data looks like this:
// deploymentName: {
//   displayName: string,
//   token: string,
//   firestoreRoot: string
// }
async function createDeploymentsDb(mappedOrgsAndTickets) {
  let success = false;
  try {
    const rootGuard = assertWritableRoot('deployments');
    if (!rootGuard.ok) {
      return { success, error: rootGuard.error };
    }
    //if mappedOrgsAndTickets is empty, null, undefined, or does not exist, return an error
    if (!mappedOrgsAndTickets || typeof mappedOrgsAndTickets !== 'object' || Object.keys(mappedOrgsAndTickets).length === 0) {
      return { success, error: 'Invalid mappedOrgsAndTickets' };
    }
    //ensure its an array
    if (!Array.isArray(mappedOrgsAndTickets)) {
      return { success, error: 'Invalid mappedOrgsAndTickets' };
    }
    // get the deployments collection, if it doesn't exist, create it, if it does, delete all the documents in it
    const deploymentsColl = collection(db, COLLECTION_NAME.deployments);
    const existing = await getDocs(deploymentsColl);
    const deleteBatch = writeBatch(db);
    existing.forEach((docSnap) => deleteBatch.delete(docSnap.ref));
    if (!existing.empty) {
      await deleteBatch.commit();
    }
    const createBatch = writeBatch(db);
    mappedOrgsAndTickets.forEach((item) => {
      if (!item.firestoreRoot) {
        item.firestoreRoot = item.name.replace(/\s+/g, '-').toLowerCase() + '-' + item.id;
        //if there are more than 2 dashes in a row, replace all consecutive dashes with a single dash
        item.firestoreRoot = item.firestoreRoot.replace(/[-]{2,}/g, '-');
      }
      const sanitizedRoot = String(item.firestoreRoot).replace(/[\\/]+/g, '-');
      const targetRef = doc(db, COLLECTION_NAME.deployments, sanitizedRoot);
      createBatch.set(targetRef, { ...item, firestoreRoot: sanitizedRoot });
    });
    await createBatch.commit();
    success = true;
    return { success, mappedOrgsAndTickets };



  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, error: ex};
    }
    return { success, error: ex?.message};
  }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* GET ALL DEPLOYMENTS                                                                                             */
/* --------------------------------------------------------------------------------------------------------------- */
async function getAllDeployments() {
  try {
    const deploymentsColl = collection(db, COLLECTION_NAME.deployments);
    const snap = await getDocs(deploymentsColl);
    const list = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (!data) return;
      const displayName = data.displayName || data.name;
      if (data.token && data.firestoreRoot && displayName) {
        list.push({ ...data, displayName });
      }
    });
    return { success: true, deployments: list };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success: false, error: ex };
    }
    return { success: false, error: ex?.message };
  }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* CHECK FIRESTORE ROOT COLLECTION                                                                                 */
/* --------------------------------------------------------------------------------------------------------------- */
async function checkFirestoreRootCollection(firestoreRoot) {
  try {
    if (!firestoreRoot || typeof firestoreRoot !== 'string') {
      return { success: false, error: 'Invalid firestoreRoot' };
    }
    // Check firestore to see if there is a collection with a name that is the same as the firestoreRoot
    const firestoreRootCollection = collection(db, firestoreRoot);
    const firestoreRootCollectionExists = await getDocs(firestoreRootCollection);
    if (firestoreRootCollectionExists.empty) {
      //create the collection using the copyCollection function
      const copyCollectionResult = await copyCollection(COLLECTION_NAME.baseSettings, firestoreRoot);
      if(!copyCollectionResult.success) {
        return { success: false, error: 'Failed to copy baseSettings collection to ' + firestoreRoot };
      }
    }
    return { success: true };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success: false, error: ex };
    }
    return { success: false, error: ex?.message };
  }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* UPDATE DEPLOYMENT FLAGS                                                                                         */
/* --------------------------------------------------------------------------------------------------------------- */
// Updates deployment-level feature flags (isMLB, gateRecordingEnabled) in the deployments collection.
// flags: { isMLB?: boolean, gateRecordingEnabled?: boolean }
async function updateDeploymentFlags(firestoreRoot, flags) {
  let success = false;
  try {
    if (!firestoreRoot || typeof firestoreRoot !== 'string') {
      return { success, error: 'Invalid firestoreRoot' };
    }
    const rootGuard = assertWritableRoot(firestoreRoot);
    if (!rootGuard.ok) {
      return { success, error: rootGuard.error };
    }
    if (!flags || typeof flags !== 'object') {
      return { success, error: 'Invalid flags' };
    }
    const targetRef = doc(db, COLLECTION_NAME.deployments, firestoreRoot);
    await setDoc(targetRef, flags, { merge: true });
    success = true;
    return { success };
  } catch (ex) {
    if (typeof ex === 'string') {
      return { success, error: ex };
    }
    return { success, error: ex?.message };
  }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Export                                                                                                          */
/* --------------------------------------------------------------------------------------------------------------- */
 module.exports = { initFirebase,
  getAssets, getPrograms, getSettings, getDatabases,
  setAssets, setPrograms, setSettings,
  updateSessionWithConnections, copyCollection,
  createDeploymentsDb, updateDeploymentsDb, getAllDeployments,
  checkFirestoreRootCollection, updateDeploymentFlags
};

