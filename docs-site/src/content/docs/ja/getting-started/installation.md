---
title: インストール
description: nexcode(nxc)プロキシと前提条件をインストールし、正常に実行できるか確認します。
---

nexcode をインストールすると同じ実行ファイルを指す `nxc` と `nexcode` コマンドが一緒に提供されます。
どちらも Bun ベースの小さなローカル HTTP サーバーを実行します。モデルリクエストはルーティングで選ばれたプロバイダーに
転送され、必要に応じて vision とウェブ検索のサイドカーが ChatGPT ログインを使うこともあります。

## 前提条件

| 要件 | 理由 |
 --- | --- |
| **[Node](https://nodejs.org) ≥ 18** | `nxc` は Bun ランタイムで実行されますが、ランタイムは `npm install` 時に自動でバンドルされるため、Bun を自分でインストールする必要は**ありません**。 |
| **[OpenAI Codex](https://openai.com/codex)**(CLI、App、または SDK) | nexcode が前に立つクライアントです。nexcode は `$CODEX_HOME/config.toml`(デフォルト `~/.codex/config.toml`)に書き込みます。 |
| プロバイダーアカウントまたは API キー | Anthropic、xAI、Kimi、Ollama Cloud、OpenRouter、OpenAI API キー、OpenAI 互換エンドポイント、または ChatGPT ログイン。 |

## インストール

```bash
npm install -g @bitkyc08/nexcode
```

:::note[npm が bun の postinstall をブロックした?]
最新の npm は bun の postinstall スクリプトをブロックすることがあります(`npm warn
install-scripts ... blocked because they are not covered by allowScripts`)。
この場合バンドル Bun ランタイムが準備されないため、bun スクリプトを許可して
再インストールしてください。npm 警告の省略コマンドにはパッケージ名が含まれておらず、現在の
ディレクトリを再インストールしてしまうので、必ずパッケージ名を明示してください:

```bash
npm install -g --allow-scripts=bun @bitkyc08/nexcode

# 最初に sudo でインストールした場合は sudo を維持してください:
sudo npm install -g --allow-scripts=bun @bitkyc08/nexcode
```
:::

両方のコマンドが `PATH` にあることを確認します:

```bash
nxc --version
nexcode --version
```

### 配布チャネル

安定チャネルの `latest` にも ChatGPT、OpenAI API キー、OpenRouter、実験段階の Cursor 経路のための
GPT-5.6 Sol/Terra/Luna カタログ情報がすでに含まれています。ただしモデルの利用権まで付与されるわけでは
ありません。まだ正式配布されていない nexcode ビルドを試す場合のみ preview チャネルを使ってください:

```bash
npm install -g @bitkyc08/nexcode@preview
nxc update --tag preview
```

## ソースから実行

nexcode 自体を直接修正しながら作業するには:

```bash
git clone https://github.com/lidge-jun/nexcode.git
cd nexcode
bun install
bun run dev:proxy   # 開発モードでプロキシ API を起動 (src/cli/index.ts start)
bun run dev:gui     # ダッシュボード dev サーバーを起動 (別ターミナル)
```

`bun run dev` は `bun run dev:proxy` のエイリアスとして残っています。プロキシ API は `/healthz`、
`/v1/responses`、`/api/*` を公開し、`GET /` は `bun run build:gui` が `gui/dist` を生成した
後にのみパッケージされたダッシュボードを提供します。ダッシュボードを編集する際は `bun run dev:gui` でフロントエンドを
別途実行してください。

## 生成されるもの

nexcode の状態ファイルは `$NEXCODE_HOME`(デフォルト `~/.nexcode`)の下に、Codex 連携ファイルは
`$CODEX_HOME`(デフォルト `~/.codex`)の下に保存されます。

| パス | 用途 |
 --- | --- |
| `$NEXCODE_HOME/config.json` | プロバイダー、デフォルトプロバイダー、ポート、オプション。 |
| `$NEXCODE_HOME/nxc.pid` | 実行中のプロキシの PID(単一インスタンスガード)。 |
| `$NEXCODE_HOME/runtime-port.json` | 自動で選んだ代替ポートを含む現在の PID、ホスト名、ポート。 |
| `$NEXCODE_HOME/auth.json` | 保存された OAuth 認証情報(`nxc login` 時)。 |
| `$NEXCODE_HOME/catalog-backup*.json` | nexcode が変更する前に作成した Codex モデルカタログのバックアップ。 |
| `$CODEX_HOME/config.toml` | ローカル専用構成では nexcode が管理するルート `openai_base_url` を追加します。ローカル以外のアドレスにバインドする場合は Codex が API 認証ヘッダーを送れるよう `model_provider = "nexcode"` と `[model_providers.nexcode]` を使います。 |
| `$CODEX_HOME/nexcode.config.toml` | デフォルト Codex 設定と一緒に生成される参考用 fallback プロファイル。 |
| `$CODEX_HOME/nexcode-catalog.json` | Codex が使うネイティブおよびルーティングモデルカタログ。 |

:::note
nexcode は決して Codex 設定を削除しません。すべての注入は元に戻せます — `nxc stop`、`nxc restore`、
または `nxc eject` は nexcode が追加した行だけを正確に削除し、ネイティブ Codex を復元します。
:::

## 次へ

[クイックスタート](/ja/getting-started/quickstart/)に進んで最初のプロバイダーを設定するか、
アーキテクチャを知るには[仕組み](/ja/getting-started/how-it-works/)をお読みください。
