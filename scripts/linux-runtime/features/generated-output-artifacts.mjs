import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamArtifactExtraction =
  "function nm(e,{projectlessOutputDirectory:t=null}={}){let n=[];for(let r=e.length-1;r>=0;--r)n.push(im(e[r],t));return rm(n)}function rm(e){let t=[],n=new Set;for(let r of e)for(let e of r){let r=sm(e);n.has(r)||(n.add(r),t.push(e))}return t}function im(e,t){let n=_t(e.status),r=rn(e),i=e.params.cwd==null?null:fe(e.params.cwd);return om({assistantContent:n===`complete`?am(e):null,cwd:i,projectlessOutputDirectory:t,status:n,turn:e,turnArtifacts:r})}function am(e){for(let t=e.items.length-1;t>=0;--t){let n=e.items[t];if(n?.type===`agentMessage`)return n.text}return null}function om({assistantContent:e,cwd:t,projectlessOutputDirectory:n,status:r,turn:i,turnArtifacts:a}){let o=[],s=new Map,c=e=>{let t=sm(e),n=s.get(t);if(n==null){s.set(t,o.length),o.push(e);return}e.type===`website`&&o[n]?.type===`file`&&(o[n]=e)};for(let e of a.referencedFilePaths)qe(e)&&Ee({cwd:t,projectlessOutputDirectory:n,resourcePath:e})&&c({type:`file`,path:t==null?e:Ie(t,e)});for(let e of i.items)e?.type===`imageGeneration`&&e.src!=null&&qe(e.src)&&Ee({cwd:t,projectlessOutputDirectory:n,resourcePath:e.src})&&c({type:`file`,path:t==null?e.src:Ie(t,e.src)});if(r!==`complete`)return o;let l=st({assistantContent:e,isAppgenEndCardEnabled:!0,projectlessOutputDirectory:n,turn:{artifacts:a,collaborationMode:i.params.collaborationMode??null,cwd:t,items:Le(i,[]).items,status:r}});for(let e of l)switch(e.type){case`file`:c({type:`file`,path:t==null?e.path:Ie(t,e.path)});break;case`google-drive`:case`appgen-app`:c(e);break;case`website`:c({type:`website`,target:A(e.target)||t==null?e.target:Ie(t,e.target)});break}return o}";

const patchedArtifactExtraction =
  "function nm(e,{conversationId:t=null,projectlessOutputDirectory:n=null}={}){let r=[];for(let i=e.length-1;i>=0;--i)r.push(im(e[i],{conversationId:t,projectlessOutputDirectory:n}));return rm(r)}function rm(e){let t=[],n=new Set;for(let r of e)for(let e of r){let r=sm(e);n.has(r)||(n.add(r),t.push(e))}return t}function im(e,{conversationId:t=null,projectlessOutputDirectory:n=null}={}){let r=_t(e.status),i=rn(e),a=e.params.cwd==null?null:fe(e.params.cwd);return om({assistantContent:r===`complete`?am(e):null,conversationId:t,cwd:a,projectlessOutputDirectory:n,status:r,turn:e,turnArtifacts:i})}function am(e){for(let t=e.items.length-1;t>=0;--t){let n=e.items[t];if(n?.type===`agentMessage`)return n.text}return null}function codexLinuxIsGeneratedImageTempArtifactPath(e){return typeof e==`string`&&/^\\/mnt\\/data\\/(?:\\d+|_?image_id_?)\\.(?:avif|gif|jpeg|jpg|png|webp)$/i.test(e)}function codexLinuxResolveGeneratedImageArtifactPath(e,t,n){if(!codexLinuxIsGeneratedImageTempArtifactPath(e)||t.length===0)return e;let r=e.match(/^\\/mnt\\/data\\/(\\d+)\\.(?:avif|gif|jpeg|jpg|png|webp)$/i),i=r==null?0:Number(r[1]);return Number.isSafeInteger(i)&&i>=0&&i<t.length?t[i]:t[0]??e}function om({assistantContent:e,conversationId:t,cwd:n,projectlessOutputDirectory:r,status:i,turn:a,turnArtifacts:o}){let s=[],c=new Map,l=[],u=e=>{let t=sm(e),n=c.get(t);if(n==null){c.set(t,s.length),s.push(e);return}e.type===`website`&&s[n]?.type===`file`&&(s[n]=e)},d=e=>n==null?e:Ie(n,e);for(let e of o.referencedFilePaths)qe(e)&&Ee({cwd:n,projectlessOutputDirectory:r,resourcePath:e})&&u({type:`file`,path:d(e)});for(let e of a.items)e?.type===`imageGeneration`&&e.src!=null&&qe(e.src)&&Ee({cwd:n,projectlessOutputDirectory:r,resourcePath:e.src})&&(l.push(d(e.src)),u({type:`file`,path:d(e.src)}));if(i!==`complete`)return s;let f=st({assistantContent:e,isAppgenEndCardEnabled:!0,projectlessOutputDirectory:r,turn:{artifacts:o,collaborationMode:a.params.collaborationMode??null,cwd:n,items:Le(a,[]).items,status:i}});for(let e of f)switch(e.type){case`file`:{let t=codexLinuxResolveGeneratedImageArtifactPath(e.path,l);u({type:`file`,path:d(t)});break}case`google-drive`:case`appgen-app`:u(e);break;case`website`:u({type:`website`,target:A(e.target)||n==null?e.target:Ie(n,e.target)});break}return s}";

const upstreamHistoricalArtifactsSelector =
  "var cm=l(p,(e,{get:t})=>{t(Ct,e),t(Tt,e);let n=t(tn,e);return n==null?[]:nm(n.slice(0,-1),{projectlessOutputDirectory:t(ge,e)})}),lm=l(p,(e,{get:t})=>{let n=t(Be,e);return rm([n==null?[]:nm([n],{projectlessOutputDirectory:t(ge,e)}),t(cm,e)])})";

const patchedHistoricalArtifactsSelector =
  "var cm=l(p,(e,{get:t})=>{t(Ct,e),t(Tt,e);let n=t(tn,e);return n==null?[]:nm(n.slice(0,-1),{conversationId:e,projectlessOutputDirectory:t(ge,e)})}),lm=l(p,(e,{get:t})=>{let n=t(Be,e);return rm([n==null?[]:nm([n],{conversationId:e,projectlessOutputDirectory:t(ge,e)}),t(cm,e)])})";

export const generatedOutputArtifactsFeature = {
  id: "generated-output-artifacts",
  version: 1,
  requiredMarkers: FEATURE_MARKERS["generated-output-artifacts"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["generated-output-artifacts"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let source = bundleSources.webviewLocalConversationThread;
    ensureMarkersPresent(
      source,
      [upstreamArtifactExtraction, upstreamHistoricalArtifactsSelector],
      "current upstream generated output artifact anchors",
    );

    source = replaceOrThrow(
      source,
      upstreamArtifactExtraction,
      patchedArtifactExtraction,
      "current upstream generated output artifact extraction",
    );
    source = replaceOrThrow(
      source,
      upstreamHistoricalArtifactsSelector,
      patchedHistoricalArtifactsSelector,
      "current upstream generated output artifact selectors",
    );

    return {
      ...bundleSources,
      webviewLocalConversationThread: source,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewLocalConversationThread,
      this.requiredMarkers.webviewLocalConversationThread,
      "generated output artifact webview patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewLocalConversationThread,
      this.forbiddenMarkers.webviewLocalConversationThread,
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
