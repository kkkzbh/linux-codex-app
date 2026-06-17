import { readFileSync } from "node:fs";

import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamComputerUseProviderSelector =
  "function Wn(e,t,n){let r=e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t),i=O(Ce());return(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>g(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>Ke(n,e.marketplacePath))??null}";

const linuxComputerUseProviderSelector =
  "function Wn(e,t,n){let r=e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t||e.plugin.name===`kde-computer-use`||e.plugin.id.split(`@`)[0]===`kde-computer-use`),i=O(Ce());return r.find(e=>(e.plugin.name===`kde-computer-use`||e.plugin.id.split(`@`)[0]===`kde-computer-use`)&&e.marketplaceName===`local`)??(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>g(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>Ke(n,e.marketplacePath))??null}";

const upstreamComputerUseAvailablePluginsSelector =
  "t[3]!==d||t[4]!==u.availablePlugins?(f=C(u.availablePlugins,Te,d),t[3]=d,t[4]=u.availablePlugins,t[5]=f):f=t[5]";
const linuxComputerUseInstalledPluginsSelector =
  "t[3]!==d||t[4]!==u?(f=C([...u.availablePlugins,...u.installedPlugins],Te,d),t[3]=d,t[4]=u,t[5]=f):f=t[5]";

const upstreamComputerUseSettingsFunction = "function Me(e){let t=(0,X.c)(48),";
const computerUseLogoDataUrl = `data:image/png;base64,${readFileSync(
  new URL("../../../plugins/computer-use/assets/computer-use.png", import.meta.url),
).toString("base64")}`;
const linuxComputerUseSettingsFunction =
  `function codexLinuxComputerUseProvider(){return{description:\`Observe and control the foreground KDE Wayland desktop\`,displayName:\`Computer Use\`,logoPath:${JSON.stringify(computerUseLogoDataUrl)},marketplaceDisplayName:\`local-plugins\`,marketplaceName:\`local\`,plugin:{enabled:!0,id:\`kde-computer-use@local-plugins\`,installed:!0,interface:{composerIcon:${JSON.stringify(computerUseLogoDataUrl)},defaultPrompt:[\`Look at my KDE desktop\`],displayName:\`Computer Use\`,logo:${JSON.stringify(computerUseLogoDataUrl)}},name:\`kde-computer-use\`}}}function Me(e){let t=(0,X.c)(48),`;

const upstreamComputerUseProviderAssignment = "let p=f,m;";
const linuxComputerUseProviderAssignment = "let p=f??codexLinuxComputerUseProvider(),m;";

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
