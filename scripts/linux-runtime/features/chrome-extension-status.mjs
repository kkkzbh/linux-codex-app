import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamChromeProfileRoot =
  "function Co({homeDir:e,localAppDataDir:t,platform:n}){return n===`darwin`?(0,o.join)(e,`Library`,`Application Support`,`Google`,`Chrome`):n===`win32`?(0,o.join)(t??(0,o.join)(e,`AppData`,`Local`),`Google`,`Chrome`,`User Data`):null}";

const linuxChromeProfileRoot =
  "function Co({homeDir:e,localAppDataDir:t,platform:n}){return n===`darwin`?(0,o.join)(e,`Library`,`Application Support`,`Google`,`Chrome`):n===`win32`?(0,o.join)(t??(0,o.join)(e,`AppData`,`Local`),`Google`,`Chrome`,`User Data`):n===`linux`?(0,o.join)(e,`.config`,`google-chrome`):null}";

export const chromeExtensionStatusFeature = {
  id: "chrome-extension-status",
  version: 2,
  requiredMarkers: FEATURE_MARKERS["chrome-extension-status"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["chrome-extension-status"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    return {
      ...bundleSources,
      main: replaceOrThrow(
        bundleSources.main,
        upstreamChromeProfileRoot,
        linuxChromeProfileRoot,
        "Linux Chrome extension installed status profile root",
        {
          appliedMarkers: [linuxChromeProfileRoot],
        },
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(bundleSources.main, this.requiredMarkers, "Linux Chrome extension status patch");
    ensureMarkersAbsent(bundleSources.main, this.forbiddenMarkers, "Linux Chrome extension status patch");
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
