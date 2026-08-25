---
title: 安裝
description: 安裝 nexcode(nxc)代理及其前置條件,並驗證它能夠執行。
---

安裝 nexcode 後會得到 `nxc` 和 `nexcode` 兩個等價命令，它們都指向同一個基於 Bun 的
小型本機 HTTP 伺服器。模型請求會發往路由所選的 provider；當已路由模型需要時，可選的
vision 和網路搜尋 sidecar 也可以使用你的 ChatGPT 登入憑證。

## 前置條件

| 要求 | 原因 |
| --- | --- |
| **[Node](https://nodejs.org) ≥ 18** | `nxc` 執行在 Bun 執行環境上，但執行環境會在 `npm install` 時自動打包，你**無需**自己安裝 Bun。 |
| **[OpenAI Codex](https://openai.com/codex)**(CLI、App 或 SDK) | nexcode 所代理的用戶端。nexcode 會寫入 `$CODEX_HOME/config.toml`（預設 `~/.codex/config.toml`）。 |
| 一個 provider 帳號或 API key | Anthropic、xAI、Kimi、Ollama Cloud、OpenRouter、OpenAI API key、一個 OpenAI 相容端點,或你的 ChatGPT 登入憑證。 |

## 安裝

```bash
npm install -g @bitkyc08/nexcode
```

:::note[npm 攔截了 bun postinstall？]
較新的 npm 可能會攔截 bun 的 postinstall 指令碼（`npm warn install-scripts ...
blocked because they are not covered by allowScripts`），導致捆綁的 Bun
執行環境未能就緒。請允許 bun 指令碼後重新安裝。注意 npm 警告給出的縮寫命令
缺少包名，會把目前目錄重新安裝進去，請始終顯式寫上包名：

```bash
npm install -g --allow-scripts=bun @bitkyc08/nexcode

# 如果最初是用 sudo 安裝的，請繼續使用 sudo：
sudo npm install -g --allow-scripts=bun @bitkyc08/nexcode
```

:::

確認兩個命令都已加入 `PATH`：

```bash
nxc --version
nexcode --version
```

### 釋出渠道

穩定的 `latest` 渠道已經包含 ChatGPT、OpenAI API key、OpenRouter 以及實驗性 Cursor 路由所需的
GPT-5.6 Sol/Terra/Luna 目錄資訊，但這些條目本身不會授予上游模型權限。只有在測試尚未正式釋出的
nexcode 建置時，才需要使用 preview 渠道：

```bash
npm install -g @bitkyc08/nexcode@preview
nxc update --tag preview
```

## 從原始碼執行

若要對 nexcode 本身進行開發:

```bash
git clone https://github.com/lidge-jun/nexcode.git
cd nexcode
bun install
bun run dev:proxy   # 以開發模式啟動代理 API (src/cli/index.ts start)
bun run dev:gui     # 啟動儀表板 dev 伺服器 (另一個終端)
```

`bun run dev` 作為 `bun run dev:proxy` 的別名保留。代理 API 暴露 `/healthz`、`/v1/responses`、
`/api/*`;只有在 `bun run build:gui` 生成 `gui/dist` 之後,`GET /` 才會提供打包後的儀表板。
開發儀表板時,請用 `bun run dev:gui` 單獨執行前端。

## 會建立哪些內容

nexcode 狀態檔案位於 `$NEXCODE_HOME`（預設 `~/.nexcode`），Codex 整合檔案位於
`$CODEX_HOME`（預設 `~/.codex`）。

| 路徑 | 用途 |
| --- | --- |
| `$NEXCODE_HOME/config.json` | 你的 provider、預設 provider、埠及選項。 |
| `$NEXCODE_HOME/nxc.pid` | 正在執行的代理的 PID（單例項保護）。 |
| `$NEXCODE_HOME/runtime-port.json` | 目前 PID、主機名和埠，包括自動選擇的備用埠。 |
| `$NEXCODE_HOME/auth.json` | 執行 `nxc login` 後儲存的 OAuth 憑證。 |
| `$NEXCODE_HOME/catalog-backup*.json` | nexcode 修改 Codex 模型目錄前建立的備份。 |
| `$CODEX_HOME/config.toml` | 僅監聽迴環地址時，nexcode 會新增由自身標記管理的根級 `openai_base_url`；監聽非迴環地址時，則使用 `model_provider = "nexcode"` 和 `[model_providers.nexcode]`，以便 Codex 傳送 API 認證 header。 |
| `$CODEX_HOME/nexcode.config.toml` | 與 Codex 主設定一同寫入的備用/參考 profile。 |
| `$CODEX_HOME/nexcode-catalog.json` | 供 Codex 使用的原生與已路由模型目錄。 |

:::note
nexcode 絕不會刪除你的 Codex 設定。每次注入都是可逆的 —— `nxc stop`、`nxc restore`
或 `nxc eject` 會精確剝離 nexcode 所新增的那些行,並恢復原生 Codex。
:::

## 下一步

繼續閱讀 [快速入門](/zh-tw/getting-started/quickstart/) 以設定你的第一個 provider,
或閱讀 [運作原理](/zh-tw/getting-started/how-it-works/) 瞭解其架構。
