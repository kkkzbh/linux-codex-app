import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

export const settingsSidebarSurfaceFeature = {
  id: "settings-sidebar-surface",
  version: 1,
  requiredMarkers: FEATURE_MARKERS["settings-sidebar-surface"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["settings-sidebar-surface"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    const webviewSettingsPage = replaceOrThrow(
      bundleSources.webviewSettingsPage,
      "q=h(`app-shell-left-panel relative flex min-h-0 shrink-0 flex-col overflow-hidden`,`w-token-sidebar`),J=(0,$.jsx)(`div`,{className:`draggable h-toolbar w-full shrink-0`})",
      "q=h(`app-shell-left-panel window-fx-sidebar-surface pointer-events-auto relative flex min-h-0 shrink-0 flex-col overflow-visible`,`w-token-sidebar`),J=(0,$.jsx)(`div`,{className:`draggable h-toolbar w-full shrink-0`})",
      "current upstream settings sidebar standalone surface class",
    );

    return {
      ...bundleSources,
      webviewSettingsPage,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewSettingsPage,
      this.requiredMarkers.webviewSettingsPage,
      "Linux settings sidebar surface patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewSettingsPage,
      this.forbiddenMarkers.webviewSettingsPage,
      "Linux settings sidebar surface patch",
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
