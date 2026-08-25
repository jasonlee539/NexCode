---
title: Установка
description: Установите прокси nexcode (nxc) и необходимые компоненты и убедитесь, что он запускается.
---

nexcode устанавливает два эквивалентных имени команды: `nxc` и `nexcode`. Обе запускают один и
тот же небольшой локальный HTTP-сервер (построенный на Bun). Запросы к моделям идут к провайдеру,
выбранному маршрутизацией; опциональные сайдкары для vision и веб-поиска также могут использовать
ваш вход в ChatGPT, когда они нужны маршрутизируемой модели.

## Предварительные требования

| Требование | Зачем |
| --- | --- |
| **[Node](https://nodejs.org) ≥ 18** | `nxc` работает на рантайме Bun, но рантайм автоматически поставляется в комплекте при `npm install` — устанавливать Bun самостоятельно **не нужно**. |
| **[OpenAI Codex](https://openai.com/codex)** (CLI, App или SDK) | Клиент, перед которым работает nexcode. nexcode записывает данные в `$CODEX_HOME/config.toml` (по умолчанию `~/.codex/config.toml`). |
| Аккаунт провайдера или API-ключ | Anthropic, xAI, Kimi, Ollama Cloud, OpenRouter, OpenAI-совместимая конечная точка или ваш вход в ChatGPT. |

## Установка

```bash
npm install -g @bitkyc08/nexcode
```

:::note[npm заблокировал postinstall-скрипт bun?]
Свежие версии npm могут блокировать postinstall-скрипт bun (`npm warn
install-scripts ... blocked because they are not covered by allowScripts`),
из-за чего встроенный рантайм Bun остаётся неподготовленным. Переустановите
пакет, разрешив скрипт bun, — и обязательно указывайте имя пакета: в
сокращённой подсказке npm его нет, и без него вместо пакета переустановится
текущий каталог:

```bash
npm install -g --allow-scripts=bun @bitkyc08/nexcode

# если изначально устанавливали через sudo, продолжайте использовать sudo:
sudo npm install -g --allow-scripts=bun @bitkyc08/nexcode
```
:::

Убедитесь, что оба псевдонима команды доступны в `PATH`:

```bash
nxc --version
nexcode --version
```

### Каналы релизов

Стабильный канал `latest` уже включает поддержку каталога GPT-5.6 Sol/Terra/Luna для маршрутов
ChatGPT, OpenAI по API-ключу, OpenRouter и экспериментального Cursor. Доступ у вышестоящего
провайдера по-прежнему зависит от аккаунта; сами по себе записи каталога доступ не дают.
Используйте канал preview только для тестирования ещё не выпущенных сборок nexcode:

```bash
npm install -g @bitkyc08/nexcode@preview
nxc update --tag preview
```

## Запуск из исходного кода

Чтобы работать над самим nexcode:

```bash
git clone https://github.com/lidge-jun/nexcode.git
cd nexcode
bun install
bun run dev:proxy   # запускает API прокси в режиме разработки (src/cli/index.ts start)
bun run dev:gui     # запускает dev-сервер панели управления (в другом терминале)
```

`bun run dev` остаётся псевдонимом для `bun run dev:proxy`. API прокси предоставляет `/healthz`,
`/v1/responses` и `/api/*`; `GET /` отдаёт упакованную панель управления только после того, как
`bun run build:gui` создаст `gui/dist`. Пока вы работаете над панелью управления, запускайте
фронтенд отдельно командой `bun run dev:gui`.

## Что создаётся

Состояние nexcode хранится в `$NEXCODE_HOME` (по умолчанию `~/.nexcode`). Файлы интеграции
с Codex находятся в `$CODEX_HOME` (по умолчанию `~/.codex`).

| Путь | Назначение |
| --- | --- |
| `$NEXCODE_HOME/config.json` | Ваши провайдеры, провайдер по умолчанию, порт и параметры. |
| `$NEXCODE_HOME/nxc.pid` | PID запущенного прокси (защита от повторного запуска). |
| `$NEXCODE_HOME/runtime-port.json` | Текущие PID, имя хоста и порт, включая автоматически выбранный запасной порт. |
| `$NEXCODE_HOME/auth.json` | Сохранённые учётные данные OAuth (после `nxc login`). |
| `$NEXCODE_HOME/catalog-backup*.json` | Резервные копии каталога моделей Codex, создаваемые перед тем, как nexcode его изменит. |
| `$CODEX_HOME/config.toml` | На loopback-адресе nexcode добавляет корневой `openai_base_url`, отмеченный собственным маркером; при привязке не к loopback используются `model_provider = "nexcode"` и `[model_providers.nexcode]`, чтобы Codex мог отправлять заголовок API-аутентификации. |
| `$CODEX_HOME/nexcode.config.toml` | Резервный/справочный профиль, записываемый рядом с основной конфигурацией Codex. |
| `$CODEX_HOME/nexcode-catalog.json` | Синхронизированный каталог нативных и маршрутизируемых моделей, используемый Codex. |

:::note
nexcode никогда не удаляет вашу конфигурацию Codex. Каждое внедрение обратимо — `nxc stop`,
`nxc restore` или `nxc eject` убирают ровно те строки, которые добавил nexcode, и восстанавливают
нативный Codex.
:::

## Далее

Переходите к разделу [Быстрый старт](/ru/getting-started/quickstart/), чтобы настроить
первого провайдера, или прочитайте [Как это работает](/ru/getting-started/how-it-works/),
чтобы разобраться в архитектуре.
