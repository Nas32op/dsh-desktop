// ============================================================================
// prepare-resources.js — 准备内置运行时（构建前执行）
// ----------------------------------------------------------------------------
// 开源仓库不包含大体积二进制，运行时由本脚本从官方源自动获取：
//   1. resources/dsh  — 从 npm 官方源安装 DeepSeek Harness 运行时
//      （@deepseek-ai/dsh@0.1.0-rc.6 及其运行时依赖，与 GitHub 官方发布一致）
//   2. resources/node — 从 nodejs.org 下载官方 Node 运行时（Windows x64）
//
// 幂等：resources 已就绪时自动跳过；可用 --force 强制重新准备。
// 要求：Node.js 20+（自带 npm）。
// ============================================================================

"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// 与官方发布保持一致的版本常量（修改需同步验证）
const DSH_VERSION = "0.1.0-rc.6";
const NODE_VERSION = "v24.16.0";

// @deepseek-ai/dsh 的 devDependencies 中运行时实际需要的包
const EXTRA_PACKAGES = [
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-host-apiproxy",
  "@deepseek-ai/dsh-host-frontend-static",
  "@deepseek-ai/dsh-host-webserver",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-llm-mock-server",
  "@deepseek-ai/dsh-loader-smoke",
  "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-settings",
  "@deepseek-ai/dsh-subagent",
  "@deepseek-ai/dsh-system-prompt",
  "@deepseek-ai/dsh-tools",
];

// npm 12+ 会阻止原生构建脚本，需要显式批准（脚本：下载/编译原生模块）
const NATIVE_SCRIPTS = [
  "koffi",
  "node-pty",
  "@deepseek-ai/dsh-subprocess-local",
  "@google/genai",
  "protobufjs",
  "esbuild",
];

const ROOT = path.resolve(__dirname, "..");
const DSH_DIR = path.join(ROOT, "resources", "dsh");
const NODE_DIR = path.join(ROOT, "resources", "node");

function run(cmd, args, options) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\n失败：${cmd} ${args.join(" ")}（退出码 ${result.status}）`);
    process.exit(result.status ?? 1);
  }
}

function runCapture(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

async function download(url, dest) {
  console.log(`下载 ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status} ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const file = fs.createWriteStream(dest);
  await new Promise((resolve, reject) => {
    res.body.pipe(file);
    res.body.on("error", reject);
    file.on("finish", resolve);
    file.on("error", reject);
  });
  file.close();
  console.log(`已保存 ${dest}（${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB）`);
}

// ---------------------------------------------------------------------------
// resources/dsh：npm 官方安装 DeepSeek Harness 运行时
// ---------------------------------------------------------------------------
function prepareDsh(force) {
  const readyMarker = path.join(DSH_DIR, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  if (!force && fs.existsSync(readyMarker)) {
    console.log("[dsh] resources/dsh 已就绪，跳过（--force 可重装）");
    return;
  }
  fs.rmSync(DSH_DIR, { recursive: true, force: true });
  fs.mkdirSync(DSH_DIR, { recursive: true });

  const spec = [`@deepseek-ai/dsh@${DSH_VERSION}`, ...EXTRA_PACKAGES.map((p) => `${p}@${DSH_VERSION}`)];
  console.log(`[dsh] npm install ${spec.join(" ")}`);
  run("npm", ["install", "--prefix", DSH_DIR, ...spec, "--no-audit", "--no-fund"]);

  // npm 12+ 需要批准原生构建脚本后重跑一次
  const npmMajor = parseInt(runCapture("npm", ["--version"]).split(".")[0] ?? "0", 10);
  if (npmMajor >= 12) {
    console.log("[dsh] 批准原生构建脚本并重跑安装");
    run("npm", ["install-scripts", "--prefix", DSH_DIR, "approve", ...NATIVE_SCRIPTS]);
    run("npm", ["install", "--prefix", DSH_DIR, "--no-audit", "--no-fund"]);
  }

  if (!fs.existsSync(readyMarker)) throw new Error("resources/dsh 安装不完整：缺少 lib/bin.js");
  console.log(`[dsh] 完成（${(dirSize(DSH_DIR) / 1024 / 1024).toFixed(0)} MB）`);
}

// ---------------------------------------------------------------------------
// resources/node：官方 Node 运行时（Windows x64）
// ---------------------------------------------------------------------------
function prepareNode(force) {
  if (process.platform !== "win32") {
    console.warn("[node] 目前仅自动准备 Windows x64 运行时；请手动放置 resources/node/node.exe");
    return;
  }
  const exe = path.join(NODE_DIR, "node.exe");
  if (!force && fs.existsSync(exe)) {
    console.log("[node] resources/node 已就绪，跳过（--force 可重下）");
    return;
  }
  const zipName = `node-${NODE_VERSION}-win-x64.zip`;
  const zipPath = path.join(os.tmpdir(), zipName);
  const extractRoot = path.join(os.tmpdir(), "dsh-desktop-node-extract");

  fs.mkdirSync(NODE_DIR, { recursive: true });
  if (!fs.existsSync(zipPath)) {
    download(`https://nodejs.org/dist/${NODE_VERSION}/${zipName}`, zipPath);
  }
  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.mkdirSync(extractRoot, { recursive: true });
  console.log(`[node] 解压 ${zipName}`);
  run("tar", ["-xf", zipPath, "-C", extractRoot]);
  fs.copyFileSync(path.join(extractRoot, `node-${NODE_VERSION}-win-x64`, "node.exe"), exe);
  fs.rmSync(extractRoot, { recursive: true, force: true });
  console.log(`[node] 完成：${exe}（${(fs.statSync(exe).size / 1024 / 1024).toFixed(0)} MB）`);
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}

async function main() {
  const force = process.argv.includes("--force");
  console.log("准备内置运行时（DeepSeek Harness + Node）...\n");
  prepareDsh(force);
  prepareNode(force);
  console.log("\n全部就绪。现在可以执行 pnpm dist 打包。");
}

main().catch((err) => {
  console.error(`\n准备失败：${err.message}`);
  process.exit(1);
});
