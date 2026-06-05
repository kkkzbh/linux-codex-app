import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const upstreamMarkdownLocalMediaHelperAnchor =
  "function Yt(e){return!Kt.test(e)&&!t(e)?`image`:Xt(e)?.startsWith(`video/`)??!1?`video`:`image`}function Xt(e){let t=e.match(/^data:([^;,]+)/i);if(t!=null)return t[1]??null;let n=(0,Gt.lookup)(e);return typeof n==`string`?n:null}function Zt(e){let t;try{t=new URL(e)}catch{return null}return t.protocol!==`https:`||t.hostname!==qt||!t.pathname.startsWith(Jt)?null:t.pathname.match(/^\\/badge\\/(P[0-9]+)(?:-|$)/)?.[1]??null}function Qt(e){return e===`P0`?`bg-token-charts-red text-white`:e===`P1`?`bg-token-charts-orange text-white`:`bg-token-foreground/5 text-token-foreground`}function $t({contentsBase64:e,mimeType:t,path:n}){return`data:${t??Xt(n)??`application/octet-stream`};base64,${e}`}";

const patchedMarkdownLocalMediaHelperAnchor =
  "function codexLinuxSafeDecodeMediaPath(e){try{return decodeURIComponent(e)}catch{return e}}function codexLinuxNormalizeMediaPath(e){if(typeof e!=\"string\")return null;let t=e.trim();if(t.length===0)return null;if(/^file:\\/\\//i.test(t))try{let e=new URL(t);if(e.protocol!==`file:`)return null;let n=e.pathname||``;return e.host.length>0&&e.host!==`localhost`?n.length>0?`//${e.host}${codexLinuxSafeDecodeMediaPath(n)}`:null:n.length>0?codexLinuxSafeDecodeMediaPath(n):null}catch{return null}return t.startsWith(`/`)?/%[0-9A-Fa-f]{2}/.test(t)?codexLinuxSafeDecodeMediaPath(t):t:null}function codexLinuxResolveMarkdownMediaPath(e,t){let n=codexLinuxNormalizeMediaPath(e);if(n!=null)return n;if(typeof e!=\"string\"||typeof t!=\"string\")return null;let r=e.trim(),i=(codexLinuxNormalizeMediaPath(t)??t).trim();if(r.length===0||i.length===0||r.startsWith(`#`)||r.startsWith(`?`)||r.startsWith(`//`)||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(r)||!i.startsWith(`/`))return null;let a=i.endsWith(`/`)?i:`${i}/`;try{let e=new URL(encodeURI(r),`file://${encodeURI(a)}`);return e.protocol!==`file:`?null:codexLinuxSafeDecodeMediaPath(e.pathname||``)}catch{return null}}function codexLinuxMarkdownImageMimeType(e){if(typeof e!=\"string\")return null;let t=e.trim();if(t.length===0)return null;let n=t.match(/^data:([^;,]+)/i);if(n!=null)return n[1]?.startsWith(`image/`)?n[1]:null;try{let e=new URL(t);if(e.protocol===`file:`)t=e.pathname||``}catch{}let r=(0,Gt.lookup)(t);return typeof r==`string`&&r.startsWith(`image/`)?r:null}function Yt(e){return`image`}function Xt(e){return codexLinuxMarkdownImageMimeType(e)}function Zt(e){let t;try{t=new URL(e)}catch{return null}return t.protocol!==`https:`||t.hostname!==qt||!t.pathname.startsWith(Jt)?null:t.pathname.match(/^\\/badge\\/(P[0-9]+)(?:-|$)/)?.[1]??null}function Qt(e){return e===`P0`?`bg-token-charts-red text-white`:e===`P1`?`bg-token-charts-orange text-white`:`bg-token-foreground/5 text-token-foreground`}function $t({contentsBase64:e,mimeType:t,path:n}){return`data:${t??Xt(n)??`application/octet-stream`};base64,${e}`}";

const upstreamMarkdownMediaProps =
  "{allowWide:n,alt:r,animateEnter:i,className:a,hostId:o,mediaPresentation:s,rootRef:c,src:l,title:u}=e";

const patchedMarkdownMediaProps =
  "{allowWide:n,alt:r,animateEnter:i,className:a,hostId:o,cwd:codexLinuxMarkdownCwd,mediaPresentation:s,rootRef:c,src:l,title:u}=e";

const upstreamMarkdownMediaLocalState =
  "x=l??``,S=d(x),C=x.length>0,w=Zt(x),T;t[0]===x?T=t[1]:(T=Yt(x),t[0]=x,t[1]=T);let E=T,O=E===`video`,k;t[2]===x?k=t[3]:(k=x.startsWith(`//`),t[2]=x,t[3]=k);let A=S!=null&&!k,j=an(x,w==null&&C&&E===`image`&&!A&&tn(x)),M=w==null&&C&&!A&&en(x)&&j.safeUrl==null&&!j.isPending,N=A&&O?me(S):null,P=!O&&A,{data:I,isLoading:L}=F(`read-file-binary`,{params:{path:P?S??x:``,hostId:o},queryConfig:{enabled:P,gcTime:1/0,staleTime:1/0}});";

const patchedMarkdownMediaLocalState =
  "x=l??``,S=codexLinuxResolveMarkdownMediaPath(x,codexLinuxMarkdownCwd),C=x.length>0,w=Zt(x),T;t[0]===x?T=t[1]:(T=Yt(S??x),t[0]=x,t[1]=T);let E=T,O=!1,k=!1,A=S!=null,j=an(x,w==null&&C&&E===`image`&&!A&&tn(x)),M=!1,N=null,P=A,{data:I,isLoading:L}=F(`read-file-binary`,{params:{path:P?S??x:``,hostId:o},queryConfig:{enabled:P,gcTime:1/0,staleTime:1/0}});";

const upstreamMarkdownMediaResolvedSourceState =
  "let te=I?.contentsBase64??null,R=j.safeUrl??N??(P&&te!=null?$t({contentsBase64:te,mimeType:I?.mimeType??null,path:S??x}):x),z=r??``,B=A&&!O,ne=A&&O&&N==null,re=M||P&&te==null&&!L||y===R,";

const patchedMarkdownMediaResolvedSourceState =
  "let te=I?.contentsBase64??null,R=j.safeUrl??N??(P&&te!=null?$t({contentsBase64:te,mimeType:I?.mimeType??null,path:S??x}):x),z=r??``,B=A,ne=!1,re=M||P&&te==null&&!L||y===R,";

const upstreamMarkdownMediaRenderer =
  "img(e){return(0,Z.jsx)(mn,{...e,animateEnter:t,hostId:a,mediaPresentation:o,rootRef:s})}";

const patchedMarkdownMediaRenderer =
  "img(e){return(0,Z.jsx)(mn,{...e,animateEnter:t,cwd:n??null,hostId:a,mediaPresentation:o,rootRef:s})}";

const upstreamMarkdownPreview =
  "function be(e){let t=(0,X.c)(23),{path:n,className:r,fallback:i,hostId:a,scrollable:o}=e,s=o===void 0?!1:o,c=n!=null&&n.length>0&&n!==`/dev/null`,l=n??``,d;t[0]===a?d=t[1]:(d=a==null?{}:{hostId:a},t[0]=a,t[1]=d);let f;t[2]!==l||t[3]!==d?(f={path:l,...d},t[2]=l,t[3]=d,t[4]=f):f=t[4];let p;t[5]===c?p=t[6]:(p={enabled:c},t[5]=c,t[6]=p);let m;t[7]!==f||t[8]!==p?(m={params:f,queryConfig:p},t[7]=f,t[8]=p,t[9]=m):m=t[9];let{data:h,isLoading:g,isError:_}=E(`read-file`,m),v=h?.contents??null;if(!c)return i;if(g){let e=s?`overflow-auto`:`overflow-clip`,n;t[10]!==r||t[11]!==e?(n=u(`relative`,e,r),t[10]=r,t[11]=e,t[12]=n):n=t[12];let i;t[13]===Symbol.for(`react.memo_cache_sentinel`)?(i=(0,Z.jsx)(ue,{className:`justify-center py-6 text-sm`}),t[13]=i):i=t[13];let a;return t[14]===n?a=t[15]:(a=(0,Z.jsx)(`div`,{className:n,children:i}),t[14]=n,t[15]=a),a}if(v==null||v.length===0||_)return i;let y=s?`normal`:`subtle`,b=s?`auto`:`clip`,x;t[16]===v?x=t[17]:(x=(0,Z.jsx)(de,{enableMetadataPreview:!0,markdown:v}),t[16]=v,t[17]=x);let S;return t[18]!==r||t[19]!==y||t[20]!==b||t[21]!==x?(S=(0,Z.jsx)(fe,{background:y,className:r,overflow:b,children:x}),t[18]=r,t[19]=y,t[20]=b,t[21]=x,t[22]=S):S=t[22],S}";

const patchedMarkdownPreview =
  "function codexLinuxSafeDecodePreviewPath(e){try{return decodeURIComponent(e)}catch{return e}}function codexLinuxNormalizePreviewPath(e){if(typeof e!=\"string\")return null;let t=e.trim();if(t.length===0)return null;if(/^file:\\/\\//i.test(t))try{let e=new URL(t);if(e.protocol!==`file:`)return null;let n=e.pathname||``;return e.host.length>0&&e.host!==`localhost`?n.length>0?`//${e.host}${codexLinuxSafeDecodePreviewPath(n)}`:null:n.length>0?codexLinuxSafeDecodePreviewPath(n):null}catch{return null}return t.startsWith(`/`)?/%[0-9A-Fa-f]{2}/.test(t)?codexLinuxSafeDecodePreviewPath(t):t:null}function codexLinuxMarkdownPreviewDir(e){let t=codexLinuxNormalizePreviewPath(e);if(t==null)return null;let n=Math.max(t.lastIndexOf(`/`),t.lastIndexOf(`\\\\`));return n<0?null:n===0?t.slice(0,1):t.slice(0,n)}function be(e){let t=(0,X.c)(25),{path:n,className:r,fallback:i,hostId:a,scrollable:o}=e,s=o===void 0?!1:o,c=n!=null&&n.length>0&&n!==`/dev/null`,l=n??``,d;t[0]===a?d=t[1]:(d=a==null?{}:{hostId:a},t[0]=a,t[1]=d);let f;t[2]!==l||t[3]!==d?(f={path:l,...d},t[2]=l,t[3]=d,t[4]=f):f=t[4];let p;t[5]===c?p=t[6]:(p={enabled:c},t[5]=c,t[6]=p);let m;t[7]!==f||t[8]!==p?(m={params:f,queryConfig:p},t[7]=f,t[8]=p,t[9]=m):m=t[9];let{data:h,isLoading:g,isError:_}=E(`read-file`,m),v=h?.contents??null;if(!c)return i;if(g){let e=s?`overflow-auto`:`overflow-clip`,n;t[10]!==r||t[11]!==e?(n=u(`relative`,e,r),t[10]=r,t[11]=e,t[12]=n):n=t[12];let i;t[13]===Symbol.for(`react.memo_cache_sentinel`)?(i=(0,Z.jsx)(ue,{className:`justify-center py-6 text-sm`}),t[13]=i):i=t[13];let a;return t[14]===n?a=t[15]:(a=(0,Z.jsx)(`div`,{className:n,children:i}),t[14]=n,t[15]=a),a}if(v==null||v.length===0||_)return i;let y=s?`normal`:`subtle`,b=s?`auto`:`clip`,x,S;t[16]!==v||t[17]!==l?(S=codexLinuxMarkdownPreviewDir(l),x=(0,Z.jsx)(de,{enableMetadataPreview:!0,markdown:v,cwd:S}),t[16]=v,t[17]=l,t[18]=S,t[19]=x):(S=t[18],x=t[19]);let C;return t[20]!==r||t[21]!==y||t[22]!==b||t[23]!==x?(C=(0,Z.jsx)(fe,{background:y,className:r,overflow:b,children:x}),t[20]=r,t[21]=y,t[22]=b,t[23]=x,t[24]=C):C=t[24],C}";

export const markdownLocalMediaFeature = {
  id: "markdown-local-media",
  version: 9,
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
