import { FEATURE_MARKERS } from "../../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent } from "../../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const VALUE_EXPRESSION = String.raw`(?:${IDENTIFIER}|this\.${IDENTIFIER})`;
const routePartitionAssignmentRegex = new RegExp(
  String.raw`${VALUE_EXPRESSION}\.setAttribute\(\`partition\`,${IDENTIFIER}\(${IDENTIFIER},${IDENTIFIER},${VALUE_EXPRESSION},${VALUE_EXPRESSION}\)\)`,
  "g",
);

export const browserSessionRoutingFeature = {
  id: "browser-session-routing",
  version: 1,
  requiredMarkers: FEATURE_MARKERS["browser-session-routing"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["browser-session-routing"].forbiddenMarkers,
  apply(bundleSources) {
    this.verify(bundleSources);
    return bundleSources;
  },
  verify(bundleSources) {
    for (const [sourceKey, markers] of Object.entries(this.requiredMarkers)) {
      ensureMarkersPresent(
        bundleSources[sourceKey] ?? "",
        markers,
        `Linux Browser session routing contract in ${sourceKey}`,
      );
    }
    for (const [sourceKey, markers] of Object.entries(this.forbiddenMarkers)) {
      ensureMarkersAbsent(
        bundleSources[sourceKey] ?? "",
        markers,
        `Linux Browser session routing contract in ${sourceKey}`,
      );
    }

    const assignmentCount = [
      ...bundleSources.webviewBrowserSidebarRuntime.matchAll(routePartitionAssignmentRegex),
    ].length;
    if (assignmentCount !== 4) {
      throw new Error(
        `Linux Browser session routing contract expected 4 route partition assignments, found ${assignmentCount}`,
      );
    }
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
