---
title: opencode
description: opencode içerisinden yönlendirilen herhangi bir modeli kullanın — nexcode bir çalışma zamanı sağlayıcı bloğu enjekte eder ve kendi opencode yapılandırmanıza dokunmaz.
---

opencode, sağlayıcılarını ortam değişkenleri yerine birleştirilmiş JSON
yapılandırma katmanlarından okur, bu nedenle enjekte edilecek
`ANTHROPIC_BASE_URL` tarzı bir yuva yoktur. `nxc opencode` bu boşluğu doldurur:
proxy'nin çalıştığından emin olur, görünür katalogdan bir sağlayıcı bloğu
oluşturur ve bunu OpenCode'un satır içi çalışma zamanı katmanı
(`OPENCODE_CONFIG_CONTENT`) aracılığıyla enjekte eder.

## Hızlı Başlangıç

```bash
nxc opencode
```

Bu, proxy'nin çalıştığından emin olur ve bu süreç için yalnızca oluşturulan
`provider.nexcode` bloğu enjekte edilmiş olarak opencode'u başlatır. Fazladan
argümanlar doğrudan iletilir: `nxc opencode run "hello"`.

Yönlendirilen modeller seçicide `nexcode` sağlayıcısı altında görünür:

```text
nexcode/kiro/glm-5
nexcode/gpt-5.6-sol      # yerel slug'lar öneksiz kalır
```

## Kendi yapılandırmanız asla değiştirilmez

Başlatıcı `~/.config/opencode/opencode.json`, proje `opencode.json` /
`opencode.jsonc` veya diskteki başka bir yapılandırma katmanını kopyalamaz veya
yeniden yazmaz. Bir `provider.nexcode` geçersiz kılmasını algılamak için genel
veya proje yapılandırmasını okuyabilir, mevcut sağlayıcılarınız, ajanlarınız,
tuş atamalarınız, MCP girdileriniz ve göreli `{file:…}` referanslarınız orijinal
dosyalarından çözümlenmeye devam eder.

Yalnızca bu başlatma için nexcode, oluşturulan `provider.nexcode` bloğunu
OpenCode'un satır içi çalışma zamanı katmanı aracılığıyla ekler. Bu katman,
genel/özel/proje yapılandırmasından sonra birleşir ve alt süreç için yalnızca
çakışan anahtarları geçersiz kılar.

| Katman | `nxc opencode` ile Davranış |
| --- | --- |
| Genel / özel / proje yapılandırması | Tam olarak yazdığınız gibi diskte bırakılır |
| Satır içi çalışma zamanı (`OPENCODE_CONFIG_CONTENT`) | Yalnızca oluşturulan `provider.nexcode` bloğunu alır |
| Göreli `{file:…}` yolları | Yine de bunları ilk tanımlayan yapılandırma dosyasına göre çözümlenir |

Bir genel veya proje yapılandırması da `provider.nexcode` tanımlıyorsa,
başlatıcı bilgilendirici bir not yazdırır: `nxc opencode`'dan gelen çalışma
zamanı katmanı bu başlatma için onu geçersiz kılar.

## Bloğu kendi yapılandırmanıza yerleştirme

`nxc opencode`, sağlayıcı bloğunu yalnızca bir başlatma için enjekte eder; bu da
düz `opencode`'un proxy hakkında hala hiçbir şey bilmediği anlamına gelir.
Yönlendirilen modellerin düz `opencode`'dan — veya başlatıcıdan asla geçmeyen
bir düzenleyici uzantısından — kullanılabilir olmasını istediğinizde, `nxc
export` kendi yapılandırmanızla birleştirmeniz için aynı sağlayıcı bloğunu
yazdırır:

```bash
nxc export --client opencode
```

Proxy çalışıyor olmalıdır. Komut yapılandırmayı, kurallı hedefi
(`~/.config/opencode/opencode.json` veya ayarlandığında `XDG_CONFIG_HOME`
altında), birleştirme uyarısını ve ortam dışa aktarma satırını yazdırır. Bu
dosyaya asla dokunmaz — yukarıdaki bölüm geçerliliğini korur ve bloğu
yapılandırmanıza taşımak sizin açık eyleminizdir.

:::caution[Birleştirin, asla üzerine yazmayın]
`provider.nexcode` bloğunu mevcut yapılandırmanızla birleştirin. Tüm dosyanın
dışa aktarılanla değiştirilmesi diğer sağlayıcılarınızı, ajanlarınızı, tuş
atamalarınızı ve MCP girdilerinizi yok eder. `nxc export --out` tam olarak bu
nedenle mevcut bir dosyanın üzerine yazmayı reddeder, bu nedenle `--out`'u
geçici bir yola yönlendirin ve bloğu kopyalayın:

```bash
nxc export --client opencode --out ~/nexcode-opencode.json
```
:::

Başlatıcının çalışma zamanı bloğunun aksine, birleştirilmiş bir blok statik bir
anlık görüntüdür: kataloğunuzu takip etmez. Bir sağlayıcı ekledikten veya model
görünürlüğünü değiştirdikten sonra `nxc export`'u yeniden çalıştırın.

Birleştirildikten sonra opencode'u başlatmadan önce kabul anahtarını dışa
aktarın — proxy'nin geri döngüde olduğu durumlar hariç (orada hiçbir anahtar
gerekmez):

```bash
export NEXCODE_OPENCODE_API_KEY=<anahtarınız>
```

## Kabul anahtarı diske yazılmaz

Proxy bir API anahtarı gerektirdiğinde, satır içi çalışma zamanı yapılandırması
sır yerine opencode'un `{env:…}` referansını taşır. Geri döngü (loopback)
bağlantıları bu referansı `apiKey` olarak kullanır; geri döngü olmayan
bağlantılar, proxy kabulünün herhangi bir yukarı akış `Authorization`
başlığından ayrı kalması için bunu yalnızca `x-nexcode-api-key` üzerinden
gönderir.

Geri döngü örneği:

```json
"options": {
  "baseURL": "http://127.0.0.1:10100/v1",
  "apiKey": "{env:NEXCODE_OPENCODE_API_KEY}"
}
```

Geri döngü olmayan örnek:

```json
"options": {
  "baseURL": "http://192.168.1.10:10100/v1",
  "headers": {
    "x-nexcode-api-key": "{env:NEXCODE_OPENCODE_API_KEY}"
  }
}
```

Gerçek değer yalnızca alt süreç ortamı üzerinden iletilir.
`NEXCODE_API_AUTH_TOKEN` önceliklidir, ardından güçlendirilmiş servis
belirteci dosyası, ardından yapılandırılmış bir API anahtarı gelir — geri döngü
olmayan bir bağlantının gerektirdiği budur.

Bir geri döngü bağlantısı (`127.0.0.1`, varsayılan) hiçbir şeyi doğrulamaz, bu
nedenle `{env:…}` referansı etkisizdir ve değişkeni ayarlanmamış
bırakabilirsiniz. Yalnızca `hostname` geri döngünün ötesine ayarlandığında
önemlidir; bkz. [Uzaktan erişim](/tr/reference/configuration/#remote-access). Bu
kabul anahtarı nexcode'in kendisine aittir ve
[Sağlayıcılar](/tr/guides/providers/) altında yapılandırılan yukarı akış
sağlayıcı anahtarlarıyla ilgisizdir.

## Geri Alma (Reverting)

Geri alınacak bir şey yoktur — `~/.nexcode` altında oluşturulmuş hiçbir
yapılandırma dosyası yazılmaz. Düz `opencode` çalıştırdığınızda kendi
yapılandırmanızı tam olarak eskisi gibi okur.

## Model sınırları

`limit.context` yalnızca katalog yetkili bir bağlam penceresi bildirdiğinde
yazılır; bildirmediğinde tüm `limit` bloğu atlanır ve opencode kendi
varsayılanlarını korur.

opencode'un şeması `output` olmadan `context` taşıyan bir `limit` bloğunu
reddeder ve kataloğun yetkili bir model başına çıktı alanı yoktur; bu nedenle
yanında `32000`'lik bir `output` bütçesi yayınlanır ve küçük bağlamlı bir modele
asla `output > context` verilmemesi için bağlam penceresine doğru sabitlenir. Bu
rakam şemayı karşılamak için vardır — belirli bir modelin gerçek maksimumu
hakkında bir iddia değildir.

`nexcode` sağlayıcı bloğu her başlatmada yeniden oluşturulur, bu nedenle
içinde yapılan model başına ince ayarlar hayatta kalmaz. Bunun yerine özel
girdileri kendinize ait bir sağlayıcı anahtarı altında tutun.

## Gereksinimler

opencode kurulu olmalı ve `PATH` üzerinde bulunmalıdır:

```bash
npm install -g opencode-ai
```


