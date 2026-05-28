import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const upstreamRemoteControlConnectionsGate = new RegExp(
  String.raw`function (?<fn>${IDENTIFIER})\(\{remoteControlConnectionsState:(?<state>${IDENTIFIER}),slingshotEnabled:(?<slingshot>${IDENTIFIER})\}\)\{return \k<slingshot>&&\(\k<state>\?\.available\?\?!0\)&&\k<state>\?\.accessRequired!==!0\}`,
);

function replaceRemoteControlConnectionsGate(...args) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error("remote-control connections gate patch expected named regex groups");
  }
  const { fn, state, slingshot } = groups;
  return `function ${fn}({remoteControlConnectionsState:${state},slingshotEnabled:${slingshot}}){return!0}`;
}

const upstreamRemoteConnectionGate = new RegExp(
  String.raw`function (?<fn>${IDENTIFIER})\(\)\{let (?<cache>${IDENTIFIER})=\(0,(?<reactCache>${IDENTIFIER})\.c\)\(3\),\{data:(?<data>${IDENTIFIER})\}=(?<readQuery>${IDENTIFIER})\((?<queryClient>${IDENTIFIER}),(?<queryKey>${IDENTIFIER})\((?<queryArg>${IDENTIFIER})\)\),(?<statsigGate>${IDENTIFIER})=(?<readGate>${IDENTIFIER})\(\`4114442250\`\);if\(\k<data>\?\.config\[\`features\.remote_connections\`\]===!0\)return!0;let (?<features>${IDENTIFIER})=\k<data>\?\.config\.features;if\(typeof \k<features>!=\`object\`\|\|!\k<features>\|\|Array\.isArray\(\k<features>\)\)return \k<statsigGate>;let (?<value>${IDENTIFIER});return \k<cache>\[0\]!==\k<features>\|\|\k<cache>\[1\]!==\k<statsigGate>\?\(\k<value>=Object\.getOwnPropertyDescriptor\(\k<features>,\`remote_connections\`\)\?\.value===!0\|\|\k<statsigGate>,\k<cache>\[0\]=\k<features>,\k<cache>\[1\]=\k<statsigGate>,\k<cache>\[2\]=\k<value>\):\k<value>=\k<cache>\[2\],\k<value>\}`,
);

function replaceRemoteConnectionGate(...args) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error("remote connections feature gate patch expected named regex groups");
  }
  return `function ${groups.fn}(){return!0}`;
}

export const remoteControlVisibilityFeature = {
  id: "remote-control-visibility",
  version: 2,
  requiredMarkers: FEATURE_MARKERS["remote-control-visibility"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["remote-control-visibility"].forbiddenMarkers,
  apply(bundleSources, context) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    const sharesPluginInstallFlowBundle =
      context?.webviewRemoteControlConnectionsVisibilityPath === context?.webviewPluginAvailabilityPath;
    const remoteControlConnectionsVisibility = replaceOrThrow(
      bundleSources.webviewRemoteControlConnectionsVisibility,
      upstreamRemoteControlConnectionsGate,
      replaceRemoteControlConnectionsGate,
      "Linux remote-control connections visibility gate",
      {
        appliedMarkers: [
          /function [$A-Z_a-z][$\w]*\(\{remoteControlConnectionsState:[$A-Z_a-z][$\w]*,slingshotEnabled:[$A-Z_a-z][$\w]*\}\)\{return!0\}/,
        ],
      },
    );

    return {
      ...bundleSources,
      webviewPluginAvailability: sharesPluginInstallFlowBundle
        ? remoteControlConnectionsVisibility
        : bundleSources.webviewPluginAvailability,
      webviewRemoteControlConnectionsVisibility: remoteControlConnectionsVisibility,
      webviewRemoteConnectionVisibility: replaceOrThrow(
        bundleSources.webviewRemoteConnectionVisibility,
        upstreamRemoteConnectionGate,
        replaceRemoteConnectionGate,
        "Linux remote connections feature flag gate",
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewRemoteControlConnectionsVisibility,
      this.requiredMarkers.webviewRemoteControlConnectionsVisibility,
      "Linux remote-control connections visibility patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewRemoteControlConnectionsVisibility,
      this.forbiddenMarkers.webviewRemoteControlConnectionsVisibility,
      "Linux remote-control connections visibility patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewRemoteConnectionVisibility,
      this.requiredMarkers.webviewRemoteConnectionVisibility,
      "Linux remote connections feature flag patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewRemoteConnectionVisibility,
      this.forbiddenMarkers.webviewRemoteConnectionVisibility,
      "Linux remote connections feature flag patch",
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
