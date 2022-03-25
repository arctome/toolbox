const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;

const path = require('path');
const url = require('url');

const { ipcMain, dialog } = require('electron');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800, height: 600, webPreferences: {
            nodeIntegration: true
        }
    });
    const startUrl = process.env.ELECTRON_START_URL || url.format({
        pathname: path.join(__dirname, '/../build/index.html'),
        protocol: 'file:',
        slashes: true
    });
    mainWindow.loadURL(startUrl);
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', function () {
        mainWindow = null
    })
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit()
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow()
    }
});

ipcMain.on('htmlcompilecomplete', (event, b) => {
    if (b) {
        dialog.showMessageBox(mainWindow, {
            title: '成功',
            message: '文件已写入' + b
        })
    } else {
        dialog.showMessageBox(mainWindow, {
            title: '失败',
            message: '写入失败，可能是目录不存在'
        })
    }
})

ipcMain.on('open-directory-dialog', function (event, p) {
    dialog.showOpenDialog({
        properties: [p]
    }).then(function (files) {
        if (files) {
            event.sender.send('selected-item', files)
        }
    })
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
