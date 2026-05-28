import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, cp, lstat, mkdir, readdir, readlink, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_MAX_ENTRIES = 200;
const MAX_LIST_ENTRIES = 2_000;
const DEFAULT_MAX_RESULTS = 100;
const MAX_SEARCH_RESULTS = 1_000;
const MAX_SEARCH_SCAN = 25_000;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DOLPHIN_A11Y_SCRIPT = path.join(scriptDir, "dolphin-a11y.py");

export const DOLPHIN_TOOLS = [
  {
    name: "dolphin_open_path",
    title: "Open Path in Dolphin",
    description: "Open an existing file or folder in KDE Dolphin.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or folder path to open. Relative paths are resolved from the MCP server cwd." },
        mode: {
          type: "string",
          enum: ["default", "new_window", "split"],
          description: "How Dolphin should open the target.",
          default: "default",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_reveal_path",
    title: "Reveal Path in Dolphin",
    description: "Open Dolphin and select an existing file or folder.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Existing file or folder path to reveal." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_list_directory",
    title: "List Directory",
    description: "List a directory with file-manager style metadata.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list.", default: "." },
        include_hidden: { type: "boolean", description: "Include dotfiles.", default: false },
        recursive: { type: "boolean", description: "Descend into child directories.", default: false },
        max_entries: { type: "integer", minimum: 1, maximum: MAX_LIST_ENTRIES, default: DEFAULT_MAX_ENTRIES },
      },
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_list_windows",
    title: "List Dolphin Windows",
    description: "List accessible Dolphin windows with current folders and selected paths when available.",
    inputSchema: {
      type: "object",
      properties: {
        include_selection: {
          type: "boolean",
          description: "Include selected paths detected through AT-SPI.",
          default: true,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_get_selection",
    title: "Get Dolphin Selection",
    description: "Read selected files/folders from an accessible Dolphin window.",
    inputSchema: {
      type: "object",
      properties: {
        window_id: {
          type: "string",
          description: "Window id from dolphin_list_windows. If omitted, the focused Dolphin window is used when unambiguous.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_list_window_directory",
    title: "List Dolphin Window Directory",
    description: "List the directory currently open in an accessible Dolphin window.",
    inputSchema: {
      type: "object",
      properties: {
        window_id: {
          type: "string",
          description: "Window id from dolphin_list_windows. If omitted, the focused Dolphin window is used when unambiguous.",
        },
        include_hidden: { type: "boolean", description: "Include dotfiles.", default: false },
        recursive: { type: "boolean", description: "Descend into child directories.", default: false },
        max_entries: { type: "integer", minimum: 1, maximum: MAX_LIST_ENTRIES, default: DEFAULT_MAX_ENTRIES },
      },
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_operate_on_selection",
    title: "Operate on Dolphin Selection",
    description: "Continue from an accessible Dolphin window selection by copying, moving, trashing, revealing, showing properties, or copying selected paths.",
    inputSchema: {
      type: "object",
      properties: {
        window_id: {
          type: "string",
          description: "Window id from dolphin_list_windows. If omitted, the focused Dolphin window is used when unambiguous.",
        },
        operation: {
          type: "string",
          enum: ["copy_to", "move_to", "trash", "copy_paths_to_clipboard", "show_properties", "reveal_first", "list"],
          description: "Operation to perform on the current selected paths.",
        },
        destination: {
          type: "string",
          description: "Destination directory for copy_to or move_to.",
        },
        overwrite: {
          type: "boolean",
          description: "Replace existing destination paths for copy_to or move_to.",
          default: false,
        },
        clipboard_format: {
          type: "string",
          enum: ["paths", "uris"],
          description: "Clipboard representation for copy_paths_to_clipboard.",
          default: "paths",
        },
      },
      required: ["operation"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_open_window_context",
    title: "Open Dolphin Window Context",
    description: "Open the current folder from an accessible Dolphin window, optionally selecting its current selection.",
    inputSchema: {
      type: "object",
      properties: {
        window_id: {
          type: "string",
          description: "Window id from dolphin_list_windows. If omitted, the focused Dolphin window is used when unambiguous.",
        },
        mode: {
          type: "string",
          enum: ["folder", "selection"],
          description: "Open the current folder or reveal the first selected path.",
          default: "folder",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_search",
    title: "Search Directory",
    description: "Search below a directory by filename substring.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to search.", default: "." },
        query: { type: "string", description: "Case-insensitive filename substring to match." },
        include_hidden: { type: "boolean", description: "Include dotfiles.", default: false },
        max_results: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS, default: DEFAULT_MAX_RESULTS },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_create_folder",
    title: "Create Folder",
    description: "Create a folder, optionally creating parents.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path to create." },
        parents: { type: "boolean", description: "Create missing parents.", default: true },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_rename_path",
    title: "Rename Path",
    description: "Rename a file or folder inside its current parent directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Existing file or folder path." },
        new_name: { type: "string", description: "New basename. Must not contain path separators." },
        overwrite: { type: "boolean", description: "Replace an existing destination.", default: false },
      },
      required: ["path", "new_name"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_copy_path",
    title: "Copy Path",
    description: "Copy a file or folder to a destination path.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Existing source file or folder." },
        destination: { type: "string", description: "Destination path." },
        overwrite: { type: "boolean", description: "Replace an existing destination.", default: false },
      },
      required: ["source", "destination"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_move_path",
    title: "Move Path",
    description: "Move a file or folder to a destination path.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Existing source file or folder." },
        destination: { type: "string", description: "Destination path." },
        overwrite: { type: "boolean", description: "Replace an existing destination.", default: false },
      },
      required: ["source", "destination"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_move_to_trash",
    title: "Move to Trash",
    description: "Move an existing file or folder to the desktop trash via gio or kioclient.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Existing file or folder to trash." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_copy_paths_to_clipboard",
    title: "Copy Paths to Clipboard",
    description: "Copy local paths or file URIs to the desktop clipboard.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Existing paths to copy.",
        },
        format: {
          type: "string",
          enum: ["paths", "uris"],
          description: "Clipboard representation.",
          default: "paths",
        },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_show_properties",
    title: "Show Properties",
    description: "Open the desktop properties dialog for one or more paths through Freedesktop FileManager1.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Existing paths whose properties dialog should open.",
        },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
  {
    name: "dolphin_open_terminal",
    title: "Open Terminal Here",
    description: "Open a terminal with its working directory set to a folder.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Existing folder, or a file whose parent folder should be used.", default: "." },
      },
      additionalProperties: false,
    },
  },
];

export function createDolphinController(deps = {}) {
  const context = {
    env: deps.env ?? process.env,
    cwd: deps.cwd ?? process.cwd(),
    homedir: deps.homedir ?? os.homedir(),
    runDetached: deps.runDetached ?? runDetached,
    runBuffered: deps.runBuffered ?? runBuffered,
    runWithInput: deps.runWithInput ?? runWithInput,
    queryA11y: deps.queryA11y ?? queryA11y,
  };

  return {
    tools: DOLPHIN_TOOLS,
    async callTool(name, args = {}) {
      switch (name) {
        case "dolphin_open_path":
          return await openPath(context, args);
        case "dolphin_reveal_path":
          return await revealPath(context, args);
        case "dolphin_list_directory":
          return await listDirectory(context, args);
        case "dolphin_list_windows":
          return await listWindows(context, args);
        case "dolphin_get_selection":
          return await getSelection(context, args);
        case "dolphin_list_window_directory":
          return await listWindowDirectory(context, args);
        case "dolphin_operate_on_selection":
          return await operateOnSelection(context, args);
        case "dolphin_open_window_context":
          return await openWindowContext(context, args);
        case "dolphin_search":
          return await searchDirectory(context, args);
        case "dolphin_create_folder":
          return await createFolder(context, args);
        case "dolphin_rename_path":
          return await renamePath(context, args);
        case "dolphin_copy_path":
          return await copyPath(context, args);
        case "dolphin_move_path":
          return await movePath(context, args);
        case "dolphin_move_to_trash":
          return await moveToTrash(context, args);
        case "dolphin_copy_paths_to_clipboard":
          return await copyPathsToClipboard(context, args);
        case "dolphin_show_properties":
          return await showProperties(context, args);
        case "dolphin_open_terminal":
          return await openTerminal(context, args);
        default:
          throw new Error(`Unknown Dolphin tool: ${name}`);
      }
    },
  };
}

async function openPath(context, args) {
  const targetPath = resolvePath(args.path, context);
  await requireExistingPath(targetPath);

  const command = context.env.CODEX_DOLPHIN_BIN || "dolphin";
  const mode = args.mode ?? "default";
  const commandArgs = buildDolphinOpenArgs(mode, targetPath);
  const launch = await context.runDetached(command, commandArgs, { env: dolphinLaunchEnv(context) });
  return { ok: true, action: "open_path", path: targetPath, mode, command, args: commandArgs, ...launch };
}

async function revealPath(context, args) {
  const targetPath = resolvePath(args.path, context);
  await requireExistingPath(targetPath);

  const command = context.env.CODEX_DOLPHIN_BIN || "dolphin";
  const commandArgs = ["--select", targetPath];
  const launch = await context.runDetached(command, commandArgs, { env: dolphinLaunchEnv(context) });
  return { ok: true, action: "reveal_path", path: targetPath, command, args: commandArgs, ...launch };
}

async function listDirectory(context, args) {
  const root = resolvePath(args.path ?? ".", context);
  const stat = await requireExistingPath(root);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${root}`);
  }

  const includeHidden = Boolean(args.include_hidden);
  const recursive = Boolean(args.recursive);
  const maxEntries = clampInteger(args.max_entries, DEFAULT_MAX_ENTRIES, 1, MAX_LIST_ENTRIES);
  const entries = [];
  let truncated = false;

  async function collect(dirPath) {
    if (entries.length >= maxEntries) {
      truncated = true;
      return;
    }

    const children = sortDirents(await readdir(dirPath, { withFileTypes: true }));
    for (const child of children) {
      if (!includeHidden && child.name.startsWith(".")) {
        continue;
      }
      const childPath = path.join(dirPath, child.name);
      const childEntry = await describePath(root, childPath, child);
      entries.push(childEntry);
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      if (recursive && child.isDirectory()) {
        await collect(childPath);
        if (truncated) {
          return;
        }
      }
    }
  }

  await collect(root);
  return { ok: true, path: root, recursive, include_hidden: includeHidden, entries, truncated };
}

async function listWindows(context, args) {
  const snapshot = await context.queryA11y(context);
  const includeSelection = args.include_selection !== false;
  const windows = snapshot.windows.map((window) =>
    includeSelection
      ? window
      : {
          ...window,
          selected_paths: undefined,
          selected_items: undefined,
          selected_count: undefined,
        },
  );
  return {
    ok: true,
    backend: snapshot.backend,
    windows,
    warnings: snapshot.warnings ?? [],
    setup_hint: snapshot.setup_hint,
  };
}

async function getSelection(context, args) {
  const window = await resolveDolphinWindow(context, args.window_id);
  return {
    ok: true,
    window,
    selected_paths: window.selected_paths,
    selected_items: window.selected_items,
    selected_count: window.selected_paths.length,
  };
}

async function listWindowDirectory(context, args) {
  const window = await resolveDolphinWindow(context, args.window_id);
  if (!window.current_directory) {
    throw new Error(`Dolphin window does not expose an absolute current directory: ${window.title}`);
  }
  const listed = await listDirectory(context, {
    path: window.current_directory,
    include_hidden: args.include_hidden,
    recursive: args.recursive,
    max_entries: args.max_entries,
  });
  return { ...listed, window };
}

async function operateOnSelection(context, args) {
  const window = await resolveDolphinWindow(context, args.window_id);
  const selection = window.selected_paths ?? [];
  if (selection.length === 0) {
    throw new Error(`Dolphin window has no selected paths: ${window.title}`);
  }

  const operation = requireNonEmptyString(args.operation, "operation");
  switch (operation) {
    case "list":
      return { ok: true, action: "selection_list", window, selected_paths: selection };
    case "copy_to":
      return await copySelectionToDirectory(context, window, selection, args);
    case "move_to":
      return await moveSelectionToDirectory(context, window, selection, args);
    case "trash":
      return await trashSelection(context, window, selection);
    case "copy_paths_to_clipboard": {
      const result = await copyPathsToClipboard(context, {
        paths: selection,
        format: args.clipboard_format ?? "paths",
      });
      return { ...result, action: "selection_copy_paths_to_clipboard", window };
    }
    case "show_properties": {
      const result = await showProperties(context, { paths: selection });
      return { ...result, action: "selection_show_properties", window };
    }
    case "reveal_first": {
      const result = await revealPath(context, { path: selection[0] });
      return { ...result, action: "selection_reveal_first", window };
    }
    default:
      throw new Error(`Unsupported selection operation: ${operation}`);
  }
}

async function openWindowContext(context, args) {
  const window = await resolveDolphinWindow(context, args.window_id);
  const mode = args.mode ?? "folder";
  if (mode === "selection") {
    if (!window.selected_paths || window.selected_paths.length === 0) {
      throw new Error(`Dolphin window has no selected paths: ${window.title}`);
    }
    const result = await revealPath(context, { path: window.selected_paths[0] });
    return { ...result, action: "open_window_selection", window };
  }
  if (mode !== "folder") {
    throw new Error(`Unsupported Dolphin window context mode: ${mode}`);
  }
  if (!window.current_directory) {
    throw new Error(`Dolphin window does not expose an absolute current directory: ${window.title}`);
  }
  const result = await openPath(context, { path: window.current_directory });
  return { ...result, action: "open_window_folder", window };
}

async function searchDirectory(context, args) {
  const root = resolvePath(args.path ?? ".", context);
  const stat = await requireExistingPath(root);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${root}`);
  }

  const query = requireNonEmptyString(args.query, "query").toLowerCase();
  const includeHidden = Boolean(args.include_hidden);
  const maxResults = clampInteger(args.max_results, DEFAULT_MAX_RESULTS, 1, MAX_SEARCH_RESULTS);
  const results = [];
  let scanned = 0;
  let truncated = false;

  async function walk(dirPath) {
    if (results.length >= maxResults || scanned >= MAX_SEARCH_SCAN) {
      truncated = true;
      return;
    }

    const children = sortDirents(await readdir(dirPath, { withFileTypes: true }));
    for (const child of children) {
      if (!includeHidden && child.name.startsWith(".")) {
        continue;
      }
      scanned += 1;
      const childPath = path.join(dirPath, child.name);
      if (child.name.toLowerCase().includes(query)) {
        results.push(await describePath(root, childPath, child));
        if (results.length >= maxResults) {
          truncated = true;
          return;
        }
      }
      if (child.isDirectory()) {
        await walk(childPath);
        if (truncated) {
          return;
        }
      }
      if (scanned >= MAX_SEARCH_SCAN) {
        truncated = true;
        return;
      }
    }
  }

  await walk(root);
  return { ok: true, path: root, query: args.query, include_hidden: includeHidden, scanned, results, truncated };
}

async function createFolder(context, args) {
  const targetPath = resolvePath(args.path, context);
  const parents = args.parents !== false;
  const existed = await pathExists(targetPath);
  if (existed) {
    const stat = await lstat(targetPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path exists and is not a directory: ${targetPath}`);
    }
    return { ok: true, action: "create_folder", path: targetPath, created: false, existed: true };
  }

  await mkdir(targetPath, { recursive: parents });
  return { ok: true, action: "create_folder", path: targetPath, created: true, existed: false };
}

async function renamePath(context, args) {
  const source = resolvePath(args.path, context);
  await requireExistingPath(source);
  const newName = requireBasename(args.new_name, "new_name");
  const destination = path.join(path.dirname(source), newName);
  const overwrite = Boolean(args.overwrite);

  await ensureDestinationAvailable(destination, overwrite);
  await rename(source, destination);
  return { ok: true, action: "rename_path", source, destination, overwrite };
}

async function copyPath(context, args) {
  const source = resolvePath(args.source, context);
  await requireExistingPath(source);
  const destination = resolvePath(args.destination, context);
  const overwrite = Boolean(args.overwrite);

  await ensureDestinationAvailable(destination, overwrite);
  await requireParentDirectory(destination);
  await cp(source, destination, {
    recursive: true,
    force: overwrite,
    errorOnExist: !overwrite,
    preserveTimestamps: true,
  });
  return { ok: true, action: "copy_path", source, destination, overwrite };
}

async function movePath(context, args) {
  const source = resolvePath(args.source, context);
  await requireExistingPath(source);
  const destination = resolvePath(args.destination, context);
  const overwrite = Boolean(args.overwrite);

  await ensureDestinationAvailable(destination, overwrite);
  await requireParentDirectory(destination);
  try {
    await rename(source, destination);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }
    await cp(source, destination, { recursive: true, preserveTimestamps: true });
    await rm(source, { recursive: true, force: true });
  }
  return { ok: true, action: "move_path", source, destination, overwrite };
}

async function moveToTrash(context, args) {
  const targetPath = resolvePath(args.path, context);
  await requireExistingPath(targetPath);

  const command = context.env.CODEX_DOLPHIN_TRASH_BIN || "gio";
  const commandArgs = buildTrashArgs(command, targetPath);
  const result = await context.runBuffered(command, commandArgs, { timeoutMs: 30_000 });
  return {
    ok: true,
    action: "move_to_trash",
    path: targetPath,
    command,
    args: commandArgs,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function copyPathsToClipboard(context, args) {
  const paths = await resolveExistingPathList(args.paths, context);
  const format = args.format ?? "paths";
  if (!["paths", "uris"].includes(format)) {
    throw new Error(`Unsupported clipboard format: ${format}`);
  }

  const content =
    format === "uris"
      ? `${paths.map((item) => pathToFileURL(item).href).join("\n")}\n`
      : `${paths.join("\n")}\n`;
  const mimeType = format === "uris" ? "text/uri-list" : "text/plain";
  const command = context.env.CODEX_DOLPHIN_CLIPBOARD_BIN || (context.env.WAYLAND_DISPLAY ? "wl-copy" : "xclip");
  const commandArgs = buildClipboardArgs(command, mimeType);
  await context.runWithInput(command, commandArgs, content, { timeoutMs: 10_000 });
  return { ok: true, action: "copy_paths_to_clipboard", paths, format, mimeType, command, args: commandArgs };
}

async function showProperties(context, args) {
  const paths = await resolveExistingPathList(args.paths, context);
  const uris = paths.map((item) => pathToFileURL(item).href);
  const command = context.env.CODEX_DOLPHIN_DBUS_SEND_BIN || "dbus-send";
  const commandArgs = buildShowPropertiesArgs(uris);
  const launch = await context.runDetached(command, commandArgs);
  return { ok: true, action: "show_properties", paths, uris, command, args: commandArgs, ...launch };
}

async function openTerminal(context, args) {
  const targetPath = resolvePath(args.path ?? ".", context);
  const stat = await requireExistingPath(targetPath);
  const workingDirectory = stat.isDirectory() ? targetPath : path.dirname(targetPath);
  const command = context.env.CODEX_DOLPHIN_TERMINAL_BIN || "konsole";
  const commandArgs = buildTerminalArgs(command, workingDirectory);
  const launch = await context.runDetached(command, commandArgs, { cwd: workingDirectory });
  return { ok: true, action: "open_terminal", path: targetPath, working_directory: workingDirectory, command, args: commandArgs, ...launch };
}

async function copySelectionToDirectory(context, window, selection, args) {
  const destinationDirectory = resolvePath(args.destination, context);
  const destinationStat = await requireExistingPath(destinationDirectory);
  if (!destinationStat.isDirectory()) {
    throw new Error(`Destination is not a directory: ${destinationDirectory}`);
  }

  const overwrite = Boolean(args.overwrite);
  const results = [];
  for (const source of selection) {
    const destination = path.join(destinationDirectory, path.basename(source));
    results.push(await copyPath(context, { source, destination, overwrite }));
  }
  return { ok: true, action: "selection_copy_to", window, destination_directory: destinationDirectory, results };
}

async function moveSelectionToDirectory(context, window, selection, args) {
  const destinationDirectory = resolvePath(args.destination, context);
  const destinationStat = await requireExistingPath(destinationDirectory);
  if (!destinationStat.isDirectory()) {
    throw new Error(`Destination is not a directory: ${destinationDirectory}`);
  }

  const overwrite = Boolean(args.overwrite);
  const results = [];
  for (const source of selection) {
    const destination = path.join(destinationDirectory, path.basename(source));
    results.push(await movePath(context, { source, destination, overwrite }));
  }
  return { ok: true, action: "selection_move_to", window, destination_directory: destinationDirectory, results };
}

async function trashSelection(context, window, selection) {
  const results = [];
  for (const targetPath of selection) {
    results.push(await moveToTrash(context, { path: targetPath }));
  }
  return { ok: true, action: "selection_trash", window, results };
}

async function resolveDolphinWindow(context, windowId) {
  const snapshot = await context.queryA11y(context);
  const windows = snapshot.windows ?? [];
  if (windows.length === 0) {
    const hint = snapshot.setup_hint ? ` ${snapshot.setup_hint}` : "";
    throw new Error(`No accessible Dolphin windows found.${hint}`);
  }

  if (windowId != null) {
    const window = windows.find((candidate) => candidate.window_id === windowId);
    if (window == null) {
      throw new Error(`Dolphin window not found: ${windowId}`);
    }
    return window;
  }

  const focused = windows.filter((window) => window.focused || window.active);
  if (focused.length === 1) {
    return focused[0];
  }
  if (windows.length === 1) {
    return windows[0];
  }

  throw new Error(`Multiple Dolphin windows are accessible; call dolphin_list_windows and pass window_id.`);
}

async function queryA11y(context) {
  const command = context.env.CODEX_DOLPHIN_A11Y_PYTHON || "python3";
  const result = await context.runBuffered(command, [DOLPHIN_A11Y_SCRIPT], {
    timeoutMs: 10_000,
    env: context.env,
  });
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Could not parse Dolphin accessibility snapshot: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function dolphinLaunchEnv(context) {
  return {
    ...context.env,
    QT_LINUX_ACCESSIBILITY_ALWAYS_ON: context.env.QT_LINUX_ACCESSIBILITY_ALWAYS_ON || "1",
  };
}

function buildDolphinOpenArgs(mode, targetPath) {
  switch (mode) {
    case "default":
      return [targetPath];
    case "new_window":
      return ["--new-window", targetPath];
    case "split":
      return ["--split", targetPath];
    default:
      throw new Error(`Unsupported Dolphin open mode: ${mode}`);
  }
}

function buildTrashArgs(command, targetPath) {
  const name = path.basename(command);
  if (name.startsWith("kioclient")) {
    return ["move", targetPath, "trash:/"];
  }
  return ["trash", targetPath];
}

function buildClipboardArgs(command, mimeType) {
  const name = path.basename(command);
  if (name === "xclip") {
    return ["-selection", "clipboard", "-t", mimeType];
  }
  if (name === "xsel") {
    return ["--clipboard", "--input"];
  }
  return ["--type", mimeType];
}

function buildShowPropertiesArgs(uris) {
  return [
    "--session",
    "--dest=org.freedesktop.FileManager1",
    "--type=method_call",
    "/org/freedesktop/FileManager1",
    "org.freedesktop.FileManager1.ShowItemProperties",
    `array:string:${uris.join(",")}`,
    "string:",
  ];
}

function buildTerminalArgs(command, workingDirectory) {
  const name = path.basename(command);
  if (name === "konsole") {
    return ["--workdir", workingDirectory];
  }
  if (name === "kgx" || name === "gnome-terminal") {
    return ["--working-directory", workingDirectory];
  }
  return [];
}

async function describePath(root, targetPath, dirent = null) {
  const stat = await lstat(targetPath);
  const type = classifyPath(stat, dirent);
  const entry = {
    name: path.basename(targetPath),
    path: targetPath,
    relative_path: path.relative(root, targetPath) || ".",
    type,
    size: stat.size,
    mtime_ms: stat.mtimeMs,
    mode: stat.mode,
  };

  if (type === "symlink") {
    try {
      entry.symlink_target = await readlink(targetPath);
    } catch {
      entry.symlink_target = null;
    }
  }

  return entry;
}

function classifyPath(stat, dirent = null) {
  if (stat.isSymbolicLink() || dirent?.isSymbolicLink()) {
    return "symlink";
  }
  if (stat.isDirectory()) {
    return "directory";
  }
  if (stat.isFile()) {
    return "file";
  }
  return "other";
}

function sortDirents(entries) {
  return entries.sort((a, b) => {
    const typeDelta = Number(b.isDirectory()) - Number(a.isDirectory());
    if (typeDelta !== 0) {
      return typeDelta;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function resolvePath(rawPath, context) {
  const value = requireNonEmptyString(rawPath, "path");
  if (value.includes("\0")) {
    throw new Error("Path must not contain null bytes");
  }

  let normalized = value;
  if (normalized.startsWith("file://")) {
    normalized = fileURLToPath(normalized);
  } else if (normalized === "~") {
    normalized = context.homedir;
  } else if (normalized.startsWith("~/")) {
    normalized = path.join(context.homedir, normalized.slice(2));
  }

  return path.resolve(context.cwd, normalized);
}

async function resolveExistingPathList(rawPaths, context) {
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
    throw new Error("paths must be a non-empty array");
  }
  if (rawPaths.length > 64) {
    throw new Error("paths must contain at most 64 entries");
  }

  const paths = [];
  for (const rawPath of rawPaths) {
    const targetPath = resolvePath(rawPath, context);
    await requireExistingPath(targetPath);
    paths.push(targetPath);
  }
  return paths;
}

async function requireExistingPath(targetPath) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Path does not exist: ${targetPath}`);
    }
    throw error;
  }
}

async function requireParentDirectory(targetPath) {
  const parent = path.dirname(targetPath);
  const stat = await requireExistingPath(parent);
  if (!stat.isDirectory()) {
    throw new Error(`Destination parent is not a directory: ${parent}`);
  }
}

async function ensureDestinationAvailable(destination, overwrite) {
  if (!(await pathExists(destination))) {
    return;
  }
  if (!overwrite) {
    throw new Error(`Destination already exists: ${destination}`);
  }
  await rm(destination, { recursive: true, force: true });
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function requireBasename(value, fieldName) {
  const name = requireNonEmptyString(value, fieldName);
  if (name.includes("\0") || name.includes("/") || name === "." || name === "..") {
    throw new Error(`${fieldName} must be a simple basename`);
  }
  return name;
}

function clampInteger(value, defaultValue, min, max) {
  if (value == null) {
    return defaultValue;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected integer between ${min} and ${max}`);
  }
  return value;
}

function runDetached(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: "ignore",
    });

    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("spawn", () => {
      if (!settled) {
        settled = true;
        child.unref();
        resolve({ pid: child.pid });
      }
    });
  });
}

function runBuffered(command, args = [], options = {}) {
  return runProcess(command, args, "", options);
}

function runWithInput(command, args = [], input = "", options = {}) {
  return runProcess(command, args, input, options);
}

function runProcess(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timeoutMs = options.timeoutMs ?? 10_000;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`Command timed out: ${command}`));
      }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}${stderr ? `\n${stderr}` : ""}`));
    });

    if (input) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}
