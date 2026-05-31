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
          "case`avatarOverlay`:return{...a0({alwaysOnTop:!0,platform:n,resizable:!1,thickFrame:!1}),hasShadow:!1};",
          "case`avatarOverlay`:return{...a0({alwaysOnTop:!0,hasShadow:!1,platform:n,resizable:!1,thickFrame:!1,transparent:!0}),backgroundColor:k1,hasShadow:!1,type:n===`linux`?`notification`:void 0};",
          "current upstream avatar overlay BrowserWindow options",
        ),
        "title:i.app.getName(),width:CX.width,height:CX.height,appearance:`avatarOverlay`,focusable:!1,show:!1,initialRoute:VX",
        "title:`Codex Pet Overlay`,width:CX.width,height:CX.height,appearance:`avatarOverlay`,focusable:!1,show:!1,initialRoute:VX",
        "current upstream avatar overlay title",
      ),
      "JX={width:276,height:131}",
      "JX={width:320,height:131}",
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
        "I?`whitespace-pre-wrap`:b==null?`line-clamp-2`:void 0",
        "I?`whitespace-pre-wrap`:b==null?`line-clamp-4`:void 0",
        "current upstream avatar overlay collapsed body line clamp",
      ),
      "fn={mascot:{left:244,top:191,width:112,height:121},placement:`top-end`,tray:{left:80,top:56,width:276,height:131},viewport:{width:356,height:320}}",
      "fn={mascot:{left:244,top:191,width:112,height:121},placement:`top-end`,tray:{left:36,top:56,width:320,height:131},viewport:{width:356,height:320}}",
      "current upstream avatar overlay fallback layout",
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
