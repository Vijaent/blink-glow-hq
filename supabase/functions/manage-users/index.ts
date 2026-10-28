// Owner-only: create logins, reset passwords and remove people, from the Users page in the app.
// The platform injects SUPABASE_SERVICE_ROLE_KEY at run time. It is never stored in the repo or sent to the browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (code: string, message: string, status = 400) => json({ ok: false, error: code, message }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("method", "Use POST.", 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return fail("unauthorised", "Sign in first.", 401);

  // Who is calling, and are they an owner? Asked through the caller's own token, so it cannot be faked.
  const asCaller = createClient(url, anonKey || serviceKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: me, error: meErr } = await asCaller.auth.getUser();
  if (meErr || !me?.user) return fail("unauthorised", "Sign in again.", 401);
  const { data: role, error: roleErr } = await asCaller.rpc("bg_my_role");
  if (roleErr || role !== "owner") return fail("not_owner", "Only an Owner can do this.", 403);

  let body: any;
  try { body = await req.json(); } catch { return fail("bad_request", "Invalid request."); }
  const action = String(body?.action ?? "");
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const newRole = String(body?.role ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail("bad_email", "Enter a valid email address.");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const findUser = async () => {
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email);
      if (u) return u;
      if (data.users.length < 200) break;
    }
    return null;
  };
  const owners = async (exceptId: string) => {
    const { count } = await admin.from("team_roles").select("user_id", { count: "exact", head: true }).eq("role", "owner").neq("user_id", exceptId);
    return count ?? 0;
  };

  try {
    if (action === "create") {
      if (!["owner", "admin"].includes(newRole)) return fail("bad_role", "Choose Owner or Admin.");
      if (password.length < 8) return fail("weak_password", "The password needs at least 8 characters.");
      if (await findUser()) return fail("exists", "That email already has a login. Find it in the list and change its access.");
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data?.user) return fail("create_failed", error?.message ?? "Could not create the login.");
      const { error: re } = await admin.from("team_roles").upsert({ user_id: data.user.id, email, role: newRole, updated_at: new Date().toISOString() });
      if (re) return fail("role_failed", "The login was created but access could not be set. Set it in the list.", 500);
      return json({ ok: true });
    }
    if (action === "reset_password") {
      if (password.length < 8) return fail("weak_password", "The password needs at least 8 characters.");
      const u = await findUser();
      if (!u) return fail("no_such_user", "No login with that email.", 404);
      const { error } = await admin.auth.admin.updateUserById(u.id, { password });
      if (error) return fail("reset_failed", error.message);
      return json({ ok: true });
    }
    if (action === "delete") {
      const u = await findUser();
      if (!u) return fail("no_such_user", "No login with that email.", 404);
      if (u.id === me.user.id) return fail("cannot_remove_self", "You cannot delete your own login.");
      const { data: cur } = await admin.from("team_roles").select("role").eq("user_id", u.id).maybeSingle();
      if (cur?.role === "owner" && (await owners(u.id)) === 0) return fail("last_owner", "There must always be at least one Owner.");
      const { error } = await admin.auth.admin.deleteUser(u.id);
      if (error) return fail("delete_failed", error.message);
      return json({ ok: true });
    }
    return fail("bad_action", "Unknown action.");
  } catch (e) {
    return fail("server", "Something went wrong. Try again.", 500);
  }
});
