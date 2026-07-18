import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamComputerUseProviderSelector =
  "function Oi(e,t,n){let r=e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t),i=y(Pt());return(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>re(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>Wt(n,e.marketplacePath))??null}";

const linuxComputerUseProviderSelector =
  "function Oi(e,t,n){let r=e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t||t===`computer-use`&&(e.plugin.name===`kde-computer-use`||e.plugin.id.split(`@`)[0]===`kde-computer-use`)),i=y(Pt());return t===`computer-use`?r.find(e=>(e.plugin.name===`kde-computer-use`||e.plugin.id.split(`@`)[0]===`kde-computer-use`)&&e.marketplaceName===`local`)??(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>re(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>Wt(n,e.marketplacePath))??null:(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>re(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>Wt(n,e.marketplacePath))??null}";

const upstreamComputerUseAvailablePluginsSelector =
  "t[5]!==v||t[6]!==_.availablePlugins?(x=K(_.availablePlugins,fn,v),t[5]=v,t[6]=_.availablePlugins,t[7]=x):x=t[7]";
const linuxComputerUseInstalledPluginsSelector =
  "t[5]!==v||t[6]!==_?(x=K([..._.availablePlugins,..._.installedPlugins],fn,v),t[5]=v,t[6]=_,t[7]=x):x=t[7]";

export const computerUseProviderFeature = {
  id: "computer-use-provider",
  version: 4,
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
