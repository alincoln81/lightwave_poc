//import { tickets, orgs, paths, mappedOrgsAndTickets } from './orgsAndTickets.js';
/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Socket.IO                                                                                            */
/* --------------------------------------------------------------------------------------------------------------- */
const socket = io();
/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize the connection ID, assets, connection counts, playlist, settings, and programs                       */
/* --------------------------------------------------------------------------------------------------------------- */
let connectionId = null;
let ticketsImported = null;
let orgsImported = null;
let pathsImported = null;
let displayName = null;
/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Helper                                                                                               */
/* --------------------------------------------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    console.log('Helper loaded');
});

/* --------------------------------------------------------------------------------------------------------------- */
/* Announce the Helper to the server once the connection is established                                            */
/* --------------------------------------------------------------------------------------------------------------- */
//get the token from the url path
const token = window.location.pathname.split('/').pop() || window.__APP_CONFIG__?.testToken || 'gej2qhxkV6pdve2h';
console.log('Token: ', token);

socket.on('server-ready', (timestamp, id) => {
    // convert timestamp to human readable date
    const date = new Date(timestamp);
    const humanReadableDate = date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' });
    connectionId = id;

    console.log('Server ready, announcing helper', humanReadableDate, connectionId);
    socket.emit('helper-connected', token, Date.now());
});

socket.on('deployments', (deployments) => {
    //console.log('Deployments:', deployments, typeof deployments);
    // display the deployments in the deployments div
    const deploymentsDiv = document.getElementById('deployments');
    const deploymentsStatsDiv = document.getElementById('deployments-stats');
    deploymentsDiv.innerHTML = '';

    if (deployments == null) return;
    const list = Array.isArray(deployments)
        ? deployments
        : (typeof deployments === 'object' ? Object.values(deployments) : [String(deployments)]);

    // sort the list by the display name
    list.sort((a, b) => a.displayName.localeCompare(b.displayName));

    let count = 0;

    for (const deployment of list) {
        // Create a row for the deployment
        //console.log('Deployment:', deployment.displayName);
        const row = document.createElement('tr');
        
        //count cell
        const cell = document.createElement('td');
        cell.style.paddingRight = '20px';
        cell.innerHTML = count + 1;
        row.appendChild(cell);

        // display name
        const cell0 = document.createElement('td');
        cell0.style.paddingLeft = '0px';
        cell0.innerHTML = deployment.displayName;
        row.appendChild(cell0);

        // participant button
        const cell1 = document.createElement('td');
        cell1.innerHTML = `<a target="_blank" href="https://api.vixisuite.thefamousgroup.com/go/i/${deployment.token}"><button class="uk-button uk-button-default">Participant</button></a>`;
        row.appendChild(cell1);
    
        // producer button
        const cell2 = document.createElement('td');
        cell2.innerHTML = `<a target="_blank" href="https://lightshow.vixisuite.thefamousgroup.com/producer/${deployment.token}"><button class="uk-button uk-button-default">Producer</button></a>`;
        row.appendChild(cell2);

        // output button
        const cell3 = document.createElement('td');
        cell3.innerHTML = `<a target="_blank" href="https://lightshow.vixisuite.thefamousgroup.com/output/${deployment.token}"><button class="uk-button uk-button-default">Output</button></a>`;
        row.appendChild(cell3);

        // isMLB toggle
        const mlbCell = document.createElement('td');
        mlbCell.className = 'col-right';
        const mlbToggle = document.createElement('input');
        mlbToggle.type = 'checkbox';
        mlbToggle.className = 'uk-checkbox';
        mlbToggle.checked = deployment.isMLB || false;
        mlbToggle.addEventListener('change', () => {
            console.log('### Updating MLB flag', mlbToggle.checked);
            socket.emit('helper-update-deployment-flags',
                { firestoreRoot: deployment.firestoreRoot, flags: { isMLB: mlbToggle.checked } },
                (res) => {
                    if (!res?.success) {
                        mlbToggle.checked = !mlbToggle.checked;
                        UIkit.notification({ message: 'Failed to update MLB flag', status: 'danger', pos: 'top-center', timeout: 3000 });
                    }
                }
            );
        });
        mlbCell.appendChild(mlbToggle);
        row.appendChild(mlbCell);

        // gateRecordingEnabled toggle
        const gateCell = document.createElement('td');
        gateCell.className = 'col-right';
        const gateToggle = document.createElement('input');
        gateToggle.type = 'checkbox';
        gateToggle.className = 'uk-checkbox';
        gateToggle.checked = deployment.gateRecordingEnabled || false;
        gateToggle.addEventListener('change', () => {
            console.log('### Updating gate recording enabled flag', gateToggle.checked);
            socket.emit('helper-update-deployment-flags',
                { firestoreRoot: deployment.firestoreRoot, flags: { gateRecordingEnabled: gateToggle.checked } },
                (res) => {
                    if (!res?.success) {
                        gateToggle.checked = !gateToggle.checked;
                        UIkit.notification({ message: 'Failed to update recording gate', status: 'danger', pos: 'top-center', timeout: 3000 });
                    }
                }
            );
        });
        gateCell.appendChild(gateToggle);
        row.appendChild(gateCell);

        // requestMic toggle
        const requestMicCell = document.createElement('td');
        requestMicCell.className = 'col-right';
        const requestMicToggle = document.createElement('input');
        requestMicToggle.type = 'checkbox';
        requestMicToggle.className = 'uk-checkbox';
        requestMicToggle.checked = deployment.requestMic || false;
        requestMicToggle.addEventListener('change', () => {
            socket.emit('helper-update-deployment-flags',
                { firestoreRoot: deployment.firestoreRoot, flags: { requestMic: requestMicToggle.checked } },
                (res) => {
                    if (!res?.success) {
                        requestMicToggle.checked = !requestMicToggle.checked;
                        UIkit.notification({ message: 'Failed to update Request mic', status: 'danger', pos: 'top-center', timeout: 3000 });
                    }
                }
            );
        });
        requestMicCell.appendChild(requestMicToggle);
        row.appendChild(requestMicCell);

        // recordingSlider toggle
        const recordingSliderCell = document.createElement('td');
        recordingSliderCell.className = 'col-right';
        const recordingSliderToggle = document.createElement('input');
        recordingSliderToggle.type = 'checkbox';
        recordingSliderToggle.className = 'uk-checkbox';
        recordingSliderToggle.checked = deployment.recordingSlider !== false;
        recordingSliderToggle.addEventListener('change', () => {
            socket.emit('helper-update-deployment-flags',
                { firestoreRoot: deployment.firestoreRoot, flags: { recordingSlider: recordingSliderToggle.checked } },
                (res) => {
                    if (!res?.success) {
                        recordingSliderToggle.checked = !recordingSliderToggle.checked;
                        UIkit.notification({ message: 'Failed to update Recording slider', status: 'danger', pos: 'top-center', timeout: 3000 });
                    }
                }
            );
        });
        recordingSliderCell.appendChild(recordingSliderToggle);
        row.appendChild(recordingSliderCell);

        deploymentsDiv.appendChild(row);
        count++;
    }
});

socket.on('display-name', (displayName) => {
    console.log('### DISPLAY NAME', displayName);
    displayName = displayName;
});
/* --------------------------------------------------------------------------------------------------------------- */
/* Helper (add new deployment to the deployments db)                                                               */
/* --------------------------------------------------------------------------------------------------------------- */
//make this async with a callback
const createBtn = document.getElementById('create-btn');
const createBtnText = createBtn.innerHTML;
let timeoutId = null;

createBtn.addEventListener('click', async () => {
    
    try {
        createBtn.disabled = true;
        createBtn.innerHTML = '<div uk-spinner></div> Creating deployment...';

        const organizationName = document.getElementById('organization-name');
        const firebaseDocName = document.getElementById('firebase-doc-name');
        const token = document.getElementById('token');

        // Validate inputs
        if (!organizationName?.value || !firebaseDocName?.value || !token?.value) {
            UIkit.notification({
                message: 'Please fill in all fields',
                status: 'danger',
                pos: 'top-center',
                timeout: 3000
            });
            return;
        }

        const data = { 
            displayName: organizationName.value,
            firestoreRoot: firebaseDocName.value,
            token: token.value
        };

        // Safety timeout to re-enable UI if callback not invoked
        timeoutId = setTimeout(() => {
            createBtn.innerHTML = createBtnText;
            createBtn.disabled = false;
        }, 3000);

        socket.emit('helper-add-deployment', data, (response = {}) => {
            try {
                if (timeoutId) clearTimeout(timeoutId);
                // Reset UI
                createBtn.innerHTML = createBtnText;
                createBtn.disabled = false;
                if (!response.success) {
                    UIkit.notification({
                        message: response.error ? `Deployment failed: ${response.error}` : 'Deployment creation failed',
                        status: 'danger',
                        pos: 'top-center',
                        timeout: 3000
                    });
                    console.error('Deployment creation failed', response);
                } else {
                    UIkit.notification({
                        message: 'Deployment created',
                        status: 'success',
                        pos: 'top-center',
                        timeout: 3000
                    });
                    
                    organizationName.value = '';
                    firebaseDocName.value = '';
                    token.value = '';
                }
            } catch (cbErr) {
                console.error('Deployment callback error', cbErr);
            }
        });
    } catch (err) {
        console.error('Create deployment error', err);
        UIkit.notification({
            message: 'Unexpected error creating deployment',
            status: 'danger',
            pos: 'top-center',
            timeout: 3000
        });
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        createBtn.innerHTML = createBtnText;
        createBtn.disabled = false;
    }
});


/* --------------------------------------------------------------------------------------------------------------- */
/* Helper (get the tickets and orgs from the server)                                                               */
/* --------------------------------------------------------------------------------------------------------------- */
/*
let listShowOrgsAndTickets = [];
const matchTicketsAndOrgs = async () => {
    //loop through the paths array and find the entries that don't exist in mappedOrgsAndTickets based on the firebaseRoot value
    for (const path of paths) {
        const entry = mappedOrgsAndTickets.find(o => o.firestoreRoot === path.firestoreRoot);
        if (!entry) {
            console.log('Path', path.displayName, 'does not exist in mappedOrgsAndTickets');
        }
    }
}
*/
//matchTicketsAndOrgs();
