/*
 * DPRO 福祉施設送迎 LINE
 * Cloudflare Worker API
 *
 * STEP: SHUTTLE-2
 * Version: SHUTTLE-2-WORKER-20260727
 *
 * 公開ファイルへ秘密情報を記載しないこと。
 * SUPABASE_SECRET_KEY（推奨）または旧SUPABASE_SERVICE_ROLE_KEY、
 * SESSION_SECRET、管理コードはCloudflare WorkersのSecretsとする。
 */

const SERVICE_NAME = "DPRO Welfare Shuttle API";
const WORKER_VERSION = "SHUTTLE-2-WORKER-20260727";
const DATABASE_VERSION = "SHUTTLE-1-DB-20260727";
const TOKEN_ISSUER = "dpro-welfare-shuttle";
const TOKEN_AUDIENCE = "dpro-welfare-shuttle-api";
const MAX_JSON_BYTES = 32 * 1024;
const DEFAULT_TOKEN_TTL_SECONDS = 900;
const MIN_TOKEN_TTL_SECONDS = 300;
const MAX_TOKEN_TTL_SECONDS = 1800;
const UPSTREAM_TIMEOUT_MS = 8000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class AppError extends Error {
  constructor(status, code, message, internalMessage = "") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.internalMessage = internalMessage;
  }
}

export default {
  async fetch(request, env, ctx) {
    const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
    const origin = request.headers.get("origin");
    let corsOrigin = null;

    try {
      corsOrigin = resolveCorsOrigin(origin, env.ALLOWED_ORIGINS);

      if (request.method === "OPTIONS") {
        if (!origin) {
          throw new AppError(
            400,
            "ORIGIN_REQUIRED",
            "ブラウザの接続元を確認できません。"
          );
        }
        if (!corsOrigin) {
          throw new AppError(
            403,
            "ORIGIN_NOT_ALLOWED",
            "この画面からAPIを利用することはできません。"
          );
        }
        return new Response(null, {
          status: 204,
          headers: responseHeaders(corsOrigin, requestId, true),
        });
      }

      if (origin && !corsOrigin) {
        throw new AppError(
          403,
          "ORIGIN_NOT_ALLOWED",
          "この画面からAPIを利用することはできません。"
        );
      }

      const url = new URL(request.url);
      const route = `${request.method.toUpperCase()} ${normalizePath(url.pathname)}`;

      switch (route) {
        case "GET /health":
          return successResponse(
            {
              service: SERVICE_NAME,
              version: WORKER_VERSION,
              status: "healthy",
              timezone: "Asia/Tokyo",
              checkedAt: new Date().toISOString(),
            },
            200,
            corsOrigin,
            requestId
          );

        case "GET /v1/system/version":
          return successResponse(
            {
              service: SERVICE_NAME,
              workerVersion: WORKER_VERSION,
              requiredDatabaseVersion: DATABASE_VERSION,
              apiStage: "SHUTTLE-2",
            },
            200,
            corsOrigin,
            requestId
          );

        case "POST /v1/auth/admin":
          await enforceRateLimit(request, env, "admin-login");
          return await handleAdminLogin(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/auth/staff":
          await enforceRateLimit(request, env, "staff-login");
          return await handleStaffLogin(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/auth/member":
          await enforceRateLimit(request, env, "member-login");
          return await handleMemberLogin(
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

        case "POST /v1/system/check":
          return await handleSystemCheck(
            request,
            env,
            corsOrigin,
            requestId
          );

        default:
          return routeNotFoundResponse(
            request.method,
            normalizePath(url.pathname),
            corsOrigin,
            requestId
          );
      }
    } catch (error) {
      const appError = normalizeError(error);
      logError(appError, requestId, request);

      return errorResponse(
        appError.status,
        appError.code,
        appError.message,
        corsOrigin,
        requestId
      );
    }
  },
};

async function handleAdminLogin(
  request,
  env,
  corsOrigin,
  requestId
) {
  assertBaseConfiguration(env, { requireSession: true });
  const body = await readJsonObject(request);
  const facilityCode = requireFacilityCode(body.facilityCode);
  const managementCode = requireString(
    body.managementCode,
    "管理コード",
    4,
    128
  );
  const facility = await findFacilityByCode(env, facilityCode);
  assertFacilityEnvironment(facility, env);

  const expectedCode =
    facility.environment === "demo"
      ? env.DEMO_ADMIN_CODE
      : env.ADMIN_ACCESS_CODE;

  if (
    typeof expectedCode !== "string" ||
    expectedCode.length < (
      facility.environment === "demo" ? 4 : 12
    ) ||
    (
      facility.environment === "production" &&
      expectedCode === "1234"
    )
  ) {
    throw new AppError(
      503,
      "ADMIN_AUTH_NOT_CONFIGURED",
      "管理者認証の設定が完了していません。管理者へ連絡してください。"
    );
  }

  const valid = await constantTimeTextEqual(
    managementCode,
    expectedCode
  );

  if (!valid) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "事業所コードまたは管理コードが正しくありません。"
    );
  }

  const session = {
    subject: `facility:${facility.id}:admin-code`,
    facilityId: facility.id,
    actorType: "staff",
    actorId: null,
    role: "admin",
    displayName: "管理者",
  };
  const token = await issueSessionToken(session, env);

  await writeAuditLog(env, {
    facilityId: facility.id,
    actorType: "staff",
    actorId: null,
    action: "admin_code_login",
    entityType: "session",
    entityId: null,
    requestId,
    request,
  });

  return successResponse(
    {
      token,
      expiresIn: getTokenTtlSeconds(env),
      role: "admin",
      facility: publicFacility(facility),
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleStaffLogin(
  request,
  env,
  corsOrigin,
  requestId
) {
  assertBaseConfiguration(env, { requireSession: true });
  const body = await readJsonObject(request);
  const facilityCode = requireFacilityCode(body.facilityCode);
  const loginId = requireString(body.loginId, "ログインID", 3, 100);
  const pin = requireString(body.pin, "暗証番号", 4, 64);
  if (!/^[A-Za-z0-9._@-]{3,100}$/.test(loginId)) {
    throw new AppError(
      400,
      "INVALID_LOGIN_ID",
      "ログインIDの形式が正しくありません。"
    );
  }
  const facility = await findFacilityByCode(env, facilityCode);
  assertFacilityEnvironment(facility, env);

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,facility_id,staff_code,full_name,staff_role,pin_hash,is_active"
  );
  params.set("facility_id", `eq.${facility.id}`);
  params.set("login_id", `eq.${loginId}`);
  params.set("is_active", "eq.true");
  params.set("limit", "1");

  const staffRows = await supabaseRequest(
    env,
    `shuttle_staff?${params.toString()}`
  );
  const staff = Array.isArray(staffRows) ? staffRows[0] : null;
  const valid =
    staff &&
    typeof staff.pin_hash === "string" &&
    await verifyPbkdf2Pin(pin, staff.pin_hash);

  if (!valid) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "事業所コード、ログインID、暗証番号を確認してください。"
    );
  }

  const session = {
    subject: `staff:${staff.id}`,
    facilityId: facility.id,
    actorType: "staff",
    actorId: staff.id,
    role: staff.staff_role,
    displayName: staff.full_name,
  };
  const token = await issueSessionToken(session, env);

  const updateParams = new URLSearchParams();
  updateParams.set("id", `eq.${staff.id}`);
  updateParams.set("facility_id", `eq.${facility.id}`);
  await supabaseRequest(
    env,
    `shuttle_staff?${updateParams.toString()}`,
    {
      method: "PATCH",
      body: { last_login_at: new Date().toISOString() },
      prefer: "return=minimal",
    }
  );

  await writeAuditLog(env, {
    facilityId: facility.id,
    actorType: "staff",
    actorId: staff.id,
    action: "staff_login",
    entityType: "session",
    entityId: null,
    requestId,
    request,
  });

  return successResponse(
    {
      token,
      expiresIn: getTokenTtlSeconds(env),
      role: staff.staff_role,
      staff: {
        id: staff.id,
        staffCode: staff.staff_code,
        fullName: staff.full_name,
      },
      facility: publicFacility(facility),
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleMemberLogin(
  request,
  env,
  corsOrigin,
  requestId
) {
  assertBaseConfiguration(env, { requireSession: true });

  if (
    typeof env.LINE_CHANNEL_ID !== "string" ||
    !/^[0-9]{5,20}$/.test(env.LINE_CHANNEL_ID)
  ) {
    throw new AppError(
      503,
      "LINE_AUTH_NOT_CONFIGURED",
      "LINE連携の設定が完了していません。管理者へ連絡してください。"
    );
  }

  const body = await readJsonObject(request);
  const facilityCode = requireFacilityCode(body.facilityCode);
  const idToken = requireString(
    body.idToken,
    "LINE IDトークン",
    20,
    8192
  );
  const nonce = optionalString(body.nonce, "nonce", 8, 200);
  const facility = await findFacilityByCode(env, facilityCode);
  assertFacilityEnvironment(facility, env);
  const lineClaims = await verifyLineIdToken(
    idToken,
    nonce,
    env.LINE_CHANNEL_ID
  );

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,facility_id,guardian_code,full_name,line_user_id,link_status,is_active"
  );
  params.set("facility_id", `eq.${facility.id}`);
  params.set("line_user_id", `eq.${lineClaims.sub}`);
  params.set("link_status", "eq.approved");
  params.set("is_active", "eq.true");
  params.set("limit", "1");

  const guardianRows = await supabaseRequest(
    env,
    `shuttle_guardians?${params.toString()}`
  );
  const guardian = Array.isArray(guardianRows)
    ? guardianRows[0]
    : null;

  if (!guardian) {
    throw new AppError(
      403,
      "MEMBER_LINK_NOT_APPROVED",
      "このLINEアカウントは事業所での連携承認が完了していません。"
    );
  }

  const session = {
    subject: `guardian:${guardian.id}`,
    facilityId: facility.id,
    actorType: "guardian",
    actorId: guardian.id,
    role: "guardian",
    displayName: guardian.full_name,
  };
  const token = await issueSessionToken(session, env);

  await writeAuditLog(env, {
    facilityId: facility.id,
    actorType: "guardian",
    actorId: guardian.id,
    action: "guardian_login",
    entityType: "session",
    entityId: null,
    requestId,
    request,
  });

  return successResponse(
    {
      token,
      expiresIn: getTokenTtlSeconds(env),
      role: "guardian",
      member: {
        id: guardian.id,
        guardianCode: guardian.guardian_code,
        fullName: guardian.full_name,
      },
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
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "driver",
    "attendant",
    "reception",
    "guardian",
  ]);

  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "logout",
    entityType: "session",
    entityId: session.jti,
    requestId,
    request,
  });

  return successResponse(
    {
      loggedOut: true,
      message: "ログアウトしました。端末の認証情報を削除してください。",
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleSystemCheck(
  request,
  env,
  corsOrigin,
  requestId
) {
  assertBaseConfiguration(env, { requireSession: true });
  await readJsonObject(request, { allowEmpty: true });
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
  ]);
  await enforceRateLimit(request, env, "system-check", session);

  const facility = await findFacilityById(env, session.facilityId);
  assertFacilityEnvironment(facility, env);

  const settingsParams = new URLSearchParams();
  settingsParams.set(
    "select",
    "schedule_step_minutes,business_start_time,business_end_time,change_deadline_time,same_day_change_allowed,allow_demo_prepare"
  );
  settingsParams.set("facility_id", `eq.${facility.id}`);
  settingsParams.set("limit", "1");

  const [
    databaseCheck,
    settingsRows,
    phoneA,
    phoneB,
    phoneC,
  ] = await Promise.all([
    supabaseRpc(env, "shuttle_schema_check", {}),
    supabaseRequest(
      env,
      `shuttle_settings?${settingsParams.toString()}`
    ),
    supabaseRpc(env, "shuttle_normalize_phone", {
      p_phone: "090-1234-5678",
    }),
    supabaseRpc(env, "shuttle_normalize_phone", {
      p_phone: "０９０ １２３４ ５６７８",
    }),
    supabaseRpc(env, "shuttle_normalize_phone", {
      p_phone: "+81 90 1234 5678",
    }),
  ]);

  const settings = Array.isArray(settingsRows)
    ? settingsRows[0]
    : null;
  const phoneNormalizationOk =
    phoneA === "09012345678" &&
    phoneB === phoneA &&
    phoneC === phoneA;
  const databaseOk =
    databaseCheck &&
    databaseCheck.ok === true &&
    databaseCheck.version === DATABASE_VERSION;
  const facilitySettingsOk =
    settings &&
    settings.schedule_step_minutes === 5;
  const productionGuardOk =
    env.PRODUCTION_GUARD === "enabled" &&
    facility.environment === env.APP_ENVIRONMENT &&
    (
      facility.environment !== "production" ||
      (
        typeof env.ADMIN_ACCESS_CODE === "string" &&
        env.ADMIN_ACCESS_CODE.length >= 12 &&
        env.ADMIN_ACCESS_CODE !== "1234"
      )
    );
  const corsConfigured =
    parseAllowedOrigins(env.ALLOWED_ORIGINS).length > 0;
  const lineConfigured =
    typeof env.LINE_CHANNEL_ID === "string" &&
    /^[0-9]{5,20}$/.test(env.LINE_CHANNEL_ID);
  const rateLimitConfigured = Boolean(env.RATE_LIMITER);
  const requiredOk =
    databaseOk &&
    facilitySettingsOk &&
    phoneNormalizationOk &&
    productionGuardOk;

  return successResponse(
    {
      systemCheck: {
        ok: requiredOk,
        stage: "SHUTTLE-2",
        checkedAt: new Date().toISOString(),
        worker: {
          status: "pass",
          version: WORKER_VERSION,
        },
        database: {
          status: databaseOk ? "pass" : "fail",
          version: databaseCheck?.version || null,
          requiredVersion: DATABASE_VERSION,
          missingTables: databaseCheck?.missing_tables || [],
          missingRpcs: databaseCheck?.missing_rpcs || [],
          rlsDisabledTables:
            databaseCheck?.rls_disabled_tables || [],
          constraintCount:
            databaseCheck?.constraint_count ?? null,
          indexCount: databaseCheck?.index_count ?? null,
        },
        facility: {
          status: facilitySettingsOk ? "pass" : "fail",
          facilityCode: facility.facility_code,
          environment: facility.environment,
          scheduleStepMinutes:
            settings?.schedule_step_minutes ?? null,
          businessStartTime:
            settings?.business_start_time ?? null,
          businessEndTime:
            settings?.business_end_time ?? null,
        },
        phoneNormalization: {
          status: phoneNormalizationOk ? "pass" : "fail",
          normalizedValue: phoneNormalizationOk ? phoneA : null,
        },
        productionGuard: {
          status: productionGuardOk ? "pass" : "fail",
        },
        browserCors: {
          status: corsConfigured ? "pass" : "pending",
          requiredBeforeFrontendPublication: true,
        },
        lineMemberAuthentication: {
          status: lineConfigured ? "pass" : "pending",
          requiredAtStep: "SHUTTLE-7",
        },
        rateLimiting: {
          status: rateLimitConfigured ? "pass" : "recommended",
          bindingName: "RATE_LIMITER",
        },
      },
    },
    200,
    corsOrigin,
    requestId
  );
}

async function findFacilityByCode(env, facilityCode) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,facility_code,facility_name,environment,timezone,is_active"
  );
  params.set("facility_code", `eq.${facilityCode}`);
  params.set("is_active", "eq.true");
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_facilities?${params.toString()}`
  );
  const facility = Array.isArray(rows) ? rows[0] : null;

  if (!facility) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "事業所コードまたは認証情報が正しくありません。"
    );
  }
  return facility;
}

async function findFacilityById(env, facilityId) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,facility_code,facility_name,environment,timezone,is_active"
  );
  params.set("id", `eq.${facilityId}`);
  params.set("is_active", "eq.true");
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_facilities?${params.toString()}`
  );
  const facility = Array.isArray(rows) ? rows[0] : null;

  if (!facility) {
    throw new AppError(
      403,
      "FACILITY_NOT_AVAILABLE",
      "この事業所は現在利用できません。"
    );
  }
  return facility;
}

function publicFacility(facility) {
  return {
    id: facility.id,
    facilityCode: facility.facility_code,
    facilityName: facility.facility_name,
    environment: facility.environment,
    timezone: facility.timezone,
  };
}

function assertFacilityEnvironment(facility, env) {
  const appEnvironment = env.APP_ENVIRONMENT;

  if (!["demo", "production"].includes(appEnvironment)) {
    throw new AppError(
      503,
      "ENVIRONMENT_NOT_CONFIGURED",
      "本番・デモ区分の設定が完了していません。"
    );
  }
  if (facility.environment !== appEnvironment) {
    throw new AppError(
      403,
      "ENVIRONMENT_MISMATCH",
      "本番環境とデモ環境が一致しないため処理を停止しました。"
    );
  }
  if (env.PRODUCTION_GUARD !== "enabled") {
    throw new AppError(
      503,
      "PRODUCTION_GUARD_DISABLED",
      "安全確認設定が無効なため処理を停止しました。"
    );
  }
}

function assertBaseConfiguration(env, options = {}) {
  const { requireSession = false } = options;
  let parsedUrl;

  try {
    parsedUrl = new URL(env.SUPABASE_URL);
  } catch {
    parsedUrl = null;
  }

  if (
    !parsedUrl ||
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new AppError(
      503,
      "SUPABASE_URL_NOT_CONFIGURED",
      "データベース接続先の設定が完了していません。"
    );
  }
  const serverKey = getSupabaseServerKey(env);
  if (!serverKey) {
    throw new AppError(
      503,
      "SUPABASE_KEY_NOT_CONFIGURED",
      "データベース認証の設定が完了していません。"
    );
  }
  if (
    requireSession &&
    (
      typeof env.SESSION_SECRET !== "string" ||
      env.SESSION_SECRET.length < 32
    )
  ) {
    throw new AppError(
      503,
      "SESSION_SECRET_NOT_CONFIGURED",
      "セッション保護の設定が完了していません。"
    );
  }
}

async function supabaseRpc(env, functionName, body) {
  if (!/^shuttle_[a-z0-9_]+$/.test(functionName)) {
    throw new AppError(
      500,
      "INVALID_INTERNAL_RPC",
      "内部処理の指定が正しくありません。"
    );
  }
  return await supabaseRequest(env, `rpc/${functionName}`, {
    method: "POST",
    body,
  });
}

async function supabaseRequest(env, relativePath, options = {}) {
  assertBaseConfiguration(env);
  const method = options.method || "GET";
  const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/rest/v1/${relativePath}`;
  const serverKey = getSupabaseServerKey(env);
  const headers = new Headers({
    apikey: serverKey,
    accept: "application/json",
  });

  /*
   * 新しい sb_secret_ キーは apikey ヘッダーだけで送る。
   * 旧service_role JWTの場合だけAuthorizationにも設定する。
   */
  if (!serverKey.startsWith("sb_secret_")) {
    headers.set("authorization", `Bearer ${serverKey}`);
  }

  if (options.body !== undefined) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  if (options.prefer) {
    headers.set("prefer", options.prefer);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    UPSTREAM_TIMEOUT_MS
  );
  let response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AppError(
        504,
        "SUPABASE_TIMEOUT",
        "データベースの応答に時間がかかっています。少し待って再度お試しください。"
      );
    }
    throw new AppError(
      502,
      "SUPABASE_UNREACHABLE",
      "データベースへ接続できません。少し待って再度お試しください。",
      String(error?.message || error)
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw mapSupabaseError(response.status, payload);
  }
  return payload;
}

function getSupabaseServerKey(env) {
  const preferred = env.SUPABASE_SECRET_KEY;
  if (
    typeof preferred === "string" &&
    preferred.startsWith("sb_secret_") &&
    preferred.length >= 24
  ) {
    return preferred;
  }

  const legacy = env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    typeof legacy === "string" &&
    legacy.length >= 20
  ) {
    return legacy;
  }
  return null;
}

function mapSupabaseError(status, payload) {
  const databaseCode =
    payload && typeof payload === "object"
      ? String(payload.code || "")
      : "";
  const internalMessage =
    payload && typeof payload === "object"
      ? String(payload.message || "")
      : String(payload || "");

  if (status === 409 || databaseCode === "23505") {
    return new AppError(
      409,
      "DUPLICATE_CONFLICT",
      "同じ内容がすでに登録されています。画面を更新してご確認ください。",
      internalMessage
    );
  }
  if (databaseCode === "42501" || status === 403) {
    return new AppError(
      403,
      "DATABASE_PERMISSION_DENIED",
      "この操作を行う権限がありません。",
      internalMessage
    );
  }
  if (databaseCode === "P0002") {
    return new AppError(
      404,
      "DATABASE_RECORD_NOT_FOUND",
      "対象データが見つかりません。画面を更新してください。",
      internalMessage
    );
  }
  if (databaseCode === "22007") {
    return new AppError(
      400,
      "INVALID_SERVICE_DATE",
      "指定日時を受け付けられません。過去日・休業日・時間を確認してください。",
      internalMessage
    );
  }
  if (
    databaseCode === "22023" ||
    databaseCode === "23514" ||
    status === 400
  ) {
    return new AppError(
      400,
      "DATABASE_VALIDATION_FAILED",
      "入力内容を確認してください。条件に合わない値が含まれています。",
      internalMessage
    );
  }
  if (status === 401) {
    return new AppError(
      502,
      "SUPABASE_AUTH_FAILED",
      "データベース認証に失敗しました。管理者へ連絡してください。",
      internalMessage
    );
  }
  return new AppError(
    502,
    "SUPABASE_ERROR",
    "データベース処理に失敗しました。少し待って再度お試しください。",
    internalMessage
  );
}

async function verifyLineIdToken(idToken, nonce, channelId) {
  const form = new URLSearchParams({
    id_token: idToken,
    client_id: channelId,
  });
  if (nonce) {
    form.set("nonce", nonce);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    UPSTREAM_TIMEOUT_MS
  );
  let response;

  try {
    response = await fetch(
      "https://api.line.me/oauth2/v2.1/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: form,
        signal: controller.signal,
      }
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AppError(
        504,
        "LINE_AUTH_TIMEOUT",
        "LINE認証の応答に時間がかかっています。再度お試しください。"
      );
    }
    throw new AppError(
      502,
      "LINE_AUTH_UNREACHABLE",
      "LINE認証へ接続できません。少し待って再度お試しください。",
      String(error?.message || error)
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let claims = null;
  try {
    claims = await response.json();
  } catch {
    claims = null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const valid =
    response.ok &&
    claims &&
    claims.iss === "https://access.line.me" &&
    String(claims.aud) === channelId &&
    typeof claims.sub === "string" &&
    /^U[a-fA-F0-9]{32}$/.test(claims.sub) &&
    Number.isFinite(claims.exp) &&
    claims.exp > nowSeconds;

  if (!valid) {
    throw new AppError(
      401,
      "INVALID_LINE_ID_TOKEN",
      "LINE認証の有効期限が切れているか、認証情報が正しくありません。LINEから開き直してください。"
    );
  }
  return claims;
}

async function issueSessionToken(session, env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    sub: session.subject,
    facility_id: session.facilityId,
    actor_type: session.actorType,
    actor_id: session.actorId,
    role: session.role,
    iat: now,
    exp: now + getTokenTtlSeconds(env),
    jti: crypto.randomUUID(),
  };
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const headerPart = base64UrlEncodeText(JSON.stringify(header));
  const payloadPart = base64UrlEncodeText(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = await hmacSign(
    env.SESSION_SECRET,
    encoder.encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncodeBytes(signature)}`;
}

async function requireSession(request, env, allowedRoles) {
  assertBaseConfiguration(env, { requireSession: true });
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);

  if (!match) {
    throw new AppError(
      401,
      "AUTHENTICATION_REQUIRED",
      "ログインが必要です。もう一度ログインしてください。"
    );
  }

  const token = match[1];
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  let header;
  let payload;
  let signature;

  try {
    header = JSON.parse(base64UrlDecodeText(headerPart));
    payload = JSON.parse(base64UrlDecodeText(payloadPart));
    signature = base64UrlDecodeBytes(signaturePart);
  } catch {
    throw new AppError(
      401,
      "INVALID_SESSION",
      "ログイン情報が正しくありません。もう一度ログインしてください。"
    );
  }

  if (
    header?.alg !== "HS256" ||
    header?.typ !== "JWT" ||
    payload?.iss !== TOKEN_ISSUER ||
    payload?.aud !== TOKEN_AUDIENCE
  ) {
    throw new AppError(
      401,
      "INVALID_SESSION",
      "ログイン情報が正しくありません。もう一度ログインしてください。"
    );
  }

  const key = await importHmacKey(env.SESSION_SECRET, ["verify"]);
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(`${headerPart}.${payloadPart}`)
  );
  const now = Math.floor(Date.now() / 1000);

  if (
    !verified ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp) ||
    payload.iat > now + 60 ||
    payload.exp <= now ||
    payload.exp - payload.iat > MAX_TOKEN_TTL_SECONDS ||
    !isUuid(payload.facility_id) ||
    !["staff", "guardian"].includes(payload.actor_type) ||
    (
      payload.actor_id !== null &&
      !isUuid(payload.actor_id)
    ) ||
    typeof payload.sub !== "string" ||
    !isUuid(payload.jti)
  ) {
    throw new AppError(
      401,
      "SESSION_EXPIRED",
      "ログインの有効期限が切れました。もう一度ログインしてください。"
    );
  }

  if (!allowedRoles.includes(payload.role)) {
    throw new AppError(
      403,
      "ROLE_NOT_ALLOWED",
      "この操作を行う権限がありません。"
    );
  }

  return {
    subject: payload.sub,
    facilityId: payload.facility_id,
    actorType: payload.actor_type,
    actorId: payload.actor_id || null,
    role: payload.role,
    displayName: "",
    jti: payload.jti,
  };
}

async function writeAuditLog(env, entry) {
  const ip = entry.request.headers.get("cf-connecting-ip") || "";
  const ipHash = ip
    ? await shortHmac(env.SESSION_SECRET, `ip:${ip}`)
    : null;
  const userAgentSummary = sanitizeUserAgent(
    entry.request.headers.get("user-agent") || ""
  );

  await supabaseRequest(env, "shuttle_audit_logs", {
    method: "POST",
    body: {
      facility_id: entry.facilityId,
      actor_type: entry.actorType,
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      request_id: entry.requestId,
      ip_hash: ipHash,
      user_agent_summary: userAgentSummary || null,
    },
    prefer: "return=minimal",
  });
}

async function enforceRateLimit(
  request,
  env,
  scope,
  session = null
) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") {
    return;
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const actor = session?.subject || ip;
  const key = await shortHmac(
    env.SESSION_SECRET || "dpro-rate-limit-fallback",
    `${scope}:${actor}`
  );
  const result = await env.RATE_LIMITER.limit({ key });

  if (!result?.success) {
    throw new AppError(
      429,
      "RATE_LIMITED",
      "操作回数が多いため一時的に制限しています。少し待って再度お試しください。"
    );
  }
}

async function verifyPbkdf2Pin(pin, storedHash) {
  const parts = storedHash.split("$");

  if (
    parts.length !== 4 ||
    parts[0] !== "pbkdf2-sha256" ||
    !/^[0-9]+$/.test(parts[1])
  ) {
    return false;
  }

  const iterations = Number(parts[1]);
  if (
    !Number.isInteger(iterations) ||
    iterations < 100000 ||
    iterations > 600000
  ) {
    return false;
  }

  let salt;
  let expectedHash;
  try {
    salt = base64UrlDecodeBytes(parts[2]);
    expectedHash = base64UrlDecodeBytes(parts[3]);
  } catch {
    return false;
  }

  if (salt.byteLength < 16 || expectedHash.byteLength !== 32) {
    return false;
  }

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const actualBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    keyMaterial,
    256
  );
  return constantTimeBytesEqual(
    new Uint8Array(actualBits),
    expectedHash
  );
}

async function constantTimeTextEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return constantTimeBytesEqual(
    new Uint8Array(leftHash),
    new Uint8Array(rightHash)
  );
}

function constantTimeBytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function importHmacKey(secret, usages) {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    usages
  );
}

async function hmacSign(secret, data) {
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(signature);
}

async function shortHmac(secret, value) {
  const bytes = await hmacSign(secret, encoder.encode(value));
  return Array.from(bytes.slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlEncodeText(text) {
  return base64UrlEncodeBytes(encoder.encode(text));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    const chunk = bytes.subarray(offset, offset + 8192);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecodeBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid_base64url");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(
    value.replace(/-/g, "+").replace(/_/g, "/") + padding
  );
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64UrlDecodeText(value) {
  return decoder.decode(base64UrlDecodeBytes(value));
}

function getTokenTtlSeconds(env) {
  const configured = Number(env.SESSION_TTL_SECONDS);
  if (
    Number.isInteger(configured) &&
    configured >= MIN_TOKEN_TTL_SECONDS &&
    configured <= MAX_TOKEN_TTL_SECONDS
  ) {
    return configured;
  }
  return DEFAULT_TOKEN_TTL_SECONDS;
}

async function readJsonObject(request, options = {}) {
  const { allowEmpty = false } = options;
  const contentLength = Number(
    request.headers.get("content-length") || "0"
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_JSON_BYTES
  ) {
    throw new AppError(
      413,
      "REQUEST_TOO_LARGE",
      "送信内容が大きすぎます。入力内容を減らしてください。"
    );
  }

  const contentType = (
    request.headers.get("content-type") || ""
  ).split(";")[0].trim().toLowerCase();

  if (contentType !== "application/json") {
    throw new AppError(
      415,
      "JSON_REQUIRED",
      "送信形式が正しくありません。画面を再読み込みしてください。"
    );
  }

  const text = await request.text();
  if (!text.trim()) {
    if (allowEmpty) {
      return {};
    }
    throw new AppError(
      400,
      "EMPTY_REQUEST",
      "入力内容がありません。"
    );
  }
  if (encoder.encode(text).byteLength > MAX_JSON_BYTES) {
    throw new AppError(
      413,
      "REQUEST_TOO_LARGE",
      "送信内容が大きすぎます。入力内容を減らしてください。"
    );
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError(
      400,
      "INVALID_JSON",
      "送信内容を読み取れません。画面を再読み込みしてください。"
    );
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw new AppError(
      400,
      "JSON_OBJECT_REQUIRED",
      "入力内容の形式が正しくありません。"
    );
  }
  return body;
}

function requireFacilityCode(value) {
  const code = requireString(value, "事業所コード", 3, 64);
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(code)) {
    throw new AppError(
      400,
      "INVALID_FACILITY_CODE",
      "事業所コードの形式が正しくありません。"
    );
  }
  return code;
}

function requireString(value, label, minLength, maxLength) {
  if (typeof value !== "string") {
    throw new AppError(
      400,
      "REQUIRED_FIELD",
      `${label}を入力してください。`
    );
  }
  const normalized = value.trim();
  if (
    normalized.length < minLength ||
    normalized.length > maxLength
  ) {
    throw new AppError(
      400,
      "INVALID_FIELD_LENGTH",
      `${label}の文字数を確認してください。`
    );
  }
  return normalized;
}

function optionalString(value, label, minLength, maxLength) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireString(value, label, minLength, maxLength);
}

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sanitizeUserAgent(value) {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function normalizePath(pathname) {
  if (pathname === "/") {
    return "/";
  }
  return pathname.replace(/\/{2,}/g, "/").replace(/\/+$/g, "");
}

function parseAllowedOrigins(value) {
  if (typeof value !== "string") {
    return [];
  }
  const origins = [];
  for (const item of value.split(",")) {
    const candidate = item.trim();
    if (!candidate || candidate === "*") {
      continue;
    }
    try {
      const url = new URL(candidate);
      if (
        url.protocol === "https:" &&
        url.origin === candidate.replace(/\/$/, "")
      ) {
        origins.push(url.origin);
      }
    } catch {
      // 不正な値は許可元として採用しない。
    }
  }
  return [...new Set(origins)];
}

function resolveCorsOrigin(origin, allowedOriginsValue) {
  if (!origin) {
    return null;
  }
  let normalizedOrigin;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return null;
  }
  return parseAllowedOrigins(allowedOriginsValue).includes(
    normalizedOrigin
  )
    ? normalizedOrigin
    : null;
}

function responseHeaders(corsOrigin, requestId, preflight = false) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "x-request-id": requestId,
  });

  if (corsOrigin) {
    headers.set("access-control-allow-origin", corsOrigin);
    headers.set("vary", "Origin");
    if (preflight) {
      headers.set(
        "access-control-allow-methods",
        "GET, POST, OPTIONS"
      );
      headers.set(
        "access-control-allow-headers",
        "Authorization, Content-Type, Idempotency-Key"
      );
      headers.set("access-control-max-age", "600");
    }
  }
  return headers;
}

function successResponse(
  payload,
  status,
  corsOrigin,
  requestId
) {
  return new Response(
    JSON.stringify({
      ok: true,
      ...payload,
      requestId,
    }),
    {
      status,
      headers: responseHeaders(corsOrigin, requestId),
    }
  );
}

function errorResponse(
  status,
  code,
  message,
  corsOrigin,
  requestId
) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
      },
      requestId,
    }),
    {
      status,
      headers: responseHeaders(corsOrigin, requestId),
    }
  );
}

function routeNotFoundResponse(
  method,
  path,
  corsOrigin,
  requestId
) {
  const knownMethods = {
    "/health": ["GET"],
    "/v1/system/version": ["GET"],
    "/v1/auth/admin": ["POST"],
    "/v1/auth/staff": ["POST"],
    "/v1/auth/member": ["POST"],
    "/v1/auth/logout": ["POST"],
    "/v1/system/check": ["POST"],
  };

  if (knownMethods[path] && !knownMethods[path].includes(method)) {
    const response = errorResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "この操作方法には対応していません。",
      corsOrigin,
      requestId
    );
    response.headers.set("allow", knownMethods[path].join(", "));
    return response;
  }

  return errorResponse(
    404,
    "NOT_FOUND",
    "指定されたAPIが見つかりません。",
    corsOrigin,
    requestId
  );
}

function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError(
    500,
    "INTERNAL_ERROR",
    "処理中にエラーが発生しました。少し待って再度お試しください。",
    String(error?.stack || error?.message || error)
  );
}

function logError(error, requestId, request) {
  const entry = {
    level: error.status >= 500 ? "error" : "warn",
    requestId,
    method: request.method,
    path: new URL(request.url).pathname,
    status: error.status,
    code: error.code,
  };
  if (error.internalMessage) {
    entry.internal = error.internalMessage.slice(0, 500);
  }
  console.error(JSON.stringify(entry));
}
