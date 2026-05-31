import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const browserUsePatchedDesktopFeaturesRegex = new RegExp(
  String.raw`function (?<fn>${IDENTIFIER})\((?<settings>${IDENTIFIER}),\{buildFlavor:(?<buildFlavor>${IDENTIFIER})=(?<buildModule>${IDENTIFIER})\.(?<buildEnum>${IDENTIFIER})\.resolve\(\),env:(?<env>${IDENTIFIER})=(?<processModule>${IDENTIFIER})\.default\.env,platform:(?<platform>${IDENTIFIER})=\k<processModule>\.default\.platform\}=\{\}\)\{let (?<features>${IDENTIFIER})=\k<platform>===\`linux\`&&\k<env>\.CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE===\`1\`\?\{\.\.\.\k<settings>,browserPane:!0,inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0\}:\k<platform>===\`win32\`&&\k<env>\.CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===\`1\`\?\{\.\.\.\k<settings>,computerUse:!0,computerUseNodeRepl:!0\}:\k<settings>,(?<devOverrides>${IDENTIFIER})=\k<buildFlavor>===\k<buildModule>\.\k<buildEnum>\.Dev\?(?<readEnvOverrides>${IDENTIFIER})\(\k<env>\):null;return \k<devOverrides>==null\?\k<features>:\{\.\.\.\k<features>,\.\.\.\k<devOverrides>\}\}`,
);

function replaceRemoteControlDesktopFeatures(...args) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error("remote-control desktop feature patch expected named regex groups");
  }

  const {
    fn,
    settings,
    buildFlavor,
    buildModule,
    buildEnum,
    env,
    processModule,
    platform,
    features,
    devOverrides,
    readEnvOverrides,
  } = groups;

  return `function ${fn}(${settings},{buildFlavor:${buildFlavor}=${buildModule}.${buildEnum}.resolve(),env:${env}=${processModule}.default.env,platform:${platform}=${processModule}.default.platform}={}){let ${features}=${platform}===\`linux\`?{...${settings},control:!0,...${env}.CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE===\`1\`?{browserPane:!0,inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0}:{}}:${platform}===\`win32\`&&${env}.CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===\`1\`?{...${settings},computerUse:!0,computerUseNodeRepl:!0}:${settings},${devOverrides}=${buildFlavor}===${buildModule}.${buildEnum}.Dev?${readEnvOverrides}(${env}):null;return ${devOverrides}==null?${features}:{...${features},...${devOverrides}}}`;
}

export const remoteControlBackendFeature = {
  id: "remote-control-backend",
  version: 2,
  requiredMarkers: FEATURE_MARKERS["remote-control-backend"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["remote-control-backend"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    return {
      ...bundleSources,
      main: replaceOrThrow(
        bundleSources.main,
        browserUsePatchedDesktopFeaturesRegex,
        replaceRemoteControlDesktopFeatures,
        "Linux remote-control desktop feature availability",
        {
          appliedMarkers: [
            new RegExp(String.raw`${IDENTIFIER}===\`linux\`\?\{\.\.\.${IDENTIFIER},control:!0`),
          ],
        },
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(bundleSources.main, this.requiredMarkers, "Linux remote-control backend patch");
    ensureMarkersAbsent(bundleSources.main, this.forbiddenMarkers, "Linux remote-control backend patch");
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
