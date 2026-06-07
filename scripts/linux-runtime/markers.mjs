export const FEATURE_MARKERS = {
  "open-targets": {
    requiredMarkers: [
      "linux:{label:`Dolphin`",
      "codexLinuxGwenviewTarget",
      "codexLinuxTyporaTarget",
      "codexLinuxWpsWriterTarget",
      "codexLinuxWpsSpreadsheetsTarget",
      "codexLinuxWpsPresentationTarget",
      "codexLinuxWpsPdfTarget",
      "codexLinuxClionTarget",
      "function codexLinuxJetBrainsArgs",
      "args:codexLinuxJetBrainsArgs",
      "linux:{label:`VS Code`",
      "linux:{label:`PyCharm`",
      "linux:{label:`WebStorm`",
      "linux:{label:`CLion`",
    ],
    forbiddenMarkers: [
      "codexLinuxKittyTarget",
      "codexLinuxClaudeCodeTarget",
      "codexLinuxZedTarget",
      "codexLinuxIntellijTarget",
      "codexLinuxRiderTarget",
      "codexLinuxRustroverTarget",
      "detect:()=>Fi(`",
      "detect:()=>fm(`",
    ],
  },
  "markdown-local-media": {
    requiredMarkers: {
      webviewMarkdown: [
        "function codexLinuxNormalizeMediaPath(e)",
        "function codexLinuxResolveMarkdownMediaPath(e,t)",
        "function codexLinuxMarkdownImageMimeType(e)",
        "{allowWide:n,alt:r,animateEnter:i,className:a,hostId:o,cwd:codexLinuxMarkdownCwd,mediaPresentation:s,rootRef:c,src:l,title:u}=e",
        "S=codexLinuxResolveMarkdownMediaPath(x,codexLinuxMarkdownCwd)",
        "T=Yt(S??x)",
        "O=!1,k=!1,A=S!=null",
        "N=null,P=A",
        "R=j.safeUrl??N??(P&&te!=null?$t({contentsBase64:te,mimeType:I?.mimeType??null,path:S??x}):x)",
        "B=A,ne=!1",
        "params:{path:P?S??x:``,hostId:o}",
        "(0,Z.jsx)(mn,{...e,animateEnter:t,cwd:n??null,hostId:a,mediaPresentation:o,rootRef:s})",
      ],
      webviewDiffAnnotations: [
        "function codexLinuxMarkdownPreviewDir(e)",
        "(0,Z.jsx)(de,{enableMetadataPreview:!0,markdown:v,cwd:S})",
      ],
      webviewHtml: [],
    },
    forbiddenMarkers: {
      webviewMarkdown: [
        "function codexLinuxNormalizeMarkdownRemoteMediaUrl(e)",
        "ke=codexLinuxNormalizeMarkdownRemoteMediaUrl(x)",
        "T=Yt(S??ke??x)",
        "N=O?(A?me(S):ke):null",
        "R=j.safeUrl??N??(P&&te!=null?$t({contentsBase64:te,mimeType:I?.mimeType??null,path:S??x}):ke??x)",
        "B=!O&&(A||ke!=null)",
        "ne=O&&C&&N==null",
        "{allowWide:n,alt:r,animateEnter:i,className:a,hostId:o,mediaPresentation:s,rootRef:c,src:l,title:u}=e",
        "x=l??``,S=d(x),C=x.length>0,w=Zt(x),T;t[0]===x?T=t[1]:(T=Yt(x),t[0]=x,t[1]=T)",
        "M=w==null&&C&&!A&&en(x)&&j.safeUrl==null&&!j.isPending",
        "B=A&&!O,ne=A&&O&&N==null",
        "(0,Z.jsx)(mn,{...e,animateEnter:t,hostId:a,mediaPresentation:o,rootRef:s})",
      ],
      webviewDiffAnnotations: [
        "(0,Z.jsx)(de,{enableMetadataPreview:!0,markdown:v})",
      ],
      webviewHtml: [],
    },
  },
  "generated-output-artifacts": {
    requiredMarkers: {
      webviewLocalConversationThread: [
        "function codexLinuxIsGeneratedImageTempArtifactPath(e)",
        "function codexLinuxResolveGeneratedImageArtifactPath(e,t,n)",
        "conversationId:e,projectlessOutputDirectory:t(De,e)",
        "let t=codexLinuxResolveGeneratedImageArtifactPath(e.path,l)",
      ],
    },
    forbiddenMarkers: {
      webviewLocalConversationThread: [
        "function dp(e,{projectlessOutputDirectory:t=null}={}){let n=[];for(let r=e.length-1;r>=0;--r)n.push(pp(e[r],t));return fp(n)}",
        "for(let e of i.items)e?.type===`imageGeneration`&&e.src!=null&&Le(e.src)&&st({cwd:t,projectlessOutputDirectory:n,resourcePath:e.src})&&c({type:`file`,path:t==null?e.src:te(t,e.src)})",
      ],
    },
  },
  "browser-use": {
    requiredMarkers: [
      "CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE",
      "browserPane:!0,inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0",
    ],
    forbiddenMarkers: [
      "function xe(e,{buildFlavor:n=t.O.resolve(),env:r=f.default.env,platform:i=f.default.platform}={}){let a=i===`win32`&&r.CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE===`1`?{...e,computerUse:!0,computerUseNodeRepl:!0}:e,o=n===t.O.Dev?Se(r):null;return o==null?a:{...a,...o}}",
    ],
  },
  "computer-use-provider": {
    requiredMarkers: {
      webviewComputerUseSettings: [
        "function codexLinuxComputerUseProvider()",
        "p=X([...d.availablePlugins,...d.installedPlugins],we,f)",
        "let m=p??codexLinuxComputerUseProvider(),h;",
      ],
      webviewComputerUseProviderSettings: [
        "kde-computer-use",
        "plugin.name===`kde-computer-use`",
        "marketplaceName===`local`",
      ],
    },
    forbiddenMarkers: {
      webviewComputerUseSettings: [
        "p=X(d.availablePlugins,we,f)",
      ],
      webviewComputerUseProviderSettings: [
        "function St(e,t,n){let r=e.filter(e=>e.plugin.name===t||e.plugin.id.split(`@`)[0]===t),i=l(le());return(i==null?void 0:r.find(e=>e.marketplaceName===i))??r.find(e=>s(e.marketplaceName))??r.find(e=>e.marketplaceName===`openai-curated`)??r.find(e=>Ee(n,e.marketplacePath))??null}",
      ],
    },
  },
  "computer-use-availability": {
    requiredMarkers: {
      webviewPluginFeatureGate: [
        "e===`macOS`||e===`windows`||e===`linux`",
        "isComputerUseGateEnabled:f||c===`linux`",
      ],
    },
    forbiddenMarkers: {
      webviewPluginFeatureGate: [
        "function d(e){return e===`macOS`||e===`windows`}",
        "isComputerUseGateEnabled:f,isHostCompatiblePlatform:d(c),isPlatformLoading:o,windowType:`electron`",
      ],
    },
  },
  "browser-backend-registry": {
    requiredMarkers: [
      "codexLinuxRegisterBrowserBackend",
      "codexLinuxBrowserRegistryPath",
      "codexLinuxPruneBrowserRegistry",
      "codexLinuxNormalizeBrowserBackend",
      "codex-electron-iab",
      "codex-browser-backends-",
    ],
    forbiddenMarkers: [],
  },
  "browser-security": {
    requiredMarkers: [
      "CODEX_DESKTOP_AUTH_FETCH_SOCKET",
      "CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET",
      "startLinuxBrowserSecurityServers",
      "startLinuxAuthenticatedFetchServer",
      "startLinuxBrowserApprovalServer",
      "linuxAuthenticatedFetch",
      "linuxRequestBrowserApproval",
      "linuxNormalizeBrowserApprovalRequest",
      "linuxNormalizeBrowserApprovalOrigin",
      "linuxReadBrowserUseState",
      "linuxResolveBrowserApprovalPolicy",
      "Linux browser-use state unavailable",
      "await A_()",
      "await F_(`allowed`,e.origin)",
      "await I_(e.transferKind,`allowed`,e.origin)",
      "sensitive_data===`browsing_history`",
      "file_transfer===`download`||t.file_transfer===`upload`",
      "createServer({allowHalfOpen:!0}",
      "Linux authenticated fetch URL is not allowlisted",
      "Linux browser approval request is not allowlisted",
      "prodApiBaseUrl:r.prodApiBaseUrl,hostId:L});u.startLinuxBrowserSecurityServers?.();let d=new",
    ],
    forbiddenMarkers: [
      "prodApiBaseUrl:r.prodApiBaseUrl}),d=new",
      "linux-browser-origin-approvals.json",
    ],
  },
  "chrome-setup-url": {
    requiredMarkers: {
      webviewPluginAvailability: [
        /https:\/\/chromewebstore\.google\.com\/detail\/codex\/\$\{encodeURIComponent\([$A-Z_a-z][$\w]*\.trim\(\)\)\}/,
        /id:[$A-Z_a-z][$\w]*\.trim\(\),name:`Codex Chrome Extension`,url:[$A-Z_a-z][$\w]*\([$A-Z_a-z][$\w]*\)/,
        "useExternalBrowser:!0,source:`plugin_browser_extension_setup`",
      ],
      webviewPluginDetail: [
        "useExternalBrowser:!0,source:`plugin_browser_extension_setup`",
      ],
    },
    forbiddenMarkers: {
      webviewPluginAvailability: [
        /[$A-Z_a-z][$\w]*=`https:\/\/chromewebstore\.google\.com\/detail\/codex\/`/,
        /id:[$A-Z_a-z][$\w]*,name:`Codex Chrome Extension`,url:`\$\{[$A-Z_a-z][$\w]*\}\$\{[$A-Z_a-z][$\w]*\}`/,
        /onClick:\(\)=>\{[$A-Z_a-z][$\w]*\.dispatchMessage\(`open-in-browser`,\{url:[$A-Z_a-z][$\w]*\.url\}\)\},children:\(0,[$A-Z_a-z][$\w]*\.jsx\)\([$A-Z_a-z][$\w]*,\{id:`plugins\.installModal\.openBrowserExtension`/,
      ],
      webviewPluginDetail: [
        /onClick:\(\)=>\{[$A-Z_a-z][$\w]*\.dispatchMessage\(`open-in-browser`,\{url:[$A-Z_a-z][$\w]*\.url\}\)\},children:\(0,[$A-Z_a-z][$\w]*\.jsx\)\([$A-Z_a-z][$\w]*,\{id:`plugins\.detail\.setup\.openBrowserExtension`/,
      ],
    },
  },
  "chrome-extension-status": {
    requiredMarkers: [
      /"chrome-extension-installed-read":async\(\{extensionId:e\}\)=>\(\{installed:[$A-Z_a-z][$\w]*\(\{extensionId:e\}\)\}\)/,
      "n===`linux`?(0,o.join)(e,`.config`,`google-chrome`):null",
    ],
    forbiddenMarkers: [
      "function da({homeDir:e,localAppDataDir:t,platform:n}){return n===`darwin`?(0,i.join)(e,`Library`,`Application Support`,`Google`,`Chrome`):n===`win32`?(0,i.join)(t??(0,i.join)(e,`AppData`,`Local`),`Google`,`Chrome`,`User Data`):null}",
    ],
  },
  "native-titlebar": {
    mainRequiredMarkers: [
      "codex_desktop:linux-titlebar-config",
      "codex_desktop:linux-titlebar-action",
      "codex_desktop:linux-titlebar-debug",
      "linuxTitlebarConfigChannel",
      "linuxTitlebarActionChannel",
      "linuxTitlebarDebugChannel",
      "CODEX_LINUX_TITLEBAR_DEBUG",
      "linux-titlebar-debug.jsonl",
      "__codexCustomTitlebar",
      "frame:!1,hasShadow:!0,transparent:!0,backgroundColor:`#00000000`",
    ],
    preloadRequiredMarkers: [
      "codex_desktop:linux-titlebar-config",
      "codex_desktop:linux-titlebar-action",
      "codex_desktop:linux-titlebar-debug",
      "linuxTitlebarConfigChannel",
      "linuxTitlebarActionChannel",
      "linuxTitlebarDebugChannel",
      "codex-linux-drag-style",
      "data-codex-linux-drag-root",
      "codex-linux-header-tint-mask",
      "codex-linux-window-controls",
      "codexLinuxIpcRenderer",
      "codexLinuxIpcRenderer.invoke(linuxTitlebarConfigChannel)",
      "codexLinuxIpcRenderer.invoke(linuxTitlebarActionChannel",
      "CODEX_LINUX_TITLEBAR_DEBUG",
      "positionLinuxWindowControls",
      "resetLinuxWindowControlsPosition",
      "isLinuxImagePreviewOpen",
      "isLinuxSettingsSurface",
      "syncLinuxWindowControlsVisibility",
      "codexLinuxWindowControlsHidden",
      "data-codex-linux-window-controls-hidden",
      "syncLinuxHeaderTintMask",
      "getLinuxSidebarVisualRight",
      "getLinuxSidebarPanelRight",
      "syncLinuxSidebarTopbar",
      "group/windows-top-bar",
      "codex-linux-sidebar-top-surface",
      "--codex-linux-sidebar-top-surface-width",
      'group/windows-top-bar"]{width:var(--codex-linux-sidebar-top-surface-width)!important;max-width:var(--codex-linux-sidebar-top-surface-width)!important;min-width:0!important;overflow:hidden!important;background:transparent!important;background-color:transparent!important;box-shadow:none!important;}',
      "codexLinuxHeaderTintMask",
      "codexLinuxSidebarHeaderClip",
      'setProperty("clip-path","inset(0 0 0 "+i+"px)","important")',
      "header-shell-slot",
      "app-shell-left-panel .app-header-tint{background:transparent!important",
      "linuxPointDebug",
      "pointSamples",
      "sidebarHeaders",
      "ResizeObserver",
      'getComputedStyle(e,":after")',
      "background-color:transparent!important",
      '[role="dialog"][aria-label="Image preview"]',
      '[data-testid="image-preview-dismiss-area"]',
      'aria-hidden","true',
      "inert",
      'padding-right","96px',
      'width:16px;height:16px',
      'button:hover',
      'button:active',
      '[["minimize","Minimize"],["maximize","Maximize"],["close","Close"]]',
    ],
    mainForbiddenMarkers: [
      "n===`win32`?{titleBarStyle:`hidden`,titleBarOverlay:V1()}:{frame:!1,hasShadow:!0};",
    ],
    preloadForbiddenMarkers: [
      '[class~="group/windows-top-bar"]>*{visibility:hidden!important;opacity:0!important;}',
      "data-codex-linux-image-preview-open",
      "z-index:35;background:var(--color-token-editor-background)!important",
      '[data-codex-window-type="electron"][data-codex-os="linux"] .app-shell-left-panel{position:relative;z-index:35',
      "#codex-linux-header-tint-mask{position:fixed;pointer-events:none;z-index:29;background:var(--codex-titlebar-tint,transparent);-webkit-app-region:drag;}",
      "--codex-linux-sidebar-surface",
      "color-mix(in srgb, var(--color-token-editor-background)",
      "syncLinuxLeftPanelTopInset",
      "--codex-linux-left-panel-padding-top",
      "background:var(--codex-linux-sidebar-surface)!important",
    ],
    webviewAppShellForbiddenMarkers: [
      "var(--codex-linux-left-panel-padding-top,var(--height-toolbar))",
    ],
  },
  "settings-sidebar-surface": {
    requiredMarkers: {
      webviewSettingsPage: [
        "app-shell-left-panel window-fx-sidebar-surface pointer-events-auto relative flex shrink-0 flex-col overflow-visible",
      ],
    },
    forbiddenMarkers: {
      webviewSettingsPage: [
        "H=a(`window-fx-sidebar-surface flex shrink-0 flex-col`,`w-token-sidebar`)",
      ],
    },
  },
  "avatar-overlay-transparency": {
    requiredMarkers: {
      main: [
        "case`avatarOverlay`:return{...a0({alwaysOnTop:!0,hasShadow:!1,platform:n,resizable:!1,thickFrame:!1,transparent:!0}),backgroundColor:k1,hasShadow:!1,type:n===`linux`?`notification`:void 0};",
        "title:`Codex Pet Overlay`,width:CX.width,height:CX.height,appearance:`avatarOverlay`,focusable:!1,show:!1,initialRoute:VX",
        "JX={width:320,height:131}",
      ],
      webviewAvatarOverlay: [
        "codexLinuxEnsureAvatarOverlayTransparent",
        "codex-linux-avatar-overlay-transparent-style",
        "html,body,#root{background:transparent!important;background-color:transparent!important;}",
        "function pn(){codexLinuxEnsureAvatarOverlayTransparent();let e=(0,R.c)(9),",
        "nt=64",
        "I?`whitespace-pre-wrap`:b==null?`line-clamp-4`:void 0",
        "fn={mascot:{left:244,top:191,width:112,height:121},placement:`top-end`,tray:{left:36,top:56,width:320,height:131},viewport:{width:356,height:320}}",
      ],
    },
    forbiddenMarkers: {
      main: [
        "case`avatarOverlay`:return{...a0({alwaysOnTop:!0,platform:n,resizable:!1,thickFrame:!1}),hasShadow:!1};",
        "title:i.app.getName(),width:CX.width,height:CX.height,appearance:`avatarOverlay`,focusable:!1,show:!1,initialRoute:VX",
        "JX={width:276,height:131}",
      ],
      webviewAvatarOverlay: [
        "nt=32",
        "I?`whitespace-pre-wrap`:b==null?`line-clamp-2`:void 0",
        "fn={mascot:{left:244,top:191,width:112,height:121},placement:`top-end`,tray:{left:80,top:56,width:276,height:131},viewport:{width:356,height:320}}",
      ],
    },
  },
};

export const RETIRED_LINUX_PATCH_MARKERS = {
  main: [
    "codexLinuxPreferredTargetCwd",
    /"set-preferred-app":async\(\{target:[$A-Z_a-z][$\w]*,cwd:codexLinuxPreferredTargetCwd\}\)=>\([$A-Z_a-z][$\w]*\(this\.getSettingsStore\(\),codexLinuxPreferredTargetCwd\?\?null,[$A-Z_a-z][$\w]*\),\{success:!0\}\)/,
    "codexLinuxWorkingSessionsStatusPath",
    "codexLinuxWriteWorkingSessionsStatus",
    "CODEX_WORKING_SESSIONS_STATUS_PATH",
    "working-sessions.json",
    /case`view-focused`:case`quit-app`:case`tray-menu-threads-changed`:codexLinuxWriteWorkingSessionsStatus\([$A-Z_a-z][$\w]*\);break;/,
    "codexLinuxWriteWorkingSessionsStatus({trayMenuThreads:{runningThreads:[]}},!1)",
  ],
  webviewFollowUp: [
    /var [$A-Z_a-z][$\w]*=\/\^::\(\?:inbox-item\|archive-thread\|code-comment\|git-stage\|git-commit\|git-create-branch\|git-push\|git-create-pr\|pr-auto-fix-progress\)\(\?=\$\|\[\\s\\\[\{\]\)\.\*\$\/gm;/,
    "case`imageGeneration`:{let e=typeof n.src==`string`?n.src.trim():``;if(e.length===0)break;a.push({type:`generated-image`,id:n.id,src:e,status:n.status});break}",
    "codexImageViewId",
    "app://fs/@fs${encodeURI(e).replaceAll",
    /case`imageView`:return typeof [$A-Z_a-z][$\w]*\.path==`string`&&[$A-Z_a-z][$\w]*\([$A-Z_a-z][$\w]*\.path\)!=null;/,
  ],
  webviewHtml: [
    "img-src &#39;self&#39; app: blob: data: http: https:;",
    "media-src &#39;self&#39; app: blob: data: http: https:;",
  ],
  webviewMarkdown: [
    "function codexLinuxNormalizeMarkdownRemoteMediaUrl(e)",
    "ke=codexLinuxNormalizeMarkdownRemoteMediaUrl(x)",
    /queryConfig:\{enabled:[$A-Z_a-z][$\w]*,gcTime:1\/0,staleTime:0,refetchOnMount:`always`\}/,
  ],
  webviewUsePlugins: [
    "function C(e){if(typeof e!==`string`)return null;let t=e.trim();",
    /queryKey:[$A-Z_a-z][$\w]*\(`read-file-binary`,[$A-Z_a-z][$\w]*\),retry:!1,gcTime:1\/0,staleTime:0/,
  ],
  webviewModelSettings: [
    /function [$A-Z_a-z][$\w]*\([$A-Z_a-z][$\w]*=null\)\{let .*?,[$A-Z_a-z][$\w]*=[$A-Z_a-z][$\w]*==null\?null:[$A-Z_a-z][$\w]*\.cwd,[$A-Z_a-z][$\w]*=[$A-Z_a-z][$\w]*\(\{hostId:[$A-Z_a-z][$\w]*,cwd:[$A-Z_a-z][$\w]*,isHostRegistered:[$A-Z_a-z][$\w]*\}\)/,
  ],
  webviewPluginAvailability: [
    "function codexLinuxPluginHasMcp",
    "function codexLinuxRestartAppServerForPluginMcp",
    "codexLinuxRestartAppServerForPluginMcp(f,t,D)",
  ],
};

export const START_SCRIPT_MARKERS = {
  requiredMarkers: [
    'CODEX_STANDALONE_CLI_PATH="${CODEX_STANDALONE_CLI_PATH:-$HOME/.codex/packages/standalone/current/codex}"',
    'export CHROME_DESKTOP="${CHROME_DESKTOP:-Codex.desktop}"',
    'CODEX_DESKTOP_AUTH_FETCH_SOCKET',
    'CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET',
    'CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE',
    'CODEX_BROWSER_USE_NODE_PATH',
    'CODEX_NODE_REPL_PATH',
    'exec "$SCRIPT_DIR/Codex" --no-sandbox "$@"',
  ],
  forbiddenMarkers: [
    "http.server 5175",
    "--disable-http-cache",
    "npm i -g @openai/codex",
    "codex-cli-wrapper",
    "app-server proxy",
    "codex_clean_daemon_env",
    "CODEX_LINUX_REMOTE_CONTROL_DAEMON",
    "app-server daemon",
    "remote-control start",
  ],
};
