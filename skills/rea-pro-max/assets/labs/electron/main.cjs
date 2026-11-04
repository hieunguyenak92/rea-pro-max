const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
app.setPath('userData', path.join(os.tmpdir(), 'rpm-owned-electron-profile'));
ipcMain.handle('rpm:export', async (_event, payload) => {
  if (!payload || !Array.isArray(payload.records) || payload.records.length > 100) throw new Error('Use a bounded records array.');
  const records = payload.records.map(row => ({ id: String(row.id), text: String(row.text) }));
  const output = path.join(app.getPath('userData'), 'synthetic-export.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(records, null, 2) + '\n');
  return { records, output, context: 'electron-main', bytes: fs.statSync(output).size };
});
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1050, height: 800, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  window.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
