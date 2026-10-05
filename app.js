const config = window.GAHIRE;
const grid = document.querySelector("#service-grid");
config.services.forEach((service, index) => {
  const card = document.createElement("article");
  card.className = "service-card";
  card.innerHTML = `<div class="card-top"><span>${String(index + 1).padStart(2, "0")}</span><span aria-hidden="true">✧</span></div><p class="eyebrow">${service.category}</p><h3>${service.name}</h3><p>${service.description}</p><details><summary>Hizmeti incele <span aria-hidden="true">+</span></summary><p>${service.detail}</p><a href="#randevu" data-book-service="${service.name}">Randevu planlayın ↗</a></details>`;
  grid.append(card);
  const row = document.createElement("div");
  row.className = "price-row";
  const title = document.createElement("span");
  title.textContent = service.name;
  const price = document.createElement("span");
  price.textContent = service.price || "Yakında";
  row.append(title, price);
  document.querySelector("#price-list").append(row);
});
Object.entries(config.media).forEach(([key, src]) => {
  if (!src) return;
  const area = document.querySelector(`[data-media="${key}"]`);
  if (!area) return;
  const img = document.createElement("img");
  img.src = src;
  img.alt =
    key === "hero" || key === "about"
      ? "Gahire Güzellik Salonu"
      : "Gahire çalışmaları";
  img.className = "content-image";
  if (key !== "hero") img.loading = "lazy";
  img.addEventListener("load", () => area.classList.add("has-image"));
  area.append(img);
});
const menu = document.querySelector(".menu-toggle");
const nav = document.querySelector("nav");
function closeMenu() {
  menu.setAttribute("aria-expanded", "false");
  menu.setAttribute("aria-label", "Menüyü aç");
  nav.classList.remove("open");
}
menu.addEventListener("click", () => {
  const isOpen = menu.getAttribute("aria-expanded") === "true";
  menu.setAttribute("aria-expanded", String(!isOpen));
  menu.setAttribute("aria-label", isOpen ? "Menüyü aç" : "Menüyü kapat");
  nav.classList.toggle("open", !isOpen);
});
nav
  .querySelectorAll("a")
  .forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});
const dialog = document.querySelector("#contact-dialog");
document.querySelectorAll("[data-contact]").forEach((button) =>
  button.addEventListener("click", () => {
    const phone = config.whatsapp.replace(/\D/g, "");
    if (phone) {
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent("Merhaba, Gahire hizmetleri ve randevu hakkında bilgi almak istiyorum.")}`,
        "_blank",
        "noopener,noreferrer",
      );
    } else {
      dialog.showModal();
    }
  }),
);
document
  .querySelectorAll(".dialog-close,.dialog-done")
  .forEach((button) => button.addEventListener("click", () => dialog.close()));
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
document.querySelector("#year").textContent = new Date().getFullYear();
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          nav
            .querySelectorAll("a")
            .forEach((a) =>
              a.classList.toggle("active", a.hash === "#" + entry.target.id),
            );
        }
      });
    },
    { rootMargin: "-15% 0px -55% 0px" },
  );
  document
    .querySelectorAll("main section[id]")
    .forEach((section) => observer.observe(section));
}
