import { readFileSync } from "node:fs";

import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamComputerUseProviderSelector =
  "function St(e,t,n){let r=e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t),i=l(le());return(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>s(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>Ee(n,e.marketplacePath))??null}";

const linuxComputerUseProviderSelector =
  "function St(e,t,n){let r=e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t||e.plugin.name===`kde-computer-use`||e.plugin.id.split(`@`)[0]===`kde-computer-use`),i=l(le());return r.find(e=>(e.plugin.name===`kde-computer-use`||e.plugin.id.split(`@`)[0]===`kde-computer-use`)&&e.marketplaceName===`local`)??(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>s(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>Ee(n,e.marketplacePath))??null}";

const upstreamComputerUseAvailablePluginsSelector = "p=X(d.availablePlugins,we,f)";
const linuxComputerUseInstalledPluginsSelector =
  "p=X([...d.availablePlugins,...d.installedPlugins],we,f)";

const upstreamComputerUseSettingsFunction = "function je(e){let t=(0,Z.c)(48),";
const computerUseLogoDataUrl = `data:image/png;base64,${readFileSync(
  new URL("../../../plugins/computer-use/assets/computer-use.png", import.meta.url),
).toString("base64")}`;
const linuxComputerUseSettingsFunction =
  `function codexLinuxComputerUseProvider(){return{description:\`Observe and control the foreground KDE Wayland desktop\`,displayName:\`Computer Use\`,logoPath:${JSON.stringify(computerUseLogoDataUrl)},marketplaceDisplayName:\`local-plugins\`,marketplaceName:\`local\`,plugin:{enabled:!0,id:\`kde-computer-use@local-plugins\`,installed:!0,interface:{composerIcon:${JSON.stringify(computerUseLogoDataUrl)},defaultPrompt:[\`Look at my KDE desktop\`],displayName:\`Computer Use\`,logo:${JSON.stringify(computerUseLogoDataUrl)}},name:\`kde-computer-use\`}}}function je(e){let t=(0,Z.c)(48),`;

const upstreamComputerUseProviderAssignment = "let m=p,h;";
const linuxComputerUseProviderAssignment = "let m=p??codexLinuxComputerUseProvider(),h;";

export const computerUseProviderFeature = {
  id: "computer-use-provider",
  version: 1,
  requiredMarkers: FEATURE_MARKERS["computer-use-provider"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["computer-use-provider"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    const sources = {
      ...bundleSources,
      webviewComputerUseProviderSettings: replaceOrThrow(
        bundleSources.webviewComputerUseProviderSettings,
        upstreamComputerUseProviderSelector,
        linuxComputerUseProviderSelector,
        "Linux Computer Use provider selector",
        {
          appliedMarkers: [
            "kde-computer-use",
            "plugin.name===`kde-computer-use`",
          ],
        },
      ),
      webviewComputerUseSettings: replaceOrThrow(
        bundleSources.webviewComputerUseSettings,
        upstreamComputerUseAvailablePluginsSelector,
        linuxComputerUseInstalledPluginsSelector,
        "Linux Computer Use installed provider selector",
      ),
    };

    sources.webviewComputerUseSettings = replaceOrThrow(
      sources.webviewComputerUseSettings,
      upstreamComputerUseSettingsFunction,
      linuxComputerUseSettingsFunction,
      "Linux Computer Use synthetic provider factory",
    );

    sources.webviewComputerUseSettings = replaceOrThrow(
      sources.webviewComputerUseSettings,
      upstreamComputerUseProviderAssignment,
      linuxComputerUseProviderAssignment,
      "Linux Computer Use synthetic provider fallback",
    );

    return sources;
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewComputerUseProviderSettings,
      this.requiredMarkers.webviewComputerUseProviderSettings,
      "Linux Computer Use provider patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewComputerUseProviderSettings,
      this.forbiddenMarkers.webviewComputerUseProviderSettings,
      "Linux Computer Use provider patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewComputerUseSettings,
      this.requiredMarkers.webviewComputerUseSettings,
      "Linux Computer Use settings provider patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewComputerUseSettings,
      this.forbiddenMarkers.webviewComputerUseSettings,
      "Linux Computer Use settings provider patch",
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
