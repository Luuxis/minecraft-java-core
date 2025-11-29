/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const path = require('path')
const { app, BrowserWindow, session } = require('electron')

const defaultProperties = {
    width: 1000,
    height: 650,
    resizable: false,
    center: true,
    icon: path.join(__dirname, '../../../assets/icons', `Microsoft.${(process.platform === 'win32') ? 'ico' : 'png'}`),
}

module.exports = async function (url: string, redirect_uri: string = "https://login.live.com/oauth20_desktop.srf") {
    await new Promise((resolve: any) => {
        app.whenReady().then(() => {
            session.defaultSession.cookies.get({ domain: 'live.com' }).then((cookies: any) => {
                for (let cookie of cookies) {
                    let urlcookie = `http${cookie.secure ? "s" : ""}://${cookie.domain.replace(/$\./, "") + cookie.path}`;
                    session.defaultSession.cookies.remove(urlcookie, cookie.name)
                }
            })
            return resolve();
        })
    })

    return new Promise(resolve => {
        app.whenReady().then(() => {
            const mainWindow = new BrowserWindow(defaultProperties)
            mainWindow.setMenu(null);
            mainWindow.loadURL(url);
            var loading = false;

            mainWindow.on("close", () => {
                if (!loading) resolve("cancel");
            })

            mainWindow.webContents.on("did-finish-load", () => {
                const loc = mainWindow.webContents.getURL();
                if (loc.startsWith(redirect_uri)) {
                    const urlParams = new URLSearchParams(loc.substr(loc.indexOf("?") + 1)).get("code");
                    if (urlParams) {
                        resolve(urlParams);
                        loading = true;
                    } else {
                        resolve("cancel");
                    }
                    try {
                        mainWindow.close();
                    } catch {
                        console.error("Failed to close window!");
                    }
                }
            })
        })
    })
}