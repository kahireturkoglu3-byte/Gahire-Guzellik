(() => {
  const cfg = window.GAHIRE_BACKEND;
  const ready = Boolean(
    cfg?.url?.startsWith("https://") && cfg.publishableKey && window.supabase,
  );
  const client = ready
    ? window.supabase.createClient(cfg.url, cfg.publishableKey, {
        auth: {
          persistSession: true,
          storage: window.sessionStorage,
          storageKey: "gahire-session",
          detectSessionInUrl: false,
        },
      })
    : null;
  const dateTR = (value = new Date()) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  const timeTR = (value) =>
    new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  const fullTR = (value) =>
    new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(value));
  const phone = (value) => {
    let p = value.replace(/\D/g, "");
    if (p.startsWith("0")) p = p.slice(1);
    if (p.length === 10) p = "90" + p;
    return /^905\d{9}$/.test(p) ? p : null;
  };
  // Only known, user-facing messages reach the UI; internal details stay hidden.
  const businessMessages = {
    GH_AUTH: "Bu işlem için yönetici girişi gerekiyor.",
    GH_MEMBER:
      "Oturumunuz geçersiz veya hesabınız kapalı. Yeniden giriş yapın.",
    GH_PASSWORD: "Şifrenizi değiştirmeniz gerekiyor.",
    GH_SLOT: "Bu saat artık uygun değil. Başka bir saat seçin.",
    GH_CLOSED: "Online randevu alımı kapalı.",
    GH_INPUT: "Bilgilerinizi kontrol edin.",
    GH_LIMIT: "Çok fazla randevu talebiniz var. Salonla iletişime geçin.",
    GH_RETRY: "Bu istek farklı bilgilerle daha önce kaydedildi.",
    GH_PACKAGE: "Paket ve hizmet seçimini kontrol edin.",
    GH_NO_SESSIONS:
      "Bu paketin tüm seansları kullanılmış veya randevu için ayrılmış.",
    GH_RESERVED: "Kalan seanslar randevulara ayrılmış. İlgili randevuyu seçin.",
    GH_APPOINTMENT: "Bu randevu henüz tamamlanamaz veya seçimle eşleşmiyor.",
  };
  Object.assign(businessMessages, {
    GH_STATE: "Bu durum değişikliği yapılamaz.",
    GH_PAST: "Geçmiş randevu onaylanamaz.",
    GH_FUTURE: "Randevu süresi henüz bitmedi.",
    GH_HAS_BOOKINGS: "Bu günde aktif randevu var. Önce randevuları yönetin.",
  });
  const safeMessages = new Set([
    ...Object.values(businessMessages),
    "Bağlantı tamamlanamadı. Kayıt işlemi yaptıysanız tekrar göndermeden önce sonucu kontrol edin.",
    "Bilgileriniz yüklenemedi. Lütfen yenileyin.",
    "Bu kullanıcı adı zaten kayıtlı.",
    "Geçersiz işlem.",
    "Güvenlik doğrulamasını tamamlayın.",
    "Güvenlik doğrulamasını yenileyin.",
    "Hesap kullanılamıyor. Salonla iletişime geçin.",
    "Hesap oluşturulamadı.",
    "Kullanıcı adı veya şifre hatalı.",
    "Online randevu henüz kullanıma açılmadı.",
    "Paket bilgileriniz yüklenemedi.",
    "Randevu bilgileri yüklenemedi. Lütfen tekrar deneyin.",
    "Sunucudan yanıt alınamadı.",
    "Üye girişi henüz kullanıma açılmadı.",
    "İstek çok büyük.",
    "İşlem tamamlanamadı. Bilgileri kontrol edip tekrar deneyin.",
    "Şifre en az 12 karakter, harf ve rakam içermeli.",
  ]);
  const errorMessage = (error) => {
    const message =
      typeof error === "string" ? error : String(error?.message || "");
    const code = error?.code || "";
    const known = Object.entries(businessMessages).find(
      ([key]) => code === key || message.includes(key),
    );
    if (known) return known[1];
    if (safeMessages.has(message) || error?.userMessage === true)
      return message;
    if (
      /failed to fetch|fetch failed|networkerror|network request failed|load failed|network connection/i.test(
        message,
      )
    )
      return "Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin. Kayıt işlemi yaptıysanız yeniden göndermeden önce randevularınızı kontrol edin.";
    if (
      ["AbortError", "TimeoutError"].includes(error?.name) ||
      /timeout|timed out|aborted/i.test(message)
    )
      return "Sunucu zamanında yanıt vermedi. Kayıt işlemi yaptıysanız yeniden göndermeden önce randevularınızı kontrol edin.";
    if (
      code === "invalid_credentials" ||
      /invalid login credentials/i.test(message)
    )
      return "Giriş bilgileri hatalı. Kullanıcı adı veya e-posta adresinizi ve şifrenizi kontrol edin.";
    if (code === "email_not_confirmed")
      return "E-posta adresiniz henüz doğrulanmamış. Lütfen e-postanızı kontrol edin.";
    if (error?.status === 429 || /rate.limit|too many requests/i.test(message))
      return "Çok fazla deneme yapıldı. Lütfen birkaç dakika bekleyip tekrar deneyin.";
    if (
      error?.status === 401 ||
      /invalid.*jwt|session.*expired|refresh.token/i.test(message)
    )
      return "Oturumunuz sona erdi. Lütfen yeniden giriş yapın.";
    if (error?.status === 403)
      return "Bu işlem için erişim doğrulanamadı. Yeniden giriş yapın; sorun sürerse salonla iletişime geçin.";
    return "İşlem tamamlanamadı. Lütfen daha sonra tekrar deneyin. Kayıt işlemi yaptıysanız yeniden göndermeden önce sonucu kontrol edin.";
  };
  async function edge(body) {
    if (!ready) throw Error("Online randevu henüz kullanıma açılmadı.");
    try {
      const { data: sessionData, error: sessionError } =
        await client.auth.getSession();
      if (sessionError) throw sessionError;
      const bearer = sessionData?.session?.access_token;
      const response = await fetch(
        `${cfg.url}/functions/v1/${cfg.functionName}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: cfg.publishableKey,
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(25000),
        },
      );
      let json;
      try {
        json = await response.json();
      } catch {
        throw Object.assign(Error("Sunucudan yanıt alınamadı."), {
          status: response.status,
        });
      }
      if (!response.ok)
        throw Object.assign(Error(json?.error || "İşlem tamamlanamadı."), {
          code: json?.code,
          status: response.status,
        });
      if (!json || !("data" in json)) throw Error("Sunucudan yanıt alınamadı.");
      return json.data;
    } catch (error) {
      throw Object.assign(Error(errorMessage(error)), {
        code: error?.code,
        status: error?.status,
        userMessage: true,
      });
    }
  }

  window.GahireAPI = {
    ready,
    client,
    dateTR,
    timeTR,
    fullTR,
    phone,
    errorMessage,
    edge,
  };
})();
