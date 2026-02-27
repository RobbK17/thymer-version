// Version Checker - Thymer global plugin
// On load: gets all plugins, checks each one's githubRepo/version against GitHub,
// then shows one combined message for all plugins that have updates.

class Plugin extends AppPlugin {

  async onLoad() {
    await this.syncInstalledVersion();
    const config = this.getConfiguration();
    const custom = config.custom || {};
    const notify = custom.notifyOnNewVersion !== false;

    // Run check for all plugins on startup (async, no await)
    this.checkAllPluginsVersions(notify);

    this.ui.addStatusBarItem({
      label: "Version Check",
      icon: "ti-refresh",
      onClick: () => this.checkAllPluginsVersions(true)
    });

    this.ui.addCommandPaletteCommand({
      label: "Version Checker: Check for updates",
      icon: "ti-refresh",
      onSelected: () => this.checkAllPluginsVersions(true)
    });
  }

  parseVersion(s) {
    const v = String(s).replace(/^v/i, "").trim();
    const parts = v.split(/[.-]/).map(n => parseInt(n, 10) || 0);
    return { raw: v, parts };
  }

  compareVersions(a, b) {
    const va = this.parseVersion(a);
    const vb = this.parseVersion(b);
    const len = Math.max(va.parts.length, vb.parts.length);
    for (let i = 0; i < len; i++) {
      const pa = va.parts[i] || 0;
      const pb = vb.parts[i] || 0;
      if (pa > pb) return 1;
      if (pa < pb) return -1;
    }
    return 0;
  }

  /** Set version . */
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

  /** Parse GitHub API error response into a short message. */
  async parseGitHubError(res) {
    try {
      const data = await res.json();
      const msg = data && (data.message || data.error);
      if (msg) return String(msg);
    } catch (_) {}
    return res.statusText || "HTTP " + res.status;
  }

  /** Fetch version from plugin.json via canonical GitHub Contents API (GET /repos/{owner}/{repo}/contents/plugin.json). Returns version string, or { error } on API error. */
  async fetchVersionFromPluginJson(repo) {
    const [owner, repoNamespace] = repo.split("/").map(s => s.trim());
    if (!owner || !repoNamespace) return null;
    const path = "plugin.json";
    const url = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repoNamespace) + "/contents/" + encodeURIComponent(path);
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const msg = await this.parseGitHubError(res);
        const hint = res.status === 404 ? " (repo public? plugin.json at repo root?)" : "";
        return { error: msg + hint };
      }
      const data = await res.json();
      if (!data.content || data.encoding !== "base64") return null;
      const raw = atob(data.content.replace(/\s/g, ""));
      const json = JSON.parse(raw);
      const custom = (json && json.custom) || {};
      const version = (custom.version || json.version || "").trim();
      return version || null;
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  }

  /** Fetch latest version: plugin.json first, then releases/latest, then tags. Returns { version } or { error }. */
  async fetchLatestVersion(repo) {
    const [owner, repoNamespace] = repo.split("/").map(s => s.trim());
    if (!owner || !repoNamespace) return { error: "Invalid repo (use owner/repo)" };
    const apiBase = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repoNamespace);
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    try {
      const fromPluginJson = await this.fetchVersionFromPluginJson(repo);
      if (typeof fromPluginJson === "string") return { version: fromPluginJson };
      if (fromPluginJson && fromPluginJson.error) return { error: fromPluginJson.error };

      let latestTag = null;
      const releaseRes = await fetch(apiBase + "/releases/latest", { headers });
      if (releaseRes.status === 404) {
        const tagsRes = await fetch(apiBase + "/tags?per_page=1", { headers });
        if (!tagsRes.ok) {
          const msg = await this.parseGitHubError(tagsRes);
          const hint = tagsRes.status === 404 ? " (repo exists and is public?)" : "";
          return { error: msg + hint };
        }
        const tags = await tagsRes.json();
        if (Array.isArray(tags) && tags.length > 0 && tags[0].name) {
          return { version: tags[0].name };
        }
        return { version: null };
      }
      if (!releaseRes.ok) {
        const msg = await this.parseGitHubError(releaseRes);
        const hint = releaseRes.status === 404 ? " (repo exists and is public?)" : "";
        return { error: msg + hint };
      }
      const releaseData = await releaseRes.json();
      if (releaseData && releaseData.tag_name) return { version: releaseData.tag_name };

      const tagsRes = await fetch(apiBase + "/tags?per_page=1", { headers });
      if (!tagsRes.ok) {
        const msg = await this.parseGitHubError(tagsRes);
        const hint = tagsRes.status === 404 ? " (repo exists and is public?)" : "";
        return { error: msg + hint };
      }
      const tags = await tagsRes.json();
      if (Array.isArray(tags) && tags.length > 0 && tags[0].name) {
        return { version: tags[0].name };
      }
      return { version: null };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  }

  /** Ensure we have an array of plugin/collection items (API may return array or object). Prefer active-only keys if present. */
  toPluginArray(raw, keys, activeKeys = ["active", "active_plugins", "active_collections", "non_trashed"]) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      for (const k of activeKeys) {
        if (Array.isArray(raw[k])) return raw[k];
      }
      for (const k of keys) {
        if (Array.isArray(raw[k])) return raw[k];
      }
    }
    return [];
  }

  /** True if list item or plugin API indicates trashed (API may use trashed, in_trash, isTrashed, etc.). */
  isPluginTrashed(p, pluginApi) {
    if (p && (p.trashed === true || p.in_trash === true || p.isTrashed === true || p.inTrash === true || p.deleted === true)) return true;
    if (pluginApi && typeof pluginApi === "object" && (pluginApi.trashed === true || pluginApi.isTrashed === true)) return true;
    return false;
  }

  /** Get list of all plugins with githubRepo set, total active count, and names of all active plugins. */
  async getPluginsToCheck() {
    const list = [];
    const activeNames = [];
    let totalInstalled = 0;
    try {
      const [globalPluginsRaw, collectionsRaw] = await Promise.all([
        this.data.getAllGlobalPlugins(),
        this.data.getAllCollections()
      ]);
      // Use full lists (no activeKeys) so we include every plugin with githubRepo, not just "active" subset
      const globalPlugins = this.toPluginArray(globalPluginsRaw, ["global_plugins", "plugins", "plugin"], []);
      const collections = this.toPluginArray(collectionsRaw, ["collection_plugins", "collections", "collection"], []);
      const collectionGuids = new Set(collections.map(c => (c.guid || c.id || c.plugin_guid)).filter(Boolean));
      const all = [...globalPlugins, ...collections];
      for (const p of all) {
        try {
          const guid = p.guid || p.id || p.plugin_guid;
          if (!guid) continue;
          if (this.isPluginTrashed(p, null)) continue;
          const pluginApi = this.data.getPluginByGuid(guid);
          if (!pluginApi) continue;
          if (this.isPluginTrashed(p, pluginApi)) continue;
          totalInstalled++;
          const config = pluginApi.getConfiguration();
          const custom = (config && config.custom) || {};
          const name = (config && config.name) || p.name || p.label || "Unnamed";
          if (!collectionGuids.has(guid)) activeNames.push(name);
          const githubRepo = (custom.githubRepo || custom.githubrepo || (config && (config.githubRepo || config.githubrepo)) || "").trim();
          const version = (custom.version || (config && config.version) || "0.0.0").trim();
          if (githubRepo) {
            list.push({ guid, name, githubRepo, version });
          }
        } catch (_) {
          // Skip this plugin, continue with the rest
        }
      }
    } catch (_) {
      // ignore
    }
    return { list, totalInstalled, activeNames };
  }

  /** Check all plugins that have githubRepo set; show one combined message. */
  async checkAllPluginsVersions(showToast) {
    const { list: plugins, totalInstalled, activeNames } = await this.getPluginsToCheck();

    const messages = [];
    const upToDate = [];
    const errors = [];

    for (const p of plugins) {
      try {
        const result = await this.fetchLatestVersion(p.githubRepo);
        if (result.error) {
          errors.push(p.name + ": " + result.error);
          continue;
        }
        if (result.version === null) {
          errors.push(p.name + ": version not in GitHub");
          continue;
        }
        const cmp = this.compareVersions(result.version, p.version);
        if (cmp > 0) {
          messages.push(p.name + ": latest " + result.version + " (you have " + p.version + ")");
        } else {
          // cmp === 0 (same) or cmp < 0 (installed newer than GitHub)
          upToDate.push(p.name + ": up to date (" + p.version + ")");
        }
      } catch (e) {
        errors.push(p.name + ": check failed");
      }
    }

    if (showToast && (messages.length > 0 || upToDate.length > 0 || errors.length > 0)) {
      const countLine = plugins.length + " plugin(s) with version check (githubRepo set)";
      const lines = [countLine, "", ...upToDate, ...messages, ...errors];
      const escaped = lines.map(l => ("" + l).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("<br>");
      this.ui.addToaster({
        title: messages.length > 0 ? "Plugin updates available" : "Version Checker",
        messageHTML: '<div style="max-height: 60vh; overflow-y: auto; white-space: pre-wrap; word-break: break-word;">' + escaped + "</div>",
        dismissible: true,
        autoDestroyTime: 12000
      });
    }
  }
}
