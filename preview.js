/* Isolated, read-only preview. No backend, credentials, network requests or storage. */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const customers = [
    {
      name: "Deniz · Örnek",
      username: "deniz.ornek",
      status: "Aktif",
      pack: "Epilasyon · 8 seans",
      done: 3,
      total: 8,
    },
    {
      name: "Ece · Örnek",
      username: "ece.ornek",
      status: "İlk giriş bekleniyor",
      pack: "Cilt bakımı · 4 seans",
      done: 0,
      total: 4,
    },
    {
      name: "Selin · Örnek",
      username: "selin.ornek",
      status: "Aktif",
      pack: "Epilasyon · 6 seans",
      done: 4,
      total: 6,
    },
    {
      name: "Ada · Örnek",
      username: "ada.ornek",
      status: "Kapalı",
      pack: "Cilt bakımı · 4 seans",
      done: 4,
      total: 4,
    },
  ];
  const appointments = [
    {
      name: "Deniz · Örnek",
      service: "Epilasyon",
      date: "30 Eylül 2026",
      time: "10:00 – 11:00",
      status: "onaylandi",
      day: 0,
      customer: 0,
    },
    {
      name: "Ece · Örnek",
      service: "Cilt Bakımı",
      date: "30 Eylül 2026",
      time: "11:30 – 12:30",
      status: "bekliyor",
      day: 0,
      customer: 1,
    },
    {
      name: "Selin · Örnek",
      service: "Kaş Tasarımı",
      date: "30 Eylül 2026",
      time: "14:00 – 14:30",
      status: "onaylandi",
      day: 0,
      customer: 2,
    },
    {
      name: "Deniz · Örnek",
      service: "Manikür & Pedikür",
      date: "1 Ekim 2026",
      time: "15:00 – 16:00",
      status: "bekliyor",
      day: 1,
      customer: 0,
    },
  ];
  const history = [
    {
      date: "2 Eylül 2026",
      service: "Epilasyon",
      note: "3. seans tamamlandı. Sonraki seans için salonla birlikte tarih belirleyebilirsiniz.",
    },
    {
      date: "5 Ağustos 2026",
      service: "Epilasyon",
      note: "2. seans tamamlandı.",
    },
    {
      date: "8 Temmuz 2026",
      service: "Epilasyon",
      note: "1. seans tamamlandı.",
    },
  ];
  const statusLabels = {
    onaylandi: "Onaylandı",
    bekliyor: "Salon onayı bekleniyor",
  };
  let role = location.hash === "#admin" ? "admin" : "member",
    section = "overview";
  function button(text, handler, cls = "small-button") {
    const b = el("button", text, cls);
    b.type = "button";
    b.onclick = handler;
    return b;
  }
  function heading(text) {
    return el("h2", text);
  }
  function empty(container, text) {
    container.append(el("p", text, "empty-state"));
  }
  function stat(label, count) {
    const n = el("div");
    n.append(el("span", label), el("strong", count));
    return n;
  }
  function notice() {
    return el(
      "p",
      "Bu önizleme salt okunurdur. Hesap, randevu ve seans işlemleri gerçek panelde giriş yapıldıktan sonra kullanılacak.",
      "preview-help",
    );
  }
  function packageCard(c) {
    const card = el("article", null, "member-package");
    card.append(
      el("p", "BAKIM PAKETİ", "eyebrow"),
      el("h3", c.pack),
      el("p", `${c.total - c.done} seans kaldı`, "package-count"),
      el("p", `${c.done} / ${c.total} seans tamamlandı`, "muted"),
    );
    const progress = el("progress");
    progress.max = c.total;
    progress.value = c.done;
    progress.setAttribute("aria-label", c.pack + " tamamlanma durumu");
    card.append(progress);
    return card;
  }
  function appointmentCard(a, admin = false) {
    const c = el(
      "article",
      null,
      admin ? "appointment-card" : "member-appointment",
    );
    c.append(el("div", a.time, "agenda-time"));
    const top = el("div", null, "appointment-top");
    top.append(
      el("h3", admin ? a.name : a.service),
      el("span", statusLabels[a.status], "status status-" + a.status),
    );
    c.append(
      top,
      el("p", admin ? a.service : a.date),
      el("p", admin ? a.date : "Türkiye saati", "muted"),
    );
    if (admin)
      c.append(button("Müşteri dosyası", () => openCustomer(a.customer)));
    return c;
  }
  function openCustomer(index) {
    const c = customers[index];
    $("preview-detail-name").textContent = c.name;
    $("preview-detail").replaceChildren(
      el("p", c.username + " · " + c.status, "muted"),
      packageCard(c),
      el("h3", "İşlem özeti"),
      el("p", `${c.done} tamamlanan seans · ${c.total - c.done} kalan seans`),
      notice(),
    );
    $("preview-dialog").showModal();
  }
  function historyList() {
    const list = el("div");
    history.forEach((h) => {
      const c = el("article", null, "history-entry");
      c.append(
        el("p", h.date, "eyebrow"),
        el("h3", h.service),
        el("p", h.note),
      );
      list.append(c);
    });
    return list;
  }
  function selector(label, options, onChange) {
    const wrap = el("label", label),
      s = el("select");
    options.forEach(([value, text]) => s.add(new Option(text, value)));
    s.onchange = () => onChange(s.value);
    wrap.append(s);
    return wrap;
  }
  function render() {
    const admin = role === "admin";
    document.querySelectorAll("[data-role]").forEach((b) => {
      b.classList.toggle("selected", b.dataset.role === role);
      b.setAttribute("aria-pressed", String(b.dataset.role === role));
    });
    $("preview-role-label").textContent = admin
      ? "SALON YÖNETİMİ"
      : "MÜŞTERİ ALANI";
    $("preview-person").textContent = admin
      ? "Gahire · Yönetici"
      : "Deniz · Örnek hesap";
    $("preview-avatar").textContent = admin ? "G" : "D";
    $("preview-person-note").textContent = admin
      ? "Salonunuzun günlük akışı"
      : "Bakım yolculuğunuz";
    $("preview-kicker").textContent = admin
      ? "GAHİRE / SALON YÖNETİMİ"
      : "SİZE ÖZEL";
    $("preview-title").replaceChildren(
      el("span", admin ? "Bugüne " : "Merhaba, "),
      el("em", admin ? "bir bakış." : "Deniz."),
    );
    $("preview-subtitle").textContent = admin
      ? "Randevuları, müşterileri ve seansları tek yerden takip edin."
      : "Randevularınız ve bakım planınız bir arada.";
    $("preview-stats").replaceChildren(
      ...(admin
        ? [
            stat("Bugünkü randevular", 3),
            stat("Onay bekleyen", 2),
            stat("Aktif müşteri", 3),
          ]
        : [
            stat("Yaklaşan randevu", 2),
            stat("Kalan paket seansı", 5),
            stat("Tamamlanan işlem", 3),
          ]),
    );
    const tabs = admin
      ? [
          ["overview", "Günlük ajanda"],
          ["members", "Müşteriler & seanslar"],
        ]
      : [
          ["overview", "Genel bakış"],
          ["appointments", "Randevularım"],
          ["history", "İşlem geçmişim"],
          ["account", "Hesabım"],
        ];
    $("preview-nav").replaceChildren(
      ...tabs.map(([key, title]) => {
        const b = button(
          title,
          () => {
            section = key;
            render();
          },
          section === key ? "selected" : "",
        );
        b.setAttribute("aria-pressed", String(section === key));
        return b;
      }),
    );
    const view = $("preview-view");
    view.replaceChildren();
    if (admin && section === "overview") {
      view.append(heading("Günlük ajanda"));
      const filters = el("div", null, "filters"),
        list = el("div");
      let day = "0",
        status = "";
      const draw = () => {
        list.replaceChildren();
        const rows = appointments.filter(
          (a) =>
            (day === "" || a.day === Number(day)) &&
            (!status || a.status === status),
        );
        rows.forEach((a) => list.append(appointmentCard(a, true)));
        if (!rows.length) empty(list, "Bu filtreye uygun örnek randevu yok.");
      };
      filters.append(
        selector(
          "Tarih",
          [
            ["0", "30 Eylül · Bugün"],
            ["1", "1 Ekim · Yarın"],
            ["", "Tüm tarihler"],
          ],
          (v) => {
            day = v;
            draw();
          },
        ),
        selector(
          "Durum",
          [
            ["", "Tüm durumlar"],
            ["bekliyor", "Onay bekleyen"],
            ["onaylandi", "Onaylanan"],
          ],
          (v) => {
            status = v;
            draw();
          },
        ),
      );
      view.append(filters, list, notice());
      draw();
    } else if (admin) {
      view.append(heading("Müşteriler & seanslar"));
      const filters = el("div", null, "filters"),
        label = el("label", "Müşteri ara"),
        search = el("input"),
        list = el("div");
      search.type = "search";
      search.placeholder = "Ad veya kullanıcı adı";
      label.append(search);
      let status = "";
      const draw = () => {
        const q = search.value.toLocaleLowerCase("tr").trim();
        list.replaceChildren();
        const rows = customers
          .map((c, i) => ({ c, i }))
          .filter(
            ({ c }) =>
              (!status || c.status === status) &&
              (c.name + " " + c.username).toLocaleLowerCase("tr").includes(q),
          );
        rows.forEach(({ c, i }) => {
          const row = el("div", null, "customer-list-row"),
            info = el("div");
          info.append(el("strong", c.name), el("p", c.username, "muted"));
          row.append(
            info,
            el("span", c.status, "status"),
            button("Dosyayı aç", () => openCustomer(i)),
          );
          list.append(row);
        });
        if (!rows.length) empty(list, "Bu aramaya uygun örnek müşteri yok.");
      };
      search.oninput = draw;
      filters.append(
        label,
        selector(
          "Hesap durumu",
          [
            ["", "Tüm hesaplar"],
            ["Aktif", "Aktif"],
            ["İlk giriş bekleniyor", "İlk giriş bekleniyor"],
            ["Kapalı", "Kapalı"],
          ],
          (v) => {
            status = v;
            draw();
          },
        ),
      );
      view.append(filters, list, notice());
      draw();
    } else if (section === "overview") {
      view.append(
        heading("Bir sonraki randevunuz."),
        appointmentCard(appointments[0]),
        heading("Bakım paketleriniz."),
      );
      const grid = el("div", null, "member-package-grid");
      grid.append(packageCard(customers[0]));
      view.append(
        grid,
        el(
          "p",
          "Salonun önerdiği sonraki seans: 30 Eylül 2026",
          "preview-help",
        ),
      );
    } else if (section === "appointments") {
      view.append(heading("Randevularım"));
      const filters = el("div", null, "filters"),
        list = el("div");
      const draw = (status) => {
        list.replaceChildren();
        appointments
          .filter((a) => a.customer === 0 && (!status || a.status === status))
          .forEach((a) => list.append(appointmentCard(a)));
        if (!list.children.length)
          empty(list, "Bu seçime uygun örnek randevu yok.");
      };
      filters.append(
        selector(
          "Randevu durumu",
          [
            ["", "Tüm randevular"],
            ["bekliyor", "Onay bekleyenler"],
            ["onaylandi", "Onaylananlar"],
            ["iptal", "İptal edilenler"],
          ],
          draw,
        ),
      );
      view.append(
        filters,
        list,
        el(
          "p",
          "İptal veya değişiklik için salonla iletişime geçebilirsiniz.",
          "muted",
        ),
      );
      draw("");
    } else if (section === "history") {
      view.append(heading("İşlem geçmişim"), historyList());
    } else {
      view.append(heading("Hesabım"));
      const dl = el("dl", null, "account-details");
      [
        ["Ad soyad", "Deniz · Örnek hesap"],
        ["Kullanıcı adı", "deniz.ornek"],
        ["Telefon", "Önizlemede gösterilmez"],
        ["Hesap durumu", "Aktif"],
      ].forEach(([k, v]) => dl.append(el("dt", k), el("dd", v)));
      view.append(dl, notice());
    }
  }
  document.querySelectorAll("[data-role]").forEach(
    (b) =>
      (b.onclick = () => {
        role = b.dataset.role;
        section = "overview";
        historyHash();
        render();
      }),
  );
  function historyHash() {
    window.history.replaceState(
      null,
      "",
      role === "admin" ? "#admin" : "#member",
    );
  }
  $("preview-close").onclick = $("preview-close-bottom").onclick = () =>
    $("preview-dialog").close();
  render();
})();
