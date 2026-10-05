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
  const errorMessage = (error) => {
    const msg = error?.message || "";
    const codes = {
      GH_STATE: "Bu durum değişikliği yapılamaz.",
      GH_PAST: "Geçmiş randevu onaylanamaz.",
      GH_FUTURE: "Randevu süresi henüz bitmedi.",
      GH_HAS_BOOKINGS: "Bu günde aktif randevu var. Önce randevuları yönetin.",
    };
    return (
      Object.entries(codes).find(([key]) => msg.includes(key))?.[1] ||
      "İşlem tamamlanamadı. Bağlantınızı ve yetkinizi kontrol edin."
    );
  };
  async function edge(body) {
    if (!ready) throw Error("Online randevu henüz kullanıma açılmadı.");
    const { data: sessionData } = await client.auth.getSession();
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
    const json = await response.json();
    if (!response.ok)
      throw Object.assign(Error(json.error || "İşlem tamamlanamadı."), {
        code: json.code,
      });
    return json.data;
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
