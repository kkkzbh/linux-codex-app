import { FEATURE_MARKERS } from "../markers.mjs";
import {
  ensureMarkersAbsent,
  ensureMarkersPresent,
  replaceOrThrow,
} from "../replace-utils.mjs";

const upstreamSuggestedPromptsFeatureFlag =
  /\b([A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\(`2425897452`\)/;

const patchedSuggestedPromptsFeatureFlag = "$1=!0";

const patchedSuggestedPromptsFeatureFlagMarker = /\b[A-Za-z_$][\w$]*=!0/;

const upstreamAmbientSuggestionsEligiblePlans =
  /\b([A-Za-z_$][\w$]*)=\[`plus`,`pro`,`business`,`team`,`self_serve_business_usage_based`\]/;

const patchedAmbientSuggestionsEligiblePlans =
  "$1=[`plus`,`pro`,`prolite`,`business`,`team`,`self_serve_business_usage_based`]";

const patchedAmbientSuggestionsEligiblePlansMarker =
  /\b[A-Za-z_$][\w$]*=\[`plus`,`pro`,`prolite`,`business`,`team`,`self_serve_business_usage_based`\]/;

export const settingsSuggestedPromptsFeature = {
  id: "settings-suggested-prompts",
  version: 3,
  apply(bundleSources, context) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    let updatedSources = {
      ...bundleSources,
      webviewGeneralSettings: replaceOrThrow(
        bundleSources.webviewGeneralSettings,
        upstreamSuggestedPromptsFeatureFlag,
        patchedSuggestedPromptsFeatureFlag,
        "General settings Suggested prompts feature flag",
        { appliedMarker: patchedSuggestedPromptsFeatureFlagMarker },
      ),
    };

    const webviewAmbientSuggestionsEligibility = replaceOrThrow(
      updatedSources.webviewAmbientSuggestionsEligibility,
      upstreamAmbientSuggestionsEligiblePlans,
      patchedAmbientSuggestionsEligiblePlans,
      "ambient suggestions Pro Lite eligibility",
      { appliedMarker: patchedAmbientSuggestionsEligiblePlansMarker },
    );

    if (context?.syncSharedBundleSource) {
      updatedSources = context.syncSharedBundleSource(
        updatedSources,
        "webviewAmbientSuggestionsEligibility",
        webviewAmbientSuggestionsEligibility,
      );
    } else {
      updatedSources = {
        ...updatedSources,
        webviewAmbientSuggestionsEligibility,
      };
    }

    return updatedSources;
  },
  verify(bundleSources) {
    const markers = FEATURE_MARKERS["settings-suggested-prompts"];

    ensureMarkersPresent(
      bundleSources.webviewGeneralSettings,
      markers.requiredMarkers.webviewGeneralSettings,
      "Linux Suggested prompts settings patch",
    );
    ensureMarkersPresent(
      bundleSources.webviewAmbientSuggestionsEligibility,
      markers.requiredMarkers.webviewAmbientSuggestionsEligibility,
      "Linux Suggested prompts eligibility patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewGeneralSettings,
      markers.forbiddenMarkers.webviewGeneralSettings,
      "Linux Suggested prompts settings patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewAmbientSuggestionsEligibility,
      markers.forbiddenMarkers.webviewAmbientSuggestionsEligibility,
      "Linux Suggested prompts eligibility patch",
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
