import { avatarOverlayTransparencyFeature } from "./avatar-overlay-transparency.mjs";
import { browserBackendRegistryFeature } from "./browser-backend-registry.mjs";
import { browserSecurityFeature } from "./browser-security.mjs";
import { browserUseFeature } from "./browser-use.mjs";
import { chromeExtensionStatusFeature } from "./chrome-extension-status.mjs";
import { chromeSetupUrlFeature } from "./chrome-setup-url.mjs";
import { conversationLocalImagesFeature } from "./conversation-local-images.mjs";
import { directiveStripFeature } from "./directive-strip.mjs";
import { localImageCacheRefreshFeature } from "./local-image-cache-refresh.mjs";
import { markdownLocalMediaFeature } from "./markdown-local-media.mjs";
import { conversationModelSelectorFeature } from "./conversation-model-selector.mjs";
import { nativeTitlebarFeature } from "./native-titlebar.mjs";
import { openTargetsFeature } from "./open-targets.mjs";
import { pluginMcpReloadFeature } from "./plugin-mcp-reload.mjs";
import { preferencesFeature } from "./preferences.mjs";
import { remoteControlBackendFeature } from "./remote-control-backend.mjs";
import { remoteControlDeviceKeyFeature } from "./remote-control-device-key.mjs";
import { remoteControlVisibilityFeature } from "./remote-control-visibility.mjs";
import { settingsSidebarSurfaceFeature } from "./settings-sidebar-surface.mjs";
import { workingSessionsStatusFeature } from "./working-sessions-status.mjs";
import {
  assertLinuxPatchContracts,
  describeLinuxPatchFeature,
} from "../patch-contracts.mjs";

export const linuxPatchFeatures = [
  openTargetsFeature,
  directiveStripFeature,
  markdownLocalMediaFeature,
  localImageCacheRefreshFeature,
  conversationLocalImagesFeature,
  conversationModelSelectorFeature,
  preferencesFeature,
  remoteControlDeviceKeyFeature,
  remoteControlVisibilityFeature,
  nativeTitlebarFeature,
  settingsSidebarSurfaceFeature,
  avatarOverlayTransparencyFeature,
  workingSessionsStatusFeature,
  browserUseFeature,
  remoteControlBackendFeature,
  browserBackendRegistryFeature,
  browserSecurityFeature,
  chromeExtensionStatusFeature,
  chromeSetupUrlFeature,
  pluginMcpReloadFeature,
];

assertLinuxPatchContracts(linuxPatchFeatures);

export const linuxPatchFeatureContracts = linuxPatchFeatures.map(describeLinuxPatchFeature);

export function verifyLinuxPatchSource(bundleSources, context) {
  for (const feature of linuxPatchFeatures) {
    feature.verify(bundleSources, context);
  }
}
