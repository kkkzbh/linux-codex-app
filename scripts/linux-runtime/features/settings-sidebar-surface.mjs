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
      "J=a(`window-fx-sidebar-surface flex shrink-0 flex-col`,`w-token-sidebar`),Y=(0,$.jsx)(`div`,{className:`draggable h-toolbar w-full`})",
      "J=a(`app-shell-left-panel window-fx-sidebar-surface pointer-events-auto relative flex shrink-0 flex-col overflow-visible`,`w-token-sidebar`),Y=(0,$.jsx)(`div`,{className:`draggable h-toolbar w-full`})",
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
