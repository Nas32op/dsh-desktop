# 大啥鱼 — DeepSeek Harness Desktop

用 **Electron** 把 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 打包为纯净的桌面应用：开箱即用、无需安装 Node.js、与浏览器版完全一致。

![icon](build/icon.png)

## 特性

- **全内置**：应用自带官方 DeepSeek Harness 运行时与 Node 运行时，别的电脑装上即可用，无需任何预装。
- **纯净**：不包含任何开发者/使用者数据。会话、设置、密钥存放在用户自己的 `DSH_HOME`（默认 `~/.dsh`），由 dsh 首次运行时按官方方式自动初始化——与从 GitHub 官网安装命令行版完全一致。
- **零冲突**：`dsh web --port 0` 由系统分配空闲端口，与浏览器里已有的实例互不抢占。
- **进程隔离**：DSH 作为子进程运行（其原生模块 ABI 绑定自身 Node 运行时），崩溃不影响桌面外壳；退出时回收整棵进程树。

## 从源码构建

> 前置要求：**Node.js 20+**（自带 npm）；方式一还需 **pnpm**（`corepack enable` 或 `npm install -g pnpm`）。
> 需要网络（构建时从 npm 官方源与 nodejs.org 下载，一次性）、约 1.5 GB 磁盘空间。
> 构建产物面向 Windows x64。若只想使用，可直接从 **Releases** 下载预构建产物，无需自行构建。

### 方式一：pnpm（推荐）

```sh
# 1. 安装构建依赖（electron + electron-builder）
pnpm install

# 2. 准备内置运行时 ★关键步骤（约 10~15 分钟，一次性）
node scripts/prepare-resources.js

# 3. 打包
pnpm dist          # 同时产出 zip 便携版 + NSIS 安装程序
pnpm dist:zip      # 仅 zip 便携版
pnpm dist:nsis     # 仅安装程序
```

### 方式二：npm

```sh
npm install
# npm 12+ 会默认阻止 electron 下载二进制的安装脚本，需要批准后重跑；
# npm 11 及更早版本没有 install-scripts 命令，直接跳过这两步
npm install-scripts approve electron
npm install                            # 重跑一次以真正下载 electron 二进制
node scripts/prepare-resources.js
npx electron-builder --win             # 相当于 pnpm dist
```

> 若 `npm install` 提示还有其他包被阻止（install scripts blocked），同样执行 `npm install-scripts approve <包名>` 后重跑即可。

### 第 2 步具体做什么

`prepare-resources.js` 从官方源自动准备应用内置的运行时（不进入 git 仓库）：

1. 从 **npm 官方源**安装 `@deepseek-ai/dsh@0.1.0-rc.6` 及其运行时依赖到 `resources/dsh/`（约 550 个包）；
2. 自动批准原生构建脚本（koffi / node-pty / esbuild 等，npm 12+ 会默认阻止）并重跑安装；
3. 从 **nodejs.org** 下载官方 Node v24.16.0（Windows x64）到 `resources/node/`。

幂等：已就绪时自动跳过，`--force` 可强制重装。装好后 `pnpm dist` 打出的包即全内置——使用者无需安装 Node.js 或 DeepSeek Harness，双击即用。

### 产物

`release/` 下：

- `deepseek-harness-desktop-<version>-win-x64.zip` — 便携版压缩包，解压后运行 `DeepSeek Harness Desktop.exe`
- `deepseek-harness-desktop-<version>-setup.exe` — 安装程序，桌面/开始菜单快捷方式名为「大啥鱼」

## 数据与配置

| 路径 | 说明 |
|---|---|
| `~/.dsh`（DSH_HOME） | 会话记录、设置、密钥、profiles——首次运行自动初始化，与命令行版共享 |
| `文档/DeepSeek Harness` | 默认工作目录（workspace），可用 `DSH_WORKSPACE` 覆盖 |
| `%APPDATA%/大啥鱼/dsh-desktop.log` | 应用日志（含 dsh 子进程输出） |

### 环境变量（均为可选项）

| 变量 | 作用 |
|---|---|
| `DSH_DIR` | 覆盖 dsh 启动器目录（默认用内置 resources/dsh） |
| `DSH_NODE` | 覆盖 node 可执行文件（默认用内置 resources/node/node.exe） |
| `DSH_WORKSPACE` | 覆盖工作目录 |
| `DSH_WEB_PORT` | 固定端口（默认 0 = 系统分配） |
| `DSH_HOME` | 覆盖数据目录（默认 `~/.dsh`；想与命令行版隔离可设独立目录） |

## 项目结构

```
├── main.js                    # Electron 主进程（启动/回收 dsh 服务、创建窗口）
├── package.json               # 应用清单与构建脚本（pnpm start / dist / prepare:resources）
├── pnpm-lock.yaml             # 锁定的构建依赖版本
├── pnpm-workspace.yaml        # pnpm 构建脚本白名单（electron）
├── electron-builder.yml       # 打包配置（zip + NSIS）
├── .gitignore                 # 忽略 node_modules / release / 内置运行时
├── LICENSE                    # MIT
├── build/                     # 应用图标（由 dsy.png 生成）
├── dsy.png                    # 图标源文件
├── scripts/
│   ├── afterPack.js           # 打包后拷贝内置运行时到 resources/
│   └── prepare-resources.js   # 构建前从官方源准备内置运行时
└── resources/                 # 内置运行时（git 忽略，由 prepare-resources.js 生成，仓库中仅 .gitkeep）
```

## 排障

- 首次启动稍慢：dsh 需要初始化 profile，属正常。
- 启动报错或打不开：查看 `%APPDATA%/大啥鱼/dsh-desktop.log`。
- 安装程序被 SmartScreen 拦截：未做代码签名，选择"仍要运行"即可。

## 致谢

- 核心能力来自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT License）

## License

[MIT](LICENSE)
