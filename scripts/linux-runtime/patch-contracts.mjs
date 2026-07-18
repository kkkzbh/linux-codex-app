const PRIVATE_BUNDLE = "private-bundle";

export const LINUX_PATCH_CONTRACTS = {
  "open-targets": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact registry anchors plus post-patch markers",
    risk: "high",
    reason: "The upstream open-target registry is private bundle state and has no stable external extension point.",
  },
  "generated-output-artifacts": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact local-conversation artifact extraction anchors",
    risk: "high",
    reason: "Generated image output artifact extraction is private webview conversation state.",
  },
  "multi-window-second-instance": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact second-instance window handler anchor",
    risk: "medium",
    reason: "KRunner multi-window behavior is controlled by private Electron second-instance routing.",
  },
  "native-titlebar": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact main IPC anchors plus preload bootstrap injection",
    risk: "high",
    reason: "Linux frameless-window behavior needs coordinated main/preload/webview changes.",
  },
  "settings-sidebar-surface": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact settings sidebar class anchor",
    risk: "medium",
    reason: "The standalone settings route sidebar is compiled into a private webview settings page chunk.",
  },
  "settings-suggested-prompts": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream exact General settings feature-flag and ambient eligibility anchors",
    risk: "medium",
    reason: "Suggested prompts settings visibility and Pro Lite eligibility are private webview state.",
  },
  "browser-chrome": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "aggregate Browser/Chrome subpatch directory",
    risk: "high",
    reason: "Browser Use and Chrome support spans private Electron feature gates, native-pipe registration, security mediation, Chrome profile probes, and plugin setup UI.",
  },
  "computer-use-provider": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream Computer Use provider selector anchor",
    risk: "medium",
    reason: "The Computer Use settings page selects its provider from private plugin marketplace state.",
  },
  "computer-use-availability": {
    placement: PRIVATE_BUNDLE,
    locatorStrategy: "retained current-upstream Computer Use settings availability gate anchors",
    risk: "medium",
    reason: "The Computer Use settings page hides the Any App provider behind private platform and statsig gates.",
  },
};

export function getLinuxPatchContract(feature) {
  return LINUX_PATCH_CONTRACTS[feature.id] ?? null;
}

export function describeLinuxPatchFeature(feature) {
  const contract = getLinuxPatchContract(feature);
  if (!contract) {
    throw new Error(`Missing Linux patch contract for feature: ${feature.id}`);
  }

  return {
    id: feature.id,
    version: feature.version,
    ...contract,
  };
}

export function assertLinuxPatchContracts(features) {
  const missing = features.filter((feature) => !getLinuxPatchContract(feature)).map((feature) => feature.id);
  if (missing.length > 0) {
    throw new Error(`Missing Linux patch contracts: ${missing.join(", ")}`);
  }
}
