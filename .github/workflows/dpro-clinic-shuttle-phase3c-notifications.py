from pathlib import Path
import json

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"PATCH ANCHOR NOT FOUND: {label}")
    return text.replace(old, new, 1)

# =========================================================
# worker.js
# =========================================================
p = Path("worker.js")
s = p.read_text(encoding="utf-8")

if "PHASE3C_NOTIFICATION_DELIVERY_R1" not in s:
    s = s.replace(
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R4.1-20260920";',
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R5-20260920";\n'
        'const PHASE3C_NOTIFICATION_DELIVERY_R1 = true;'
    )

    s = s.replace(
        'apiStage: "CLINIC-SHUTTLE-V2.1-R3",',
        'apiStage: "CLINIC-SHUTTLE-V2.1-R5",',
        1
    )

    old = '''    }
  },
};

async function handleAdminLogin('''
    new = '''    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runScheduledNotificationCycle(env).catch((error) => {
        console.error(
          JSON.stringify({
            level: "error",
            scope: "scheduled-notification-cycle",
            code: error?.code || "NOTIFICATION_SCHEDULE_ERROR",
            message: String(error?.message || error),
            scheduledTime: event?.scheduledTime || null,
          })
        );
      })
    );
  },
};

async function handleAdminLogin('''
    s = replace_once(s, old, new, "scheduled handler")

    marker = "async function handleRideEvent(\n"
    helpers = r'''
const NOTIFICATION_EVENT_CONFIG = Object.freeze({
  en_route: {
    type: "departure",
    setting: "notify_departure",
  },
  boarded: {
    type: "boarding",
    setting: "notify_boarding",
  },
  arrived: {
    type: "arrival",
    setting: "notify_arrival",
  },
});

function lineAccessTokenConfigured(env) {
  return (
    typeof env.LINE_CHANNEL_ACCESS_TOKEN === "string" &&
    env.LINE_CHANNEL_ACCESS_TOKEN.trim().length >= 20
  );
}

function notificationDeliveryMode(env, facilityEnvironment) {
  const requested = String(
    env.LINE_DELIVERY_MODE || "off_safe"
  ).toLowerCase();

  if (
    requested === "live" &&
    lineAccessTokenConfigured(env) &&
    facilityEnvironment === "production"
  ) {
    return "live";
  }

  if (
    requested === "live" &&
    lineAccessTokenConfigured(env) &&
    facilityEnvironment === "demo" &&
    env.ALLOW_DEMO_LINE_DELIVERY === "enabled"
  ) {
    return "live_demo";
  }

  return "off_safe";
}

function guardianNotificationAllowed(preferences, notificationType) {
  const prefs =
    preferences &&
    typeof preferences === "object" &&
    !Array.isArray(preferences)
      ? preferences
      : {};
  const keys = {
    previous_day: ["previousDay", "previous_day"],
    departure: ["departure"],
    boarding: ["boarding"],
    arrival: ["arrival"],
  }[notificationType] || [];

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(prefs, key) &&
      prefs[key] === false
    ) {
      return false;
    }
  }
  return true;
}

function jstTomorrowDateString() {
  return jstDateString(
    new Date(Date.now() + 24 * 60 * 60 * 1000)
  );
}

function notificationTimeLabel(value) {
  if (!value) return "未定";
  const raw = String(value);
  const match = raw.match(/T(\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  const timeMatch = raw.match(/^(\d{2}):(\d{2})/);
  if (timeMatch) return `${timeMatch[1]}:${timeMatch[2]}`;
  return "未定";
}

function buildTransportNotificationMessage(
  notificationType,
  context
) {
  const riderName = String(
    context.rider?.full_name || "ご利用者"
  ).trim();
  const serviceDate = context.run?.service_date || "";
  const pickupTime = notificationTimeLabel(
    context.stop?.planned_pickup_at
  );
  const dropoffTime = notificationTimeLabel(
    context.stop?.planned_dropoff_at
  );

  if (notificationType === "previous_day") {
    return [
      "【DPRO 診療所送迎予約】",
      `${riderName}さんの明日の送迎予定をご案内します。`,
      serviceDate ? `送迎日：${serviceDate}` : null,
      `乗車予定：${pickupTime}`,
      `降車予定：${dropoffTime}`,
      "変更・欠席がある場合は、ご家族用画面または診療所へご連絡ください。",
    ].filter(Boolean).join("\\n");
  }

  if (notificationType === "departure") {
    return [
      "【DPRO 診療所送迎予約】",
      `${riderName}さんのお迎えに向けて送迎車が出発しました。`,
      `乗車予定：${pickupTime}`,
    ].join("\\n");
  }

  if (notificationType === "boarding") {
    return [
      "【DPRO 診療所送迎予約】",
      `${riderName}さんの乗車を確認しました。`,
      `降車予定：${dropoffTime}`,
    ].join("\\n");
  }

  if (notificationType === "arrival") {
    return [
      "【DPRO 診療所送迎予約】",
      `${riderName}さんの到着を確認しました。`,
    ].join("\\n");
  }

  return [
    "【DPRO 診療所送迎予約】",
    `${riderName}さんの送迎状況が更新されました。`,
  ].join("\\n");
}

async function loadStopNotificationContext(
  env,
  facilityId,
  stopId
) {
  const stopParams = new URLSearchParams();
  stopParams.set(
    "select",
    "id,facility_id,run_id,rider_id,planned_pickup_at,planned_dropoff_at,stop_status"
  );
  stopParams.set("id", `eq.${stopId}`);
  stopParams.set("facility_id", `eq.${facilityId}`);
  stopParams.set("limit", "1");
  const stopRows = await supabaseRequest(
    env,
    `shuttle_stops?${stopParams.toString()}`
  );
  const stop = Array.isArray(stopRows)
    ? stopRows[0]
    : null;
  if (!stop) return null;

  const runParams = new URLSearchParams();
  runParams.set(
    "select",
    "id,service_date,service_type,route_group_code,run_status"
  );
  runParams.set("id", `eq.${stop.run_id}`);
  runParams.set("facility_id", `eq.${facilityId}`);
  runParams.set("limit", "1");

  const riderParams = new URLSearchParams();
  riderParams.set("select", "id,full_name");
  riderParams.set("id", `eq.${stop.rider_id}`);
  riderParams.set("facility_id", `eq.${facilityId}`);
  riderParams.set("limit", "1");

  const linkParams = new URLSearchParams();
  linkParams.set(
    "select",
    "guardian_id,can_view_schedule,approved_at"
  );
  linkParams.set("facility_id", `eq.${facilityId}`);
  linkParams.set("rider_id", `eq.${stop.rider_id}`);
  linkParams.set("can_view_schedule", "eq.true");
  linkParams.set("approved_at", "not.is.null");

  const [runRows, riderRows, linkRows] = await Promise.all([
    supabaseRequest(
      env,
      `shuttle_runs?${runParams.toString()}`
    ),
    supabaseRequest(
      env,
      `shuttle_riders?${riderParams.toString()}`
    ),
    supabaseRequest(
      env,
      `shuttle_guardian_rider_links?${linkParams.toString()}`
    ),
  ]);

  const run = Array.isArray(runRows) ? runRows[0] : null;
  const rider = Array.isArray(riderRows)
    ? riderRows[0]
    : null;
  const guardianIds = [
    ...new Set(
      (linkRows || [])
        .map((row) => row.guardian_id)
        .filter(Boolean)
    ),
  ];

  let guardians = [];
  if (guardianIds.length) {
    const guardianParams = new URLSearchParams();
    guardianParams.set(
      "select",
      "id,full_name,line_user_id,link_status,notification_preferences,is_active,deleted_at"
    );
    guardianParams.set("facility_id", `eq.${facilityId}`);
    guardianParams.set(
      "id",
      `in.(${guardianIds.join(",")})`
    );
    guardianParams.set("link_status", "eq.approved");
    guardianParams.set("is_active", "eq.true");
    guardianParams.set("deleted_at", "is.null");
    guardians = await supabaseRequest(
      env,
      `shuttle_guardians?${guardianParams.toString()}`
    );
  }

  return {
    stop,
    run,
    rider,
    guardians: Array.isArray(guardians) ? guardians : [],
  };
}

async function patchNotificationDelivery(
  env,
  facilityId,
  notificationId,
  patch
) {
  const params = new URLSearchParams();
  params.set("id", `eq.${notificationId}`);
  params.set("facility_id", `eq.${facilityId}`);
  await supabaseRequest(
    env,
    `shuttle_notifications?${params.toString()}`,
    {
      method: "PATCH",
      body: patch,
      prefer: "return=minimal",
    }
  );
}

async function pushLineNotification(env, destination, messageText) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    UPSTREAM_TIMEOUT_MS
  );

  let response;
  try {
    response = await fetch(
      "https://api.line.me/v2/bot/message/push",
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "content-type": "application/json; charset=utf-8",
          accept: "application/json",
        },
        body: JSON.stringify({
          to: destination,
          messages: [
            {
              type: "text",
              text: String(messageText).slice(0, 5000),
            },
          ],
        }),
        signal: controller.signal,
      }
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        ok: false,
        code: "line_timeout",
        providerMessageId: null,
      };
    }
    return {
      ok: false,
      code: "line_unreachable",
      providerMessageId: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  const requestId =
    response.headers.get("x-line-request-id") || null;
  if (!response.ok) {
    return {
      ok: false,
      code: `line_http_${response.status}`,
      providerMessageId: requestId,
    };
  }
  return {
    ok: true,
    code: null,
    providerMessageId: requestId,
  };
}

async function dispatchNotificationRecord(
  env,
  facility,
  notification
) {
  if (!notification?.id) return "ignored";

  if (!notification.destination_ref) {
    await patchNotificationDelivery(
      env,
      facility.id,
      notification.id,
      {
        send_status: "skipped",
        error_code: "line_not_linked",
      }
    );
    return "skipped";
  }

  const mode = notificationDeliveryMode(
    env,
    facility.environment
  );
  if (mode === "off_safe") {
    await patchNotificationDelivery(
      env,
      facility.id,
      notification.id,
      {
        send_status: "skipped",
        error_code: "delivery_off_safe",
      }
    );
    return "skipped";
  }

  const result = await pushLineNotification(
    env,
    notification.destination_ref,
    notification.message_text
  );

  if (!result.ok) {
    await patchNotificationDelivery(
      env,
      facility.id,
      notification.id,
      {
        send_status: "failed",
        error_code: result.code,
        provider_message_id:
          result.providerMessageId || null,
      }
    );
    return "failed";
  }

  await patchNotificationDelivery(
    env,
    facility.id,
    notification.id,
    {
      send_status: "sent",
      provider_message_id:
        result.providerMessageId || null,
      error_code: null,
      sent_at: new Date().toISOString(),
    }
  );
  return "sent";
}

async function queueStopNotification(
  env,
  facility,
  stopId,
  notificationType
) {
  const context = await loadStopNotificationContext(
    env,
    facility.id,
    stopId
  );
  if (!context?.stop || !context?.rider) {
    return {
      queued: 0,
      dispatched: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const messageText = buildTransportNotificationMessage(
    notificationType,
    context
  );
  const summary = {
    queued: 0,
    dispatched: 0,
    skipped: 0,
    failed: 0,
  };

  for (const guardian of context.guardians) {
    if (
      !guardianNotificationAllowed(
        guardian.notification_preferences,
        notificationType
      )
    ) {
      continue;
    }

    const idempotencyKey = [
      "notify",
      notificationType,
      context.stop.id,
      guardian.id,
    ].join(":");

    const query = new URLSearchParams();
    query.set(
      "on_conflict",
      "facility_id,idempotency_key"
    );
    const rows = await supabaseRequest(
      env,
      `shuttle_notifications?${query.toString()}`,
      {
        method: "POST",
        body: {
          facility_id: facility.id,
          rider_id: context.stop.rider_id,
          guardian_id: guardian.id,
          stop_id: context.stop.id,
          notification_type: notificationType,
          channel: "line",
          destination_ref:
            guardian.line_user_id || null,
          message_text: messageText,
          send_status: "queued",
          idempotency_key: idempotencyKey,
        },
        prefer:
          "resolution=ignore-duplicates,return=representation",
      }
    );

    const notification = Array.isArray(rows)
      ? rows[0]
      : null;
    if (!notification) {
      continue;
    }

    summary.queued += 1;
    const delivery = await dispatchNotificationRecord(
      env,
      facility,
      notification
    );
    if (delivery === "sent") summary.dispatched += 1;
    if (delivery === "skipped") summary.skipped += 1;
    if (delivery === "failed") summary.failed += 1;
  }

  return summary;
}

async function safelyQueueRideEventNotification(
  env,
  facilityId,
  stopId,
  eventType
) {
  const rule = NOTIFICATION_EVENT_CONFIG[eventType];
  if (!rule) return null;

  try {
    const settings = await loadFacilitySettings(
      env,
      facilityId
    );
    if (!settings?.[rule.setting]) {
      return {
        notificationType: rule.type,
        enabled: false,
      };
    }
    const facility = await findFacilityById(
      env,
      facilityId
    );
    const result = await queueStopNotification(
      env,
      facility,
      stopId,
      rule.type
    );
    return {
      notificationType: rule.type,
      enabled: true,
      ...result,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        scope: "ride-notification",
        facilityId,
        stopId,
        eventType,
        code: error?.code || "NOTIFICATION_ERROR",
        message: String(error?.message || error),
      })
    );
    return {
      notificationType: rule.type,
      enabled: true,
      isolatedFailure: true,
    };
  }
}

async function dispatchQueuedNotifications(
  env,
  facility,
  limit = 50
) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,facility_id,rider_id,guardian_id,stop_id,notification_type,channel,destination_ref,message_text,send_status,created_at"
  );
  params.set("facility_id", `eq.${facility.id}`);
  params.set("send_status", "eq.queued");
  params.set("order", "created_at.asc");
  params.set("limit", String(limit));

  const rows = await supabaseRequest(
    env,
    `shuttle_notifications?${params.toString()}`
  );

  const summary = {
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };
  for (const notification of rows || []) {
    summary.checked += 1;
    const result = await dispatchNotificationRecord(
      env,
      facility,
      notification
    );
    if (result === "sent") summary.sent += 1;
    if (result === "skipped") summary.skipped += 1;
    if (result === "failed") summary.failed += 1;
  }
  return summary;
}

async function queuePreviousDayNotificationsForFacility(
  env,
  facility,
  serviceDate
) {
  const settings = await loadFacilitySettings(
    env,
    facility.id
  );
  if (!settings?.notify_previous_day) {
    return {
      enabled: false,
      runs: 0,
      stops: 0,
    };
  }

  const runParams = new URLSearchParams();
  runParams.set("select", "id");
  runParams.set("facility_id", `eq.${facility.id}`);
  runParams.set("service_date", `eq.${serviceDate}`);
  runParams.set("run_status", "neq.cancelled");
  runParams.set("limit", "500");
  const runs = await supabaseRequest(
    env,
    `shuttle_runs?${runParams.toString()}`
  );
  const runIds = (runs || []).map((row) => row.id);

  if (!runIds.length) {
    return {
      enabled: true,
      runs: 0,
      stops: 0,
    };
  }

  const stopParams = new URLSearchParams();
  stopParams.set("select", "id");
  stopParams.set("facility_id", `eq.${facility.id}`);
  stopParams.set(
    "run_id",
    `in.(${runIds.join(",")})`
  );
  stopParams.set("stop_status", "neq.cancelled");
  stopParams.set("limit", "1000");
  const stops = await supabaseRequest(
    env,
    `shuttle_stops?${stopParams.toString()}`
  );

  for (const stop of stops || []) {
    await queueStopNotification(
      env,
      facility,
      stop.id,
      "previous_day"
    );
  }

  return {
    enabled: true,
    runs: runIds.length,
    stops: Array.isArray(stops) ? stops.length : 0,
  };
}

async function runScheduledNotificationCycle(env) {
  assertBaseConfiguration(env);
  const serviceDate = jstTomorrowDateString();

  const facilityParams = new URLSearchParams();
  facilityParams.set(
    "select",
    "id,facility_code,facility_name,environment,timezone,is_active"
  );
  facilityParams.set("is_active", "eq.true");
  facilityParams.set("limit", "200");
  const facilities = await supabaseRequest(
    env,
    `shuttle_facilities?${facilityParams.toString()}`
  );

  const summary = {
    serviceDate,
    facilities: 0,
    previousDayStops: 0,
    pendingChecked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const facility of facilities || []) {
    if (facility.environment !== env.APP_ENVIRONMENT) {
      continue;
    }
    summary.facilities += 1;

    try {
      const queued =
        await queuePreviousDayNotificationsForFacility(
          env,
          facility,
          serviceDate
        );
      summary.previousDayStops += queued.stops || 0;

      const dispatched =
        await dispatchQueuedNotifications(
          env,
          facility,
          100
        );
      summary.pendingChecked += dispatched.checked;
      summary.sent += dispatched.sent;
      summary.skipped += dispatched.skipped;
      summary.failed += dispatched.failed;
    } catch (error) {
      summary.failed += 1;
      console.error(
        JSON.stringify({
          level: "error",
          scope: "facility-notification-cycle",
          facilityId: facility.id,
          code: error?.code || "NOTIFICATION_CYCLE_ERROR",
          message: String(error?.message || error),
        })
      );
    }
  }

  console.log(
    JSON.stringify({
      level: "info",
      scope: "scheduled-notification-cycle",
      ...summary,
    })
  );
  return summary;
}

'''
    if marker not in s:
        raise SystemExit("PATCH ANCHOR NOT FOUND: handleRideEvent")
    s = s.replace(marker, helpers + marker, 1)

    old = '''  const result = await supabaseRpc(
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
  );'''
    new = '''  const result = await supabaseRpc(
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

  const notification =
    await safelyQueueRideEventNotification(
      env,
      session.facilityId,
      stopId,
      eventType
    );

  return successResponse(
    {
      rideEvent: result,
      notification,
    },
    200,
    corsOrigin,
    requestId
  );'''
    s = replace_once(s, old, new, "ride event notification hook")

    old = '''    demoStatus,
    demoMemberStatus,
  ] = await Promise.all(['''
    new = '''    demoStatus,
    demoMemberStatus,
    notificationRows,
  ] = await Promise.all(['''
    s = replace_once(s, old, new, "system check destructure")

    old = '''    facility.environment === "demo"
      ? getDemoMemberStatus(env, facility.id)
      : Promise.resolve(null),
  ]);'''
    new = '''    facility.environment === "demo"
      ? getDemoMemberStatus(env, facility.id)
      : Promise.resolve(null),
    supabaseRequest(
      env,
      `shuttle_notifications?select=send_status&facility_id=eq.${facility.id}&order=created_at.desc&limit=500`
    ),
  ]);'''
    s = replace_once(s, old, new, "system check notification query")

    old = '''  const rateLimitConfigured = Boolean(env.RATE_LIMITER);
  const demoDataOk ='''
    new = '''  const rateLimitConfigured = Boolean(env.RATE_LIMITER);
  const deliveryMode = notificationDeliveryMode(
    env,
    facility.environment
  );
  const notificationCounts = {
    queued: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };
  for (const row of notificationRows || []) {
    if (
      Object.prototype.hasOwnProperty.call(
        notificationCounts,
        row.send_status
      )
    ) {
      notificationCounts[row.send_status] += 1;
    }
  }
  const notificationDeliveryStatus =
    deliveryMode === "live" ||
    deliveryMode === "live_demo"
      ? "pass"
      : facility.environment === "demo"
        ? "pass"
        : "pending";
  const demoDataOk ='''
    s = replace_once(s, old, new, "system check notification vars")

    s = s.replace(
        'stage: "CLINIC-SHUTTLE-V2.1-R2",',
        'stage: "CLINIC-SHUTTLE-V2.1-R5",',
        1
    )

    old = '''        rateLimiting: {
          status: rateLimitConfigured ? "pass" : "recommended",
          bindingName: "RATE_LIMITER",
        },
        operationalApi: {'''
    new = '''        rateLimiting: {
          status: rateLimitConfigured ? "pass" : "recommended",
          bindingName: "RATE_LIMITER",
        },
        notificationDelivery: {
          status: notificationDeliveryStatus,
          mode: deliveryMode,
          lineAccessTokenConfigured:
            lineAccessTokenConfigured(env),
          previousDayCron: true,
          eventNotifications: [
            "departure",
            "boarding",
            "arrival",
          ],
          counts: notificationCounts,
          channelFailureIsolation: true,
        },
        operationalApi: {'''
    s = replace_once(s, old, new, "system check notification result")

    old = '''          staffSessionRevocation: true,
        },'''
    new = '''          staffSessionRevocation: true,
          notificationQueue: true,
          notificationDispatch: true,
          previousDayNotificationCron: true,
          eventNotificationIsolation: true,
        },'''
    s = replace_once(s, old, new, "system check operational notification")

    p.write_text(s, encoding="utf-8")

# =========================================================
# wrangler.jsonc
# =========================================================
p = Path("wrangler.jsonc")
s = p.read_text(encoding="utf-8")

if '"LINE_DELIVERY_MODE": "off_safe"' not in s:
    s = s.replace(
        '"SESSION_TTL_SECONDS": "1800"',
        '"SESSION_TTL_SECONDS": "1800",\n'
        '    "LINE_DELIVERY_MODE": "off_safe"'
    )

if '"crons": [' not in s:
    s = s.replace(
        '  "workers_dev": true,\n',
        '  "workers_dev": true,\n'
        '  "triggers": {\n'
        '    "crons": ["0 0 * * *"]\n'
        '  },\n',
        1
    )

p.write_text(s, encoding="utf-8")

# =========================================================
# system-check.html
# =========================================================
p = Path("system-check.html")
s = p.read_text(encoding="utf-8")

if "PHASE3C_NOTIFICATION_CHECK" not in s:
    s = s.replace(
        'const CHECK_VERSION = "SHUTTLE-10-R1-CHECK-20260729";',
        'const CHECK_VERSION = "CLINIC-SHUTTLE-V2.1-R5-CHECK-20260920";\n'
        '    const PHASE3C_NOTIFICATION_CHECK = true;',
        1
    )

    old = '''        ["LINE会員認証", check.lineMemberAuthentication?.status,
          check.lineMemberAuthentication?.configured
            ? "LINE Channel ID設定済み"
            : `${check.lineMemberAuthentication?.requiredAtStep || "本番導入前"}に設定`],
        ["レート制限", check.rateLimiting?.status,''';
    new = '''        ["LINE会員認証", check.lineMemberAuthentication?.status,
          check.lineMemberAuthentication?.configured
            ? "LINE Channel ID設定済み"
            : `${check.lineMemberAuthentication?.requiredAtStep || "本番導入前"}に設定`],
        ["通知配送", check.notificationDelivery?.status,
          detailList([
            `モード ${check.notificationDelivery?.mode || "―"}`,
            check.notificationDelivery?.lineAccessTokenConfigured
              ? "LINE送信Secret設定済み"
              : "LINE送信Secret未設定（safe-off）",
            check.notificationDelivery?.counts
              ? `送信 ${check.notificationDelivery.counts.sent || 0}／安全停止 ${check.notificationDelivery.counts.skipped || 0}／失敗 ${check.notificationDelivery.counts.failed || 0}`
              : null,
            check.notificationDelivery?.previousDayCron
              ? "前日通知cron有効"
              : null
          ])],
        ["レート制限", check.rateLimiting?.status,''';
    s = replace_once(s, old, new, "system check notification row")
    p.write_text(s, encoding="utf-8")

# =========================================================
# config.js
# =========================================================
p = Path("config.js")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'version: "CLINIC-SHUTTLE-V2.1-R4.1-20260920",',
    'version: "CLINIC-SHUTTLE-V2.1-R5-20260920",'
)
p.write_text(s, encoding="utf-8")

# =========================================================
# build spec/status
# =========================================================
spec_path = Path("CLINIC_SHUTTLE_BUILD_SPEC_V2_1.json")
if spec_path.exists():
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    spec["current_stage"] = (
        "PHASE3C_NOTIFICATION_DELIVERY_IMPLEMENTED_PENDING_RUNTIME_QA"
    )
    spec.setdefault("phase3", {})
    spec["phase3"]["notification_dispatch"] = True
    spec["phase3"]["notification_safe_off"] = True
    spec["phase3"]["notification_channel_failure_isolation"] = True
    spec["phase3"]["notification_previous_day_cron"] = True
    spec["phase3"]["notification_event_hooks"] = [
        "departure",
        "boarding",
        "arrival",
    ]
    pending = [
        item
        for item in spec["phase3"].get("pending", [])
        if item not in (
            "notification_dispatch",
            "runtime_phase3_qa",
            "runtime_phase3b_qa",
        )
    ]
    for item in (
        "runtime_notification_qa",
        "system_check_final",
        "cross_role_regression_qa",
        "final_brushup",
        "final_4_of_4",
        "final_lock",
    ):
        if item not in pending:
            pending.append(item)
    spec["phase3"]["pending"] = pending
    spec_path.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )

Path("PHASE3C_NOTIFICATION_STATUS.txt").write_text(
    '''DPRO 診療所送迎予約 / PHASE 3-C NOTIFICATION DELIVERY

IMPLEMENTED:
- shuttle_notifications queue integration
- departure notification hook
- boarding notification hook
- arrival notification hook
- previous-day notification cron (09:00 JST)
- guardian/rider link boundary
- guardian notification preference opt-out
- LINE Messaging API push adapter
- LINE未接続時 safe skip
- LINE送信Secret未設定時 off_safe
- demo環境は既定で外部送信しない
- notification idempotency
- channel failure isolation:
  通知失敗で乗降記録を失敗させない
- System Check notification delivery row

DELIVERY MODES:
- demo default: off_safe
- production without LINE_CHANNEL_ACCESS_TOKEN: off_safe
- production + LINE_DELIVERY_MODE=live + secret: live
- demo live delivery additionally requires
  ALLOW_DEMO_LINE_DELIVERY=enabled

EVENT SETTINGS:
- notify_previous_day -> previous_day
- notify_departure -> en_route
- notify_boarding -> boarded
- notify_arrival -> arrived

NEXT:
- runtime notification QA
- final System Check
- cross-role regression QA
- final brushup
- FINAL 4/4
- FINAL LOCK
''',
    encoding="utf-8"
)
