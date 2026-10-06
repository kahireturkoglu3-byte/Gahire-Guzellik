(async () => {
  const api = window.GahireAPI,
    $ = (id) => document.getElementById(id),
    form = $("booking-form");
  if (!form) return;
  const member = await window.GahireMember;
  if (!member) return;
  $("customer-name").value = member.full_name;
  $("customer-phone").value = member.phone;
  $("customer-name").readOnly = $("customer-phone").readOnly = true;
  let packages = [];
  let services = [],
    settings = null,
    step = 1,
    selected = null,
    slotRequest = 0,
    submitting = false,
    requestId = null,
    lastPayload = "",
    widget = null,
    token = "";
  const note = (text, bad = false) => {
    $("booking-message").textContent = text;
    $("booking-message").classList.toggle("error", bad);
  };
  function navigate(to) {
    step = to;
    document
      .querySelectorAll("[data-booking-step]")
      .forEach((el) => (el.hidden = Number(el.dataset.bookingStep) !== to));
    document.querySelectorAll(".booking-progress li").forEach((li, i) => {
      li.classList.toggle("current", i + 1 === to);
      if (i + 1 === to) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    $("booking-prev").hidden = to === 1;
    $("booking-next").hidden = to === 3;
    $("booking-submit").hidden = to !== 3;
    $("booking-step-title").textContent = [
      "Bakımınızı ve zamanınızı seçin",
      "Sizi tanıyalım",
      "Talebinizi kontrol edin",
    ][to - 1];
    $("booking-step-title").focus();
    if (to === 3) {
      const s = services.find((s) => s.id === $("booking-service").value);
      const selectedPackage = packages.find(
        (p) => p.id === $("booking-package").value,
      );
      $("booking-summary").textContent =
        `${s.name} · ${s.duration_minutes} dakika\n${api.fullTR(selected.starts_at)} – ${api.timeTR(selected.ends_at)}\n${$("customer-name").value.trim()} · ${api.phone($("customer-phone").value)}\n${selectedPackage ? "Paket seansı: " + selectedPackage.label : s.price == null ? "Fiyat için salon sizinle iletişime geçecektir." : Number(s.price).toLocaleString("tr-TR") + " TL"}`;
      ensureCaptcha();
    }
  }
  function ensureCaptcha() {}
  async function loadSlots(quiet = false) {
    if (submitting) return;
    const current = ++slotRequest;
    const service = $("booking-service").value,
      day = $("booking-date").value;
    const old = selected;
    selected = null;
    $("selected-time").textContent = "Henüz saat seçilmedi.";
    $("time-slots").replaceChildren();
    if (!service || !day || !api.ready) return;
    $("slot-message").textContent = "Uygun saatler kontrol ediliyor…";
    try {
      const slots = await api.edge({ action: "slots", service, day });
      if (current !== slotRequest) return;
      if (!slots.length) {
        $("slot-message").textContent =
          "Bu tarih için uygun saat bulunmuyor. Başka bir gün seçebilirsiniz.";
        return;
      }
      $("slot-message").textContent =
        "Saatler Türkiye saatine göredir. Pasif saatler doludur.";
      slots.forEach((slot) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = api.timeTR(slot.starts_at);
        button.disabled = !slot.available;
        button.setAttribute("aria-pressed", "false");
        button.setAttribute(
          "aria-label",
          `${button.textContent}${slot.available ? " — müsait" : " — dolu"}`,
        );
        const select = () => {
          selected = slot;
          $("time-slots")
            .querySelectorAll("button")
            .forEach((b) => b.setAttribute("aria-pressed", "false"));
          button.setAttribute("aria-pressed", "true");
          $("selected-time").textContent =
            `Seçiminiz: ${api.fullTR(slot.starts_at)} – ${api.timeTR(slot.ends_at)}`;
        };
        button.addEventListener("click", select);
        $("time-slots").append(button);
        if (quiet && old?.starts_at === slot.starts_at && slot.available)
          select();
      });
      if (quiet && old && !selected)
        note(
          "Seçtiğiniz saat artık uygun değil. Lütfen yeni bir saat seçin.",
          true,
        );
    } catch (e) {
      if (current !== slotRequest) return;
      $("slot-message").textContent = api.errorMessage(e);
    }
  }
  $("booking-service").addEventListener("change", () => {
    navigate(1);
    loadSlots();
  });
  $("booking-date").addEventListener("change", () => loadSlots());
  $("refresh-slots").addEventListener("click", () => loadSlots(true));
  $("booking-next").addEventListener("click", () => {
    note("");
    if (step === 1) {
      if (!selected)
        return note("Önce hizmet, tarih ve müsait bir saat seçin.", true);
      navigate(2);
    } else {
      if (
        !$("customer-name").reportValidity() ||
        !$("customer-phone").reportValidity() ||
        !$("customer-note").reportValidity()
      )
        return;
      if (!api.phone($("customer-phone").value))
        return note(
          "05xx xxx xx xx biçiminde geçerli bir cep telefonu yazın.",
          true,
        );
      if ($("customer-name").value.trim().length < 2)
        return note("Adınızı ve soyadınızı yazın.", true);
      navigate(3);
    }
  });
  $("booking-prev").addEventListener("click", () => navigate(step - 1));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (step !== 3 || submitting) return;
    if (!api.ready || !settings?.booking_enabled)
      return note("Online randevu henüz açılmadı.", true);
    if (!selected) return note("Saat seçiminizi yeniden yapın.", true);
    if (!$("booking-consent").checked)
      return note("Randevu iletişimi için onay kutusunu işaretleyin.", true);
    const payload = {
      service: $("booking-service").value,
      package: $("booking-package").value || null,
      start: selected.starts_at,
      name: $("customer-name").value.trim(),
      phone: api.phone($("customer-phone").value),
      note: $("customer-note").value.trim(),
    };
    const key = JSON.stringify(payload);
    if (lastPayload !== key) {
      requestId = crypto.randomUUID();
      lastPayload = key;
    }
    submitting = true;
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    note("Randevu talebiniz kaydediliyor…");
    try {
      const result = await api.edge({
        action: "book",
        ...payload,
        id: requestId,
        token,
        consent: true,
        website: $("website").value,
      });
      form.hidden = true;
      $("booking-success").hidden = false;
      $("booking-success-text").textContent =
        `${result.service_name} · ${api.fullTR(result.starts_at)}\nTalep numaranız: ${result.id}\nDurum: ${result.status === "bekliyor" ? "Salon onayı bekliyor" : result.status === "onaylandi" ? "Onaylandı" : result.status === "iptal" ? "İptal edildi" : result.status}`;
      const phone = window.GAHIRE.whatsapp.replace(/\D/g, "");
      if (phone) {
        $("booking-whatsapp").hidden = false;
        $("booking-whatsapp").href =
          `https://wa.me/${phone}?text=${encodeURIComponent("Merhaba, randevu talebim hakkında bilgi almak istiyorum. Talep: " + result.id)}`;
      }
      note("");
    } catch (e) {
      note(api.errorMessage(e), true);
      if (e.code === "GH_SLOT") {
        navigate(1);
        submitting = false;
        await loadSlots();
      }
    } finally {
      submitting = false;
      form.querySelectorAll("button").forEach((b) => (b.disabled = false));
      $("time-slots")
        .querySelectorAll("button")
        .forEach((b) => {
          if (b.getAttribute("aria-label").endsWith("— dolu"))
            b.disabled = true;
        });
      token = "";
    }
  });
  async function init() {
    if (!api.ready) {
      $("booking-setup").hidden = false;
      $("booking-setup").textContent =
        "Online randevu yakında açılacak. Şu anda talep alınmıyor.";
      $("booking-next").disabled = true;
      $("booking-date").disabled = true;
      window.GAHIRE.services.forEach((s, i) => {
        const o = new Option(s.name, String(i));
        $("booking-service").add(o);
      });
      return;
    }
    try {
      const [s, c] = await Promise.all([
        api.client
          .from("gh_services")
          .select("*")
          .eq("active", true)
          .order("sort_order"),
        api.client.from("gh_settings").select("*").single(),
      ]);
      if (s.error || c.error)
        throw Error(
          "Randevu bilgileri yüklenemedi. Lütfen daha sonra tekrar deneyin.",
        );
      services = s.data;
      settings = c.data;
      services.forEach((s) =>
        $("booking-service").add(
          new Option(`${s.name} · ${s.duration_minutes} dk`, s.id),
        ),
      );
      $("booking-date").min = api.dateTR();
      $("booking-date").max = api.dateTR(
        new Date(Date.now() + settings.horizon_days * 86400000),
      );
      $("booking-date").value = api.dateTR();
      $("booking-setup").hidden = settings.booking_enabled;
      $("booking-next").disabled = !settings.booking_enabled;
      if (!settings.booking_enabled)
        $("booking-setup").textContent = "Online randevu alımı şu anda kapalı.";
      if (services.some((s) => s.price != null))
        document.querySelector(".prices .section-head>p").textContent =
          "Bakım seçenekleri ve güncel hizmet fiyatlarımız.";
      document.querySelectorAll(".price-row").forEach((row) => {
        const s = services.find(
          (s) => s.name === row.firstElementChild.textContent,
        );
        if (s)
          row.lastElementChild.textContent =
            s.price == null
              ? "Bilgi alınız"
              : Number(s.price).toLocaleString("tr-TR") + " TL";
      });
      const packResult = await api.client
        .from("gh_package_progress")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (packResult.error) throw Error("Paket bilgileriniz yüklenemedi.");
      packages = packResult.data.filter((p) => p.remaining_sessions > 0);
      function fillPackages() {
        const box = $("booking-package"),
          previous = box.value;
        box.replaceChildren(new Option("Paket dışında randevu", ""));
        packages
          .filter((p) => p.service_id === $("booking-service").value)
          .forEach((p) =>
            box.add(
              new Option(
                `${p.label} · ${p.remaining_sessions} seans kaldı`,
                p.id,
              ),
            ),
          );
        if ([...box.options].some((o) => o.value === previous))
          box.value = previous;
      }
      $("booking-service").addEventListener("change", fillPackages);
      const query = new URLSearchParams(location.search);
      if (services.some((s) => s.id === query.get("service"))) {
        $("booking-service").value = query.get("service");
        fillPackages();
        if (
          packages.some(
            (p) =>
              p.id === query.get("package") &&
              p.service_id === $("booking-service").value,
          )
        )
          $("booking-package").value = query.get("package");
        await loadSlots();
      }
    } catch (e) {
      note(api.errorMessage(e), true);
      $("booking-next").disabled = true;
    }
  }
  document.querySelectorAll("[data-book-service]").forEach((link) =>
    link.addEventListener("click", () => {
      const s = services.find((s) => s.name === link.dataset.bookService);
      if (s) {
        $("booking-service").value = s.id;
        navigate(1);
        loadSlots();
      }
    }),
  );
  setInterval(() => {
    if (!document.hidden && step === 1 && selected && !submitting)
      loadSlots(true);
  }, 30000);
  init();
})();
