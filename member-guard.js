// Görünürlük kontrolüne ek olarak tüm müşteri verileri veritabanında RLS ile korunur.
window.GahireMember = (async () => {
  const api = window.GahireAPI;
  const back = () => {
    location.replace("index.html");
    return null;
  };
  if (!api.ready) return back();
  try {
    const { data, error } = await api.client.auth.getSession();
    if (error || !data.session) return back();
    const profile = await api.client
      .from("gh_members")
      .select("*")
      .eq("user_id", data.session.user.id)
      .maybeSingle();
    if (
      profile.error ||
      !profile.data ||
      !profile.data.active ||
      profile.data.must_change_password
    )
      return back();
    document.body.classList.remove("member-guarded");
    document.getElementById("guard-status")?.remove();
    return profile.data;
  } catch {
    return back();
  }
})();
