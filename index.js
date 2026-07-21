"use strict";

const path = require("path");
const {Dialog, Plugin, Setting, showMessage} = require("siyuan");

const FALLBACK_API_URL = "http://127.0.0.1:6806";

function normalizeApiUrl(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\/+$/, "")
    : "";
}

function uniqueApiUrls(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeApiUrl(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function apiUrlFromLocation(locationLike) {
  if (!locationLike || !locationLike.port) {
    return "";
  }
  const hostname = locationLike.hostname || "";
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    return "";
  }
  return `http://127.0.0.1:${locationLike.port}`;
}

function getBrowserApiUrlCandidates(config = {}, locationLike) {
  return uniqueApiUrls([
    config.siyuanApiUrl,
    FALLBACK_API_URL,
    apiUrlFromLocation(locationLike)
  ]);
}

function readConfFromPayload(payload) {
  return payload && payload.data && payload.data.conf && typeof payload.data.conf === "object"
    ? payload.data.conf
    : null;
}

async function postJson(fetchImpl, apiUrl, apiPath, token) {
  const response = await fetchImpl(`${apiUrl}${apiPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? {Authorization: `Token ${token}`} : {})
    },
    body: "{}"
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function detectSiyuanConnection(config = {}, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const locationLike = options.location || (typeof window !== "undefined" ? window.location : undefined);
  const configuredToken = typeof config.siyuanToken === "string" ? config.siyuanToken.trim() : "";
  const tokenCandidates = configuredToken ? [configuredToken, ""] : [""];
  let lastError = null;

  for (const apiUrl of getBrowserApiUrlCandidates(config, locationLike)) {
    for (const token of tokenCandidates) {
      try {
        const payload = await postJson(fetchImpl, apiUrl, "/api/system/getConf", token);
        const conf = readConfFromPayload(payload);
        const detectedToken = conf && conf.api && typeof conf.api.token === "string"
          ? conf.api.token
          : token;
        return {apiUrl, token: detectedToken || token || "", conf};
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError || new Error("Cannot detect SiYuan API address");
}

const CONFIG_FILE = "mcp-bridge-config.json";

function getPluginDir() {
  const system = globalThis.siyuan && globalThis.siyuan.config
    ? globalThis.siyuan.config.system
    : null;
  return system && system.dataDir
    ? path.join(system.dataDir, "plugins", "siyuan-ai-mcp-bridge")
    : __dirname;
}

const SERVER_FILE = path.join(getPluginDir(), "mcp-server.cjs");

const defaultConfig = {
  version: 1,
  siyuanApiUrl: FALLBACK_API_URL,
  siyuanToken: "",
  defaultNotebookPermission: "r",
  notebookPermissions: {},
  tools: {
    systemInfo: true,
    listNotebooks: true,
    search: true,
    readDoc: true,
    createDoc: false,
    appendBlock: false,
    updateBlock: false,
    deleteBlock: false
  }
};

const permissionOptions = [
  {value: "inherit", label: "继承默认"},
  {value: "none", label: "none - 隐藏"},
  {value: "r", label: "r - 只读"},
  {value: "rw", label: "rw - 读写"},
  {value: "rwd", label: "rwd - 读写删除"}
];

const toolGroups = [
  {
    title: "只读功能",
    description: "允许外部 AI 获取版本、笔记本列表、搜索和读取文档。",
    tools: [
      ["systemInfo", "系统信息"],
      ["listNotebooks", "列出笔记本"],
      ["search", "全文搜索"],
      ["readDoc", "读取文档"]
    ]
  },
  {
    title: "写入功能",
    description: "打开后仍需要目标笔记权限至少为 rw。",
    tools: [
      ["createDoc", "创建文档"],
      ["appendBlock", "追加块"],
      ["updateBlock", "更新块"]
    ]
  },
  {
    title: "危险功能",
    description: "删除操作需要目标笔记权限为 rwd。",
    tools: [
      ["deleteBlock", "删除块"]
    ]
  }
];

const settingsNavItems = [
  {
    id: "connection",
    label: "连接配置",
    icon: '<svg viewBox="0 0 24 24"><path d="M7 7h5a5 5 0 0 1 0 10H7v-2h5a3 3 0 0 0 0-6H7V7Zm5 4h7v2h-7v-2ZM5 9H3V7h2v2Zm0 8H3v-2h2v2Z"/></svg>'
  },
  {
    id: "note-permissions",
    label: "笔记权限",
    icon: '<svg viewBox="0 0 24 24"><path d="M17 9h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 10 0v2Zm-8 0h6V7a3 3 0 0 0-6 0v2Zm3 4a2 2 0 0 0-1 3.73V18h2v-1.27A2 2 0 0 0 12 13Z"/></svg>'
  },
  {
    id: "feature-permissions",
    label: "功能权限",
    icon: '<svg viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm2 2v10h14V8H5Z"/></svg>'
  },
  {
    id: "advanced",
    label: "高级配置",
    icon: '<svg viewBox="0 0 24 24"><path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65-2-3.46-2.49 1a7.05 7.05 0 0 0-1.69-.98L15 3h-4l-.36 2.93c-.6.24-1.17.57-1.69.98l-2.49-1-2 3.46 2.11 1.65c-.04.32-.07.65-.07.98s.02.66.07.98l-2.11 1.65 2 3.46 2.49-1c.52.41 1.09.74 1.69.98L11 21h4l.36-2.93c.6-.24 1.17-.57 1.69-.98l2.49 1 2-3.46-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/></svg>'
  }
];

function normalizeConfig(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const tools = source.tools && typeof source.tools === "object" ? source.tools : {};
  const notebookPermissions = source.notebookPermissions && typeof source.notebookPermissions === "object"
    ? source.notebookPermissions
    : {};
  return {
    ...defaultConfig,
    ...source,
    version: 1,
    siyuanApiUrl: typeof source.siyuanApiUrl === "string" && source.siyuanApiUrl.trim()
      ? normalizeApiUrl(source.siyuanApiUrl)
      : defaultConfig.siyuanApiUrl,
    siyuanToken: typeof source.siyuanToken === "string" ? source.siyuanToken : "",
    defaultNotebookPermission: ["none", "r", "rw", "rwd"].includes(source.defaultNotebookPermission)
      ? source.defaultNotebookPermission
      : defaultConfig.defaultNotebookPermission,
    notebookPermissions,
    tools: {...defaultConfig.tools, ...tools}
  };
}

class SiyuanAiMcpBridgePlugin extends Plugin {
  async onload() {
    this.config = normalizeConfig(await this.loadConfig());
    this.initSettingEntry();

    this.addCommand({
      langKey: "openSiyuanMcpSettings",
      langText: this.text("openSettings", "Open SiYuan MCP Settings"),
      callback: () => this.openSetting()
    });
  }

  initSettingEntry() {
    this.setting = new Setting({
      confirmCallback: () => this.saveConfig(this.config)
    });

    this.setting.addItem({
      title: this.text("settingsTitle", "SiYuan MCP"),
      description: this.text(
        "settingsDescription",
        "Configure MCP connection, note permissions, and tool permissions."
      ),
      createActionElement: () => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "b3-button b3-button--outline";
        button.textContent = this.text("openSettings", "Open SiYuan MCP Settings");
        button.addEventListener("click", () => this.openSetting());
        return button;
      }
    });
  }

  async loadConfig() {
    try {
      const saved = await this.loadData(CONFIG_FILE);
      if (typeof saved === "string" && saved.trim()) {
        return JSON.parse(saved);
      }
      return saved || defaultConfig;
    } catch (error) {
      console.warn("[siyuan-ai-mcp-bridge] load config failed", error);
      return defaultConfig;
    }
  }

  async saveConfig(config) {
    const normalized = normalizeConfig(config);
    await this.saveData(CONFIG_FILE, normalized);
    this.config = normalized;
    return normalized;
  }

  text(key, fallback) {
    return this.i18n && this.i18n[key] ? this.i18n[key] : fallback;
  }

  getClientConfig(config = this.config) {
    const env = {
      SIYUAN_API_URL: config.siyuanApiUrl
    };
    if (config.siyuanToken) {
      env.SIYUAN_API_TOKEN = config.siyuanToken;
    }
    return {
      mcpServers: {
        "siyuan-ai-mcp-bridge": {
          command: "node",
          args: [SERVER_FILE],
          env
        }
      }
    };
  }

  getDisplayClientConfig(config = this.config) {
    const clientConfig = this.getClientConfig(config);
    const env = clientConfig.mcpServers["siyuan-ai-mcp-bridge"].env;
    if (env.SIYUAN_API_TOKEN) {
      env.SIYUAN_API_TOKEN = "********";
    }
    return clientConfig;
  }

  openSetting() {
    const dialog = new Dialog({
      title: this.text("settingsTitle", "SiYuan MCP"),
      content: '<div class="siyuan-ai-mcp-bridge-settings"></div>',
      width: "min(900px, calc(100vw - 48px))",
      height: "min(720px, calc(100vh - 72px))"
    });
    const root = dialog.element.querySelector(".siyuan-ai-mcp-bridge-settings");
    let notebookState = {
      loading: false,
      error: "",
      notebooks: []
    };
    let tokenState = {
      loading: false,
      error: "",
      loaded: false,
      source: ""
    };
    let draftConfig = normalizeConfig(this.config);
    let didAutoDetectConnection = false;
    let activeSection = "connection";
    let saveState = {
      status: "idle",
      message: "修改后需要保存才会对 MCP 生效。"
    };

    const createButton = (label, type = "outline") => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = type === "primary" ? "b3-button b3-button--text" : "b3-button b3-button--outline";
      button.textContent = label;
      return button;
    };

    const createField = (label, control, hint) => {
      const field = document.createElement("label");
      field.className = "siyuan-ai-mcp-bridge-field";
      const labelElement = document.createElement("span");
      labelElement.textContent = label;
      field.appendChild(labelElement);
      field.appendChild(control);
      if (hint) {
        const hintElement = document.createElement("small");
        hintElement.textContent = hint;
        field.appendChild(hintElement);
      }
      return field;
    };

    const createSelect = (value, options) => {
      const select = document.createElement("select");
      select.className = "b3-select";
      for (const option of options) {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        if (option.value === value) {
          element.selected = true;
        }
        select.appendChild(element);
      }
      return select;
    };

    const createInput = (value, type = "text") => {
      const input = document.createElement("input");
      input.className = "b3-text-field fn__block";
      input.type = type;
      input.value = value || "";
      return input;
    };

    const copyText = async (text) => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    };

    const readConfigFromForm = () => {
      const next = normalizeConfig({
        ...draftConfig,
        defaultNotebookPermission: root.querySelector('[data-setting="defaultNotebookPermission"]').value,
        tools: {...draftConfig.tools},
        notebookPermissions: {}
      });

      for (const checkbox of root.querySelectorAll("[data-tool]")) {
        next.tools[checkbox.dataset.tool] = checkbox.checked;
      }

      for (const select of root.querySelectorAll("[data-notebook-permission]")) {
        if (select.value !== "inherit") {
          next.notebookPermissions[select.dataset.notebookPermission] = select.value;
        }
      }

      return normalizeConfig(next);
    };

    const updateSaveState = () => {
      const state = root.querySelector("[data-save-state]");
      if (!state) {
        return;
      }
      state.textContent = saveState.message;
      state.dataset.status = saveState.status;
    };

    const markUnsaved = (message = "有未保存修改，保存后才会对 MCP 生效。") => {
      saveState = {status: "dirty", message};
      updateSaveState();
    };

    const saveFromForm = async (sectionId = activeSection, options = {}) => {
      const {
        rerender = true,
        showToast = true,
        savedMessage = "已保存。MCP 会在下次工具调用时读取最新权限。"
      } = options;
      draftConfig = readConfigFromForm();
      await this.saveConfig(draftConfig);
      draftConfig = normalizeConfig(this.config);
      activeSection = sectionId;
      saveState = {
        status: "saved",
        message: savedMessage
      };
      if (showToast) {
        showMessage(this.text("settingsSaved", "MCP bridge settings saved"));
      }
      if (rerender) {
        render();
      } else {
        updateSaveState();
      }
    };

    const saveFeaturePermissions = async (showToast = true) => {
      await saveFromForm("feature-permissions", {
        rerender: showToast,
        showToast,
        savedMessage: showToast
          ? "已保存。MCP 会在下次工具调用时读取最新权限。"
          : "已自动保存。MCP 会在下次工具调用时读取最新权限。"
      });
    };

    const loadNotebooks = async () => {
      draftConfig = readConfigFromForm();
      notebookState = {...notebookState, loading: true, error: ""};
      render();
      try {
        const response = await fetch(`${draftConfig.siyuanApiUrl.replace(/\/+$/, "")}/api/notebook/lsNotebooks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(draftConfig.siyuanToken ? {Authorization: `Token ${draftConfig.siyuanToken}`} : {})
          },
          body: "{}"
        });
        const payload = await response.json();
        if (!response.ok || payload.code !== 0) {
          throw new Error(payload.msg || `HTTP ${response.status}`);
        }
        notebookState = {
          loading: false,
          error: "",
          notebooks: (payload.data && payload.data.notebooks || []).filter((notebook) => !notebook.closed)
        };
      } catch (error) {
        notebookState = {
          ...notebookState,
          loading: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
      render();
    };

    const detectCurrentConnection = async () => {
      draftConfig = readConfigFromForm();
      tokenState = {loading: true, error: "", loaded: false, source: ""};
      render();
      try {
        const connection = await detectSiyuanConnection({
          config: draftConfig,
          fetch,
          location: window.location
        });
        draftConfig = normalizeConfig({
          ...draftConfig,
          siyuanApiUrl: connection.apiUrl,
          siyuanToken: connection.token
        });
        tokenState = {loading: false, error: "", loaded: true, source: connection.source};
      } catch (error) {
        tokenState = {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          loaded: false,
          source: ""
        };
      }
      render();
    };

    const render = () => {
      root.innerHTML = "";

      const shell = document.createElement("div");
      shell.className = "siyuan-ai-mcp-bridge-shell";
      root.appendChild(shell);

      const nav = document.createElement("nav");
      nav.className = "siyuan-ai-mcp-bridge-nav";
      shell.appendChild(nav);

      const content = document.createElement("div");
      content.className = "siyuan-ai-mcp-bridge-content";
      shell.appendChild(content);

      const setActiveSection = (sectionId) => {
        for (const button of nav.querySelectorAll("[data-nav-target]")) {
          button.classList.toggle("is-active", button.dataset.navTarget === sectionId);
        }
      };

      for (const item of settingsNavItems) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "siyuan-ai-mcp-bridge-nav-item";
        button.dataset.navTarget = item.id;
        button.innerHTML = `<span class="siyuan-ai-mcp-bridge-nav-icon">${item.icon}</span><span>${item.label}</span>`;
        button.addEventListener("click", () => {
          activeSection = item.id;
          setActiveSection(item.id);
          const target = content.querySelector(`[data-section="${item.id}"]`);
          if (target) {
            target.scrollIntoView({behavior: "smooth", block: "start"});
          }
        });
        nav.appendChild(button);
      }

      const title = document.createElement("h2");
      title.textContent = this.text("settingsTitle", "SiYuan MCP");
      content.appendChild(title);

      const desc = document.createElement("p");
      desc.textContent = "先复制 MCP 客户端配置完成连接，再分别设置笔记权限和功能权限。默认保持只读。";
      content.appendChild(desc);

      const connection = document.createElement("section");
      connection.className = "siyuan-ai-mcp-bridge-card siyuan-ai-mcp-bridge-step";
      connection.dataset.section = "connection";
      connection.innerHTML = '<div class="siyuan-ai-mcp-bridge-step-title"><span>1</span><h3>配置 MCP 连接</h3></div>';
      const connectionStatus = document.createElement("div");
      connectionStatus.className = "siyuan-ai-mcp-bridge-status-grid";
      const apiStatus = document.createElement("div");
      apiStatus.className = "siyuan-ai-mcp-bridge-status-item";
      const apiHint = tokenState.loaded
        ? "已从当前思源内核自动识别，会写入下方 MCP 客户端配置。"
        : "打开设置页后会自动识别当前思源内核地址。";
      apiStatus.innerHTML = `<span>思源 API 地址</span><strong>${draftConfig.siyuanApiUrl}</strong><small>${apiHint}</small>`;
      connectionStatus.appendChild(apiStatus);
      const tokenStatus = document.createElement("div");
      tokenStatus.className = "siyuan-ai-mcp-bridge-status-item";
      const tokenText = tokenState.loading
        ? "正在自动读取"
        : draftConfig.siyuanToken
          ? "已自动读取"
          : "等待自动读取";
      tokenStatus.innerHTML = `<span>思源 API Token</span><strong>${tokenText}</strong><small>用于 MCP 连接思源内核，已自动写入下方客户端配置。</small>`;
      if (tokenState.source && tokenState.source !== draftConfig.siyuanApiUrl) {
        const source = document.createElement("small");
        source.textContent = `探测入口：${tokenState.source}`;
        tokenStatus.appendChild(source);
      }
      if (tokenState.error) {
        const tokenError = document.createElement("small");
        tokenError.className = "siyuan-ai-mcp-bridge-inline-error";
        tokenError.textContent = `读取失败：${tokenState.error}`;
        tokenStatus.appendChild(tokenError);
      }
      connectionStatus.appendChild(tokenStatus);
      connection.appendChild(connectionStatus);

      const client = document.createElement("div");
      client.className = "siyuan-ai-mcp-bridge-client";
      const clientHeader = document.createElement("div");
      clientHeader.className = "siyuan-ai-mcp-bridge-card-header";
      const clientTitle = document.createElement("h3");
      clientTitle.textContent = "MCP 客户端配置";
      clientHeader.appendChild(clientTitle);
      const clientActions = document.createElement("div");
      clientActions.className = "siyuan-ai-mcp-bridge-inline-actions";
      const copy = createButton("复制配置");
      clientActions.appendChild(copy);
      const aiCopy = createButton("复制给 AI 工具");
      clientActions.appendChild(aiCopy);
      clientHeader.appendChild(clientActions);
      client.appendChild(clientHeader);

      const pre = document.createElement("pre");
      const getClientConfigText = () => JSON.stringify(this.getClientConfig(draftConfig), null, 2);
      pre.textContent = JSON.stringify(this.getDisplayClientConfig(draftConfig), null, 2);
      copy.addEventListener("click", async () => {
        await copyText(getClientConfigText());
        showMessage("MCP 客户端配置已复制");
      });
      aiCopy.addEventListener("click", async () => {
        await copyText(`请帮我配置思源MCP。下面是 MCP 客户端配置，请直接帮我添加到当前 AI 工具中：\n\n${getClientConfigText()}`);
        showMessage("已复制，可直接粘贴给 AI 工具");
      });
      client.appendChild(pre);
      connection.appendChild(client);
      content.appendChild(connection);

      const permissions = document.createElement("section");
      permissions.className = "siyuan-ai-mcp-bridge-card siyuan-ai-mcp-bridge-step";
      permissions.dataset.section = "note-permissions";
      permissions.innerHTML = '<div class="siyuan-ai-mcp-bridge-step-title"><span>2</span><h3>笔记权限</h3></div>';
      const permissionsIntro = document.createElement("p");
      permissionsIntro.textContent = "控制 AI 能接触哪些笔记本，以及每个笔记本最多允许读、写还是删除。";
      permissions.appendChild(permissionsIntro);
      const permissionGrid = document.createElement("div");
      permissionGrid.className = "siyuan-ai-mcp-bridge-grid";
      const defaultPermission = createSelect(draftConfig.defaultNotebookPermission, permissionOptions.filter((option) => option.value !== "inherit"));
      defaultPermission.dataset.setting = "defaultNotebookPermission";
      defaultPermission.addEventListener("change", () => {
        markUnsaved("笔记权限有未保存修改，保存后才会对 MCP 生效。");
      });
      permissionGrid.appendChild(createField("默认笔记权限", defaultPermission, "未单独配置的笔记本都使用此权限。建议保持 r，只允许读取。"));
      permissions.appendChild(permissionGrid);

      const notebooksSection = document.createElement("div");
      notebooksSection.className = "siyuan-ai-mcp-bridge-tool-group";
      const notebooksHeader = document.createElement("div");
      notebooksHeader.className = "siyuan-ai-mcp-bridge-card-header";
      const notebooksTitle = document.createElement("h3");
      notebooksTitle.textContent = "按笔记本覆盖";
      notebooksHeader.appendChild(notebooksTitle);
      const refresh = createButton(notebookState.loading ? "加载中..." : "加载笔记本");
      refresh.disabled = notebookState.loading;
      refresh.addEventListener("click", loadNotebooks);
      notebooksHeader.appendChild(refresh);
      notebooksSection.appendChild(notebooksHeader);
      const notebooksHint = document.createElement("p");
      notebooksHint.textContent = "none 会对 AI 隐藏笔记本；r 只读；rw 允许创建和编辑；rwd 允许删除。";
      notebooksSection.appendChild(notebooksHint);
      if (notebookState.error) {
        const error = document.createElement("div");
        error.className = "siyuan-ai-mcp-bridge-error";
        error.textContent = `加载失败：${notebookState.error}`;
        notebooksSection.appendChild(error);
      }
      if (notebookState.notebooks.length > 0) {
        const table = document.createElement("table");
        table.className = "siyuan-ai-mcp-bridge-table";
        table.innerHTML = "<thead><tr><th>笔记本</th><th>ID</th><th>笔记权限</th></tr></thead>";
        const tbody = document.createElement("tbody");
        for (const notebook of notebookState.notebooks) {
          const row = document.createElement("tr");
          const name = document.createElement("td");
          name.textContent = notebook.name || notebook.id;
          row.appendChild(name);
          const id = document.createElement("td");
          id.textContent = notebook.id;
          row.appendChild(id);
          const permission = document.createElement("td");
          const current = draftConfig.notebookPermissions[notebook.id] || "inherit";
          const select = createSelect(current, permissionOptions);
          select.dataset.notebookPermission = notebook.id;
          select.addEventListener("change", () => {
            markUnsaved("笔记权限有未保存修改，保存后才会对 MCP 生效。");
          });
          permission.appendChild(select);
          row.appendChild(permission);
          tbody.appendChild(row);
        }
        table.appendChild(tbody);
        notebooksSection.appendChild(table);
      } else if (!notebookState.loading) {
        const empty = document.createElement("p");
        empty.textContent = "点击“加载笔记本”后可覆盖单个笔记本权限。";
        notebooksSection.appendChild(empty);
      }

      const actions = document.createElement("div");
      actions.className = "siyuan-ai-mcp-bridge-actions";
      notebooksSection.appendChild(actions);

      const save = createButton("保存配置", "primary");
      save.addEventListener("click", () => saveFromForm("note-permissions"));
      actions.appendChild(save);

      const reset = createButton("恢复只读默认");
      reset.addEventListener("click", async () => {
        await this.saveConfig(defaultConfig);
        draftConfig = normalizeConfig(this.config);
        notebookState = {...notebookState, error: ""};
        activeSection = "note-permissions";
        saveState = {
          status: "saved",
          message: "已恢复只读默认并保存。"
        };
        showMessage(this.text("settingsReset", "MCP bridge settings reset"));
        render();
      });
      actions.appendChild(reset);
      permissions.appendChild(notebooksSection);
      content.appendChild(permissions);

      const toolsSection = document.createElement("section");
      toolsSection.className = "siyuan-ai-mcp-bridge-card";
      toolsSection.dataset.section = "feature-permissions";
      const toolsTitle = document.createElement("div");
      toolsTitle.className = "siyuan-ai-mcp-bridge-tool-title";
      toolsTitle.textContent = "功能权限";
      toolsSection.appendChild(toolsTitle);
      const toolsHint = document.createElement("p");
      toolsHint.textContent = "控制 AI 可以调用哪些动作。功能关闭时任何笔记都不能调用；功能开启后，仍必须满足笔记权限。";
      toolsSection.appendChild(toolsHint);
      for (const group of toolGroups) {
        const groupElement = document.createElement("div");
        groupElement.className = "siyuan-ai-mcp-bridge-tool-group";
        const groupTitle = document.createElement("div");
        groupTitle.className = "siyuan-ai-mcp-bridge-tool-title";
        groupTitle.textContent = group.title;
        groupElement.appendChild(groupTitle);
        const groupDesc = document.createElement("p");
        groupDesc.textContent = group.description;
        groupElement.appendChild(groupDesc);
        const toolGrid = document.createElement("div");
        toolGrid.className = "siyuan-ai-mcp-bridge-tools";
        for (const [key, label] of group.tools) {
          const item = document.createElement("label");
          item.className = "siyuan-ai-mcp-bridge-check";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.dataset.tool = key;
          checkbox.checked = draftConfig.tools[key] === true;
          checkbox.addEventListener("change", () => {
            markUnsaved("正在保存功能权限...");
            saveFeaturePermissions(false).catch((error) => {
              saveState = {
                status: "dirty",
                message: `保存失败：${error instanceof Error ? error.message : String(error)}`
              };
              updateSaveState();
            });
          });
          item.appendChild(checkbox);
          const text = document.createElement("span");
          text.textContent = label;
          item.appendChild(text);
          toolGrid.appendChild(item);
        }
        groupElement.appendChild(toolGrid);
        toolsSection.appendChild(groupElement);
      }
      const toolActions = document.createElement("div");
      toolActions.className = "siyuan-ai-mcp-bridge-actions";
      const saveTools = createButton("保存功能权限", "primary");
      saveTools.addEventListener("click", () => saveFeaturePermissions(true));
      toolActions.appendChild(saveTools);
      const saveStatus = document.createElement("span");
      saveStatus.className = "siyuan-ai-mcp-bridge-save-state";
      saveStatus.dataset.saveState = "true";
      saveStatus.dataset.status = saveState.status;
      saveStatus.textContent = saveState.message;
      toolActions.appendChild(saveStatus);
      toolsSection.appendChild(toolActions);
      content.appendChild(toolsSection);

      const advanced = document.createElement("details");
      advanced.className = "siyuan-ai-mcp-bridge-card";
      advanced.dataset.section = "advanced";
      const summary = document.createElement("summary");
      summary.textContent = "高级：当前配置 JSON";
      advanced.appendChild(summary);
      const json = document.createElement("pre");
      json.textContent = JSON.stringify(draftConfig, null, 2);
      advanced.appendChild(json);
      content.appendChild(advanced);
      setActiveSection(activeSection);
      const activeTarget = content.querySelector(`[data-section="${activeSection}"]`);
      if (activeTarget && activeSection !== "connection") {
        activeTarget.scrollIntoView({block: "start"});
      }
    };
    render();
    if (!didAutoDetectConnection) {
      didAutoDetectConnection = true;
      setTimeout(() => detectCurrentConnection(), 0);
    }
  }
}

module.exports = SiyuanAiMcpBridgePlugin;
