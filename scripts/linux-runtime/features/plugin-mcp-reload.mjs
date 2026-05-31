import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const HELPER_ANCHOR = "var X=E();function Me(){";
const HELPER_REPLACEMENT =
  "var X=E();function codexLinuxPluginHasMcp(e){let t=e?.mcpServers??e?.summary?.mcpServers??e?.plugin?.mcpServers;return t==null?!0:Array.isArray(t)?t.length>0:!!t}function codexLinuxRestartAppServerForPluginMcp(e,t,n){codexLinuxPluginHasMcp(e)&&typeof n?.dispatchMessage==`function`&&n.dispatchMessage(`codex-app-server-restart`,{hostId:t})}function Me(){";

const INSTALL_AUTH_ANCHOR =
  "let _=await qe({authPolicy:h.authPolicy,codexHome:c,hostId:t,plugin:f,queryClient:a,windowType:`electron`});if(h.authPolicy===`ON_USE`";
const INSTALL_AUTH_REPLACEMENT =
  "let _=await qe({authPolicy:h.authPolicy,codexHome:c,hostId:t,plugin:f,queryClient:a,windowType:`electron`});codexLinuxRestartAppServerForPluginMcp(f,t,D);if(h.authPolicy===`ON_USE`";

export const pluginMcpReloadFeature = {
  id: "plugin-mcp-reload",
  version: 1,
  requiredMarkers: FEATURE_MARKERS["plugin-mcp-reload"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["plugin-mcp-reload"].forbiddenMarkers,
  apply(bundleSources, context) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let pluginAvailability = bundleSources.webviewPluginAvailability;
    const sharesPluginInstallFlowBundle =
      context?.webviewRemoteControlConnectionsVisibilityPath === context?.webviewPluginAvailabilityPath;

    pluginAvailability = replaceOrThrow(
      pluginAvailability,
      HELPER_ANCHOR,
      HELPER_REPLACEMENT,
      "plugin MCP reload helper",
      {
        appliedMarkers: [
          "function codexLinuxPluginHasMcp",
          "function codexLinuxRestartAppServerForPluginMcp",
        ],
      },
    );

    pluginAvailability = replaceOrThrow(
      pluginAvailability,
      INSTALL_AUTH_ANCHOR,
      INSTALL_AUTH_REPLACEMENT,
      "plugin MCP app-server restart after install",
      {
        appliedMarker: "codexLinuxRestartAppServerForPluginMcp(f,t,D)",
      },
    );

    return {
      ...bundleSources,
      webviewPluginAvailability: pluginAvailability,
      webviewRemoteControlConnectionsVisibility: sharesPluginInstallFlowBundle
        ? pluginAvailability
        : bundleSources.webviewRemoteControlConnectionsVisibility,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewPluginAvailability,
      this.requiredMarkers.webviewPluginAvailability,
      "Plugin MCP reload patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewPluginAvailability,
      this.forbiddenMarkers.webviewPluginAvailability,
      "Plugin MCP reload patch",
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
