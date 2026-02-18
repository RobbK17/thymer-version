// Version Checker - Thymer global plugin
// On load: gets all plugins, checks each one's githubRepo/version against GitHub,
// then shows one combined message for all plugins that have updates.

class Plugin extends AppPlugin {

  onLoad() {
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

  /** Fetch version from plugin.json via canonical GitHub Contents API (GET /repos/{owner}/{repo}/contents/plugin.json). */
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
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.content || data.encoding !== "base64") return null;
      const raw = atob(data.content.replace(/\s/g, ""));
      const json = JSON.parse(raw);
      const custom = (json && json.custom) || {};
      const version = (custom.version || json.version || "").trim();
      return version || null;
    } catch (_) {
      return null;
    }
  }

  /** Fetch latest version: plugin.json (default branch) first, then releases/latest, then tags. */
  async fetchLatestVersion(repo) {
    const [owner, repoNamespace] = repo.split("/").map(s => s.trim());
    if (!owner || !repoNamespace) return null;
    const apiBase = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repoNamespace);
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    try {
      const fromPluginJson = await this.fetchVersionFromPluginJson(repo);
      if (fromPluginJson) return fromPluginJson;

      let latestTag = null;
      const releaseRes = await fetch(apiBase + "/releases/latest", { headers });
      if (releaseRes.status === 404) {
        const tagsRes = await fetch(apiBase + "/tags?per_page=1", { headers });
        if (tagsRes.ok) {
          const tags = await tagsRes.json();
          if (Array.isArray(tags) && tags.length > 0 && tags[0].name) {
            return tags[0].name;
          }
        }
        return null;
      }
      if (releaseRes.ok) {
        const data = await releaseRes.json();
        if (data && data.tag_name) latestTag = data.tag_name;
      }
      if (!latestTag) {
        const tagsRes = await fetch(apiBase + "/tags?per_page=1", { headers });
        if (tagsRes.ok) {
          const tags = await tagsRes.json();
          if (Array.isArray(tags) && tags.length > 0 && tags[0].name) {
            latestTag = tags[0].name;
          }
        }
      }
      return latestTag;
    } catch (_) {
      return null;
    }
  }

  /** Ensure we have an array of plugin/collection items (API may return array or object). */
  toPluginArray(raw, keys) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      for (const k of keys) {
        if (Array.isArray(raw[k])) return raw[k];
      }
    }
    return [];
  }

  /** Get list of all plugins with githubRepo set, and total installed count. */
  async getPluginsToCheck() {
    const list = [];
    let totalInstalled = 0;
    try {
      const [globalPluginsRaw, collectionsRaw] = await Promise.all([
        this.data.getAllGlobalPlugins(),
        this.data.getAllCollections()
      ]);
      const globalPlugins = this.toPluginArray(globalPluginsRaw, ["global_plugins", "plugins", "plugin"]);
      const collections = this.toPluginArray(collectionsRaw, ["collection_plugins", "collections", "collection"]);
      const all = [...globalPlugins, ...collections];
      totalInstalled = all.length;
      for (const p of all) {
        try {
          const guid = p.guid || p.id || p.plugin_guid;
          if (!guid) continue;
          const pluginApi = this.data.getPluginByGuid(guid);
          if (!pluginApi) continue;
          const config = pluginApi.getConfiguration();
          const custom = (config && config.custom) || {};
          const name = (config && config.name) || p.name || p.label || "Unnamed";
          const githubRepo = (custom.githubRepo || "").trim();
          const version = (custom.version || "0.0.0").trim();
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
    return { list, totalInstalled };
  }

  /** Check all plugins that have githubRepo set; show one combined message. */
  async checkAllPluginsVersions(showToast) {
    const { list: plugins, totalInstalled } = await this.getPluginsToCheck();
    const messages = [];
    const errors = [];

    for (const p of plugins) {
      try {
        const latestTag = await this.fetchLatestVersion(p.githubRepo);
        if (latestTag === null) {
          errors.push(p.name + ": could not fetch version from GitHub");
          continue;
        }
        const cmp = this.compareVersions(latestTag, p.version);
        if (cmp > 0) {
          messages.push(p.name + ": latest " + latestTag + " (you have " + p.version + ")");
        }
      } catch (_) {
        errors.push(p.name + ": check failed");
        // Continue with the rest of the plugins
      }
    }

    if (showToast && (messages.length > 0 || errors.length > 0)) {
      const countLine = totalInstalled + " plugin(s) installed, " + plugins.length + " with version check (githubRepo set)";
      const body = [countLine, ...messages, ...errors].join("\n");
      this.ui.addToaster({
        title: messages.length > 0 ? "Plugin updates available" : "Version Checker",
        message: body,
        dismissible: true,
        autoDestroyTime: 12000
      });
    }
  }
}
