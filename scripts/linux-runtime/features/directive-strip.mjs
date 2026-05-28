import { FEATURE_MARKERS } from "../markers.mjs";
import { ensureMarkersAbsent, ensureMarkersPresent, replaceOrThrow } from "../replace-utils.mjs";

const directiveStripVarRegex = /var (?<directiveRegexVar>[$A-Z_a-z][$\w]*)=\/\^::\[a-zA-Z0-9-\]\+\.\*\$\/gm;/;

function replaceDirectiveStripRegex(...args) {
  const groups = args.at(-1);
  if (!groups || typeof groups !== "object") {
    throw new Error("directive strip patch expected named regex groups");
  }

  return `var ${groups.directiveRegexVar}=/^::(?:inbox-item|archive-thread|code-comment|git-stage|git-commit|git-create-branch|git-push|git-create-pr|pr-auto-fix-progress)(?=$|[\\s\\[{]).*$/gm;`;
}

export const directiveStripFeature = {
  id: "directive-strip",
  version: 2,
  requiredMarkers: FEATURE_MARKERS["directive-strip"].requiredMarkers,
  forbiddenMarkers: FEATURE_MARKERS["directive-strip"].forbiddenMarkers,
  apply(bundleSources) {
    if (this.isApplied(bundleSources)) {
      return bundleSources;
    }

    ensureMarkersPresent(
      bundleSources.webviewFollowUp,
      [directiveStripVarRegex],
      "current upstream directive strip regex",
    );

    return {
      ...bundleSources,
      webviewFollowUp: replaceOrThrow(
        bundleSources.webviewFollowUp,
        directiveStripVarRegex,
        replaceDirectiveStripRegex,
        "current upstream directive strip regex",
        {
          appliedMarkers: [
            "inbox-item|archive-thread|code-comment|git-stage|git-commit|git-create-branch|git-push|git-create-pr|pr-auto-fix-progress",
          ],
        },
      ),
    };
  },
  verify(bundleSources) {
    ensureMarkersPresent(
      bundleSources.webviewFollowUp,
      this.requiredMarkers.webviewFollowUp,
      "directive strip patch",
    );
    ensureMarkersAbsent(
      bundleSources.webviewFollowUp,
      this.forbiddenMarkers.webviewFollowUp,
      "directive strip patch",
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
