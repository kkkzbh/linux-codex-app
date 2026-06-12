import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamMarkdownLocalMediaHelperAnchor =
  "function Sn(e){return!yn.test(e)&&!l(e)?`image`:Cn(e)?.startsWith(`video/`)??!1?`video`:`image`}function Cn(e){let t=e.match(/^data:([^;,]+)/i);if(t!=null)return t[1]??null;let n=(0,vn.lookup)(e);return typeof n==`string`?n:null}function wn(e){let t;try{t=new URL(e)}catch{return null}return t.protocol!==`https:`||t.hostname!==bn||!t.pathname.startsWith(xn)?null:t.pathname.match(/^\\/badge\\/(P[0-9]+)(?:-|$)/)?.[1]??null}function Tn(e){return e===`P0`?`bg-token-charts-red text-white`:e===`P1`?`bg-token-charts-orange text-white`:`bg-token-foreground/5 text-token-foreground`}function En({contentsBase64:e,mimeType:t,path:n}){return`data:${t??Cn(n)??`application/octet-stream`};base64,${e}`}";

const patchedMarkdownLocalMediaHelperAnchor =
  "function codexLinuxSafeDecodeMediaPath(e){try{return decodeURIComponent(e)}catch{return e}}function codexLinuxNormalizeMediaPath(e){if(typeof e!=\"string\")return null;let t=e.trim();if(t.length===0)return null;if(/^file:\\/\\//i.test(t))try{let e=new URL(t);if(e.protocol!==`file:`)return null;let n=e.pathname||``;return e.host.length>0&&e.host!==`localhost`?n.length>0?`//${e.host}${codexLinuxSafeDecodeMediaPath(n)}`:null:n.length>0?codexLinuxSafeDecodeMediaPath(n):null}catch{return null}return t.startsWith(`/`)?/%[0-9A-Fa-f]{2}/.test(t)?codexLinuxSafeDecodeMediaPath(t):t:null}function codexLinuxResolveMarkdownMediaPath(e,t){let n=codexLinuxNormalizeMediaPath(e);if(n!=null)return n;if(typeof e!=\"string\"||typeof t!=\"string\")return null;let r=e.trim(),i=(codexLinuxNormalizeMediaPath(t)??t).trim();if(r.length===0||i.length===0||r.startsWith(`#`)||r.startsWith(`?`)||r.startsWith(`//`)||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(r)||!i.startsWith(`/`))return null;let a=i.endsWith(`/`)?i:`${i}/`;try{let e=new URL(encodeURI(r),`file://${encodeURI(a)}`);return e.protocol!==`file:`?null:codexLinuxSafeDecodeMediaPath(e.pathname||``)}catch{return null}}function codexLinuxMarkdownImageMimeType(e){if(typeof e!=\"string\")return null;let t=e.trim();if(t.length===0)return null;let n=t.match(/^data:([^;,]+)/i);if(n!=null)return n[1]?.startsWith(`image/`)?n[1]:null;try{let e=new URL(t);if(e.protocol===`file:`)t=e.pathname||``}catch{}let r=(0,vn.lookup)(t);return typeof r==`string`&&r.startsWith(`image/`)?r:null}function Sn(e){return`image`}function Cn(e){return codexLinuxMarkdownImageMimeType(e)}function wn(e){let t;try{t=new URL(e)}catch{return null}return t.protocol!==`https:`||t.hostname!==bn||!t.pathname.startsWith(xn)?null:t.pathname.match(/^\\/badge\\/(P[0-9]+)(?:-|$)/)?.[1]??null}function Tn(e){return e===`P0`?`bg-token-charts-red text-white`:e===`P1`?`bg-token-charts-orange text-white`:`bg-token-foreground/5 text-token-foreground`}function En({contentsBase64:e,mimeType:t,path:n}){return`data:${t??Cn(n)??`application/octet-stream`};base64,${e}`}";

const upstreamMarkdownMediaProps =
  "{allowWide:n,alt:r,animateEnter:i,className:a,hostId:o,mediaCacheKey:s,mediaPresentation:l,rootRef:u,src:f,title:p}=e";

const patchedMarkdownMediaProps =
  "{allowWide:n,alt:r,animateEnter:i,className:a,hostId:o,cwd:codexLinuxMarkdownCwd,mediaCacheKey:s,mediaPresentation:l,rootRef:u,src:f,title:p}=e";

const upstreamMarkdownMediaLocalState =
  "C=f??``,w=d(C),T=C.length>0,E=wn(C),D;t[0]===C?D=t[1]:(D=Sn(C),t[0]=C,t[1]=D);let O=D,k=O===`video`,A;t[2]===C?A=t[3]:(A=C.startsWith(`//`),t[2]=C,t[3]=A);let j=w!=null&&!A,N=jn(C,E==null&&T&&O===`image`&&!j&&On(C)),ee=E==null&&T&&!j&&Dn(C)&&N.safeUrl==null&&!N.isPending,F=j&&k?ue(w):null,I=!k&&j,{data:L,isLoading:R}=c(`read-file-binary`,{params:{path:I?w??C:``,hostId:o},queryConfig:{cacheKey:s==null?void 0:Array.isArray(s)?[`markdown-media`,...s]:[`markdown-media`,s],enabled:I,gcTime:1/0,staleTime:1/0}});";

const patchedMarkdownMediaLocalState =
  "C=f??``,w=codexLinuxResolveMarkdownMediaPath(C,codexLinuxMarkdownCwd),T=C.length>0,E=wn(C),D;t[0]===C?D=t[1]:(D=Sn(w??C),t[0]=C,t[1]=D);let O=D,k=!1,A=!1,j=w!=null,N=jn(C,E==null&&T&&O===`image`&&!j&&On(C)),ee=!1,F=null,I=j,{data:L,isLoading:R}=c(`read-file-binary`,{params:{path:I?w??C:``,hostId:o},queryConfig:{cacheKey:s==null?void 0:Array.isArray(s)?[`markdown-media`,...s]:[`markdown-media`,s],enabled:I,gcTime:1/0,staleTime:0,refetchOnMount:`always`}});";

const upstreamMarkdownMediaResolvedSourceState =
  "let te=L?.contentsBase64??null,z=N.safeUrl??F??(I&&te!=null?En({contentsBase64:te,mimeType:L?.mimeType??null,path:w??C}):C),B=r??``,V=j&&!k,ne=j&&k&&F==null,re=ee||I&&te==null&&!R||x===z,";

const patchedMarkdownMediaResolvedSourceState =
  "let te=L?.contentsBase64??null,z=N.safeUrl??F??(I&&te!=null?En({contentsBase64:te,mimeType:L?.mimeType??null,path:w??C}):C),B=r??``,V=j,ne=!1,re=ee||I&&te==null&&!R||x===z,";

const upstreamMarkdownMediaRenderer =
  "img(e){return(0,Z.jsx)(Bn,{...e,animateEnter:t,hostId:a,mediaCacheKey:o,mediaPresentation:s,rootRef:c})}";

const patchedMarkdownMediaRenderer =
  "img(e){return(0,Z.jsx)(Bn,{...e,animateEnter:t,cwd:n??null,hostId:a,mediaCacheKey:o,mediaPresentation:s,rootRef:c})}";

const upstreamMarkdownPreview =
  "function Le(e){let t=(0,X.c)(23),{path:n,className:r,fallback:i,hostId:a,scrollable:o}=e,s=o===void 0?!1:o,c=n!=null&&n.length>0&&n!==`/dev/null`,l=n??``,d;t[0]===a?d=t[1]:(d=a==null?{}:{hostId:a},t[0]=a,t[1]=d);let f;t[2]!==l||t[3]!==d?(f={path:l,...d},t[2]=l,t[3]=d,t[4]=f):f=t[4];let p;t[5]===c?p=t[6]:(p={enabled:c},t[5]=c,t[6]=p);let m;t[7]!==f||t[8]!==p?(m={params:f,queryConfig:p},t[7]=f,t[8]=p,t[9]=m):m=t[9];let{data:h,isLoading:g,isError:_}=u(`read-file`,m),v=h?.contents??null;if(!c)return i;if(g){let e=s?`overflow-auto`:`overflow-clip`,n;t[10]!==r||t[11]!==e?(n=T(`relative`,e,r),t[10]=r,t[11]=e,t[12]=n):n=t[12];let i;t[13]===Symbol.for(`react.memo_cache_sentinel`)?(i=(0,Z.jsx)(ve,{className:`justify-center py-6 text-sm`}),t[13]=i):i=t[13];let a;return t[14]===n?a=t[15]:(a=(0,Z.jsx)(`div`,{className:n,children:i}),t[14]=n,t[15]=a),a}if(v==null||v.length===0||_)return i;let y=s?`normal`:`subtle`,b=s?`auto`:`clip`,x;t[16]===v?x=t[17]:(x=(0,Z.jsx)(ye,{enableMetadataPreview:!0,markdown:v}),t[16]=v,t[17]=x);let S;return t[18]!==r||t[19]!==y||t[20]!==b||t[21]!==x?(S=(0,Z.jsx)(be,{background:y,className:r,overflow:b,children:x}),t[18]=r,t[19]=y,t[20]=b,t[21]=x,t[22]=S):S=t[22],S}";

const patchedMarkdownPreview =
  "function codexLinuxSafeDecodePreviewPath(e){try{return decodeURIComponent(e)}catch{return e}}function codexLinuxNormalizePreviewPath(e){if(typeof e!=\"string\")return null;let t=e.trim();if(t.length===0)return null;if(/^file:\\/\\//i.test(t))try{let e=new URL(t);if(e.protocol!==`file:`)return null;let n=e.pathname||``;return e.host.length>0&&e.host!==`localhost`?n.length>0?`//${e.host}${codexLinuxSafeDecodePreviewPath(n)}`:null:n.length>0?codexLinuxSafeDecodePreviewPath(n):null}catch{return null}return t.startsWith(`/`)?/%[0-9A-Fa-f]{2}/.test(t)?codexLinuxSafeDecodePreviewPath(t):t:null}function codexLinuxMarkdownPreviewDir(e){let t=codexLinuxNormalizePreviewPath(e);if(t==null)return null;let n=Math.max(t.lastIndexOf(`/`),t.lastIndexOf(`\\\\`));return n<0?null:n===0?t.slice(0,1):t.slice(0,n)}function Le(e){let t=(0,X.c)(25),{path:n,className:r,fallback:i,hostId:a,scrollable:o}=e,s=o===void 0?!1:o,c=n!=null&&n.length>0&&n!==`/dev/null`,l=n??``,d;t[0]===a?d=t[1]:(d=a==null?{}:{hostId:a},t[0]=a,t[1]=d);let f;t[2]!==l||t[3]!==d?(f={path:l,...d},t[2]=l,t[3]=d,t[4]=f):f=t[4];let p;t[5]===c?p=t[6]:(p={enabled:c},t[5]=c,t[6]=p);let m;t[7]!==f||t[8]!==p?(m={params:f,queryConfig:p},t[7]=f,t[8]=p,t[9]=m):m=t[9];let{data:h,isLoading:g,isError:_}=u(`read-file`,m),v=h?.contents??null;if(!c)return i;if(g){let e=s?`overflow-auto`:`overflow-clip`,n;t[10]!==r||t[11]!==e?(n=T(`relative`,e,r),t[10]=r,t[11]=e,t[12]=n):n=t[12];let i;t[13]===Symbol.for(`react.memo_cache_sentinel`)?(i=(0,Z.jsx)(ve,{className:`justify-center py-6 text-sm`}),t[13]=i):i=t[13];let a;return t[14]===n?a=t[15]:(a=(0,Z.jsx)(`div`,{className:n,children:i}),t[14]=n,t[15]=a),a}if(v==null||v.length===0||_)return i;let y=s?`normal`:`subtle`,b=s?`auto`:`clip`,x,S;t[16]!==v||t[17]!==l?(S=codexLinuxMarkdownPreviewDir(l),x=(0,Z.jsx)(ye,{enableMetadataPreview:!0,markdown:v,cwd:S}),t[16]=v,t[17]=l,t[18]=S,t[19]=x):(S=t[18],x=t[19]);let C;return t[20]!==r||t[21]!==y||t[22]!==b||t[23]!==x?(C=(0,Z.jsx)(be,{background:y,className:r,overflow:b,children:x}),t[20]=r,t[21]=y,t[22]=b,t[23]=x,t[24]=C):C=t[24],C}";

export const markdownLocalMediaFeature = {
  id: "markdown-local-media",
  version: 10,
  requiredMarkers: FEATURE_MARKERS["markdown-local-media"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["markdown-local-media"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let markdownSource = bundleSources.webviewMarkdown;
    let diffAnnotationsSource = bundleSources.webviewDiffAnnotations;

    ensureMarkersPresent(
      markdownSource,
      [
        upstreamMarkdownLocalMediaHelperAnchor,
        upstreamMarkdownMediaProps,
        upstreamMarkdownMediaLocalState,
        upstreamMarkdownMediaResolvedSourceState,
        upstreamMarkdownMediaRenderer,
      ],
      "current upstream markdown local media anchors",
    );
    ensureMarkersPresent(
      diffAnnotationsSource,
      [upstreamMarkdownPreview],
      "current upstream markdown preview anchors",
    );

    markdownSource = replaceOrThrow(
      markdownSource,
      upstreamMarkdownLocalMediaHelperAnchor,
      patchedMarkdownLocalMediaHelperAnchor,
      "current upstream markdown local media helpers",
    );
    markdownSource = replaceOrThrow(
      markdownSource,
      upstreamMarkdownMediaProps,
      patchedMarkdownMediaProps,
      "current upstream markdown media props",
    );
    markdownSource = replaceOrThrow(
      markdownSource,
      upstreamMarkdownMediaLocalState,
      patchedMarkdownMediaLocalState,
      "current upstream markdown media local path state",
    );
    markdownSource = replaceOrThrow(
      markdownSource,
      upstreamMarkdownMediaResolvedSourceState,
      patchedMarkdownMediaResolvedSourceState,
      "current upstream markdown media resolved source state",
    );
    markdownSource = replaceOrThrow(
      markdownSource,
      upstreamMarkdownMediaRenderer,
      patchedMarkdownMediaRenderer,
      "current upstream markdown media renderer cwd",
    );
    diffAnnotationsSource = replaceOrThrow(
      diffAnnotationsSource,
      upstreamMarkdownPreview,
      patchedMarkdownPreview,
      "current upstream markdown preview cwd",
    );
    return {
      ...bundleSources,
      webviewMarkdown: markdownSource,
      webviewDiffAnnotations: diffAnnotationsSource,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewMarkdown,
      this.requiredMarkers.webviewMarkdown,
      "markdown local media webview patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewMarkdown,
      this.forbiddenMarkers.webviewMarkdown,
      "markdown local media webview patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewDiffAnnotations,
      this.requiredMarkers.webviewDiffAnnotations,
      "markdown preview cwd webview patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewDiffAnnotations,
      this.forbiddenMarkers.webviewDiffAnnotations,
      "markdown preview cwd webview patch",
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
