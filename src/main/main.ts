import { app, BrowserWindow, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createCartoBackend } from './backend/cartoBackend';
import { registerIpc } from './ipc';

let mainWindow: BrowserWindow | null = null;
const backend = createCartoBackend();
const isMac = process.platform === 'darwin';

const resolveWindowIcon = (): string | undefined => {
  const cwd = process.cwd();
  const appPath = app.getAppPath();
  const candidates = [
    path.join(cwd, 'src', 'shared', 'logo.png'),
    path.join(cwd, 'out', 'renderer', 'assets', 'logo.png'),
    path.join(appPath, 'src', 'shared', 'logo.png'),
    path.join(appPath, 'shared', 'logo.png'),
    path.join(__dirname, '../shared/logo.png'),
    path.join(process.resourcesPath, 'logo.png')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
};

const createWindow = (): void => {
  const windowIcon = resolveWindowIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#f7f9fc',
    autoHideMenuBar: !isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL;
  applyCsp(mainWindow, Boolean(devUrl));

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  backend.setWebContents(mainWindow.webContents);
};

app.whenReady().then(() => {
  registerIpc(backend);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const applyCsp = (window: BrowserWindow, isDev: boolean): void => {
  const devServer = isDev ? ' http://localhost:5173 ws://localhost:5173' : '';
  const scriptEval = isDev ? " 'unsafe-eval' 'unsafe-inline'" : '';

  const policy = [
    "default-src 'self'",
    `script-src 'self'${scriptEval}${isDev ? ' http://localhost:5173' : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self'${devServer} ws://127.0.0.1:10000 ws://localhost:10000 ws://127.0.0.1:7447 ws://localhost:7447 ws://127.0.0.1:8000 ws://localhost:8000`,
    "media-src 'self'",
    "object-src 'none'"
  ].join('; ');

  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('devtools://') || details.url.startsWith('chrome-extension://')) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const responseHeaders = {
      ...details.responseHeaders,
      'Content-Security-Policy': [policy]
    };
    callback({ responseHeaders });
  });
};
