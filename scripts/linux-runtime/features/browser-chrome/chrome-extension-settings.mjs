import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../../replace-utils.mjs";

const upstreamChromeExtensionSettingsOpen =
  "async function Wo({extensionId:e,platform:t=process.platform,detectChromeCommand:n=Go,runCommand:r=So}){if(t===`darwin`){await r(Bo,[`-b`,zo,Ho(e)]);return}if(t===`win32`){let t=n();if(t==null)throw Error(`Google Chrome is not installed`);await r(t,[Ho(e)]);return}throw Error(`Opening Chrome extension settings is only supported on macOS and Windows`)}function Go(){return vo(`chrome.exe`)??vo(`chrome`)??Ao([[`Google`,`Chrome`,`Application`,`chrome.exe`]])??Ko()}";

const linuxChromeExtensionSettingsOpen =
  "async function Wo({extensionId:e,platform:t=process.platform,detectChromeCommand:n=Go,runCommand:r=So}){if(t===`darwin`){await r(Bo,[`-b`,zo,Ho(e)]);return}if(t===`win32`){let t=n();if(t==null)throw Error(`Google Chrome is not installed`);await r(t,[Ho(e)]);return}if(t===`linux`){let t=codexLinuxDetectChromeCommand();if(t==null)throw Error(`Google Chrome is not installed`);await r(t,[Ho(e)]);return}throw Error(`Opening Chrome extension settings is only supported on macOS, Windows, and Linux`)}function codexLinuxDetectChromeCommand(){return vo(`google-chrome`)??vo(`google-chrome-stable`)??vo(`chromium`)??vo(`chromium-browser`)??vo(`chrome`)}function Go(){return vo(`chrome.exe`)??vo(`chrome`)??Ao([[`Google`,`Chrome`,`Application`,`chrome.exe`]])??Ko()}";

const upstreamChromeExtensionSettingsButton =
  "F=n===`macOS`||n===`windows`?(0,Z.jsx)(y,{color:`danger`,disabled:x==null||C||!S,onClick:()=>{x!=null&&f(`chrome-extension-settings-open`,{params:{extensionId:x}}).catch(()=>{t.get(k).danger((0,Z.jsx)(g,{id:`settings.computerUse.chrome.openExtensionSettingsError`,defaultMessage:`Unable to open Chrome extension settings`,description:`Toast shown when the app fails to open Chrome extension settings`}))})},size:`toolbar`,children:(0,Z.jsx)(g,{id:`settings.computerUse.chrome.removeExtension`,defaultMessage:`Remove extension`,description:`Button label to remove the Google Chrome extension`})}):null";

const linuxChromeExtensionSettingsButton =
  "F=n===`macOS`||n===`windows`||n===`linux`?(0,Z.jsx)(y,{color:`danger`,disabled:x==null||C||!S,onClick:()=>{x!=null&&f(`chrome-extension-settings-open`,{params:{extensionId:x}}).catch(()=>{t.get(k).danger((0,Z.jsx)(g,{id:`settings.computerUse.chrome.openExtensionSettingsError`,defaultMessage:`Unable to open Chrome extension settings`,description:`Toast shown when the app fails to open Chrome extension settings`}))})},size:`toolbar`,children:(0,Z.jsx)(g,{id:`settings.computerUse.chrome.removeExtension`,defaultMessage:`Remove extension`,description:`Button label to remove the Google Chrome extension`})}):null";

export const chromeExtensionSettingsFeature = {
  id: "chrome-extension-settings",
  version: 1,
  requiredMarkers: FEATURE_MARKERS["chrome-extension-settings"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["chrome-extension-settings"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    return {
      ...bundleSources,
      main: replaceOrThrow(
        bundleSources.main,
        upstreamChromeExtensionSettingsOpen,
        linuxChromeExtensionSettingsOpen,
        "Linux Chrome extension settings opener",
        {
          appliedMarkers: ["function codexLinuxDetectChromeCommand()"],
        },
      ),
      webviewComputerUseSettings: replaceOrThrow(
        bundleSources.webviewComputerUseSettings,
        upstreamChromeExtensionSettingsButton,
        linuxChromeExtensionSettingsButton,
        "Linux Chrome extension settings button",
        {
          appliedMarkers: ["n===`macOS`||n===`windows`||n===`linux`"],
        },
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.main,
      this.requiredMarkers.main,
      "Linux Chrome extension settings opener patch",
    );
    ensureMarkersAbsent(
      bundleSources.main,
      this.forbiddenMarkers.main,
      "Linux Chrome extension settings opener patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewComputerUseSettings,
      this.requiredMarkers.webviewComputerUseSettings,
      "Linux Chrome extension settings button patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewComputerUseSettings,
      this.forbiddenMarkers.webviewComputerUseSettings,
      "Linux Chrome extension settings button patch",
    );
  },
  isApplied(bundleSources) {
    try {
      this.verify(bundleSources);
      return true;
    } catch {
      return false;
    }
  },
};
