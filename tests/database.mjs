process.on("uncaughtException", (e) => {
  console.error(e.message, e.where || "", e.query || "");
  process.exit(1);
});
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
let passed = 0;
async function ok(name, fn) {
  await fn();
  console.log("PASS", name);
  passed++;
}
async function fails(fn, pattern) {
  await assert.rejects(fn, pattern);
}
await db.exec(
  `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth,public to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`,
);
await db.exec(
  await readFile(new URL("../supabase/setup.sql", import.meta.url), "utf8"),
);
const admin = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  stranger = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
await db.query("insert into auth.users values ($1),($2)", [admin, stranger]);
await db.query("insert into gh_admins values ($1)", [admin]);
await db.exec(
  "update gh_settings set booking_enabled=true; update gh_hours set closed=false;",
);
const day = (
  await db.query(
    "select ((now() at time zone 'Europe/Istanbul')::date+2)::text as day",
  )
).rows[0].day;
const start = `${day}T10:00:00+03:00`,
  mid = `${day}T10:30:00+03:00`,
  next = `${day}T11:00:00+03:00`;
const id1 = "00000000-0000-4000-8000-000000000001",
  id2 = "00000000-0000-4000-8000-000000000002";
async function role(name, uid = "") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.exec("set role " + name);
}
async function book(id, start, phone = "905551111111", name = "Test Müşteri") {
  return (
    await db.query("select gh_book($1,$2,$3,$4,$5,$6) result", [
      id,
      "cilt",
      start,
      name,
      phone,
      "",
    ])
  ).rows[0].result;
}
await role("service_role");
await ok("Open slots and server duration", async () => {
  let r = await db.query("select * from gh_slots($1,$2)", ["cilt", day]);
  assert.equal(r.rows.length, 33);
  assert(r.rows.every((x) => x.available));
  assert.equal(
    new Date(r.rows[0].ends_at) - new Date(r.rows[0].starts_at),
    3600000,
  );
});
await ok("Booking returns pending receipt", async () => {
  const r = await book(id1, start);
  assert.equal(r.id, id1);
  assert.equal(r.status, "bekliyor");
});
await ok("Idempotent retry does not duplicate", async () => {
  await book(id1, start);
  assert.equal(
    (await db.query("select count(*)::int n from gh_appointments")).rows[0].n,
    1,
  );
});
await ok("Different payload cannot reuse request id", () =>
  fails(() => book(id1, start, "905559999999"), /GH_RETRY/),
);
await ok("Overlapping appointment blocked", () =>
  fails(() => book(id2, mid, "905552222222"), /GH_SLOT/),
);
await ok("Availability hides occupied duration", async () => {
  const r = await db.query("select * from gh_slots($1,$2)", ["cilt", day]);
  assert.equal(r.rows[0].available, false);
  assert.equal(r.rows[1].available, false);
  assert.equal(r.rows[4].available, true);
  assert.deepEqual(Object.keys(r.rows[0]), [
    "starts_at",
    "ends_at",
    "available",
  ]);
});
await ok("Adjacent appointment allowed", async () => {
  await book(id2, next, "905552222222");
});
await ok("Past time rejected", () =>
  fails(
    () =>
      book("00000000-0000-4000-8000-000000000003", "2020-01-01T10:00:00+03:00"),
    /GH_SLOT/,
  ),
);
await ok("Invalid phone rejected", () =>
  fails(
    () =>
      book(
        "00000000-0000-4000-8000-000000000003",
        `${day}T13:00:00+03:00`,
        "123",
      ),
    /GH_INPUT/,
  ),
);
await ok("Off-grid time rejected", () =>
  fails(
    () => book("00000000-0000-4000-8000-000000000003", `${day}T13:07:00+03:00`),
    /GH_SLOT/,
  ),
);
await ok("Null name rejected", () =>
  fails(
    () =>
      book(
        "00000000-0000-4000-8000-000000000003",
        `${day}T13:00:00+03:00`,
        "905551111111",
        null,
      ),
    /GH_INPUT/,
  ),
);
await role("anon");
await ok("Anon cannot read private appointment data", () =>
  fails(() => db.query("select * from gh_appointments"), /permission denied/),
);
await ok("Anon cannot call privileged booking", () =>
  fails(() => book(id1, start), /permission denied/),
);
await ok("Anon cannot directly insert or change settings", async () => {
  await fails(
    () => db.query("update gh_settings set booking_enabled=false"),
    /permission denied/,
  );
  await fails(
    () => db.query("insert into gh_appointments(id) values(gen_random_uuid())"),
    /permission denied/,
  );
});
await role("authenticated", stranger);
await ok("Non-admin sees no appointments or admin membership", async () => {
  assert.equal(
    (await db.query("select * from gh_appointments")).rows.length,
    0,
  );
  assert.equal((await db.query("select * from gh_admins")).rows.length, 0);
});
await ok("Non-admin cannot self-promote", () =>
  fails(
    () => db.query("insert into gh_admins values($1)", [stranger]),
    /permission denied/,
  ),
);
await ok("Non-admin update affects zero rows", async () => {
  const r = await db.query(
    "update gh_appointments set status='iptal' returning id",
  );
  assert.equal(r.rows.length, 0);
});
await role("authenticated", admin);
await ok("Admin reads appointments", async () =>
  assert.equal(
    (await db.query("select * from gh_appointments")).rows.length,
    2,
  ),
);
await ok("Admin cannot modify customer data", () =>
  fails(
    () => db.query("update gh_appointments set phone='905559999999'"),
    /permission denied/,
  ),
);
await ok("Admin confirms pending appointment", async () => {
  await db.query("update gh_appointments set status='onaylandi' where id=$1", [
    id1,
  ]);
});
await ok("Completion before appointment ends is blocked", () =>
  fails(
    () =>
      db.query("update gh_appointments set status='tamamlandi' where id=$1", [
        id1,
      ]),
    /GH_FUTURE/,
  ),
);
await ok("Active appointment blocks full-day closure", () =>
  fails(
    () => db.query("insert into gh_closures(day) values($1)", [day]),
    /GH_HAS_BOOKINGS/,
  ),
);
await ok("Cancel opens slot", async () => {
  await db.query("update gh_appointments set status='iptal' where id=$1", [
    id1,
  ]);
  await role("service_role");
  const r = await db.query("select * from gh_slots($1,$2)", ["cilt", day]);
  assert.equal(r.rows[0].available, true);
});
await role("authenticated", admin);
await ok("Terminal state cannot be reopened", () =>
  fails(
    () =>
      db.query("update gh_appointments set status='bekliyor' where id=$1", [
        id1,
      ]),
    /GH_STATE/,
  ),
);
await ok("Cancel all then close day", async () => {
  await db.query("update gh_appointments set status='iptal' where id=$1", [
    id2,
  ]);
  await db.query("insert into gh_closures(day) values($1)", [day]);
  await role("service_role");
  assert.equal(
    (await db.query("select * from gh_slots($1,$2)", ["cilt", day])).rows
      .length,
    0,
  );
});
await role("authenticated", admin);
await db.query("delete from gh_closures where day=$1", [day]);
await db.exec("update gh_settings set booking_enabled=false");
await role("service_role");
await ok("Booking disabled enforced by database", () =>
  fails(() => book("00000000-0000-4000-8000-000000000003", start), /GH_CLOSED/),
);
await role("authenticated", admin);
await db.exec("update gh_settings set booking_enabled=true");
await role("service_role");
await ok("Phone booking limit enforced", async () => {
  await book("00000000-0000-4000-8000-000000000010", `${day}T13:00:00+03:00`);
  await book("00000000-0000-4000-8000-000000000011", `${day}T14:00:00+03:00`);
  await fails(
    () => book("00000000-0000-4000-8000-000000000012", `${day}T15:00:00+03:00`),
    /GH_LIMIT/,
  );
});
await role("postgres");
await ok(
  "Database exclusion constraint protects concurrent conflicts independently",
  () =>
    fails(
      () =>
        db.query(
          `insert into gh_appointments(id,service_id,service_name,duration_minutes,customer_name,phone,starts_at,ends_at) values(gen_random_uuid(),'cilt','Cilt',60,'Test','905553333333',$1::timestamptz,$1::timestamptz+interval '1 hour')`,
          [`${day}T13:30:00+03:00`],
        ),
      /conflicting key|exclusion constraint/,
    ),
);
console.log(
  `\n${passed} database checks passed. Local PGlite PostgreSQL; no production data touched.`,
);
await db.close();
