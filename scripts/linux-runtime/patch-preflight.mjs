import {
  linuxPatchFeatures,
  verifyLinuxPatchSource,
} from "./features/index.mjs";
import { describeLinuxPatchFeature } from "./patch-contracts.mjs";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function cloneBundleSources(bundleSources) {
  return { ...bundleSources };
}

export function probeLinuxRuntimePatches(initialBundleSources, context) {
  let workingSources = cloneBundleSources(initialBundleSources);
  const results = [];

  for (const feature of linuxPatchFeatures) {
    const description = describeLinuxPatchFeature(feature);

    try {
      if (typeof feature.isApplied === "function" && feature.isApplied(workingSources)) {
        results.push({
          ...description,
          status: "already-applied",
        });
        continue;
      }

      const patchedSources = feature.apply(cloneBundleSources(workingSources), context);
      feature.verify(patchedSources, context);
      workingSources = patchedSources;
      results.push({
        ...description,
        status: "patchable",
      });
    } catch (error) {
      results.push({
        ...description,
        status: "failed",
        error: errorMessage(error),
      });
    }
  }

  let finalVerification = { ok: true };
  try {
    verifyLinuxPatchSource(workingSources, context);
  } catch (error) {
    finalVerification = {
      ok: false,
      error: errorMessage(error),
    };
  }

  return {
    ok: results.every((result) => result.status !== "failed") && finalVerification.ok,
    results,
    finalVerification,
  };
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

export function formatLinuxPatchProbeReport(report) {
  const rows = report.results.map((result) => [
    result.id,
    `v${result.version}`,
    result.risk,
    result.locatorStrategy,
    result.status,
  ]);
  const widths = ["patch", "ver", "risk", "locator", "status"].map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const lines = [
    ["patch", "ver", "risk", "locator", "status"]
      .map((value, index) => pad(value, widths[index]))
      .join("  "),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map((row) => row.map((value, index) => pad(value, widths[index])).join("  ")),
  ];

  for (const result of report.results) {
    if (result.error) {
      lines.push(`FAILED ${result.id}: ${result.error}`);
    }
  }

  if (!report.finalVerification.ok) {
    lines.push(`FINAL VERIFY FAILED: ${report.finalVerification.error}`);
  }

  return lines.join("\n");
}
