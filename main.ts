import {
  App,
  Menu,
  MenuItem,
  TAbstractFile,
  FileSystemAdapter,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFolder,
} from "obsidian";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type MacTerminal = "Terminal" | "iTerm";
type ResumeMode = "continue" | "resume";
type OpenIn = "obsidian" | "external";

interface LauncherSettings {
  openIn: OpenIn;
  claudeCommand: string;
  macTerminal: MacTerminal;
  resumeMode: ResumeMode;
  extraArgs: string;
  claudeConfigDir: string;
}

const DEFAULT_SETTINGS: LauncherSettings = {
  openIn: "obsidian",
  claudeCommand: "claude",
  macTerminal: "Terminal",
  resumeMode: "continue",
  extraArgs: "",
  claudeConfigDir: "",
};

export default class ClaudeFolderLauncher extends Plugin {
  settings: LauncherSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    // Right-click on a folder in the file explorer
    const addFolderItem = (menu: Menu, file: TAbstractFile | undefined, source: string) => {
      console.log("[claude-folder-launcher] menu opened", source, file?.path, file?.constructor?.name);
      if (!file || !isFolder(file)) return;
      menu.addItem((item) =>
        item
          .setTitle("Start Claude in this folder")
          .setIcon("terminal-square")
          .onClick(() => this.launch(file as TFolder))
      );
    };

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) =>
        addFolderItem(menu, file, source)
      )
    );
    // Right-click when several items are selected: use the first folder
    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files, source) =>
        addFolderItem(menu, files.find(isFolder), source)
      )
    );

    // Notebook Navigator builds its own menus; register through its Menus API
    this.app.workspace.onLayoutReady(() => this.hookNotebookNavigator());

    // Command palette: open Claude in the folder of the active note
    this.addCommand({
      id: "open-claude-in-current-folder",
      name: "Open Claude in the current note's folder",
      callback: () => {
        const parent = this.app.workspace.getActiveFile()?.parent;
        if (parent) this.launch(parent);
        else new Notice("No active note.");
      },
    });

    this.addSettingTab(new LauncherSettingTab(this.app, this));
  }

  private hookNotebookNavigator(attempt = 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nn = (this.app as any).plugins?.plugins?.["notebook-navigator"]?.api;
    if (!nn?.menus?.registerFolderMenu) {
      // Notebook Navigator may still be loading; retry a few times
      if (attempt < 10) window.setTimeout(() => this.hookNotebookNavigator(attempt + 1), 1000);
      return;
    }
    const dispose = nn.menus.registerFolderMenu(
      (ctx: { folder: TFolder; addItem: (cb: (item: MenuItem) => void) => void }) => {
        ctx.addItem((item) =>
          item
            .setTitle("Start Claude in this folder")
            .setIcon("terminal-square")
            .onClick(() => this.launch(ctx.folder))
        );
      }
    );
    this.register(dispose);
    console.log("[claude-folder-launcher] hooked into Notebook Navigator", nn.getVersion?.());
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private absolutePath(folder: TFolder): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return null;
    // Vault root is "/" in Obsidian's folder paths
    const rel = folder.isRoot() ? "" : folder.path;
    return path.join(adapter.getBasePath(), rel);
  }

  private claudeDir(): string {
    return (
      this.settings.claudeConfigDir.trim() ||
      process.env.CLAUDE_CONFIG_DIR ||
      path.join(os.homedir(), ".claude")
    );
  }

  /**
   * Claude Code stores sessions as .jsonl files in
   * ~/.claude/projects/<cwd with every non-alphanumeric char replaced by "-">/
   * If the folder has none, fall back to scanning the session files for a
   * matching "cwd" field, in case the naming scheme differs.
   */
  hasPreviousSession(absPath: string): boolean {
    const projectsDir = path.join(this.claudeDir(), "projects");
    if (!fs.existsSync(projectsDir)) return false;

    const encoded = absPath.replace(/[^a-zA-Z0-9]/g, "-");
    if (dirHasSessions(path.join(projectsDir, encoded))) return true;

    try {
      for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(projectsDir, entry.name);
        if (sessionCwdMatches(dir, absPath)) return true;
      }
    } catch {
      /* ignore unreadable folders */
    }
    return false;
  }

  launch(folder: TFolder) {
    const absPath = this.absolutePath(folder);
    if (!absPath) {
      new Notice("Claude Folder Launcher only works with a local vault.");
      return;
    }

    const resume = this.hasPreviousSession(absPath);
    const args: string[] = [];
    if (resume) args.push(this.settings.resumeMode === "resume" ? "--resume" : "--continue");
    if (this.settings.extraArgs.trim()) args.push(this.settings.extraArgs.trim());
    const claudeCmd = [this.settings.claudeCommand, ...args].join(" ");

    const where = folder.name || "vault root";
    const message = resume
      ? `Resuming Claude session in ${where}`
      : `Starting new Claude session in ${where}`;

    if (this.settings.openIn === "obsidian") {
      this.openInObsidianTerminal(absPath, claudeCmd, where)
        .then((ok) => {
          if (ok) {
            new Notice(message);
          } else {
            new Notice("Terminal plugin not found or has no usable shell profile. Opening an external terminal instead.");
            this.openExternal(absPath, claudeCmd, message);
          }
        })
        .catch((e) => {
          console.error(e);
          new Notice(`Could not open Obsidian terminal: ${(e as Error).message}`);
        });
      return;
    }
    this.openExternal(absPath, claudeCmd, message);
  }

  private openExternal(absPath: string, claudeCmd: string, message: string) {
    try {
      openTerminal(absPath, claudeCmd, this.settings.macTerminal);
      new Notice(message);
    } catch (e) {
      console.error(e);
      new Notice(`Could not open terminal: ${(e as Error).message}`);
    }
  }

  /**
   * Opens a tab of the Terminal community plugin (id "terminal") in absPath and
   * runs claudeCmd in the user's shell. The shell keeps running after Claude
   * exits so the tab stays usable.
   */
  private async openInObsidianTerminal(
    absPath: string,
    claudeCmd: string,
    title: string
  ): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = (this.app as any).plugins?.plugins?.["terminal"];
    if (!term) return false;

    const platform = process.platform as "darwin" | "linux" | "win32";
    const profiles: Record<string, any> = term.settings?.value?.profiles ?? {};
    const integrated = Object.entries(profiles).filter(
      ([, p]) => p?.type === "integrated" && p?.platforms?.[platform]
    );
    // Prefer the Terminal plugin's default profile, then one matching $SHELL
    const defaultId: string | null = term.settings?.value?.defaultProfile ?? null;
    const shellName = path.basename(process.env.SHELL || "zsh");
    const picked =
      integrated.find(([id]) => id === defaultId) ??
      integrated.find(([, p]) => String(p.executable).includes(shellName)) ??
      integrated[0];

    const base = picked?.[1] ?? {
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
      win32Backend: "conpty",
    };

    const exe: string = base.executable;
    const isCmd = /cmd(\.exe)?$/i.test(exe);
    const isPwsh = /(pwsh|powershell)(\.exe)?$/i.test(exe);
    const args = isCmd
      ? ["/k", claudeCmd]
      : isPwsh
        ? ["-NoExit", "-Command", claudeCmd]
        : ["-l", "-i", "-c", `${claudeCmd}; exec ${shQuote(exe)} -l`];

    const profile = { ...base, args, name: `Claude: ${title}` };

    // Always a new tab, never the active one
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
          userTitle: `Claude: ${title}`,
        },
      },
    });
    // Pin the tab: Obsidian opens files in the active tab unless it is pinned,
    // so without this, clicking a note would replace the Claude terminal.
    leaf.setPinned(true);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    return true;
  }
}

function isFolder(f: TAbstractFile): boolean {
  // instanceof can fail across module copies; fall back to duck typing
  return f instanceof TFolder || Array.isArray((f as TFolder).children);
}

function dirHasSessions(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith(".jsonl"));
  } catch {
    return false;
  }
}

function sessionCwdMatches(dir: string, absPath: string): boolean {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return false;
  }
  for (const f of files) {
    try {
      // Only read the first few KB; the cwd appears early in each file
      const fd = fs.openSync(path.join(dir, f), "r");
      const buf = Buffer.alloc(16384);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const m = buf.toString("utf8", 0, n).match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m && JSON.parse(`"${m[1]}"`) === absPath) return true;
    } catch {
      /* skip */
    }
  }
  return false;
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function openTerminal(cwd: string, claudeCmd: string, macTerminal: MacTerminal) {
  const platform = process.platform;

  if (platform === "darwin") {
    const shellLine = `cd ${shQuote(cwd)} && ${claudeCmd}`;
    const script =
      macTerminal === "iTerm"
        ? `tell application "iTerm"
             activate
             set newWindow to (create window with default profile)
             tell current session of newWindow to write text ${appleScriptString(shellLine)}
           end tell`
        : `tell application "Terminal"
             activate
             do script ${appleScriptString(shellLine)}
           end tell`;
    spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (platform === "win32") {
    // Windows Terminal if available, otherwise a plain cmd window
    const child = spawn("wt.exe", ["-d", cwd, "cmd", "/k", claudeCmd], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      spawn("cmd.exe", ["/c", "start", "cmd", "/k", claudeCmd], {
        cwd,
        detached: true,
        stdio: "ignore",
      }).unref();
    });
    child.unref();
    return;
  }

  // Linux
  const bashLine = `${claudeCmd}; exec bash`;
  spawn("x-terminal-emulator", ["-e", "bash", "-lc", bashLine], {
    cwd,
    detached: true,
    stdio: "ignore",
  }).unref();
}

class LauncherSettingTab extends PluginSettingTab {
  plugin: ClaudeFolderLauncher;

  constructor(app: App, plugin: ClaudeFolderLauncher) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Open Claude in")
      .setDesc("A tab of the Terminal plugin inside Obsidian, or a separate terminal app.")
      .addDropdown((d) =>
        d
          .addOption("obsidian", "Obsidian (Terminal plugin)")
          .addOption("external", "External terminal app")
          .setValue(this.plugin.settings.openIn)
          .onChange(async (v) => {
            this.plugin.settings.openIn = v as OpenIn;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Claude command")
      .setDesc("Command or full path to the Claude Code CLI.")
      .addText((t) =>
        t.setValue(this.plugin.settings.claudeCommand).onChange(async (v) => {
          this.plugin.settings.claudeCommand = v.trim() || "claude";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("When a previous session exists")
      .setDesc("Continue the latest session directly, or show the session picker.")
      .addDropdown((d) =>
        d
          .addOption("continue", "Continue latest (--continue)")
          .addOption("resume", "Pick a session (--resume)")
          .setValue(this.plugin.settings.resumeMode)
          .onChange(async (v) => {
            this.plugin.settings.resumeMode = v as ResumeMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("External terminal on macOS")
      .addDropdown((d) =>
        d
          .addOption("Terminal", "Terminal")
          .addOption("iTerm", "iTerm2")
          .setValue(this.plugin.settings.macTerminal)
          .onChange(async (v) => {
            this.plugin.settings.macTerminal = v as MacTerminal;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extra arguments")
      .setDesc("Appended to every launch, for example --model opus.")
      .addText((t) =>
        t.setValue(this.plugin.settings.extraArgs).onChange(async (v) => {
          this.plugin.settings.extraArgs = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Claude config folder")
      .setDesc("Leave empty to use ~/.claude (or CLAUDE_CONFIG_DIR).")
      .addText((t) =>
        t.setValue(this.plugin.settings.claudeConfigDir).onChange(async (v) => {
          this.plugin.settings.claudeConfigDir = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
