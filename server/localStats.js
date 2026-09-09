let sessions = [];
/*
session = {
    displayName: '',
    token: '',
    firestoreRoot: '',
    connections: {  
        users: 0,
        usersHighest: 0,
        torch: 0,
        torchHighest: 0,
    }
}
*/

/* --------------------------------------------------------------------------------------------------------------- */
/* Helpers                                                                                                         */
/* --------------------------------------------------------------------------------------------------------------- */
function addSession(data) {
    sessions.push(data);
}

function removeSession(data) {
    sessions = sessions.filter(session => session.token !== data.token);
}

function checkIfSessionExists(data) {
    return sessions.some(session => session.token === data);
}
/* --------------------------------------------------------------------------------------------------------------- */
/* GET functions                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
async function getLocalStats(msgType = null, session = null) {
    //loop through the sessionsCopy and log the session data
    
    if (session === null && sessions.length <= 0) {
        console.log('### No sessions found');
        return;
    }

    // Lock and unlock
    if(session !== null ) {
        console.log('### Message Type: ', msgType, ', Display Name: ', session.displayName, ', ', 
            "Users:[" + session.connections.users + "," + session.connections.usersHighest + "]",
            ", Torches:[" + session.connections.torch + "," + session.connections.torchHighest + "]",
            ", Torches failed:[" + session.connections.torchConnectFailed + "]");
    } else {
        sessions.forEach(session => {

            console.log('### Message Type: update', ', Display Name: ', session.displayName, ', ', 
                "Users:[" + session.connections.users + "," + session.connections.usersHighest + "]",
                ", Torches:[" + session.connections.torch + "," + session.connections.torchHighest + "]",
                ", Torches failed:[" + session.connections.torchConnectFailed + "]");
            
            // Remove the session if the users count is <= 0
            if (session.connections.users <= 0 ) {
                removeSession(session);
            } 
        });
    }
    //console.log('---------------------------');
}

/* --------------------------------------------------------------------------------------------------------------- */
/* SET functions                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
async function setLocalStats(data, msgType) {
    //console.log('### setLocalStats', data);

    if(!checkIfSessionExists(data.token)) {
        //console.log('### session does not exist', data.token);
        //add the session to the sessions array which looks like this: 
        let session = {
            displayName: data.displayName || 'Unknown',
            token: data.token,
            firestoreRoot: data.firestoreRoot,
            connections: {  
                users: 0,
                usersHighest: 0,
                torch: 0,
                torchHighest: 0,
                torchConnectFailed: 0,
                torchErrors: [] // array of objects with the following properties: torchError: string, device: string, message: string, timestamp: string
            }
        }
        addSession(session);
    }

    const session = sessions.find(session => session.token === data.token);
    if(!session) {
        console.error('### setLocalStats: session not found', data);
        return;
    }
    //update the session with the new data using a switch statement
    switch (msgType) {
        case 'user_connected':
            session.connections.users++;
            session.connections.usersHighest++;
            break;
        case 'user_disconnected':
            //don't let the users count go below 0
            if(session.connections.users > 0) {
                session.connections.users--;
            }
            break;
        case 'torch_connected':
            session.connections.torch++;
            session.connections.torchHighest++;
            break;
        case 'torch_disconnected':
            //don't let the torch count go below 0
            if(session.connections.torch > 0) {
                session.connections.torch--;
            }
            break;
        case 'torch_connect_failed':
            session.connections.torchConnectFailed++;
            session.connections.torchErrors.push({
                torchError: data.torchError,
                device: data.device,
                message: data.message,
            });
            break;
        case 'lock':
            //console.log('### Organization locked (display name)', session.displayName);
            await getLocalStats("lock" , session);
            removeSession(session);
            break;
        case 'unlock':
            //console.log('### Organization unlocked (display name)', session.displayName);
            await getLocalStats("unlock", session);
            break;
        default:
            console.log('### Set Local Stats (invalid message type)', msgType);
            break;
    }
}

module.exports = {
    getLocalStats,
    setLocalStats
};