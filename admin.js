(() => {
  const api = window.GahireAPI,
    db = api.client,
    $ = (id) => document.getElementById(id);
  const labels = {
    bekliyor: "Onay bekliyor",
    onaylandi: "Onaylandı",
    iptal: "İptal edildi",
    tamamlandi: "Tamamlandı",
    gelmedi: "Gelmedi",
  };
  let authorized = false,
    epoch = 0,
    page = 0,
    request = 0,
    pending = 0,
    audio = null,
    alarm = false,
    cancelRow = null,
    busy = false,
    filterTimer;
  const message = (text, bad = false) => {
    $("admin-message").textContent = text;
    $("admin-message").classList.toggle("error", bad);
  };
  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  function loginView() {
    authorized = false;
    window.dispatchEvent(new Event("gahire:admin-logout"));
    epoch++;
    request++;
    pending = 0;
    $("admin-panel").hidden = true;
    $("admin-login").hidden = false;
    $("appointments-list").replaceChildren();
    $("admin-password").value = "";
    $("connection-state").textContent = "Oturum kapalı";
  }
  async function gate(session) {
    const id = ++epoch;
    if (!session) {
      loginView();
      return;
    }
    try {
      const { data, error } = await db
        .from("gh_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (id !== epoch) return;
      if (error || !data) {
        loginView();
        $("login-message").textContent =
          "Bu hesabın Gahire yönetici yetkisi yok.";
        await db.auth.signOut();
        return;
      }
      authorized = true;
      $("admin-login").hidden = true;
      $("admin-panel").hidden = false;
      $("admin-password").value = "";
      window.dispatchEvent(new Event("gahire:admin-ready"));
      await Promise.all([refresh(), loadSettings()]);
    } catch {
      loginView();
      $("login-message").textContent =
        "Yetki doğrulanamadı. Tekrar giriş yapın.";
    }
  }
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!api.ready) return;
    $("login-submit").disabled = true;
    $("login-message").textContent = "Giriş yapılıyor…";
    try {
      const { error } = await db.auth.signInWithPassword({
        email: $("admin-email").value.trim(),
        password: $("admin-password").value,
      });
      if (error) throw error;
      $("login-message").textContent = "";
    } catch {
      $("login-message").textContent =
        "Giriş yapılamadı. E-posta ve şifrenizi kontrol edin.";
    } finally {
      $("login-submit").disabled = false;
    }
  });
  $("logout").addEventListener("click", async () => {
    loginView();
    await db.auth.signOut({ scope: "local" });
  });
  async function refresh() {
    if (!authorized || busy) return;
    const ticket = ++request,
      session = epoch;
    try {
      let q = db
        .from("gh_appointments")
        .select("*", { count: "exact" })
        .order("starts_at", { ascending: Boolean($("filter-date").value) })
        .order("id");
      const date = $("filter-date").value,
        status = $("filter-status").value;
      const search = $("filter-search")
        .value.trim()
        .replace(/[^\p{L}\p{N} +]/gu, "")
        .slice(0, 80);
      if (date) {
        q = q
          .gte("starts_at", `${date}T00:00:00+03:00`)
          .lt(
            "starts_at",
            new Date(
              Date.parse(`${date}T00:00:00+03:00`) + 86400000,
            ).toISOString(),
          );
      }
      if (status) q = q.eq("status", status);
      if (search)
        q = q.or(
          `customer_name.ilike.%${search}%,phone.ilike.%${search.replace(/\s/g, "")}%`,
        );
      const today = api.dateTR();
      const [rows, wait, day] = await Promise.all([
        q.range(page * 25, page * 25 + 24),
        db
          .from("gh_appointments")
          .select("id", { count: "exact", head: true })
          .eq("status", "bekliyor"),
        db
          .from("gh_appointments")
          .select("id", { count: "exact", head: true })
          .in("status", ["bekliyor", "onaylandi"])
          .gte("starts_at", `${today}T00:00:00+03:00`)
          .lt(
            "starts_at",
            new Date(
              Date.parse(`${today}T00:00:00+03:00`) + 86400000,
            ).toISOString(),
          ),
      ]);
      if (ticket !== request || session !== epoch || !authorized) return;
      if (rows.error || wait.error || day.error) throw Error();
      pending = wait.count;
      $("pending-count").textContent = pending;
      $("today-count").textContent = day.count;
      $("connection-state").textContent = "Güncel";
      $("last-refresh").textContent =
        "Son güncelleme: " +
        api.timeTR(new Date().toISOString()) +
        " · Türkiye saati";
      $("agenda-title").textContent = date
        ? new Intl.DateTimeFormat("tr-TR", {
            day: "numeric",
            month: "long",
            weekday: "long",
            timeZone: "Europe/Istanbul",
          }).format(new Date(date + "T12:00:00+03:00"))
        : "Tüm randevular";
      $("alarm-status").textContent = alarm
        ? pending
          ? `${pending} talep için uyarı çalıyor.`
          : "Yeni talep bekleniyor."
        : "Sesli uyarı kapalı.";
      $("list-count").textContent = `${rows.count} randevu bulundu.`;
      $("page-info").textContent =
        `Sayfa ${page + 1} / ${Math.max(1, Math.ceil(rows.count / 25))}`;
      $("page-prev").disabled = page === 0;
      $("page-next").disabled = (page + 1) * 25 >= rows.count;
      render(rows.data);
    } catch {
      if (ticket !== request || session !== epoch) return;
      $("connection-state").textContent = "Bağlantı yok";
      message(
        "Randevular güncellenemedi. Son gösterilen bilgiler eski olabilir.",
        true,
      );
    }
  }
  function action(row, to, title) {
    const b = el("button", title, "small-button");
    b.addEventListener("click", () => {
      if (to === "iptal") {
        cancelRow = row;
        $("cancel-dialog").showModal();
      } else change(row, to);
    });
    return b;
  }
  function render(rows) {
    const list = $("appointments-list");
    list.replaceChildren();
    if (!rows.length) {
      list.append(
        el("p", "Bu filtrelere uygun randevu bulunmuyor.", "empty-state"),
      );
      return;
    }
    rows.forEach((row) => {
      const card = el("article", null, "appointment-card");
      const top = el("div", null, "appointment-top");
      card.append(
        el(
          "div",
          api.timeTR(row.starts_at) + " – " + api.timeTR(row.ends_at),
          "agenda-time",
        ),
      );
      top.append(
        el("h3", row.customer_name),
        el(
          "span",
          labels[row.status] || row.status,
          `status status-${row.status}`,
        ),
      );
      card.append(
        top,
        el("p", `${row.service_name} · ${row.duration_minutes} dakika`),
        el("p", `${api.fullTR(row.starts_at)} – ${api.timeTR(row.ends_at)}`),
      );
      const phone = el("a", row.phone);
      phone.href = "tel:+" + row.phone;
      card.append(phone);
      if (row.note) card.append(el("p", row.note, "customer-note"));
      card.append(el("small", `Talep: ${row.id}`));
      const actions = el("div", null, "card-actions");
      const future = new Date(row.starts_at) > new Date(),
        ended = new Date(row.ends_at) <= new Date();
      if (row.status === "bekliyor") {
        if (future) actions.append(action(row, "onaylandi", "Onayla"));
        actions.append(action(row, "iptal", "İptal et"));
      }
      if (row.status === "onaylandi") {
        actions.append(action(row, "iptal", "İptal et"));
        if (ended)
          actions.append(
            action(row, "tamamlandi", "Tamamlandı"),
            action(row, "gelmedi", "Gelmedi"),
          );
      }
      const wa = el("a", "WhatsApp", "small-button");
      wa.href = `https://wa.me/${row.phone}?text=${encodeURIComponent(`Merhaba ${row.customer_name}, Gahire Güzellik Salonu randevunuz hakkında size ulaşıyoruz. ${api.fullTR(row.starts_at)} · ${row.service_name}`)}`;
      wa.target = "_blank";
      wa.rel = "noopener";
      actions.append(wa);
      if (row.customer_id) {
        const file = el("button", "Müşteri dosyası", "small-button");
        file.addEventListener("click", () =>
          window.dispatchEvent(
            new CustomEvent("gahire:open-customer", {
              detail: row.customer_id,
            }),
          ),
        );
        actions.append(file);
      }
      card.append(actions);
      list.append(card);
    });
  }
  async function change(row, to) {
    if (busy || !authorized) return;
    if (to === "tamamlandi" && row.customer_id) {
      window.dispatchEvent(
        new CustomEvent("gahire:complete-appointment", { detail: row }),
      );
      return;
    }
    busy = true;
    $("appointments-list")
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = true));
    const session = epoch;
    try {
      const { data, error } = await db
        .from("gh_appointments")
        .update({ status: to })
        .eq("id", row.id)
        .eq("status", row.status)
        .select("id");
      if (session !== epoch) return;
      if (error) throw error;
      if (!data.length) throw Error("STALE");
      message("Randevu güncellendi. Müşteriye otomatik mesaj gönderilmedi.");
    } catch (e) {
      message(
        e.message === "STALE"
          ? "Bu randevu başka bir oturumda değişti. Liste yenileniyor."
          : api.errorMessage(e),
        true,
      );
    } finally {
      busy = false;
      await refresh();
    }
  }
  $("cancel-no").addEventListener("click", () => $("cancel-dialog").close());
  $("cancel-yes").addEventListener("click", () => {
    $("cancel-dialog").close();
    if (cancelRow) change(cancelRow, "iptal");
  });
  $("filter-date").value = api.dateTR();
  ["filter-date", "filter-status"].forEach((id) =>
    $(id).addEventListener("change", () => {
      page = 0;
      refresh();
    }),
  );
  $("filter-search").addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      page = 0;
      refresh();
    }, 300);
  });
  $("all-dates").addEventListener("click", () => {
    $("filter-date").value = "";
    page = 0;
    refresh();
  });
  function selectDay(offset) {
    const base =
      offset === 0 ? api.dateTR() : $("filter-date").value || api.dateTR();
    $("filter-date").value = new Date(
      Date.parse(base + "T12:00:00Z") + offset * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    page = 0;
    refresh();
  }
  $("previous-day").addEventListener("click", () => selectDay(-1));
  $("next-day").addEventListener("click", () => selectDay(1));
  $("today-shortcut").addEventListener("click", () => {
    $("filter-status").value = "";
    $("filter-search").value = "";
    selectDay(0);
  });
  $("pending-shortcut").addEventListener("click", () => {
    $("filter-date").value = "";
    $("filter-search").value = "";
    $("filter-status").value = "bekliyor";
    page = 0;
    refresh();
  });
  $("refresh-list").addEventListener("click", () => {
    message("");
    refresh();
  });
  $("page-prev").addEventListener("click", () => {
    if (page > 0) page--;
    refresh();
  });
  $("page-next").addEventListener("click", () => {
    page++;
    refresh();
  });
  $("alarm-toggle").addEventListener("click", async () => {
    try {
      if (!audio)
        audio = new (window.AudioContext || window.webkitAudioContext)();
      await audio.resume();
      alarm = !alarm;
      $("alarm-toggle").textContent = alarm
        ? "Sesli uyarıyı kapat"
        : "Sesli uyarıyı aç";
      $("alarm-toggle").setAttribute("aria-pressed", String(alarm));
      refresh();
    } catch {
      message("Tarayıcı sesli uyarıyı açamadı.", true);
    }
  });
  setInterval(() => {
    if (
      !authorized ||
      !alarm ||
      !pending ||
      !audio ||
      audio.state !== "running"
    )
      return;
    const osc = audio.createOscillator(),
      gain = audio.createGain(),
      now = audio.currentTime;
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(
      (Number($("alarm-volume").value) / 100) * 0.25,
      now + 0.025,
    );
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(now + 0.5);
  }, 2200);
  document.querySelectorAll("[data-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      document
        .querySelectorAll("[data-tab]")
        .forEach((b) => b.classList.toggle("selected", b === button));
      $("appointments-view").hidden = button.dataset.tab !== "appointments";
      $("settings-view").hidden = button.dataset.tab !== "settings";
    }),
  );
  function field(title, type, value) {
    const label = el("label", title),
      input = el("input");
    input.type = type;
    if (type === "checkbox") input.checked = value;
    else input.value = value ?? "";
    label.append(input);
    return { label, input };
  }
  async function save(button, operation) {
    button.disabled = true;
    try {
      const { data, error } = await operation();
      if (error) throw error;
      if (Array.isArray(data) && !data.length) throw Error("No rows");
      message("Değişiklik kaydedildi.");
    } catch (e) {
      message(api.errorMessage(e), true);
    } finally {
      button.disabled = false;
    }
  }
  async function loadSettings() {
    if (!authorized) return;
    const session = epoch;
    const [cfg, services, hours, closures] = await Promise.all([
      db.from("gh_settings").select("*").single(),
      db.from("gh_services").select("*").order("sort_order"),
      db.from("gh_hours").select("*").order("day"),
      db.from("gh_closures").select("*").order("day"),
    ]);
    if (session !== epoch || !authorized) return;
    if (cfg.error || services.error || hours.error || closures.error)
      return message("Salon ayarları yüklenemedi.", true);
    $("booking-enabled").checked = cfg.data.booking_enabled;
    $("notice-minutes").value = cfg.data.notice_minutes;
    $("horizon-days").value = cfg.data.horizon_days;
    $("services-editor").replaceChildren();
    services.data.forEach((s) => {
      const form = el("form", null, "editor-row"),
        name = el("strong", s.name),
        duration = field("Süre (dakika)", "number", s.duration_minutes),
        price = field("Fiyat (TL)", "number", s.price),
        active = field("Aktif", "checkbox", s.active),
        button = el("button", "Kaydet", "small-button");
      duration.input.min = "15";
      duration.input.max = "240";
      duration.input.step = "15";
      duration.input.required = true;
      price.input.min = "0";
      price.input.max = "99999999";
      price.input.step = ".01";
      button.type = "submit";
      form.append(name, duration.label, price.label, active.label, button);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        save(button, () =>
          db
            .from("gh_services")
            .update({
              duration_minutes: Number(duration.input.value),
              price:
                price.input.value === "" ? null : Number(price.input.value),
              active: active.input.checked,
            })
            .eq("id", s.id)
            .select("id"),
        );
      });
      $("services-editor").append(form);
    });
    $("hours-editor").replaceChildren();
    hours.data.forEach((h) => {
      const form = el("form", null, "editor-row"),
        opens = field("Açılış", "time", h.opens.slice(0, 5)),
        closes = field("Kapanış", "time", h.closes.slice(0, 5)),
        closed = field("Kapalı", "checkbox", h.closed),
        button = el("button", "Kaydet", "small-button");
      opens.input.required = closes.input.required = true;
      button.type = "submit";
      form.append(
        el(
          "strong",
          [
            "Pazar",
            "Pazartesi",
            "Salı",
            "Çarşamba",
            "Perşembe",
            "Cuma",
            "Cumartesi",
          ][h.day],
        ),
        opens.label,
        closes.label,
        closed.label,
        button,
      );
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (opens.input.value >= closes.input.value)
          return message("Kapanış açılıştan sonra olmalı.", true);
        save(button, () =>
          db
            .from("gh_hours")
            .update({
              opens: opens.input.value,
              closes: closes.input.value,
              closed: closed.input.checked,
            })
            .eq("day", h.day)
            .select("day"),
        );
      });
      $("hours-editor").append(form);
    });
    $("closures-list").replaceChildren();
    closures.data.forEach((c) => {
      const row = el("div", null, "closure-row"),
        button = el("button", "Günü tekrar aç", "small-button");
      row.append(
        el("span", `${c.day.split("-").reverse().join("/")} · ${c.reason}`),
        button,
      );
      button.addEventListener("click", async () => {
        await save(button, () =>
          db.from("gh_closures").delete().eq("day", c.day).select("day"),
        );
        loadSettings();
      });
      $("closures-list").append(row);
    });
  }
  $("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await save(e.submitter, () =>
      db
        .from("gh_settings")
        .update({
          booking_enabled: $("booking-enabled").checked,
          notice_minutes: Number($("notice-minutes").value),
          horizon_days: Number($("horizon-days").value),
        })
        .eq("id", true)
        .select("id"),
    );
  });
  $("closure-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await save(e.submitter, () =>
      db
        .from("gh_closures")
        .insert({
          day: $("closure-day").value,
          reason: $("closure-reason").value.trim(),
        })
        .select("day"),
    );
    loadSettings();
  });
  setInterval(() => {
    if (authorized && !document.hidden) refresh();
  }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && authorized) refresh();
  });
  if (!api.ready) {
    $("login-message").textContent =
      "Yönetici girişi henüz açılmadı. Paneli aşağıdaki önizlemeden inceleyebilirsiniz.";
    $("login-submit").disabled = true;
  } else {
    db.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && authorized) return;
      setTimeout(() => gate(session), 0);
    });
  }
})();
