import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const generatedImageHelpers =
  "function codexLinuxIsGeneratedImageTempArtifactPath(e){return typeof e==`string`&&/^\\/mnt\\/data\\/(?:\\d+|_?image_id_?)\\.(?:avif|gif|jpeg|jpg|png|webp)$/i.test(e)}function codexLinuxResolveGeneratedImageArtifactPath(e,t){if(!codexLinuxIsGeneratedImageTempArtifactPath(e)||t.length===0)return e;let n=e.match(/^\\/mnt\\/data\\/(\\d+)\\.(?:avif|gif|jpeg|jpg|png|webp)$/i),r=n==null?0:Number(n[1]);return Number.isSafeInteger(r)&&r>=0&&r<t.length?t[r]:t[0]??e}";

export const generatedOutputArtifactsFeature = {
  id: "generated-output-artifacts",
  version: 7,
  requiredMarkers: FEATURE_MARKERS["generated-output-artifacts"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["generated-output-artifacts"].forbiddenMarkers,
  apply(bundleSources, context) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let source = bundleSources.webviewGeneratedOutputArtifacts;
    source = replaceOrThrow(
      source,
      "a.push([...c,...Ym(s,r,n)])",
      "a.push([...c,...Ym(s,{includeGeneratedImages:n,projectlessOutputDirectory:r})])",
      "current upstream generated output artifact call",
    );
    source = replaceOrThrow(
      source,
      "function Ym(e,t,n){let r=It(e.status),i=Er(e),a=e.params.cwd==null?null:_e(e.params.cwd);return Zm({assistantContent:r===`complete`?Xm(e):null,cwd:a,includeGeneratedImages:n,projectlessOutputDirectory:t,status:r,turn:e,turnArtifacts:i})}",
      "function Ym(e,{includeGeneratedImages:t=!1,projectlessOutputDirectory:n=null}={}){let r=It(e.status),i=Er(e),a=e.params.cwd==null?null:_e(e.params.cwd);return Zm({assistantContent:r===`complete`?Xm(e):null,cwd:a,includeGeneratedImages:t,projectlessOutputDirectory:n,status:r,turn:e,turnArtifacts:i})}",
      "current upstream generated output artifact extraction",
    );
    source = replaceOrThrow(
      source,
      "function Zm({assistantContent:e,cwd:t,includeGeneratedImages:n,projectlessOutputDirectory:r,status:i,turn:a,turnArtifacts:o}){let s=[],c=new Map,l=e=>",
      `${generatedImageHelpers}function Zm({assistantContent:e,cwd:t,includeGeneratedImages:n,projectlessOutputDirectory:r,status:i,turn:a,turnArtifacts:o}){let s=[],c=new Map,codexLinuxGeneratedImageSources=[],l=e=>`,
      "current upstream generated image resolver insertion",
    );
    source = replaceOrThrow(
      source,
      "let u=n?a.items.slice().reverse():a.items;",
      "for(let e of a.items)e?.type===`imageGeneration`&&e.src!=null&&ui(e.src)&&codexLinuxGeneratedImageSources.push(e.src);let u=n?a.items.slice().reverse():a.items;",
      "current upstream generated image source collection",
    );
    source = replaceOrThrow(
      source,
      "case`file`:l({type:`file`,path:t==null?e.path:pt(t,e.path)});break",
      "case`file`:{let n=codexLinuxResolveGeneratedImageArtifactPath(e.path,codexLinuxGeneratedImageSources);l({type:`file`,path:t==null?n:pt(t,n)});break}",
      "current upstream generated output file normalization",
    );

    let sources = {
      ...bundleSources,
      webviewGeneratedOutputArtifacts: source,
    };
    if (typeof context?.syncSharedBundleSource === "function") {
      sources = context.syncSharedBundleSource(
        sources,
        "webviewGeneratedOutputArtifacts",
        source,
      );
    }
    return sources;
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewGeneratedOutputArtifacts,
      this.requiredMarkers.webviewGeneratedOutputArtifacts,
      "generated output artifact webview patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewGeneratedOutputArtifacts,
      this.forbiddenMarkers.webviewGeneratedOutputArtifacts,
      "generated output artifact webview patch",
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
