---
title: Kurulum
description: nexcode (nxc) proxy'sini ve ön koşullarını kurun, çalıştığını doğrulayın.
---

nexcode, `nxc` ve `nexcode` olmak üzere iki eşdeğer komut adı kurar. Her
ikisi de aynı küçük yerel HTTP sunucusunu (Bun üzerinde oluşturulmuştur)
başlatır. Model istekleri yönlendirme tarafından seçilen sağlayıcıya gider;
isteğe bağlı vizyon ve web araması sidecar'ları, yönlendirilen bir model ihtiyaç
duyduğunda ChatGPT oturumunuzu da kullanabilir.

## Ön Koşullar

| Gereksinim | Neden |
| --- | --- |
| **[Node](https://nodejs.org) ≥ 18** | `nxc` Bun çalışma zamanı üzerinde çalışır, ancak çalışma zamanı `npm install` sırasında otomatik olarak paketlenir — Bun'ı kendiniz kurmanız **gerekmez**. |
| **[OpenAI Codex](https://openai.com/codex)** (CLI, App veya SDK) | nexcode'in önünde durduğu istemci. nexcode `$CODEX_HOME/config.toml` (varsayılan `~/.codex/config.toml`) dosyasına yazar. |
| Bir sağlayıcı hesabı veya API anahtarı | Anthropic, xAI, Kimi, Ollama Cloud, OpenRouter, OpenAI uyumlu bir uç nokta veya ChatGPT oturumunuz. |

## Kurulum

```bash
npm install -g @bitkyc08/nexcode
```

:::note[npm bun postinstall betiğini engelledi mi?]
Son npm sürümleri, bun'ın postinstall betiğini engelleyebilir (`npm warn
install-scripts ... blocked because they are not covered by allowScripts`), bu
da paketlenmiş Bun çalışma zamanını hazırlanmamış bırakır. Bun'ın betiğine izin
vererek yeniden kurun — ve her zaman paket adını ekleyin (npm'nin kısaltılmış
önerisi paket adını atlar ve bu da geçerli dizini yeniden kurmaya çalışır):

```bash
npm install -g --allow-scripts=bun @bitkyc08/nexcode

# orijinal kurulum sudo kullandıysa, sudo kullanmaya devam edin:
sudo npm install -g --allow-scripts=bun @bitkyc08/nexcode
```
:::

Her iki komut takma adının da `PATH` üzerinde olduğunu doğrulayın:

```bash
nxc --version
nexcode --version
```

### Sürüm kanalları

Kararlı `latest` kanalı; ChatGPT, OpenAI API anahtarı, OpenRouter ve deneysel
Cursor rotaları için GPT-5.6 Sol/Terra/Luna katalog desteğini zaten içerir.
Yukarı akış erişimi hala hesap geçişlidir; katalog girdileri tek başlarına
erişim sağlamaz. Önizleme kanalını yalnızca yayınlanmamış nexcode
derlemelerini test etmek için kullanın:

```bash
npm install -g @bitkyc08/nexcode@preview
nxc update --tag preview
```

## Kaynaktan çalıştırma

nexcode'in kendisi üzerinde geliştirmeler yapmak için:

```bash
git clone https://github.com/lidge-jun/nexcode.git
cd nexcode
bun install
bun run dev:proxy   # geliştirme modunda proxy API'sini başlatır (src/cli/index.ts start)
bun run dev:gui     # kontrol paneli geliştirme sunucusunu başlatır (başka bir terminal)
```

`bun run dev`, `bun run dev:proxy` komutunun bir takma adıdır. Proxy API'si
`/healthz`, `/v1/responses` ve `/api/*` uç noktalarını sunar; `GET /`, yalnızca
`bun run build:gui` komutu `gui/dist` çıktısını ürettikten sonra paketlenmiş
kontrol panelini sunar. Kontrol paneli üzerinde geliştirme yaparken ön ucu ayrı
olarak `bun run dev:gui` ile çalıştırın.

## Neler oluşturulur?

nexcode durumu `$NEXCODE_HOME` (varsayılan `~/.nexcode`) altında tutulur.
Codex entegrasyon dosyaları `$CODEX_HOME` (varsayılan `~/.codex`) altında yer
alır.

| Yol | Amaç |
| --- | --- |
| `$NEXCODE_HOME/config.json` | Sağlayıcılarınız, varsayılan sağlayıcı, port ve seçenekler. |
| `$NEXCODE_HOME/nxc.pid` | Çalışan proxy'nin PID'si (tek örnek koruması). |
| `$NEXCODE_HOME/runtime-port.json` | Otomatik olarak seçilen bir yedek port dahil olmak üzere canlı PID, ana bilgisayar adı ve port. |
| `$NEXCODE_HOME/auth.json` | Saklanan OAuth kimlik bilgileri (`nxc login` yaptığınızda). |
| `$NEXCODE_HOME/catalog-backup*.json` | nexcode düzenlemeden önce alınan Codex model kataloğu yedekleri. |
| `$CODEX_HOME/config.toml` | Geri döngüde nexcode işaretçi sahipliğindeki kök `openai_base_url` ekler; geri döngü olmayan bağlantılar `model_provider = "nexcode"` artı `[model_providers.nexcode]` kullanır, böylece Codex API kimlik doğrulama başlığını gönderebilir. |
| `$CODEX_HOME/nexcode.config.toml` | Ana Codex yapılandırmasının yanında yazılan yedek/referans profili. |
| `$CODEX_HOME/nexcode-catalog.json` | Codex tarafından kullanılan senkronize edilmiş yerel ve yönlendirilen model kataloğu. |

:::note
nexcode asla Codex yapılandırmanızı silmez. Her enjeksiyon tersine
çevrilebilir — `nxc stop`, `nxc restore` veya `nxc eject`, tam olarak
nexcode'in eklediği satırları kaldırır ve yerel Codex'i geri yükler.
:::

## Sonraki Adımlar

İlk sağlayıcınızı yapılandırmak için [Hızlı
Başlangıç](/tr/getting-started/quickstart/) ile devam edin veya mimari için
[Nasıl Çalışır](/tr/getting-started/how-it-works/) bölümünü okuyun.


