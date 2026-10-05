import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url),
  tick = () => new Promise((r) => setTimeout(r, 30));
let count = 0;
async function page(file = "index.html") {
  const dom = new JSDOM(await readFile(new URL(file, root), "utf8"), {
    url: "https://gahire.example/" + file,
    runScripts: "outside-only",
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  return dom;
}
async function script(d, f) {
  d.window.eval(await readFile(new URL(f, root), "utf8"));
}
async function test(name, fn) {
  await fn();
  count++;
  console.log("PASS", name);
}
const member = {
  user_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  username: "ayse",
  full_name: "Ayşe <img src=x onerror=alert(1)>",
  phone: "905551111111",
  active: true,
  must_change_password: false,
};
const services = [
  {
    id: "cilt",
    name: "Cilt Bakımı",
    duration_minutes: 60,
    active: true,
    price: 500,
    sort_order: 1,
  },
];
const pack = {
  id: "33333333-3333-4333-8333-333333333333",
  customer_id: member.user_id,
  label: "Cilt bakım paketi",
  service_id: "cilt",
  total_sessions: 8,
  completed_sessions: 3,
  remaining_sessions: 5,
  active: true,
};
const queryCalls = [];
function client(profile) {
  let listener;
  const session = { user: { id: member.user_id }, access_token: "test" };
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: (fn) => {
        listener = fn;
        setTimeout(() => fn("INITIAL_SESSION", session), 0);
      },
      signOut: async () => {
        listener?.("SIGNED_OUT", null);
      },
      setSession: async () => ({}),
    },
    from(table) {
      let single = false,
        head = false;
      const q = {
        select: (_cols, opts) => {
          head = opts?.head;
          return q;
        },
        eq: (...args) => {
          queryCalls.push([table, "eq", ...args]);
          return q;
        },
        in: (...args) => {
          queryCalls.push([table, "in", ...args]);
          return q;
        },
        gte: (...args) => {
          queryCalls.push([table, "gte", ...args]);
          return q;
        },
        order: () => q,
        limit: () => q,
        range: () => q,
        maybeSingle: () => {
          single = true;
          return q;
        },
        single: () => {
          single = true;
          return q;
        },
        then(resolve, reject) {
          let data,
            count = 0;
          if (table === "gh_admins") data = single ? null : [];
          if (table === "gh_members") data = profile;
          if (table === "gh_package_progress") data = [pack];
          if (table === "gh_services") data = services;
          if (table === "gh_settings")
            data = { booking_enabled: true, horizon_days: 60 };
          if (table === "gh_appointments") {
            data = [];
            count = 0;
          }
          if (table === "gh_sessions") {
            data = head
              ? null
              : [
                  {
                    id: "log",
                    service_name: "Cilt Bakımı",
                    service_id: "cilt",
                    performed_at: "2026-09-01T10:00:00Z",
                    note: "<img src=x onerror=alert(1)>",
                    voided: false,
                  },
                ];
            count = 3;
          }
          return Promise.resolve({ data, count, error: null }).then(
            resolve,
            reject,
          );
        },
      };
      return q;
    },
  };
}
async function configured(file = "index.html", profile = { ...member }) {
  const d = await page(file);
  await script(d, "config.js");
  await script(d, "content.js");
  d.window.GAHIRE_BACKEND = {
    url: "https://example.supabase.co",
    publishableKey: "public",
    turnstileSiteKey: "site",
    functionName: "booking-api",
  };
  d.window.supabase = { createClient: () => client(profile) };
  await script(d, "backend.js");
  return d;
}
const unconfigured = await page();
for (const f of ["config.js", "content.js", "backend.js", "portal.js"])
  await script(unconfigured, f);
await test("Unconfigured login is explicit and disabled", () => {
  const d = unconfigured.window.document;
  assert(d.querySelector("#member-login-submit").disabled);
  assert(d.querySelector("#member-dashboard").hidden);
  assert(
    d
      .querySelector("#member-login-message")
      .textContent.includes("henüz tamamlanmadı"),
  );
});
await test("No self-signup form or fake customer data on landing", () => {
  const d = unconfigured.window.document;
  assert.equal(d.querySelectorAll("form").length, 2);
  assert.equal(d.querySelector("#member-packages").children.length, 0);
  assert(!d.querySelector("a[href*=signup]"));
});
await test("Password visibility toggle is accessible", () => {
  const d = unconfigured.window.document;
  d.querySelector("#show-password").click();
  assert.equal(d.querySelector("#member-password").type, "text");
  assert.equal(
    d.querySelector("#show-password").getAttribute("aria-pressed"),
    "true",
  );
});
unconfigured.window.close();
const logged = await configured();
await script(logged, "portal.js");
await tick();
const d = logged.window.document;
await test("Authenticated dashboard displays package counts", () => {
  assert(!d.querySelector("#member-dashboard").hidden);
  assert.equal(d.querySelector("#member-remaining-count").textContent, "5");
  assert.equal(d.querySelector("#member-completed-count").textContent, "3");
});
await test("Package button carries selected service and package", () => {
  const link = d.querySelector("#member-packages a");
  assert(link.href.includes("service=cilt"));
  assert(link.href.includes("package=" + pack.id));
});
await test("Customer supplied text never becomes executable HTML", async () => {
  d.querySelector('[data-member-tab="history"]').click();
  await tick();
  assert(d.querySelector("#member-history-list").textContent.includes("<img"));
  assert.equal(d.querySelectorAll("img").length, 0);
});
await test("Treatment history links back to the matching service booking", () => {
  assert(
    d.querySelector("#member-history-list a").href.includes("service=cilt"),
  );
});
await test("Live portal appointment filter applies status and upcoming constraints", async () => {
  const filter = d.querySelector("#member-appointment-filter");
  queryCalls.length = 0;
  filter.value = "bekliyor";
  filter.dispatchEvent(new logged.window.Event("change"));
  await tick();
  assert(
    queryCalls.some(
      (c) =>
        c[0] === "gh_appointments" &&
        c[1] === "eq" &&
        c[2] === "status" &&
        c[3] === "bekliyor",
    ),
  );
  queryCalls.length = 0;
  filter.value = "upcoming";
  filter.dispatchEvent(new logged.window.Event("change"));
  await tick();
  assert(
    queryCalls.some(
      (c) => c[0] === "gh_appointments" && c[1] === "in" && c[2] === "status",
    ),
  );
  assert(
    queryCalls.some(
      (c) => c[0] === "gh_appointments" && c[1] === "gte" && c[2] === "ends_at",
    ),
  );
});
logged.window.close();
const temporary = await configured("index.html", {
  ...member,
  must_change_password: true,
});
await script(temporary, "portal.js");
await tick();
await test("First login requires password change and hides dashboard", () => {
  assert(!temporary.window.document.querySelector("#password-panel").hidden);
  assert(temporary.window.document.querySelector("#member-dashboard").hidden);
  assert(temporary.window.document.querySelector("#password-back").hidden);
});
temporary.window.close();
const invalid = await configured("index.html", null);
await script(invalid, "portal.js");
await tick();
await test("Missing or revoked member profile cannot reveal dashboard", () => {
  assert(!invalid.window.document.querySelector("#member-login").hidden);
  assert(invalid.window.document.querySelector("#member-dashboard").hidden);
});
invalid.window.close();
const salon = await configured("salon.html");
await script(salon, "app.js");
salon.window.GahireMember = Promise.resolve({ ...member });
salon.window.GahireAPI.edge = async (b) =>
  b.action === "slots"
    ? [
        {
          starts_at: "2026-12-01T07:00:00Z",
          ends_at: "2026-12-01T08:00:00Z",
          available: true,
        },
        {
          starts_at: "2026-12-01T08:00:00Z",
          ends_at: "2026-12-01T09:00:00Z",
          available: false,
        },
      ]
    : {
        id: b.id,
        service_name: "Cilt Bakımı",
        starts_at: b.start,
        status: "bekliyor",
      };
await script(salon, "booking.js");
await tick();
const sd = salon.window.document;
await test("Booking identity is populated from signed-in customer", () => {
  assert(sd.querySelector("#customer-name").readOnly);
  assert.equal(sd.querySelector("#customer-phone").value, member.phone);
});
sd.querySelector("#booking-service").value = "cilt";
sd.querySelector("#booking-date").value = "2026-12-01";
sd.querySelector("#booking-service").dispatchEvent(
  new salon.window.Event("change"),
);
await tick();
await test("Member booking still blocks unavailable times", () => {
  assert.equal(sd.querySelectorAll("#time-slots button").length, 2);
  assert(sd.querySelectorAll("#time-slots button")[1].disabled);
});
sd.querySelector("#time-slots button").click();
sd.querySelector("#booking-next").click();
sd.querySelector("#booking-next").click();
sd.querySelector("#booking-consent").checked = true;
sd.querySelector("#booking-form").dispatchEvent(
  new salon.window.Event("submit", { cancelable: true }),
);
await tick();
await test("Member appointment succeeds only after server receipt", () => {
  assert(!sd.querySelector("#booking-success").hidden);
  assert(
    sd
      .querySelector("#booking-success-text")
      .textContent.includes("Salon onayı bekliyor"),
  );
});
await test("All salon in-page anchors are valid", () =>
  sd
    .querySelectorAll('a[href^="#"]')
    .forEach((a) => assert(sd.getElementById(a.hash.slice(1)), a.hash)));
salon.window.close();
const admin = await page("admin.html");
for (const f of ["config.js", "backend.js", "admin.js", "admin-members.js"])
  await script(admin, f);
await test("Staff customer management remains inside locked admin panel", () => {
  const ad = admin.window.document;
  assert(ad.querySelector("#admin-panel").hidden);
  assert(
    ad
      .querySelector("#admin-panel")
      .contains(ad.querySelector("#members-view")),
  );
  assert(ad.querySelector("#login-submit").disabled);
});
admin.window.close();
const preview = await page("preview.html");
await script(preview, "preview.js");
const pd = preview.window.document;
await test("Preview customer filters display matching rows and empty state", () => {
  [...pd.querySelectorAll("#preview-nav button")]
    .find((b) => b.textContent === "Randevularım")
    .click();
  const select = pd.querySelector("#preview-view select");
  select.value = "bekliyor";
  select.dispatchEvent(new preview.window.Event("change"));
  assert.equal(pd.querySelectorAll(".member-appointment").length, 1);
  assert(
    pd.querySelector(".member-appointment").textContent.includes("Manikür"),
  );
  select.value = "iptal";
  select.dispatchEvent(new preview.window.Event("change"));
  assert.equal(pd.querySelectorAll(".member-appointment").length, 0);
  assert(pd.querySelector(".empty-state"));
});
await test("Preview staff agenda filters dates independently of status", () => {
  pd.querySelector('[data-role="admin"]').click();
  assert.equal(pd.querySelectorAll(".appointment-card").length, 3);
  const [day, status] = pd.querySelectorAll("#preview-view select");
  day.value = "1";
  day.dispatchEvent(new preview.window.Event("change"));
  assert.equal(pd.querySelectorAll(".appointment-card").length, 1);
  status.value = "onaylandi";
  status.dispatchEvent(new preview.window.Event("change"));
  assert.equal(pd.querySelectorAll(".appointment-card").length, 0);
});
await test("Preview customer search opens the correct read-only file", () => {
  [...pd.querySelectorAll("#preview-nav button")]
    .find((b) => b.textContent === "Müşteriler & seanslar")
    .click();
  const input = pd.querySelector("#preview-view input");
  input.value = "Selin";
  input.dispatchEvent(new preview.window.Event("input"));
  assert.equal(pd.querySelectorAll(".customer-list-row").length, 1);
  pd.querySelector(".customer-list-row button").click();
  assert(pd.querySelector("#preview-dialog").open);
  assert.equal(
    pd.querySelector("#preview-detail-name").textContent,
    "Selin · Örnek",
  );
  assert(
    pd.querySelector("#preview-detail").textContent.includes("2 seans kaldı"),
  );
  pd.querySelector("#preview-close").click();
  assert(!pd.querySelector("#preview-dialog").open);
});
await test("Preview cannot invoke production authentication or writes", () => {
  assert.equal(preview.window.GahireAPI, undefined);
  assert.equal(pd.querySelectorAll("form").length, 0);
  assert(
    pd.querySelector(".preview-notice").textContent.includes("kurgusaldır"),
  );
  assert.equal(pd.querySelectorAll("script[src]").length, 1);
});
preview.window.close();
console.log(
  `${count} portal UI checks passed in jsdom (not a visual browser test).`,
);
