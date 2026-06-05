import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const upstreamBrowserUseAvailabilityRegex = new RegExp(
  String.raw`function (?<fn>${IDENTIFIER})\((?<settings>${IDENTIFIER}),\{buildFlavor:(?<buildFlavor>${IDENTIFIER})=(?<buildModule>${IDENTIFIER})\.(?<buildEnum>${IDENTIFIER})\.resolve\(\),env:(?<env>${IDENTIFIER})=(?<processModule>${IDENTIFIER})\.default\.env,platform:(?<platform>${IDENTIFIER})=\k<processModule>\.default\.platform\}=\{\}\)\{let (?<features>${IDENTIFIER})=\k<platform>===\`win32\`&&\k<env>\.CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===\`1\`\?\{\.\.\.\k<settings>,computerUse:!0,computerUseNodeRepl:!0\}:\k<settings>,(?<devOverrides>${IDENTIFIER})=\k<buildFlavor>===\k<buildModule>\.\k<buildEnum>\.Dev\?(?<readEnvOverrides>${IDENTIFIER})\(\k<env>\):null;return \k<devOverrides>==null\?\k<features>:\{\.\.\.\k<features>,\.\.\.\k<devOverrides>\}\}`,
);

function replacementGroups(args) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error("Linux Browser Use patch expected named regex groups");
  }
  return groups;
}

function replaceBrowserUseAvailability(...args) {
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
  } = replacementGroups(args);

  return `function ${fn}(${settings},{buildFlavor:${buildFlavor}=${buildModule}.${buildEnum}.resolve(),env:${env}=${processModule}.default.env,platform:${platform}=${processModule}.default.platform}={}){let ${features}=${platform}===\`linux\`&&${env}.CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE===\`1\`?{...${settings},browserPane:!0,inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0}:${platform}===\`win32\`&&${env}.CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===\`1\`?{...${settings},computerUse:!0,computerUseNodeRepl:!0}:${settings},${devOverrides}=${buildFlavor}===${buildModule}.${buildEnum}.Dev?${readEnvOverrides}(${env}):null;return ${devOverrides}==null?${features}:{...${features},...${devOverrides}}}`;
}

export const browserUseFeature = {
  id: "browser-use",
  version: 3,
  requiredMarkers: FEATURE_MARKERS["browser-use"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["browser-use"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    return {
      ...bundleSources,
      main: replaceOrThrow(
        bundleSources.main,
        upstreamBrowserUseAvailabilityRegex,
        replaceBrowserUseAvailability,
        "Linux Browser Use desktop feature availability",
        {
          appliedMarkers: [
            "CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE",
            "inAppBrowserUseAllowed:!0",
            "externalBrowserUseAllowed:!0",
          ],
        },
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(bundleSources.main, this.requiredMarkers, "Linux Browser Use patch");
    ensureMarkersAbsent(bundleSources.main, this.forbiddenMarkers, "Linux Browser Use patch");
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
