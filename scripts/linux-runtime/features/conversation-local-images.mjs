import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamImageViewCase =
  "case`imageView`:{let e=Uy(n.path),r=e==null?null:Ey(e,`Image`);if(r==null)break;let i=t===f?l:null;if(p!=null){p.content=`${p.content}\\n${r}`,p.sentAtMs=i;break}p={type:`assistant-message`,content:r,sentAtMs:i,completed:!0,phase:null,renderPlaceholderWhileStreaming:!1,structuredOutput:void 0},a.push(p);break}";

const patchedImageViewCase =
  "case`imageView`:{let e=typeof n.path==`string`?Uy(n.path):null,r=e??(typeof n.path==`string`?n.path.trim():``);if(r.length===0)break;let i=e==null?r:`app://fs/@fs${encodeURI(e).replaceAll(`#`,`%23`).replaceAll(`?`,`%3F`)}?codexImageViewId=${encodeURIComponent(String(n.id??``))}`;a.push({type:`generated-image`,id:n.id,src:i,status:`completed`});break}";

const upstreamImageGenerationCase =
  "case`imageGeneration`:a.push({type:`generated-image`,id:n.id,src:n.src,status:n.status});break;";

const patchedImageGenerationCase =
  "case`imageGeneration`:{let e=typeof n.src==`string`?n.src.trim():``;if(e.length===0)break;a.push({type:`generated-image`,id:n.id,src:e,status:n.status});break}";

const upstreamRenderableImageViewCase = "case`imageView`:return Uy(e.path)!=null;";

const patchedRenderableImageViewCase = "case`imageView`:return typeof e.path==`string`&&Uy(e.path)!=null;";

const upstreamLocalImageHelper =
  "function C(e){if(e==null)return null;let n=e.trim();if(n.length===0)return null;let r=n.toLowerCase();if(r.startsWith(`data:`)||r.startsWith(`http:`)||r.startsWith(`https:`)||r.startsWith(`file:`)||r.startsWith(`vscode-resource:`)||r.startsWith(`vscode-webview:`)||r.startsWith(`vscode-file:`))return null;let i=t(n);return o(i)?i:null}";

const patchedLocalImageHelper =
  "function C(e){if(typeof e!==`string`)return null;let n=e.trim();if(n.length===0)return null;let r=n.toLowerCase();if(r.startsWith(`data:`)||r.startsWith(`http:`)||r.startsWith(`https:`)||r.startsWith(`file:`)||r.startsWith(`vscode-resource:`)||r.startsWith(`vscode-webview:`)||r.startsWith(`vscode-file:`))return null;let i=t(n);return o(i)?i:null}";

export const conversationLocalImagesFeature = {
  id: "conversation-local-images",
  version: 9,
  requiredMarkers: FEATURE_MARKERS["conversation-local-images"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["conversation-local-images"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let followUpSource = bundleSources.webviewFollowUp;
    let usePluginsSource = bundleSources.webviewUsePlugins;
    ensureMarkersPresent(
      followUpSource,
      [upstreamImageGenerationCase, upstreamImageViewCase, upstreamRenderableImageViewCase],
      "current upstream conversation local image follow-up anchors",
    );
    ensureMarkersPresent(
      usePluginsSource,
      [upstreamLocalImageHelper],
      "current upstream local image helper anchor",
    );

    followUpSource = replaceOrThrow(
      followUpSource,
      upstreamImageGenerationCase,
      patchedImageGenerationCase,
      "current upstream imageGeneration src guard",
    );
    followUpSource = replaceOrThrow(
      followUpSource,
      upstreamImageViewCase,
      patchedImageViewCase,
      "current upstream imageView generated image promotion",
    );
    followUpSource = replaceOrThrow(
      followUpSource,
      upstreamRenderableImageViewCase,
      patchedRenderableImageViewCase,
      "current upstream imageView renderability guard",
    );
    usePluginsSource = replaceOrThrow(
      usePluginsSource,
      upstreamLocalImageHelper,
      patchedLocalImageHelper,
      "current upstream local image helper type guard",
    );

    return {
      ...bundleSources,
      webviewFollowUp: followUpSource,
      webviewUsePlugins: usePluginsSource,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewFollowUp,
      this.requiredMarkers.webviewFollowUp,
      "conversation local images follow-up patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewUsePlugins,
      this.requiredMarkers.webviewUsePlugins,
      "conversation local images helper patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewFollowUp,
      this.forbiddenMarkers.webviewFollowUp,
      "conversation local images follow-up patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewUsePlugins,
      this.forbiddenMarkers.webviewUsePlugins,
      "conversation local images helper patch",
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
