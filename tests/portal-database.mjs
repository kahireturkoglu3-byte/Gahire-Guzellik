import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
process.on("uncaughtException", (e) => {
  console.error(e.message, e.where || "", e.query || "");
  process.exit(1);
});
const db = new PGlite();
let count = 0;
const test = async (name, fn) => {
  await fn();
  count++;
  console.log("PASS", name);
};
const fails = (fn, re) => assert.rejects(fn, re);
await db.exec(
  `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant usage on schema auth,public to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;`,
);
await db.exec(
  await readFile(new URL("../supabase/setup.sql", import.meta.url), "utf8"),
);
await db.exec(
  await readFile(
    new URL("../supabase/portal-upgrade.sql", import.meta.url),
    "utf8",
  ),
);
const admin = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  a = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  b = "cccccccc-cccc-4ccc-cccc-cccccccccccc",
  sa = "11111111-1111-4111-8111-111111111111",
  sb = "22222222-2222-4222-8222-222222222222",
  pack = "33333333-3333-4333-8333-333333333333";
await db.query("insert into auth.users values($1),($2),($3)", [admin, a, b]);
await db.query("insert into gh_admins values($1)", [admin]);
await db.query(
  "insert into gh_members(user_id,username,full_name,phone,current_session_id,must_change_password) values($1,'ayse','Ayşe','905551111111',$3,false),($2,'zeynep','Zeynep','905552222222',$4,false)",
  [a, b, sa, sb],
);
await db.query(
  "insert into gh_packages(id,customer_id,service_id,label,total_sessions,created_by) values($1,$2,'epilasyon','Epilasyon 2 seans',2,$3)",
  [pack, a, admin],
);
await db.exec(
  "update gh_settings set booking_enabled=true;update gh_hours set closed=false",
);
const day = (
  await db.query(
    "select ((now() at time zone 'Europe/Istanbul')::date+2)::text as day",
  )
).rows[0].day;
async function role(name, user = "", sid = "") {
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [user, JSON.stringify({ session_id: sid })],
  );
  await db.exec("set role " + name);
}
const id = "44444444-4444-4444-8444-444444444444";
async function book(user, session, key, start, packageId = pack) {
  return db.query("select gh_book_member($1,$2,$3,$4,$5,$6,$7) as receipt", [
    user,
    session,
    key,
    "epilasyon",
    `${day}T${start}:00+03:00`,
    packageId,
    "",
  ]);
}
await role("authenticated", a, sa);
await test("Member sees own profile and own package only", async () => {
  assert.equal((await db.query("select * from gh_members")).rows.length, 1);
  assert.equal(
    (await db.query("select * from gh_package_progress")).rows.length,
    1,
  );
});
await test("Member cannot edit session counts or profile flags", async () => {
  await fails(
    () => db.exec("update gh_members set must_change_password=false"),
    /permission denied/,
  );
  await fails(
    () => db.exec("update gh_packages set total_sessions=100"),
    /permission denied/,
  );
});
await role("authenticated", b, sb);
await test("Other member cannot read package by guessed id", async () =>
  assert.equal(
    (await db.query("select * from gh_package_progress where id=$1", [pack]))
      .rows.length,
    0,
  ));
await role("service_role");
await test("Booking belongs to verified member and server profile", async () => {
  await book(a, sa, id, "10:00");
  const r = (await db.query("select * from gh_appointments where id=$1", [id]))
    .rows[0];
  assert.equal(r.customer_id, a);
  assert.equal(r.customer_name, "Ayşe");
});
await test("Member cannot attach another customer package", () =>
  fails(
    () => book(b, sb, "55555555-5555-4555-8555-555555555555", "11:00"),
    /GH_PACKAGE/,
  ));
await test("Invalidated session cannot book", () =>
  fails(
    () => book(a, sb, "55555555-5555-4555-8555-555555555555", "11:00"),
    /GH_MEMBER/,
  ));
await test("Retries do not create duplicate member booking", async () => {
  await book(a, sa, id, "10:00");
  assert.equal(
    (await db.query("select count(*)::int as n from gh_appointments")).rows[0]
      .n,
    1,
  );
});
await role("authenticated", b, sb);
await test("Other member cannot read appointment", async () =>
  assert.equal(
    (await db.query("select * from gh_appointments where id=$1", [id])).rows
      .length,
    0,
  ));
await role("authenticated", a, sa);
await test("Owner reads own appointment", async () =>
  assert.equal(
    (await db.query("select * from gh_appointments where id=$1", [id])).rows
      .length,
    1,
  ));
await role("service_role");
await db.query(
  "update gh_members set must_change_password=true where user_id=$1",
  [a],
);
await role("authenticated", a, sa);
await test("Temporary-password session cannot read private service data", async () => {
  assert.equal((await db.query("select * from gh_members")).rows.length, 1);
  assert.equal(
    (await db.query("select * from gh_appointments")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from gh_package_progress")).rows.length,
    0,
  );
});
await role("service_role");
await db.query(
  "update gh_members set must_change_password=false where user_id=$1",
  [a],
);
await test("Reserved sessions prevent package overbooking", async () => {
  await book(a, sa, "66666666-6666-4666-8666-666666666666", "11:00");
  await fails(
    () => book(a, sa, "77777777-7777-4777-8777-777777777777", "12:00"),
    /GH_NO_SESSIONS/,
  );
});
await db.query("update gh_appointments set status='iptal' where id=$1", [
  "66666666-6666-4666-8666-666666666666",
]);
await test("Cancellation releases reserved session", async () => {
  await book(a, sa, "88888888-8888-4888-8888-888888888888", "12:00");
});
await db.query("update gh_appointments set status='iptal' where id=$1", [
  "88888888-8888-4888-8888-888888888888",
]);
await db.query("update gh_appointments set status='onaylandi' where id=$1", [
  id,
]);
await db.query(
  "update gh_appointments set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
  [id],
);
await role("authenticated", admin);
await test("Admin cannot mark member appointment complete without log", () =>
  fails(
    () =>
      db.query("update gh_appointments set status='tamamlandi' where id=$1", [
        id,
      ]),
    /GH_USE_SESSION/,
  ));
await role("service_role");
const log = "99999999-9999-4999-8999-999999999999";
async function record(actor = admin) {
  return db.query(
    "select gh_record_session($1,$2,$3,'epilasyon',$4,$5,now()-interval '1 hour','Test işlem',null)",
    [actor, log, a, pack, id],
  );
}
await test("Non-admin cannot record treatment even through privileged RPC parameters", () =>
  fails(() => record(b), /GH_AUTH/));
await test("Complete appointment and decrement package in one transaction", async () => {
  await record();
  const progress = (
    await db.query("select * from gh_package_progress where id=$1", [pack])
  ).rows[0];
  assert.equal(progress.completed_sessions, 1);
  assert.equal(progress.remaining_sessions, 1);
  assert.equal(
    (await db.query("select status from gh_appointments where id=$1", [id]))
      .rows[0].status,
    "tamamlandi",
  );
});
await test("Repeated completion does not double deduct", async () => {
  await record();
  assert.equal(
    (await db.query("select * from gh_package_progress where id=$1", [pack]))
      .rows[0].completed_sessions,
    1,
  );
});
await role("authenticated", b, sb);
await test("History and progress view do not leak other member data", async () => {
  assert.equal((await db.query("select * from gh_sessions")).rows.length, 0);
  assert.equal(
    (await db.query("select * from gh_package_progress")).rows.length,
    0,
  );
});
await role("authenticated", a, sa);
await test("Member reads completed treatment history", async () =>
  assert.equal((await db.query("select * from gh_sessions")).rows.length, 1));
await role("service_role");
await test("Voiding erroneous record restores session without deleting audit row", async () => {
  await db.query("select gh_void_session($1,$2,$3)", [
    admin,
    log,
    "Yanlış işlem seçildi",
  ]);
  assert.equal(
    (await db.query("select * from gh_package_progress where id=$1", [pack]))
      .rows[0].remaining_sessions,
    2,
  );
  assert.equal(
    (await db.query("select * from gh_sessions where id=$1", [log])).rows[0]
      .voided,
    true,
  );
});
await db.query(
  "update gh_members set active=false,current_session_id=null where user_id=$1",
  [a],
);
await role("authenticated", a, sa);
await test("Deactivation immediately blocks existing JWT data access", async () => {
  assert.equal((await db.query("select * from gh_members")).rows.length, 0);
  assert.equal(
    (await db.query("select * from gh_appointments")).rows.length,
    0,
  );
  assert.equal((await db.query("select * from gh_sessions")).rows.length, 0);
});
await role("service_role");
await db.query(
  "update gh_members set active=true,current_session_id=$2 where user_id=$1",
  [a, sb],
);
await role("authenticated", a, sa);
await test("Old session stays blocked after a new login", async () =>
  assert.equal(
    (await db.query("select * from gh_package_progress")).rows.length,
    0,
  ));
await role("anon");
await test("Unauthenticated callers cannot access member table or privileged functions", async () => {
  await fails(() => db.query("select * from gh_members"), /permission denied/);
  await fails(
    () => db.query("select * from gh_package_progress"),
    /permission denied/,
  );
  await fails(() => book(a, sa, id, "10:00"), /permission denied/);
});
await role("authenticated", admin);
await test("Admin can see both customer profiles", async () =>
  assert.equal((await db.query("select * from gh_members")).rows.length, 2));
console.log(`${count} member database security and session checks passed.`);
await db.close();
