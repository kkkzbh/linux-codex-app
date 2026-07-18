import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamCompatiblePlatform =
  /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{return \2===`macOS`\|\|\2===`windows`\}/;
const linuxCompatiblePlatform =
  "function $1($2){return $2===`macOS`||$2===`windows`||$2===`linux`}";
const linuxCompatiblePlatformMarker =
  /function [A-Za-z_$][\w$]*\(([A-Za-z_$][\w$]*)\)\{return \1===`macOS`\|\|\1===`windows`\|\|\1===`linux`\}/;

const upstreamComputerUseGate =
  /isComputerUseGateEnabled:([A-Za-z_$][\w$]*),isHostCompatiblePlatform:([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\),isPlatformLoading:([A-Za-z_$][\w$]*),windowType:`electron`/;
const linuxComputerUseGate =
  "isComputerUseGateEnabled:$1||$3===`linux`,isHostCompatiblePlatform:$2($3),isPlatformLoading:$4,windowType:`electron`";
const linuxComputerUseGateMarker =
  /isComputerUseGateEnabled:[A-Za-z_$][\w$]*\|\|[A-Za-z_$][\w$]*===`linux`,isHostCompatiblePlatform:[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\),isPlatformLoading:[A-Za-z_$][\w$]*,windowType:`electron`/;

export const computerUseAvailabilityFeature = {
  id: "computer-use-availability",
  version: 2,
  requiredMarkers: FEATURE_MARKERS["computer-use-availability"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["computer-use-availability"].forbiddenMarkers,
  apply(bundleSources, context) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let webviewPluginFeatureGate = replaceOrThrow(
      bundleSources.webviewPluginFeatureGate,
      upstreamCompatiblePlatform,
      linuxCompatiblePlatform,
      "Linux Computer Use compatible platform gate",
      { appliedMarker: linuxCompatiblePlatformMarker },
    );

    webviewPluginFeatureGate = replaceOrThrow(
      webviewPluginFeatureGate,
      upstreamComputerUseGate,
      linuxComputerUseGate,
      "Linux Computer Use statsig gate",
      { appliedMarker: linuxComputerUseGateMarker },
    );

    let sources = {
      ...bundleSources,
      webviewPluginFeatureGate,
    };
    if (typeof context?.syncSharedBundleSource === "function") {
      sources = context.syncSharedBundleSource(sources, "webviewPluginFeatureGate", webviewPluginFeatureGate);
    }
    return sources;
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewPluginFeatureGate,
      this.requiredMarkers.webviewPluginFeatureGate,
      "Linux Computer Use availability patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewPluginFeatureGate,
      this.forbiddenMarkers.webviewPluginFeatureGate,
      "Linux Computer Use availability patch",
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
