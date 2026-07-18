const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createOnePasswordBrowserProvider,
} = require("./codex-linux-onepassword-browser-provider.cjs");

function writeFakeOp(binaryPath) {
  fs.writeFileSync(
    binaryPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_OP_LOG, JSON.stringify(args) + "\\n");
const output = (value) => process.stdout.write(JSON.stringify(value));
if (args[0] === "account" && args[1] === "list") {
  output([{ account_uuid: "account-1", email: "user@example.com", url: "example.1password.com" }]);
} else if (args[0] === "item" && args[1] === "list" && args.includes("--favorite")) {
  output([{ id: "github-favorite" }]);
} else if (args[0] === "item" && args[1] === "list") {
  output([
    { id: "github-secondary", vault: { id: "vault-1" }, urls: [{ href: "https://github.com/settings/profile" }] },
    { id: "github-favorite", vault: { id: "vault-1" }, urls: [{ href: "https://github.com/login" }] },
    { id: "ambiguous-a", vault: { id: "vault-1" }, urls: [{ href: "https://ambiguous.example/login" }] },
    { id: "ambiguous-b", vault: { id: "vault-1" }, urls: [{ href: "https://ambiguous.example/auth" }] },
    { id: "invalid-url", vault: { id: "vault-1" }, urls: [{ href: "ssh://example.com" }] }
  ]);
} else if (args[0] === "item" && args[1] === "get") {
  output({ fields: [
    { purpose: "USERNAME", value: "fixture-user" },
    { purpose: "PASSWORD", value: "fixture-password" }
  ] });
} else {
  process.exitCode = 2;
}
`,
    { mode: 0o755 },
  );
}

function writeUnavailableFakeOp(binaryPath) {
  fs.writeFileSync(binaryPath, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
}

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.url = "https://github.com/login";
    this.scripts = [];
    this.session = { getPartition: () => "persist:codex-browser-app-route:test" };
  }

  getURL() {
    return this.url;
  }

  isDestroyed() {
    return false;
  }

  isLoadingMainFrame() {
    return true;
  }

  async executeJavaScript(source) {
    this.scripts.push(source);
    if (source.includes("codexOnePasswordWaitForLoginForm")) return true;
    if (source.includes("codexOnePasswordFillLoginForm")) {
      return { filledPassword: true, filledUsername: true };
    }
    throw new Error("Unexpected injected script");
  }
}

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-onepassword-test-"));
  const previousFakeOpLog = process.env.FAKE_OP_LOG;
  try {
    const fakeOpPath = path.join(temporaryRoot, "op");
    const opLogPath = path.join(temporaryRoot, "op.log");
    const bindingStatePath = path.join(temporaryRoot, "user-data", "bindings.json");
    writeFakeOp(fakeOpPath);
    process.env.FAKE_OP_LOG = opLogPath;

    const app = new EventEmitter();
    app.getPath = () => path.join(temporaryRoot, "user-data");
    const electron = {
      app,
      webContents: { getAllWebContents: () => [] },
    };
    const provider = createOnePasswordBrowserProvider({
      electron,
      opPath: fakeOpPath,
      bindingStatePath,
      autoStart: false,
    });

    assert.deepEqual(await provider.listProfiles(), [
      {
        source: "onepassword",
        appName: "1Password",
        profileName: "user@example.com",
        profileDirectoryName: "account-1",
        profilePath: "onepassword://account/account-1",
        rootPath: fakeOpPath,
        hasCookies: false,
        hasPasswords: true,
        userName: "user@example.com",
      },
    ]);
    assert.deepEqual(await provider.importProfile("onepassword://account/account-1"), {
      status: "success",
      discovered: 5,
      canonicalized: 4,
      imported: 4,
      skippedInvalid: 1,
      failed: 0,
    });

    const stateSource = fs.readFileSync(bindingStatePath, "utf8");
    assert.equal(stateSource.includes("fixture-user"), false);
    assert.equal(stateSource.includes("fixture-password"), false);
    assert.equal(stateSource.includes("user@example.com"), false);
    assert.equal(fs.statSync(bindingStatePath).mode & 0o777, 0o600);
    assert.equal(provider.bindingForOrigin("https://github.com").itemId, "github-favorite");
    assert.equal(provider.bindingForOrigin("https://ambiguous.example"), null);

    const contents = new FakeWebContents();
    assert.equal(await provider.autofill(contents), true);
    assert.equal(await provider.autofill(contents), true);
    assert.equal(
      contents.scripts.filter((source) => source.includes("codexOnePasswordFillLoginForm")).length,
      2,
    );
    assert.equal(contents.scripts.some((source) => source.includes("fixture-user")), true);
    assert.equal(contents.scripts.some((source) => source.includes("fixture-password")), true);

    const invocations = fs
      .readFileSync(opLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      invocations.filter((args) => args[0] === "item" && args[1] === "list").map((args) =>
        args.includes("--favorite") ? "favorites" : "all",
      ),
      ["all", "favorites"],
    );
    assert.equal(
      invocations.filter((args) => args[0] === "item" && args[1] === "get").length,
      1,
    );

    provider.start();
    const createdContents = new FakeWebContents();
    app.emit("web-contents-created", {}, createdContents);
    assert.equal(createdContents.listenerCount("dom-ready"), 1);
    assert.equal(createdContents.listenerCount("did-navigate-in-page"), 1);
    provider.dispose();
    assert.equal(provider.credentialPromises.size, 0);

    const unavailableProvider = createOnePasswordBrowserProvider({
      electron,
      opPath: null,
      bindingStatePath: path.join(temporaryRoot, "unavailable-bindings.json"),
      autoStart: false,
    });
    assert.deepEqual(await unavailableProvider.listProfiles(), []);

    const disconnectedOpPath = path.join(temporaryRoot, "disconnected-op");
    writeUnavailableFakeOp(disconnectedOpPath);
    const disconnectedProvider = createOnePasswordBrowserProvider({
      electron,
      opPath: disconnectedOpPath,
      bindingStatePath: path.join(temporaryRoot, "disconnected-bindings.json"),
      autoStart: false,
    });
    assert.deepEqual(await disconnectedProvider.listProfiles(), []);
  } finally {
    if (previousFakeOpLog == null) delete process.env.FAKE_OP_LOG;
    else process.env.FAKE_OP_LOG = previousFakeOpLog;
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

main()
  .then(() => console.log("Linux 1Password browser provider tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
