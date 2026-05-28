import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const IDENTIFIER = String.raw`[$A-Z_a-z][$\w]*`;
const activeWorkspaceDefaultModelReadRegex = new RegExp(
  String.raw`function (?<fn>${IDENTIFIER})\((?<input>${IDENTIFIER})=null\)\{let (?<queryContext>${IDENTIFIER})=(?<useContext>${IDENTIFIER})\((?<contextToken>${IDENTIFIER})\),(?<queryClient>${IDENTIFIER})=\k<queryContext>\.queryClient,(?<conversationContext>${IDENTIFIER})=(?<readConversationContext>${IDENTIFIER})\(\k<input>\),(?<hostId>${IDENTIFIER})=\k<conversationContext>\.hostId,(?<isHostRegistered>${IDENTIFIER})=(?<readHostRegistration>${IDENTIFIER})\((?<hostRegistrationToken>${IDENTIFIER}),\k<hostId>\),(?<hostDetails>${IDENTIFIER})=(?<readHostDetails>${IDENTIFIER})\(\k<hostId>\),(?<someState>${IDENTIFIER})=(?<readSomeState>${IDENTIFIER})\(\),(?<cwd>${IDENTIFIER})=\k<conversationContext>\.cwd,(?<modelQuery>${IDENTIFIER})=(?<readModelQuery>${IDENTIFIER})\(\{hostId:\k<hostId>,cwd:\k<cwd>,isHostRegistered:\k<isHostRegistered>\}\)`,
);

function replaceDefaultModelCwd(...args) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error("conversation model selector patch expected named regex groups");
  }

  const {
    fn,
    input,
    queryContext,
    useContext,
    contextToken,
    queryClient,
    conversationContext,
    readConversationContext,
    hostId,
    isHostRegistered,
    readHostRegistration,
    hostRegistrationToken,
    hostDetails,
    readHostDetails,
    someState,
    readSomeState,
    cwd,
    modelQuery,
    readModelQuery,
  } = groups;

  return `function ${fn}(${input}=null){let ${queryContext}=${useContext}(${contextToken}),${queryClient}=${queryContext}.queryClient,${conversationContext}=${readConversationContext}(${input}),${hostId}=${conversationContext}.hostId,${isHostRegistered}=${readHostRegistration}(${hostRegistrationToken},${hostId}),${hostDetails}=${readHostDetails}(${hostId}),${someState}=${readSomeState}(),${cwd}=${input}==null?null:${conversationContext}.cwd,${modelQuery}=${readModelQuery}({hostId:${hostId},cwd:${cwd},isHostRegistered:${isHostRegistered}})`;
}

export const conversationModelSelectorFeature = {
  id: "conversation-model-selector",
  version: 4,
  requiredMarkers: FEATURE_MARKERS["conversation-model-selector"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["conversation-model-selector"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    return {
      ...bundleSources,
      webviewModelSettings: replaceOrThrow(
        bundleSources.webviewModelSettings,
        activeWorkspaceDefaultModelReadRegex,
        replaceDefaultModelCwd,
        "current upstream no-conversation collaboration model cwd",
        {
          appliedMarkers: [
            new RegExp(
              String.raw`function ${IDENTIFIER}\(${IDENTIFIER}=null\)\{let .*?,${IDENTIFIER}=${IDENTIFIER}==null\?null:${IDENTIFIER}\.cwd,${IDENTIFIER}=${IDENTIFIER}\(\{hostId:${IDENTIFIER},cwd:${IDENTIFIER},isHostRegistered:${IDENTIFIER}\}\)`,
            ),
          ],
        },
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewModelSettings,
      this.requiredMarkers,
      "conversation default model selector patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewModelSettings,
      this.forbiddenMarkers,
      "conversation default model selector patch",
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
