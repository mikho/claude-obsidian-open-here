# Claude Folder Launcher

An Obsidian plugin that adds **Start Claude in this folder** to the right-click menu of every folder in your vault. Click it and [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) starts in a terminal tab inside Obsidian, with that folder as its working directory.

If you have used Claude Code in that folder before, the plugin picks up where you left off: it starts `claude --continue` instead of a fresh session.

Desktop only. Built and tested on macOS.

## What it does

1. You right-click a folder, in Obsidian's own file explorer or in [Notebook Navigator](https://github.com/johansan/notebook-navigator).
2. The plugin works out the folder's absolute path on disk.
3. It looks in `~/.claude/projects/` for sessions that belong to that folder. Claude Code keeps each folder's sessions as `.jsonl` files in a directory named after the path, with every character other than letters and digits replaced by `-`. If no such directory exists, the plugin reads the start of each session file and compares its `"cwd"` field with the folder path.
4. It builds the command: `claude --continue` when a session exists, plain `claude` when none does, plus any extra arguments from the settings.
5. It opens a new tab from the [Terminal](https://github.com/polyipseity/obsidian-terminal) plugin in that folder and runs the command in your shell as a login shell, so `claude` is found the same way as in your normal terminal. When Claude exits, the shell stays open in the tab.

Without the Terminal plugin, it opens Terminal.app or iTerm2 instead (Windows Terminal or `cmd` on Windows, `x-terminal-emulator` on Linux).

There is also a command palette entry, **Open Claude in the current note's folder**, which does the same for the folder of the note you have open.

## Requirements

- Obsidian desktop 1.4.0 or later, with the vault stored on a local disk.
- Claude Code installed, with `claude` available from a login shell. Check with `which claude` in your terminal.
- Recommended: the **Terminal** community plugin by polyipseity, for the tab inside Obsidian. It needs at least one shell profile for your platform, which it sets up by default.
- If you use **Notebook Navigator**: version 2.2.0 or later. It draws its own context menus, and this plugin adds its item through Notebook Navigator's Menus API.

## Installation

The plugin is not in the Obsidian community plugin directory, so it is installed by hand.

1. Download `main.js` and `manifest.json` from this repository (or from the latest release, if there is one).
2. In your vault, create the folder `.obsidian/plugins/claude-folder-launcher/`. On macOS, `.obsidian` is hidden in Finder; press Cmd+Shift+. to show hidden files.
3. Put `main.js` and `manifest.json` directly in that folder. The path must be `.obsidian/plugins/claude-folder-launcher/main.js`, not one level deeper.
4. In Obsidian, open Settings, Community plugins. Turn off Restricted mode if it is on, then enable **Claude Folder Launcher**. Restart Obsidian if it does not show up in the list.
5. Optional but recommended: install and enable **Terminal** from Community plugins.

### Updating

Replace `main.js` and `manifest.json` with the new versions, then turn the plugin off and on again in Community plugins.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Open Claude in | Obsidian (Terminal plugin) | A tab inside Obsidian, or an external terminal app |
| Claude command | `claude` | The command, or the full path to the Claude Code binary |
| When a previous session exists | Continue latest | `--continue` reopens the latest session, `--resume` shows a list to pick from |
| External terminal on macOS | Terminal | Terminal or iTerm2, used only for the external terminal |
| Extra arguments | empty | Added to every launch, for example `--model opus` |
| Claude config folder | `~/.claude` | Where to look for sessions. Falls back to `CLAUDE_CONFIG_DIR` if set |

## Checking that it works

- Right-click a folder. **Start Claude in this folder** should be in the menu.
- Open the developer console (Cmd+Option+I on macOS, Ctrl+Shift+I elsewhere) and type `claude-folder` in the Filter box.
  - With Notebook Navigator, you should see `hooked into Notebook Navigator` and a version number shortly after Obsidian starts.
  - Each right-click in Obsidian's own file explorer logs `[claude-folder-launcher] menu opened`.

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| No menu item in Notebook Navigator, and no `hooked into` line in the console | Notebook Navigator is older than 2.2.0. Update it. |
| No menu item in Obsidian's file explorer | The plugin is not enabled, or the files are one folder too deep (see step 3). |
| Terminal.app opens instead of a tab in Obsidian | The Terminal plugin is missing, disabled, or has no shell profile for your platform. |
| The tab opens but says `claude: command not found` | Your shell cannot find Claude Code. Put the output of `which claude` in the **Claude command** setting. |
| macOS asks whether Obsidian may control Terminal | Only for the external terminal. Allow it under System Settings, Privacy & Security, Automation. |
| A new session starts even though you used Claude there before | Compare the directory names under `~/.claude/projects/` with the folder path. If you moved or renamed the folder, Claude Code treats it as a new project. |
| The console shows `Malformed data` from `plugin:terminal` | That error comes from the Terminal plugin's own saved state, not from this plugin. |

## Known limits

- The Terminal plugin has no public API for opening a tab with a given folder and command. This plugin sets the tab's view state directly, using the format from the Terminal plugin's source (October 2026). If a later Terminal release changes that format, the tab may stop working; switch **Open Claude in** to the external terminal until this plugin is updated.
- The Windows and Linux paths have not been tested.
- Vaults that are not on a local disk are not supported.

## Building from source

Requires Node.js 18 or later.

```
git clone https://github.com/mikho/claude-obsidian-open-here.git
cd claude-obsidian-open-here
npm install
npm run build
```

`npm run build` type-checks `main.ts` and bundles it to `main.js` with esbuild. Copy `main.js` and `manifest.json` into your vault's plugin folder as described above.

## License

MIT, see [LICENSE](LICENSE).
