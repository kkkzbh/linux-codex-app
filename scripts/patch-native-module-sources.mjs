#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(message);
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}

function replaceExact(filePath, upstream, patched, label) {
  const source = readText(filePath);

  if (!source.includes(upstream)) {
    fail(`Expected current upstream native source anchor not found for ${label}: ${filePath}`);
  }

  writeFileSync(filePath, source.replace(upstream, patched));
}

function main() {
  const buildDir = process.argv[2];
  if (!buildDir) {
    fail("Usage: patch-native-module-sources.mjs <native-build-dir>");
  }

  const betterSqliteRoot = path.join(buildDir, "node_modules", "better-sqlite3");
  const betterSqlitePackage = JSON.parse(readText(path.join(betterSqliteRoot, "package.json")));

  if (betterSqlitePackage.version !== "12.9.0") {
    fail(`Expected current upstream better-sqlite3@12.9.0, got ${betterSqlitePackage.version}`);
  }

  replaceExact(
    path.join(betterSqliteRoot, "src", "better_sqlite3.cpp"),
    "v8::Local<v8::External> data = v8::External::New(isolate, addon);",
    "v8::Local<v8::External> data = v8::External::New(isolate, addon, v8::kExternalPointerTypeTagDefault);",
    "better-sqlite3 External::New tag",
  );

  replaceExact(
    path.join(betterSqliteRoot, "src", "util", "macros.cpp"),
    "#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value())",
    "#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value(v8::kExternalPointerTypeTagDefault))",
    "better-sqlite3 External::Value tag",
  );

  replaceExact(
    path.join(betterSqliteRoot, "src", "util", "helpers.cpp"),
    [
      "\trecv->InstanceTemplate()->SetNativeDataProperty(",
      "\t\tInternalizedFromLatin1(isolate, name),",
      "\t\tfunc,",
      "\t\t0,",
      "\t\tdata",
      "\t);",
    ].join("\n"),
    [
      "\trecv->InstanceTemplate()->SetNativeDataProperty(",
      "\t\tInternalizedFromLatin1(isolate, name),",
      "\t\tfunc,",
      "\t\tnullptr,",
      "\t\tdata",
      "\t);",
    ].join("\n"),
    "better-sqlite3 native data property setter",
  );

  console.error("[INFO] Patched better-sqlite3 native sources for Electron 42 V8 API");
}

main();
