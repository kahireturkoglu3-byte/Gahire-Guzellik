(() => {
  const api = window.GahireAPI,
    db = api.client,
    $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const statuses = {
    bekliyor: "Salon onayı bekleniyor",
    onaylandi: "Onaylandı",
    iptal: "İptal edildi",
    tamamlandi: "Tamamlandı",
    gelmedi: "Gelmedi",
  };
  let profile = null,
    version = 0,
    widget = null,
    captcha = "",
    busy = false,
    historyPage = 0,
    appointmentPage = 0,
    appointmentRequest = 0,
    historyRequest = 0;
  const msg = (id, text) => {
    $(id).textContent = text;
  };
  $("portal-year").textContent = new Date().getFullYear();
  const contact = window.GAHIRE.whatsapp.replace(/\D/g, "");
  if (contact) {
    $("member-contact").hidden = false;
    $("member-contact").href = "https://wa.me/" + contact;
  }
  function show(id) {
    ["member-login", "password-panel", "member-dashboard"].forEach(
      (name) => ($(name).hidden = name !== id),
    );
  }
  function clearPrivate() {
    profile = null;
    version++;
    [
      "next-appointment",
      "member-packages",
      "member-appointment-list",
      "member-history-list",
      "account-name",
      "account-username",
      "account-phone",
      "member-first-name",
    ].forEach((id) => $(id).replaceChildren());
  }
  function renderCaptcha() {
    if (widget !== null || !window.turnstile) return;
    widget = window.turnstile.render("#login-captcha", {
      sitekey: window.GAHIRE_BACKEND.turnstileSiteKey,
      action: "member_login",
      theme: "light",
      size: "compact",
      language: "tr",
      callback: (t) => {
        captcha = t;
      },
      "expired-callback": () => {
        captcha = "";
      },
      "error-callback": () => {
        captcha = "";
        msg(
          "member-login-message",
          "Güvenlik doğrulaması yüklenemedi. Sayfayı yenileyin.",
        );
      },
    });
  }
  function loginView(message = "") {
    if (!message && api.ready && !window.GAHIRE_BACKEND.turnstileSiteKey)
      message =
        "Müşteri girişi henüz kullanıma açılmadı. Giriş güvenliği kurulumu tamamlanıyor.";
    clearPrivate();
    show("member-login");
    $("member-password").value = "";
    msg("member-login-message", message);
  }
  async function gate(session) {
    const ticket = ++version;
    if (!session) {
      loginView();
      return;
    }
    try {
      const admin = await db
        .from("gh_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (ticket !== version) return;
      if (admin.data) {
        loginView(
          "Yönetici oturumunuz açık. Salon girişi bağlantısından panele dönebilirsiniz.",
        );
        return;
      }
      const r = await db
        .from("gh_members")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (ticket !== version) return;
      if (r.error || !r.data) {
        loginView(
          "Oturumunuz geçersiz veya hesabınız kapalı. Yeniden giriş yapın.",
        );
        return;
      }
      profile = r.data;
      if (profile.must_change_password) {
        show("password-panel");
        $("password-back").hidden = true;
        return;
      }
      show("member-dashboard");
      $("member-first-name").textContent =
        profile.full_name.split(" ")[0] + ".";
      $("account-name").textContent = profile.full_name;
      $("account-username").textContent = profile.username;
      $("account-phone").textContent = profile.phone;
      await loadOverview();
    } catch {
      loginView("Hesabınız doğrulanamadı. Lütfen tekrar deneyin.");
    }
  }
  $("show-password").addEventListener("click", () => {
    const input = $("member-password"),
      shown = input.type === "password";
    input.type = shown ? "text" : "password";
    $("show-password").textContent = shown ? "Gizle" : "Göster";
    $("show-password").setAttribute("aria-pressed", String(shown));
    $("show-password").setAttribute(
      "aria-label",
      shown ? "Şifreyi gizle" : "Şifreyi göster",
    );
  });
  $("member-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || !api.ready) return;
    if (!captcha)
      return msg("member-login-message", "Güvenlik doğrulamasını tamamlayın.");
    busy = true;
    $("member-login-submit").disabled = true;
    msg("member-login-message", "Giriş yapılıyor…");
    try {
      const tokens = await api.edge({
        action: "member_login",
        username: $("member-username").value.trim().toLowerCase(),
        password: $("member-password").value,
        token: captcha,
      });
      const { error } = await db.auth.setSession(tokens);
      if (error) throw error;
      $("member-password").value = "";
    } catch (error) {
      msg("member-login-message", api.errorMessage(error));
    } finally {
      busy = false;
      $("member-login-submit").disabled = false;
      captcha = "";
      if (widget !== null) window.turnstile.reset(widget);
    }
  });
  async function logout() {
    clearPrivate();
    show("member-login");
    await api.edge({ action: "member_logout" }).catch(() => {});
    await db.auth.signOut({ scope: "local" });
  }
  document
    .querySelectorAll("[data-member-logout]")
    .forEach((b) => b.addEventListener("click", logout));
  $("password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const value = $("new-password").value;
    if (value !== $("repeat-password").value)
      return msg("password-message", "Şifreler aynı olmalı.");
    if (value.length < 12 || !/[a-zA-Z]/.test(value) || !/[0-9]/.test(value))
      return msg(
        "password-message",
        "En az 12 karakter, harf ve rakam kullanın.",
      );
    busy = true;
    const button = e.submitter;
    button.disabled = true;
    try {
      await api.edge({ action: "change_password", password: value });
      $("password-form").reset();
      msg("password-message", "");
      const { data } = await db.auth.getSession();
      await gate(data.session);
    } catch (error) {
      msg("password-message", api.errorMessage(error));
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
  $("open-password").addEventListener("click", () => {
    show("password-panel");
    $("password-back").hidden = false;
  });
  $("password-back").addEventListener("click", () => {
    show("member-dashboard");
    $("password-form").reset();
  });
  function appointmentCard(a) {
    const card = el("article", null, "member-appointment");
    card.append(
      el("span", statuses[a.status] || a.status, "status status-" + a.status),
      el("h3", a.service_name),
      el("p", api.fullTR(a.starts_at) + " – " + api.timeTR(a.ends_at)),
      el("small", a.duration_minutes + " dakika"),
    );
    if (contact) {
      const link = el("a", "Salonla iletişime geçin", "text-link");
      link.href =
        "https://wa.me/" +
        contact +
        "?text=" +
        encodeURIComponent(
          "Merhaba, " +
            api.fullTR(a.starts_at) +
            " tarihli randevum hakkında bilgi almak istiyorum.",
        );
      link.target = "_blank";
      link.rel = "noopener";
      card.append(link);
    }
    return card;
  }
  async function loadOverview() {
    if (!profile) return;
    const ticket = version;
    msg("portal-message", "Bilgileriniz güncelleniyor…");
    try {
      const [ap, packages, count] = await Promise.all([
        db
          .from("gh_appointments")
          .select("*", { count: "exact" })
          .in("status", ["bekliyor", "onaylandi"])
          .gte("ends_at", new Date().toISOString())
          .order("starts_at")
          .limit(1),
        db
          .from("gh_package_progress")
          .select("*")
          .order("created_at", { ascending: false }),
        db
          .from("gh_sessions")
          .select("id", { count: "exact", head: true })
          .eq("voided", false),
      ]);
      if (ticket !== version || !profile) return;
      if (ap.error || packages.error || count.error)
        throw Error("Bilgileriniz yüklenemedi. Lütfen yenileyin.");
      $("member-upcoming-count").textContent = ap.count;
      $("member-completed-count").textContent = count.count;
      $("member-remaining-count").textContent = packages.data
        .filter((p) => p.active)
        .reduce((sum, p) => sum + p.remaining_sessions, 0);
      $("next-appointment").replaceChildren(
        ap.data.length
          ? appointmentCard(ap.data[0])
          : el(
              "p",
              "Henüz yaklaşan randevunuz yok. Size uygun bir zaman seçebilirsiniz.",
              "empty-state",
            ),
      );
      $("member-packages").replaceChildren();
      if (!packages.data.length)
        $("member-packages").append(
          el(
            "p",
            "Salon tarafından tanımlanan bakım paketleriniz burada görünecek.",
            "empty-state",
          ),
        );
      packages.data.forEach((p) => {
        const card = el("article", null, "member-package");
        card.append(
          el("p", p.active ? "BAKIM PAKETİ" : "ARŞİV", "eyebrow"),
          el("h3", p.label),
        );
        const stat = el(
          "p",
          `${p.remaining_sessions} seans kaldı`,
          "package-count",
        );
        card.append(
          stat,
          el(
            "p",
            `${p.completed_sessions} / ${p.total_sessions} seans tamamlandı`,
            "muted",
          ),
        );
        const progress = el("progress");
        progress.max = p.total_sessions;
        progress.value = p.completed_sessions;
        progress.setAttribute("aria-label", p.label + " tamamlanma durumu");
        card.append(progress);
        if (p.next_due && p.remaining_sessions > 0)
          card.append(
            el(
              "p",
              "Salonun önerdiği tarih: " +
                p.next_due.split("-").reverse().join("/"),
              "muted",
            ),
          );
        if (p.active && p.remaining_sessions > 0) {
          const link = el("a", "Bu paket için randevu al", "small-button");
          link.href =
            "salon.html?service=" +
            encodeURIComponent(p.service_id) +
            "&package=" +
            encodeURIComponent(p.id) +
            "#randevu";
          card.append(link);
        } else
          card.append(
            el(
              "span",
              p.remaining_sessions === 0 ? "Paket tamamlandı" : "Paket kapalı",
              "status",
            ),
          );
        $("member-packages").append(card);
      });
      msg("portal-message", "");
    } catch (e) {
      if (ticket === version) msg("portal-message", api.errorMessage(e));
    }
  }
  async function loadHistory(append = false) {
    if (!profile) return;
    const ticket = version,
      request = ++historyRequest;
    const r = await db
      .from("gh_sessions")
      .select("*")
      .order("performed_at", { ascending: false })
      .range(historyPage * 20, historyPage * 20 + 19);
    if (ticket !== version || !profile) return;
    if (request !== historyRequest) return false;
    if (r.error) {
      msg("portal-message", "İşlem geçmişi yüklenemedi. Tekrar deneyin.");
      return false;
    }
    if (!append) $("member-history-list").replaceChildren();
    r.data.forEach((s) => {
      const card = el("article", null, "history-entry");
      card.append(
        el("p", api.fullTR(s.performed_at), "eyebrow"),
        el("h3", s.service_name),
      );
      if (s.note) card.append(el("p", s.note));
      if (!s.voided && s.service_id) {
        const again = el("a", "Bu hizmet için tekrar randevu al", "text-link");
        again.href =
          "salon.html?service=" + encodeURIComponent(s.service_id) + "#randevu";
        card.append(again);
      }
      if (s.voided)
        card.append(
          el(
            "p",
            "Kayıt düzeltilmek üzere iptal edildi: " + s.void_reason,
            "muted",
          ),
        );
      $("member-history-list").append(card);
    });
    if (!append && !r.data.length)
      $("member-history-list").append(
        el("p", "Tamamlanan işlemleriniz henüz bulunmuyor.", "empty-state"),
      );
    $("more-history").hidden = r.data.length < 20;
    return true;
  }
  async function loadAppointments(append = false) {
    if (!profile) return;
    const ticket = version,
      request = ++appointmentRequest;
    const filter = $("member-appointment-filter").value;
    let query = db.from("gh_appointments").select("*");
    if (filter === "upcoming")
      query = query
        .in("status", ["bekliyor", "onaylandi"])
        .gte("ends_at", new Date().toISOString());
    else if (filter) query = query.eq("status", filter);
    const r = await query
      .order("starts_at", { ascending: filter === "upcoming" })
      .order("id")
      .range(appointmentPage * 20, appointmentPage * 20 + 19);
    if (ticket !== version || !profile) return;
    if (request !== appointmentRequest) return false;
    if (r.error) {
      msg("portal-message", "Randevularınız yüklenemedi. Tekrar deneyin.");
      return false;
    }
    if (!append) $("member-appointment-list").replaceChildren();
    r.data.forEach((a) =>
      $("member-appointment-list").append(appointmentCard(a)),
    );
    if (!append && !r.data.length)
      $("member-appointment-list").append(
        el("p", "Bu seçime uygun randevunuz bulunmuyor.", "empty-state"),
      );
    $("more-appointments").hidden = r.data.length < 20;
    return true;
  }
  document.querySelectorAll("[data-member-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      const tab = button.dataset.memberTab;
      ["overview", "appointments", "history", "account"].forEach(
        (t) => ($("member-" + t).hidden = t !== tab),
      );
      document.querySelectorAll("[data-member-tab]").forEach((b) => {
        b.classList.toggle("selected", b === button);
        b.setAttribute("aria-pressed", String(b === button));
      });
      if (tab === "history") {
        historyPage = 0;
        loadHistory();
      }
      if (tab === "appointments") {
        appointmentPage = 0;
        loadAppointments();
      }
    }),
  );
  $("member-appointment-filter").addEventListener("change", () => {
    appointmentPage = 0;
    $("member-appointment-list").replaceChildren();
    $("more-appointments").hidden = true;
    loadAppointments();
  });
  $("more-history").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    historyPage++;
    if (!(await loadHistory(true))) historyPage--;
    $("more-history").disabled = false;
  });
  $("more-appointments").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    const filter = $("member-appointment-filter").value;
    appointmentPage++;
    if (
      !(await loadAppointments(true)) &&
      filter === $("member-appointment-filter").value
    )
      appointmentPage = Math.max(0, appointmentPage - 1);
    $("more-appointments").disabled = false;
  });
  $("member-refresh").addEventListener("click", loadOverview);
  if (!api.ready) {
    $("member-login-submit").disabled = true;
    msg(
      "member-login-message",
      "Müşteri girişi yakında açılacak. Hesap bağlantısı henüz tamamlanmadı.",
    );
  } else {
    if (window.GAHIRE_BACKEND.turnstileSiteKey) {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = renderCaptcha;
      script.onerror = () =>
        msg("member-login-message", "Güvenlik doğrulaması yüklenemedi.");
      document.head.append(script);
    } else {
      $("member-login-submit").disabled = true;
      msg("member-login-message", "Müşteri girişi henüz kullanıma açılmadı.");
    }
    db.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && profile) return;
      setTimeout(() => gate(session), 0);
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !busy)
        db.auth.getSession().then(({ data }) => gate(data.session));
    });
  }
})();
