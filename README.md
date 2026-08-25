# NexCode

NexCode 是一款本地 AI 路由桌面软件。它把 Codex、Codex App、Claude Code、
Claude Desktop、Grok Build 及兼容客户端接入同一个本地代理，并提供完整的原生
macOS 应用与管理界面。

## 能力

- 兼容 OpenAI Responses、Chat Completions、Anthropic Messages 与实时传输。
- 支持内置及自定义 Provider、OAuth/API Key、模型发现与模型可见性管理。
- 支持组合路由、失败切换、权重路由、账号池、配额感知和线程亲和。
- 支持子代理模型路由、Web Search、视觉 sidecar、请求日志与用量分析。
- 管理 Codex、Claude Code/Desktop、Grok、OpenCode、MCode、ZCode 等本地集成。
- 提供配置备份/恢复、存储策略、兼容性实验室、健康检查和后台服务能力。
- 使用独立的 `~/.nexcode` 数据目录和 `NEXCODE_HOME` 环境变量。

## 本地构建

需要 macOS 13 或更高版本、Node.js 18+ 和 Apple Command Line Tools。

Source development requires the `bun` CLI on your `PATH`. This is separate from the published npm package's bundled Bun runtime, which is used only by installed `nxc` commands.

```bash
npm install --no-audit --no-fund
npm run desktop:build
open dist/NexCode.app
```

构建产物是 `dist/NexCode.app`；运行 `npm run desktop:dmg` 还会生成可拖入
“应用程序”目录的 `dist/NexCode.dmg`。应用包内包含 Bun、代理源码、生产 GUI 和运行时
依赖，不会读取相邻的 `opencodex` 目录；移动或删除参考目录后仍可独立运行。
日常使用直接双击 `NexCode.app`：管理界面由应用内置的 WebKit 窗口承载，不会
跳转到浏览器。桌面侧栏固定保留仪表盘、账号、线程、用量、Skills、维护和设置；
Provider、Claude 与图像相关界面不会进入桌面产品。只有 ChatGPT OAuth 授权页会打开
系统浏览器，完成后会自动唤回 NexCode 并继续账号验证。应用内部的回环服务只用于
本机进程通信，不作为桌面入口，也不会在界面展示 `127.0.0.1`。

## CLI

安装依赖后，也可以从源码运行：

```bash
node bin/nxc.mjs start
node bin/nxc.mjs status
node bin/nxc.mjs --help
```

默认管理界面为 `http://localhost:10100`。端口被占用时，NexCode 会选择可用端口，
桌面应用会自动发现实际地址。

## 源码结构

- `desktop/`：macOS 原生宿主、品牌资源和 `.app` 构建脚本。
- `gui/`：React + Vite 管理界面。
- `src/`：Bun TypeScript 代理、Provider、路由、集成和管理 API。
- `tests/`：核心与 GUI 回归测试。
- `docs-site/`：产品文档源码。

## 许可与来源

NexCode 是独立的派生作品。部分底层实现源自 MIT 许可的 OpenCodex，原版权声明
和许可全文保留在 [LICENSE](LICENSE)，派生说明见 [NOTICE](NOTICE)。NexCode 与
OpenAI、Anthropic 或任何模型服务商均无隶属或背书关系；使用第三方服务前请确认
其当前条款允许相应接入方式。

# NexCode
