import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const upstreamMarkdownLocalImageQueryConfig = new RegExp(
  String.raw`queryConfig:\{enabled:(?<enabled>${IDENTIFIER}),gcTime:1\/0,staleTime:1\/0\}`,
);

const upstreamSharedLocalImageQueryConfig = new RegExp(
  String.raw`queryKey:(?<queryKeyFn>${IDENTIFIER})\(\`read-file-binary\`,(?<path>${IDENTIFIER})\),retry:!1,gcTime:1\/0,staleTime:(?<infiniteToken>${IDENTIFIER})\.INFINITE`,
);

function groupsFor(args, description) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error(`${description} expected named regex groups`);
  }
  return groups;
}

function replaceMarkdownLocalImageQueryConfig(...args) {
  const { enabled } = groupsFor(args, "markdown local image cache patch");
  return `queryConfig:{enabled:${enabled},gcTime:1/0,staleTime:0,refetchOnMount:\`always\`}`;
}

function replaceSharedLocalImageQueryConfig(...args) {
  const { queryKeyFn, path } = groupsFor(args, "shared local image cache patch");
  return `queryKey:${queryKeyFn}(\`read-file-binary\`,${path}),retry:!1,gcTime:1/0,staleTime:0`;
}

export const localImageCacheRefreshFeature = {
  id: "local-image-cache-refresh",
  version: 3,
  requiredMarkers: FEATURE_MARKERS["local-image-cache-refresh"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["local-image-cache-refresh"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let markdownSource = bundleSources.webviewMarkdown;
    let usePluginsSource = bundleSources.webviewUsePlugins;

    ensureMarkersPresent(
      markdownSource,
      [upstreamMarkdownLocalImageQueryConfig],
      "current upstream markdown local image cache query",
    );
    ensureMarkersPresent(
      usePluginsSource,
      [upstreamSharedLocalImageQueryConfig],
      "current upstream shared local image cache query",
    );

    markdownSource = replaceOrThrow(
      markdownSource,
      upstreamMarkdownLocalImageQueryConfig,
      replaceMarkdownLocalImageQueryConfig,
      "current upstream markdown local image cache query",
      {
        appliedMarkers: ["staleTime:0,refetchOnMount:`always`"],
      },
    );
    usePluginsSource = replaceOrThrow(
      usePluginsSource,
      upstreamSharedLocalImageQueryConfig,
      replaceSharedLocalImageQueryConfig,
      "current upstream shared local image cache query",
      {
        appliedMarkers: [new RegExp(String.raw`queryKey:${IDENTIFIER}\(\`read-file-binary\`,${IDENTIFIER}\),retry:!1,gcTime:1\/0,staleTime:0`)],
      },
    );

    return {
      ...bundleSources,
      webviewMarkdown: markdownSource,
      webviewUsePlugins: usePluginsSource,
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewMarkdown,
      this.requiredMarkers.webviewMarkdown,
      "markdown local image cache refresh patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewMarkdown,
      this.forbiddenMarkers.webviewMarkdown,
      "markdown local image cache refresh patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewUsePlugins,
      this.requiredMarkers.webviewUsePlugins,
      "shared local image cache refresh patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewUsePlugins,
      this.forbiddenMarkers.webviewUsePlugins,
      "shared local image cache refresh patch",
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
