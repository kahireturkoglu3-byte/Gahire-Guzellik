# Gahire Güzellik Salonu

Müşteri girişi, randevu, paket ve seans takibi; ayrı yönetim paneli.

## GitHub Pages

Statik dosyalar depo köküne yüklenir. Settings → Pages → Deploy from a branch → main → /(root) seçilir. Ücretli plan kullanılmaz; GitHub Free ile Pages için herkese açık depo gerekir. Gizli anahtarlar ve müşteri verileri depoya yüklenmez.

GitHub Pages adresi yayınlandıktan sonra:
- Cloudflare Turnstile Gahire widget hostname listesine GitHub Pages alan adı eklenir (protokol/yol olmadan).
- Supabase booking-api ALLOWED_ORIGINS listesine GitHub Pages origin eklenir (https:// dahil, depo yolu olmadan).
- TURNSTILE_HOSTNAMES listesine aynı hostname eklenir.
- Mevcut site adresleri de kullanılacaksa listelerden çıkarılmaz.

Secret Key yalnızca Supabase Edge Function Secrets içinde saklanır. config.js yalnızca herkese açık bağlantı bilgileri içerir.

Kurulu Gahire veritabanında setup.sql ve portal-upgrade.sql yeniden çalıştırılmaz. Ayrıntılar KURULUM.md dosyasındadır.

## Geliştirme

HTML dosyalarını Live Server ile açın. Testler için npm ci ve npm test kullanın. preview.html tamamen örnek verilerle çalışan ayrı bir tanıtım ekranıdır.

## Mevcut durum

Turnstile yapılandırması eklendi; gerçek müşteri girişi ve randevu uçtan uca denemesi bekliyor. Randevu alımı gerçek çalışma saatleri ve süreler girilene kadar kapalıdır. Mobil stiller düzenlendi; bu ortamda görsel tarayıcı testi yapılamadı.
