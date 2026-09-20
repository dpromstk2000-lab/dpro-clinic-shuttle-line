from pathlib import Path

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"{label}: anchor not found")
    return text.replace(old, new, 1)

p = Path("worker.js")
s = p.read_text(encoding="utf-8")

if 'case "POST /v1/auth/refresh":' not in s:
    route_anchor = """        case "POST /v1/auth/logout":
          return await handleLogout(
            request,
            env,
            corsOrigin,
            requestId
          );
"""
    route_replacement = """        case "POST /v1/auth/refresh":
          return await handleRefreshSession(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/auth/logout":
          return await handleLogout(
            request,
            env,
            corsOrigin,
            requestId
          );
"""
    s = replace_once(s, route_anchor, route_replacement, "worker refresh route")

if "async function handleRefreshSession(" not in s:
    handler_anchor = """async function handleLogout(
  request,
  env,
  corsOrigin,
  requestId
) {"""
    handler_replacement = """async function handleRefreshSession(
  request,
  env,
  corsOrigin,
  requestId
) {
  await readJsonObject(request, { allowEmpty: true });
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "driver",
    "attendant",
    "reception",
    "guardian",
  ]);

  await enforceRateLimit(request, env, "session-refresh", session);

  const facility = await findFacilityById(env, session.facilityId);
  assertFacilityEnvironment(facility, env);

  const token = await issueSessionToken(
    {
      subject: session.subject,
      facilityId: session.facilityId,
      actorType: session.actorType,
      actorId: session.actorId,
      role: session.role,
      displayName: session.displayName || "",
    },
    env
  );

  if (session.actorType === "staff" && isUuid(session.actorId)) {
    await revokeStaffSession(
      env,
      session.facilityId,
      session.actorId,
      session.jti,
      "session_refresh"
    );
  }

  return successResponse(
    {
      token,
      expiresIn: getTokenTtlSeconds(env),
      role: session.role,
      facility: publicFacility(facility),
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleLogout(
  request,
  env,
  corsOrigin,
  requestId
) {"""
    s = replace_once(s, handler_anchor, handler_replacement, "worker refresh handler")

p.write_text(s, encoding="utf-8", newline="\n")

def patch_active_session_refresh(path):
    p = Path(path)
    s = p.read_text(encoding="utf-8")

    if "function tokenSecondsRemaining(token)" not in s:
        api_anchor = """  async function api(path, options = {}) {
    if (mockMode) return mockApi(path, options);
    const base = String(config.apiBaseUrl || "").replace(/\\/+$/, "");
    if (!base.startsWith("https://")) {
      throw new Error("API接続先が正しく設定されていません。");
    }
"""
        api_replacement = """  let sessionRefreshPromise = null;

  function tokenSecondsRemaining(token) {
    try {
      const payloadPart = String(token || "").split(".")[1];
      if (!payloadPart) return 0;
      const normalized = payloadPart
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const padded =
        normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const payload = JSON.parse(atob(padded));
      return Number(payload.exp || 0) - Math.floor(Date.now() / 1000);
    } catch {
      return 0;
    }
  }

  async function refreshSessionIfNeeded() {
    if (!state.token) return;

    const remaining = tokenSecondsRemaining(state.token);
    if (remaining <= 0 || remaining > 600) return;
    if (sessionRefreshPromise) return sessionRefreshPromise;

    const base = String(config.apiBaseUrl || "").replace(/\\/+$/, "");

    sessionRefreshPromise = (async () => {
      const response = await fetch(`${base}/v1/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.token}`
        },
        body: "{}",
        cache: "no-store"
      });

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok || payload.ok === false || !payload.token) {
        throw new Error(
          payload?.error?.message ||
          "ログインの有効期限が切れました。もう一度ログインしてください。"
        );
      }

      state.token = payload.token;
      saveSession();
    })().finally(() => {
      sessionRefreshPromise = null;
    });

    return sessionRefreshPromise;
  }

  async function api(path, options = {}) {
    if (mockMode) return mockApi(path, options);
    const base = String(config.apiBaseUrl || "").replace(/\\/+$/, "");
    if (!base.startsWith("https://")) {
      throw new Error("API接続先が正しく設定されていません。");
    }

    if (state.token && !path.startsWith("/v1/auth/")) {
      try {
        await refreshSessionIfNeeded();
      } catch {
        // 本リクエストの401処理で安全にログイン画面へ戻す。
      }
    }
"""
        s = replace_once(s, api_anchor, api_replacement, f"{path} api refresh")

    p.write_text(s, encoding="utf-8", newline="\n")

patch_active_session_refresh("shuttle.js")
patch_active_session_refresh("staff.js")

p = Path("wrangler.jsonc")
s = p.read_text(encoding="utf-8")

if '"SESSION_TTL_SECONDS"' not in s:
    anchor = '"SUPABASE_URL": "https://cbknucemarcpbscirzyv.supabase.co"'
    replacement = anchor + ',\n    "SESSION_TTL_SECONDS": "1800"'
    s = replace_once(s, anchor, replacement, "wrangler SESSION_TTL_SECONDS")

p.write_text(s, encoding="utf-8", newline="\n")
