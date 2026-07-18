import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const requiredMarkers = [
  "let e=await ie(`/`);if(e==null)return;be(e)",
  "codex-linux-second-instance-new-window-failed",
];

const forbiddenMarkers = [
  "let e=L.getPrimaryWindow()??await ie(`/`);if(e==null)return;be(e)",
];

const upstreamSecondInstanceWindowHandler =
  "xe=async()=>{if(R)try{L.hotkeyWindowLifecycleManager.hide();let e=L.getPrimaryWindow()??await ie(`/`);if(e==null)return;be(e)}catch(e){b.reportNonFatal(e instanceof Error?e:`Failed to open window on second instance`,{kind:`second-instance-open-window-failed`})}}";

const patchedSecondInstanceWindowHandler =
  "xe=async()=>{if(R)try{L.hotkeyWindowLifecycleManager.hide();let e=await ie(`/`);if(e==null)return;be(e)}catch(e){b.reportNonFatal(e instanceof Error?e:`Failed to open new window on second instance`,{kind:`codex-linux-second-instance-new-window-failed`})}}";

export const multiWindowSecondInstanceFeature = {
  id: "multi-window-second-instance",
  version: 2,
  requiredMarkers,
  forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    return {
      ...bundleSources,
      main: replaceOrThrow(
        bundleSources.main,
        upstreamSecondInstanceWindowHandler,
        patchedSecondInstanceWindowHandler,
        "current upstream second-instance window handler",
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.main,
      this.requiredMarkers,
      "Linux second-instance multi-window patch",
    );
    ensureMarkersAbsent(
      bundleSources.main,
      this.forbiddenMarkers,
      "Linux second-instance multi-window patch",
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
