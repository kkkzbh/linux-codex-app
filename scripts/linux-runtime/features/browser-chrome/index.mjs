import { browserAutomationRuntimeNameFeature } from "./browser-automation-runtime-name.mjs";
import { browserBackendRegistryFeature } from "./browser-backend-registry.mjs";
import { browserSecurityFeature } from "./browser-security.mjs";
import { browserUseFeature } from "./browser-use.mjs";
import { chromeExtensionStatusFeature } from "./chrome-extension-status.mjs";
import { chromeSetupUrlFeature } from "./chrome-setup-url.mjs";

export const browserChromeSubpatches = [
  browserUseFeature,
  browserAutomationRuntimeNameFeature,
  browserBackendRegistryFeature,
  browserSecurityFeature,
  chromeExtensionStatusFeature,
  chromeSetupUrlFeature,
];

export const browserChromeFeature = {
  id: "browser-chrome",
  version: 1,
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
