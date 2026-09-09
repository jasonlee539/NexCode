<p align="center">
  <img src="desktop/assets/NexCode-1024.png" alt="NexCode logo" width="112">
</p>

<h1 align="center">NexCode</h1>

<p align="center">
  <strong>在 macOS、Windows 和 Ubuntu 上管理 Codex 账号、线程、用量与 Skills。</strong><br>
  <strong>Manage Codex accounts, threads, usage, and Skills on macOS, Windows, and Ubuntu.</strong>
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

<p align="center">
  <img src="pic/1.png" alt="NexCode 仪表盘 / NexCode dashboard" width="100%">
</p>

---

## 中文

NexCode 是一款面向 Codex 用户的跨平台桌面软件。它把分散在本机文件、
数据库和命令行中的账号、对话线程、Token 用量与 Skills 汇总到一个清晰的管理界面中，
并随应用启动所需的本地管理环境。模型请求始终由 Codex 直接连接 OpenAI，
不会经过 NexCode 的本地端口。

日常使用不需要打开浏览器，也不需要手动查找 Codex 的本地数据文件。除登录授权外，
账号管理、线程查看、用量统计、Skills 管理和维护操作都可以直接在 NexCode 中完成。

### 核心功能

#### 1. Codex 多账号管理

- 连接并集中管理多个 ChatGPT / Codex 账号。
- 查看账号状态、套餐信息和可用配额。
- 切换账号时会关闭运行中的 Codex、原子替换原生登录并保留旧账号，重新打开 Codex 后即可使用。
- 登录凭据与运行数据保存在本机 `~/.nexcode`，也可通过 `NEXCODE_HOME` 更改目录。

#### 2. 本地线程中心

- 自动读取本机 Codex 对话线程。
- 按标题、项目、模型或线程 ID 搜索。
- 查看渲染后的完整对话，并按线程状态筛选。
- 导出需要保留或分享的线程内容。

#### 3. Token 用量分析

- 按 1 天、3 天、7 天或 30 天查看本机 Codex 用量。
- 分别统计输入、输出、缓存输入与推理 Token。
- 展示每日趋势、Token 构成和高用量线程排行。
- 统计数据直接来自本机 Codex 线程记录，不把缺失数据误显示为零。

<p align="center">
  <img src="pic/2.png" alt="NexCode Token 用量分析" width="100%">
  <br>
  <sub>按时间范围查看 Token 趋势、构成与线程排行</sub>
</p>

#### 4. Codex Skills 管理

- 统一查看 Codex 发现的个人、项目和内置 Skills。
- 新建、查看和编辑 Skill，也可将不再需要的 Skill 移入可恢复回收区。
- 按名称、说明或路径搜索，同时保护内置及嵌套 Skills，避免误改。

#### 5. 一键诊断与维护

- 检查 Codex 配置、认证、线程数据库、Skills 目录和 NexCode 运行环境。
- 修复启动器、模型目录、运行缓存及可识别的第三方代理配置冲突。
- 清理冗余认证备份、旧目录备份和失效快照，同时保留当前认证与活动数据。

#### 6. 跨平台桌面体验

- 在 macOS、Windows 和 Ubuntu 上提供独立桌面窗口，不必常驻浏览器页面。
- 自动启动内置运行环境并发现可用的本地端口。
- OAuth 登录在系统浏览器中完成，随后自动返回应用。
- 提供 macOS DMG 和便携 ZIP、Windows Setup，以及 Ubuntu DEB 安装包。

### 数据范围

NexCode 的线程和用量页面只读取本机 Codex 记录。软件不会把没有归属信息的 Token
重复分摊到各账号，也不会把缺失统计当作零。桌面运行环境只提供管理页面和管理 API，
不开放模型转发端点；模型请求由 Codex 使用当前原生登录直接发送到 OpenAI。

### 下载与安装

| 平台 | 架构 | 下载 | 安装方式 |
| --- | --- | --- | --- |
| macOS 13+ | Apple Silicon（arm64） | [DMG 安装版](https://github.com/jasonlee539/NexCode/releases/download/v1.0.0/NexCode.dmg) · [便携 ZIP](https://github.com/jasonlee539/NexCode/releases/download/v1.0.0/NexCode-portable-macos-arm64.zip) | 打开 DMG 并拖入“应用程序”，或解压 ZIP 后直接运行 |
| Windows | x64 | [Setup EXE](https://github.com/jasonlee539/NexCode/releases/download/v1.0.0/NexCode-Setup-1.0.0-x64.exe) | 运行安装程序并按提示完成安装 |
| Ubuntu 22.04+ | amd64 | [DEB 安装包](https://github.com/jasonlee539/NexCode/releases/download/v1.0.0/nexcode-ubuntu_1.0.0_amd64.deb) | 下载后运行 `sudo apt install ./nexcode-ubuntu_1.0.0_amd64.deb` |

全部版本和更新记录见 [GitHub Releases](https://github.com/jasonlee539/NexCode/releases)。

### 从源码构建 macOS 版

从源码构建需要 macOS 13 或更高版本、Node.js 18+ 和 Apple Command Line Tools：

```bash
npm install --no-audit --no-fund
npm run desktop:build
open dist/NexCode.app
```

构建产物为 `dist/NexCode.app`。如需生成可拖入“应用程序”目录的安装镜像：

```bash
npm run desktop:dmg
```

安装镜像将写入 `dist/NexCode.dmg`。免安装便携版可通过下列命令生成：

```bash
npm run desktop:portable
```

便携版将写入 `dist/NexCode-portable-macos-arm64.zip`。应用包内已包含 Bun、运行时源码、生产版管理界面
和运行依赖，移出源码目录后仍可独立运行。

---

## English

NexCode is a cross-platform desktop app for Codex users. It brings accounts,
conversation threads, token usage, and Skills—normally spread across local
files, databases, and command-line tools—into one focused interface. The app
also starts the local management runtime required for its Codex integration.
Model requests continue to connect directly from Codex to OpenAI and never pass
through NexCode's local port.

There is no browser dashboard to keep open and no need to locate Codex data
files manually. Apart from browser-based sign-in, account management, thread
inspection, usage analysis, Skills management, and maintenance all happen
inside NexCode.

### Core features

#### 1. Multiple Codex accounts

- Connect and manage multiple ChatGPT / Codex accounts in one place.
- Review account status, plan information, and available quota.
- Switch the native Codex login atomically after closing running Codex processes, while retaining the previous account for later use.
- Keep credentials and runtime data under `~/.nexcode`, or set `NEXCODE_HOME` to use another directory.

#### 2. Local thread library

- Discover conversations from the local Codex thread database automatically.
- Search by title, project, model, or thread ID.
- Filter thread states and read a rendered version of the full conversation.
- Export threads that need to be archived or shared.

#### 3. Token usage analytics

- Inspect local Codex usage over 1, 3, 7, or 30 days.
- Separate input, output, cached-input, and reasoning tokens.
- See daily trends, token composition, and the highest-usage threads.
- Read usage directly from local Codex records without presenting missing data as zero.

<p align="center">
  <img src="pic/2.png" alt="NexCode token usage analytics" width="100%">
  <br>
  <sub>Token trends, composition, and thread rankings for the selected period</sub>
</p>

#### 4. Codex Skills management

- Browse personal, project, and built-in Skills discovered by Codex.
- Create, inspect, and edit Skills, or move unused Skills to recoverable trash.
- Search by name, description, or path while protecting bundled and nested Skills from accidental changes.

#### 5. Diagnostics and maintenance

- Check Codex configuration, authentication, thread storage, Skills directories, and the NexCode runtime.
- Repair launcher state, managed model catalogs, runtime caches, and recognized third-party proxy conflicts.
- Remove redundant authentication backups, old directory backups, and stale snapshots while preserving current credentials and active data.

#### 6. Cross-platform desktop experience

- Run in a dedicated desktop window on macOS, Windows, or Ubuntu without keeping a browser page open.
- Start the bundled runtime and discover an available local port automatically.
- Complete OAuth in the system browser and return to the app automatically.
- Install from a macOS DMG, Windows Setup executable, or Ubuntu DEB, or use the portable macOS ZIP.

### Data scope

The thread and usage views read local Codex records only. NexCode does not
duplicate unattributed token totals across accounts or represent missing usage
as zero. The desktop runtime serves only the management UI and API; Codex sends
model requests directly to OpenAI with the active native login.

### Download and install

| Platform | Architecture | Download | Installation |
| --- | --- | --- | --- |
| macOS 13+ | Apple Silicon (arm64) | [DMG](https://github.com/jasonlee539/NexCode/releases/download/v1.0.0/NexCode.dmg) · [Portable ZIP](https://github.com/jasonlee539/NexCode/releases/download/v1.0.0/NexCode-portable-macos-arm64.zip) | Open the DMG and drag NexCode to Applications, or extract the ZIP and run the app |
| Windows | x64 | [Setup EXE](https://github.com/jasonlee539/NexCode/releases/download/v1.0.0/NexCode-Setup-1.0.0-x64.exe) | Run the installer and follow its prompts |
| Ubuntu 22.04+ | amd64 | [DEB package](https://github.com/jasonlee539/NexCode/releases/download/v1.0.0/nexcode-ubuntu_1.0.0_amd64.deb) | Download, then run `sudo apt install ./nexcode-ubuntu_1.0.0_amd64.deb` |

See [GitHub Releases](https://github.com/jasonlee539/NexCode/releases) for all builds and release notes.

### Build the macOS edition from source

Building from source requires macOS 13 or newer, Node.js 18+, and Apple Command
Line Tools:

```bash
npm install --no-audit --no-fund
npm run desktop:build
open dist/NexCode.app
```

The application is written to `dist/NexCode.app`. To create a
drag-to-Applications installer image, run:

```bash
npm run desktop:dmg
```

The installer is written to `dist/NexCode.dmg`. To build the portable archive, run
`npm run desktop:portable`; it writes `dist/NexCode-portable-macos-arm64.zip`.
The app bundles Bun, the runtime source, the production dashboard, and runtime dependencies, so it remains
self-contained after being moved out of the source directory.

---

## Project structure / 项目结构

- `desktop/` — native macOS host, branding assets, and `.app` / `.dmg` / portable ZIP packaging scripts
- `gui/` — React + Vite desktop interface
- `src/` — Bun TypeScript runtime, Codex integration, and management API
- `tests/` — runtime and GUI regression tests
- `docs-site/` — product documentation source

## License / 许可

NexCode is an independent derivative work. Parts of the underlying
implementation originate from the MIT-licensed OpenCodex project. The original
copyright notices and full license text are preserved in [LICENSE](LICENSE),
with derivative-work details in [NOTICE](NOTICE).

NexCode 是独立的派生作品。部分底层实现源自 MIT 许可的 OpenCodex，原版权声明和
许可全文保留在 [LICENSE](LICENSE)，派生说明见 [NOTICE](NOTICE)。

NexCode is not affiliated with or endorsed by OpenAI, Anthropic, or any model
provider. / NexCode 与 OpenAI、Anthropic 或任何模型服务商均无隶属或背书关系。
