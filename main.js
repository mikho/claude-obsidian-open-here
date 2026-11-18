"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ClaudeFolderLauncher
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_child_process = require("child_process");
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var DEFAULT_SETTINGS = {
  openIn: "obsidian",
  claudeCommand: "claude",
  macTerminal: "Terminal",
  resumeMode: "continue",
  extraArgs: "",
  claudeConfigDir: ""
};
var ClaudeFolderLauncher = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    const addFolderItem = (menu, file, source) => {
      var _a;
      console.log("[claude-folder-launcher] menu opened", source, file == null ? void 0 : file.path, (_a = file == null ? void 0 : file.constructor) == null ? void 0 : _a.name);
      if (!file || !isFolder(file))
        return;
      menu.addItem(
        (item) => item.setTitle("Start Claude in this folder").setIcon("terminal-square").onClick(() => this.launch(file))
      );
    };
    this.registerEvent(
      this.app.workspace.on(
        "file-menu",
        (menu, file, source) => addFolderItem(menu, file, source)
      )
    );
    this.registerEvent(
      this.app.workspace.on(
        "files-menu",
        (menu, files, source) => addFolderItem(menu, files.find(isFolder), source)
      )
    );
    this.app.workspace.onLayoutReady(() => this.hookNotebookNavigator());
    this.addCommand({
      id: "open-claude-in-current-folder",
      name: "Open Claude in the current note's folder",
      callback: () => {
        var _a;
        const parent = (_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.parent;
        if (parent)
          this.launch(parent);
        else
          new import_obsidian.Notice("No active note.");
      }
    });
    this.addSettingTab(new LauncherSettingTab(this.app, this));
  }
  hookNotebookNavigator(attempt = 0) {
    var _a, _b, _c, _d, _e;
    const nn = (_c = (_b = (_a = this.app.plugins) == null ? void 0 : _a.plugins) == null ? void 0 : _b["notebook-navigator"]) == null ? void 0 : _c.api;
    if (!((_d = nn == null ? void 0 : nn.menus) == null ? void 0 : _d.registerFolderMenu)) {
      if (attempt < 10)
        window.setTimeout(() => this.hookNotebookNavigator(attempt + 1), 1e3);
      return;
    }
    const dispose = nn.menus.registerFolderMenu(
      (ctx) => {
        ctx.addItem(
          (item) => item.setTitle("Start Claude in this folder").setIcon("terminal-square").onClick(() => this.launch(ctx.folder))
        );
      }
    );
    this.register(dispose);
    console.log("[claude-folder-launcher] hooked into Notebook Navigator", (_e = nn.getVersion) == null ? void 0 : _e.call(nn));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  absolutePath(folder) {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian.FileSystemAdapter))
      return null;
    const rel = folder.isRoot() ? "" : folder.path;
    return path.join(adapter.getBasePath(), rel);
  }
  claudeDir() {
    return this.settings.claudeConfigDir.trim() || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  }
  /**
   * Claude Code stores sessions as .jsonl files in
   * ~/.claude/projects/<cwd with every non-alphanumeric char replaced by "-">/
   * If the folder has none, fall back to scanning the session files for a
   * matching "cwd" field, in case the naming scheme differs.
   */
  hasPreviousSession(absPath) {
    const projectsDir = path.join(this.claudeDir(), "projects");
    if (!fs.existsSync(projectsDir))
      return false;
    const encoded = absPath.replace(/[^a-zA-Z0-9]/g, "-");
    if (dirHasSessions(path.join(projectsDir, encoded)))
      return true;
    try {
      for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (!entry.isDirectory())
          continue;
        const dir = path.join(projectsDir, entry.name);
        if (sessionCwdMatches(dir, absPath))
          return true;
      }
    } catch (e) {
    }
    return false;
  }
  launch(folder) {
    const absPath = this.absolutePath(folder);
    if (!absPath) {
      new import_obsidian.Notice("Claude Folder Launcher only works with a local vault.");
      return;
    }
    const resume = this.hasPreviousSession(absPath);
    const args = [];
    if (resume)
      args.push(this.settings.resumeMode === "resume" ? "--resume" : "--continue");
    if (this.settings.extraArgs.trim())
      args.push(this.settings.extraArgs.trim());
    const claudeCmd = [this.settings.claudeCommand, ...args].join(" ");
    const where = folder.name || "vault root";
    const message = resume ? `Resuming Claude session in ${where}` : `Starting new Claude session in ${where}`;
    if (this.settings.openIn === "obsidian") {
      this.openInObsidianTerminal(absPath, claudeCmd, where).then((ok) => {
        if (ok) {
          new import_obsidian.Notice(message);
        } else {
          new import_obsidian.Notice("Terminal plugin not found or has no usable shell profile. Opening an external terminal instead.");
          this.openExternal(absPath, claudeCmd, message);
        }
      }).catch((e) => {
        console.error(e);
        new import_obsidian.Notice(`Could not open Obsidian terminal: ${e.message}`);
      });
      return;
    }
    this.openExternal(absPath, claudeCmd, message);
  }
  openExternal(absPath, claudeCmd, message) {
    try {
      openTerminal(absPath, claudeCmd, this.settings.macTerminal);
      new import_obsidian.Notice(message);
    } catch (e) {
      console.error(e);
      new import_obsidian.Notice(`Could not open terminal: ${e.message}`);
    }
  }
  /**
   * Opens a tab of the Terminal community plugin (id "terminal") in absPath and
   * runs claudeCmd in the user's shell. The shell keeps running after Claude
   * exits so the tab stays usable.
   */
  async openInObsidianTerminal(absPath, claudeCmd, title) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    const term = (_b = (_a = this.app.plugins) == null ? void 0 : _a.plugins) == null ? void 0 : _b["terminal"];
    if (!term)
      return false;
    const platform = process.platform;
    const profiles = (_e = (_d = (_c = term.settings) == null ? void 0 : _c.value) == null ? void 0 : _d.profiles) != null ? _e : {};
    const integrated = Object.entries(profiles).filter(
      ([, p]) => {
        var _a2;
        return (p == null ? void 0 : p.type) === "integrated" && ((_a2 = p == null ? void 0 : p.platforms) == null ? void 0 : _a2[platform]);
      }
    );
    const defaultId = (_h = (_g = (_f = term.settings) == null ? void 0 : _f.value) == null ? void 0 : _g.defaultProfile) != null ? _h : null;
    const shellName = path.basename(process.env.SHELL || "zsh");
    const picked = (_j = (_i = integrated.find(([id]) => id === defaultId)) != null ? _i : integrated.find(([, p]) => String(p.executable).includes(shellName))) != null ? _j : integrated[0];
    const base = (_k = picked == null ? void 0 : picked[1]) != null ? _k : {
      type: "integrated",
      name: "",
      executable: platform === "win32" ? "C:\\Windows\\System32\\cmd.exe" : process.env.SHELL || "/bin/zsh",
      args: [],
      environment: [],
      platforms: { [platform]: true },
      pythonExecutable: platform === "win32" ? "" : "python3",
      followTheme: true,
      restoreHistory: false,
      rightClickAction: "copyPaste",
      successExitCodes: ["0", "SIGINT", "SIGTERM"],
      win32Backend: "conpty"
    };
    const exe = base.executable;
    const isCmd = /cmd(\.exe)?$/i.test(exe);
    const isPwsh = /(pwsh|powershell)(\.exe)?$/i.test(exe);
    const args = isCmd ? ["/k", claudeCmd] : isPwsh ? ["-NoExit", "-Command", claudeCmd] : ["-l", "-i", "-c", `${claudeCmd}; exec ${shQuote(exe)} -l`];
    const profile = { ...base, args, name: `Claude: ${title}` };
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: "terminal:terminal",
      active: true,
      state: {
        "terminal:terminal": {
          cwd: absPath,
          focus: true,
          profile,
          profileSourceId: null,
          serial: null,
          userTitle: `Claude: ${title}`
        }
      }
    });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    return true;
  }
};
function isFolder(f) {
  return f instanceof import_obsidian.TFolder || Array.isArray(f.children);
}
function dirHasSessions(dir) {
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith(".jsonl"));
  } catch (e) {
    return false;
  }
}
function sessionCwdMatches(dir, absPath) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch (e) {
    return false;
  }
  for (const f of files) {
    try {
      const fd = fs.openSync(path.join(dir, f), "r");
      const buf = Buffer.alloc(16384);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const m = buf.toString("utf8", 0, n).match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m && JSON.parse(`"${m[1]}"`) === absPath)
        return true;
    } catch (e) {
    }
  }
  return false;
}
function shQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
function appleScriptString(s) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function openTerminal(cwd, claudeCmd, macTerminal) {
  const platform = process.platform;
  if (platform === "darwin") {
    const shellLine = `cd ${shQuote(cwd)} && ${claudeCmd}`;
    const script = macTerminal === "iTerm" ? `tell application "iTerm"
             activate
             set newWindow to (create window with default profile)
             tell current session of newWindow to write text ${appleScriptString(shellLine)}
           end tell` : `tell application "Terminal"
             activate
             do script ${appleScriptString(shellLine)}
           end tell`;
    (0, import_child_process.spawn)("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (platform === "win32") {
    const child = (0, import_child_process.spawn)("wt.exe", ["-d", cwd, "cmd", "/k", claudeCmd], {
      detached: true,
      stdio: "ignore"
    });
    child.on("error", () => {
      (0, import_child_process.spawn)("cmd.exe", ["/c", "start", "cmd", "/k", claudeCmd], {
        cwd,
        detached: true,
        stdio: "ignore"
      }).unref();
    });
    child.unref();
    return;
  }
  const bashLine = `${claudeCmd}; exec bash`;
  (0, import_child_process.spawn)("x-terminal-emulator", ["-e", "bash", "-lc", bashLine], {
    cwd,
    detached: true,
    stdio: "ignore"
  }).unref();
}
var LauncherSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Open Claude in").setDesc("A tab of the Terminal plugin inside Obsidian, or a separate terminal app.").addDropdown(
      (d) => d.addOption("obsidian", "Obsidian (Terminal plugin)").addOption("external", "External terminal app").setValue(this.plugin.settings.openIn).onChange(async (v) => {
        this.plugin.settings.openIn = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Claude command").setDesc("Command or full path to the Claude Code CLI.").addText(
      (t) => t.setValue(this.plugin.settings.claudeCommand).onChange(async (v) => {
        this.plugin.settings.claudeCommand = v.trim() || "claude";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("When a previous session exists").setDesc("Continue the latest session directly, or show the session picker.").addDropdown(
      (d) => d.addOption("continue", "Continue latest (--continue)").addOption("resume", "Pick a session (--resume)").setValue(this.plugin.settings.resumeMode).onChange(async (v) => {
        this.plugin.settings.resumeMode = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("External terminal on macOS").addDropdown(
      (d) => d.addOption("Terminal", "Terminal").addOption("iTerm", "iTerm2").setValue(this.plugin.settings.macTerminal).onChange(async (v) => {
        this.plugin.settings.macTerminal = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Extra arguments").setDesc("Appended to every launch, for example --model opus.").addText(
      (t) => t.setValue(this.plugin.settings.extraArgs).onChange(async (v) => {
        this.plugin.settings.extraArgs = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Claude config folder").setDesc("Leave empty to use ~/.claude (or CLAUDE_CONFIG_DIR).").addText(
      (t) => t.setValue(this.plugin.settings.claudeConfigDir).onChange(async (v) => {
        this.plugin.settings.claudeConfigDir = v;
        await this.plugin.saveSettings();
      })
    );
  }
};
