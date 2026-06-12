import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const requiredMarkers = [
  "let e=await j.createFreshWindow(`/`);if(e==null)return;de(e)",
  "codex-linux-second-instance-new-window-failed",
];

const forbiddenMarkers = [
  "let e=j.getPrimaryWindow()??await j.createFreshWindow(`/`);if(e==null)return;de(e)",
];

const upstreamSecondInstanceWindowHandler =
  "fe=async()=>{try{j.hotkeyWindowLifecycleManager.hide();let e=j.getPrimaryWindow()??await j.createFreshWindow(`/`);if(e==null)return;de(e)}catch(e){g.reportNonFatal(e instanceof Error?e:`Failed to open window on second instance`,{kind:`second-instance-open-window-failed`})}}";

const patchedSecondInstanceWindowHandler =
  "fe=async()=>{try{j.hotkeyWindowLifecycleManager.hide();let e=await j.createFreshWindow(`/`);if(e==null)return;de(e)}catch(e){g.reportNonFatal(e instanceof Error?e:`Failed to open new window on second instance`,{kind:`codex-linux-second-instance-new-window-failed`})}}";

export const multiWindowSecondInstanceFeature = {
  id: "multi-window-second-instance",
  version: 1,
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
