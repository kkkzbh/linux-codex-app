import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamCompatiblePlatform = "function _(e){return e===`macOS`||e===`windows`}";
const linuxCompatiblePlatform =
  "function _(e){return e===`macOS`||e===`windows`||e===`linux`}";

const upstreamComputerUseGate =
  "isComputerUseGateEnabled:s,isHostCompatiblePlatform:_(o),isPlatformLoading:a,windowType:`electron`";
const linuxComputerUseGate =
  "isComputerUseGateEnabled:s||o===`linux`,isHostCompatiblePlatform:_(o),isPlatformLoading:a,windowType:`electron`";

export const computerUseAvailabilityFeature = {
  id: "computer-use-availability",
  version: 1,
  requiredMarkers: FEATURE_MARKERS["computer-use-availability"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["computer-use-availability"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let webviewPluginFeatureGate = replaceOrThrow(
      bundleSources.webviewPluginFeatureGate,
      upstreamCompatiblePlatform,
      linuxCompatiblePlatform,
      "Linux Computer Use compatible platform gate",
    );

    webviewPluginFeatureGate = replaceOrThrow(
      webviewPluginFeatureGate,
      upstreamComputerUseGate,
      linuxComputerUseGate,
      "Linux Computer Use statsig gate",
    );

    return {
      ...bundleSources,
      webviewPluginFeatureGate,
    };
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
