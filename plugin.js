// Version Checker - Thymer global plugin
// On load: gets all plugins, checks each one's __source_repo/version against GitHub,
// then shows one combined message for all plugins that have updates.
// version 1.0.2

class Plugin extends AppPlugin {

  onLoad() {
    const config = this.getConfiguration();
    const custom = config.custom || {};
    const notify = custom.notifyOnNewVersion !== false;
    this.showUpToDate = custom.showUpToDate !== false;

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

  /** Parse a full GitHub URL or owner/repo string into { owner, repoNamespace }. */
  parseGitHubRepo(source) {
    try {
      const url = new URL(source.trim());
      const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
      if (parts.length >= 2) return { owner: parts[0], repoNamespace: parts[1] };
    } catch (_) {
      // Not a URL — fall back to treating it as owner/repo
      const parts = source.split("/").map(s => s.trim());
      if (parts.length >= 2) return { owner: parts[0], repoNamespace: parts[1] };
    }
    return null;
  }

  /** Fetch version from plugin.json via canonical GitHub Contents API (GET /repos/{owner}/{repo}/contents/plugin.json). */
  async fetchVersionFromPluginJson(source) {
    const parsed = this.parseGitHubRepo(source);
    if (!parsed) return null;
    const { owner, repoNamespace } = parsed;
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
  async fetchLatestVersion(source) {
    const parsed = this.parseGitHubRepo(source);
    if (!parsed) return null;
    const { owner, repoNamespace } = parsed;
    const apiBase = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repoNamespace);
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    try {
      const fromPluginJson = await this.fetchVersionFromPluginJson(source);
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
  
  /** Get list of all plugins with __source_repo set, and total installed count. */
  async getPluginsToCheck() {
    const list = [];
    let totalInstalled = 0;
    let skipped = [];
  
    try {
      const globalPluginsRaw = await this.data.getAllGlobalPlugins();
      const globalPlugins = this.toPluginArray(globalPluginsRaw, ["global_plugins", "plugins", "plugin"]);
      totalInstalled = globalPlugins.length;
  
      for (const p of globalPlugins) {
        const rawName = p.name || p.label || "Unnamed";
        try {
          const guid = p.guid || p.id || p.plugin_guid;
          if (!guid) {
            skipped.push(rawName + ": no guid found");
            continue;
          }
  
          let name = rawName;
          let __source_repo = "";
          let version = "";
  
          // 1. Check top-level raw object
          __source_repo = (p.__source_repo || "").trim();
          version = (p.version || "").trim();
  
          // 2. Check p.configuration.custom and p.configuration
          if (!__source_repo) {
            const rawConfig = p.configuration || null;
            const rawCustom = (rawConfig && rawConfig.custom) || null;
            if (rawCustom) {
              __source_repo = (rawCustom.__source_repo || "").trim();
              version = (rawCustom.version || version || "").trim();
            }
            if (!__source_repo && rawConfig) {
              __source_repo = (rawConfig.__source_repo || "").trim();
              version = (rawConfig.version || version || "").trim();
            }
            if (rawConfig) name = rawConfig.name || rawName;
          }
  
          // 3. Check p.custom
          if (!__source_repo) {
            const pCustom = p.custom || null;
            if (pCustom) {
              __source_repo = (pCustom.__source_repo || "").trim();
              version = (pCustom.version || version || "").trim();
            }
          }
  
          // 4. Fall back to getPluginByGuid — checks config, config.custom
          if (!__source_repo) {
            const pluginApi = this.data.getPluginByGuid(guid);
            if (!pluginApi) {
              skipped.push(rawName + ": not returned by getPluginByGuid (possibly disabled)");
              continue;
            }
            const config = pluginApi.getConfiguration();
            if (config) {
              const apiCustom = config.custom || null;
              __source_repo = (config.__source_repo || (apiCustom && apiCustom.__source_repo) || "").trim();
              version = (config.version || (apiCustom && apiCustom.version) || version || "").trim();
              name = config.name || rawName;
            }
          }
  
          if (!version) version = "0.0.0";
  
          if (__source_repo) {
            list.push({ guid, name, __source_repo, version });
          }
  
        } catch (err) {
          skipped.push(rawName + ": error during inspection (" + (err && err.message || "unknown") + ")");
        }
      }
    } catch (err) {
      // ignore top-level fetch failure
    }
  
    return { list, totalInstalled, skipped };
  }


  /** Check all plugins that have __source_repo set; show one combined message. */
  async checkAllPluginsVersions(showToast) {
    const { list: plugins, totalInstalled, skipped } = await this.getPluginsToCheck();
    const messages = [];
    const errors = [];
    const upToDate = [];
  
    for (const p of plugins) {
      try {
        const latestTag = await this.fetchLatestVersion(p.__source_repo);
        if (latestTag === null) {
          errors.push(p.name + ": could not fetch version from GitHub");
          continue;
        }
        const cmp = this.compareVersions(latestTag, p.version);
        if (cmp > 0) {
          messages.push(p.name + ": latest " + latestTag + " (you have " + p.version + ")");
        } else {
          upToDate.push(p.name + ": up to date (" + p.version + ")");
        }
      } catch (_) {
        errors.push(p.name + ": check failed");
      }
    }
  
    if (showToast && (messages.length > 0 || errors.length > 0 || skipped.length > 0 || upToDate.length > 0)) {
      const lines = [
        plugins.length + " of " + totalInstalled + " plugin(s) with version check\n",
        ...messages,
        ...errors,
        ...(this.showUpToDate && upToDate.length > 0 ? ["\nUp to date (" + upToDate.length + "):"] : []),
        ...(this.showUpToDate ? upToDate : []),
        ...(skipped.length > 0 ? ["Skipped (" + skipped.length + "):"] : []),
        ...skipped
      ];
      this.ui.addToaster({
        title: messages.length > 0 ? "Plugin updates available" : "Version Checker",
        message: lines.join("\n"),
        dismissible: true,
        autoDestroyTime: 3000
      });
    }
  }
}