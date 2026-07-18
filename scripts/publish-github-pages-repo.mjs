#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

function usage() {
  return `Usage: publish-github-pages-repo.mjs --rpm-dir <dir> --pages-dir <dir> --release-tag <tag> --repository <owner/name> --pages-base-url <url> --fedora-release <release> --public-key-file <path> --gpg-key-id <key-id> [--arch x86_64]`;
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];

    if (!key.startsWith("--")) {
      fail(`Unexpected argument: ${key}`);
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      fail(`Missing value for ${key}`);
    }

    args.set(key.slice(2), value);
    index += 1;
  }

  return {
    rpmDir: args.get("rpm-dir"),
    pagesDir: args.get("pages-dir"),
    releaseTag: args.get("release-tag"),
    repository: args.get("repository"),
    pagesBaseUrl: args.get("pages-base-url"),
    fedoraRelease: args.get("fedora-release"),
    publicKeyFile: args.get("public-key-file"),
    gpgKeyId: args.get("gpg-key-id"),
    arch: args.get("arch") ?? "x86_64",
  };
}

function requireCommand(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
  } catch {
    fail(`Missing required command: ${command}`);
  }
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function readJson(filePath, defaultValue) {
  if (!existsSync(filePath)) {
    return defaultValue;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

function rpmFilesIn(dir) {
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".rpm"))
    .sort();
}

function releaseAssetUrl(repository, releaseTag, fileName) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(fileName)}`;
}

function copyOrDownloadPackage(entry, sourceDir, targetDir) {
  const sourcePath = path.join(sourceDir, entry.fileName);
  const targetPath = path.join(targetDir, entry.fileName);

  if (existsSync(sourcePath)) {
    copyFileSync(sourcePath, targetPath);
  } else {
    execFileSync(
      "curl",
      [
        "-L",
        "--fail",
        "--show-error",
        "--retry",
        "4",
        "--retry-all-errors",
        "--retry-delay",
        "2",
        "--connect-timeout",
        "30",
        "--max-time",
        "900",
        "--output",
        targetPath,
        entry.downloadUrl,
      ],
      {
        stdio: "inherit",
      },
    );
  }

  const actualSha = sha256(targetPath);

  if (actualSha !== entry.sha256) {
    fail(`RPM sha256 mismatch for ${entry.fileName}: expected ${entry.sha256}, got ${actualSha}`);
  }
}

function findRepomdLocation(repomd, type) {
  const match = repomd.match(
    new RegExp(`<data type="${type}">[\\s\\S]*?<location href="([^"]+)"[\\s\\S]*?</data>`),
  );

  if (!match) {
    fail(`Could not find ${type} location in repomd.xml`);
  }

  return match[1];
}

function updateRepomdData(repomd, type, compressedPath, openBytes, timestamp) {
  const compressedBytes = readFileSync(compressedPath);
  const compressedSha = createHash("sha256").update(compressedBytes).digest("hex");
  const openSha = createHash("sha256").update(openBytes).digest("hex");
  const compressedSize = compressedBytes.length;
  const openSize = openBytes.length;

  return repomd.replace(new RegExp(`(<data type="${type}">)([\\s\\S]*?)(</data>)`), (_match, start, body, end) => {
    const updatedBody = body
      .replace(/<checksum type="sha256">[^<]+<\/checksum>/, `<checksum type="sha256">${compressedSha}</checksum>`)
      .replace(
        /<open-checksum type="sha256">[^<]+<\/open-checksum>/,
        `<open-checksum type="sha256">${openSha}</open-checksum>`,
      )
      .replace(/<timestamp>[^<]+<\/timestamp>/, `<timestamp>${timestamp}</timestamp>`)
      .replace(/<size>[^<]+<\/size>/, `<size>${compressedSize}</size>`)
      .replace(/<open-size>[^<]+<\/open-size>/, `<open-size>${openSize}</open-size>`);

    return `${start}${updatedBody}${end}`;
  });
}

function signRepomd(repomdPath, gpgKeyId) {
  const passphrase = process.env.RPM_SIGNING_PASSPHRASE;

  if (!passphrase) {
    execFileSync(
      "gpg",
      ["--batch", "--yes", "--local-user", gpgKeyId, "--armor", "--detach-sign", repomdPath],
      { stdio: "inherit" },
    );
    return;
  }

  execFileSync(
    "gpg",
    [
      "--batch",
      "--yes",
      "--pinentry-mode",
      "loopback",
      "--passphrase-fd",
      "0",
      "--local-user",
      gpgKeyId,
      "--armor",
      "--detach-sign",
      repomdPath,
    ],
    {
      input: passphrase,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
}

function writeRepoFile(pagesDir, pagesBaseUrl) {
  writeFileSync(
    path.join(pagesDir, "linux-codex-app.repo"),
    `[linux-codex-app]
name=Linux Codex App
baseurl=${pagesBaseUrl.replace(/\/$/, "")}/rpm/fedora/$releasever/$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=${pagesBaseUrl.replace(/\/$/, "")}/RPM-GPG-KEY-linux-codex-app
`,
  );
}

function writeIndex(pagesDir, pagesBaseUrl, fedoraRelease, arch, packages) {
  const rows = packages
    .map(
      (entry) =>
        `<li><a href="${xmlEscape(entry.downloadUrl)}">${xmlEscape(entry.fileName)}</a> <code>${xmlEscape(entry.releaseTag)}</code></li>`,
    )
    .join("\n");

  writeFileSync(
    path.join(pagesDir, "index.html"),
    `<!doctype html>
<meta charset="utf-8">
<title>linux-codex-app RPM repository</title>
<h1>linux-codex-app RPM repository</h1>
<p>Fedora repository file: <a href="${xmlEscape(`${pagesBaseUrl.replace(/\/$/, "")}/linux-codex-app.repo`)}">linux-codex-app.repo</a></p>
<p>DNF baseurl: <code>${xmlEscape(`${pagesBaseUrl.replace(/\/$/, "")}/rpm/fedora/${fedoraRelease}/${arch}`)}</code></p>
<ul>
${rows}
</ul>
`,
  );
}

function main() {
  const { rpmDir, pagesDir, releaseTag, repository, pagesBaseUrl, fedoraRelease, publicKeyFile, gpgKeyId, arch } =
    parseArgs(process.argv.slice(2));

  if (!rpmDir || !pagesDir || !releaseTag || !repository || !pagesBaseUrl || !fedoraRelease || !publicKeyFile || !gpgKeyId) {
    fail(usage());
  }

  requireCommand("curl");
  requireCommand("createrepo_c");
  requireCommand("gpg");

  const rpmDirAbs = path.resolve(rpmDir);
  const pagesDirAbs = path.resolve(pagesDir);
  const publicKeyPath = path.resolve(publicKeyFile);
  const repoDir = path.join(pagesDirAbs, "rpm", "fedora", fedoraRelease, arch);
  const packagesPath = path.join(repoDir, "packages.json");
  const existing = readJson(packagesPath, { version: 1, packages: [] });

  if (!existsSync(publicKeyPath)) {
    fail(`Public signing key not found: ${publicKeyPath}`);
  }

  if (!Array.isArray(existing.packages)) {
    fail(`Invalid packages manifest: ${packagesPath}`);
  }

  const packagesByName = new Map(existing.packages.map((entry) => [entry.fileName, entry]));

  for (const fileName of rpmFilesIn(rpmDirAbs)) {
    const rpmPath = path.join(rpmDirAbs, fileName);

    packagesByName.set(fileName, {
      fileName,
      releaseTag,
      downloadUrl: releaseAssetUrl(repository, releaseTag, fileName),
      sha256: sha256(rpmPath),
    });
  }

  const packages = [...packagesByName.values()].sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  );

  if (packages.length === 0) {
    fail("No RPM packages found to publish");
  }

  const workRoot = path.join(path.dirname(pagesDirAbs), "rpm-repo-work");
  mkdirSync(workRoot, { recursive: true });
  const workDir = mkdtempSync(path.join(workRoot, "linux-codex-app-repo-"));
  const rpmWorkDir = path.join(workDir, "rpms");
  mkdirSync(rpmWorkDir, { recursive: true });

  try {
    for (const entry of packages) {
      copyOrDownloadPackage(entry, rpmDirAbs, rpmWorkDir);
    }

    execFileSync("createrepo_c", ["--no-database", "--simple-md-filenames", "--general-compress-type", "gz", rpmWorkDir], {
      stdio: "inherit",
    });

    const repodataDir = path.join(rpmWorkDir, "repodata");
    const repomdPath = path.join(repodataDir, "repomd.xml");
    let repomd = readFileSync(repomdPath, "utf8");
    const primaryHref = findRepomdLocation(repomd, "primary");
    const primaryPath = path.join(rpmWorkDir, primaryHref);
    const packageUrlsByName = new Map(packages.map((entry) => [entry.fileName, entry.downloadUrl]));
    const primaryXml = gunzipSync(readFileSync(primaryPath)).toString("utf8");
    const rewrittenPrimaryXml = primaryXml.replace(/<location href="([^"]+)"/g, (match, href) => {
      const fileName = path.basename(href);
      const downloadUrl = packageUrlsByName.get(fileName);

      if (!downloadUrl) {
        fail(`No release asset URL for package referenced by repo metadata: ${href}`);
      }

      return `<location href="${xmlEscape(downloadUrl)}"`;
    });
    const rewrittenPrimaryBytes = Buffer.from(rewrittenPrimaryXml);
    writeFileSync(primaryPath, gzipSync(rewrittenPrimaryBytes));

    repomd = updateRepomdData(
      repomd,
      "primary",
      primaryPath,
      rewrittenPrimaryBytes,
      Math.floor(Date.now() / 1000),
    );
    writeFileSync(repomdPath, repomd);
    signRepomd(repomdPath, gpgKeyId);

    mkdirSync(repoDir, { recursive: true });
    rmSync(path.join(repoDir, "repodata"), { recursive: true, force: true });
    cpSync(repodataDir, path.join(repoDir, "repodata"), { recursive: true });

    writeFileSync(
      packagesPath,
      `${JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          fedoraRelease,
          arch,
          packages,
        },
        null,
        2,
      )}\n`,
    );

    copyFileSync(publicKeyPath, path.join(pagesDirAbs, "RPM-GPG-KEY-linux-codex-app"));
    writeRepoFile(pagesDirAbs, pagesBaseUrl);
    writeIndex(pagesDirAbs, pagesBaseUrl, fedoraRelease, arch, packages);
    writeFileSync(path.join(pagesDirAbs, ".nojekyll"), "");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();
