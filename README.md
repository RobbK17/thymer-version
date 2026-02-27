# Version Checker – Thymer plugin

A Thymer **global plugin** that checks versions from GitHub for **all** plugins (and collections) in your workspace that have `githubRepo` set. On startup and on demand, it shows **one combined toast**: which plugins are up to date, which have updates, and any errors.

## What it does

- **On startup**: Finds every global plugin and collection that has `githubRepo` configured (in `custom` or top-level config). For each, fetches the latest version from GitHub and compares it to the plugin’s `version`. Shows a single toast with:
  - **Up to date** – plugin name and installed version
  - **Updates available** – plugin name, latest version, and your version
  - **Errors** – e.g. repo not found, no version in GitHub, or API error
- **Status bar**: Adds a “Version Check” item; click to run the check again and show the toast.
- **Command palette**: *Version Checker: Check for updates* runs the same check on demand.
- **Trashed** plugins/collections are excluded from the list.

Whether the startup check shows a toast is controlled by Version Checker’s own `custom.notifyOnNewVersion` (default `true`). Manual checks (status bar or command palette) always show the toast.

## Configuration

### Version Checker (this plugin)

In Version Checker’s plugin settings / custom config:

| Key | Description |
|-----|-------------|
| `githubRepo` | GitHub repo for this plugin in `owner/repo` form (e.g. `RobbK17/thymer-version`). Used so Version Checker itself appears in the check list. |
| `version` | Version you consider “installed” for this plugin (e.g. `1.0.1`). Used for comparison. |
| `notifyOnNewVersion` | Optional, default `true`. If `false`, the startup check still runs but **no toast** is shown on load. Manual checks still show the toast. |

### Any plugin you want to be checked

On each **other** plugin (or collection) that you want included in the version check:

| Key | Where | Description |
|-----|--------|-------------|
| `githubRepo` | `custom.githubRepo` or top-level `githubRepo` (casing `githubrepo` also supported) | GitHub repo in `owner/repo` form. If set, the plugin is included in the check. |
| `version` | `custom.version` or top-level `version` | Installed version used for comparison (e.g. `1.0.0`). Supports leading `v` and dotted/tagged formats. |

Version Checker scans **all** non-trashed global plugins and collections and includes any that have `githubRepo` set (in custom or top-level config).

## Keeping your plugin’s version in sync

If your plugin is checked by Version Checker (you set `githubRepo` and `version` on that plugin), you can keep `custom.version` in sync with the version you actually ship in `plugin.json`. That way Version Checker compares against the real deployed version.

**Version Checker** does this for itself automatically: on load it calls `syncInstalledVersion()`, which fetches `./plugin.json`, reads `version`, and updates its own `custom.version` via `saveConfiguration` if they differ.

For **your own** plugins that are included in the check, you can add the same behavior:

1. In `async onLoad() {`, call the sync first:

   ```js
   async onLoad() {
     await this.syncInstalledVersion();
     // ... rest of your onLoad code
   }
   ```

2. In the body of your plugin class, add this method:

   ```js
   async syncInstalledVersion() {
     try {
       const res = await fetch("./plugin.json", { cache: "no-store" });
       if (!res.ok) return;

       const json = await res.json();
       const version = json.version;
       if (!version) return;

       const cfg = this.getConfiguration() || {};
       cfg.custom = cfg.custom || {};

       if (cfg.custom.version !== version) {
         cfg.custom.version = version;
         await this.saveConfiguration(cfg);
       }
     } catch (_) {}
   }
   ```

When the plugin loads, it fetches its own `plugin.json`, reads `version`, and updates `custom.version` if they differ. Version Checker will then report the correct “current” version.

## Version comparison

- Strips a leading `v` (e.g. `v1.2.3` → `1.2.3`).
- Splits on `.` and `-` and compares numeric segments (e.g. `1.0.0`, `1.0.1`, `2.0.0`).
- If the installed version is **newer** than GitHub (e.g. dev build), the plugin is still shown as “up to date” with its installed version.

## Where the “latest” version comes from (GitHub)

For each repo, Version Checker tries in order:

1. **plugin.json** – `GET /repos/{owner}/{repo}/contents/plugin.json` (default branch). Reads `custom.version` or top-level `version`. This is tried first so you can ship version in `plugin.json` without creating a release or tag.
2. **Latest release** – `GET /repos/{owner}/{repo}/releases/latest`; uses `tag_name`.
3. **Tags** – `GET /repos/{owner}/{repo}/tags`; uses the first tag name if there are no releases.

If the repo is missing, private, or the request fails, the toast shows an error line for that plugin (e.g. 404 with a short hint).

## Files in this repo

- `plugin.js` – plugin custom code
- `plugin.json` – plugin configuration
- `README.md` – this file

Install the plugin in your Thymer workspace. Set `custom.githubRepo` and `custom.version` on Version Checker so it checks itself, and set `githubRepo` (and optionally `version`) on any other plugin or collection you want included in the version check.
