function summarizeMarker(marker) {
  if (marker instanceof RegExp) {
    return marker.toString();
  }

  if (marker.length <= 96) {
    return marker;
  }

  return `${marker.slice(0, 93)}...`;
}

function appliedMarkers(replacement, options) {
  if (Array.isArray(options?.appliedMarkers)) {
    return options.appliedMarkers;
  }
  if (options?.appliedMarker) {
    return [options.appliedMarker];
  }
  if (typeof replacement === "string") {
    return [replacement];
  }
  return [];
}

function isAlreadyApplied(source, replacement, options) {
  const markers = appliedMarkers(replacement, options);
  return markers.length > 0 && markers.every((marker) => matchesMarker(source, marker));
}

function countRegexMatches(source, regex) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  return [...source.matchAll(new RegExp(regex.source, flags))].length;
}

function matchesMarker(source, marker) {
  if (!(marker instanceof RegExp)) {
    return source.includes(marker);
  }

  return new RegExp(marker.source, marker.flags.replaceAll("g", "")).test(source);
}

export function replaceOrThrow(source, searchValue, replacement, description, options = {}) {
  if (searchValue instanceof RegExp) {
    const matchCount = countRegexMatches(source, searchValue);

    if (matchCount === 0) {
      if (isAlreadyApplied(source, replacement, options)) {
        return source;
      }

      throw new Error(`Failed to patch ${description}`);
    }

    if (matchCount > 1) {
      throw new Error(`Failed to patch ${description}: upstream anchor matched ${matchCount} times`);
    }

    return source.replace(searchValue, replacement);
  }

  const updated = source.replace(searchValue, replacement);

  if (updated === source) {
    if (isAlreadyApplied(source, replacement, options)) {
      return source;
    }

    throw new Error(`Failed to patch ${description}`);
  }

  return updated;
}

export function replaceAnyOrThrow(source, replacements, description) {
  for (const [searchValue, replacement] of replacements) {
    const updated = source.replace(searchValue, replacement);

    if (updated !== source) {
      return updated;
    }
  }

  throw new Error(`Failed to patch ${description}`);
}

export function ensureMarkersPresent(source, markers, description) {
  const missing = markers.filter((marker) => !matchesMarker(source, marker));

  if (missing.length > 0) {
    throw new Error(
      `${description} is missing required markers: ${missing.map(summarizeMarker).join(", ")}`,
    );
  }
}

export function ensureMarkersAbsent(source, markers, description) {
  const unexpected = markers.filter((marker) => matchesMarker(source, marker));

  if (unexpected.length > 0) {
    throw new Error(
      `${description} still contains forbidden markers: ${unexpected.map(summarizeMarker).join(", ")}`,
    );
  }
}
