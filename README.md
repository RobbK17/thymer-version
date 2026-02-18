# Version Checker – Thymer plugin

A Thymer **global plugin** that checks its version from GitHub on startup and notifies when a newer release is available.

## What it does

- **On startup**: If `custom.githubRepo` is set, fetches the latest release (or latest tag) from GitHub and compares it to `custom.version`. If the GitHub version is newer, shows a toaster: *Update available*.
- **Status bar**: Adds a “Version Check” item; click to run the check again and show a toast.
- **Command palette**: *Version Checker: Check for updates* runs the same check on demand.

## Configuration

Configure the plugin in Thymer (plugin settings / custom config):

| Key | Description |
|-----|-------------|
| `githubRepo` | GitHub repo in `owner/repo` form (e.g. `thymerapp/thymer-plugin-sdk`). If empty, the plugin does nothing on load. |
| `version` | Version you consider “installed” (e.g. `1.0.0`). Used for comparison; supports `v` prefix and dotted/tagged formats. |
| `notifyOnNewVersion` | Optional, default `true`. If `false`, startup check still runs but no toaster is shown when an update is found. |

## Version comparison

- Strips a leading `v` (e.g. `v1.2.3` → `1.2.3`).
- Splits on `.` and `-` and compares numeric segments (e.g. `1.0.0`, `1.0.1`, `2.0.0`).

## GitHub source

- Tries **releases**: `GET /repos/{owner}/{repo}/releases/latest` and uses `tag_name`.
- If there are no releases, falls back to **tags**: `GET /repos/{owner}/{repo}/tags` and uses the first tag name.

## Files in this repo

- `plugin.js` – plugin code (same as in Thymer).
- `README.md` – this file.

The plugin is already installed in your Thymer workspace **Version Checker**. Set `custom.githubRepo` and `custom.version` in the plugin config so it knows which repo and version to check.
