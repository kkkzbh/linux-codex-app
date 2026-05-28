import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const avatarOverlayTransparentPrelude = `function codexLinuxEnsureAvatarOverlayTransparent(){if(typeof document===\`undefined\`)return;try{let e=document,t=e.getElementById(\`codex-linux-avatar-overlay-transparent-style\`);if(t==null){t=e.createElement(\`style\`),t.id=\`codex-linux-avatar-overlay-transparent-style\`,t.textContent=\`html,body,#root{background:transparent!important;background-color:transparent!important;}body{margin:0!important;overflow:hidden!important;}\`,e.head.appendChild(t)}let n=[e.documentElement,e.body,e.getElementById(\`root\`)];for(let r of n)r&&(r.style.setProperty(\`background\`,\`transparent\`,\`important\`),r.style.setProperty(\`background-color\`,\`transparent\`,\`important\`))}catch{}}codexLinuxEnsureAvatarOverlayTransparent();typeof window!==\`undefined\`&&window.addEventListener(\`DOMContentLoaded\`,codexLinuxEnsureAvatarOverlayTransparent,{once:!0});`;

export const avatarOverlayTransparencyFeature = {
  id: "avatar-overlay-transparency",
  version: 5,
  requiredMarkers: FEATURE_MARKERS["avatar-overlay-transparency"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["avatar-overlay-transparency"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    const main = replaceOrThrow(
      replaceOrThrow(
        replaceOrThrow(
          bundleSources.main,
          "case`avatarOverlay`:return{...WY({alwaysOnTop:!0,platform:n,resizable:!1,thickFrame:!1}),hasShadow:!1};",
          "case`avatarOverlay`:return{...WY({alwaysOnTop:!0,hasShadow:!1,platform:n,resizable:!1,thickFrame:!1,transparent:!0}),backgroundColor:gY,hasShadow:!1,type:n===`linux`?`notification`:void 0};",
          "current upstream avatar overlay BrowserWindow options",
        ),
        "title:n.app.getName(),width:mG.width,height:mG.height,appearance:`avatarOverlay`,focusable:!1,show:!1,initialRoute:MG",
        "title:`Codex Pet Overlay`,width:mG.width,height:mG.height,appearance:`avatarOverlay`,focusable:!1,show:!1,initialRoute:MG",
        "current upstream avatar overlay title",
      ),
      "zG={width:276,height:131}",
      "zG={width:320,height:131}",
      "current upstream avatar overlay tray default size",
    );

    const webviewAvatarOverlay = replaceOrThrow(
      replaceOrThrow(
        replaceOrThrow(
          replaceOrThrow(
            bundleSources.webviewAvatarOverlay,
            "function pn(){let e=(0,R.c)(9),",
            `${avatarOverlayTransparentPrelude}function pn(){codexLinuxEnsureAvatarOverlayTransparent();let e=(0,R.c)(9),`,
            "current upstream avatar overlay transparent webview root",
          ),
          "nt=32",
          "nt=64",
          "current upstream avatar overlay collapsed body height",
        ),
        "he?`whitespace-pre-wrap`:x==null?`line-clamp-2`:void 0",
        "he?`whitespace-pre-wrap`:x==null?`line-clamp-4`:void 0",
        "current upstream avatar overlay collapsed body line clamp",
      ),
      "fn={mascot:{left:244,top:191,width:112,height:121},placement:`top-end`,tray:{left:80,top:56,width:276,height:131},viewport:{width:356,height:320}}",
      "fn={mascot:{left:244,top:191,width:112,height:121},placement:`top-end`,tray:{left:36,top:56,width:320,height:131},viewport:{width:356,height:320}}",
      "current upstream avatar overlay tray layout",
    );

    return {
      ...bundleSources,
      main,
      webviewAvatarOverlay,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.main,
      this.requiredMarkers.main,
      "Linux avatar overlay main transparency patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewAvatarOverlay,
      this.requiredMarkers.webviewAvatarOverlay,
      "Linux avatar overlay webview transparency patch",
    );
    ensureMarkersAbsent(
      bundleSources.main,
      this.forbiddenMarkers.main,
      "Linux avatar overlay main transparency patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewAvatarOverlay,
      this.forbiddenMarkers.webviewAvatarOverlay,
      "Linux avatar overlay webview transparency patch",
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
