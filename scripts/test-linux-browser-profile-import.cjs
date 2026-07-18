const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const {
  cookieDetails,
  createLinuxBrowserProfileImporter,
  IMPORTED_SESSION_COOKIE_RETENTION_SECONDS,
  listChromeProfiles,
  stageProfile,
  stopChromeProcess,
} = require("./linux-browser-profile-import.cjs");

async function main() {
  const nowSeconds = 1_700_000_000;
  const hostOnlyCookie = cookieDetails({
    domain: "example.com",
    name: "__Host-session",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  }, nowSeconds);
  assert.deepEqual(hostOnlyCookie, {
    url: "https://example.com/",
    name: "__Host-session",
    value: "",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    expirationDate: nowSeconds + IMPORTED_SESSION_COOKIE_RETENTION_SECONDS,
  });
  assert.equal(Object.hasOwn(hostOnlyCookie, "domain"), false);

  const domainCookie = cookieDetails({
    domain: ".example.com",
    name: "session",
    path: "/account",
    value: "opaque",
    expires: 1_800_000_000,
  }, nowSeconds);
  assert.equal(domainCookie.domain, ".example.com");
  assert.equal(domainCookie.url, "http://example.com/account");
  assert.equal(domainCookie.expirationDate, 1_800_000_000);
  assert.equal(cookieDetails({ domain: "", name: "session" }), null);
  assert.equal(
    cookieDetails({
      domain: "example.com",
      name: "",
      path: "/",
      value: "nameless-cookie-value",
    }),
    null,
  );

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-browser-profile-test-"));
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const previousPath = process.env.PATH;
  let sourceCookieDatabase = null;

  try {
    const binaryDirectory = path.join(temporaryRoot, "bin");
    const chromeRoot = path.join(temporaryRoot, "config", "google-chrome");
    const profilePath = path.join(chromeRoot, "Default");
    fs.mkdirSync(path.join(profilePath, "Network"), { recursive: true });
    fs.mkdirSync(binaryDirectory, { recursive: true });
    fs.writeFileSync(path.join(binaryDirectory, "google-chrome"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    sourceCookieDatabase = new DatabaseSync(path.join(profilePath, "Network", "Cookies"));
    sourceCookieDatabase.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE cookies (name TEXT); INSERT INTO cookies VALUES ('session');",
    );
    fs.writeFileSync(
      path.join(chromeRoot, "Local State"),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: {
              gaia_name: "Example User",
              name: "Person 1",
              user_name: "user@example.com",
            },
          },
        },
      }),
    );

    process.env.XDG_CONFIG_HOME = path.join(temporaryRoot, "config");
    process.env.PATH = `${binaryDirectory}${path.delimiter}${previousPath ?? ""}`;

    const chromeProfiles = listChromeProfiles();
    assert.equal(chromeProfiles.length, 1);
    assert.deepEqual(chromeProfiles[0], {
      source: "chrome",
      appName: "Google Chrome",
      profileName: "Person 1",
      profileDirectoryName: "Default",
      profilePath,
      rootPath: chromeRoot,
      hasCookies: true,
      hasPasswords: false,
      gaiaName: "Example User",
      userName: "user@example.com",
    });

    const stagedProfileRoot = path.join(temporaryRoot, "staged-profile");
    await stageProfile(chromeProfiles[0], stagedProfileRoot);
    const stagedCookiePath = path.join(stagedProfileRoot, "Default", "Network", "Cookies");
    assert.equal(fs.existsSync(`${stagedCookiePath}-wal`), false);
    assert.equal(fs.existsSync(`${stagedCookiePath}-shm`), false);
    const stagedCookieDatabase = new DatabaseSync(stagedCookiePath, { readOnly: true });
    try {
      assert.equal(
        stagedCookieDatabase.prepare("SELECT count(*) AS count FROM cookies").get().count,
        1,
      );
    } finally {
      stagedCookieDatabase.close();
    }
    const shutdownMarker = path.join(temporaryRoot, "chrome-shutdown-complete");
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
          const fs = require("node:fs");
          process.on("SIGTERM", () => {
            setTimeout(() => {
              fs.writeFileSync(${JSON.stringify(shutdownMarker)}, "complete\\n");
              process.exit(0);
            }, 100);
          });
          process.stdout.write("ready\\n");
          setInterval(() => {}, 1000);
        `,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`shutdown fixture exited early (${code})`)));
    });
    await stopChromeProcess(child);
    assert.equal(child.exitCode, 0);
    assert.equal(fs.readFileSync(shutdownMarker, "utf8"), "complete\n");

    const onePasswordProfile = {
      source: "onepassword",
      appName: "1Password",
      profileName: "user@example.com",
      profileDirectoryName: "account-id",
      profilePath: "onepassword://account/account-id",
      rootPath: "/usr/bin/op",
      hasCookies: false,
      hasPasswords: true,
      userName: "user@example.com",
    };
    const onePasswordStats = {
      status: "success",
      discovered: 3,
      canonicalized: 2,
      imported: 2,
      skippedInvalid: 1,
      failed: 0,
    };
    const importedOnePasswordPaths = [];
    const importer = createLinuxBrowserProfileImporter({
      electron: { session: { fromPartition: () => ({ cookies: { set: async () => {} } }) } },
      onePasswordProvider: {
        listProfiles: async () => [onePasswordProfile],
        importProfile: async (selectedProfilePath) => {
          importedOnePasswordPaths.push(selectedProfilePath);
          return onePasswordStats;
        },
      },
    });
    assert.deepEqual(await importer.listImportableProfiles(), [
      ...chromeProfiles,
      onePasswordProfile,
    ]);

    const importerWithoutOnePassword = createLinuxBrowserProfileImporter({
      electron: { session: { fromPartition: () => ({ cookies: { set: async () => {} } }) } },
      onePasswordProvider: {
        listProfiles: async () => [],
        importProfile: async () => {
          throw new Error("1Password is unavailable");
        },
      },
    });
    assert.deepEqual(await importerWithoutOnePassword.listImportableProfiles(), chromeProfiles);
    assert.deepEqual(
      await importer.importProfile({
        source: "onepassword",
        profilePath: onePasswordProfile.profilePath,
        importCookies: true,
        importPasswords: true,
        targetPartition: "persist:test",
      }),
      {
        source: "onepassword",
        profilePath: onePasswordProfile.profilePath,
        passwords: onePasswordStats,
      },
    );
    assert.deepEqual(importedOnePasswordPaths, [onePasswordProfile.profilePath]);
    await assert.rejects(
      importer.importProfile({
        source: "onepassword",
        profilePath: onePasswordProfile.profilePath,
        importCookies: false,
        importPasswords: false,
        targetPartition: "persist:test",
      }),
      /Select passwords to import/,
    );
    await assert.rejects(
      importer.importProfile({
        source: "chrome",
        profilePath,
        importCookies: true,
        importPasswords: true,
        targetPartition: "persist:test",
      }),
      /supports cookies only/,
    );
  } finally {
    sourceCookieDatabase?.close();
    if (previousConfigHome == null) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    if (previousPath == null) delete process.env.PATH;
    else process.env.PATH = previousPath;
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

main()
  .then(() => console.log("Linux browser profile importer tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
