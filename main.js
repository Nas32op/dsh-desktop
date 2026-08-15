// ============================================================================
// 大啥鱼 — DeepSeek Harness 桌面版（Electron 主进程）
// ----------------------------------------------------------------------------
// 原理：DeepSeek Harness 本身就是"本地 Web 应用"（dsh web 在 127.0.0.1 上
// 提供完整 GUI）。本程序以子进程方式拉起 `dsh web --port 0`，解析它打印的
// URL（如 `dsh web: http://127.0.0.1:14517`），再用 BrowserWindow 加载该地址；
// 窗口关闭/应用退出时回收整棵进程树。
//
// 纯净性设计：
//  - 应用自带官方 DeepSeek Harness 运行时（resources/dsh，来自 npm 官方包）
//    与 Node 运行时（resources/node/node.exe），不含任何本机数据；
//  - 数据目录 DSH_HOME（默认 ~/.dsh）由 dsh 在用户机器上首次运行时自动
//    初始化，与官方命令行行为一致，天然干净；
//  - 不硬编码任何本机路径；DSH_DIR / DSH_NODE 仅为开发/调试覆盖项。
// ============================================================================

"use strict";

const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const APP_NAME = "大啥鱼";
const LAUNCH_TIMEOUT_MS = 90_000; // 首次启动要初始化 profile，给足时间

let child = null;        // dsh 子进程
let mainWindow = null;   // 主窗口
let shuttingDown = false;

// ---------------------------------------------------------------------------
// 日志：同时写控制台与 userData 下的日志文件，便于排查
// ---------------------------------------------------------------------------
function logFile() {
  return path.join(app.getPath("userData"), "dsh-desktop.log");
}
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try { fs.appendFileSync(logFile(), line + "\n"); } catch { /* ignore */ }
  console.log(line);
}

// ---------------------------------------------------------------------------
// 定位内置资源：打包后位于 process.resourcesPath，开发模式位于项目 resources/
// ---------------------------------------------------------------------------
function bundledPath(...segments) {
  if (process.resourcesPath) {
    const p = path.join(process.resourcesPath, ...segments);
    if (fs.existsSync(p)) return p;
  }
  const dev = path.join(__dirname, "resources", ...segments);
  return fs.existsSync(dev) ? dev : null;
}

// ---------------------------------------------------------------------------
// 定位 dsh 启动器与 node 可执行文件
// 解析顺序：环境变量覆盖 → 应用内置资源 → PATH 上的 dsh / node
// ---------------------------------------------------------------------------
function findDsh() {
  if (process.env.DSH_DIR) {
    const dir = process.env.DSH_DIR;
    const binJs = path.join(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    if (fs.existsSync(binJs)) return { kind: "node", binJs };
    const cmd = path.join(dir, "dsh.cmd");
    if (process.platform === "win32" && fs.existsSync(cmd)) return { kind: "cmd", cmd };
    const sh = path.join(dir, "dsh");
    if (fs.existsSync(sh)) return { kind: "sh", sh };
  }
  const bundled = bundledPath("dsh", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  if (bundled) return { kind: "node", binJs: bundled };
  return null; // PATH 上的 dsh 不再兜底，避免把别的机器上的随意 dsh 拉进来
}

function findNode() {
  if (process.env.DSH_NODE && fs.existsSync(process.env.DSH_NODE)) return process.env.DSH_NODE;
  const bundled = bundledPath("node", "node.exe");
  if (bundled && process.platform === "win32") return bundled;
  return "node";
}

// ---------------------------------------------------------------------------
// 子进程回收：Windows 上必须杀整棵进程树（dsh 会再拉起 pwsh / node 子进程）
// ---------------------------------------------------------------------------
function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {});
    } else {
      process.kill(pid, "SIGTERM");
      setTimeout(() => { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }, 2000).unref();
    }
  } catch { /* already gone */ }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down, stopping dsh server");
  if (child && child.pid) killTree(child.pid);
  child = null;
  app.exit(code ?? 0);
}

// ---------------------------------------------------------------------------
// 启动 dsh web 子进程，解析其打印的 URL
// ---------------------------------------------------------------------------
function startDsh() {
  return new Promise((resolve, reject) => {
    const dsh = findDsh();
    if (!dsh) {
      reject(new Error(
        "找不到内置的 DeepSeek Harness 运行时（resources/dsh）。\n" +
        "可设置环境变量 DSH_DIR 指向 dsh 启动器所在目录后重试。"
      ));
      return;
    }

    // workspace 根目录：默认放在用户文档目录下，避免污染主目录
    const workspace = process.env.DSH_WORKSPACE || path.join(app.getPath("documents"), "DeepSeek Harness");
    try { fs.mkdirSync(workspace, { recursive: true }); } catch { /* 目录已存在或不可写 */ }

    const webArgs = ["web", "--port", process.env.DSH_WEB_PORT || "0", "--host", "127.0.0.1"];

    let command, args;
    if (dsh.kind === "node") {
      command = findNode();
      args = [dsh.binJs, ...webArgs];
    } else if (dsh.kind === "cmd") {
      command = process.env.ComSpec || "cmd.exe";
      args = ["/d", "/s", "/c", `"${dsh.cmd}" ${webArgs.join(" ")}`];
    } else {
      command = "sh";
      args = [dsh.sh, ...webArgs];
    }

    // 让 dsh 内部 spawn 的 "node" 也优先用内置运行时
    const nodeDir = path.dirname(command);
    const childEnv = {
      ...process.env,
      PATH: [nodeDir, process.env.PATH].filter(Boolean).join(path.delimiter),
    };

    log(`spawn: ${command} ${args.join(" ")}  (cwd=${workspace}, DSH_HOME=${process.env.DSH_HOME ?? "（默认 ~/.dsh）"})`);

    child = spawn(command, args, {
      cwd: workspace,
      env: childEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      log("timeout waiting for dsh web URL");
      killTree(child.pid);
      reject(new Error(`dsh 服务 ${LAUNCH_TIMEOUT_MS / 1000}s 内未就绪，请查看日志：${logFile()}`));
    }, LAUNCH_TIMEOUT_MS);

    let stderrTail = "";

    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      log(`[dsh] ${line}`);
      const m = line.match(/dsh web:\s*(https?:\/\/[^\s)]+)/);
      if (m) {
        clearTimeout(timer);
        log(`dsh web ready: ${m[1]}`);
        resolve(m[1]);
      }
    });
    readline.createInterface({ input: child.stderr }).on("line", (line) => {
      stderrTail = (stderrTail + "\n" + line).slice(-2000);
      log(`[dsh:err] ${line}`);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 dsh 子进程：${err.message}\n命令：${command} ${args.join(" ")}`));
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (!shuttingDown) {
        reject(new Error(
          `dsh 进程提前退出（code=${code}, signal=${signal}）\n` +
          (stderrTail ? `stderr:\n${stderrTail}` : "（无 stderr 输出）")
        ));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
function openWindow(url) {
  const origin = new URL(url).origin;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#0b1220",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(url);
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(origin)) return { action: "allow" }; // 同源弹窗（如 OAuth）放行
    shell.openExternal(target);                                  // 外链交给系统浏览器
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(origin)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });
  mainWindow.webContents.on("render-process-gone", (event, details) => {
    log(`renderer gone: ${details.reason}`);
    dialog.showErrorBox(APP_NAME, `界面进程异常退出（${details.reason}）。应用将关闭，可重新打开。`);
    shutdown(1);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (!shuttingDown) shutdown(0);
  });
}

// ---------------------------------------------------------------------------
// 菜单
// ---------------------------------------------------------------------------
function buildMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        { label: "退出", accelerator: "Alt+F4", click: () => shutdown(0) },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: APP_NAME,
              message: APP_NAME,
              detail:
                `DeepSeek Harness 桌面版 ${app.getVersion()}（Electron ${process.versions.electron}）\n\n` +
                `DSH_HOME: ${process.env.DSH_HOME ?? "（默认 ~/.dsh，首次运行自动初始化）"}\n` +
                `工作目录: ${process.env.DSH_WORKSPACE ?? "文档/DeepSeek Harness"}\n` +
                `日志文件: ${logFile()}`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// 应用生命周期
// ---------------------------------------------------------------------------
app.setName(APP_NAME);
app.setAppUserModelId("com.deepseek.harness.desktop");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      const url = await startDsh();
      openWindow(url);
    } catch (err) {
      log(`failed to start: ${err.message}`);
      dialog.showErrorBox(APP_NAME, `无法启动 DSH 服务：\n\n${err.message}`);
      shutdown(1);
    }
  });

  app.on("before-quit", () => {
    if (child && child.pid) killTree(child.pid);
    child = null;
  });

  app.on("window-all-closed", () => {
    // Windows：关窗口即退出并回收服务进程
    shutdown(0);
  });
}
