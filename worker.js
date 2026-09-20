/*
 * DPRO 診療所送迎予約
 * Cloudflare Worker API
 *
 * STEP: SHUTTLE-8
 * Version: SHUTTLE-8-WORKER-20260729
 *
 * 公開ファイルへ秘密情報を記載しないこと。
 * SUPABASE_SECRET_KEY（推奨）または旧SUPABASE_SERVICE_ROLE_KEY、
 * SESSION_SECRET、管理コードはCloudflare WorkersのSecretsとする。
 */

const SERVICE_NAME = "DPRO Clinic Shuttle API";
const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R2-20260920";
const DATABASE_VERSION = "CLINIC-SHUTTLE-V2.1-DB-R2-20260920";
const SYSTEM_CODE = "CLINIC_SHUTTLE";
const SUPABASE_SCHEMA = "dpro_clinic_shuttle";
const DEMO_PREPARE_VERSION = "CLINIC-SHUTTLE-V2.1-DEMO-R1-20260920";
const DEMO_STAFF_PIN = "5678";
const DEMO_GUARDIAN_CODE = "DEMO-G01";
const DEMO_GUARDIAN_PIN = "0301";
const PIN_PBKDF2_ITERATIONS = 100000;
const TOKEN_ISSUER = "dpro-clinic-shuttle";
const TOKEN_AUDIENCE = "dpro-clinic-shuttle-api";
const MAX_JSON_BYTES = 64 * 1024;
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
  async fetch(request, env) {
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
              systemCode: SYSTEM_CODE,
              version: WORKER_VERSION,
              databaseSchema: SUPABASE_SCHEMA,
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
              systemCode: SYSTEM_CODE,
              workerVersion: WORKER_VERSION,
              databaseSchema: SUPABASE_SCHEMA,
              requiredDatabaseVersion: DATABASE_VERSION,
              apiStage: "CLINIC-SHUTTLE-V2.1-R2",
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

        case "POST /v1/auth/member/demo":
          await enforceRateLimit(request, env, "member-demo-login");
          return await handleDemoMemberLogin(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/member/link/request":
          await enforceRateLimit(request, env, "member-link-request");
          return await handleMemberLinkRequest(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/member/home":
          return await handleMemberHome(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/auth/refresh":
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

        case "POST /v1/system/check":
          return await handleSystemCheck(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/demo/prepare":
          return await handleDemoPrepare(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/staff":
          return await handleStaffList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/staff":
          return await handleStaffCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/vehicles":
          return await handleVehicleList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/vehicles":
          return await handleVehicleCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/riders":
          return await handleRiderList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/riders":
          return await handleRiderCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/guardians":
          return await handleGuardianList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/guardians":
          return await handleGuardianCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/guardian-rider-links":
          return await handleGuardianRiderLinkCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/guardian-rider-links":
          return await handleGuardianRiderLinkList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/locations":
          return await handleLocationList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/locations":
          return await handleLocationCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/regular-schedules":
          return await handleRegularScheduleList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/regular-schedules":
          return await handleRegularScheduleCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/runs":
          return await handleRunList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/runs/generate":
          return await handleRunGenerate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/change-requests":
          return await handleChangeRequestList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/change-requests":
          return await handleChangeRequestCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/reservations":
          return await handleReservationList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/reservations":
          return await handleReservationCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/contact-hub":
          return await handleContactHubList(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "POST /v1/contact-hub":
          return await handleContactHubCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/dashboard/today":
          return await handleTodayDashboard(
            request,
            env,
            corsOrigin,
            requestId
          );

        default:
          {
            const dynamicResponse = await handleDynamicRoute(
              request,
              env,
              corsOrigin,
              requestId,
              normalizePath(url.pathname)
            );
            if (dynamicResponse) {
              return dynamicResponse;
            }
          }
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
      "診療所コードまたは管理コードが正しくありません。"
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
    await verifyPbkdf2Pin(pin, staff.pin_hash, env.SESSION_SECRET);

  if (!valid) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "診療所コード、ログインID、暗証番号を確認してください。"
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
  const channelId = requireLineChannelId(env);

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
    channelId
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
      "このLINEアカウントは診療所での連携承認が完了していません。"
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

function requireLineChannelId(env) {
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
  return env.LINE_CHANNEL_ID;
}

async function handleDemoMemberLogin(
  request,
  env,
  corsOrigin,
  requestId
) {
  assertBaseConfiguration(env, { requireSession: true });
  const body = await readJsonObject(request);
  const facilityCode = requireFacilityCode(body.facilityCode);
  const guardianCode = requireCode(body.guardianCode, "家族番号");
  const pin = requireString(body.pin, "デモ暗証番号", 4, 4);
  if (!/^[0-9]{4}$/.test(pin)) {
    throw new AppError(
      400,
      "INVALID_DEMO_MEMBER_PIN",
      "デモ暗証番号は4桁の半角数字で入力してください。"
    );
  }

  const facility = await findFacilityByCode(env, facilityCode);
  assertFacilityEnvironment(facility, env);
  if (
    env.APP_ENVIRONMENT !== "demo" ||
    facility.environment !== "demo" ||
    env.PRODUCTION_GUARD !== "enabled"
  ) {
    throw new AppError(
      403,
      "DEMO_MEMBER_LOGIN_FORBIDDEN",
      "本番環境ではデモ家族ログインを利用できません。"
    );
  }

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,facility_id,guardian_code,full_name,phone_normalized,link_status,is_active"
  );
  params.set("facility_id", `eq.${facility.id}`);
  params.set("guardian_code", `eq.${guardianCode}`);
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
  const expectedPin = String(guardian?.phone_normalized || "").slice(-4);
  const valid =
    guardian &&
    guardian.guardian_code === DEMO_GUARDIAN_CODE &&
    expectedPin === DEMO_GUARDIAN_PIN &&
    await constantTimeTextEqual(pin, expectedPin);

  if (!valid) {
    throw new AppError(
      401,
      "INVALID_DEMO_MEMBER_CREDENTIALS",
      "家族番号またはデモ暗証番号が正しくありません。"
    );
  }

  const token = await issueSessionToken(
    {
      subject: `guardian:${guardian.id}`,
      facilityId: facility.id,
      actorType: "guardian",
      actorId: guardian.id,
      role: "guardian",
      displayName: guardian.full_name,
    },
    env
  );

  await writeAuditLog(env, {
    facilityId: facility.id,
    actorType: "guardian",
    actorId: guardian.id,
    action: "guardian_demo_login",
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
      demo: true,
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

async function handleMemberLinkRequest(
  request,
  env,
  corsOrigin,
  requestId
) {
  assertBaseConfiguration(env, { requireSession: true });
  const channelId = requireLineChannelId(env);
  const body = await readJsonObject(request);
  const facilityCode = requireFacilityCode(body.facilityCode);
  const guardianCode = requireCode(body.guardianCode, "家族番号");
  const phone = requirePhone(body.phone, "登録電話番号");
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
    channelId
  );

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,guardian_code,full_name,phone_normalized,line_user_id,link_status,is_active,updated_at"
  );
  params.set("facility_id", `eq.${facility.id}`);
  params.set("guardian_code", `eq.${guardianCode}`);
  params.set(
    "phone_normalized",
    `eq.${normalizeJapanesePhone(phone)}`
  );
  params.set("is_active", "eq.true");
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_guardians?${params.toString()}`
  );
  const guardian = Array.isArray(rows) ? rows[0] : null;

  if (!guardian) {
    throw new AppError(
      403,
      "MEMBER_IDENTITY_NOT_MATCHED",
      "家族番号と登録電話番号を確認できませんでした。診療所へお問い合わせください。"
    );
  }
  if (
    guardian.line_user_id &&
    guardian.line_user_id !== lineClaims.sub
  ) {
    throw new AppError(
      409,
      "MEMBER_ALREADY_LINKED",
      "別のLINEアカウントが連携済みです。診療所へ連携解除を依頼してください。"
    );
  }
  if (
    guardian.line_user_id === lineClaims.sub &&
    guardian.link_status === "approved"
  ) {
    return successResponse(
      {
        linkStatus: "approved",
        message: "LINE連携は承認済みです。もう一度ログインしてください。",
      },
      200,
      corsOrigin,
      requestId
    );
  }

  const duplicateParams = new URLSearchParams();
  duplicateParams.set("select", "id");
  duplicateParams.set("facility_id", `eq.${facility.id}`);
  duplicateParams.set("line_user_id", `eq.${lineClaims.sub}`);
  duplicateParams.set("id", `neq.${guardian.id}`);
  duplicateParams.set("limit", "1");
  const duplicateRows = await supabaseRequest(
    env,
    `shuttle_guardians?${duplicateParams.toString()}`
  );
  if (Array.isArray(duplicateRows) && duplicateRows[0]) {
    throw new AppError(
      409,
      "LINE_ACCOUNT_ALREADY_USED",
      "このLINEアカウントは別の家族情報と連携済みです。診療所へお問い合わせください。"
    );
  }

  const updateParams = new URLSearchParams();
  updateParams.set("id", `eq.${guardian.id}`);
  updateParams.set("facility_id", `eq.${facility.id}`);
  updateParams.set("updated_at", `eq.${guardian.updated_at}`);
  const updatedRows = await supabaseRequest(
    env,
    `shuttle_guardians?${updateParams.toString()}`,
    {
      method: "PATCH",
      body: {
        line_user_id: lineClaims.sub,
        link_status: "pending",
      },
      prefer: "return=representation",
    }
  );
  const updated = Array.isArray(updatedRows) ? updatedRows[0] : null;
  if (!updated) {
    throw staleUpdateError();
  }

  await writeAuditLog(env, {
    facilityId: facility.id,
    actorType: "guardian",
    actorId: guardian.id,
    action: "request_line_link",
    entityType: "guardian",
    entityId: guardian.id,
    requestId,
    request,
  });

  return successResponse(
    {
      linkStatus: "pending",
      message: "LINE連携を申請しました。診療所の承認後に利用できます。",
    },
    202,
    corsOrigin,
    requestId
  );
}

async function handleMemberHome(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, ["guardian"]);
  await enforceRateLimit(request, env, "member-home", session);
  const url = new URL(request.url);
  const serviceDate = requireDate(
    url.searchParams.get("serviceDate") || jstDateString(new Date()),
    "送迎日"
  );
  const facility = await findFacilityById(env, session.facilityId);
  assertFacilityEnvironment(facility, env);

  const guardianParams = new URLSearchParams();
  guardianParams.set(
    "select",
    "id,guardian_code,full_name,relationship,link_status,is_active"
  );
  guardianParams.set("id", `eq.${session.actorId}`);
  guardianParams.set("facility_id", `eq.${session.facilityId}`);
  guardianParams.set("link_status", "eq.approved");
  guardianParams.set("is_active", "eq.true");
  guardianParams.set("limit", "1");
  const guardianRows = await supabaseRequest(
    env,
    `shuttle_guardians?${guardianParams.toString()}`
  );
  const guardian = Array.isArray(guardianRows)
    ? guardianRows[0]
    : null;
  if (!guardian) {
    throw new AppError(
      403,
      "MEMBER_LINK_NOT_APPROVED",
      "LINE連携の承認状態を確認できません。診療所へお問い合わせください。"
    );
  }

  const linkParams = new URLSearchParams();
  linkParams.set(
    "select",
    "id,rider_id,is_primary,can_view_schedule,can_request_change,approved_at"
  );
  linkParams.set("facility_id", `eq.${session.facilityId}`);
  linkParams.set("guardian_id", `eq.${session.actorId}`);
  linkParams.set("approved_at", "not.is.null");
  const linkRows = await supabaseRequest(
    env,
    `shuttle_guardian_rider_links?${linkParams.toString()}`
  );
  const links = Array.isArray(linkRows) ? linkRows : [];
  const riderIds = [...new Set(links.map((row) => row.rider_id))];
  if (riderIds.length === 0) {
    return successResponse(
      {
        member: publicMemberGuardian(guardian),
        facility: publicFacility(facility),
        serviceDate,
        riders: [],
        schedules: [],
        stops: [],
        changeRequests: [],
      },
      200,
      corsOrigin,
      requestId
    );
  }

  const riders = await fetchRowsByIds(
    env,
    "shuttle_riders",
    session.facilityId,
    riderIds,
    "id,rider_code,full_name,is_active"
  );
  const allowedRiderIds = riders
    .filter((row) => row.is_active)
    .map((row) => row.id);
  const viewableRiderIds = links
    .filter(
      (row) =>
        row.can_view_schedule &&
        allowedRiderIds.includes(row.rider_id)
    )
    .map((row) => row.rider_id);
  const riderById = new Map(riders.map((row) => [row.id, row]));
  const linkByRiderId = new Map(
    links.map((row) => [row.rider_id, row])
  );

  let schedules = [];
  if (viewableRiderIds.length > 0) {
    const dayOfWeek = new Date(
      `${serviceDate}T12:00:00+09:00`
    ).getUTCDay();
    const scheduleParams = new URLSearchParams();
    scheduleParams.set(
      "select",
      "id,rider_id,service_type,pickup_location_id,dropoff_location_id,scheduled_pickup_time,scheduled_dropoff_time,effective_from,effective_to,is_active"
    );
    scheduleParams.set("facility_id", `eq.${session.facilityId}`);
    scheduleParams.set(
      "rider_id",
      `in.(${viewableRiderIds.join(",")})`
    );
    scheduleParams.set("day_of_week", `eq.${dayOfWeek}`);
    scheduleParams.set("effective_from", `lte.${serviceDate}`);
    scheduleParams.set(
      "or",
      `(effective_to.is.null,effective_to.gte.${serviceDate})`
    );
    scheduleParams.set("is_active", "eq.true");
    scheduleParams.set("order", "scheduled_pickup_time.asc");
    const scheduleRows = await supabaseRequest(
      env,
      `shuttle_regular_schedules?${scheduleParams.toString()}`
    );
    schedules = Array.isArray(scheduleRows) ? scheduleRows : [];
  }

  const locationIds = [
    ...new Set(
      schedules.flatMap((row) => [
        row.pickup_location_id,
        row.dropoff_location_id,
      ])
    ),
  ].filter(Boolean);
  const locations = await fetchRowsByIds(
    env,
    "shuttle_locations",
    session.facilityId,
    locationIds,
    "id,location_type,location_name"
  );
  const locationById = new Map(
    locations.map((row) => [row.id, row])
  );

  let stops = [];
  if (viewableRiderIds.length > 0) {
    const rangeStart = new Date(
      `${serviceDate}T00:00:00+09:00`
    );
    const rangeEnd = new Date(rangeStart.getTime() + 86400000);
    const stopParams = new URLSearchParams();
    stopParams.set(
      "select",
      "id,run_id,rider_id,pickup_location_id,dropoff_location_id,planned_pickup_at,planned_dropoff_at,actual_boarded_at,actual_arrived_at,actual_handed_over_at,actual_completed_at,stop_status"
    );
    stopParams.set("facility_id", `eq.${session.facilityId}`);
    stopParams.set(
      "rider_id",
      `in.(${viewableRiderIds.join(",")})`
    );
    stopParams.set(
      "planned_pickup_at",
      `gte.${rangeStart.toISOString()}`
    );
    stopParams.append(
      "planned_pickup_at",
      `lt.${rangeEnd.toISOString()}`
    );
    stopParams.set("order", "planned_pickup_at.asc");
    const stopRows = await supabaseRequest(
      env,
      `shuttle_stops?${stopParams.toString()}`
    );
    stops = Array.isArray(stopRows) ? stopRows : [];
  }

  const runIds = [...new Set(stops.map((row) => row.run_id))];
  const runs = await fetchRowsByIds(
    env,
    "shuttle_runs",
    session.facilityId,
    runIds,
    "id,run_code,service_type,scheduled_start_at,scheduled_end_at,actual_start_at,actual_end_at,run_status"
  );
  const runById = new Map(runs.map((row) => [row.id, row]));

  const changeParams = new URLSearchParams();
  changeParams.set(
    "select",
    "id,rider_id,service_date,request_type,requested_changes,request_status,reviewed_at,review_notes,created_at,updated_at"
  );
  changeParams.set("facility_id", `eq.${session.facilityId}`);
  changeParams.set("guardian_id", `eq.${session.actorId}`);
  changeParams.set("service_date", `eq.${serviceDate}`);
  changeParams.set("order", "created_at.desc");
  const changeRows = await supabaseRequest(
    env,
    `shuttle_change_requests?${changeParams.toString()}`
  );

  return successResponse(
    {
      member: publicMemberGuardian(guardian),
      facility: publicFacility(facility),
      serviceDate,
      riders: allowedRiderIds.map((riderId) =>
        publicMemberRider(
          riderById.get(riderId),
          linkByRiderId.get(riderId)
        )
      ),
      schedules: schedules.map((row) =>
        publicMemberSchedule(
          row,
          riderById.get(row.rider_id),
          locationById
        )
      ),
      stops: stops.map((row) =>
        publicMemberStop(
          row,
          riderById.get(row.rider_id),
          runById.get(row.run_id),
          locationById
        )
      ),
      changeRequests: (changeRows || []).map(
        publicMemberChangeRequest
      ),
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleRefreshSession(
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
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "driver",
    "attendant",
    "reception",
    "guardian",
  ]);

  if (session.actorType === "staff" && isUuid(session.actorId)) {
    await revokeStaffSession(
      env,
      session.facilityId,
      session.actorId,
      session.jti,
      "logout"
    );
  }

  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "logout",
    entityType: "session",
    entityId: session.jti,
    requestId,
    request,
    newData: {
      serverRevoked: session.actorType === "staff" && isUuid(session.actorId),
      reason: "logout",
    },
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
    phoneD,
    demoStatus,
    demoMemberStatus,
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
    supabaseRpc(env, "shuttle_normalize_phone", {
      p_phone: "0081 90 1234 5678",
    }),
    facility.environment === "demo"
      ? supabaseRpc(env, "shuttle_demo_status", {
          p_facility_id: facility.id,
        })
      : Promise.resolve(null),
    facility.environment === "demo"
      ? getDemoMemberStatus(env, facility.id)
      : Promise.resolve(null),
  ]);

  const settings = Array.isArray(settingsRows)
    ? settingsRows[0]
    : null;
const phoneNormalizationOk =
  phoneA === "09012345678" &&
  phoneB === phoneA &&
  phoneC === phoneA &&
  phoneD === phoneA;
const workerPhoneValues = [
  normalizeJapanesePhone("090-1234-5678"),
  normalizeJapanesePhone("090 1234 5678"),
  normalizeJapanesePhone("０９０ １２３４ ５６７８"),
  normalizeJapanesePhone("+81 90 1234 5678"),
  normalizeJapanesePhone("0081 90 1234 5678"),
];
const workerPhoneNormalizationOk = workerPhoneValues.every(
  (value) => value === "09012345678"
);
  const databaseOk =
    databaseCheck &&
    databaseCheck.ok === true &&
    databaseCheck.version === DATABASE_VERSION;
  const facilitySettingsOk =
    settings &&
    settings.schedule_step_minutes === 30;
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
  const demoDataOk =
    facility.environment !== "demo" ||
    (
      demoStatus &&
      demoStatus.ok === true &&
      demoStatus.prepared === true
    );
  const demoMemberOk =
    facility.environment !== "demo" ||
    demoMemberStatus?.ready === true;
  const memberAuthenticationOk =
    facility.environment === "demo"
      ? demoMemberOk
      : lineConfigured;
  const requiredOk =
    databaseOk &&
    facilitySettingsOk &&
    phoneNormalizationOk &&
    workerPhoneNormalizationOk &&
    productionGuardOk &&
    demoDataOk &&
    memberAuthenticationOk;

  return successResponse(
    {
      systemCheck: {
        ok: requiredOk,
        stage: "CLINIC-SHUTTLE-V2.1-R2",
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
  status:
    phoneNormalizationOk && workerPhoneNormalizationOk
      ? "pass"
      : "fail",
  normalizedValue: phoneNormalizationOk ? phoneA : null,
  workerNormalizedValue:
    workerPhoneNormalizationOk ? workerPhoneValues[4] : null,
  zeroZero81Checked: true,
},
        productionGuard: {
          status: productionGuardOk ? "pass" : "fail",
        },
        demoData: {
          status:
            facility.environment !== "demo"
              ? "not_applicable"
              : demoDataOk
                ? "pass"
                : "pending",
          version: DEMO_PREPARE_VERSION,
          prepared:
            facility.environment === "demo"
              ? demoStatus?.prepared === true
              : null,
          duplicateSafe:
            facility.environment === "demo"
              ? demoStatus?.duplicate_safe === true
              : null,
          staffCount: demoStatus?.staff_count ?? null,
          vehicleCount: demoStatus?.vehicle_count ?? null,
          riderCount: demoStatus?.rider_count ?? null,
          locationCount: demoStatus?.location_count ?? null,
          scheduleCount: demoStatus?.schedule_count ?? null,
          dispatcherLoginReady:
            demoStatus?.dispatcher_login_ready ?? null,
          memberLoginReady:
            facility.environment === "demo"
              ? demoMemberOk
              : null,
          guardianCount:
            demoMemberStatus?.guardianCount ?? null,
          guardianLinkCount:
            demoMemberStatus?.linkCount ?? null,
        },
        browserCors: {
          status: corsConfigured ? "pass" : "pending",
          requiredBeforeFrontendPublication: true,
        },
        lineMemberAuthentication: {
          status: lineConfigured ? "pass" : "pending",
          configured: lineConfigured,
          requiredAtStep:
            facility.environment === "production"
              ? "本番導入前"
              : "LIFF実機確認時",
          demoPortalReady:
            facility.environment === "demo"
              ? demoMemberOk
              : null,
        },
        rateLimiting: {
          status: rateLimitConfigured ? "pass" : "recommended",
          bindingName: "RATE_LIMITER",
        },
        operationalApi: {
          status: "pass",
          riderManagement: true,
          guardianManagement: true,
          memberPortal: true,
          secureLineLinkRequest: true,
          regularSchedules: true,
          dailyRuns: true,
          staffAssignments: true,
          rideEvents: true,
          changeRequests: true,
          optimisticLocking: true,
          idempotencyKeys: true,
          demoPrepare: true,
          staffSessionRevocation: true,
        },
      },
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleDemoPrepare(
  request,
  env,
  corsOrigin,
  requestId
) {
  assertBaseConfiguration(env, { requireSession: true });
  const body = await readJsonObject(request, { allowEmpty: true });
  const session = await requireSession(request, env, ["admin"]);
  await enforceRateLimit(request, env, "demo-prepare", session);

  const facility = await findFacilityById(env, session.facilityId);
  assertFacilityEnvironment(facility, env);

  if (
    env.PRODUCTION_GUARD !== "enabled" ||
    env.APP_ENVIRONMENT !== "demo" ||
    facility.environment !== "demo"
  ) {
    throw new AppError(
      403,
      "DEMO_PREPARE_FORBIDDEN",
      "本番診療所ではデモデータを準備できません。"
    );
  }

  return await runIdempotentOperation(
    request,
    env,
    session,
    "demo-prepare",
    body,
    corsOrigin,
    requestId,
    async () => {
      const pinHash = await hashPbkdf2Pin(DEMO_STAFF_PIN, env.SESSION_SECRET);
      const demoData = await supabaseRpc(
        env,
        "shuttle_demo_prepare",
        {
          p_facility_id: facility.id,
          p_staff_pin_hash: pinHash,
        }
      );

      if (
        !demoData ||
        demoData.ok !== true ||
        demoData.prepared !== true
      ) {
        throw new AppError(
          502,
          "DEMO_PREPARE_INCOMPLETE",
          "デモデータの準備結果を確認できませんでした。再度お試しください。"
        );
      }
      const demoMember = await ensureDemoMember(
        env,
        facility.id
      );

      await writeAuditLog(env, {
        facilityId: facility.id,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "demo_prepare_api",
        entityType: "facility",
        entityId: facility.id,
        requestId,
        request,
        newData: {
          version: DEMO_PREPARE_VERSION,
          duplicateSafe: true,
        },
      });

      return {
        status: 200,
        payload: {
          demoData: {
            version:
              demoData.version ||
              DEMO_PREPARE_VERSION,
            prepared: true,
            duplicateSafe:
              demoData.duplicate_safe === true,
            counts: demoData.counts || {},
          },
          demoStaff: {
            loginId: "demo.dispatcher",
            pin: DEMO_STAFF_PIN,
            role: "dispatcher",
          },
          demoMember: {
            guardianCode: demoMember.guardian.guardian_code,
            pin: DEMO_GUARDIAN_PIN,
            fullName: demoMember.guardian.full_name,
            riderName: demoMember.rider.full_name,
          },
        },
      };
    }
  );
}

async function ensureDemoMember(env, facilityId) {
  const riderParams = new URLSearchParams();
  riderParams.set("select", "id,rider_code,full_name");
  riderParams.set("facility_id", `eq.${facilityId}`);
  riderParams.set("rider_code", "eq.DEMO-R01");
  riderParams.set("is_active", "eq.true");
  riderParams.set("limit", "1");
  const riderRows = await supabaseRequest(
    env,
    `shuttle_riders?${riderParams.toString()}`
  );
  const rider = Array.isArray(riderRows) ? riderRows[0] : null;
  if (!rider) {
    throw new AppError(
      502,
      "DEMO_MEMBER_RIDER_MISSING",
      "デモ家族に紐づける患者を確認できませんでした。"
    );
  }

  const guardianParams = new URLSearchParams();
  guardianParams.set(
    "select",
    "id,guardian_code,full_name,phone,phone_normalized,line_user_id,link_status,is_active"
  );
  guardianParams.set("facility_id", `eq.${facilityId}`);
  guardianParams.set("guardian_code", `eq.${DEMO_GUARDIAN_CODE}`);
  guardianParams.set("limit", "1");
  const guardianRows = await supabaseRequest(
    env,
    `shuttle_guardians?${guardianParams.toString()}`
  );
  let guardian = Array.isArray(guardianRows)
    ? guardianRows[0]
    : null;

  if (!guardian) {
    const inserted = await supabaseRequest(
      env,
      "shuttle_guardians",
      {
        method: "POST",
        body: {
          facility_id: facilityId,
          guardian_code: DEMO_GUARDIAN_CODE,
          full_name: "デモ 家族A",
          relationship: "家族",
          phone: "090-0000-0301",
          link_status: "approved",
          notification_preferences: {},
          is_active: true,
        },
        prefer: "return=representation",
      }
    );
    guardian = Array.isArray(inserted) ? inserted[0] : null;
  } else {
    const patchParams = new URLSearchParams();
    patchParams.set("id", `eq.${guardian.id}`);
    patchParams.set("facility_id", `eq.${facilityId}`);
    const updated = await supabaseRequest(
      env,
      `shuttle_guardians?${patchParams.toString()}`,
      {
        method: "PATCH",
        body: {
          full_name: "デモ 家族A",
          relationship: "家族",
          phone: "090-0000-0301",
          link_status: "approved",
          is_active: true,
        },
        prefer: "return=representation",
      }
    );
    guardian = Array.isArray(updated) ? updated[0] : guardian;
  }
  if (!guardian) {
    throw new AppError(
      502,
      "DEMO_MEMBER_GUARDIAN_MISSING",
      "デモ家族情報を準備できませんでした。"
    );
  }

  const linkParams = new URLSearchParams();
  linkParams.set("select", "id,approved_at");
  linkParams.set("facility_id", `eq.${facilityId}`);
  linkParams.set("guardian_id", `eq.${guardian.id}`);
  linkParams.set("rider_id", `eq.${rider.id}`);
  linkParams.set("limit", "1");
  const linkRows = await supabaseRequest(
    env,
    `shuttle_guardian_rider_links?${linkParams.toString()}`
  );
  let link = Array.isArray(linkRows) ? linkRows[0] : null;
  if (!link) {
    const inserted = await supabaseRequest(
      env,
      "shuttle_guardian_rider_links",
      {
        method: "POST",
        body: {
          facility_id: facilityId,
          guardian_id: guardian.id,
          rider_id: rider.id,
          is_primary: true,
          can_view_schedule: true,
          can_request_change: true,
          approved_at: new Date().toISOString(),
          approved_by_staff_id: null,
        },
        prefer: "return=representation",
      }
    );
    link = Array.isArray(inserted) ? inserted[0] : null;
  } else {
    const patchParams = new URLSearchParams();
    patchParams.set("id", `eq.${link.id}`);
    patchParams.set("facility_id", `eq.${facilityId}`);
    const updated = await supabaseRequest(
      env,
      `shuttle_guardian_rider_links?${patchParams.toString()}`,
      {
        method: "PATCH",
        body: {
          is_primary: true,
          can_view_schedule: true,
          can_request_change: true,
          approved_at: link.approved_at || new Date().toISOString(),
        },
        prefer: "return=representation",
      }
    );
    link = Array.isArray(updated) ? updated[0] : link;
  }
  if (!link) {
    throw new AppError(
      502,
      "DEMO_MEMBER_LINK_MISSING",
      "デモ家族と患者を紐づけできませんでした。"
    );
  }
  return { guardian, rider, link };
}

async function getDemoMemberStatus(env, facilityId) {
  const guardianParams = new URLSearchParams();
  guardianParams.set("select", "id");
  guardianParams.set("facility_id", `eq.${facilityId}`);
  guardianParams.set("guardian_code", `eq.${DEMO_GUARDIAN_CODE}`);
  guardianParams.set("link_status", "eq.approved");
  guardianParams.set("is_active", "eq.true");
  const guardianRows = await supabaseRequest(
    env,
    `shuttle_guardians?${guardianParams.toString()}`
  );
  const guardian = Array.isArray(guardianRows)
    ? guardianRows[0]
    : null;
  if (!guardian) {
    return { ready: false, guardianCount: 0, linkCount: 0 };
  }
  const linkParams = new URLSearchParams();
  linkParams.set("select", "id");
  linkParams.set("facility_id", `eq.${facilityId}`);
  linkParams.set("guardian_id", `eq.${guardian.id}`);
  linkParams.set("approved_at", "not.is.null");
  const linkRows = await supabaseRequest(
    env,
    `shuttle_guardian_rider_links?${linkParams.toString()}`
  );
  const linkCount = Array.isArray(linkRows) ? linkRows.length : 0;
  return {
    ready: linkCount > 0,
    guardianCount: 1,
    linkCount,
  };
}

async function handleDynamicRoute(
  request,
  env,
  corsOrigin,
  requestId,
  path
) {
  const method = request.method.toUpperCase();
  const uuidPattern =
    "([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";
  const routes = [
    {
      method: "POST",
      pattern: new RegExp(`^/v1/staff/${uuidPattern}/soft-delete$`, "i"),
      handler: handleStaffSoftDelete,
    },
    {
      method: "POST",
      pattern: new RegExp(`^/v1/vehicles/${uuidPattern}/soft-delete$`, "i"),
      handler: handleVehicleSoftDelete,
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/reservations/${uuidPattern}$`, "i"),
      handler: handleReservationUpdate,
    },
    {
      method: "POST",
      pattern: new RegExp(`^/v1/reservations/${uuidPattern}/cancel$`, "i"),
      handler: handleReservationCancel,
    },
    {
      method: "POST",
      pattern: new RegExp(`^/v1/reservations/${uuidPattern}/return-ready$`, "i"),
      handler: handleReservationReturnReady,
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/staff/${uuidPattern}$`, "i"),
      handler: handleStaffUpdate,
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/vehicles/${uuidPattern}$`, "i"),
      handler: handleVehicleUpdate,
    },
    {
      method: "GET",
      pattern: new RegExp(`^/v1/riders/${uuidPattern}$`, "i"),
      handler: handleRiderDetail,
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/riders/${uuidPattern}$`, "i"),
      handler: handleRiderUpdate,
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/guardians/${uuidPattern}$`, "i"),
      handler: handleGuardianUpdate,
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/locations/${uuidPattern}$`, "i"),
      handler: handleLocationUpdate,
    },
    {
      method: "PATCH",
      pattern: new RegExp(
        `^/v1/regular-schedules/${uuidPattern}$`,
        "i"
      ),
      handler: handleRegularScheduleUpdate,
    },
    {
      method: "GET",
      pattern: new RegExp(`^/v1/runs/${uuidPattern}$`, "i"),
      handler: handleRunDetail,
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/runs/${uuidPattern}$`, "i"),
      handler: handleRunUpdate,
    },
    {
      method: "POST",
      pattern: new RegExp(
        `^/v1/runs/${uuidPattern}/staff$`,
        "i"
      ),
      handler: handleRunStaffAssign,
    },
    {
      method: "POST",
      pattern: new RegExp(
        `^/v1/runs/${uuidPattern}/staff/remove$`,
        "i"
      ),
      handler: handleRunStaffRemove,
    },
    {
      method: "POST",
      pattern: new RegExp(
        `^/v1/stops/${uuidPattern}/events$`,
        "i"
      ),
      handler: handleRideEvent,
    },
    {
      method: "POST",
      pattern: new RegExp(
        `^/v1/stops/${uuidPattern}/correct$`,
        "i"
      ),
      handler: handleStopStatusCorrection,
    },
    {
      method: "POST",
      pattern: new RegExp(
        `^/v1/change-requests/${uuidPattern}/review$`,
        "i"
      ),
      handler: handleChangeRequestReview,
    },
  ];

  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match && route.method === method) {
      return await route.handler(
        request,
        env,
        corsOrigin,
        requestId,
        match[1]
      );
    }
  }
  return null;
}

async function handleStaffList(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
  ]);
  await enforceRateLimit(request, env, "staff-list", session);

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,staff_code,full_name,staff_role,phone,login_id,is_active,last_login_at,updated_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("deleted_at", "is.null");
  params.set("order", "staff_role.asc,full_name.asc");
  params.set("limit", String(getQueryLimit(request, 100, 200)));
  const rows = await supabaseRequest(
    env,
    `shuttle_staff?${params.toString()}`
  );

  return successResponse(
    {
      staff: (rows || []).map(publicStaff),
      count: Array.isArray(rows) ? rows.length : 0,
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleStaffCreate(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, ["admin"]);
  await enforceRateLimit(request, env, "staff-create", session);
  const body = await readJsonObject(request);
  const staffCode = requireCode(body.staffCode, "スタッフコード");
  const fullName = requireString(body.fullName, "氏名", 1, 100);
  const staffRole = requireEnum(
    body.staffRole,
    "権限",
    ["admin", "dispatcher", "driver", "attendant", "reception"]
  );
  const phone = optionalPhone(body.phone, "電話番号");
  const loginId = optionalLoginId(body.loginId);
  const pin = optionalPin(body.pin);
  if ((loginId && !pin) || (!loginId && pin)) {
    throw new AppError(
      400,
      "LOGIN_PAIR_REQUIRED",
      "ログインIDと暗証番号は両方入力してください。"
    );
  }
  const isActive = optionalBoolean(body.isActive, true, "有効状態");

  return await runIdempotentOperation(
    request,
    env,
    session,
    "staff-create",
    body,
    corsOrigin,
    requestId,
    async () => {
      const rows = await supabaseRequest(env, "shuttle_staff", {
        method: "POST",
        body: {
          facility_id: session.facilityId,
          staff_code: staffCode,
          full_name: fullName,
          staff_role: staffRole,
          phone,
          login_id: loginId,
          pin_hash: pin ? await hashPbkdf2Pin(pin, env.SESSION_SECRET) : null,
          is_active: isActive,
        },
        prefer: "return=representation",
      });
      const staff = Array.isArray(rows) ? rows[0] : null;
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "create_staff",
        entityType: "staff",
        entityId: staff?.id || null,
        requestId,
        request,
      });
      return {
        status: 201,
        payload: { staff: publicStaff(staff) },
      };
    }
  );
}

async function handleStaffUpdate(
  request,
  env,
  corsOrigin,
  requestId,
  staffId
) {
  const session = await requireSession(request, env, ["admin"]);
  await enforceRateLimit(request, env, "staff-update", session);
  const body = await readJsonObject(request);
  const expectedUpdatedAt = requireIsoTimestamp(
    body.expectedUpdatedAt,
    "更新前日時"
  );
  const changes = {};

  if (body.fullName !== undefined) {
    changes.full_name = requireString(body.fullName, "氏名", 1, 100);
  }
  if (body.staffRole !== undefined) {
    changes.staff_role = requireEnum(
      body.staffRole,
      "権限",
      ["admin", "dispatcher", "driver", "attendant", "reception"]
    );
  }
  if (body.phone !== undefined) {
    changes.phone = optionalPhone(body.phone, "電話番号");
  }
  if (body.loginId !== undefined) {
    changes.login_id = optionalLoginId(body.loginId);
  }
  if (body.pin !== undefined) {
    const pin = optionalPin(body.pin);
    changes.pin_hash = pin ? await hashPbkdf2Pin(pin, env.SESSION_SECRET) : null;
  }
  if (body.isActive !== undefined) {
    changes.is_active = requireBoolean(body.isActive, "有効状態");
  }
  assertHasChanges(changes);

  const params = new URLSearchParams();
  params.set("id", `eq.${staffId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("updated_at", `eq.${expectedUpdatedAt}`);
  const rows = await supabaseRequest(
    env,
    `shuttle_staff?${params.toString()}`,
    {
      method: "PATCH",
      body: changes,
      prefer: "return=representation",
    }
  );
const staff = Array.isArray(rows) ? rows[0] : null;
if (!staff) {
  throw staleUpdateError();
}
const authorityChanged = [
  "staff_role",
  "is_active",
  "login_id",
  "pin_hash",
].some((key) => Object.prototype.hasOwnProperty.call(changes, key));
if (authorityChanged) {
  await revokeStaffSessionsForAuthorityChange(
    env,
    session.facilityId,
    staffId
  );
  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "staff_authority_changed",
    entityType: "staff",
    entityId: staffId,
    requestId,
    request,
    newData: {
      staffRole: staff.staff_role,
      isActive: staff.is_active,
      activeSessionsRevoked: true,
    },
  });
}
await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "update_staff",
    entityType: "staff",
    entityId: staffId,
    requestId,
    request,
  });
  return successResponse(
    { staff: publicStaff(staff) },
    200,
    corsOrigin,
    requestId
  );
}

async function handleVehicleList(
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
  ]);
  await enforceRateLimit(request, env, "vehicle-list", session);
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,vehicle_code,vehicle_name,plate_number,passenger_capacity,wheelchair_capacity,has_lift,vehicle_status,is_active,updated_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("deleted_at", "is.null");
  params.set("order", "vehicle_name.asc");
  params.set("limit", "200");
  const rows = await supabaseRequest(
    env,
    `shuttle_vehicles?${params.toString()}`
  );
  return successResponse(
    {
      vehicles: (rows || []).map(publicVehicle),
      count: Array.isArray(rows) ? rows.length : 0,
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleVehicleCreate(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, ["admin"]);
  await enforceRateLimit(request, env, "vehicle-create", session);
  const body = await readJsonObject(request);
  const vehicleCode = requireCode(body.vehicleCode, "車両コード");
  const vehicleName = requireString(body.vehicleName, "車両名", 1, 100);
  return await runIdempotentOperation(
    request,
    env,
    session,
    "vehicle-create",
    body,
    corsOrigin,
    requestId,
    async () => {
      const rows = await supabaseRequest(env, "shuttle_vehicles", {
        method: "POST",
        body: {
          facility_id: session.facilityId,
          vehicle_code: vehicleCode,
          vehicle_name: vehicleName,
          plate_number: optionalString(
            body.plateNumber,
            "ナンバー",
            1,
            50
          ),
          passenger_capacity: requireInteger(
            body.passengerCapacity ?? 4,
            "通常座席数",
            0,
            100
          ),
          wheelchair_capacity: requireInteger(
            body.wheelchairCapacity ?? 0,
            "車いす定員",
            0,
            20
          ),
          has_lift: optionalBoolean(
            body.hasLift,
            false,
            "リフト装備"
          ),
          vehicle_status: optionalEnum(
            body.vehicleStatus,
            "車両状態",
            ["available", "maintenance", "unavailable"],
            "available"
          ),
          is_active: optionalBoolean(body.isActive, true, "有効状態"),
        },
        prefer: "return=representation",
      });
      const vehicle = Array.isArray(rows) ? rows[0] : null;
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "create_vehicle",
        entityType: "vehicle",
        entityId: vehicle?.id || null,
        requestId,
        request,
      });
      return {
        status: 201,
        payload: { vehicle: publicVehicle(vehicle) },
      };
    }
  );
}

async function handleVehicleUpdate(
  request,
  env,
  corsOrigin,
  requestId,
  vehicleId
) {
  const session = await requireSession(request, env, ["admin"]);
  await enforceRateLimit(request, env, "vehicle-update", session);
  const body = await readJsonObject(request);
  const expectedUpdatedAt = requireIsoTimestamp(
    body.expectedUpdatedAt,
    "更新前日時"
  );
  const changes = {};
  if (body.vehicleName !== undefined) {
    changes.vehicle_name = requireString(
      body.vehicleName,
      "車両名",
      1,
      100
    );
  }
  if (body.plateNumber !== undefined) {
    changes.plate_number = optionalString(
      body.plateNumber,
      "ナンバー",
      1,
      50
    );
  }
  if (body.passengerCapacity !== undefined) {
    changes.passenger_capacity = requireInteger(
      body.passengerCapacity,
      "通常座席数",
      0,
      100
    );
  }
  if (body.wheelchairCapacity !== undefined) {
    changes.wheelchair_capacity = requireInteger(
      body.wheelchairCapacity,
      "車いす定員",
      0,
      20
    );
  }
  if (body.hasLift !== undefined) {
    changes.has_lift = requireBoolean(body.hasLift, "リフト装備");
  }
  if (body.vehicleStatus !== undefined) {
    changes.vehicle_status = requireEnum(
      body.vehicleStatus,
      "車両状態",
      ["available", "maintenance", "unavailable"]
    );
  }
  if (body.isActive !== undefined) {
    changes.is_active = requireBoolean(body.isActive, "有効状態");
  }
  assertHasChanges(changes);
  const params = new URLSearchParams();
  params.set("id", `eq.${vehicleId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("updated_at", `eq.${expectedUpdatedAt}`);
  const rows = await supabaseRequest(
    env,
    `shuttle_vehicles?${params.toString()}`,
    {
      method: "PATCH",
      body: changes,
      prefer: "return=representation",
    }
  );
  const vehicle = Array.isArray(rows) ? rows[0] : null;
  if (!vehicle) {
    throw staleUpdateError();
  }
  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "update_vehicle",
    entityType: "vehicle",
    entityId: vehicleId,
    requestId,
    request,
  });
  return successResponse(
    { vehicle: publicVehicle(vehicle) },
    200,
    corsOrigin,
    requestId
  );
}

async function handleRiderList(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "rider-list", session);
  const url = new URL(request.url);
  const query = optionalSearchQuery(url.searchParams.get("query"));
  const explicitAll = url.searchParams.get("all") === "1";

  if (!query && !explicitAll) {
    return successResponse(
      {
        riders: [],
        count: 0,
        queryRequired: true,
        explicitAllAvailable: true,
        explicitAllLimit: 100,
        message: "患者を検索してください。全件表示は「全件表示」を明示した場合のみ最大100件まで表示します。",
      },
      200,
      corsOrigin,
      requestId
    );
  }

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,rider_code,full_name,full_name_kana,phone,phone_normalized,transport_support_level,uses_wheelchair,requires_handover,transport_notes,emergency_contact_name,emergency_contact_phone,is_active,created_at,updated_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("deleted_at", "is.null");
  params.set("order", "full_name.asc");
  params.set(
    "limit",
    String(explicitAll ? getQueryLimit(request, 100, 100) : getQueryLimit(request, 50, 100))
  );

  if (query) {
    const phone = normalizeJapanesePhone(query);
    if (phone) {
      params.set("phone_normalized", `eq.${phone}`);
    } else {
      const safe = escapePostgrestSearch(query);
      params.set(
        "or",
        `(full_name.ilike.*${safe}*,full_name_kana.ilike.*${safe}*,rider_code.ilike.*${safe}*)`
      );
    }
  }
  const rows = await supabaseRequest(
    env,
    `shuttle_riders?${params.toString()}`
  );
  return successResponse(
    {
      riders: (rows || []).map(publicRider),
      count: Array.isArray(rows) ? rows.length : 0,
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleRiderDetail(
  request,
  env,
  corsOrigin,
  requestId,
  riderId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "driver",
    "attendant",
    "reception",
  ]);
  await enforceRateLimit(request, env, "rider-detail", session);
  const rider = await findRiderById(env, session.facilityId, riderId);

  const locationParams = new URLSearchParams();
  locationParams.set(
    "select",
    "id,location_type,location_name,postal_code,address_line1,address_line2,access_notes,is_default_pickup,is_default_dropoff,is_active,updated_at"
  );
  locationParams.set("facility_id", `eq.${session.facilityId}`);
  locationParams.set("rider_id", `eq.${riderId}`);
  locationParams.set("is_active", "eq.true");
  locationParams.set("order", "location_name.asc");

  const linkParams = new URLSearchParams();
  linkParams.set(
    "select",
    "id,guardian_id,is_primary,can_view_schedule,can_request_change,approved_at"
  );
  linkParams.set("facility_id", `eq.${session.facilityId}`);
  linkParams.set("rider_id", `eq.${riderId}`);

  const [locations, links] = await Promise.all([
    supabaseRequest(
      env,
      `shuttle_locations?${locationParams.toString()}`
    ),
    supabaseRequest(
      env,
      `shuttle_guardian_rider_links?${linkParams.toString()}`
    ),
  ]);

  let guardians = [];
  if (Array.isArray(links) && links.length > 0) {
    const guardianIds = links.map((link) => link.guardian_id);
    const guardianParams = new URLSearchParams();
    guardianParams.set(
      "select",
      "id,guardian_code,full_name,relationship,phone,link_status,is_active,updated_at"
    );
    guardianParams.set("facility_id", `eq.${session.facilityId}`);
    guardianParams.set("id", `in.(${guardianIds.join(",")})`);
    const guardianRows = await supabaseRequest(
      env,
      `shuttle_guardians?${guardianParams.toString()}`
    );
    const linkByGuardian = new Map(
      links.map((link) => [link.guardian_id, link])
    );
    guardians = (guardianRows || []).map((row) => ({
      ...publicGuardian(row),
      link: publicGuardianLink(linkByGuardian.get(row.id)),
    }));
  }

  return successResponse(
    {
      rider: publicRider(rider),
      locations: (locations || []).map(publicLocation),
      guardians,
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleRiderCreate(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "rider-create", session);
  const body = await readJsonObject(request);
  const riderCode = requireCode(body.riderCode, "患者番号");
  const fullName = requireString(body.fullName, "患者氏名", 1, 100);
  const fullNameKana = optionalString(
    body.fullNameKana,
    "ふりがな",
    1,
    100
  );
  const phone = optionalPhone(body.phone, "電話番号");
  const transportSupportLevel = optionalEnum(
    body.transportSupportLevel,
    "移動支援区分",
    [
      "independent",
      "supervision",
      "partial_assist",
      "full_assist",
      "wheelchair",
    ],
    "independent"
  );
  const usesWheelchair = optionalBoolean(
    body.usesWheelchair,
    transportSupportLevel === "wheelchair",
    "車いす利用"
  );
  const requiresHandover = optionalBoolean(
    body.requiresHandover,
    false,
    "引渡し確認"
  );
  const transportNotes = optionalString(
    body.transportNotes,
    "送迎上の注意",
    1,
    1000
  );
  const emergencyContactName = optionalString(
    body.emergencyContactName,
    "緊急連絡先氏名",
    1,
    100
  );
  const emergencyContactPhone = optionalPhone(
    body.emergencyContactPhone,
    "緊急連絡先電話番号"
  );

  return await runIdempotentOperation(
    request,
    env,
    session,
    "rider-create",
    body,
    corsOrigin,
    requestId,
    async () => {
      await assertRiderNotDuplicated(
        env,
        session.facilityId,
        fullName,
        phone
      );
      const rows = await supabaseRequest(env, "shuttle_riders", {
        method: "POST",
        body: {
          facility_id: session.facilityId,
          rider_code: riderCode,
          full_name: fullName,
          full_name_kana: fullNameKana,
          phone,
          transport_support_level: transportSupportLevel,
          uses_wheelchair: usesWheelchair,
          requires_handover: requiresHandover,
          transport_notes: transportNotes,
          emergency_contact_name: emergencyContactName,
          emergency_contact_phone: emergencyContactPhone,
          is_active: optionalBoolean(body.isActive, true, "有効状態"),
        },
        prefer: "return=representation",
      });
      const rider = Array.isArray(rows) ? rows[0] : null;
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "create_rider",
        entityType: "rider",
        entityId: rider?.id || null,
        requestId,
        request,
      });
      return {
        status: 201,
        payload: { rider: publicRider(rider) },
      };
    }
  );
}

async function handleRiderUpdate(
  request,
  env,
  corsOrigin,
  requestId,
  riderId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "rider-update", session);
  const body = await readJsonObject(request);
  const expectedUpdatedAt = requireIsoTimestamp(
    body.expectedUpdatedAt,
    "更新前日時"
  );
  const changes = {};
  if (body.fullName !== undefined) {
    changes.full_name = requireString(
      body.fullName,
      "患者氏名",
      1,
      100
    );
  }
  if (body.fullNameKana !== undefined) {
    changes.full_name_kana = optionalString(
      body.fullNameKana,
      "ふりがな",
      1,
      100
    );
  }
  if (body.phone !== undefined) {
    changes.phone = optionalPhone(body.phone, "電話番号");
  }
  if (body.transportSupportLevel !== undefined) {
    changes.transport_support_level = requireEnum(
      body.transportSupportLevel,
      "移動支援区分",
      [
        "independent",
        "supervision",
        "partial_assist",
        "full_assist",
        "wheelchair",
      ]
    );
  }
  if (body.usesWheelchair !== undefined) {
    changes.uses_wheelchair = requireBoolean(
      body.usesWheelchair,
      "車いす利用"
    );
  }
  if (body.requiresHandover !== undefined) {
    changes.requires_handover = requireBoolean(
      body.requiresHandover,
      "引渡し確認"
    );
  }
  if (body.transportNotes !== undefined) {
    changes.transport_notes = optionalString(
      body.transportNotes,
      "送迎上の注意",
      1,
      1000
    );
  }
  if (body.emergencyContactName !== undefined) {
    changes.emergency_contact_name = optionalString(
      body.emergencyContactName,
      "緊急連絡先氏名",
      1,
      100
    );
  }
  if (body.emergencyContactPhone !== undefined) {
    changes.emergency_contact_phone = optionalPhone(
      body.emergencyContactPhone,
      "緊急連絡先電話番号"
    );
  }
  if (body.isActive !== undefined) {
    changes.is_active = requireBoolean(body.isActive, "有効状態");
  }
  assertHasChanges(changes);

  if (
    Object.prototype.hasOwnProperty.call(changes, "full_name") ||
    Object.prototype.hasOwnProperty.call(changes, "phone")
  ) {
    const currentRider = await findRiderById(
      env,
      session.facilityId,
      riderId
    );
    const nextFullName =
      Object.prototype.hasOwnProperty.call(changes, "full_name")
        ? changes.full_name
        : currentRider.full_name;
    const nextPhone =
      Object.prototype.hasOwnProperty.call(changes, "phone")
        ? changes.phone
        : currentRider.phone;

    await assertRiderNotDuplicated(
      env,
      session.facilityId,
      nextFullName,
      nextPhone,
      riderId
    );
  }

  const params = new URLSearchParams();
  params.set("id", `eq.${riderId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("updated_at", `eq.${expectedUpdatedAt}`);
  const rows = await supabaseRequest(
    env,
    `shuttle_riders?${params.toString()}`,
    {
      method: "PATCH",
      body: changes,
      prefer: "return=representation",
    }
  );
  const rider = Array.isArray(rows) ? rows[0] : null;
  if (!rider) {
    throw staleUpdateError();
  }
  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "update_rider",
    entityType: "rider",
    entityId: riderId,
    requestId,
    request,
  });
  return successResponse(
    { rider: publicRider(rider) },
    200,
    corsOrigin,
    requestId
  );
}

async function handleGuardianList(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "guardian-list", session);
  const url = new URL(request.url);
  const query = optionalSearchQuery(url.searchParams.get("query"));
  const riderId = optionalUuid(
    url.searchParams.get("riderId"),
    "患者ID"
  );
  let guardianIds = null;

  if (riderId) {
    const linkParams = new URLSearchParams();
    linkParams.set("select", "guardian_id");
    linkParams.set("facility_id", `eq.${session.facilityId}`);
    linkParams.set("rider_id", `eq.${riderId}`);
    const links = await supabaseRequest(
      env,
      `shuttle_guardian_rider_links?${linkParams.toString()}`
    );
    guardianIds = (links || []).map((link) => link.guardian_id);
    if (guardianIds.length === 0) {
      return successResponse(
        { guardians: [], count: 0 },
        200,
        corsOrigin,
        requestId
      );
    }
  }

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,guardian_code,full_name,relationship,phone,phone_normalized,line_user_id,link_status,notification_preferences,is_active,created_at,updated_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("order", "full_name.asc");
  params.set("limit", String(getQueryLimit(request, 50, 200)));
  if (guardianIds) {
    params.set("id", `in.(${guardianIds.join(",")})`);
  }
  if (query) {
    const phone = normalizeJapanesePhone(query);
    if (phone) {
      params.set("phone_normalized", `eq.${phone}`);
    } else {
      const safe = escapePostgrestSearch(query);
      params.set(
        "or",
        `(full_name.ilike.*${safe}*,guardian_code.ilike.*${safe}*)`
      );
    }
  }
  const rows = await supabaseRequest(
    env,
    `shuttle_guardians?${params.toString()}`
  );
  return successResponse(
    {
      guardians: (rows || []).map(publicGuardian),
      count: Array.isArray(rows) ? rows.length : 0,
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleGuardianCreate(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "reception",
  ]);
  await enforceRateLimit(request, env, "guardian-create", session);
  const body = await readJsonObject(request);
  const guardianCode = requireCode(body.guardianCode, "家族番号");
  const fullName = requireString(body.fullName, "家族氏名", 1, 100);
  const phone = requirePhone(body.phone, "電話番号");
  const relationship = optionalString(
    body.relationship,
    "続柄",
    1,
    50
  );

  return await runIdempotentOperation(
    request,
    env,
    session,
    "guardian-create",
    body,
    corsOrigin,
    requestId,
    async () => {
      await assertGuardianNotDuplicated(
        env,
        session.facilityId,
        fullName,
        phone
      );
      const rows = await supabaseRequest(env, "shuttle_guardians", {
        method: "POST",
        body: {
          facility_id: session.facilityId,
          guardian_code: guardianCode,
          full_name: fullName,
          relationship,
          phone,
          link_status: optionalEnum(
            body.linkStatus,
            "LINE連携状態",
            ["pending", "approved", "rejected", "suspended"],
            "pending"
          ),
          notification_preferences:
            requireOptionalPlainObject(
              body.notificationPreferences,
              "通知設定"
            ),
          is_active: optionalBoolean(body.isActive, true, "有効状態"),
        },
        prefer: "return=representation",
      });
      const guardian = Array.isArray(rows) ? rows[0] : null;
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "create_guardian",
        entityType: "guardian",
        entityId: guardian?.id || null,
        requestId,
        request,
      });
      return {
        status: 201,
        payload: { guardian: publicGuardian(guardian) },
      };
    }
  );
}

async function handleGuardianUpdate(
  request,
  env,
  corsOrigin,
  requestId,
  guardianId
) {
  const session = await requireSession(request, env, [
    "admin",
    "reception",
  ]);
  await enforceRateLimit(request, env, "guardian-update", session);
  const body = await readJsonObject(request);
  const expectedUpdatedAt = requireIsoTimestamp(
    body.expectedUpdatedAt,
    "更新前日時"
  );
  const changes = {};
  if (body.fullName !== undefined) {
    changes.full_name = requireString(body.fullName, "家族氏名", 1, 100);
  }
  if (body.relationship !== undefined) {
    changes.relationship = optionalString(
      body.relationship,
      "続柄",
      1,
      50
    );
  }
  if (body.phone !== undefined) {
    changes.phone = requirePhone(body.phone, "電話番号");
  }
  if (body.linkStatus !== undefined) {
    changes.link_status = requireEnum(
      body.linkStatus,
      "LINE連携状態",
      ["pending", "approved", "rejected", "suspended"]
    );
  }
  if (body.notificationPreferences !== undefined) {
    changes.notification_preferences = requirePlainObject(
      body.notificationPreferences,
      "通知設定"
    );
  }
  if (body.isActive !== undefined) {
    changes.is_active = requireBoolean(body.isActive, "有効状態");
  }
  if (body.clearLineLink === true) {
    if (session.role !== "admin") {
      throw new AppError(
        403,
        "ADMIN_REQUIRED_FOR_LINE_UNLINK",
        "LINE連携の解除には管理者ログインが必要です。"
      );
    }
    changes.line_user_id = null;
    changes.link_status = "pending";
  } else if (
    body.clearLineLink !== undefined &&
    body.clearLineLink !== false
  ) {
    throw new AppError(
      400,
      "INVALID_BOOLEAN",
      "LINE連携解除の指定が正しくありません。"
    );
  }
  assertHasChanges(changes);
  const params = new URLSearchParams();
  params.set("id", `eq.${guardianId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("updated_at", `eq.${expectedUpdatedAt}`);
  if (body.linkStatus === "approved") {
    params.set("line_user_id", "not.is.null");
  }
  const rows = await supabaseRequest(
    env,
    `shuttle_guardians?${params.toString()}`,
    {
      method: "PATCH",
      body: changes,
      prefer: "return=representation",
    }
  );
  const guardian = Array.isArray(rows) ? rows[0] : null;
  if (!guardian) {
    throw staleUpdateError();
  }
  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "update_guardian",
    entityType: "guardian",
    entityId: guardianId,
    requestId,
    request,
  });
  return successResponse(
    { guardian: publicGuardian(guardian) },
    200,
    corsOrigin,
    requestId
  );
}

async function handleGuardianRiderLinkList(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "guardian-link-list", session);
  const url = new URL(request.url);
  const guardianId = optionalUuid(
    url.searchParams.get("guardianId"),
    "家族ID"
  );
  const riderId = optionalUuid(
    url.searchParams.get("riderId"),
    "患者ID"
  );
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,guardian_id,rider_id,is_primary,can_view_schedule,can_request_change,approved_at,created_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  if (guardianId) {
    params.set("guardian_id", `eq.${guardianId}`);
  }
  if (riderId) {
    params.set("rider_id", `eq.${riderId}`);
  }
  params.set("order", "created_at.asc");
  params.set("limit", String(getQueryLimit(request, 200, 500)));
  const rows = await supabaseRequest(
    env,
    `shuttle_guardian_rider_links?${params.toString()}`
  );
  return successResponse(
    {
      links: (rows || []).map(publicGuardianLink),
      count: Array.isArray(rows) ? rows.length : 0,
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleGuardianRiderLinkCreate(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "reception",
  ]);
  await enforceRateLimit(request, env, "guardian-link-create", session);
  const body = await readJsonObject(request);
  const guardianId = requireUuid(body.guardianId, "家族ID");
  const riderId = requireUuid(body.riderId, "患者ID");
  const [guardianRows] = await Promise.all([
    fetchRowsByIds(
      env,
      "shuttle_guardians",
      session.facilityId,
      [guardianId],
      "id"
    ),
    findRiderById(env, session.facilityId, riderId),
  ]);
  if (!guardianRows[0]) {
    throw new AppError(
      404,
      "GUARDIAN_NOT_FOUND",
      "対象の家族情報が見つかりません。"
    );
  }
  return await runIdempotentOperation(
    request,
    env,
    session,
    "guardian-link-create",
    body,
    corsOrigin,
    requestId,
    async () => {
      const rows = await supabaseRequest(
        env,
        "shuttle_guardian_rider_links",
        {
          method: "POST",
          body: {
            facility_id: session.facilityId,
            guardian_id: guardianId,
            rider_id: riderId,
            is_primary: optionalBoolean(
              body.isPrimary,
              false,
              "主連絡先"
            ),
            can_view_schedule: optionalBoolean(
              body.canViewSchedule,
              true,
              "予定閲覧"
            ),
            can_request_change: optionalBoolean(
              body.canRequestChange,
              true,
              "変更依頼"
            ),
            approved_at: new Date().toISOString(),
            approved_by_staff_id: session.actorId,
          },
          prefer: "return=representation",
        }
      );
      const link = Array.isArray(rows) ? rows[0] : null;
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "link_guardian_rider",
        entityType: "guardian_rider_link",
        entityId: link?.id || null,
        requestId,
        request,
      });
      return {
        status: 201,
        payload: { link: publicGuardianLink(link) },
      };
    }
  );
}

async function handleLocationList(
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
  ]);
  await enforceRateLimit(request, env, "location-list", session);
  const url = new URL(request.url);
  const riderId = optionalUuid(
    url.searchParams.get("riderId"),
    "患者ID"
  );
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,rider_id,location_type,location_name,postal_code,address_line1,address_line2,latitude,longitude,access_notes,is_default_pickup,is_default_dropoff,is_active,created_at,updated_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  if (riderId) {
    params.set("rider_id", `eq.${riderId}`);
  }
  params.set("is_active", "eq.true");
  params.set("order", "location_type.asc,location_name.asc");
  params.set("limit", String(getQueryLimit(request, 100, 300)));
  const rows = await supabaseRequest(
    env,
    `shuttle_locations?${params.toString()}`
  );
  return successResponse(
    {
      locations: (rows || []).map(publicLocation),
      count: Array.isArray(rows) ? rows.length : 0,
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleLocationCreate(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "location-create", session);
  const body = await readJsonObject(request);
  const locationType = requireEnum(
    body.locationType,
    "場所区分",
    ["home", "school", "facility", "other"]
  );
  const riderId = optionalUuid(body.riderId, "患者ID");
  if (locationType === "facility" && riderId) {
    throw new AppError(
      400,
      "FACILITY_LOCATION_OWNER",
      "施設共通の場所には患者を指定できません。"
    );
  }
  if (locationType !== "facility" && !riderId) {
    throw new AppError(
      400,
      "RIDER_REQUIRED",
      "患者の乗降場所には患者を指定してください。"
    );
  }
  const locationName = requireString(
    body.locationName,
    "場所名",
    1,
    100
  );
  const addressLine1 = requireString(
    body.addressLine1,
    "住所",
    1,
    250
  );

  return await runIdempotentOperation(
    request,
    env,
    session,
    "location-create",
    body,
    corsOrigin,
    requestId,
    async () => {
      const rows = await supabaseRequest(env, "shuttle_locations", {
        method: "POST",
        body: {
          facility_id: session.facilityId,
          rider_id: riderId,
          location_type: locationType,
          location_name: locationName,
          postal_code: optionalString(
            body.postalCode,
            "郵便番号",
            1,
            20
          ),
          address_line1: addressLine1,
          address_line2: optionalString(
            body.addressLine2,
            "建物名等",
            1,
            250
          ),
          latitude: optionalNumber(
            body.latitude,
            "緯度",
            -90,
            90
          ),
          longitude: optionalNumber(
            body.longitude,
            "経度",
            -180,
            180
          ),
          access_notes: optionalString(
            body.accessNotes,
            "乗降時の注意",
            1,
            1000
          ),
          is_default_pickup: optionalBoolean(
            body.isDefaultPickup,
            false,
            "標準乗車場所"
          ),
          is_default_dropoff: optionalBoolean(
            body.isDefaultDropoff,
            false,
            "標準降車場所"
          ),
          is_active: optionalBoolean(body.isActive, true, "有効状態"),
        },
        prefer: "return=representation",
      });
      const location = Array.isArray(rows) ? rows[0] : null;
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "create_location",
        entityType: "location",
        entityId: location?.id || null,
        requestId,
        request,
      });
      return {
        status: 201,
        payload: { location: publicLocation(location) },
      };
    }
  );
}

async function handleLocationUpdate(
  request,
  env,
  corsOrigin,
  requestId,
  locationId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "location-update", session);
  const body = await readJsonObject(request);
  const expectedUpdatedAt = requireIsoTimestamp(
    body.expectedUpdatedAt,
    "更新前日時"
  );
  const changes = {};
  const mappings = [
    ["locationName", "location_name", "場所名", 1, 100],
    ["postalCode", "postal_code", "郵便番号", 1, 20],
    ["addressLine1", "address_line1", "住所", 1, 250],
    ["addressLine2", "address_line2", "建物名等", 1, 250],
    ["accessNotes", "access_notes", "乗降時の注意", 1, 1000],
  ];
  for (const [input, column, label, min, max] of mappings) {
    if (body[input] !== undefined) {
      changes[column] =
        input === "locationName" || input === "addressLine1"
          ? requireString(body[input], label, min, max)
          : optionalString(body[input], label, min, max);
    }
  }
  if (body.latitude !== undefined) {
    changes.latitude = optionalNumber(
      body.latitude,
      "緯度",
      -90,
      90
    );
  }
  if (body.longitude !== undefined) {
    changes.longitude = optionalNumber(
      body.longitude,
      "経度",
      -180,
      180
    );
  }
  if (body.isDefaultPickup !== undefined) {
    changes.is_default_pickup = requireBoolean(
      body.isDefaultPickup,
      "標準乗車場所"
    );
  }
  if (body.isDefaultDropoff !== undefined) {
    changes.is_default_dropoff = requireBoolean(
      body.isDefaultDropoff,
      "標準降車場所"
    );
  }
  if (body.isActive !== undefined) {
    changes.is_active = requireBoolean(body.isActive, "有効状態");
  }
  assertHasChanges(changes);
  const params = new URLSearchParams();
  params.set("id", `eq.${locationId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("updated_at", `eq.${expectedUpdatedAt}`);
  const rows = await supabaseRequest(
    env,
    `shuttle_locations?${params.toString()}`,
    {
      method: "PATCH",
      body: changes,
      prefer: "return=representation",
    }
  );
  const location = Array.isArray(rows) ? rows[0] : null;
  if (!location) {
    throw staleUpdateError();
  }
  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "update_location",
    entityType: "location",
    entityId: locationId,
    requestId,
    request,
  });
  return successResponse(
    { location: publicLocation(location) },
    200,
    corsOrigin,
    requestId
  );
}

async function handleRegularScheduleList(
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
  ]);
  await enforceRateLimit(request, env, "schedule-list", session);
  const url = new URL(request.url);
  const riderId = optionalUuid(
    url.searchParams.get("riderId"),
    "患者ID"
  );
  const dayOfWeekValue = url.searchParams.get("dayOfWeek");
  const dayOfWeek =
    dayOfWeekValue === null
      ? null
      : requireInteger(Number(dayOfWeekValue), "曜日", 0, 6);
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,rider_id,day_of_week,service_type,route_group_code,pickup_location_id,dropoff_location_id,scheduled_pickup_time,scheduled_dropoff_time,effective_from,effective_to,notes,is_active,created_at,updated_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  if (riderId) {
    params.set("rider_id", `eq.${riderId}`);
  }
  if (dayOfWeek !== null) {
    params.set("day_of_week", `eq.${dayOfWeek}`);
  }
  params.set("order", "day_of_week.asc,scheduled_pickup_time.asc");
  params.set("limit", String(getQueryLimit(request, 100, 500)));
  const rows = await supabaseRequest(
    env,
    `shuttle_regular_schedules?${params.toString()}`
  );
  return successResponse(
    {
      regularSchedules: (rows || []).map(publicRegularSchedule),
      count: Array.isArray(rows) ? rows.length : 0,
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleRegularScheduleCreate(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "schedule-create", session);
  const body = await readJsonObject(request);
  const payload = {
    facility_id: session.facilityId,
    rider_id: requireUuid(body.riderId, "患者ID"),
    day_of_week: requireInteger(body.dayOfWeek, "曜日", 0, 6),
    service_type: requireEnum(
      body.serviceType,
      "送迎区分",
      ["pickup", "dropoff", "transfer"]
    ),
    route_group_code: requireCode(
      body.routeGroupCode || "A",
      "ルートコード",
      30
    ),
    pickup_location_id: requireUuid(
      body.pickupLocationId,
      "乗車場所ID"
    ),
    dropoff_location_id: requireUuid(
      body.dropoffLocationId,
      "降車場所ID"
    ),
    scheduled_pickup_time: requireThirtyMinuteTime(
      body.scheduledPickupTime,
      "乗車予定時刻"
    ),
    scheduled_dropoff_time: requireThirtyMinuteTime(
      body.scheduledDropoffTime,
      "降車予定時刻"
    ),
    effective_from: requireDate(body.effectiveFrom, "適用開始日"),
    effective_to: optionalDate(body.effectiveTo, "適用終了日"),
    notes: optionalString(body.notes, "備考", 1, 1000),
    is_active: optionalBoolean(body.isActive, true, "有効状態"),
  };
  assertNotPastJstDate(
    payload.effective_from,
    "過去日を適用開始日には指定できません。"
  );
  await assertRegularScheduleRules(
    env,
    session.facilityId,
    payload.scheduled_pickup_time,
    payload.scheduled_dropoff_time,
    payload.effective_from,
    payload.effective_to
  );

  return await runIdempotentOperation(
    request,
    env,
    session,
    "schedule-create",
    body,
    corsOrigin,
    requestId,
    async () => {
      const rows = await supabaseRequest(
        env,
        "shuttle_regular_schedules",
        {
          method: "POST",
          body: payload,
          prefer: "return=representation",
        }
      );
      const schedule = Array.isArray(rows) ? rows[0] : null;
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "create_regular_schedule",
        entityType: "regular_schedule",
        entityId: schedule?.id || null,
        requestId,
        request,
      });
      return {
        status: 201,
        payload: {
          regularSchedule: publicRegularSchedule(schedule),
        },
      };
    }
  );
}

async function handleRegularScheduleUpdate(
  request,
  env,
  corsOrigin,
  requestId,
  scheduleId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "schedule-update", session);
  const body = await readJsonObject(request);
  const expectedUpdatedAt = requireIsoTimestamp(
    body.expectedUpdatedAt,
    "更新前日時"
  );
  const changes = {};
  const uuidFields = [
    ["pickupLocationId", "pickup_location_id", "乗車場所ID"],
    ["dropoffLocationId", "dropoff_location_id", "降車場所ID"],
  ];
  for (const [input, column, label] of uuidFields) {
    if (body[input] !== undefined) {
      changes[column] = requireUuid(body[input], label);
    }
  }
  if (body.dayOfWeek !== undefined) {
    changes.day_of_week = requireInteger(body.dayOfWeek, "曜日", 0, 6);
  }
  if (body.serviceType !== undefined) {
    changes.service_type = requireEnum(
      body.serviceType,
      "送迎区分",
      ["pickup", "dropoff", "transfer"]
    );
  }
  if (body.routeGroupCode !== undefined) {
    changes.route_group_code = requireCode(
      body.routeGroupCode,
      "ルートコード",
      30
    );
  }
  if (body.scheduledPickupTime !== undefined) {
    changes.scheduled_pickup_time = requireThirtyMinuteTime(
      body.scheduledPickupTime,
      "乗車予定時刻"
    );
  }
  if (body.scheduledDropoffTime !== undefined) {
    changes.scheduled_dropoff_time = requireThirtyMinuteTime(
      body.scheduledDropoffTime,
      "降車予定時刻"
    );
  }
  if (body.effectiveFrom !== undefined) {
    changes.effective_from = requireDate(
      body.effectiveFrom,
      "適用開始日"
    );
    assertNotPastJstDate(
      changes.effective_from,
      "過去日を新しい適用開始日には指定できません。"
    );
  }
  if (body.effectiveTo !== undefined) {
    changes.effective_to = optionalDate(
      body.effectiveTo,
      "適用終了日"
    );
  }
  if (body.notes !== undefined) {
    changes.notes = optionalString(body.notes, "備考", 1, 1000);
  }
  if (body.isActive !== undefined) {
    changes.is_active = requireBoolean(body.isActive, "有効状態");
  }
  assertHasChanges(changes);

  const currentParams = new URLSearchParams();
  currentParams.set(
    "select",
    "scheduled_pickup_time,scheduled_dropoff_time,effective_from,effective_to"
  );
  currentParams.set("id", `eq.${scheduleId}`);
  currentParams.set("facility_id", `eq.${session.facilityId}`);
  currentParams.set("limit", "1");
  const currentRows = await supabaseRequest(
    env,
    `shuttle_regular_schedules?${currentParams.toString()}`
  );
  const current = Array.isArray(currentRows) ? currentRows[0] : null;
  if (!current) {
    throw new AppError(
      404,
      "REGULAR_SCHEDULE_NOT_FOUND",
      "対象の定期送迎予定が見つかりません。"
    );
  }
  await assertRegularScheduleRules(
    env,
    session.facilityId,
    changes.scheduled_pickup_time ??
      current.scheduled_pickup_time,
    changes.scheduled_dropoff_time ??
      current.scheduled_dropoff_time,
    changes.effective_from ?? current.effective_from,
    changes.effective_to !== undefined
      ? changes.effective_to
      : current.effective_to
  );

  const params = new URLSearchParams();
  params.set("id", `eq.${scheduleId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("updated_at", `eq.${expectedUpdatedAt}`);
  const rows = await supabaseRequest(
    env,
    `shuttle_regular_schedules?${params.toString()}`,
    {
      method: "PATCH",
      body: changes,
      prefer: "return=representation",
    }
  );
  const schedule = Array.isArray(rows) ? rows[0] : null;
  if (!schedule) {
    throw staleUpdateError();
  }
  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "update_regular_schedule",
    entityType: "regular_schedule",
    entityId: scheduleId,
    requestId,
    request,
  });
  return successResponse(
    { regularSchedule: publicRegularSchedule(schedule) },
    200,
    corsOrigin,
    requestId
  );
}

async function handleRunList(
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
  ]);
  await enforceRateLimit(request, env, "run-list", session);
  const url = new URL(request.url);
  const serviceDate = requireDate(
    url.searchParams.get("serviceDate"),
    "送迎日"
  );
  const runs = await loadRunsForDate(
    env,
    session.facilityId,
    serviceDate,
    session
  );
  return successResponse(
    {
      serviceDate,
      runs,
      count: runs.length,
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleRunDetail(
  request,
  env,
  corsOrigin,
  requestId,
  runId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "driver",
    "attendant",
    "reception",
  ]);
  await enforceRateLimit(request, env, "run-detail", session);
  await assertRunAccess(env, session, runId);
  const run = await loadRunDetail(
    env,
    session.facilityId,
    runId
  );
  return successResponse(
    { run },
    200,
    corsOrigin,
    requestId
  );
}

async function handleRunGenerate(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
  ]);
  await enforceRateLimit(request, env, "run-generate", session);
  const actorStaffId = requireStaffActor(session);
  const body = await readJsonObject(request);
  const serviceDate = requireDate(body.serviceDate, "送迎日");
  assertNotPastJstDate(serviceDate, "過去日の送迎便は生成できません。");

  return await runIdempotentOperation(
    request,
    env,
    session,
    "run-generate",
    body,
    corsOrigin,
    requestId,
    async () => {
      const generated = await supabaseRpc(
        env,
        "shuttle_generate_daily_runs",
        {
          p_facility_id: session.facilityId,
          p_service_date: serviceDate,
          p_actor_staff_id: actorStaffId,
        }
      );
      const runs = await loadRunsForDate(
        env,
        session.facilityId,
        serviceDate,
        session
      );
      return {
        status: 200,
        payload: {
          generated,
          serviceDate,
          runs,
        },
      };
    }
  );
}

async function handleRunUpdate(
  request,
  env,
  corsOrigin,
  requestId,
  runId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
  ]);
  await enforceRateLimit(request, env, "run-update", session);
  const body = await readJsonObject(request);
  const expectedVersion = requireInteger(
    body.expectedVersion,
    "更新前バージョン",
    1,
    2147483646
  );
  const changes = {
    version: expectedVersion + 1,
  };
  if (body.vehicleId !== undefined) {
    changes.vehicle_id = optionalUuid(body.vehicleId, "車両ID");
  }
  if (body.runStatus !== undefined) {
    changes.run_status = requireEnum(
      body.runStatus,
      "運行状態",
      ["planned", "ready", "in_progress", "completed", "cancelled"]
    );
  }
  if (body.scheduledStartAt !== undefined) {
    changes.scheduled_start_at = requireIsoTimestamp(
      body.scheduledStartAt,
      "開始予定日時"
    );
  }
  if (body.scheduledEndAt !== undefined) {
    changes.scheduled_end_at = requireIsoTimestamp(
      body.scheduledEndAt,
      "終了予定日時"
    );
  }
  if (body.notes !== undefined) {
    changes.notes = optionalString(body.notes, "備考", 1, 2000);
  }
  if (Object.keys(changes).length === 1) {
    throw new AppError(
      400,
      "NO_CHANGES",
      "変更する内容を入力してください。"
    );
  }
  const params = new URLSearchParams();
  params.set("id", `eq.${runId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("version", `eq.${expectedVersion}`);
  const rows = await supabaseRequest(
    env,
    `shuttle_runs?${params.toString()}`,
    {
      method: "PATCH",
      body: changes,
      prefer: "return=representation",
    }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    throw staleUpdateError();
  }
  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "update_run",
    entityType: "run",
    entityId: runId,
    requestId,
    request,
  });
  const run = await loadRunDetail(
    env,
    session.facilityId,
    runId
  );
  return successResponse(
    { run },
    200,
    corsOrigin,
    requestId
  );
}

async function handleRunStaffAssign(
  request,
  env,
  corsOrigin,
  requestId,
  runId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
  ]);
  await enforceRateLimit(request, env, "run-staff-assign", session);
  const body = await readJsonObject(request);
  const staffId = requireUuid(body.staffId, "スタッフID");
  const duty = requireEnum(
    body.duty,
    "担当区分",
    ["driver", "attendant"]
  );
  return await runIdempotentOperation(
    request,
    env,
    session,
    "run-staff-assign",
    { runId, ...body },
    corsOrigin,
    requestId,
    async () => {
      const rows = await supabaseRequest(env, "shuttle_run_staff", {
        method: "POST",
        body: {
          facility_id: session.facilityId,
          run_id: runId,
          staff_id: staffId,
          duty,
        },
        prefer: "return=representation",
      });
      const assignment = Array.isArray(rows) ? rows[0] : null;
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "assign_run_staff",
        entityType: "run",
        entityId: runId,
        requestId,
        request,
      });
      return {
        status: 201,
        payload: {
          assignment: {
            runId: assignment?.run_id || runId,
            staffId: assignment?.staff_id || staffId,
            duty: assignment?.duty || duty,
          },
        },
      };
    }
  );
}

async function handleRunStaffRemove(
  request,
  env,
  corsOrigin,
  requestId,
  runId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
  ]);
  await enforceRateLimit(request, env, "run-staff-remove", session);
  const body = await readJsonObject(request);
  const staffId = requireUuid(body.staffId, "スタッフID");
  const duty = requireEnum(
    body.duty,
    "担当区分",
    ["driver", "attendant"]
  );
  return await runIdempotentOperation(
    request,
    env,
    session,
    "run-staff-remove",
    { runId, ...body },
    corsOrigin,
    requestId,
    async () => {
      const params = new URLSearchParams();
      params.set("facility_id", `eq.${session.facilityId}`);
      params.set("run_id", `eq.${runId}`);
      params.set("staff_id", `eq.${staffId}`);
      params.set("duty", `eq.${duty}`);
      const rows = await supabaseRequest(
        env,
        `shuttle_run_staff?${params.toString()}`,
        {
          method: "DELETE",
          prefer: "return=representation",
        }
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new AppError(
          404,
          "ASSIGNMENT_NOT_FOUND",
          "解除する担当割当が見つかりません。"
        );
      }
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "remove_run_staff",
        entityType: "run",
        entityId: runId,
        requestId,
        request,
      });
      return {
        status: 200,
        payload: {
          removed: true,
          runId,
          staffId,
          duty,
        },
      };
    }
  );
}

async function handleRideEvent(
  request,
  env,
  corsOrigin,
  requestId,
  stopId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "driver",
    "attendant",
  ]);
  await enforceRateLimit(request, env, "ride-event", session);
  const actorStaffId = requireStaffActor(session);
  const body = await readJsonObject(request);
  const eventType = requireEnum(
    body.eventType,
    "送迎イベント",
    [
      "confirm",
      "en_route",
      "boarded",
      "no_show",
      "arrived",
      "handed_over",
      "completed",
      "cancelled",
    ]
  );
  const idempotencyKey = requireIdempotencyKey(request, body);
  const result = await supabaseRpc(
    env,
    "shuttle_register_ride_event",
    {
      p_stop_id: stopId,
      p_event_type: eventType,
      p_actor_staff_id: actorStaffId,
      p_idempotency_key: idempotencyKey,
      p_event_at: optionalIsoTimestamp(body.eventAt, "実施日時"),
      p_notes: optionalString(body.notes, "備考", 1, 1000),
    }
  );
  return successResponse(
    { rideEvent: result },
    200,
    corsOrigin,
    requestId
  );
}

async function handleStopStatusCorrection(
  request,
  env,
  corsOrigin,
  requestId,
  stopId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
  ]);
  await enforceRateLimit(request, env, "stop-correction", session);
  const actorStaffId = requireStaffActor(session);
  const body = await readJsonObject(request);
  const correctedStatus = requireEnum(
    body.correctedStatus,
    "訂正後状態",
    [
      "planned",
      "confirmed",
      "en_route",
      "boarded",
      "no_show",
      "arrived",
      "handed_over",
      "completed",
      "cancelled",
    ]
  );
  const reason = requireString(body.reason, "訂正理由", 5, 1000);
  const result = await supabaseRpc(
    env,
    "shuttle_admin_correct_stop_status",
    {
      p_stop_id: stopId,
      p_corrected_status: correctedStatus,
      p_actor_staff_id: actorStaffId,
      p_reason: reason,
    }
  );
  return successResponse(
    { correction: result },
    200,
    corsOrigin,
    requestId
  );
}

async function handleChangeRequestList(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
    "guardian",
  ]);
  await enforceRateLimit(request, env, "change-request-list", session);
  const url = new URL(request.url);
  const status = optionalEnum(
    url.searchParams.get("status"),
    "依頼状態",
    ["pending", "approved", "rejected", "cancelled"],
    null
  );
  const serviceDate = optionalDate(
    url.searchParams.get("serviceDate"),
    "送迎日"
  );
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,rider_id,guardian_id,requested_by_staff_id,service_date,request_type,requested_changes,request_status,reviewed_by_staff_id,reviewed_at,review_notes,created_at,updated_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  if (session.role === "guardian") {
    params.set("guardian_id", `eq.${session.actorId}`);
  }
  if (status) {
    params.set("request_status", `eq.${status}`);
  }
  if (serviceDate) {
    params.set("service_date", `eq.${serviceDate}`);
  }
  params.set("order", "service_date.asc,created_at.asc");
  params.set("limit", String(getQueryLimit(request, 100, 500)));
  const rows = await supabaseRequest(
    env,
    `shuttle_change_requests?${params.toString()}`
  );
  return successResponse(
    {
      changeRequests: (rows || []).map(publicChangeRequest),
      count: Array.isArray(rows) ? rows.length : 0,
    },
    200,
    corsOrigin,
    requestId
  );
}

async function handleChangeRequestCreate(
  request,
  env,
  corsOrigin,
  requestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
    "guardian",
  ]);
  await enforceRateLimit(request, env, "change-request-create", session);
  const body = await readJsonObject(request);
  const riderId = requireUuid(body.riderId, "患者ID");
  const serviceDate = requireDate(body.serviceDate, "送迎日");
  assertNotPastJstDate(
    serviceDate,
    "過去日の送迎変更は受け付けできません。"
  );
  const requestType = requireEnum(
    body.requestType,
    "依頼種別",
    [
      "absence",
      "time_change",
      "location_change",
      "one_way",
      "temporary_use",
      "other",
    ]
  );
  const requestedChanges = validateRequestedChanges(
    requestType,
    body.requestedChanges,
    "変更内容"
  );
  const idempotencyKey = requireIdempotencyKey(request, body);
  const isGuardian = session.role === "guardian";
  if (isGuardian) {
    await assertGuardianCanChangeRider(
      env,
      session.facilityId,
      session.actorId,
      riderId
    );
  }
  const actorStaffId = isGuardian ? null : requireStaffActor(session);

  return await runIdempotentOperation(
    request,
    env,
    session,
    "change-request-create",
    body,
    corsOrigin,
    requestId,
    async () => {
      const rows = await supabaseRequest(
        env,
        "shuttle_change_requests",
        {
          method: "POST",
          body: {
            facility_id: session.facilityId,
            rider_id: riderId,
            guardian_id: isGuardian ? session.actorId : null,
            requested_by_staff_id: actorStaffId,
            service_date: serviceDate,
            request_type: requestType,
            requested_changes: requestedChanges,
            request_status: "pending",
            idempotency_key: idempotencyKey,
          },
          prefer: "return=representation",
        }
      );
      const changeRequest = Array.isArray(rows) ? rows[0] : null;
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "create_change_request",
        entityType: "change_request",
        entityId: changeRequest?.id || null,
        requestId,
        request,
      });
      return {
        status: 201,
        payload: {
          changeRequest: publicChangeRequest(changeRequest),
        },
      };
    }
  );
}

async function handleChangeRequestReview(
  request,
  env,
  corsOrigin,
  requestId,
  changeRequestId
) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
  ]);
  await enforceRateLimit(request, env, "change-request-review", session);
  const actorStaffId = requireStaffActor(session);
  const body = await readJsonObject(request);
  const decision = requireEnum(
    body.decision,
    "確認結果",
    ["approved", "rejected"]
  );
  const expectedUpdatedAt = requireIsoTimestamp(
    body.expectedUpdatedAt,
    "更新前日時"
  );
  const reviewNotes = optionalString(
    body.reviewNotes,
    "確認メモ",
    1,
    1000
  );
  return await runIdempotentOperation(
    request,
    env,
    session,
    "change-request-review",
    { changeRequestId, ...body },
    corsOrigin,
    requestId,
    async () => {
      const params = new URLSearchParams();
      params.set("id", `eq.${changeRequestId}`);
      params.set("facility_id", `eq.${session.facilityId}`);
      params.set("request_status", "eq.pending");
      params.set("updated_at", `eq.${expectedUpdatedAt}`);
      const rows = await supabaseRequest(
        env,
        `shuttle_change_requests?${params.toString()}`,
        {
          method: "PATCH",
          body: {
            request_status: decision,
            reviewed_by_staff_id: actorStaffId,
            reviewed_at: new Date().toISOString(),
            review_notes: reviewNotes,
          },
          prefer: "return=representation",
        }
      );
      const changeRequest = Array.isArray(rows) ? rows[0] : null;
      if (!changeRequest) {
        throw staleUpdateError();
      }
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "review_change_request",
        entityType: "change_request",
        entityId: changeRequestId,
        requestId,
        request,
      });
      return {
        status: 200,
        payload: {
          changeRequest: publicChangeRequest(changeRequest),
        },
      };
    }
  );
}


function requireThirtyMinuteTime(value, label, options = {}) {
  const { allowNull = false } = options;
  if ((value === null || value === undefined || value === "") && allowNull) {
    return null;
  }
  const normalized = requireTime(value, label);
  const match = String(normalized).match(/^([01][0-9]|2[0-3]):([0-5][0-9])/);
  if (!match || !["00", "30"].includes(match[2])) {
    throw new AppError(
      400,
      "RESERVATION_SLOT_REQUIRED",
      `${label}は30分単位（00分・30分）で選択してください。`
    );
  }
  return normalized;
}

function reservationStatuses() {
  return [
    "pending", "confirmed", "assigned", "outbound_in_progress",
    "at_clinic", "return_ready", "return_assigned", "return_in_progress",
    "completed", "change_requested", "cancel_requested", "cancelled", "rejected"
  ];
}

function publicReservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    riderId: row.rider_id,
    guardianId: row.guardian_id ?? null,
    requestedByStaffId: row.requested_by_staff_id ?? null,
    sourceChannel: row.source_channel,
    serviceDate: row.service_date,
    appointmentTime: row.appointment_time ?? null,
    externalAppointmentRef: row.external_appointment_ref ?? null,
    tripType: row.trip_type,
    returnMode: row.return_mode,
    outboundRequestedTime: row.outbound_requested_time ?? null,
    returnRequestedTime: row.return_requested_time ?? null,
    pickupLocationId: row.pickup_location_id ?? null,
    clinicLocationId: row.clinic_location_id ?? null,
    returnDropoffLocationId: row.return_dropoff_location_id ?? null,
    reservationStatus: row.reservation_status,
    customerNote: row.customer_note ?? null,
    internalNote: row.internal_note ?? null,
    version: row.version,
    cancelRequestedAt: row.cancel_requested_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function validateReservationTripFields({
  tripType,
  returnMode,
  outboundRequestedTime,
  returnRequestedTime,
}) {
  if (tripType === "outbound_to_clinic") {
    if (!outboundRequestedTime || returnMode !== "none" || returnRequestedTime) {
      throw new AppError(
        400, "RESERVATION_TRIP_FIELDS_INVALID",
        "行きのみは、行きの希望時間を選択し、帰りの時間は入力しないでください。"
      );
    }
    return;
  }
  if (tripType === "round_trip") {
    if (!outboundRequestedTime || !["fixed_time", "after_visit_ready"].includes(returnMode)) {
      throw new AppError(
        400, "RESERVATION_TRIP_FIELDS_INVALID",
        "往復は、行きの希望時間と帰り方法を選択してください。"
      );
    }
  } else if (tripType === "return_only") {
    if (outboundRequestedTime || !["fixed_time", "after_visit_ready"].includes(returnMode)) {
      throw new AppError(
        400, "RESERVATION_TRIP_FIELDS_INVALID",
        "帰りのみでは行きの時間を入力せず、帰り方法を選択してください。"
      );
    }
  }
  if (returnMode === "fixed_time" && !returnRequestedTime) {
    throw new AppError(
      400, "RETURN_TIME_REQUIRED",
      "帰り時間を指定する場合は、30分単位の希望時間を選択してください。"
    );
  }
  if (returnMode === "after_visit_ready" && returnRequestedTime) {
    throw new AppError(
      400, "RETURN_READY_TIME_CONFLICT",
      "診療終了後に帰り便を手配する場合は、帰り時間を固定入力しないでください。"
    );
  }
}

async function loadReservationForAccess(env, session, reservationId) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,facility_id,rider_id,guardian_id,requested_by_staff_id,source_channel,service_date,appointment_time,external_appointment_ref,trip_type,return_mode,outbound_requested_time,return_requested_time,pickup_location_id,clinic_location_id,return_dropoff_location_id,reservation_status,customer_note,internal_note,idempotency_key,version,cancel_requested_at,cancelled_at,created_at,updated_at"
  );
  params.set("id", `eq.${reservationId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("deleted_at", "is.null");
  params.set("limit", "1");
  const rows = await supabaseRequest(env, `shuttle_reservations?${params.toString()}`);
  const reservation = Array.isArray(rows) ? rows[0] : null;
  if (!reservation) {
    throw new AppError(
      404, "RESERVATION_NOT_FOUND",
      "対象の送迎予約が見つかりません。画面を更新してください。"
    );
  }
  if (session.role === "guardian") {
    await assertGuardianCanChangeRider(
      env, session.facilityId, session.actorId, reservation.rider_id
    );
  }
  return reservation;
}

async function handleReservationList(request, env, corsOrigin, requestId) {
  const session = await requireSession(request, env, [
    "admin", "dispatcher", "reception", "guardian",
  ]);
  await enforceRateLimit(request, env, "reservation-list", session);
  const url = new URL(request.url);
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,facility_id,rider_id,guardian_id,requested_by_staff_id,source_channel,service_date,appointment_time,external_appointment_ref,trip_type,return_mode,outbound_requested_time,return_requested_time,pickup_location_id,clinic_location_id,return_dropoff_location_id,reservation_status,customer_note,internal_note,idempotency_key,version,cancel_requested_at,cancelled_at,created_at,updated_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("deleted_at", "is.null");

  const serviceDateRaw = url.searchParams.get("serviceDate");
  if (serviceDateRaw) params.set("service_date", `eq.${requireDate(serviceDateRaw, "送迎日")}`);

  const statusRaw = url.searchParams.get("status");
  if (statusRaw) {
    params.set("reservation_status", `eq.${requireEnum(statusRaw, "予約状態", reservationStatuses())}`);
  }

  const riderRaw = url.searchParams.get("riderId");
  if (session.role === "guardian") {
    const riderId = requireUuid(riderRaw, "患者ID");
    await assertGuardianCanChangeRider(env, session.facilityId, session.actorId, riderId);
    params.set("rider_id", `eq.${riderId}`);
  } else if (riderRaw) {
    params.set("rider_id", `eq.${requireUuid(riderRaw, "患者ID")}`);
  }

  params.set("order", "service_date.asc,outbound_requested_time.asc,created_at.asc");
  params.set("limit", String(getQueryLimit(request, 100, 200)));

  const rows = await supabaseRequest(env, `shuttle_reservations?${params.toString()}`);
  return successResponse(
    { reservations: (rows || []).map(publicReservation), count: Array.isArray(rows) ? rows.length : 0 },
    200, corsOrigin, requestId
  );
}

async function handleReservationCreate(request, env, corsOrigin, requestId) {
  const session = await requireSession(request, env, [
    "admin", "dispatcher", "reception", "guardian",
  ]);
  await enforceRateLimit(request, env, "reservation-create", session);
  const body = await readJsonObject(request);

  const riderId = requireUuid(body.riderId, "患者ID");
  const serviceDate = requireDate(body.serviceDate, "送迎日");
  assertNotPastJstDate(serviceDate, "過去日の送迎予約は登録できません。");
  const tripType = requireEnum(
    body.tripType, "利用区分", ["outbound_to_clinic", "round_trip", "return_only"]
  );
  const returnMode = requireEnum(
    body.returnMode ?? (tripType === "outbound_to_clinic" ? "none" : "fixed_time"),
    "帰り方法", ["none", "fixed_time", "after_visit_ready"]
  );
  const outboundRequestedTime = requireThirtyMinuteTime(
    body.outboundRequestedTime, "行き希望時間", { allowNull: true }
  );
  const returnRequestedTime = requireThirtyMinuteTime(
    body.returnRequestedTime, "帰り希望時間", { allowNull: true }
  );
  const appointmentTime = requireThirtyMinuteTime(
    body.appointmentTime, "受診予定時刻", { allowNull: true }
  );

  validateReservationTripFields({
    tripType, returnMode, outboundRequestedTime, returnRequestedTime,
  });

  if (session.role === "guardian") {
    await assertGuardianCanChangeRider(env, session.facilityId, session.actorId, riderId);
  }

  const sourceChannel = session.role === "guardian"
    ? "line"
    : optionalEnum(
        body.sourceChannel, "受付経路",
        ["owner", "phone_proxy", "web", "instagram"], "owner"
      );

  const idempotencyKey = requireIdempotencyKey(request, body);
  const payload = {
    facility_id: session.facilityId,
    rider_id: riderId,
    guardian_id: session.role === "guardian"
      ? session.actorId
      : optionalUuid(body.guardianId, "家族ID"),
    requested_by_staff_id:
      session.role === "guardian" || !isUuid(session.actorId) ? null : session.actorId,
    source_channel: sourceChannel,
    service_date: serviceDate,
    appointment_time: appointmentTime,
    external_appointment_ref: optionalString(body.externalAppointmentRef, "受診予約参照", 1, 200),
    trip_type: tripType,
    return_mode: returnMode,
    outbound_requested_time: outboundRequestedTime,
    return_requested_time: returnRequestedTime,
    pickup_location_id: optionalUuid(body.pickupLocationId, "お迎え場所ID"),
    clinic_location_id: optionalUuid(body.clinicLocationId, "診療所場所ID"),
    return_dropoff_location_id: optionalUuid(body.returnDropoffLocationId, "帰り降車場所ID"),
    reservation_status: "pending",
    customer_note: optionalString(body.customerNote, "連絡事項", 1, 1000),
    internal_note: session.role === "guardian"
      ? null
      : optionalString(body.internalNote, "内部メモ", 1, 2000),
    idempotency_key: idempotencyKey,
  };

  return await runIdempotentOperation(
    request, env, session, "reservation-create", body, corsOrigin, requestId,
    async () => {
      const rows = await supabaseRequest(env, "shuttle_reservations", {
        method: "POST", body: payload, prefer: "return=representation",
      });
      const reservation = Array.isArray(rows) ? rows[0] : null;
      await writeAuditLog(env, {
        facilityId: session.facilityId,
        actorType: session.actorType,
        actorId: session.actorId,
        action: "create_reservation",
        entityType: "reservation",
        entityId: reservation?.id || null,
        requestId, request,
        newData: { serviceDate, tripType, sourceChannel, reservationStatus: "pending" },
      });
      return { status: 201, payload: { reservation: publicReservation(reservation) } };
    }
  );
}

async function handleReservationUpdate(request, env, corsOrigin, requestId, reservationId) {
  const session = await requireSession(request, env, ["admin", "dispatcher", "reception"]);
  await enforceRateLimit(request, env, "reservation-update", session);
  const current = await loadReservationForAccess(env, session, reservationId);
  const body = await readJsonObject(request);
  const expectedVersion = requireInteger(body.expectedVersion, "更新前バージョン", 1, 2147483646);
  const changes = {};

  if (body.serviceDate !== undefined) {
    const serviceDate = requireDate(body.serviceDate, "送迎日");
    assertNotPastJstDate(serviceDate, "過去日の送迎予約には変更できません。");
    changes.service_date = serviceDate;
  }
  if (body.appointmentTime !== undefined) {
    changes.appointment_time = requireThirtyMinuteTime(body.appointmentTime, "受診予定時刻", { allowNull: true });
  }
  if (body.externalAppointmentRef !== undefined) {
    changes.external_appointment_ref = optionalString(body.externalAppointmentRef, "受診予約参照", 1, 200);
  }
  if (body.tripType !== undefined) {
    changes.trip_type = requireEnum(body.tripType, "利用区分", ["outbound_to_clinic", "round_trip", "return_only"]);
  }
  if (body.returnMode !== undefined) {
    changes.return_mode = requireEnum(body.returnMode, "帰り方法", ["none", "fixed_time", "after_visit_ready"]);
  }
  if (body.outboundRequestedTime !== undefined) {
    changes.outbound_requested_time = requireThirtyMinuteTime(body.outboundRequestedTime, "行き希望時間", { allowNull: true });
  }
  if (body.returnRequestedTime !== undefined) {
    changes.return_requested_time = requireThirtyMinuteTime(body.returnRequestedTime, "帰り希望時間", { allowNull: true });
  }
  if (body.pickupLocationId !== undefined) {
    changes.pickup_location_id = optionalUuid(body.pickupLocationId, "お迎え場所ID");
  }
  if (body.clinicLocationId !== undefined) {
    changes.clinic_location_id = optionalUuid(body.clinicLocationId, "診療所場所ID");
  }
  if (body.returnDropoffLocationId !== undefined) {
    changes.return_dropoff_location_id = optionalUuid(body.returnDropoffLocationId, "帰り降車場所ID");
  }
  if (body.customerNote !== undefined) {
    changes.customer_note = optionalString(body.customerNote, "連絡事項", 1, 1000);
  }
  if (body.internalNote !== undefined) {
    changes.internal_note = optionalString(body.internalNote, "内部メモ", 1, 2000);
  }
  if (body.reservationStatus !== undefined) {
    changes.reservation_status = requireEnum(body.reservationStatus, "予約状態", reservationStatuses());
  }
  assertHasChanges(changes);

  validateReservationTripFields({
    tripType: changes.trip_type ?? current.trip_type,
    returnMode: changes.return_mode ?? current.return_mode,
    outboundRequestedTime:
      Object.prototype.hasOwnProperty.call(changes, "outbound_requested_time")
        ? changes.outbound_requested_time : current.outbound_requested_time,
    returnRequestedTime:
      Object.prototype.hasOwnProperty.call(changes, "return_requested_time")
        ? changes.return_requested_time : current.return_requested_time,
  });

  const params = new URLSearchParams();
  params.set("id", `eq.${reservationId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("version", `eq.${expectedVersion}`);
  params.set("deleted_at", "is.null");
  const rows = await supabaseRequest(env, `shuttle_reservations?${params.toString()}`, {
    method: "PATCH", body: changes, prefer: "return=representation",
  });
  const reservation = Array.isArray(rows) ? rows[0] : null;
  if (!reservation) throw staleUpdateError();

  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "update_reservation",
    entityType: "reservation",
    entityId: reservationId,
    requestId, request,
  });
  return successResponse({ reservation: publicReservation(reservation) }, 200, corsOrigin, requestId);
}

async function handleReservationCancel(request, env, corsOrigin, requestId, reservationId) {
  const session = await requireSession(request, env, [
    "admin", "dispatcher", "reception", "guardian",
  ]);
  await enforceRateLimit(request, env, "reservation-cancel", session);
  const current = await loadReservationForAccess(env, session, reservationId);
  if (["completed", "cancelled", "rejected"].includes(current.reservation_status)) {
    throw new AppError(409, "RESERVATION_NOT_CANCELLABLE", "この予約は現在の状態では取消できません。");
  }
  const body = await readJsonObject(request);
  const expectedVersion = requireInteger(body.expectedVersion, "更新前バージョン", 1, 2147483646);
  const reason = optionalString(body.reason, "取消理由", 1, 1000);
  const guardianRequest = session.role === "guardian";
  const params = new URLSearchParams();
  params.set("id", `eq.${reservationId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("version", `eq.${expectedVersion}`);
  params.set("deleted_at", "is.null");

  const patch = guardianRequest
    ? {
        reservation_status: "cancel_requested",
        cancel_requested_at: new Date().toISOString(),
        customer_note: reason || current.customer_note,
      }
    : {
        reservation_status: "cancelled",
        cancel_requested_at: current.cancel_requested_at || new Date().toISOString(),
        cancelled_at: new Date().toISOString(),
        cancelled_by_staff_id: isUuid(session.actorId) ? session.actorId : null,
        internal_note: reason || current.internal_note,
      };

  const rows = await supabaseRequest(env, `shuttle_reservations?${params.toString()}`, {
    method: "PATCH", body: patch, prefer: "return=representation",
  });
  const reservation = Array.isArray(rows) ? rows[0] : null;
  if (!reservation) throw staleUpdateError();

  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: guardianRequest ? "request_reservation_cancel" : "cancel_reservation",
    entityType: "reservation",
    entityId: reservationId,
    requestId, request,
  });
  return successResponse({ reservation: publicReservation(reservation) }, 200, corsOrigin, requestId);
}

async function handleReservationReturnReady(request, env, corsOrigin, requestId, reservationId) {
  const session = await requireSession(request, env, ["admin", "dispatcher", "reception"]);
  await enforceRateLimit(request, env, "reservation-return-ready", session);
  const current = await loadReservationForAccess(env, session, reservationId);
  if (!["round_trip", "return_only"].includes(current.trip_type)) {
    throw new AppError(409, "RETURN_TRIP_NOT_CONFIGURED", "この予約には帰り便が設定されていません。");
  }
  if (["completed", "cancelled", "rejected"].includes(current.reservation_status)) {
    throw new AppError(409, "RETURN_READY_NOT_ALLOWED", "この予約は帰り便待ちへ変更できる状態ではありません。");
  }

  const body = await readJsonObject(request, { allowEmpty: true });
  const expectedVersion = requireInteger(body.expectedVersion, "更新前バージョン", 1, 2147483646);
  const params = new URLSearchParams();
  params.set("id", `eq.${reservationId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("version", `eq.${expectedVersion}`);
  params.set("deleted_at", "is.null");
  const rows = await supabaseRequest(env, `shuttle_reservations?${params.toString()}`, {
    method: "PATCH",
    body: { reservation_status: "return_ready" },
    prefer: "return=representation",
  });
  const reservation = Array.isArray(rows) ? rows[0] : null;
  if (!reservation) throw staleUpdateError();

  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "mark_return_ready",
    entityType: "reservation",
    entityId: reservationId,
    requestId, request,
  });
  return successResponse({ reservation: publicReservation(reservation) }, 200, corsOrigin, requestId);
}

async function handleStaffSoftDelete(request, env, corsOrigin, requestId, staffId) {
  const session = await requireSession(request, env, ["admin"]);
  await enforceRateLimit(request, env, "staff-soft-delete", session);
  const body = await readJsonObject(request);
  const reason = requireString(body.reason, "削除理由", 3, 1000);
  if (isUuid(session.actorId) && session.actorId === staffId) {
    throw new AppError(
      409, "SELF_DELETE_NOT_ALLOWED",
      "現在ログイン中のスタッフ自身は削除できません。別の管理者から操作してください。"
    );
  }
  const result = await supabaseRpc(env, "shuttle_soft_delete_staff", {
    p_facility_id: session.facilityId,
    p_staff_id: staffId,
    p_actor_staff_id: isUuid(session.actorId) ? session.actorId : null,
    p_reason: reason,
  });
  return successResponse({ result }, 200, corsOrigin, requestId);
}

async function handleVehicleSoftDelete(request, env, corsOrigin, requestId, vehicleId) {
  const session = await requireSession(request, env, ["admin"]);
  await enforceRateLimit(request, env, "vehicle-soft-delete", session);
  const body = await readJsonObject(request);
  const reason = requireString(body.reason, "削除理由", 3, 1000);
  const result = await supabaseRpc(env, "shuttle_soft_delete_vehicle", {
    p_facility_id: session.facilityId,
    p_vehicle_id: vehicleId,
    p_actor_staff_id: isUuid(session.actorId) ? session.actorId : null,
    p_reason: reason,
  });
  return successResponse({ result }, 200, corsOrigin, requestId);
}

function publicContactEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceChannel: row.source_channel,
    sourceRef: row.source_ref ?? null,
    customerName: row.customer_name ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    summary: row.summary,
    status: row.status,
    assignedStaffId: row.assigned_staff_id ?? null,
    linkedRiderId: row.linked_rider_id ?? null,
    linkedReservationId: row.linked_reservation_id ?? null,
    metadata: row.metadata || {},
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

async function handleContactHubList(request, env, corsOrigin, requestId) {
  const session = await requireSession(request, env, ["admin", "dispatcher", "reception"]);
  await enforceRateLimit(request, env, "contact-hub-list", session);
  const url = new URL(request.url);
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,source_channel,source_ref,customer_name,phone,email,summary,status,assigned_staff_id,linked_rider_id,linked_reservation_id,metadata,created_at,updated_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  const status = url.searchParams.get("status");
  if (status) {
    params.set("status", `eq.${requireEnum(status, "対応状態", ["new", "assigned", "working", "closed"])}`);
  }
  const source = url.searchParams.get("source");
  if (source) {
    params.set("source_channel", `eq.${requireEnum(source, "受付経路", ["web", "line", "instagram", "phone_proxy"])}`);
  }
  params.set("order", "created_at.desc");
  params.set("limit", String(getQueryLimit(request, 100, 200)));
  const rows = await supabaseRequest(env, `shuttle_contact_events?${params.toString()}`);
  return successResponse(
    { contacts: (rows || []).map(publicContactEvent), count: Array.isArray(rows) ? rows.length : 0 },
    200, corsOrigin, requestId
  );
}

async function handleContactHubCreate(request, env, corsOrigin, requestId) {
  const session = await requireSession(request, env, [
    "admin", "dispatcher", "reception", "guardian",
  ]);
  await enforceRateLimit(request, env, "contact-hub-create", session);
  const body = await readJsonObject(request);
  const sourceChannel = session.role === "guardian"
    ? "line"
    : requireEnum(body.sourceChannel, "受付経路", ["web", "line", "instagram", "phone_proxy"]);
  const linkedRiderId = optionalUuid(body.linkedRiderId, "患者ID");
  if (session.role === "guardian" && linkedRiderId) {
    await assertGuardianCanChangeRider(env, session.facilityId, session.actorId, linkedRiderId);
  }

  const rows = await supabaseRequest(env, "shuttle_contact_events", {
    method: "POST",
    body: {
      facility_id: session.facilityId,
      source_channel: sourceChannel,
      source_ref: optionalString(body.sourceRef, "受付元参照", 1, 300),
      customer_name: optionalString(body.customerName, "氏名", 1, 100),
      phone: optionalPhone(body.phone, "電話番号"),
      email: optionalString(body.email, "メールアドレス", 3, 320),
      summary: requireString(body.summary, "問い合わせ内容", 1, 2000),
      status: "new",
      assigned_staff_id:
        session.role === "guardian" || !isUuid(session.actorId) ? null : session.actorId,
      linked_rider_id: linkedRiderId,
      linked_reservation_id: optionalUuid(body.linkedReservationId, "送迎予約ID"),
      metadata: {},
    },
    prefer: "return=representation",
  });
  const contact = Array.isArray(rows) ? rows[0] : null;
  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "create_contact_hub_event",
    entityType: "contact_event",
    entityId: contact?.id || null,
    requestId, request,
    newData: { sourceChannel },
  });
  return successResponse({ contact: publicContactEvent(contact) }, 201, corsOrigin, requestId);
}

async function handleTodayDashboard(
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
  ]);
  await enforceRateLimit(request, env, "today-dashboard", session);
  const url = new URL(request.url);
  const serviceDate = optionalDate(
    url.searchParams.get("serviceDate"),
    "送迎日"
  ) || jstDateString(new Date());
  const runs = await loadRunsForDate(
    env,
    session.facilityId,
    serviceDate,
    session
  );

  const changeParams = new URLSearchParams();
  changeParams.set("select", "id");
  changeParams.set("facility_id", `eq.${session.facilityId}`);
  changeParams.set("request_status", "eq.pending");
  changeParams.set("service_date", `eq.${serviceDate}`);
  changeParams.set("limit", "1000");

  const incidentParams = new URLSearchParams();
  incidentParams.set("select", "id,severity,incident_status");
  incidentParams.set("facility_id", `eq.${session.facilityId}`);
  incidentParams.set("incident_status", "in.(open,handling)");
  incidentParams.set("limit", "1000");

  const [changes, incidents] = await Promise.all([
    supabaseRequest(
      env,
      `shuttle_change_requests?${changeParams.toString()}`
    ),
    supabaseRequest(
      env,
      `shuttle_incidents?${incidentParams.toString()}`
    ),
  ]);
  const stops = runs.flatMap((run) => run.stops || []);
  const statusCounts = {};
  for (const stop of stops) {
    statusCounts[stop.stopStatus] =
      (statusCounts[stop.stopStatus] || 0) + 1;
  }
  return successResponse(
    {
      dashboard: {
        serviceDate,
        runCount: runs.length,
        riderStopCount: stops.length,
        pendingChangeRequestCount: (changes || []).length,
        openIncidentCount: (incidents || []).length,
        emergencyIncidentCount: (incidents || []).filter(
          (incident) => incident.severity === "emergency"
        ).length,
        statusCounts,
        runs,
      },
    },
    200,
    corsOrigin,
    requestId
  );
}

async function loadRunsForDate(
  env,
  facilityId,
  serviceDate,
  session
) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,service_date,run_code,service_type,route_group_code,scheduled_start_at,scheduled_end_at,actual_start_at,actual_end_at,vehicle_id,run_status,notes,version,created_at,updated_at"
  );
  params.set("facility_id", `eq.${facilityId}`);
  params.set("service_date", `eq.${serviceDate}`);
  params.set("order", "scheduled_start_at.asc,run_code.asc");
  params.set("limit", "500");
  let runRows = await supabaseRequest(
    env,
    `shuttle_runs?${params.toString()}`
  );
  runRows = Array.isArray(runRows) ? runRows : [];

  if (
    ["driver", "attendant"].includes(session.role) &&
    session.actorId
  ) {
    const assignmentParams = new URLSearchParams();
    assignmentParams.set("select", "run_id");
    assignmentParams.set("facility_id", `eq.${facilityId}`);
    assignmentParams.set("staff_id", `eq.${session.actorId}`);
    assignmentParams.set("duty", `eq.${session.role}`);
    const assignedRows = await supabaseRequest(
      env,
      `shuttle_run_staff?${assignmentParams.toString()}`
    );
    const allowedRunIds = new Set(
      (assignedRows || []).map((row) => row.run_id)
    );
    runRows = runRows.filter((run) => allowedRunIds.has(run.id));
  }
  return await hydrateRuns(env, facilityId, runRows);
}

async function loadRunDetail(env, facilityId, runId) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,service_date,run_code,service_type,route_group_code,scheduled_start_at,scheduled_end_at,actual_start_at,actual_end_at,vehicle_id,run_status,notes,version,created_at,updated_at"
  );
  params.set("id", `eq.${runId}`);
  params.set("facility_id", `eq.${facilityId}`);
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_runs?${params.toString()}`
  );
  if (!Array.isArray(rows) || !rows[0]) {
    throw new AppError(
      404,
      "RUN_NOT_FOUND",
      "対象の送迎便が見つかりません。"
    );
  }
  const hydrated = await hydrateRuns(env, facilityId, [rows[0]]);
  return hydrated[0];
}

async function hydrateRuns(env, facilityId, runRows) {
  if (!Array.isArray(runRows) || runRows.length === 0) {
    return [];
  }
  const runIds = runRows.map((row) => row.id);
  const stopParams = new URLSearchParams();
  stopParams.set(
    "select",
    "id,run_id,rider_id,regular_schedule_id,stop_order,pickup_location_id,dropoff_location_id,planned_pickup_at,planned_dropoff_at,actual_boarded_at,actual_arrived_at,actual_handed_over_at,actual_completed_at,stop_status,seat_units,wheelchair_units,support_summary,handover_notes,version,updated_at"
  );
  stopParams.set("facility_id", `eq.${facilityId}`);
  stopParams.set("run_id", `in.(${runIds.join(",")})`);
  stopParams.set("order", "stop_order.asc");
  stopParams.set("limit", "5000");

  const assignmentParams = new URLSearchParams();
  assignmentParams.set(
    "select",
    "run_id,staff_id,duty,created_at"
  );
  assignmentParams.set("facility_id", `eq.${facilityId}`);
  assignmentParams.set("run_id", `in.(${runIds.join(",")})`);
  assignmentParams.set("limit", "2000");

  const [stopRowsRaw, assignmentRowsRaw] = await Promise.all([
    supabaseRequest(
      env,
      `shuttle_stops?${stopParams.toString()}`
    ),
    supabaseRequest(
      env,
      `shuttle_run_staff?${assignmentParams.toString()}`
    ),
  ]);
  const stopRows = Array.isArray(stopRowsRaw) ? stopRowsRaw : [];
  const assignmentRows = Array.isArray(assignmentRowsRaw)
    ? assignmentRowsRaw
    : [];
  const riderIds = [...new Set(stopRows.map((row) => row.rider_id))];
  const vehicleIds = [
    ...new Set(
      runRows.map((row) => row.vehicle_id).filter(Boolean)
    ),
  ];
  const staffIds = [
    ...new Set(assignmentRows.map((row) => row.staff_id)),
  ];
  const pickupLocationIds = stopRows.map(
    (row) => row.pickup_location_id
  );
  const dropoffLocationIds = stopRows.map(
    (row) => row.dropoff_location_id
  );
  const locationIds = [
    ...new Set([...pickupLocationIds, ...dropoffLocationIds]),
  ];

  const [riderRows, vehicleRows, staffRows, locationRows] =
    await Promise.all([
      fetchRowsByIds(
        env,
        "shuttle_riders",
        facilityId,
        riderIds,
        "id,rider_code,full_name,full_name_kana,transport_support_level,uses_wheelchair,requires_handover,transport_notes,is_active,updated_at"
      ),
      fetchRowsByIds(
        env,
        "shuttle_vehicles",
        facilityId,
        vehicleIds,
        "id,vehicle_code,vehicle_name,plate_number,passenger_capacity,wheelchair_capacity,has_lift,vehicle_status,is_active,updated_at"
      ),
      fetchRowsByIds(
        env,
        "shuttle_staff",
        facilityId,
        staffIds,
        "id,staff_code,full_name,staff_role,is_active,updated_at"
      ),
      fetchRowsByIds(
        env,
        "shuttle_locations",
        facilityId,
        locationIds,
        "id,location_type,location_name,address_line1,address_line2,access_notes,is_active,updated_at"
      ),
    ]);

  const riders = new Map(riderRows.map((row) => [row.id, row]));
  const vehicles = new Map(vehicleRows.map((row) => [row.id, row]));
  const staff = new Map(staffRows.map((row) => [row.id, row]));
  const locations = new Map(
    locationRows.map((row) => [row.id, row])
  );
  const stopsByRun = new Map();
  for (const row of stopRows) {
    const collection = stopsByRun.get(row.run_id) || [];
    collection.push(
      publicStop(
        row,
        riders.get(row.rider_id),
        locations.get(row.pickup_location_id),
        locations.get(row.dropoff_location_id)
      )
    );
    stopsByRun.set(row.run_id, collection);
  }
  const assignmentsByRun = new Map();
  for (const row of assignmentRows) {
    const collection = assignmentsByRun.get(row.run_id) || [];
    collection.push({
      staffId: row.staff_id,
      duty: row.duty,
      staff: publicStaff(staff.get(row.staff_id)),
    });
    assignmentsByRun.set(row.run_id, collection);
  }
  return runRows.map((row) =>
    publicRun(
      row,
      row.vehicle_id ? vehicles.get(row.vehicle_id) : null,
      assignmentsByRun.get(row.id) || [],
      stopsByRun.get(row.id) || []
    )
  );
}

async function fetchRowsByIds(
  env,
  table,
  facilityId,
  ids,
  select
) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }
  const params = new URLSearchParams();
  params.set("select", select);
  params.set("facility_id", `eq.${facilityId}`);
  params.set("id", `in.(${ids.join(",")})`);
  params.set("limit", String(Math.max(ids.length, 1)));
  const rows = await supabaseRequest(
    env,
    `${table}?${params.toString()}`
  );
  return Array.isArray(rows) ? rows : [];
}

async function assertRunAccess(env, session, runId) {
  if (!["driver", "attendant"].includes(session.role)) {
    return;
  }
  if (!session.actorId) {
    throw new AppError(
      403,
      "STAFF_LOGIN_REQUIRED",
      "スタッフログインが必要です。"
    );
  }
  const params = new URLSearchParams();
  params.set("select", "run_id");
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("run_id", `eq.${runId}`);
  params.set("staff_id", `eq.${session.actorId}`);
  params.set("duty", `eq.${session.role}`);
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_run_staff?${params.toString()}`
  );
  if (!Array.isArray(rows) || !rows[0]) {
    throw new AppError(
      403,
      "RUN_NOT_ASSIGNED",
      "担当していない送迎便は表示できません。"
    );
  }
}

async function findRiderById(env, facilityId, riderId) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,rider_code,full_name,full_name_kana,phone,phone_normalized,transport_support_level,uses_wheelchair,requires_handover,transport_notes,emergency_contact_name,emergency_contact_phone,is_active,created_at,updated_at"
  );
  params.set("id", `eq.${riderId}`);
  params.set("facility_id", `eq.${facilityId}`);
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_riders?${params.toString()}`
  );
  const rider = Array.isArray(rows) ? rows[0] : null;
  if (!rider) {
    throw new AppError(
      404,
      "RIDER_NOT_FOUND",
      "対象の患者が見つかりません。"
    );
  }
  return rider;
}

async function assertRiderNotDuplicated(
  env,
  facilityId,
  fullName,
  phone,
  excludeRiderId = null
) {
  if (!phone) {
    return;
  }
  const params = new URLSearchParams();
  params.set("select", "id,rider_code,full_name");
  params.set("facility_id", `eq.${facilityId}`);
  params.set("full_name", `eq.${fullName}`);
  params.set(
    "phone_normalized",
    `eq.${normalizeJapanesePhone(phone)}`
  );
  params.set("is_active", "eq.true");
  if (excludeRiderId) {
    params.set("id", `neq.${excludeRiderId}`);
  }
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_riders?${params.toString()}`
  );
  if (Array.isArray(rows) && rows[0]) {
    throw new AppError(
      409,
      "RIDER_DUPLICATE",
      "同じ氏名と電話番号の患者がすでに登録されています。"
    );
  }
}

async function assertGuardianNotDuplicated(
  env,
  facilityId,
  fullName,
  phone
) {
  const params = new URLSearchParams();
  params.set("select", "id,guardian_code,full_name");
  params.set("facility_id", `eq.${facilityId}`);
  params.set("full_name", `eq.${fullName}`);
  params.set(
    "phone_normalized",
    `eq.${normalizeJapanesePhone(phone)}`
  );
  params.set("is_active", "eq.true");
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_guardians?${params.toString()}`
  );
  if (Array.isArray(rows) && rows[0]) {
    throw new AppError(
      409,
      "GUARDIAN_DUPLICATE",
      "同じ氏名と電話番号の家族がすでに登録されています。"
    );
  }
}

async function assertGuardianCanChangeRider(
  env,
  facilityId,
  guardianId,
  riderId
) {
  const params = new URLSearchParams();
  params.set("select", "id");
  params.set("facility_id", `eq.${facilityId}`);
  params.set("guardian_id", `eq.${guardianId}`);
  params.set("rider_id", `eq.${riderId}`);
  params.set("can_request_change", "eq.true");
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_guardian_rider_links?${params.toString()}`
  );
  if (!Array.isArray(rows) || !rows[0]) {
    throw new AppError(
      403,
      "RIDER_ACCESS_DENIED",
      "この患者の送迎変更を依頼する権限がありません。"
    );
  }
}

async function assertRegularScheduleRules(
  env,
  facilityId,
  pickupTime,
  dropoffTime,
  effectiveFrom,
  effectiveTo
) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "schedule_step_minutes,business_start_time,business_end_time"
  );
  params.set("facility_id", `eq.${facilityId}`);
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_settings?${params.toString()}`
  );
  const settings = Array.isArray(rows) ? rows[0] : null;
  if (!settings) {
    throw new AppError(
      503,
      "FACILITY_SETTINGS_MISSING",
      "診療所の送迎時間設定が見つかりません。"
    );
  }
  const pickupMinutes = timeToMinutes(pickupTime);
  const dropoffMinutes = timeToMinutes(dropoffTime);
  const startMinutes = timeToMinutes(settings.business_start_time);
  const endMinutes = timeToMinutes(settings.business_end_time);
  const step = Number(settings.schedule_step_minutes);

  if (
    pickupMinutes < startMinutes ||
    dropoffMinutes > endMinutes
  ) {
    throw new AppError(
      400,
      "OUTSIDE_BUSINESS_HOURS",
      "送迎予定時刻が診療所の運行時間外です。"
    );
  }
  if (
    pickupMinutes % step !== 0 ||
    dropoffMinutes % step !== 0
  ) {
    throw new AppError(
      400,
      "INVALID_TIME_STEP",
      `送迎予定時刻は${step}分単位で入力してください。`
    );
  }
  if (
    dropoffMinutes <= pickupMinutes ||
    dropoffMinutes - pickupMinutes > 360
  ) {
    throw new AppError(
      400,
      "INVALID_TIME_RANGE",
      "降車予定時刻は乗車予定時刻より後、6時間以内で指定してください。"
    );
  }
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new AppError(
      400,
      "INVALID_EFFECTIVE_RANGE",
      "適用終了日は適用開始日以降にしてください。"
    );
  }
}

function timeToMinutes(value) {
  if (typeof value !== "string") {
    return Number.NaN;
  }
  const parts = value.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

async function runIdempotentOperation(
  request,
  env,
  session,
  scope,
  requestBody,
  corsOrigin,
  requestId,
  operation
) {
  const idempotencyKey = requireIdempotencyKey(request, requestBody);
  const requestHash = await shortHmac(
    env.SESSION_SECRET,
    `${scope}:${stableJson(requestBody)}`
  );
  let existing = await fetchIdempotencyRecord(
    env,
    session.facilityId,
    scope,
    idempotencyKey
  );
  if (existing) {
    return resolveIdempotencyRecord(
      existing,
      requestHash,
      corsOrigin,
      requestId
    );
  }

  try {
    await supabaseRequest(env, "shuttle_idempotency_keys", {
      method: "POST",
      body: {
        facility_id: session.facilityId,
        scope,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        processing_status: "processing",
        expires_at: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString(),
      },
      prefer: "return=minimal",
    });
  } catch (error) {
    if (error instanceof AppError && error.status === 409) {
      existing = await fetchIdempotencyRecord(
        env,
        session.facilityId,
        scope,
        idempotencyKey
      );
      if (existing) {
        return resolveIdempotencyRecord(
          existing,
          requestHash,
          corsOrigin,
          requestId
        );
      }
    }
    throw error;
  }

  try {
    const result = await operation(idempotencyKey);
    const responseBody = {
      ok: true,
      ...result.payload,
    };
    await updateIdempotencyRecord(
      env,
      session.facilityId,
      scope,
      idempotencyKey,
      {
        processing_status: "completed",
        response_status: result.status,
        response_body: responseBody,
      }
    );
    return successResponse(
      result.payload,
      result.status,
      corsOrigin,
      requestId
    );
  } catch (error) {
    const appError = normalizeError(error);
    try {
      await updateIdempotencyRecord(
        env,
        session.facilityId,
        scope,
        idempotencyKey,
        {
          processing_status: "failed",
          response_status: appError.status,
          response_body: {
            ok: false,
            error: {
              code: appError.code,
              message: appError.message,
            },
          },
        }
      );
    } catch (updateError) {
      logError(
        normalizeError(updateError),
        requestId,
        request
      );
    }
    throw appError;
  }
}

async function fetchIdempotencyRecord(
  env,
  facilityId,
  scope,
  idempotencyKey
) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "request_hash,processing_status,response_status,response_body,expires_at"
  );
  params.set("facility_id", `eq.${facilityId}`);
  params.set("scope", `eq.${scope}`);
  params.set("idempotency_key", `eq.${idempotencyKey}`);
  params.set("limit", "1");
  const rows = await supabaseRequest(
    env,
    `shuttle_idempotency_keys?${params.toString()}`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function updateIdempotencyRecord(
  env,
  facilityId,
  scope,
  idempotencyKey,
  changes
) {
  const params = new URLSearchParams();
  params.set("facility_id", `eq.${facilityId}`);
  params.set("scope", `eq.${scope}`);
  params.set("idempotency_key", `eq.${idempotencyKey}`);
  await supabaseRequest(
    env,
    `shuttle_idempotency_keys?${params.toString()}`,
    {
      method: "PATCH",
      body: changes,
      prefer: "return=minimal",
    }
  );
}

function resolveIdempotencyRecord(
  record,
  requestHash,
  corsOrigin,
  requestId
) {
  if (record.request_hash !== requestHash) {
    throw new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "同じ二重送信防止キーが別の内容で使用されています。画面を更新してください。"
    );
  }
  if (
    record.processing_status === "completed" &&
    record.response_body &&
    Number.isInteger(record.response_status)
  ) {
    const response = new Response(
      JSON.stringify({
        ...record.response_body,
        requestId,
      }),
      {
        status: record.response_status,
        headers: responseHeaders(corsOrigin, requestId),
      }
    );
    response.headers.set("x-idempotent-replay", "true");
    return response;
  }
  if (record.processing_status === "processing") {
    throw new AppError(
      409,
      "REQUEST_IN_PROGRESS",
      "同じ操作を処理中です。少し待って画面を更新してください。"
    );
  }
  throw new AppError(
    409,
    "PREVIOUS_REQUEST_FAILED",
    "前回の処理は完了していません。画面を更新してから再度お試しください。"
  );
}

function stableJson(value) {
  return JSON.stringify(canonicalizeJson(value));
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = canonicalizeJson(value[key]);
    }
    return output;
  }
  return value;
}

function publicStaff(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    staffCode: row.staff_code,
    fullName: row.full_name,
    staffRole: row.staff_role,
    phone: row.phone ?? null,
    loginId: row.login_id ?? null,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function publicVehicle(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    vehicleCode: row.vehicle_code,
    vehicleName: row.vehicle_name,
    plateNumber: row.plate_number ?? null,
    passengerCapacity: row.passenger_capacity,
    wheelchairCapacity: row.wheelchair_capacity,
    hasLift: row.has_lift,
    vehicleStatus: row.vehicle_status,
    isActive: row.is_active,
    updatedAt: row.updated_at ?? null,
  };
}

function publicRider(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    riderCode: row.rider_code,
    fullName: row.full_name,
    fullNameKana: row.full_name_kana ?? null,
    phone: row.phone ?? null,
    transportSupportLevel: row.transport_support_level,
    usesWheelchair: row.uses_wheelchair,
    requiresHandover: row.requires_handover,
    transportNotes: row.transport_notes ?? null,
    emergencyContactName: row.emergency_contact_name ?? null,
    emergencyContactPhone: row.emergency_contact_phone ?? null,
    isActive: row.is_active,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function publicGuardian(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    guardianCode: row.guardian_code,
    fullName: row.full_name,
    relationship: row.relationship ?? null,
    phone: row.phone,
    hasLineLink: Boolean(row.line_user_id),
    linkStatus: row.link_status,
    notificationPreferences:
      row.notification_preferences || {},
    isActive: row.is_active,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function publicGuardianLink(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    guardianId: row.guardian_id,
    riderId: row.rider_id,
    isPrimary: row.is_primary,
    canViewSchedule: row.can_view_schedule,
    canRequestChange: row.can_request_change,
    approvedAt: row.approved_at ?? null,
  };
}

function publicMemberGuardian(row) {
  return {
    id: row.id,
    guardianCode: row.guardian_code,
    fullName: row.full_name,
    relationship: row.relationship ?? null,
  };
}

function publicMemberRider(row, link) {
  if (!row || !link) {
    return null;
  }
  return {
    id: row.id,
    riderCode: row.rider_code,
    fullName: row.full_name,
    isPrimary: Boolean(link.is_primary),
    canViewSchedule: Boolean(link.can_view_schedule),
    canRequestChange: Boolean(link.can_request_change),
  };
}

function publicMemberSchedule(row, rider, locationById) {
  const pickup = locationById.get(row.pickup_location_id);
  const dropoff = locationById.get(row.dropoff_location_id);
  return {
    id: row.id,
    riderId: row.rider_id,
    riderName: rider?.full_name || "患者",
    serviceType: row.service_type,
    scheduledPickupTime: row.scheduled_pickup_time,
    scheduledDropoffTime: row.scheduled_dropoff_time,
    pickupLocationName: pickup?.location_name || "乗車場所",
    dropoffLocationName: dropoff?.location_name || "降車場所",
  };
}

function publicMemberStop(row, rider, run, locationById) {
  const pickup = locationById.get(row.pickup_location_id);
  const dropoff = locationById.get(row.dropoff_location_id);
  return {
    id: row.id,
    riderId: row.rider_id,
    riderName: rider?.full_name || "患者",
    runCode: run?.run_code || null,
    serviceType: run?.service_type || null,
    runStatus: run?.run_status || null,
    stopStatus: row.stop_status,
    plannedPickupAt: row.planned_pickup_at,
    plannedDropoffAt: row.planned_dropoff_at,
    actualBoardedAt: row.actual_boarded_at ?? null,
    actualArrivedAt: row.actual_arrived_at ?? null,
    actualHandedOverAt: row.actual_handed_over_at ?? null,
    actualCompletedAt: row.actual_completed_at ?? null,
    pickupLocationName: pickup?.location_name || "乗車場所",
    dropoffLocationName: dropoff?.location_name || "降車場所",
  };
}

function publicMemberChangeRequest(row) {
  return {
    id: row.id,
    riderId: row.rider_id,
    serviceDate: row.service_date,
    requestType: row.request_type,
    requestedChanges: row.requested_changes || {},
    requestStatus: row.request_status,
    reviewedAt: row.reviewed_at ?? null,
    reviewNotes: row.review_notes ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function publicLocation(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    riderId: row.rider_id ?? null,
    locationType: row.location_type,
    locationName: row.location_name,
    postalCode: row.postal_code ?? null,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2 ?? null,
    latitude:
      row.latitude === null || row.latitude === undefined
        ? null
        : Number(row.latitude),
    longitude:
      row.longitude === null || row.longitude === undefined
        ? null
        : Number(row.longitude),
    accessNotes: row.access_notes ?? null,
    isDefaultPickup: row.is_default_pickup,
    isDefaultDropoff: row.is_default_dropoff,
    isActive: row.is_active,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function publicRegularSchedule(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    riderId: row.rider_id,
    dayOfWeek: row.day_of_week,
    serviceType: row.service_type,
    routeGroupCode: row.route_group_code,
    pickupLocationId: row.pickup_location_id,
    dropoffLocationId: row.dropoff_location_id,
    scheduledPickupTime: row.scheduled_pickup_time,
    scheduledDropoffTime: row.scheduled_dropoff_time,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to ?? null,
    notes: row.notes ?? null,
    isActive: row.is_active,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function publicRun(row, vehicle, assignments, stops) {
  return {
    id: row.id,
    serviceDate: row.service_date,
    runCode: row.run_code,
    serviceType: row.service_type,
    routeGroupCode: row.route_group_code,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    actualStartAt: row.actual_start_at ?? null,
    actualEndAt: row.actual_end_at ?? null,
    runStatus: row.run_status,
    notes: row.notes ?? null,
    version: row.version,
    vehicle: publicVehicle(vehicle),
    assignments,
    stops,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function publicStop(row, rider, pickupLocation, dropoffLocation) {
  return {
    id: row.id,
    runId: row.run_id,
    riderId: row.rider_id,
    rider: publicRider(rider),
    regularScheduleId: row.regular_schedule_id ?? null,
    stopOrder: row.stop_order,
    pickupLocation: publicLocation(pickupLocation),
    dropoffLocation: publicLocation(dropoffLocation),
    plannedPickupAt: row.planned_pickup_at,
    plannedDropoffAt: row.planned_dropoff_at,
    actualBoardedAt: row.actual_boarded_at ?? null,
    actualArrivedAt: row.actual_arrived_at ?? null,
    actualHandedOverAt: row.actual_handed_over_at ?? null,
    actualCompletedAt: row.actual_completed_at ?? null,
    stopStatus: row.stop_status,
    seatUnits: row.seat_units,
    wheelchairUnits: row.wheelchair_units,
    supportSummary: row.support_summary ?? null,
    handoverNotes: row.handover_notes ?? null,
    version: row.version,
    updatedAt: row.updated_at ?? null,
  };
}

function publicChangeRequest(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    riderId: row.rider_id,
    guardianId: row.guardian_id ?? null,
    requestedByStaffId: row.requested_by_staff_id ?? null,
    serviceDate: row.service_date,
    requestType: row.request_type,
    requestedChanges: row.requested_changes || {},
    requestStatus: row.request_status,
    reviewedByStaffId: row.reviewed_by_staff_id ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNotes: row.review_notes ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
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
      "診療所コードまたは認証情報が正しくありません。"
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
      "この診療所は現在利用できません。"
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
  if (
    env.DPRO_SYSTEM_CODE &&
    String(env.DPRO_SYSTEM_CODE) !== SYSTEM_CODE
  ) {
    throw new AppError(
      503,
      "DPRO_SYSTEM_CODE_MISMATCH",
      "システム識別設定が一致していません。管理者へ連絡してください。"
    );
  }
  if (
    env.SUPABASE_SCHEMA &&
    String(env.SUPABASE_SCHEMA) !== SUPABASE_SCHEMA
  ) {
    throw new AppError(
      503,
      "DPRO_SCHEMA_MISMATCH",
      "データベース分離設定が一致していません。管理者へ連絡してください。"
    );
  }
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

  // DPRO system isolation: this product uses a dedicated PostgREST schema.
  headers.set("accept-profile", SUPABASE_SCHEMA);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(String(method).toUpperCase())) {
    headers.set("content-profile", SUPABASE_SCHEMA);
  }

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

  if (
    status === 409 ||
    databaseCode === "23505" ||
    databaseCode === "23P01"
  ) {
    return new AppError(
      409,
      "DUPLICATE_CONFLICT",
      databaseCode === "23P01"
        ? "同じ時間帯に車両・スタッフ・患者の予定が重複しています。別の時間または担当を選択してください。"
        : "同じ内容がすでに登録されています。画面を更新してご確認ください。",
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
  if (databaseCode === "23503") {
    return new AppError(
      404,
      "RELATED_RECORD_NOT_FOUND",
      "指定した患者・場所・車両・スタッフが見つかりません。画面を更新してください。",
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
  const token = `${signingInput}.${base64UrlEncodeBytes(signature)}`;
  if (payload.actor_type === "staff" && isUuid(payload.actor_id)) {
    await registerStaffSession(env, payload);
  }
  return token;
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

  if (payload.actor_type === "staff" && isUuid(payload.actor_id)) {
    await assertCurrentStaffSession(env, payload);
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


async function registerStaffSession(env, payload) {
  await supabaseRequest(env, "shuttle_staff_sessions", {
    method: "POST",
    body: {
      id: payload.jti,
      facility_id: payload.facility_id,
      staff_id: payload.actor_id,
      role: payload.role,
      issued_at: new Date(payload.iat * 1000).toISOString(),
      expires_at: new Date(payload.exp * 1000).toISOString(),
    },
    prefer: "return=minimal",
  });
}

async function revokeStaffSession(
  env,
  facilityId,
  staffId,
  jti,
  reason
) {
  const params = new URLSearchParams();
  params.set("id", `eq.${jti}`);
  params.set("facility_id", `eq.${facilityId}`);
  params.set("staff_id", `eq.${staffId}`);
  params.set("revoked_at", "is.null");
  await supabaseRequest(
    env,
    `shuttle_staff_sessions?${params.toString()}`,
    {
      method: "PATCH",
      body: {
        revoked_at: new Date().toISOString(),
        revoked_reason: reason,
      },
      prefer: "return=minimal",
    }
  );
}

async function revokeStaffSessionsForAuthorityChange(
  env,
  facilityId,
  staffId
) {
  const params = new URLSearchParams();
  params.set("facility_id", `eq.${facilityId}`);
  params.set("staff_id", `eq.${staffId}`);
  params.set("revoked_at", "is.null");
  await supabaseRequest(
    env,
    `shuttle_staff_sessions?${params.toString()}`,
    {
      method: "PATCH",
      body: {
        revoked_at: new Date().toISOString(),
        revoked_reason: "staff_authority_changed",
      },
      prefer: "return=minimal",
    }
  );
}

async function assertCurrentStaffSession(env, payload) {
  const nowIso = new Date().toISOString();
  const sessionParams = new URLSearchParams();
  sessionParams.set("select", "id,role,expires_at,revoked_at");
  sessionParams.set("id", `eq.${payload.jti}`);
  sessionParams.set("facility_id", `eq.${payload.facility_id}`);
  sessionParams.set("staff_id", `eq.${payload.actor_id}`);
  sessionParams.set("revoked_at", "is.null");
  sessionParams.set("expires_at", `gt.${nowIso}`);
  sessionParams.set("limit", "1");

  const staffParams = new URLSearchParams();
  staffParams.set("select", "id,staff_role,is_active");
  staffParams.set("id", `eq.${payload.actor_id}`);
  staffParams.set("facility_id", `eq.${payload.facility_id}`);
  staffParams.set("is_active", "eq.true");
  staffParams.set("limit", "1");

  const [sessionRows, staffRows] = await Promise.all([
    supabaseRequest(
      env,
      `shuttle_staff_sessions?${sessionParams.toString()}`
    ),
    supabaseRequest(
      env,
      `shuttle_staff?${staffParams.toString()}`
    ),
  ]);
  const serverSession = Array.isArray(sessionRows)
    ? sessionRows[0]
    : null;
  const staff = Array.isArray(staffRows) ? staffRows[0] : null;

  if (!serverSession) {
    throw new AppError(
      401,
      "SESSION_REVOKED",
      "ログイン情報は無効になりました。もう一度ログインしてください。"
    );
  }
  if (
    !staff ||
    serverSession.role !== payload.role ||
    staff.staff_role !== payload.role
  ) {
    await revokeStaffSession(
      env,
      payload.facility_id,
      payload.actor_id,
      payload.jti,
      "staff_authority_changed"
    );
    throw new AppError(
      401,
      "STAFF_AUTHORITY_CHANGED",
      "スタッフ権限が変更されました。もう一度ログインしてください。"
    );
  }
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
      old_data: entry.oldData ?? null,
      new_data: entry.newData ?? null,
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

async function verifyPbkdf2Pin(pin, storedHash, sessionSecret) {
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
    iterations > PIN_PBKDF2_ITERATIONS
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
    pinSecretMaterial(pin, sessionSecret),
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

async function hashPbkdf2Pin(pin, sessionSecret) {
  const iterations = PIN_PBKDF2_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    pinSecretMaterial(pin, sessionSecret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    keyMaterial,
    256
  );
  return [
    "pbkdf2-sha256",
    String(iterations),
    base64UrlEncodeBytes(salt),
    base64UrlEncodeBytes(new Uint8Array(bits)),
  ].join("$");
}

function pinSecretMaterial(pin, sessionSecret) {
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32) {
    throw new AppError(
      503,
      "SESSION_SECRET_NOT_CONFIGURED",
      "セッション秘密情報が設定されていません。"
    );
  }
  return encoder.encode(`${pin}\u0000${sessionSecret}`);
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
  const code = requireString(value, "診療所コード", 3, 64);
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(code)) {
    throw new AppError(
      400,
      "INVALID_FACILITY_CODE",
      "診療所コードの形式が正しくありません。"
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

function requireCode(value, label, maxLength = 64) {
  const code = requireString(value, label, 1, maxLength);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code)) {
    throw new AppError(
      400,
      "INVALID_CODE",
      `${label}は半角英数字・ハイフン・アンダーバーで入力してください。`
    );
  }
  return code;
}

function optionalLoginId(value) {
  const loginId = optionalString(value, "ログインID", 3, 100);
  if (
    loginId &&
    !/^[A-Za-z0-9._@-]{3,100}$/.test(loginId)
  ) {
    throw new AppError(
      400,
      "INVALID_LOGIN_ID",
      "ログインIDは半角英数字と記号（._@-）で入力してください。"
    );
  }
  return loginId;
}

function optionalPin(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const pin = requireString(value, "暗証番号", 4, 12);
  if (!/^[0-9]{4,12}$/.test(pin)) {
    throw new AppError(
      400,
      "INVALID_PIN",
      "暗証番号は4～12桁の半角数字で入力してください。"
    );
  }
  return pin;
}

function requireUuid(value, label) {
  if (!isUuid(value)) {
    throw new AppError(
      400,
      "INVALID_UUID",
      `${label}の形式が正しくありません。`
    );
  }
  return value.toLowerCase();
}

function optionalUuid(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireUuid(value, label);
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new AppError(
      400,
      "INVALID_BOOLEAN",
      `${label}の指定が正しくありません。`
    );
  }
  return value;
}

function optionalBoolean(value, defaultValue, label) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return requireBoolean(value, label);
}

function requireInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (
    !Number.isInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw new AppError(
      400,
      "INVALID_INTEGER",
      `${label}の数値を確認してください。`
    );
  }
  return number;
}

function optionalNumber(value, label, minimum, maximum) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw new AppError(
      400,
      "INVALID_NUMBER",
      `${label}の数値を確認してください。`
    );
  }
  return number;
}

function requireEnum(value, label, allowedValues) {
  if (
    typeof value !== "string" ||
    !allowedValues.includes(value)
  ) {
    throw new AppError(
      400,
      "INVALID_ENUM",
      `${label}の選択内容が正しくありません。`
    );
  }
  return value;
}

function optionalEnum(
  value,
  label,
  allowedValues,
  defaultValue = null
) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return requireEnum(value, label, allowedValues);
}

function requireDate(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new AppError(
      400,
      "INVALID_DATE",
      `${label}をYYYY-MM-DD形式で入力してください。`
    );
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AppError(
      400,
      "INVALID_DATE",
      `${label}に存在しない日付が指定されています。`
    );
  }
  return value;
}

function optionalDate(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireDate(value, label);
}

function assertNotPastJstDate(value, message) {
  if (value < jstDateString(new Date())) {
    throw new AppError(
      400,
      "PAST_SERVICE_DATE",
      message
    );
  }
}

function requireTime(value, label) {
  if (
    typeof value !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
  ) {
    throw new AppError(
      400,
      "INVALID_TIME",
      `${label}を時刻形式で入力してください。`
    );
  }
  return value.length === 5 ? `${value}:00` : value;
}

function requireIsoTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value)
  ) {
    throw new AppError(
      400,
      "INVALID_TIMESTAMP",
      `${label}の日時形式が正しくありません。`
    );
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new AppError(
      400,
      "INVALID_TIMESTAMP",
      `${label}の日時形式が正しくありません。`
    );
  }
  // Supabase/PostgreSQLのtimestamptzはマイクロ秒精度を返す場合がある。
  // Date#toISOString()へ変換するとミリ秒精度に切り詰められ、
  // updated_atの楽観ロック比較が同一値でも不一致になるため原文を保持する。
  return value;
}

function optionalIsoTimestamp(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireIsoTimestamp(value, label);
}

function requirePhone(value, label) {
  if (typeof value !== "string") {
    throw new AppError(
      400,
      "PHONE_REQUIRED",
      `${label}を入力してください。`
    );
  }
  const phone = value.trim();
  const normalizedPhone = normalizeJapanesePhone(phone);
  if (!normalizedPhone) {
    throw new AppError(
      400,
      "INVALID_PHONE",
      `${label}は日本国内の電話番号で入力してください。`
    );
  }
  return normalizedPhone;
}

function optionalPhone(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requirePhone(value, label);
}

function normalizeJapanesePhone(value) {
  if (typeof value !== "string") {
    return null;
  }
  const halfWidth = value.replace(/[０-９]/g, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0)
  );
  let digits = halfWidth.replace(/[^0-9]/g, "");
  if (digits.startsWith("0081") && digits.length >= 13) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith("81") && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  }
  return /^0[0-9]{9,10}$/.test(digits) ? digits : null;
}

function requirePlainObject(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new AppError(
      400,
      "INVALID_OBJECT",
      `${label}の形式が正しくありません。`
    );
  }
  return value;
}

function requireOptionalPlainObject(value, label) {
  if (value === undefined || value === null) {
    return {};
  }
  return requirePlainObject(value, label);
}

function validateRequestedChanges(requestType, value, label) {
  const input = requirePlainObject(value, label);
  const allowedByType = {
    absence: ["reason", "direction", "note"],
    time_change: [
      "requestedPickupTime",
      "requestedDropoffTime",
      "note",
    ],
    location_change: [
      "pickupLocationId",
      "dropoffLocationId",
      "note",
    ],
    one_way: ["direction", "note"],
    temporary_use: [
      "serviceType",
      "pickupLocationId",
      "dropoffLocationId",
      "requestedPickupTime",
      "requestedDropoffTime",
      "note",
    ],
    other: ["note"],
  };
  const allowed = allowedByType[requestType] || [];
  const output = {};
  for (const [key, rawValue] of Object.entries(input)) {
    if (!allowed.includes(key)) {
      throw new AppError(
        400,
        "INVALID_CHANGE_FIELD",
        "変更内容に対応していない項目が含まれています。"
      );
    }
    if (["pickupLocationId", "dropoffLocationId"].includes(key)) {
      output[key] = requireUuid(rawValue, "乗降場所ID");
    } else if (
      ["requestedPickupTime", "requestedDropoffTime"].includes(key)
    ) {
      output[key] = requireTime(rawValue, "希望時刻");
    } else if (key === "direction") {
      output[key] = requireEnum(
        rawValue,
        "対象便",
        ["pickup", "dropoff", "both"]
      );
    } else if (key === "serviceType") {
      output[key] = requireEnum(
        rawValue,
        "送迎区分",
        ["pickup", "dropoff", "transfer"]
      );
    } else {
      output[key] = requireString(rawValue, "変更理由・備考", 1, 1000);
    }
  }
  if (Object.keys(output).length === 0) {
    throw new AppError(
      400,
      "CHANGE_DETAILS_REQUIRED",
      "変更内容を入力してください。"
    );
  }
  return output;
}

function optionalSearchQuery(value) {
  if (value === undefined || value === null || value.trim() === "") {
    return null;
  }
  const query = requireString(value, "検索文字", 1, 50);
  if (!/^[\p{L}\p{N}\sー々・._@+\-]+$/u.test(query)) {
    throw new AppError(
      400,
      "INVALID_SEARCH_QUERY",
      "検索文字に使用できない記号が含まれています。"
    );
  }
  return query;
}

function escapePostgrestSearch(value) {
  return value.replace(/\\/g, "\\\\").replace(/_/g, "\\_");
}

function getQueryLimit(request, defaultValue, maximum) {
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw === null || raw === "") {
    return defaultValue;
  }
  return requireInteger(raw, "表示件数", 1, maximum);
}

function requireIdempotencyKey(request, body = {}) {
  const headerValue = request.headers.get("idempotency-key");
  const bodyValue = body.idempotencyKey;
  if (
    headerValue &&
    bodyValue &&
    headerValue.trim() !== String(bodyValue).trim()
  ) {
    throw new AppError(
      400,
      "IDEMPOTENCY_KEY_MISMATCH",
      "二重送信防止キーが一致しません。画面を更新してください。"
    );
  }
  const key = requireString(
    headerValue || bodyValue,
    "二重送信防止キー",
    8,
    200
  );
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
    throw new AppError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "二重送信防止キーの形式が正しくありません。"
    );
  }
  return key;
}

function requireStaffActor(session) {
  if (session.actorType !== "staff" || !isUuid(session.actorId)) {
    throw new AppError(
      403,
      "STAFF_LOGIN_REQUIRED",
      "この操作にはスタッフIDでのログインが必要です。"
    );
  }
  return session.actorId;
}

function assertHasChanges(changes) {
  if (!changes || Object.keys(changes).length === 0) {
    throw new AppError(
      400,
      "NO_CHANGES",
      "変更する内容を入力してください。"
    );
  }
}

function staleUpdateError() {
  return new AppError(
    409,
    "STALE_UPDATE",
    "ほかの画面で先に更新されています。画面を更新してからもう一度操作してください。"
  );
}

function jstDateString(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
        "GET, POST, PATCH, OPTIONS"
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
    "/v1/auth/member/demo": ["POST"],
    "/v1/auth/logout": ["POST"],
    "/v1/member/link/request": ["POST"],
    "/v1/member/home": ["GET"],
    "/v1/system/check": ["POST"],
    "/v1/demo/prepare": ["POST"],
    "/v1/staff": ["GET", "POST"],
    "/v1/vehicles": ["GET", "POST"],
    "/v1/riders": ["GET", "POST"],
    "/v1/guardians": ["GET", "POST"],
    "/v1/guardian-rider-links": ["GET", "POST"],
    "/v1/locations": ["GET", "POST"],
    "/v1/regular-schedules": ["GET", "POST"],
    "/v1/runs": ["GET"],
    "/v1/runs/generate": ["POST"],
    "/v1/change-requests": ["GET", "POST"],
    "/v1/dashboard/today": ["GET"],
  };

  let allowed = knownMethods[path] || null;
  const dynamicMethods = [
    [/^\/v1\/staff\/[0-9a-f-]{36}$/i, ["PATCH"]],
    [/^\/v1\/vehicles\/[0-9a-f-]{36}$/i, ["PATCH"]],
    [/^\/v1\/riders\/[0-9a-f-]{36}$/i, ["GET", "PATCH"]],
    [/^\/v1\/guardians\/[0-9a-f-]{36}$/i, ["PATCH"]],
    [/^\/v1\/locations\/[0-9a-f-]{36}$/i, ["PATCH"]],
    [
      /^\/v1\/regular-schedules\/[0-9a-f-]{36}$/i,
      ["PATCH"],
    ],
    [/^\/v1\/runs\/[0-9a-f-]{36}$/i, ["GET", "PATCH"]],
    [/^\/v1\/runs\/[0-9a-f-]{36}\/staff$/i, ["POST"]],
    [
      /^\/v1\/runs\/[0-9a-f-]{36}\/staff\/remove$/i,
      ["POST"],
    ],
    [/^\/v1\/stops\/[0-9a-f-]{36}\/events$/i, ["POST"]],
    [/^\/v1\/stops\/[0-9a-f-]{36}\/correct$/i, ["POST"]],
    [
      /^\/v1\/change-requests\/[0-9a-f-]{36}\/review$/i,
      ["POST"],
    ],
  ];
  if (!allowed) {
    for (const [pattern, methods] of dynamicMethods) {
      if (pattern.test(path)) {
        allowed = methods;
        break;
      }
    }
  }

  if (allowed && !allowed.includes(method)) {
    const response = errorResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "この操作方法には対応していません。",
      corsOrigin,
      requestId
    );
    response.headers.set("allow", allowed.join(", "));
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
