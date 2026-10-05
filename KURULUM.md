# Gahire — müşteri girişi, randevu ve seans takibi

## Teslim durumu

Kaynak kod; müşteri portalını, yönetici panelini, randevu sistemini ve Supabase kurulumunu içerir. **Gahire için ayrı Supabase projesi açılmış, tablolar kurulmuş ve siteye herkese açık bağlantı bilgileri eklenmiştir.** Yönetici hesabı yetkilendirilmiş, herkese açık kayıt kapatılmış, Edge Function origin/hostname ayarları ve Turnstile Site Key tanımlanmıştır. Kullanıcı Secret Key'i 2 Ekim 2026 tarihinde Supabase'e kaydetmiştir; canlı API kontrolünde eksik yapılandırma hatası kalkmış, eksik/geçersiz doğrulamalar reddedilmiştir. Geçerli Turnstile doğrulamasıyla gerçek müşteri girişi henüz uçtan uca denenmemiştir. Sabit/demo şifre veya örnek müşteri hesabı bulunmaz. Siyah Makas projesine ve verilerine dokunulmamıştır.

2 Ekim 2026 kontrolü: 82 yerel otomatik test geçti (28 temel veritabanı, 23 müşteri/seans güvenliği, 12 API sınırı ve 19 jsdom arayüz kontrolü). API testleri taklit ağ kullanır; bunlar gerçek tarayıcı ve gerçek müşteri giriş denemesinin yerine geçmez. Canlı ortamda bir yönetici, sıfır müşteri vardır; randevu alımı kapalıdır. İlk müşteri yönetici panelinden oluşturulmalı, gerçek hizmet süreleri ve çalışma saatleri girildikten sonra randevu alımı açılmalıdır. Supabase kuruluşu ücretsiz plandadır. Güvenlik danışmanında sızdırılmış şifre kontrolünün kapalı olması uyarısı vardır; bunun için ücretli plana geçilmemiştir.

Dosyaları VS Code'da açıp index.html için **Open with Live Server** kullanabilirsiniz. Tasarımı açmak için npm gerekmez. Üyelik ve randevu işlemleri için aşağıdaki sunucu kurulumu gerekir.

## Müşteri akışı

1. Salon yöneticisi panelden ad, telefon, kullanıcı adı ve geçici şifre ile müşteri hesabını açar.
2. Giriş bilgileri müşteriye salon tarafından iletilir. Sistem otomatik e-posta veya WhatsApp göndermez.
3. Müşteri ilk girişte en az 12 karakter, harf ve rakam içeren kendi şifresini belirler.
4. Müşteri yaklaşan randevusunu, bakım paketlerini, tamamlanan/kalan seanslarını ve işlem geçmişini görür.
5. Paketi üzerinden ya da paket dışında hizmet seçip randevu talep eder. Talep salon onayı bekler.
6. Salon yapılan işlemi kaydettiğinde ilgili randevu tamamlanır, işlem geçmişi ve kalan seans sayısı aynı veritabanı işleminde güncellenir.

Müşterilerin kendi kendine kayıt olma ekranı yoktur. Veriler yalnızca aktif, yetkilendirilmiş oturumla okunabilir. Yeni müşteri girişi önceki müşteri oturumunu kapatır; kullanıcı başına tek aktif oturum kullanılır. Hesap kapatma veya şifre sıfırlamada eski oturumun verilere erişimi veritabanı tarafından engellenir.

## Yönetici özellikleri

- Müşteri oluşturma, arama, dosyasını görüntüleme, hesabını kapatma/açma ve geçici şifre verme.
- Müşteriye hizmete bağlı bakım paketi tanımlama: paket adı, toplam seans ve önerilen sonraki tarih.
- Onaylı randevudan seans tamamlama veya randevusuz yapılan işlemi kaydetme.
- Hatalı işlem kaydını gerekçe ile iptal etme; kayıt silinmez ve kalan seans sayısı düzelir.
- Randevu onaylama/iptal, tarih-durum-müşteri filtreleri, sayfalama ve sesli uyarı.
- Hizmet fiyatı/süresi, haftalık çalışma saatleri, özel kapalı günler ve randevu alımını açma/kapatma.

Paketlerde gelecekteki bekleyen/onaylı randevular kalan seanslardan yer ayırır. Böylece son bir seansı olan müşterinin aynı paketle birden fazla randevu alması önlenir. İptal edilen randevu hem takvim saatini hem bu rezervasyonu serbest bırakır.

## 1. Gahire için ayrı Supabase projesi

Yeni ve Gahire'ye özel proje kullanın. Scriptler Siyah Makas'ın mevcut projesine uygulanmamalıdır.

Supabase SQL Editor'da sırayla çalıştırın:

1. `supabase/setup.sql`
2. `supabase/portal-upgrade.sql`

İlk dosya temel randevu yapısını, ikinci dosya üyelik/paket/seans yapısını ekler. Önceden ilk sürümün Gahire kurulumu yapılmışsa yalnızca ikinci dosyayı çalıştırın. İkisi de ilgili kurulum için bir kez çalıştırılır; mevcut tabloları silen bir sıfırlama scripti değildir.

Başlangıçta randevu alımı kapalıdır. Örnek ayarlar pazartesi–cumartesi 10:00–19:00, pazar kapalıdır. Hizmet süreleri kaş için 30 dakika, diğer hizmetler için 60 dakikadır. Bunlar doğrulanmış işletme bilgileri değil, panelden değiştirilecek başlangıç ayarlarıdır.

Aynı anda tek müşteriye hizmet verilen bir takvim kullanılır. Birden fazla uzman/kabin için paralel takvim bu sürüme dahil değildir. Tüm saatler Europe/Istanbul saat dilimindedir.

## 2. İlk yönetici

Supabase Authentication → Users → Add user üzerinden kendi e-posta ve şifrenizle yönetici kullanıcısı oluşturun. `supabase/admin-atama.sql` içindeki e-postayı bu kullanıcıyla değiştirip çalıştırın. Kullanıcı oluşturmak tek başına yönetici yetkisi vermez; gh_admins üyeliği de gereklidir.

Authentication ayarlarında **Allow new users to sign up** seçeneğini kapatın. Salon paneli, sunucu tarafındaki yönetici API'siyle müşteri açmaya devam edebilir. Müşterinin sahte/izinsiz bir Auth hesabı edinmesi yine de Gahire müşteri yetkisi vermez; gh_members kaydı ve geçerli oturum eşleşmesi gerekir.

## 3. Turnstile

Cloudflare Turnstile'da site oluşturun. Kullanılacak gerçek alan adını ve yerel denemeler için localhost/127.0.0.1 alanını tanımlayın. Site key tarayıcıya, secret key yalnızca sunucuya yazılır. Turnstile giriş formunda kullanılır; kayıtlı müşterinin sonraki randevu işlemlerinde oturum doğrulanır.

## 4. Edge Function

Supabase Edge Functions bölümünde **booking-api** adlı fonksiyon oluşturun veya önceki Gahire fonksiyonunu güncelleyin. Kaynak: `supabase/functions/booking-api/index.ts`.

Fonksiyon ayarındaki JWT doğrulamasını kapatın. `supabase/config.toml` içinde `verify_jwt = false` verilmiştir. Bu ayar yalnızca giriş isteğinin kullanıcı oturumu olmadan ulaşabilmesini sağlar: fonksiyon diğer bütün işlemlerde Supabase Auth `/user` çağrısıyla erişim belirtecini doğrular, üyelik/yönetici yetkisini ayrıca kontrol eder. JWT gövdesi tek başına yetki kanıtı sayılmaz.

Edge Function Secrets:

| Değişken             | Değer                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| TURNSTILE_SECRET_KEY | Turnstile gizli anahtarı                                                                            |
| ALLOWED_ORIGINS      | `https://gahire-guzellik.emirhangurbuz391.chatgpt.site,http://127.0.0.1:5500,http://localhost:5500` |
| TURNSTILE_HOSTNAMES  | `gahire-guzellik.emirhangurbuz391.chatgpt.site,127.0.0.1,localhost`                                 |

Yeni alan adı kullanılırsa listeleri ona göre güncelleyin. Origin protokol ve port içerir, yol ve sondaki `/` içermez. Hostname protokol veya port içermez.

SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY Supabase Edge Function ortamında sağlanır. Gizli anahtarları istemci dosyalarına veya site hosting'ine koymayın.

## 5. config.js

Gahire projesinden alınan herkese açık bilgileri yazın:

```js
window.GAHIRE_BACKEND = {
  url: "https://PROJE.supabase.co",
  publishableKey: "sb_publishable_...",
  turnstileSiteKey: "TURNSTILE_SITE_KEY",
  functionName: "booking-api",
};
```

Legacy anon key de desteklenir. **service*role veya sb_secret* anahtarı burada kullanılmaz.**

admin.html üzerinden yönetici hesabınızla giriş yapın. Gerçek hizmet sürelerini, fiyatları ve çalışma saatlerini ayarlayın; sonra randevu alımını açın. Müşteriler & seanslar → Yeni müşteri ile ilk hesabı oluşturun.

## 6. Kullanıcı adı ve şifre tasarımı

Kullanıcı adları 3–32 karakterdir; küçük İngilizce harfler, rakam, nokta, tire ve alt çizgi kabul edilir. Auth içinde `kullaniciadi@members.gahire.invalid` şeklinde yalnızca teknik amaçlı bir kimlik tutulur. Bu adres gerçek müşteri e-postası değildir; buraya e-posta gönderilmez. Müşteri e-posta yazmaz, kullanıcı adıyla giriş yapar.

Geçici şifreler yalnızca oluşturma/sıfırlama anında yöneticiye gösterilir. Müşterinin belirlediği şifre yöneticiye gösterilemez. Şifre unutulursa salon yeni geçici şifre üretir. Müşteri portalı ve yönetici paneli aynı tarayıcı sekmesinde aynı oturumu paylaşır; farklı rollerle denemek için ayrı gizli pencere kullanın.

Statik HTML dosyasının görüntülenmesini sağlayan ekran kontrolü, veri güvenliğinin yerine geçmez. Asıl koruma Auth doğrulaması, RLS, sadece sunucunun çağırabildiği RPC'ler ve müşteri/oturum eşleşmesidir. Veri tabanında müşteri hesabı yokken kişisel veri gösterilmez.

## 7. Görseller ve içerik

Fotoğraflar önceki tercihe göre eklenmedi. `content.js` içindeki media alanları ve `images/` klasörü hazırdır. WhatsApp numarası yine content.js içinde ülke koduyla yalnızca rakam olarak girilir. Salon tanıtım metinleri, adres ve iletişim içerikleri `salon.html` dosyasındadır. index.html artık müşteri girişini ve kişisel alanı içerir.

Fiyat ve randevu süresi veritabanından gelir. Gerçek salon fotoğrafları, yorumlar, adres/iletişim bilgileri henüz sağlanmamıştır. Önerilen sonraki seans tarihini salon elle belirler; sistem tıbbi öneri üretmez.

## Dosya haritası

| Dosya                            | Görev                                                                   |
| -------------------------------- | ----------------------------------------------------------------------- |
| index.html / portal.js           | Müşteri girişi, zorunlu şifre değişikliği, randevular, paketler, geçmiş |
| salon.html / app.js / booking.js | Salon tanıtımı ve üyeye özel randevu formu                              |
| member-guard.js                  | Salon sayfasının müşteri oturum kontrolü                                |
| admin.html / admin.js            | Yönetici girişi, randevu ve salon ayarları                              |
| admin-members.js                 | Müşteri hesabı, paket ve seans yönetimi                                 |
| style.css                        | Ortak tasarım ve mobil görünüm                                          |
| config.js / backend.js           | Bağlantı ve oturumlu API çağrıları                                      |
| content.js                       | Tanıtım metinleri, görsel yolları, WhatsApp                             |
| supabase/                        | SQL kurulumu, ilk yönetici ve sunucu API'si                             |
| vendor/                          | Sabit sürüm Supabase JS 2.116.0 ve lisansı                              |
| tests/                           | Veritabanı, yetki ve arayüz testleri                                    |

## Doğrulama ve sınırlar

30 Eylül 2026 kontrolünde **82 otomatik test geçti** (28 temel veritabanı, 23 müşteri/veri yetkisi, 12 API, 19 arayüz).

Yerel PostgreSQL/PGlite ile randevu çakışması, paket/seans işlemleri ve RLS sınanır. API testleri sahte ağ yanıtlarıyla, arayüz mantığı testleri jsdom ile çalışır. Bunlar canlı Supabase ve Turnstile bağlantısı testi veya gerçek tarayıcı görsel kontrolü değildir.

Node.js 24 ile geliştirici testleri:

```sh
npm ci
npm test
```

Canlı bağlantı kurulduğunda iki farklı müşteriyle veri ayrımı, ilk şifre değişikliği, randevu onayı, seans tamamlama, iptal ve hesap kapatma akışları uçtan uca doğrulanmalıdır. Önceki anonim randevular varsa telefon eşleşmesiyle otomatik müşteri aktarımı yapılmaz.

Site hosting'ine yalnızca HTML/CSS/JS, vendor ve images dosyalarını yükleyin. tests, node_modules, kurulum SQL'leri ve Supabase sunucu kodları statik hosting'e yüklenmez. Edge Function Supabase'de ayrıca yayınlanır.

SMS, otomatik WhatsApp, ödeme ve çoklu uzman takvimi bu sürümde bulunmaz. Alarm için panelin açık olması ve sesli uyarının kullanıcı tarafından açılması gerekir; tarayıcı arka plan sekmelerini uyutabilir.


## Panel güncellemesi — 30 Eylül 2026

- Müşteri randevuları durum ve yaklaşan randevu filtresiyle listelenir. İşlem geçmişinden aynı hizmet için yeniden randevu sayfasına geçilebilir.
- Yönetici günlük ajandası seçilen günü saat sırasıyla gösterir; önceki/sonraki gün, bugün ve tüm tarihlerde onay bekleyenler kısayolları bulunur. Randevu kartından müşteri dosyası açılır.
- Müşteri listesi aktif, kapalı ve ilk giriş bekleyen hesaplara göre süzülebilir.
- `preview.html` / `preview.js` bağımsız, salt okunur tasarım önizlemesidir. Tamamı açıkça örnek olarak işaretlenmiş kurgusal kayıtlardır. Backend, oturum, gerçek müşteri bilgisi, ağ isteği veya yerel veri saklama kullanmaz. Önizleme, gerçek panellerin bütün yönetim işlemlerini simüle etmez.
- Gerçek müşteri ve yönetici girişleri için önceki Supabase ve Turnstile kurulum adımları hâlâ gereklidir. Canlı kurulum ilerlemesi aşağıdadır.


## Canlı kurulum ilerlemesi — 30 Eylül 2026

- Proje: Gahire Guzellik Salonu (`pykxvutdmuvdgiwvftyr`), eu-central-1. Mevcut organizasyon altında ayrı veritabanı.
- API adresi: https://pykxvutdmuvdgiwvftyr.supabase.co
- `gahire_booking_base` ve `gahire_member_portal` migration kayıtları uygulandı; setup.sql ve portal-upgrade.sql yeniden çalıştırılmamalı.
- 9 tablo kuruldu; tümünde RLS açık. 6 hizmet tanımlı, gerçek fiyatlar boş, randevu alımı kapalı.
- `booking-api` v1 yayımlandı. Gövdede kimlik doğrulama yapıldığı için gateway verify_jwt=false.
- Güvenlik danışmanı taraması bulgu döndürmedi; anon müşteri okuma ve ayrıcalıklı randevu RPC çalıştırma izinleri bulunmuyor. Paket görünümü security_invoker=true.
- Kalan: ilk yönetici hesabı + gh_admins üyeliği; Auth self-signup kapatma; TURNSTILE_SECRET_KEY, ALLOWED_ORIGINS, TURNSTILE_HOSTNAMES sunucu ayarları; istemci Turnstile site key. Sonrasında canlı iki müşteri testi ve salon ayarlarının doğrulanması.
- Origin/Turnstile kurulumu tamamlanmadan fonksiyon giriş isteklerini reddeder. Test anahtarı veya doğrulama atlama kullanılmadı.
