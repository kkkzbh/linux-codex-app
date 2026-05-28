import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamMarkdownLocalMediaHelperAnchor =
  "function Ut(e){return!Bt.test(e)&&!t(e)?`image`:Wt(e)?.startsWith(`video/`)??!1?`video`:`image`}function Wt(e){let t=e.match(/^data:([^;,]+)/i);if(t!=null)return t[1]??null;let n=(0,zt.lookup)(e);return typeof n==`string`?n:null}function Gt(e){let t;try{t=new URL(e)}catch{return null}return t.protocol!==`https:`||t.hostname!==Vt||!t.pathname.startsWith(Ht)?null:t.pathname.match(/^\\/badge\\/(P[0-9]+)(?:-|$)/)?.[1]??null}function Kt(e){return e===`P0`?`bg-token-charts-red text-white`:e===`P1`?`bg-token-charts-orange text-white`:`bg-token-foreground/5 text-token-foreground`}function qt({contentsBase64:e,mimeType:t,path:n}){return`data:${t??Wt(n)??`application/octet-stream`};base64,${e}`}function Jt(e){if(e.startsWith(`//`))return!0;try{let t=new URL(e);return t.protocol===`http:`||t.protocol===`https:`}catch{return!1}}";

const patchedMarkdownLocalMediaHelperAnchor =
  "function codexLinuxSafeDecodeMediaPath(e){try{return decodeURIComponent(e)}catch{return e}}function codexLinuxNormalizeMediaPath(e){if(typeof e!=\"string\")return null;let t=e.trim();if(t.length===0)return null;if(/^file:\\/\\//i.test(t))try{let e=new URL(t);if(e.protocol!==`file:`)return null;let n=e.pathname||``;return e.host.length>0&&e.host!==`localhost`?n.length>0?`//${e.host}${codexLinuxSafeDecodeMediaPath(n)}`:null:n.length>0?codexLinuxSafeDecodeMediaPath(n):null}catch{return null}return t.startsWith(`/`)?/%[0-9A-Fa-f]{2}/.test(t)?codexLinuxSafeDecodeMediaPath(t):t:null}function codexLinuxResolveMarkdownMediaPath(e,t){let n=codexLinuxNormalizeMediaPath(e);if(n!=null)return n;if(typeof e!=\"string\"||typeof t!=\"string\")return null;let r=e.trim(),i=(codexLinuxNormalizeMediaPath(t)??t).trim();if(r.length===0||i.length===0||r.startsWith(`#`)||r.startsWith(`?`)||r.startsWith(`//`)||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(r)||!i.startsWith(`/`))return null;let a=i.endsWith(`/`)?i:`${i}/`;try{let e=new URL(encodeURI(r),`file://${encodeURI(a)}`);return e.protocol!==`file:`?null:codexLinuxSafeDecodeMediaPath(e.pathname||``)}catch{return null}}function codexLinuxNormalizeMarkdownRemoteMediaUrl(e){if(typeof e!=\"string\")return null;let t=e.trim();if(t.length===0)return null;let n=t.startsWith(`//`)?`https:${t}`:t;try{let e=new URL(n);return e.protocol===`http:`||e.protocol===`https:`?e.toString():null}catch{return null}}function codexLinuxMarkdownMimeType(e){if(typeof e!=\"string\")return null;let t=e.trim();if(t.length===0)return null;let n=t.match(/^data:([^;,]+)/i);if(n!=null)return n[1]??null;let r=t.startsWith(`//`)?`https:${t}`:t;try{let e=new URL(r);if(e.protocol===`http:`||e.protocol===`https:`||e.protocol===`file:`)r=e.pathname||``}catch{}let i=(0,zt.lookup)(r);return typeof i==`string`?i:null}function Ut(e){return!Bt.test(e)&&!t(e)?`image`:codexLinuxMarkdownMimeType(e)?.startsWith(`video/`)??!1?`video`:`image`}function Wt(e){return codexLinuxMarkdownMimeType(e)}function Gt(e){let t;try{t=new URL(e)}catch{return null}return t.protocol!==`https:`||t.hostname!==Vt||!t.pathname.startsWith(Ht)?null:t.pathname.match(/^\\/badge\\/(P[0-9]+)(?:-|$)/)?.[1]??null}function Kt(e){return e===`P0`?`bg-token-charts-red text-white`:e===`P1`?`bg-token-charts-orange text-white`:`bg-token-foreground/5 text-token-foreground`}function qt({contentsBase64:e,mimeType:t,path:n}){return`data:${t??Wt(n)??`application/octet-stream`};base64,${e}`}function Jt(e){return codexLinuxNormalizeMarkdownRemoteMediaUrl(e)!=null}";

const upstreamMarkdownMediaProps =
  "{allowWide:n,alt:r,animateEnter:i,className:a,hostId:o,mediaPresentation:s,rootRef:c,src:l,title:u}=e";

const patchedMarkdownMediaProps =
  "{allowWide:n,alt:r,animateEnter:i,className:a,hostId:o,cwd:codexLinuxMarkdownCwd,mediaPresentation:s,rootRef:c,src:l,title:u}=e";

const upstreamMarkdownMediaLocalState =
  "x=l??``,S=f(x),C=x.length>0,w=Gt(x),E;t[0]===x?E=t[1]:(E=Ut(x),t[0]=x,t[1]=E);let D=E===`video`,O=S!=null,k=w==null&&C&&!O&&Jt(x),j=O&&D?ce(S):null,M=!D&&O,{data:P,isLoading:F}=N(`read-file-binary`,{params:{path:M?S??x:``,hostId:o},queryConfig:{enabled:M,gcTime:1/0,staleTime:1/0}});";

const patchedMarkdownMediaLocalState =
  "x=l??``,S=codexLinuxResolveMarkdownMediaPath(x,codexLinuxMarkdownCwd),C=x.length>0,w=Gt(x),E,A=codexLinuxNormalizeMarkdownRemoteMediaUrl(x);t[0]===x?E=t[1]:(E=Ut(S??A??x),t[0]=x,t[1]=E);let D=E===`video`,O=S!=null,k=!1,j=D?(O?ce(S):A):null,M=!D&&O,{data:P,isLoading:F}=N(`read-file-binary`,{params:{path:M?S??x:``,hostId:o},queryConfig:{enabled:M,gcTime:1/0,staleTime:1/0}});";

const upstreamMarkdownMediaResolvedSourceState =
  "let ee=P?.contentsBase64??null,I=j??(M&&ee!=null?qt({contentsBase64:ee,mimeType:P?.mimeType??null,path:S??x}):x),L=r??``,R=O&&!D,te=O&&D&&j==null,z=k||M&&ee==null&&!F||y===I,";

const patchedMarkdownMediaResolvedSourceState =
  "let ee=P?.contentsBase64??null,I=j??(M&&ee!=null?qt({contentsBase64:ee,mimeType:P?.mimeType??null,path:S??x}):A??x),L=r??``,R=!D&&(O||A!=null),te=D&&C&&j==null,z=k||M&&ee==null&&!F||y===I,";

const upstreamMarkdownMediaRenderer =
  "img(e){return(0,Z.jsx)(en,{...e,animateEnter:t,hostId:a,mediaPresentation:o,rootRef:s})}";

const patchedMarkdownMediaRenderer =
  "img(e){return(0,Z.jsx)(en,{...e,animateEnter:t,cwd:r??null,hostId:a,mediaPresentation:o,rootRef:s})}";

const upstreamMarkdownPreview =
  "function Ye(e){let t=(0,X.c)(23),{path:n,className:r,fallback:i,hostId:a,scrollable:o}=e,s=o===void 0?!1:o,c=n!=null&&n.length>0&&n!==`/dev/null`,l=n??``,u;t[0]===a?u=t[1]:(u=a==null?{}:{hostId:a},t[0]=a,t[1]=u);let d;t[2]!==l||t[3]!==u?(d={path:l,...u},t[2]=l,t[3]=u,t[4]=d):d=t[4];let f;t[5]===c?f=t[6]:(f={enabled:c},t[5]=c,t[6]=f);let m;t[7]!==d||t[8]!==f?(m={params:d,queryConfig:f},t[7]=d,t[8]=f,t[9]=m):m=t[9];let{data:h,isLoading:g,isError:_}=O(`read-file`,m),v=h?.contents??null;if(!c)return i;if(g){let e=s?`overflow-auto`:`overflow-clip`,n;t[10]!==r||t[11]!==e?(n=p(`relative`,e,r),t[10]=r,t[11]=e,t[12]=n):n=t[12];let i;t[13]===Symbol.for(`react.memo_cache_sentinel`)?(i=(0,Z.jsx)(ge,{className:`justify-center py-6 text-sm`}),t[13]=i):i=t[13];let a;return t[14]===n?a=t[15]:(a=(0,Z.jsx)(`div`,{className:n,children:i}),t[14]=n,t[15]=a),a}if(v==null||v.length===0||_)return i;let y=s?`normal`:`subtle`,b=s?`auto`:`clip`,x;t[16]===v?x=t[17]:(x=(0,Z.jsx)(_e,{enableMetadataPreview:!0,markdown:v}),t[16]=v,t[17]=x);let S;return t[18]!==r||t[19]!==y||t[20]!==b||t[21]!==x?(S=(0,Z.jsx)(ve,{background:y,className:r,overflow:b,children:x}),t[18]=r,t[19]=y,t[20]=b,t[21]=x,t[22]=S):S=t[22],S}";

const patchedMarkdownPreview =
  "function codexLinuxSafeDecodePreviewPath(e){try{return decodeURIComponent(e)}catch{return e}}function codexLinuxNormalizePreviewPath(e){if(typeof e!=\"string\")return null;let t=e.trim();if(t.length===0)return null;if(/^file:\\/\\//i.test(t))try{let e=new URL(t);if(e.protocol!==`file:`)return null;let n=e.pathname||``;return e.host.length>0&&e.host!==`localhost`?n.length>0?`//${e.host}${codexLinuxSafeDecodePreviewPath(n)}`:null:n.length>0?codexLinuxSafeDecodePreviewPath(n):null}catch{return null}return t.startsWith(`/`)?/%[0-9A-Fa-f]{2}/.test(t)?codexLinuxSafeDecodePreviewPath(t):t:null}function codexLinuxMarkdownPreviewDir(e){let t=codexLinuxNormalizePreviewPath(e);if(t==null)return null;let n=Math.max(t.lastIndexOf(`/`),t.lastIndexOf(`\\\\`));return n<0?null:n===0?t.slice(0,1):t.slice(0,n)}function Ye(e){let t=(0,X.c)(25),{path:n,className:r,fallback:i,hostId:a,scrollable:o}=e,s=o===void 0?!1:o,c=n!=null&&n.length>0&&n!==`/dev/null`,l=n??``,u;t[0]===a?u=t[1]:(u=a==null?{}:{hostId:a},t[0]=a,t[1]=u);let d;t[2]!==l||t[3]!==u?(d={path:l,...u},t[2]=l,t[3]=u,t[4]=d):d=t[4];let f;t[5]===c?f=t[6]:(f={enabled:c},t[5]=c,t[6]=f);let m;t[7]!==d||t[8]!==f?(m={params:d,queryConfig:f},t[7]=d,t[8]=f,t[9]=m):m=t[9];let{data:h,isLoading:g,isError:_}=O(`read-file`,m),v=h?.contents??null;if(!c)return i;if(g){let e=s?`overflow-auto`:`overflow-clip`,n;t[10]!==r||t[11]!==e?(n=p(`relative`,e,r),t[10]=r,t[11]=e,t[12]=n):n=t[12];let i;t[13]===Symbol.for(`react.memo_cache_sentinel`)?(i=(0,Z.jsx)(ge,{className:`justify-center py-6 text-sm`}),t[13]=i):i=t[13];let a;return t[14]===n?a=t[15]:(a=(0,Z.jsx)(`div`,{className:n,children:i}),t[14]=n,t[15]=a),a}if(v==null||v.length===0||_)return i;let y=s?`normal`:`subtle`,b=s?`auto`:`clip`,x,S;t[16]!==v||t[17]!==l?(S=codexLinuxMarkdownPreviewDir(l),x=(0,Z.jsx)(_e,{enableMetadataPreview:!0,markdown:v,cwd:S}),t[16]=v,t[17]=l,t[18]=S,t[19]=x):(S=t[18],x=t[19]);let C;return t[20]!==r||t[21]!==y||t[22]!==b||t[23]!==x?(C=(0,Z.jsx)(ve,{background:y,className:r,overflow:b,children:x}),t[20]=r,t[21]=y,t[22]=b,t[23]=x,t[24]=C):C=t[24],C}";

const upstreamWebviewImageCsp = "img-src &#39;self&#39; app: blob: data: https:;";
const patchedWebviewImageCsp = "img-src &#39;self&#39; app: blob: data: http: https:;";

const upstreamWebviewMediaCsp = "media-src &#39;self&#39; app: blob: data:;";
const patchedWebviewMediaCsp = "media-src &#39;self&#39; app: blob: data: http: https:;";

export const markdownLocalMediaFeature = {
  id: "markdown-local-media",
  version: 8,
  requiredMarkers: FEATURE_MARKERS["markdown-local-media"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["markdown-local-media"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let markdownSource = bundleSources.webviewMarkdown;
    let diffAnnotationsSource = bundleSources.webviewDiffAnnotations;
    let webviewHtmlSource = bundleSources.webviewHtml;

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
    ensureMarkersPresent(
      webviewHtmlSource,
      [upstreamWebviewImageCsp, upstreamWebviewMediaCsp],
      "current upstream webview media CSP anchors",
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
    webviewHtmlSource = replaceOrThrow(
      webviewHtmlSource,
      upstreamWebviewImageCsp,
      patchedWebviewImageCsp,
      "current upstream webview image CSP",
    );
    webviewHtmlSource = replaceOrThrow(
      webviewHtmlSource,
      upstreamWebviewMediaCsp,
      patchedWebviewMediaCsp,
      "current upstream webview media CSP",
    );

    return {
      ...bundleSources,
      webviewMarkdown: markdownSource,
      webviewDiffAnnotations: diffAnnotationsSource,
      webviewHtml: webviewHtmlSource,
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
    ensureMarkersPresent(
      bundleSources.webviewHtml,
      this.requiredMarkers.webviewHtml,
      "markdown remote media webview CSP patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewHtml,
      this.forbiddenMarkers.webviewHtml,
      "markdown remote media webview CSP patch",
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
