import { readFileSync, writeFileSync } from "node:fs";

function appliedMarkersForPatch(patch) {
  if (Array.isArray(patch.appliedMarkers)) {
    return patch.appliedMarkers;
  }
  if (patch.appliedMarker) {
    return [patch.appliedMarker];
  }
  if (typeof patch.replacement === "string") {
    return [patch.replacement];
  }
  return [];
}

function isPatchAlreadyApplied(source, patch) {
  const markers = appliedMarkersForPatch(patch);
  return markers.length > 0 && markers.every((marker) => source.includes(marker));
}

function replaceStringOnce(source, search, replacement, label, patch) {
  if (!source.includes(search)) {
    if (isPatchAlreadyApplied(source, patch)) {
      return source;
    }

    throw new Error(`Failed to patch ${label}: expected upstream anchor not found`);
  }

  return source.replace(search, replacement);
}

function countRegexMatches(source, regex) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  return [...source.matchAll(new RegExp(regex.source, flags))].length;
}

function replaceRegexOnce(source, regex, replacement, label, patch) {
  const matchCount = countRegexMatches(source, regex);

  if (matchCount === 0) {
    if (isPatchAlreadyApplied(source, patch)) {
      return source;
    }

    throw new Error(`Failed to patch ${label}: expected upstream anchor not found`);
  }

  if (matchCount > 1) {
    throw new Error(`Failed to patch ${label}: upstream anchor matched ${matchCount} times`);
  }

  return source.replace(regex, replacement);
}

export function replaceOnce(source, search, replacement, label) {
  return replaceStringOnce(source, search, replacement, label, { replacement });
}

export function applyPatch(source, patch, label) {
  if (typeof patch.apply === "function") {
    const updated = patch.apply(source, label);
    if (updated === source && !isPatchAlreadyApplied(source, patch)) {
      throw new Error(`Failed to patch ${label}: custom patch made no changes`);
    }
    return updated;
  }

  if (patch.searchRegex instanceof RegExp) {
    return replaceRegexOnce(source, patch.searchRegex, patch.replacement, label, patch);
  }

  if (typeof patch.search === "string") {
    return replaceStringOnce(source, patch.search, patch.replacement, label, patch);
  }

  throw new Error(`Failed to patch ${label}: patch has no supported locator`);
}

export function patchSource(source, patches, labelPrefix) {
  let patched = source;
  for (const patch of patches) {
    patched = applyPatch(patched, patch, `${labelPrefix} ${patch.label}`);
  }
  return patched;
}

export function patchFile(filePath, patches, labelPrefix) {
  const source = readFileSync(filePath, "utf8");
  writeFileSync(filePath, patchSource(source, patches, labelPrefix));
}
