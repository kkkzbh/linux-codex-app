import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { patchBrowserClient } from "./browser-client-patches.mjs";
import { patchFile } from "./patch-utils.mjs";

export const BROWSER_SKILL_GUIDANCE_PATCHES = [
  {
    label: "browser automation tool naming",
    apply(source) {
      return source
        .replaceAll("mcp__node_repl__js", "mcp__browser_automation__js")
        .replaceAll("nodeRepl.emitImage", "browserAutomation.emitImage")
        .replaceAll("node_repl", "browser_automation")
        .replaceAll("Node REPL", "browser_automation")
        .replaceAll("nodeRepl", "browserAutomation")
        .replaceAll(
          "Never mention `browser_automation`, `browser_automation`, `REPL`, JavaScript sessions, or module exports unless a user is asking for that exact information.",
          "Never mention MCP internals, JavaScript sessions, or module exports unless a user is asking for that exact information.",
        )
        .replaceAll(
          "Never mention `browser_automation`, `browser_automation`, `browser_automation`, JavaScript sessions, module exports, reading documentation, or loading instructions unless a user is asking for that exact information.",
          "Never mention MCP internals, JavaScript sessions, module exports, reading documentation, or loading instructions unless a user is asking for that exact information.",
        )
        .replaceAll(
          "Never mention `browser_automation`, `browser_automation`, `REPL`, JavaScript sessions, module exports, reading documentation, or loading instructions unless a user is asking for that exact information.",
          "Never mention MCP internals, JavaScript sessions, module exports, reading documentation, or loading instructions unless a user is asking for that exact information.",
        )
        .replaceAll("calls to the REPL", "browser_automation calls");
    },
    appliedMarkers: ["browser_automation", "browserAutomation"],
  },
];

export function patchBrowserSkill(skillPath) {
  patchFile(skillPath, BROWSER_SKILL_GUIDANCE_PATCHES, "Browser skill guidance");
}

export function patchBrowserManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (Array.isArray(manifest.keywords)) {
    manifest.keywords = manifest.keywords.map((keyword) =>
      keyword === "node-repl" ? "browser-automation" : keyword,
    );
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function patchBrowserPlugin(browserRoot) {
  patchBrowserManifest(path.join(browserRoot, ".codex-plugin", "plugin.json"));
  patchBrowserClient(path.join(browserRoot, "scripts", "browser-client.mjs"));
  patchBrowserSkill(path.join(browserRoot, "skills", "control-in-app-browser", "SKILL.md"));
}
