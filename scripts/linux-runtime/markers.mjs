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
  "directive-strip": {
    requiredMarkers: {
      webviewFollowUp: [
        /var [$A-Z_a-z][$\w]*=\/\^::\(\?:inbox-item\|archive-thread\|code-comment\|git-stage\|git-commit\|git-create-branch\|git-push\|git-create-pr\|pr-auto-fix-progress\)\(\?=\$\|\[\\s\\\[\{\]\)\.\*\$\/gm;/,
      ],
    },
    forbiddenMarkers: {
      webviewFollowUp: [
        /var [$A-Z_a-z][$\w]*=\/\^::\[a-zA-Z0-9-\]\+\.\*\$\/gm;/,
      ],
    },
  },
  "conversation-model-selector": {
    requiredMarkers: [
      /function [$A-Z_a-z][$\w]*\([$A-Z_a-z][$\w]*=null\)\{let .*?,[$A-Z_a-z][$\w]*=[$A-Z_a-z][$\w]*==null\?null:[$A-Z_a-z][$\w]*\.cwd,[$A-Z_a-z][$\w]*=[$A-Z_a-z][$\w]*\(\{hostId:[$A-Z_a-z][$\w]*,cwd:[$A-Z_a-z][$\w]*,isHostRegistered:[$A-Z_a-z][$\w]*\}\)/,
    ],
    forbiddenMarkers: [
      /function [$A-Z_a-z][$\w]*\([$A-Z_a-z][$\w]*=null\)\{let .*?,[$A-Z_a-z][$\w]*=[$A-Z_a-z][$\w]*\.cwd,[$A-Z_a-z][$\w]*=[$A-Z_a-z][$\w]*\(\{hostId:[$A-Z_a-z][$\w]*,cwd:[$A-Z_a-z][$\w]*,isHostRegistered:[$A-Z_a-z][$\w]*\}\)/,
    ],
  },
  "markdown-local-media": {
    requiredMarkers: {
      webviewMarkdown: [
        "function codexLinuxNormalizeMediaPath(e)",
        "function codexLinuxResolveMarkdownMediaPath(e,t)",
        "function codexLinuxNormalizeMarkdownRemoteMediaUrl(e)",
        "function codexLinuxMarkdownMimeType(e)",
        "{allowWide:n,alt:r,animateEnter:i,className:a,hostId:o,cwd:codexLinuxMarkdownCwd,mediaPresentation:s,rootRef:c,src:l,title:u}=e",
        "S=codexLinuxResolveMarkdownMediaPath(x,codexLinuxMarkdownCwd)",
        "A=codexLinuxNormalizeMarkdownRemoteMediaUrl(x)",
        "E=Ut(S??A??x)",
        "j=D?(O?ce(S):A):null",
        "I=j??(M&&ee!=null?qt({contentsBase64:ee,mimeType:P?.mimeType??null,path:S??x}):A??x)",
        "R=!D&&(O||A!=null)",
        "te=D&&C&&j==null",
        "params:{path:M?S??x:``,hostId:o}",
        "(0,Z.jsx)(en,{...e,animateEnter:t,cwd:r??null,hostId:a,mediaPresentation:o,rootRef:s})",
      ],
      webviewDiffAnnotations: [
        "function codexLinuxMarkdownPreviewDir(e)",
        "(0,Z.jsx)(_e,{enableMetadataPreview:!0,markdown:v,cwd:S})",
      ],
      webviewHtml: [
        "img-src &#39;self&#39; app: blob: data: http: https:;",
        "media-src &#39;self&#39; app: blob: data: http: https:;",
      ],
    },
    forbiddenMarkers: {
      webviewMarkdown: [
        "{allowWide:n,alt:r,animateEnter:i,className:a,hostId:o,mediaPresentation:s,rootRef:c,src:l,title:u}=e",
        "x=l??``,S=f(x),C=x.length>0,w=Gt(x),E;t[0]===x?E=t[1]:(E=Ut(x),t[0]=x,t[1]=E)",
        "k=w==null&&C&&!O&&Jt(x),j=O&&D?ce(S):null",
        "I=j??(M&&ee!=null?qt({contentsBase64:ee,mimeType:P?.mimeType??null,path:S??x}):x)",
        "R=O&&!D,te=O&&D&&j==null",
        "(0,Z.jsx)(en,{...e,animateEnter:t,hostId:a,mediaPresentation:o,rootRef:s})",
      ],
      webviewDiffAnnotations: [
        "(0,Z.jsx)(_e,{enableMetadataPreview:!0,markdown:v})",
      ],
      webviewHtml: [
        "img-src &#39;self&#39; app: blob: data: https:;",
        "media-src &#39;self&#39; app: blob: data:;",
      ],
    },
  },
  "conversation-local-images": {
    requiredMarkers: {
      webviewFollowUp: [
        "case`imageGeneration`:{let e=typeof n.src==`string`?n.src.trim():``;if(e.length===0)break;a.push({type:`generated-image`,id:n.id,src:e,status:n.status});break}",
        "case`imageView`:{let e=typeof n.path==`string`?Uy(n.path):null,r=e??(typeof n.path==`string`?n.path.trim():``);if(r.length===0)break;let i=e==null?r:`app://fs/@fs${encodeURI(e).replaceAll(`#`,`%23`).replaceAll(`?`,`%3F`)}?codexImageViewId=${encodeURIComponent(String(n.id??``))}`;a.push({type:`generated-image`,id:n.id,src:i,status:`completed`});break}",
        "case`imageView`:return typeof e.path==`string`&&Uy(e.path)!=null;",
      ],
      webviewUsePlugins: [
        "function C(e){if(typeof e!==`string`)return null;let n=e.trim();",
      ],
    },
    forbiddenMarkers: {
      webviewFollowUp: [
        "case`imageView`:{let e=Uy(n.path),r=e==null?null:Ey(e,`Image`);if(r==null)break;let i=t===f?l:null;if(p!=null){p.content=`${p.content}\\n${r}`,p.sentAtMs=i;break}p={type:`assistant-message`,content:r,sentAtMs:i,completed:!0,phase:null,renderPlaceholderWhileStreaming:!1,structuredOutput:void 0},a.push(p);break}",
        "case`imageView`:{let e=j_(n.path)??n.path.trim();if(e.length===0)break;a.push({type:`generated-image`,id:n.id,src:e,status:`completed`});break}",
        "case`imageView`:{let e=typeof n.path==`string`?Uy(n.path)??n.path.trim():``;if(e.length===0)break;a.push({type:`generated-image`,id:n.id,src:e,status:`completed`});break}",
        "case`imageGeneration`:a.push({type:`generated-image`,id:n.id,src:n.src,status:n.status});break;",
        "case`imageView`:return Uy(e.path)!=null;",
      ],
      webviewUsePlugins: [
        "function C(e){if(e==null)return null;let n=e.trim();",
      ],
    },
  },
  "local-image-cache-refresh": {
    requiredMarkers: {
      webviewMarkdown: [
        /queryConfig:\{enabled:[$A-Z_a-z][$\w]*,gcTime:1\/0,staleTime:0,refetchOnMount:`always`\}/,
      ],
      webviewUsePlugins: [
        /queryKey:[$A-Z_a-z][$\w]*\(`read-file-binary`,[$A-Z_a-z][$\w]*\),retry:!1,gcTime:1\/0,staleTime:0/,
      ],
    },
    forbiddenMarkers: {
      webviewMarkdown: [
        /queryConfig:\{enabled:[$A-Z_a-z][$\w]*,gcTime:1\/0,staleTime:1\/0\}/,
      ],
      webviewUsePlugins: [
        /queryKey:[$A-Z_a-z][$\w]*\(`read-file-binary`,[$A-Z_a-z][$\w]*\),retry:!1,gcTime:1\/0,staleTime:[$A-Z_a-z][$\w]*\.INFINITE/,
      ],
    },
  },
  preferences: {
    requiredMarkers: [
      /"set-preferred-app":async\(\{target:[$A-Z_a-z][$\w]*,cwd:codexLinuxPreferredTargetCwd\}\)=>\([$A-Z_a-z][$\w]*\(this\.getSettingsStore\(\),codexLinuxPreferredTargetCwd\?\?null,[$A-Z_a-z][$\w]*\),\{success:!0\}\)/,
    ],
    forbiddenMarkers: [],
  },
  "remote-control-device-key": {
    requiredMarkers: [
      "function codexLinuxDeviceKeyStorePaths",
      "function codexLinuxDeviceKeyStorePath",
      "function codexLinuxRemoteControlDeviceKeyBackend",
      "process.env.CODEX_HOME",
      "'.codex'",
      "'remote-control','device-keys','keys.json",
      "'.local','share'),'codex-app','device-keys','keys.json",
      "codexLinuxQuarantineDeviceKeyStore",
      "renameSync(o,i)",
      "createPrivateKey(r.privateKeyPem)",
      "generateKeyPairSync('ec',{namedCurve:'prime256v1'}",
      "protectionClass:'os_protected_nonextractable'",
      "algorithm:'ecdsa_p256_sha256'",
      "e.sign('sha256',n,i)",
      "process.platform==='linux'",
      "createDeviceKey:e=>n().createDeviceKey(e??`hardware_only`)",
    ],
    forbiddenMarkers: [
      "Remote control device keys are only available on macOS",
    ],
  },
  "remote-control-visibility": {
    requiredMarkers: {
      webviewRemoteControlConnectionsVisibility: [
        /function [$A-Z_a-z][$\w]*\(\{remoteControlConnectionsState:[$A-Z_a-z][$\w]*,slingshotEnabled:[$A-Z_a-z][$\w]*\}\)\{return!0\}/,
      ],
      webviewRemoteConnectionVisibility: [
        /function [$A-Z_a-z][$\w]*\(\)\{return!0\}/,
      ],
    },
    forbiddenMarkers: {
      webviewRemoteControlConnectionsVisibility: [
        "return t&&(e?.available??!0)&&e?.accessRequired!==!0",
      ],
      webviewRemoteConnectionVisibility: [
        "features.remote_connections",
        "c(`4114442250`)",
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
  "remote-control-backend": {
    requiredMarkers: [
      /[$A-Z_a-z][$\w]*===`linux`\?\{\.\.\.[$A-Z_a-z][$\w]*,control:!0/,
      "CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE",
      "browserPane:!0,inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0",
    ],
    forbiddenMarkers: [
      /[$A-Z_a-z][$\w]*===`linux`&&[$A-Z_a-z][$\w]*\.CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE===`1`\?\{\.\.\.[$A-Z_a-z][$\w]*,browserPane:!0,inAppBrowserUse:!0,inAppBrowserUseAllowed:!0,externalBrowserUse:!0,externalBrowserUseAllowed:!0\}/,
      /[$A-Z_a-z][$\w]*===`linux`\?\{\.\.\.[$A-Z_a-z][$\w]*,control:!0,deviceAttestation:!0/,
    ],
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
      "await Vm()",
      "await Gm(`allowed`,e.origin)",
      "await Km(e.transferKind,`allowed`,e.origin)",
      "sensitive_data===`browsing_history`",
      "file_transfer===`download`||t.file_transfer===`upload`",
      "createServer({allowHalfOpen:!0}",
      "Linux authenticated fetch URL is not allowlisted",
      "Linux browser approval request is not allowlisted",
      "prodApiBaseUrl:n.prodApiBaseUrl,hostId:I});o.startLinuxBrowserSecurityServers?.();let s=new",
    ],
    forbiddenMarkers: [
      "prodApiBaseUrl:n.prodApiBaseUrl}),s=new",
      "linux-browser-origin-approvals.json",
      "await Sp()",
      "await Ep(`allowed`,e.origin)",
      "await Dp(e.transferKind,`allowed`,e.origin)",
      "await tp(`allowed`,e.origin)",
      "await np(e.transferKind,`allowed`,e.origin)",
      "await Zf()",
      "await Qf(`allowed`,e.origin)",
      "await $f(e.transferKind,`allowed`,e.origin)",
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
      "n===`linux`?(0,i.join)(e,`.config`,`google-chrome`):null",
    ],
    forbiddenMarkers: [
      "function da({homeDir:e,localAppDataDir:t,platform:n}){return n===`darwin`?(0,i.join)(e,`Library`,`Application Support`,`Google`,`Chrome`):n===`win32`?(0,i.join)(t??(0,i.join)(e,`AppData`,`Local`),`Google`,`Chrome`,`User Data`):null}",
    ],
  },
  "plugin-mcp-reload": {
    requiredMarkers: {
      webviewPluginAvailability: [
        "function codexLinuxPluginHasMcp",
        "function codexLinuxRestartAppServerForPluginMcp",
        "codexLinuxRestartAppServerForPluginMcp(l,t,E)",
        "codex-app-server-restart",
      ],
    },
    forbiddenMarkers: {
      webviewPluginAvailability: [
        "let g=await We({authPolicy:f.authPolicy,hostId:t,plugin:l,queryClient:o,windowType:`electron`});if(f.authPolicy===`ON_USE`",
      ],
    },
  },
  "native-titlebar": {
    mainRequiredMarkers: [
      "codex_desktop:linux-titlebar-config",
      "codex_desktop:linux-titlebar-action",
      "linuxTitlebarConfigChannel",
      "linuxTitlebarActionChannel",
      "__codexCustomTitlebar",
      "frame:!1,hasShadow:!0",
    ],
    preloadRequiredMarkers: [
      "codex_desktop:linux-titlebar-config",
      "codex_desktop:linux-titlebar-action",
      "linuxTitlebarConfigChannel",
      "linuxTitlebarActionChannel",
      "codex-linux-drag-style",
      "data-codex-linux-drag-root",
      "codex-linux-window-controls",
      "codexLinuxIpcRenderer",
      "codexLinuxIpcRenderer.invoke(linuxTitlebarConfigChannel)",
      "codexLinuxIpcRenderer.invoke(linuxTitlebarActionChannel",
      "positionLinuxWindowControls",
      "isLinuxImagePreviewOpen",
      "syncLinuxWindowControlsVisibility",
      '[role="dialog"][aria-label="Image preview"]',
      '[data-testid="image-preview-dismiss-area"]',
      'data-codex-linux-image-preview-open',
      'aria-hidden","true',
      "inert",
      'padding-right","96px',
      'width:16px;height:16px',
      'button:hover',
      'button:active',
      '[["minimize","Minimize"],["maximize","Maximize"],["close","Close"]]',
    ],
    mainForbiddenMarkers: [],
    preloadForbiddenMarkers: [],
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
        "case`avatarOverlay`:return{...WY({alwaysOnTop:!0,hasShadow:!1,platform:n,resizable:!1,thickFrame:!1,transparent:!0}),backgroundColor:gY,hasShadow:!1,type:n===`linux`?`notification`:void 0};",
        "title:`Codex Pet Overlay`,width:mG.width,height:mG.height,appearance:`avatarOverlay`,focusable:!1,show:!1,initialRoute:MG",
        "zG={width:320,height:131}",
      ],
      webviewAvatarOverlay: [
        "codexLinuxEnsureAvatarOverlayTransparent",
        "codex-linux-avatar-overlay-transparent-style",
        "html,body,#root{background:transparent!important;background-color:transparent!important;}",
        "function pn(){codexLinuxEnsureAvatarOverlayTransparent();let e=(0,R.c)(9),",
        "nt=64",
        "he?`whitespace-pre-wrap`:x==null?`line-clamp-4`:void 0",
        "fn={mascot:{left:244,top:191,width:112,height:121},placement:`top-end`,tray:{left:36,top:56,width:320,height:131},viewport:{width:356,height:320}}",
      ],
    },
    forbiddenMarkers: {
      main: [
        "case`avatarOverlay`:return{...WY({alwaysOnTop:!0,platform:n,resizable:!1,thickFrame:!1}),hasShadow:!1};",
        "title:n.app.getName(),width:mG.width,height:mG.height,appearance:`avatarOverlay`,focusable:!1,show:!1,initialRoute:MG",
        "zG={width:276,height:131}",
      ],
      webviewAvatarOverlay: [
        "nt=32",
        "he?`whitespace-pre-wrap`:x==null?`line-clamp-2`:void 0",
        "fn={mascot:{left:244,top:191,width:112,height:121},placement:`top-end`,tray:{left:80,top:56,width:276,height:131},viewport:{width:356,height:320}}",
      ],
    },
  },
  "working-sessions-status": {
    requiredMarkers: [
      "codexLinuxWorkingSessionsStatusPath",
      "codexLinuxWriteWorkingSessionsStatus",
      "CODEX_WORKING_SESSIONS_STATUS_PATH",
      "working-sessions.json",
      /case`view-focused`:case`quit-app`:case`tray-menu-threads-changed`:codexLinuxWriteWorkingSessionsStatus\([$A-Z_a-z][$\w]*\);break;/,
      "codexLinuxWriteWorkingSessionsStatus({trayMenuThreads:{runningThreads:[]}},!1)",
    ],
    forbiddenMarkers: [],
  },
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
