// Gahire üye API'si. Anahtarlar yalnızca Supabase Edge Function ortamından okunur.
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
const hosts = (Deno.env.get("TURNSTILE_HOSTNAMES") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const uidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
const messages: Record<string, string> = {
  GH_AUTH: "Bu işlem için yönetici girişi gerekiyor.",
  GH_MEMBER: "Oturumunuz geçersiz veya hesabınız kapalı. Yeniden giriş yapın.",
  GH_PASSWORD: "Şifrenizi değiştirmeniz gerekiyor.",
  GH_SLOT: "Bu saat artık uygun değil. Başka bir saat seçin.",
  GH_CLOSED: "Online randevu alımı kapalı.",
  GH_INPUT: "Bilgilerinizi kontrol edin.",
  GH_LIMIT: "Çok fazla randevu talebiniz var. Salonla iletişime geçin.",
  GH_RETRY: "Bu istek farklı bilgilerle daha önce kaydedildi.",
  GH_PACKAGE: "Paket ve hizmet seçimini kontrol edin.",
  GH_NO_SESSIONS:
    "Bu paketin tüm seansları kullanılmış veya randevu için ayrılmış.",
  GH_RESERVED: "Kalan seanslar randevulara ayrılmış. İlgili randevuyu seçin.",
  GH_APPOINTMENT: "Bu randevu henüz tamamlanamaz veya seçimle eşleşmiyor.",
};
class ApiError extends Error {
  status: number;
  code: string;
  constructor(code: string, status = 400) {
    super(messages[code] || code);
    this.code = code;
    this.status = status;
  }
}
async function call(path: string, method = "GET", body?: unknown, token = key) {
  const response = await fetch(url + path, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(18000),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError("Sunucudan yanıt alınamadı.", 503);
  }
  if (!response.ok) {
    const match = Object.keys(messages).find((k) =>
      String(data?.message || "").includes(k),
    );
    if (match) throw new ApiError(match);
    throw new ApiError(
      response.status === 401
        ? "GH_MEMBER"
        : "İşlem tamamlanamadı. Bilgileri kontrol edip tekrar deneyin.",
      response.status === 401 ? 401 : 400,
    );
  }
  return data;
}
function sessionId(token: string) {
  try {
    const json = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return typeof json.session_id === "string" &&
      uidPattern.test(json.session_id)
      ? json.session_id
      : null;
  } catch {
    return null;
  }
}
function validatePassword(password: unknown) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128 ||
    !/[a-zA-Z]/.test(password) ||
    !/[0-9]/.test(password)
  )
    throw new ApiError("Şifre en az 12 karakter, harf ve rakam içermeli.");
}
async function validateCaptcha(token: unknown) {
  if (!secret || !hosts.length)
    throw new ApiError("Üye girişi henüz kullanıma açılmadı.", 503);
  if (typeof token !== "string" || !token || token.length > 2048)
    throw new ApiError("Güvenlik doğrulamasını tamamlayın.");
  const r = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(10000),
    },
  );
  const c = await r.json();
  if (!c.success || c.action !== "member_login" || !hosts.includes(c.hostname))
    throw new ApiError("Güvenlik doğrulamasını yenileyin.");
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const headers = {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : "null",
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "content-type, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
  };
  const reply = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  if (!allowed.includes(origin))
    return reply({ error: "İzin verilmeyen bağlantı." }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ error: "Geçersiz istek." }, 405);
  try {
    if (Number(req.headers.get("content-length") || 0) > 14000)
      throw new ApiError("İstek çok büyük.", 413);
    const raw = await req.text();
    if (raw.length > 14000) throw new ApiError("İstek çok büyük.", 413);
    let b;
    try {
      b = JSON.parse(raw);
    } catch {
      throw new ApiError("GH_INPUT");
    }
    if (!b || typeof b !== "object" || typeof b.action !== "string")
      throw new ApiError("GH_INPUT");
    if (b.action === "member_login") {
      await validateCaptcha(b.token);
      const username = String(b.username || "")
        .trim()
        .toLowerCase();
      if (
        !usernamePattern.test(username) ||
        typeof b.password !== "string" ||
        b.password.length > 128
      )
        throw new ApiError("Kullanıcı adı veya şifre hatalı.", 401);
      let session;
      try {
        session = await call("/auth/v1/token?grant_type=password", "POST", {
          email: username + "@members.gahire.invalid",
          password: b.password,
        });
      } catch {
        throw new ApiError("Kullanıcı adı veya şifre hatalı.", 401);
      }
      const sid = sessionId(session.access_token);
      if (!sid) throw new ApiError("GH_MEMBER", 401);
      const rows = await call(
        `/rest/v1/gh_members?user_id=eq.${session.user.id}&active=eq.true`,
        "PATCH",
        { current_session_id: sid },
      );
      if (!rows?.length)
        throw new ApiError(
          "Hesap kullanılamıyor. Salonla iletişime geçin.",
          403,
        );
      return reply({
        data: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        },
      });
    }
    const bearer = req.headers.get("authorization") || "";
    if (!bearer.startsWith("Bearer ")) throw new ApiError("GH_MEMBER", 401);
    const token = bearer.slice(7);
    // getUser doğrulaması: JWT içeriği tek başına yetki kanıtı değildir.
    const user = await call("/auth/v1/user", "GET", undefined, token);
    if (!user?.id || !uidPattern.test(user.id))
      throw new ApiError("GH_MEMBER", 401);
    const adminActions = [
      "create_member",
      "reset_member",
      "set_member_active",
      "create_package",
      "record_session",
      "void_session",
    ];
    if (adminActions.includes(b.action)) {
      const admins = await call(
        `/rest/v1/gh_admins?user_id=eq.${user.id}&select=user_id`,
      );
      if (!admins.length) throw new ApiError("GH_AUTH", 403);
      if (b.action === "create_member") {
        const username = String(b.username || "")
          .trim()
          .toLowerCase();
        validatePassword(b.password);
        if (
          !usernamePattern.test(username) ||
          typeof b.name !== "string" ||
          b.name.trim().length < 2 ||
          b.name.trim().length > 80 ||
          !/^905\d{9}$/.test(b.phone)
        )
          throw new ApiError("GH_INPUT");
        const existing = await call(
          `/rest/v1/gh_members?username=eq.${username}&select=user_id`,
        );
        if (existing.length)
          throw new ApiError("Bu kullanıcı adı zaten kayıtlı.");
        const created = await call("/auth/v1/admin/users", "POST", {
          email: username + "@members.gahire.invalid",
          password: b.password,
          email_confirm: true,
        });
        const member = created.user || created;
        if (!member?.id) throw new ApiError("Hesap oluşturulamadı.", 503);
        try {
          await call("/rest/v1/gh_members", "POST", {
            user_id: member.id,
            username,
            full_name: b.name.trim(),
            phone: b.phone,
          });
        } catch (error) {
          await call(`/auth/v1/admin/users/${member.id}`, "DELETE").catch(
            () => {},
          );
          throw error;
        }
        return reply({ data: { user_id: member.id, username } });
      }
      if (b.action === "create_package") {
        if (
          !uidPattern.test(b.customer) ||
          typeof b.service !== "string" ||
          typeof b.label !== "string" ||
          b.label.trim().length < 2 ||
          b.label.length > 100 ||
          !Number.isInteger(b.total) ||
          b.total < 1 ||
          b.total > 100
        )
          throw new ApiError("GH_INPUT");
        const rows = await call("/rest/v1/gh_packages", "POST", {
          customer_id: b.customer,
          service_id: b.service,
          label: b.label.trim(),
          total_sessions: b.total,
          next_due: b.due || null,
          created_by: user.id,
        });
        return reply({ data: rows[0] });
      }
      if (b.action === "record_session") {
        const data = await call("/rest/v1/rpc/gh_record_session", "POST", {
          p_admin: user.id,
          p_id: b.id,
          p_customer: b.customer,
          p_service: b.service,
          p_package: b.package || null,
          p_appointment: b.appointment || null,
          p_when: b.when,
          p_note: b.note || "",
          p_due: b.due || null,
        });
        return reply({ data });
      }
      if (b.action === "void_session") {
        if (
          !uidPattern.test(b.id) ||
          typeof b.reason !== "string" ||
          b.reason.trim().length < 3 ||
          b.reason.length > 300
        )
          throw new ApiError("GH_INPUT");
        const data = await call("/rest/v1/rpc/gh_void_session", "POST", {
          p_admin: user.id,
          p_id: b.id,
          p_reason: b.reason.trim(),
        });
        return reply({ data });
      }
      if (!uidPattern.test(b.customer)) throw new ApiError("GH_INPUT");
      if (b.action === "reset_member") {
        validatePassword(b.password);
        const changed = await call(
          `/rest/v1/gh_members?user_id=eq.${b.customer}`,
          "PATCH",
          { must_change_password: true, current_session_id: null },
        );
        if (!changed.length) throw new ApiError("GH_MEMBER");
        await call(`/auth/v1/admin/users/${b.customer}`, "PUT", {
          password: b.password,
        });
        return reply({ data: { ok: true } });
      }
      if (typeof b.active !== "boolean") throw new ApiError("GH_INPUT");
      const changed = await call(
        `/rest/v1/gh_members?user_id=eq.${b.customer}`,
        "PATCH",
        { active: b.active, current_session_id: null },
      );
      if (!changed.length) throw new ApiError("GH_MEMBER");
      return reply({ data: { ok: true } });
    }
    const sid = sessionId(token);
    const profiles = await call(
      `/rest/v1/gh_members?user_id=eq.${user.id}&active=eq.true`,
    );
    const profile = profiles[0];
    if (!sid || !profile || profile.current_session_id !== sid)
      throw new ApiError("GH_MEMBER", 401);
    if (b.action === "member_logout") {
      await call(
        `/rest/v1/gh_members?user_id=eq.${user.id}&current_session_id=eq.${sid}`,
        "PATCH",
        { current_session_id: null },
      );
      return reply({ data: { ok: true } });
    }
    if (b.action === "change_password") {
      validatePassword(b.password);
      await call(`/auth/v1/admin/users/${user.id}`, "PUT", {
        password: b.password,
      });
      const changed = await call(
        `/rest/v1/gh_members?user_id=eq.${user.id}&current_session_id=eq.${sid}&active=eq.true`,
        "PATCH",
        { must_change_password: false },
      );
      if (!changed.length) throw new ApiError("GH_MEMBER", 401);
      return reply({ data: { ok: true } });
    }
    if (profile.must_change_password) throw new ApiError("GH_PASSWORD", 403);
    if (b.action === "slots") {
      if (
        typeof b.service !== "string" ||
        b.service.length > 40 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(b.day)
      )
        throw new ApiError("GH_INPUT");
      const data = await call("/rest/v1/rpc/gh_slots", "POST", {
        p_service: b.service,
        p_day: b.day,
      });
      return reply({ data });
    }
    if (b.action === "book") {
      if (
        !uidPattern.test(b.id) ||
        b.consent !== true ||
        b.website ||
        typeof b.note !== "string" ||
        b.note.length > 500
      )
        throw new ApiError("GH_INPUT");
      const data = await call("/rest/v1/rpc/gh_book_member", "POST", {
        p_user: user.id,
        p_session: sid,
        p_id: b.id,
        p_service: b.service,
        p_start: b.start,
        p_package: b.package || null,
        p_note: b.note,
      });
      return reply({ data });
    }
    throw new ApiError("Geçersiz işlem.");
  } catch (error) {
    if (error instanceof ApiError)
      return reply({ error: error.message, code: error.code }, error.status);
    return reply(
      {
        error:
          "Bağlantı tamamlanamadı. Kayıt işlemi yaptıysanız tekrar göndermeden önce sonucu kontrol edin.",
      },
      503,
    );
  }
});
