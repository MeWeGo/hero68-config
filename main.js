const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const VENDOR_ID = 0x372e;
const PRODUCT_ID = 0x103e;

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#111216",
    autoHideMenuBar: true,
    title: "HERO 68 Config",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const ses = win.webContents.session;
  const isHero = (d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID;

  // WebHID: pick the keyboard automatically instead of showing Chrome's chooser.
  ses.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    callback(details.deviceList.find(isHero)?.deviceId ?? "");
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === "hid");
  ses.setDevicePermissionHandler((d) => d.deviceType === "hid" && isHero(d.device));

  // Links (e.g. the music-service download) open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
