// electron-builder afterPack 钩子：把内置的 DeepSeek Harness 运行时与 Node
// 运行时拷贝到打包后的 resources/ 目录。
//
// 为什么不用 extraResources：electron-builder 的 copy filter 会排除拷贝源
// 根目录的 node_modules（filter.js 中 relative === "node_modules" 直接 false），
// 导致 resources/dsh/node_modules 整个被跳过。afterPack 用原生 fs 拷贝，
// 不受该限制，且 runs 于 asar 打包之后、zip/nsis 目标构建之前。
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** @param {import("electron-builder").AfterPackContext} context */
exports.default = async function afterPack(context) {
  const { appOutDir } = context;
  const projectDir = path.resolve(__dirname, "..");
  const destResources = path.join(appOutDir, "resources");

  for (const dir of ["dsh", "node"]) {
    const src = path.join(projectDir, "resources", dir);
    const dest = path.join(destResources, dir);
    if (!fs.existsSync(src)) throw new Error(`afterPack: missing ${src}`);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(`afterPack: copied ${src} -> ${dest}`);
  }
};
