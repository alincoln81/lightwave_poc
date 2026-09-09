/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Socket.IO                                                                                            */
/* --------------------------------------------------------------------------------------------------------------- */
const socket = io();

/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize the connection ID, assets, connection counts, playlist, settings, and programs                       */
/* --------------------------------------------------------------------------------------------------------------- */
let connectionId = null;
let localStorage = null;

const PAGES = {
    fiveHundred: '500.html'
 }
 
/* --------------------------------------------------------------------------------------------------------------- */
/* Initialize Output                                                                                               */
/* --------------------------------------------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    console.log('Output loaded');
});

/* --------------------------------------------------------------------------------------------------------------- */
/* Announce the Output to the server once the connection is established                                          */
/* --------------------------------------------------------------------------------------------------------------- */
//get the token from the url path
const token = window.location.pathname.split('/').pop();
console.log('Token: ', token);

socket.on('server-ready', (timestamp, id) => {
    // convert timestamp to human readable date
    const date = new Date(timestamp);
    const humanReadableDate = date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' });
    connectionId = id;

    console.log('Server ready, announcing output', humanReadableDate, connectionId);
    socket.emit('output-connected', token, Date.now());
});

socket.on('token-not-found', (token) => {
    console.error('Token not found');
    window.location.href = `../${PAGES.fiveHundred}`;
});
/* --------------------------------------------------------------------------------------------------------------- */
/* SOCKET EVENTS                                                                                                   */
/* --------------------------------------------------------------------------------------------------------------- */
socket.on('assets-settings', (assets, settings, displayName) => {
    console.log('### ASSETS', assets);
    console.log('### SETTINGS', settings);
    console.log('### DISPLAY NAME', displayName);
    localStorage = {
        assets: assets,
        settings: settings,
        displayName: displayName
    };
    displayAssets(localStorage.assets);
});

socket.on('assets', (assets) => {
    console.log('Assets', assets);
    displayAssets(assets);
});

function displayAssets(assets) {
    //console.log('Displaying assets', assets);
    if(assets.output.backgroundImage.url) document.getElementById('output-container').style.backgroundImage = `url(${assets.output.backgroundImage.url})`;
    if(assets.output.titleImage.url) document.getElementById('output-title').style.backgroundImage = `url(${assets.output.titleImage.url})`;
    if(assets.qr.url) document.getElementById('output-qr').style.backgroundImage = `url(${assets.qr.url})`;
}
