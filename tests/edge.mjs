import assert from "node:assert/strict";
let handler;
const user = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
  sid = "11111111-1111-4111-8111-111111111111";
const token =
  "header." +
  Buffer.from(JSON.stringify({ session_id: sid })).toString("base64url") +
  ".signature";
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-only",
  ALLOWED_ORIGINS: "https://gahire.example",
  TURNSTILE_SECRET_KEY: "captcha-secret",
  TURNSTILE_HOSTNAMES: "gahire.example",
};
globalThis.Deno = {
  env: { get: (k) => env[k] },
  serve: (fn) => {
    handler = fn;
  },
};
let captchaOK = true,
  authOK = true,
  admin = false,
  active = true,
  mustChange = false,
  session = sid,
  rpcArgs = null,
  rpcName = "",
  writes = 0;
globalThis.fetch = async (url, opts = {}) => {
  if (url.includes("siteverify"))
    return Response.json({
      success: captchaOK,
      hostname: "gahire.example",
      action: "member_login",
    });
  assert.equal(opts.headers.apikey, "server-only");
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (url.endsWith("/auth/v1/user"))
    return authOK
      ? Response.json({ id: user })
      : Response.json({ message: "invalid JWT" }, { status: 401 });
  if (url.includes("/auth/v1/token?"))
    return Response.json({
      user: { id: user },
      access_token: token,
      refresh_token: "refresh",
    });
  if (url.includes("/gh_admins?"))
    return Response.json(admin ? [{ user_id: user }] : []);
  if (url.includes("/gh_members?")) {
    if (opts.method === "PATCH") {
      writes++;
      return Response.json([{ user_id: user }]);
    }
    return Response.json(
      active
        ? [
            {
              user_id: user,
              active: true,
              must_change_password: mustChange,
              current_session_id: session,
              full_name: "Test",
            },
          ]
        : [],
    );
  }
  if (url.includes("/rpc/")) {
    rpcArgs = body;
    rpcName = url.split("/").at(-1);
    return Response.json({ id: "receipt", status: "bekliyor" });
  }
  throw Error("Unexpected mock request " + url);
};
await import("../supabase/functions/booking-api/index.ts");
const request = (b, { origin = "https://gahire.example", auth = true } = {}) =>
  new Request("https://edge.example", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(b),
  });
const booking = {
  action: "book",
  id: "44444444-4444-4444-8444-444444444444",
  service: "epilasyon",
  start: "2026-12-01T10:00:00+03:00",
  note: "",
  consent: true,
  website: "",
  customer: "attacker-picked",
  name: "Fake Name",
  phone: "Fake Phone",
};
let count = 0;
async function test(name, fn) {
  await fn();
  count++;
  console.log("PASS", name);
}
await test("Unapproved origin blocked", async () =>
  assert.equal(
    (await handler(request(booking, { origin: "https://attacker.example" })))
      .status,
    403,
  ));
await test("Anonymous slot lookup denied", async () =>
  assert.equal(
    (
      await handler(
        request(
          { action: "slots", service: "cilt", day: "2026-12-01" },
          { auth: false },
        ),
      )
    ).status,
    401,
  ));
await test("Anonymous booking denied", async () =>
  assert.equal((await handler(request(booking, { auth: false }))).status, 401));
await test("Forged JWT denied using Auth user verification", async () => {
  authOK = false;
  assert.equal((await handler(request(booking))).status, 401);
  authOK = true;
});
await test("Customer cannot call staff account creation", async () =>
  assert.equal(
    (await handler(request({ action: "create_member" }))).status,
    403,
  ));
await test("Temporary password cannot book before password change", async () => {
  mustChange = true;
  assert.equal((await handler(request(booking))).status, 403);
  mustChange = false;
});
await test("Inactive account denied", async () => {
  active = false;
  assert.equal((await handler(request(booking))).status, 401);
  active = true;
});
await test("Old session token denied", async () => {
  session = "22222222-2222-4222-8222-222222222222";
  assert.equal((await handler(request(booking))).status, 401);
  session = sid;
});
await test("Booking derives customer and session from verified token", async () => {
  const r = await handler(request(booking));
  assert.equal(r.status, 200);
  assert.equal(rpcName, "gh_book_member");
  assert.equal(rpcArgs.p_user, user);
  assert.equal(rpcArgs.p_session, sid);
  assert(!Object.hasOwn(rpcArgs, "p_name"));
  assert(!Object.hasOwn(rpcArgs, "p_phone"));
});
await test("Login captcha required and server verified", async () => {
  captchaOK = false;
  const before = writes;
  assert.equal(
    (
      await handler(
        request(
          {
            action: "member_login",
            username: "ayse",
            password: "pass",
            token: "invalid",
          },
          { auth: false },
        ),
      )
    ).status,
    400,
  );
  assert.equal(writes, before);
  captchaOK = true;
});
await test("Username login returns session only after binding membership", async () => {
  const before = writes;
  const r = await handler(
    request(
      {
        action: "member_login",
        username: "ayse",
        password: "pass",
        token: "valid",
      },
      { auth: false },
    ),
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.access_token, token);
  assert.equal(writes, before + 1);
});
await test("Staff session recording uses verified admin identity", async () => {
  admin = true;
  await handler(
    request({
      action: "record_session",
      admin: "forged",
      customer: user,
      id: "55555555-5555-4555-8555-555555555555",
      service: "epilasyon",
      when: "2026-09-01T10:00:00Z",
    }),
  );
  assert.equal(rpcName, "gh_record_session");
  assert.equal(rpcArgs.p_admin, user);
  admin = false;
});
console.log(
  `${count} authenticated API boundary checks passed (mocked network).`,
);
await test("GitHub Pages preflight accepts only the exact production origin", async () => {
  const r = await handler(
    new Request("https://example.supabase.co/functions/v1/booking-api", {
      method: "OPTIONS",
      headers: { Origin: "https://kahireturkoglu3-byte.github.io" },
    }),
  );
  assert.equal(r.status, 204);
  assert.equal(
    r.headers.get("access-control-allow-origin"),
    "https://kahireturkoglu3-byte.github.io",
  );
  const denied = await handler(
    new Request("https://example.supabase.co/functions/v1/booking-api", {
      method: "OPTIONS",
      headers: {
        Origin: "https://kahireturkoglu3-byte.github.io.evil.example",
      },
    }),
  );
  assert.equal(denied.status, 403);
});
