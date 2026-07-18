import { browserAutomationRuntimeNameFeature } from "./browser-automation-runtime-name.mjs";
import { browserBackendRegistryFeature } from "./browser-backend-registry.mjs";
import { browserProfileImportFeature } from "./browser-profile-import.mjs";
import { browserSecurityFeature } from "./browser-security.mjs";
import { browserSessionRoutingFeature } from "./browser-session-routing.mjs";
import { browserStorageIdentityFeature } from "./browser-storage-identity.mjs";
import { browserUseFeature } from "./browser-use.mjs";
import { chromeNativeHostStagingFeature } from "./chrome-native-host-staging.mjs";
import { chromeSetupUrlFeature } from "./chrome-setup-url.mjs";

export const browserChromeSubpatches = [
  browserUseFeature,
  browserAutomationRuntimeNameFeature,
  browserBackendRegistryFeature,
  browserStorageIdentityFeature,
  browserSessionRoutingFeature,
  browserProfileImportFeature,
  browserSecurityFeature,
  chromeSetupUrlFeature,
  chromeNativeHostStagingFeature,
];

export const browserChromeFeature = {
  id: "browser-chrome",
  version: 12,
  subpatches: browserChromeSubpatches,
  apply(bundleSources, context) {
    return this.subpatches.reduce(
      (sources, subpatch) => subpatch.apply(sources, context),
      bundleSources,
    );
  },
  verify(bundleSources, context) {
    for (const subpatch of this.subpatches) {
      subpatch.verify(bundleSources, context);
    }
  },
  isApplied(bundleSources, context) {
    try {
      this.verify(bundleSources, context);
      return true;
    } catch {
      return false;
    }
  },
};
