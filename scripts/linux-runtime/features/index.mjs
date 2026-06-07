import { avatarOverlayTransparencyFeature } from "./avatar-overlay-transparency.mjs";
import { browserChromeFeature } from "./browser-chrome/index.mjs";
import { computerUseAvailabilityFeature } from "./computer-use-availability.mjs";
import { computerUseProviderFeature } from "./computer-use-provider.mjs";
import { generatedOutputArtifactsFeature } from "./generated-output-artifacts.mjs";
import { markdownLocalMediaFeature } from "./markdown-local-media.mjs";
import { nativeTitlebarFeature } from "./native-titlebar.mjs";
import { openTargetsFeature } from "./open-targets.mjs";
import { settingsSidebarSurfaceFeature } from "./settings-sidebar-surface.mjs";
import {
  assertLinuxPatchContracts,
  describeLinuxPatchFeature,
} from "../patch-contracts.mjs";
import { RETIRED_LINUX_PATCH_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent } from "../replace-utils.mjs";

export const linuxPatchFeatures = [
  openTargetsFeature,
  markdownLocalMediaFeature,
  generatedOutputArtifactsFeature,
  nativeTitlebarFeature,
  settingsSidebarSurfaceFeature,
  avatarOverlayTransparencyFeature,
  browserChromeFeature,
  computerUseAvailabilityFeature,
  computerUseProviderFeature,
];

assertLinuxPatchContracts(linuxPatchFeatures);

export const linuxPatchFeatureContracts = linuxPatchFeatures.map(describeLinuxPatchFeature);

export function verifyLinuxPatchSource(bundleSources, context) {
  for (const feature of linuxPatchFeatures) {
    feature.verify(bundleSources, context);
  }
  verifyRetiredLinuxPatchMarkers(bundleSources);
}

function verifyRetiredLinuxPatchMarkers(bundleSources) {
  for (const [sourceKey, markers] of Object.entries(RETIRED_LINUX_PATCH_MARKERS)) {
    ensureMarkersAbsent(
      bundleSources[sourceKey] ?? "",
      markers,
      `retired Linux patch markers in ${sourceKey}`,
    );
  }
}
