const { app, BrowserWindow, shell, desktopCapturer } = require("electron");
const path = require("path");

const VENDOR_ID = 0x372e;
const PRODUCT_ID = 0x103e;

// Windows groups and labels taskbar buttons by this ID; it matches build.appId in package.json.
// (Not app.setName(): that would move the userData folder and lose saved macros/settings.)
app.setAppUserModelId("io.github.mewego.hero68config");

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#111216",
    autoHideMenuBar: true,
    title: "HERO 68 Config",
    icon: path.join(__dirname, "src", "assets", "icon.png"),
    // backgroundThrottling off: music rhythm must keep streaming 30 fps while minimised or behind other windows
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });

  const ses = win.webContents.session;
  const isHero = (d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID;

  // WebHID: pick the keyboard automatically instead of showing Chrome's chooser.
  ses.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    callback(details.deviceList.find(isHero)?.deviceId ?? "");
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === "hid" || permission === "media");
  ses.setDevicePermissionHandler((d) => d.deviceType === "hid" && isHero(d.device));

  // Music rhythm: getDisplayMedia() gets the PC's playback audio (WASAPI loopback) without a picker.
  // A screen source is required alongside it; the renderer stops that video track immediately.
  ses.setDisplayMediaRequestHandler(async (_req, callback) => {
    const [screen] = await desktopCapturer.getSources({ types: ["screen"] });
    callback({ video: screen, audio: "loopback" });
  });

  // Links (e.g. the music-service download) open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
