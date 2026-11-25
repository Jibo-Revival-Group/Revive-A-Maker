'use strict';

// Revive-A-Maker for computers: runs the web app's own server (web/server.js) inside Electron's Node and
// shows its pages, the way the Android app runs it in nodejs-mobile behind a WebView.
const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('http');
const net = require('net');
const path = require('path');

// Packaged: resources/ram/{web,assets,res,splash.png}, the same layout server.js expects in the repo.
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'ram') : path.join(__dirname, '..');
// Scratch projects live in the page's storage, which belongs to http://127.0.0.1:<port>, so the port stays fixed.
const PORT = 47173;
const CHECK = process.argv.includes('--check');

function portFree(port) {
    return new Promise(resolve => {
        const probe = net.createServer().once('error', () => resolve(false));
        probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
}

function answering(url) {
    return new Promise(resolve => {
        const attempt = () => http.get(url, res => { res.resume(); resolve(); }).on('error', () => setTimeout(attempt, 100));
        attempt();
    });
}

if (!app.requestSingleInstanceLock()) app.quit(); // a second copy would need the same port
app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
    if (!(await portFree(PORT))) {
        if (!CHECK) dialog.showErrorBox('Revive-A-Maker', 'Another program is using port ' + PORT + ' on this computer, which Revive-A-Maker needs. Close it and open Revive-A-Maker again.');
        return app.exit(1);
    }
    Object.assign(process.env, { PORT: String(PORT), HOST: '127.0.0.1', RAM_MEDIA: path.join(app.getPath('userData'), 'media') });
    require(path.join(ROOT, 'web', 'server.js'));
    const home = 'http://127.0.0.1:' + PORT + '/';
    await answering(home);

    const win = new BrowserWindow({
        width: 1280, height: 820, minWidth: 900, minHeight: 600, title: 'Revive-A-Maker', backgroundColor: '#ffffff',
        icon: path.join(__dirname, 'build/icon.png'), autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, sandbox: true }
    });
    // Our own pages stay in the window; anything else opens in the browser (like the Android app).
    const ours = url => url.startsWith(home);
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (ours(url)) win.loadURL(url);
        else if (/^https?:/.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (!ours(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
    });
    if (CHECK) { // CI: the pairing page and the Scratch playground load from the packaged files
        win.webContents.once('did-finish-load', async () => {
            const title = await win.webContents.executeJavaScript('document.title');
            const playground = await new Promise(resolve => http.get(home + 'playground/index.html', res => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0)));
            const ok = playground === 200 && Boolean(title);
            process.stdout.write('RAM_CHECK ' + JSON.stringify({ ok, title, playground }) + '\n');
            app.exit(ok ? 0 : 1);
        });
    }
    win.loadURL(home);
}).catch(error => { // e.g. a missing file in a broken build: say so instead of showing nothing
    console.error(error);
    if (!CHECK) dialog.showErrorBox('Revive-A-Maker', 'Revive-A-Maker could not start: ' + error.message);
    app.exit(1);
});
app.on('window-all-closed', () => app.quit());
