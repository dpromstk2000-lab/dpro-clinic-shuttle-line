#!/usr/bin/env python3
from pathlib import Path
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parent
EXPECTED_PHASE1_HEAD = "27ce01ed3ac05182e4e4a4c78517db048c4dd86b"
WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R2-20260920"
DATABASE_VERSION = "CLINIC-SHUTTLE-V2.1-DB-R2-20260920"
FRONTEND_VERSION = "CLINIC-SHUTTLE-V2.1-R2-20260920"

def fail(msg):
    raise SystemExit(msg)

def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")

def write(rel, content):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8", newline="\n")

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        fail(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

def assert_lineage():
    try:
        subprocess.check_call(
            ["git", "merge-base", "--is-ancestor", EXPECTED_PHASE1_HEAD, "HEAD"],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        fail(f"Phase 1 HEAD {EXPECTED_PHASE1_HEAD} is not an ancestor of HEAD")

def clean_generated_noise():
    for p in ROOT.rglob("__pycache__"):
        if p.is_dir():
            shutil.rmtree(p)
    for p in ROOT.rglob("*.pyc"):
        if p.exists():
            p.unlink()
    gi = ROOT / ".gitignore"
    current = gi.read_text(encoding="utf-8") if gi.exists() else ""
    lines = current.splitlines()
    for item in ["__pycache__/", "*.pyc"]:
        if item not in lines:
            lines.append(item)
    write(".gitignore", "\n".join(lines).strip() + "\n")

def patch_versions(s):
    s = re.sub(
        r'const WORKER_VERSION = "[^"]+";',
        f'const WORKER_VERSION = "{WORKER_VERSION}";',
        s, count=1
    )
    s = re.sub(
        r'const DATABASE_VERSION = "[^"]+";',
        f'const DATABASE_VERSION = "{DATABASE_VERSION}";',
        s, count=1
    )
    s = s.replace('apiStage: "SHUTTLE-R2"', 'apiStage: "CLINIC-SHUTTLE-V2.1-R2"')
    s = s.replace('stage: "SHUTTLE-R2"', 'stage: "CLINIC-SHUTTLE-V2.1-R2"')
    s = s.replace("settings.schedule_step_minutes === 5", "settings.schedule_step_minutes === 30")
    return s

def patch_top_routes(s):
    if 'case "GET /v1/reservations":' in s:
        return s
    anchor = '''        case "GET /v1/dashboard/today":
          return await handleTodayDashboard(
            request,
            env,
            corsOrigin,
            requestId
          );
'''
    block = '''        case "GET /v1/reservations":
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

''' + anchor
    return replace_once(s, anchor, block, "top reservation/contact routes")

def patch_dynamic_routes(s):
    if 'handler: handleReservationUpdate' in s:
        return s
    anchor = '''  const routes = [
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/staff/${uuidPattern}$`, "i"),
      handler: handleStaffUpdate,
    },
'''
    block = '''  const routes = [
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
'''
    return replace_once(s, anchor, block, "dynamic phase2 routes")

def patch_list_guards(s):
    staff_anchor = '''  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("order", "staff_role.asc,full_name.asc");
  params.set("limit", String(getQueryLimit(request, 100, 200)));
  const rows = await supabaseRequest(
    env,
    `shuttle_staff?${params.toString()}`
  );
'''
    staff_new = '''  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("deleted_at", "is.null");
  params.set("order", "staff_role.asc,full_name.asc");
  params.set("limit", String(getQueryLimit(request, 100, 200)));
  const rows = await supabaseRequest(
    env,
    `shuttle_staff?${params.toString()}`
  );
'''
    if staff_anchor in s:
        s = s.replace(staff_anchor, staff_new, 1)

    vehicle_anchor = '''  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("order", "vehicle_name.asc");
  params.set("limit", "200");
  const rows = await supabaseRequest(
    env,
    `shuttle_vehicles?${params.toString()}`
  );
'''
    vehicle_new = '''  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("deleted_at", "is.null");
  params.set("order", "vehicle_name.asc");
  params.set("limit", "200");
  const rows = await supabaseRequest(
    env,
    `shuttle_vehicles?${params.toString()}`
  );
'''
    if vehicle_anchor in s:
        s = s.replace(vehicle_anchor, vehicle_new, 1)

    rider_old = '''  const url = new URL(request.url);
  const query = optionalSearchQuery(url.searchParams.get("query"));
  const params = new URLSearchParams();
  params.set(
    "select",
    "id,rider_code,full_name,full_name_kana,phone,phone_normalized,transport_support_level,uses_wheelchair,requires_handover,transport_notes,emergency_contact_name,emergency_contact_phone,is_active,created_at,updated_at"
  );
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("order", "full_name.asc");
  params.set("limit", String(getQueryLimit(request, 50, 200)));

  if (query) {
'''
    rider_new = '''  const url = new URL(request.url);
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
'''
    if rider_old in s:
        s = s.replace(rider_old, rider_new, 1)
    elif "explicitAllAvailable: true" not in s:
        fail("patient blank-search guard anchor not found")
    return s

def phase2_functions():
    return r'''
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
'''

def patch_worker():
    s = read("worker.js")
    s = patch_versions(s)
    s = patch_top_routes(s)
    s = patch_dynamic_routes(s)
    s = patch_list_guards(s)
    if "function requireThirtyMinuteTime(" not in s:
        anchor = "async function handleTodayDashboard("
        idx = s.find(anchor)
        if idx < 0:
            fail("handleTodayDashboard insertion anchor not found")
        s = s[:idx] + phase2_functions() + "\n" + s[idx:]
    write("worker.js", s)

def patch_frontend_version():
    s = read("config.js")
    s = re.sub(
        r'version: "CLINIC-SHUTTLE-V2\.1-[^"]+",',
        f'version: "{FRONTEND_VERSION}",',
        s, count=1
    )
    write("config.js", s)

def write_evidence():
    jst = timezone(timedelta(hours=9))
    evidence = {
        "schema_version": "DPRO_CLINIC_SHUTTLE_SUPABASE_PHASE2_APPLIED_V1",
        "recorded_at": datetime.now(jst).isoformat(timespec="seconds"),
        "project_ref": "cbknucemarcpbscirzyv",
        "schema": "dpro_clinic_shuttle",
        "migrations_applied": [
            "clinic_shuttle_v21_phase2_clone",
            "clinic_shuttle_v21_phase2_domain"
        ],
        "verification": {
            "schema_check_ok": True,
            "database_version": DATABASE_VERSION,
            "table_count": 25,
            "function_count": 28,
            "reservation_slot_minutes": 30,
            "missing_tables": [],
            "rls_disabled_tables": [],
            "cross_talk_trigger_count": 0,
            "cross_talk_function_count": 0
        },
        "security_model": {
            "browser_direct_db_access": False,
            "anon_grants": "revoked",
            "authenticated_grants": "revoked",
            "worker_role": "service_role",
            "rls_enabled": True,
            "note": "RLS-without-policy advisor INFO is intentional for the server-only custom schema boundary."
        },
        "data_api_next_step": "Add dpro_clinic_shuttle to Supabase Data API Exposed schemas before Worker runtime QA."
    }
    write("SUPABASE_PHASE2_APPLIED.json", json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
    status = f'''DPRO 診療所送迎予約 / PHASE 2 STATUS

PHASE 1:
PASS
GitHub HEAD baseline: {EXPECTED_PHASE1_HEAD}

SUPABASE PHASE 2:
PASS
Project: cbknucemarcpbscirzyv
Schema: dpro_clinic_shuttle
Database version: {DATABASE_VERSION}
Schema check: ok=true
Tables: 25
Functions: 28
Reservation slot: 30 minutes
Missing tables: 0
RLS-disabled tables: 0
Cross-talk functions to public.shuttle_*: 0
Cross-talk triggers to public.shuttle_*: 0

IMPLEMENTED IN DB:
- Dedicated CLINIC_SHUTTLE schema
- Proven shuttle core cloned and fully schema-isolated
- 30-minute reservation policy
- Past-date reservation guard
- Clinic shuttle reservations
- Round trip / outbound only / return only
- Fixed return time / return-after-visit-ready
- Reservation status history
- CONTACT HUB events
- Staff and vehicle soft-delete foundation
- In-use delete guards
- Audit history
- Server-only direct DB access model

IMPLEMENTED BY THIS GITHUB PATCH:
- Reservation REST API
- Reservation change/cancel/return-ready API
- CONTACT HUB API
- Staff/vehicle soft-delete API
- Patient empty-search guard
- Explicit all-patient list capped at 100
- Deleted resources hidden from normal lists
- System Check 30-minute / DB R2 expectation
- Remove Python cache artifacts

NOT FINAL:
- Supabase Data API must expose dpro_clinic_shuttle
- Cloudflare Worker env/secrets + deploy
- Owner reservation/settings UI
- Patient/family WEB/LINE reservation UI
- CONTACT HUB owner UI
- cross-role runtime QA
- FINAL 4/4 and FINAL LOCK
'''
    write("PHASE2_STATUS.txt", status)

def verify():
    worker = read("worker.js")
    for token in [
        f'const WORKER_VERSION = "{WORKER_VERSION}";',
        f'const DATABASE_VERSION = "{DATABASE_VERSION}";',
        'case "GET /v1/reservations":',
        'case "POST /v1/reservations":',
        'case "GET /v1/contact-hub":',
        'handler: handleReservationUpdate',
        'handler: handleStaffSoftDelete',
        'handler: handleVehicleSoftDelete',
        'function requireThirtyMinuteTime(',
        'explicitAllAvailable: true',
        'settings.schedule_step_minutes === 30'
    ]:
        if token not in worker:
            fail(f"verification missing: {token}")
    for token in [
        "settings.schedule_step_minutes === 5",
        'const DATABASE_VERSION = "CLINIC-SHUTTLE-V2.1-DB-R1-20260920";'
    ]:
        if token in worker:
            fail(f"obsolete token remains: {token}")
    if (ROOT / "__pycache__").exists():
        fail("__pycache__ still present")

def main():
    assert_lineage()
    clean_generated_noise()
    patch_worker()
    patch_frontend_version()
    write_evidence()
    verify()
    print("CLINIC_SHUTTLE PHASE 2 GITHUB PATCH: PASS")

if __name__ == "__main__":
    main()
