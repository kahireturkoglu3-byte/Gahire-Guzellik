(() => {
  const api = window.GahireAPI,
    db = api.client,
    $ = (id) => document.getElementById(id);
  const node = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  let allowed = false,
    epoch = 0,
    page = 0,
    searchTimer,
    member = null,
    packages = [],
    appointments = [],
    services = [],
    recordId = null,
    recordKey = "",
    listTicket = 0,
    detailTicket = 0,
    working = false;
  const message = (t) => ($("members-message").textContent = t);
  function clear() {
    allowed = false;
    epoch++;
    detailTicket++;
    member = null;
    $("admin-member-list").replaceChildren();
    $("customer-detail").hidden = true;
    $("customer-packages").replaceChildren();
    $("customer-sessions").replaceChildren();
    $("credential-text").textContent = "";
    $("credential-dialog").close();
    $("create-member-dialog").close();
  }
  window.addEventListener("gahire:admin-logout", clear);
  window.addEventListener("gahire:admin-ready", async () => {
    allowed = true;
    epoch++;
    const v = epoch;
    const r = await db.from("gh_services").select("*").order("sort_order");
    if (v !== epoch || !allowed) return;
    if (r.error) return message("Hizmetler yüklenemedi.");
    services = r.data;
    ["package-service", "session-service"].forEach((id) => {
      const select = $(id);
      select.replaceChildren();
      services.forEach((s) => select.add(new Option(s.name, s.id)));
    });
    loadMembers();
  });
  document.querySelectorAll("[data-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      $("members-view").hidden = button.dataset.tab !== "members";
      if (button.dataset.tab === "members") loadMembers();
    }),
  );
  async function loadMembers() {
    if (!allowed) return;
    const request = ++listTicket,
      v = epoch;
    let q = db
      .from("gh_members")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    const search = $("member-search")
      .value.trim()
      .replace(/[^\p{L}\p{N} ._-]/gu, "");
    const status = $("member-status-filter").value;
    if (status === "active") q = q.eq("active", true);
    if (status === "inactive") q = q.eq("active", false);
    if (status === "first")
      q = q.eq("active", true).eq("must_change_password", true);
    if (search)
      q = q.or(
        `full_name.ilike.%${search}%,username.ilike.%${search}%,phone.ilike.%${search.replace(/\s/g, "")}%`,
      );
    const r = await q.range(page * 25, page * 25 + 24);
    if (v !== epoch || request !== listTicket || !allowed) return;
    if (r.error) return message("Müşteriler yüklenemedi.");
    $("admin-member-list").replaceChildren();
    if (!r.data.length)
      $("admin-member-list").append(
        node("p", "Bu aramaya uygun müşteri bulunmuyor.", "empty-state"),
      );
    r.data.forEach((m) => {
      const row = node("div", null, "customer-list-row");
      const info = node("div");
      info.append(
        node("strong", m.full_name),
        node("p", m.username + " · " + m.phone, "muted"),
      );
      const status = node(
        "span",
        !m.active
          ? "Kapalı"
          : m.must_change_password
            ? "İlk giriş bekleniyor"
            : "Aktif",
        "status",
      );
      const button = node("button", "Dosyayı aç", "small-button");
      button.addEventListener("click", () => openCustomer(m.user_id));
      row.append(info, status, button);
      $("admin-member-list").append(row);
    });
    $("members-page").textContent = `${r.count} müşteri · Sayfa ${page + 1}`;
    $("members-prev").disabled = page === 0;
    $("members-next").disabled = (page + 1) * 25 >= r.count;
  }
  $("member-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page = 0;
      loadMembers();
    }, 300);
  });
  window.addEventListener("gahire:open-customer", (event) => {
    if (!allowed) return;
    document.querySelector('[data-tab="members"]').click();
    openCustomer(event.detail);
  });
  $("member-status-filter").addEventListener("change", () => {
    page = 0;
    loadMembers();
  });
  $("refresh-members").addEventListener("click", loadMembers);
  $("members-prev").addEventListener("click", () => {
    page = Math.max(0, page - 1);
    loadMembers();
  });
  $("members-next").addEventListener("click", () => {
    page++;
    loadMembers();
  });
  function password() {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    return "Gh9!" + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "x");
  }
  $("open-create-member").addEventListener("click", () => {
    if (!allowed) return;
    $("create-member-form").reset();
    $("create-username").setCustomValidity("");
    $("create-password").value = password();
    $("create-member-message").textContent = "";
    $("create-member-dialog").showModal();
  });
  $("generate-password").addEventListener(
    "click",
    () => ($("create-password").value = password()),
  );
  document
    .querySelectorAll("[data-close-member-dialog]")
    .forEach((b) =>
      b.addEventListener("click", () => $("create-member-dialog").close()),
    );
  function credentials(username, pass) {
    $("credential-text").textContent =
      `Kullanıcı adı: ${username}\nGeçici şifre: ${pass}\nGiriş: ${new URL("index.html", location.href).href}\nİlk girişte şifrenizi değiştirin.`;
    $("credential-message").textContent = "";
    $("credential-dialog").showModal();
  }
  $("close-credentials").addEventListener("click", () =>
    $("credential-dialog").close(),
  );
  $("credential-dialog").addEventListener(
    "close",
    () => ($("credential-text").textContent = ""),
  );
  $("copy-credentials").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("credential-text").textContent);
      $("credential-message").textContent = "Kopyalandı.";
    } catch {
      $("credential-message").textContent =
        "Kopyalanamadı. Metni seçerek kopyalayabilirsiniz.";
    }
  });
  const usernameHint =
    "Kullanıcı adı 3–32 karakter olmalı; küçük İngilizce harf veya rakamla başlamalı. Türkçe harf ve boşluk kullanmayın. Örnek: emirhan.gurbuz";
  $("create-username").addEventListener("input", () => {
    $("create-username").setCustomValidity("");
    $("create-member-message").textContent = "";
  });
  $("create-username").addEventListener("invalid", () => {
    $("create-username").setCustomValidity(usernameHint);
    $("create-member-message").textContent = usernameHint;
  });
  $("create-member-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (working || !allowed) return;
    const name = $("create-name").value.trim();
    const username = $("create-username").value.trim().toLowerCase();
    if (name.length < 2 || name.length > 80)
      return ($("create-member-message").textContent = "Ad soyad 2–80 karakter olmalı.");
    if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username))
      return ($("create-member-message").textContent = usernameHint);
    const phone = api.phone($("create-phone").value);
    if (!phone)
      return ($("create-member-message").textContent =
        "Geçerli bir cep telefonu yazın.");
    const pass = $("create-password").value,
      v = epoch;
    working = true;
    e.submitter.disabled = true;
    try {
      await api.edge({
        action: "create_member",
        name,
        phone,
        username,
        password: pass,
      });
      if (v !== epoch || !allowed) return;
      $("create-member-dialog").close();
      $("create-member-form").reset();
      credentials(username, pass);
      page = 0;
      await loadMembers();
    } catch (error) {
      $("create-member-message").textContent = api.errorMessage(error);
    } finally {
      working = false;
      e.submitter.disabled = false;
    }
  });
  async function openCustomer(id, appointmentId = null) {
    if (!allowed) return;
    const v = epoch,
      ticket = ++detailTicket;
    const [m, p, a, s] = await Promise.all([
      db.from("gh_members").select("*").eq("user_id", id).single(),
      db
        .from("gh_package_progress")
        .select("*")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      db
        .from("gh_appointments")
        .select("*")
        .eq("customer_id", id)
        .eq("status", "onaylandi")
        .order("starts_at", { ascending: false })
        .limit(100),
      db
        .from("gh_sessions")
        .select("*")
        .eq("customer_id", id)
        .order("performed_at", { ascending: false })
        .limit(20),
    ]);
    if (v !== epoch || ticket !== detailTicket || !allowed) return;
    if (m.error || p.error || a.error || s.error)
      return message("Müşteri dosyası yüklenemedi.");
    member = m.data;
    packages = p.data;
    appointments = a.data;
    $("customer-detail").hidden = false;
    $("customer-title").textContent = member.full_name;
    $("customer-info").textContent = member.username + " · " + member.phone;
    $("customer-active").textContent = member.active
      ? "Hesabı kapat"
      : "Hesabı yeniden aç";
    $("customer-packages").replaceChildren();
    packages.forEach((p) => {
      const card = node("article", null, "member-package");
      card.append(
        node("h3", p.label),
        node(
          "p",
          `${p.completed_sessions} tamamlandı · ${p.remaining_sessions} kaldı`,
        ),
      );
      if (p.next_due)
        card.append(
          node(
            "p",
            "Önerilen tarih: " + p.next_due.split("-").reverse().join("/"),
            "muted",
          ),
        );
      $("customer-packages").append(card);
    });
    if (!packages.length)
      $("customer-packages").append(
        node("p", "Tanımlı bakım paketi yok.", "empty-state"),
      );
    $("session-form").reset();
    $("session-when").value = api.dateTR() + "T" + api.timeTR(new Date());
    $("session-appointment").replaceChildren(
      new Option("Randevusuz işlem", ""),
    );
    appointments.forEach((a) =>
      $("session-appointment").add(
        new Option(a.service_name + " · " + api.fullTR(a.starts_at), a.id),
      ),
    );
    pickAppointment();
    $("customer-sessions").replaceChildren();
    s.data.forEach((log) => {
      const row = node("article", null, "history-entry");
      row.append(
        node("p", api.fullTR(log.performed_at), "eyebrow"),
        node("h3", log.service_name),
      );
      if (log.note) row.append(node("p", log.note));
      if (log.voided)
        row.append(
          node("p", "İptal edilen kayıt: " + log.void_reason, "muted"),
        );
      else {
        const button = node("button", "Hatalı kaydı iptal et", "small-button");
        button.addEventListener("click", async () => {
          const reason = prompt(
            "Bu işlem kaydı neden iptal ediliyor? Müşteriye de görünecektir.",
          );
          if (!reason || reason.trim().length < 3) return;
          button.disabled = true;
          try {
            await api.edge({ action: "void_session", id: log.id, reason });
            message("Kayıt iptal edildi; paket sayacı güncellendi.");
            await openCustomer(id);
          } catch (error) {
            message(api.errorMessage(error));
          } finally {
            button.disabled = false;
          }
        });
        row.append(button);
      }
      $("customer-sessions").append(row);
    });
    if (appointmentId) {
      $("record-details").open = true;
      $("session-appointment").value = appointmentId;
      pickAppointment();
    }
    $("customer-detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function fillSessionPackages() {
    const select = $("session-package");
    select.replaceChildren(new Option("Paket dışında işlem", ""));
    packages
      .filter((p) => p.service_id === $("session-service").value && p.active)
      .forEach((p) =>
        select.add(
          new Option(p.label + " · " + p.remaining_sessions + " seans", p.id),
        ),
      );
  }
  function pickAppointment() {
    const a = appointments.find((a) => a.id === $("session-appointment").value);
    $("session-service").disabled = Boolean(a);
    $("session-package").disabled = Boolean(a);
    $("session-when").readOnly = Boolean(a);
    if (a) {
      $("session-service").value = a.service_id;
      fillSessionPackages();
      $("session-package").value = a.package_id || "";
      $("session-when").value =
        api.dateTR(a.ends_at) + "T" + api.timeTR(a.ends_at);
    } else {
      fillSessionPackages();
      $("session-when").value = api.dateTR() + "T" + api.timeTR(new Date());
    }
  }
  $("session-service").addEventListener("change", fillSessionPackages);
  $("session-appointment").addEventListener("change", pickAppointment);
  $("close-customer").addEventListener("click", () => {
    detailTicket++;
    member = null;
    $("customer-detail").hidden = true;
  });
  $("customer-active").addEventListener("click", async () => {
    if (!member || working) return;
    const chosen = member;
    if (
      !confirm(
        chosen.active
          ? "Müşteri hesabı kapatılsın mı? Mevcut randevuları iptal olmaz; müşteri giriş yapamaz."
          : "Müşteri hesabı yeniden açılsın mı?",
      )
    )
      return;
    working = true;
    try {
      await api.edge({
        action: "set_member_active",
        customer: chosen.user_id,
        active: !chosen.active,
      });
      await openCustomer(chosen.user_id);
      await loadMembers();
      message("Hesap durumu güncellendi.");
    } catch (error) {
      message(api.errorMessage(error));
    } finally {
      working = false;
    }
  });
  $("customer-reset").addEventListener("click", async () => {
    if (!member || working) return;
    const chosen = member;
    if (
      !confirm(
        "Geçici şifre oluşturulsun mu? Müşterinin mevcut oturumu kapatılacak.",
      )
    )
      return;
    const pass = password();
    working = true;
    try {
      await api.edge({
        action: "reset_member",
        customer: chosen.user_id,
        password: pass,
      });
      if (allowed) credentials(chosen.username, pass);
    } catch (error) {
      message(api.errorMessage(error));
    } finally {
      working = false;
    }
  });
  $("package-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!member || working) return;
    const id = member.user_id;
    working = true;
    e.submitter.disabled = true;
    try {
      await api.edge({
        action: "create_package",
        customer: id,
        service: $("package-service").value,
        label: $("package-label").value.trim(),
        total: Number($("package-total").value),
        due: $("package-due").value || null,
      });
      $("package-form").reset();
      await openCustomer(id);
      message("Bakım paketi eklendi.");
    } catch (error) {
      message(api.errorMessage(error));
    } finally {
      working = false;
      e.submitter.disabled = false;
    }
  });
  $("session-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!member || working) return;
    const id = member.user_id;
    const payload = {
      customer: id,
      service: $("session-service").value,
      package: $("session-package").value || null,
      appointment: $("session-appointment").value || null,
      when: new Date($("session-when").value + ":00+03:00").toISOString(),
      note: $("session-note").value.trim(),
      due: $("session-due").value || null,
    };
    const key = JSON.stringify(payload);
    if (key !== recordKey) {
      recordKey = key;
      recordId = crypto.randomUUID();
    }
    working = true;
    e.submitter.disabled = true;
    try {
      await api.edge({ action: "record_session", id: recordId, ...payload });
      recordKey = "";
      await openCustomer(id);
      message("İşlem geçmişe eklendi ve paket sayacı güncellendi.");
    } catch (error) {
      message(api.errorMessage(error));
    } finally {
      working = false;
      e.submitter.disabled = false;
    }
  });
  window.addEventListener("gahire:complete-appointment", (e) => {
    document.querySelector('[data-tab="members"]').click();
    openCustomer(e.detail.customer_id, e.detail.id);
  });
})();
