import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const setPreferredAppRegex = new RegExp(
  String.raw`"set-preferred-app":async\(\{target:(?<target>${IDENTIFIER})\}\)=>\((?<persist>${IDENTIFIER})\(this\.getSettingsStore\(\),null,\k<target>\),\{success:!0\}\)`,
);

function replaceSetPreferredApp(...args) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error("preferred target patch expected named regex groups");
  }

  const { target, persist } = groups;
  return `"set-preferred-app":async({target:${target},cwd:codexLinuxPreferredTargetCwd})=>(${persist}(this.getSettingsStore(),codexLinuxPreferredTargetCwd??null,${target}),{success:!0})`;
}

export const preferencesFeature = {
  id: "preferences",
  version: 5,
  requiredMarkers: FEATURE_MARKERS.preferences.requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS.preferences.forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    return {
      ...bundleSources,
      main: replaceOrThrow(
        bundleSources.main,
        setPreferredAppRegex,
        replaceSetPreferredApp,
        "current upstream preferred target persistence",
        {
          appliedMarkers: [
            '"set-preferred-app":async({target:',
            "cwd:codexLinuxPreferredTargetCwd",
            "codexLinuxPreferredTargetCwd??null",
          ],
        },
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(bundleSources.main, this.requiredMarkers, "Linux preferred target patch");
    ensureMarkersAbsent(bundleSources.main, this.forbiddenMarkers, "Linux preferred target patch");
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
