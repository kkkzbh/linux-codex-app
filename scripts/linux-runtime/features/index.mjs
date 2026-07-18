import { browserChromeFeature } from "./browser-chrome/index.mjs";
import { computerUseAvailabilityFeature } from "./computer-use-availability.mjs";
import { computerUseProviderFeature } from "./computer-use-provider.mjs";
import { generatedOutputArtifactsFeature } from "./generated-output-artifacts.mjs";
import { multiWindowSecondInstanceFeature } from "./multi-window-second-instance.mjs";
import { nativeTitlebarFeature } from "./native-titlebar.mjs";
import { openTargetsFeature } from "./open-targets.mjs";
import { settingsSidebarSurfaceFeature } from "./settings-sidebar-surface.mjs";
import { settingsSuggestedPromptsFeature } from "./settings-suggested-prompts.mjs";
import {
  assertLinuxPatchContracts,
  describeLinuxPatchFeature,
} from "../patch-contracts.mjs";
import { RETIRED_LINUX_PATCH_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent } from "../replace-utils.mjs";

export const linuxPatchFeatures = [
  openTargetsFeature,
  generatedOutputArtifactsFeature,
  multiWindowSecondInstanceFeature,
  nativeTitlebarFeature,
  settingsSidebarSurfaceFeature,
  settingsSuggestedPromptsFeature,
  browserChromeFeature,
  computerUseAvailabilityFeature,
  computerUseProviderFeature,
];

assertLinuxPatchContracts(linuxPatchFeatures);

export const linuxPatchFeatureContracts = linuxPatchFeatures.map(describeLinuxPatchFeature);

export function synchronizeSharedBundleSources(previousSources, nextSources, context) {
  const sourceKeysByPath = new Map();
  for (const [sourceKey, sourcePath] of Object.entries(context?.bundleSourcePaths ?? {})) {
    if (typeof sourcePath !== "string" || !Object.hasOwn(nextSources, sourceKey)) {
      continue;
    }
    const sourceKeys = sourceKeysByPath.get(sourcePath) ?? [];
    sourceKeys.push(sourceKey);
    sourceKeysByPath.set(sourcePath, sourceKeys);
  }

  const synchronizedSources = { ...nextSources };
  for (const [sourcePath, sourceKeys] of sourceKeysByPath) {
    if (sourceKeys.length < 2) {
      continue;
    }
    const changedKeys = sourceKeys.filter(
      (sourceKey) => nextSources[sourceKey] !== previousSources[sourceKey],
    );
    if (changedKeys.length === 0) {
      continue;
    }
    const changedSources = new Set(changedKeys.map((sourceKey) => nextSources[sourceKey]));
    if (changedSources.size !== 1) {
      throw new Error(
        `Linux patch produced conflicting updates for shared bundle ${sourcePath}: ${changedKeys.join(", ")}`,
      );
    }
    const [sharedSource] = changedSources;
    for (const sourceKey of sourceKeys) {
      synchronizedSources[sourceKey] = sharedSource;
    }
  }
  return synchronizedSources;
}

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
