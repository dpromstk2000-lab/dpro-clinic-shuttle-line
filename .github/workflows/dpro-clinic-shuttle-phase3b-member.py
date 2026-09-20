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

if "PHASE3B_MEMBER_RESERVATION_R1" not in s:
    s = s.replace(
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R3-20260920";',
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R4-20260920";\n'
        'const PHASE3B_MEMBER_RESERVATION_R1 = true;'
    )

    marker = "function validateReservationTripFields({"
    helpers = r'''
function publicMemberReservation(row) {
  if (!row) return null;
  return {
    id: row.id,
    riderId: row.rider_id,
    sourceChannel: row.source_channel,
    serviceDate: row.service_date,
    appointmentTime: row.appointment_time ?? null,
    tripType: row.trip_type,
    returnMode: row.return_mode,
    outboundRequestedTime: row.outbound_requested_time ?? null,
    returnRequestedTime: row.return_requested_time ?? null,
    pickupLocationId: row.pickup_location_id ?? null,
    clinicLocationId: row.clinic_location_id ?? null,
    returnDropoffLocationId: row.return_dropoff_location_id ?? null,
    reservationStatus: row.reservation_status,
    customerNote: row.customer_note ?? null,
    version: row.version,
    cancelRequestedAt: row.cancel_requested_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function publicReservationForSession(row, session) {
  return session?.role === "guardian"
    ? publicMemberReservation(row)
    : publicReservation(row);
}

function publicMemberReservationLocation(row) {
  if (!row) return null;
  return {
    id: row.id,
    riderId: row.rider_id ?? null,
    locationType: row.location_type,
    locationName: row.location_name,
    isDefaultPickup: Boolean(row.is_default_pickup),
    isDefaultDropoff: Boolean(row.is_default_dropoff),
  };
}

function assertNotPastReservationTime(serviceDate, timeValue, label) {
  if (!timeValue) return;
  const candidate = new Date(
    `${serviceDate}T${String(timeValue).slice(0, 5)}:00+09:00`
  );
  if (!Number.isFinite(candidate.getTime())) {
    throw new AppError(
      400,
      "INVALID_RESERVATION_TIME",
      `${label}の日時形式が正しくありません。`
    );
  }
  if (candidate.getTime() < Date.now()) {
    throw new AppError(
      400,
      "PAST_RESERVATION_TIME",
      `過去の${label}は指定できません。`
    );
  }
}

async function assertReservationRules(
  env,
  facilityId,
  riderId,
  {
    serviceDate,
    tripType,
    returnMode,
    outboundRequestedTime,
    returnRequestedTime,
    appointmentTime,
    pickupLocationId,
    clinicLocationId,
    returnDropoffLocationId,
  }
) {
  if (
    ["outbound_to_clinic", "round_trip"].includes(tripType) &&
    !pickupLocationId
  ) {
    throw new AppError(
      400,
      "PICKUP_LOCATION_REQUIRED",
      "行きの送迎にはお迎え場所を選択してください。"
    );
  }
  if (!clinicLocationId) {
    throw new AppError(
      400,
      "CLINIC_LOCATION_REQUIRED",
      "診療所を選択してください。"
    );
  }
  if (
    ["round_trip", "return_only"].includes(tripType) &&
    !returnDropoffLocationId
  ) {
    throw new AppError(
      400,
      "RETURN_DROPOFF_REQUIRED",
      "帰りの送迎には降車場所を選択してください。"
    );
  }

  const settingsParams = new URLSearchParams();
  settingsParams.set(
    "select",
    "schedule_step_minutes,business_start_time,business_end_time"
  );
  settingsParams.set("facility_id", `eq.${facilityId}`);
  settingsParams.set("limit", "1");
  const settingsRows = await supabaseRequest(
    env,
    `shuttle_settings?${settingsParams.toString()}`
  );
  const settings = Array.isArray(settingsRows)
    ? settingsRows[0]
    : null;
  if (!settings) {
    throw new AppError(
      503,
      "FACILITY_SETTINGS_MISSING",
      "診療所の送迎時間設定が見つかりません。"
    );
  }

  const startMinutes = timeToMinutes(settings.business_start_time);
  const endMinutes = timeToMinutes(settings.business_end_time);
  const step = Number(settings.schedule_step_minutes || 30);

  for (const [label, value] of [
    ["行き希望時間", outboundRequestedTime],
    ["帰り希望時間", returnRequestedTime],
    ["受診予定時刻", appointmentTime],
  ]) {
    if (!value) continue;
    const minutes = timeToMinutes(value);
    if (
      !Number.isFinite(minutes) ||
      minutes < startMinutes ||
      minutes > endMinutes
    ) {
      throw new AppError(
        400,
        "OUTSIDE_BUSINESS_HOURS",
        `${label}は診療所の運行時間内で選択してください。`
      );
    }
    if (minutes % step !== 0) {
      throw new AppError(
        400,
        "INVALID_TIME_STEP",
        `${label}は${step}分単位で選択してください。`
      );
    }
    assertNotPastReservationTime(serviceDate, value, label);
  }

  if (
    tripType === "round_trip" &&
    returnMode === "fixed_time" &&
    returnRequestedTime &&
    outboundRequestedTime &&
    timeToMinutes(returnRequestedTime) <=
      timeToMinutes(outboundRequestedTime)
  ) {
    throw new AppError(
      400,
      "INVALID_RETURN_TIME",
      "帰り希望時間は行き希望時間より後にしてください。"
    );
  }

  const locationIds = [
    pickupLocationId,
    clinicLocationId,
    returnDropoffLocationId,
  ].filter(Boolean);
  const rows = await fetchRowsByIds(
    env,
    "shuttle_locations",
    facilityId,
    [...new Set(locationIds)],
    "id,rider_id,location_type,is_active"
  );
  const locationById = new Map(rows.map((row) => [row.id, row]));

  const assertActiveLocation = (locationId, label) => {
    if (!locationId) return null;
    const location = locationById.get(locationId);
    if (!location || !location.is_active) {
      throw new AppError(
        400,
        "RESERVATION_LOCATION_INVALID",
        `${label}が利用できません。場所を選び直してください。`
      );
    }
    return location;
  };

  const pickup = assertActiveLocation(
    pickupLocationId,
    "お迎え場所"
  );
  const clinic = assertActiveLocation(
    clinicLocationId,
    "診療所"
  );
  const returnDropoff = assertActiveLocation(
    returnDropoffLocationId,
    "帰り降車場所"
  );

  if (
    pickup &&
    pickup.location_type !== "facility" &&
    pickup.rider_id !== riderId
  ) {
    throw new AppError(
      403,
      "RESERVATION_LOCATION_ACCESS_DENIED",
      "この患者のお迎え場所ではありません。"
    );
  }
  if (clinic && clinic.location_type !== "facility") {
    throw new AppError(
      400,
      "CLINIC_LOCATION_INVALID",
      "診療所として登録された場所を選択してください。"
    );
  }
  if (
    returnDropoff &&
    returnDropoff.location_type !== "facility" &&
    returnDropoff.rider_id !== riderId
  ) {
    throw new AppError(
      403,
      "RESERVATION_LOCATION_ACCESS_DENIED",
      "この患者の帰り降車場所ではありません。"
    );
  }
}

'''
    if marker not in s:
        raise SystemExit("PATCH ANCHOR NOT FOUND: reservation helpers")
    s = s.replace(marker, helpers + marker, 1)

    s = s.replace(
        "{ reservations: (rows || []).map(publicReservation), count: Array.isArray(rows) ? rows.length : 0 }",
        "{ reservations: (rows || []).map((row) => publicReservationForSession(row, session)), count: Array.isArray(rows) ? rows.length : 0 }",
        1
    )

    old = '''  validateReservationTripFields({
    tripType, returnMode, outboundRequestedTime, returnRequestedTime,
  });

  if (session.role === "guardian") {'''
    new = '''  validateReservationTripFields({
    tripType, returnMode, outboundRequestedTime, returnRequestedTime,
  });

  const pickupLocationId = optionalUuid(
    body.pickupLocationId,
    "お迎え場所ID"
  );
  const clinicLocationId = optionalUuid(
    body.clinicLocationId,
    "診療所場所ID"
  );
  const returnDropoffLocationId = optionalUuid(
    body.returnDropoffLocationId,
    "帰り降車場所ID"
  );

  await assertReservationRules(
    env,
    session.facilityId,
    riderId,
    {
      serviceDate,
      tripType,
      returnMode,
      outboundRequestedTime,
      returnRequestedTime,
      appointmentTime,
      pickupLocationId,
      clinicLocationId,
      returnDropoffLocationId,
    }
  );

  if (session.role === "guardian") {'''
    s = replace_once(s, old, new, "reservation create rules")

    s = s.replace(
        'pickup_location_id: optionalUuid(body.pickupLocationId, "お迎え場所ID"),',
        'pickup_location_id: pickupLocationId,',
        1
    )
    s = s.replace(
        'clinic_location_id: optionalUuid(body.clinicLocationId, "診療所場所ID"),',
        'clinic_location_id: clinicLocationId,',
        1
    )
    s = s.replace(
        'return_dropoff_location_id: optionalUuid(body.returnDropoffLocationId, "帰り降車場所ID"),',
        'return_dropoff_location_id: returnDropoffLocationId,',
        1
    )

    old = '''  validateReservationTripFields({
    tripType: changes.trip_type ?? current.trip_type,
    returnMode: changes.return_mode ?? current.return_mode,
    outboundRequestedTime:
      Object.prototype.hasOwnProperty.call(changes, "outbound_requested_time")
        ? changes.outbound_requested_time : current.outbound_requested_time,
    returnRequestedTime:
      Object.prototype.hasOwnProperty.call(changes, "return_requested_time")
        ? changes.return_requested_time : current.return_requested_time,
  });

  const params = new URLSearchParams();'''
    new = '''  validateReservationTripFields({
    tripType: changes.trip_type ?? current.trip_type,
    returnMode: changes.return_mode ?? current.return_mode,
    outboundRequestedTime:
      Object.prototype.hasOwnProperty.call(changes, "outbound_requested_time")
        ? changes.outbound_requested_time : current.outbound_requested_time,
    returnRequestedTime:
      Object.prototype.hasOwnProperty.call(changes, "return_requested_time")
        ? changes.return_requested_time : current.return_requested_time,
  });

  await assertReservationRules(
    env,
    session.facilityId,
    current.rider_id,
    {
      serviceDate: changes.service_date ?? current.service_date,
      tripType: changes.trip_type ?? current.trip_type,
      returnMode: changes.return_mode ?? current.return_mode,
      outboundRequestedTime:
        Object.prototype.hasOwnProperty.call(changes, "outbound_requested_time")
          ? changes.outbound_requested_time
          : current.outbound_requested_time,
      returnRequestedTime:
        Object.prototype.hasOwnProperty.call(changes, "return_requested_time")
          ? changes.return_requested_time
          : current.return_requested_time,
      appointmentTime:
        Object.prototype.hasOwnProperty.call(changes, "appointment_time")
          ? changes.appointment_time
          : current.appointment_time,
      pickupLocationId:
        Object.prototype.hasOwnProperty.call(changes, "pickup_location_id")
          ? changes.pickup_location_id
          : current.pickup_location_id,
      clinicLocationId:
        Object.prototype.hasOwnProperty.call(changes, "clinic_location_id")
          ? changes.clinic_location_id
          : current.clinic_location_id,
      returnDropoffLocationId:
        Object.prototype.hasOwnProperty.call(changes, "return_dropoff_location_id")
          ? changes.return_dropoff_location_id
          : current.return_dropoff_location_id,
    }
  );

  const params = new URLSearchParams();'''
    s = replace_once(s, old, new, "reservation update rules")

    s = s.replace(
        "publicReservation(reservation)",
        "publicReservationForSession(reservation, session)"
    )

    old = '''        schedules: [],
        stops: [],
        changeRequests: [],
      },'''
    new = '''        schedules: [],
        stops: [],
        reservations: [],
        reservationLocations: [],
        changeRequests: [],
      },'''
    s = replace_once(s, old, new, "member home empty response")

    old = '''  const linkByRiderId = new Map(
    links.map((row) => [row.rider_id, row])
  );

  let schedules = [];'''
    new = '''  const linkByRiderId = new Map(
    links.map((row) => [row.rider_id, row])
  );

  let reservationLocations = [];
  let reservations = [];
  if (allowedRiderIds.length > 0) {
    const riderLocationParams = new URLSearchParams();
    riderLocationParams.set(
      "select",
      "id,rider_id,location_type,location_name,is_default_pickup,is_default_dropoff,is_active"
    );
    riderLocationParams.set("facility_id", `eq.${session.facilityId}`);
    riderLocationParams.set(
      "rider_id",
      `in.(${allowedRiderIds.join(",")})`
    );
    riderLocationParams.set("is_active", "eq.true");
    riderLocationParams.set("order", "location_name.asc");

    const facilityLocationParams = new URLSearchParams();
    facilityLocationParams.set(
      "select",
      "id,rider_id,location_type,location_name,is_default_pickup,is_default_dropoff,is_active"
    );
    facilityLocationParams.set(
      "facility_id",
      `eq.${session.facilityId}`
    );
    facilityLocationParams.set("location_type", "eq.facility");
    facilityLocationParams.set("is_active", "eq.true");
    facilityLocationParams.set("order", "location_name.asc");

    const reservationParams = new URLSearchParams();
    reservationParams.set(
      "select",
      "id,rider_id,source_channel,service_date,appointment_time,trip_type,return_mode,outbound_requested_time,return_requested_time,pickup_location_id,clinic_location_id,return_dropoff_location_id,reservation_status,customer_note,version,cancel_requested_at,cancelled_at,created_at,updated_at"
    );
    reservationParams.set(
      "facility_id",
      `eq.${session.facilityId}`
    );
    reservationParams.set(
      "rider_id",
      `in.(${allowedRiderIds.join(",")})`
    );
    reservationParams.set("service_date", `eq.${serviceDate}`);
    reservationParams.set("deleted_at", "is.null");
    reservationParams.set(
      "order",
      "outbound_requested_time.asc,created_at.asc"
    );

    const [
      riderLocationRows,
      facilityLocationRows,
      reservationRows,
    ] = await Promise.all([
      supabaseRequest(
        env,
        `shuttle_locations?${riderLocationParams.toString()}`
      ),
      supabaseRequest(
        env,
        `shuttle_locations?${facilityLocationParams.toString()}`
      ),
      supabaseRequest(
        env,
        `shuttle_reservations?${reservationParams.toString()}`
      ),
    ]);

    const byLocationId = new Map();
    for (const row of [
      ...(riderLocationRows || []),
      ...(facilityLocationRows || []),
    ]) {
      byLocationId.set(row.id, row);
    }
    reservationLocations = [...byLocationId.values()];
    reservations = Array.isArray(reservationRows)
      ? reservationRows
      : [];
  }

  let schedules = [];'''
    s = replace_once(s, old, new, "member reservation data")

    old = '''      stops: stops.map((row) =>
        publicMemberStop(
          row,
          riderById.get(row.rider_id),
          runById.get(row.run_id),
          locationById
        )
      ),
      changeRequests: (changeRows || []).map(
        publicMemberChangeRequest
      ),'''
    new = '''      stops: stops.map((row) =>
        publicMemberStop(
          row,
          riderById.get(row.rider_id),
          runById.get(row.run_id),
          locationById
        )
      ),
      reservations: reservations.map(publicMemberReservation),
      reservationLocations: reservationLocations.map(
        publicMemberReservationLocation
      ),
      changeRequests: (changeRows || []).map(
        publicMemberChangeRequest
      ),'''
    s = replace_once(s, old, new, "member home reservation response")

    p.write_text(s, encoding="utf-8")

# =========================================================
# member.js
# =========================================================
p = Path("member.js")
s = p.read_text(encoding="utf-8")

if "PHASE3B_MEMBER_UI_R1" not in s:
    s = s.replace(
        'const runtimeConfig =',
        'const PHASE3B_MEMBER_UI_R1 = true;\n\nconst runtimeConfig =',
        1
    )

    marker = 'const serviceTypeLabels = Object.freeze({'
    i = s.find(marker)
    if i < 0:
        raise SystemExit("PATCH ANCHOR NOT FOUND: member labels")
    end = s.find('});', i)
    if end < 0:
        raise SystemExit("PATCH ANCHOR NOT FOUND: service labels end")
    end += 3
    label_insert = r'''

const reservationStatusLabels = Object.freeze({
  pending: "確認待ち",
  confirmed: "予約確認済み",
  assigned: "配車済み",
  outbound_in_progress: "行き運行中",
  at_clinic: "診療所到着",
  return_ready: "帰り便待ち",
  return_assigned: "帰り配車済み",
  return_in_progress: "帰り運行中",
  completed: "完了",
  change_requested: "変更依頼中",
  cancel_requested: "取消確認待ち",
  cancelled: "取消",
  rejected: "却下"
});

const reservationTripTypeLabels = Object.freeze({
  outbound_to_clinic: "行きのみ",
  round_trip: "往復",
  return_only: "帰りのみ"
});

const reservationReturnModeLabels = Object.freeze({
  none: "帰りなし",
  fixed_time: "時間指定",
  after_visit_ready: "診療終了後に手配"
});
'''
    s = s[:end] + label_insert + s[end:]

    s = s.replace(
        '''      "pending",
      "confirmed",
      "en_route",
      "boarded",
      "planned"''',
        '''      "pending",
      "confirmed",
      "assigned",
      "outbound_in_progress",
      "at_clinic",
      "return_ready",
      "return_assigned",
      "return_in_progress",
      "change_requested",
      "en_route",
      "boarded",
      "planned"''',
        1
    )
    s = s.replace(
        '''    ["rejected", "cancelled", "no_show"].includes(status)''',
        '''    ["rejected", "cancelled", "cancel_requested", "no_show"].includes(status)''',
        1
    )

    old = '''  const schedules = data.schedules || [];
  const stops = data.stops || [];
  const changes = data.changeRequests || [];'''
    new = '''  const schedules = data.schedules || [];
  const stops = data.stops || [];
  const reservations = data.reservations || [];
  const reservationLocations = data.reservationLocations || [];
  const changes = data.changeRequests || [];'''
    s = replace_once(s, old, new, "member home reservation vars")

    old = '''      <div class="member-summary"><span>対象患者</span><strong>${riders.length}名</strong></div>
      <div class="member-summary"><span>当日の送迎</span><strong>${stops.length ? stops.filter((stop) => stop.stopStatus !== "cancelled").length : schedules.length}件</strong></div>
      <div class="member-summary"><span>変更依頼</span><strong>${changes.length}件</strong></div>'''
    new = '''      <div class="member-summary"><span>対象患者</span><strong>${riders.length}名</strong></div>
      <div class="member-summary"><span>当日の送迎</span><strong>${stops.length ? stops.filter((stop) => stop.stopStatus !== "cancelled").length : schedules.length}件</strong></div>
      <div class="member-summary"><span>送迎予約</span><strong>${reservations.length}件</strong></div>
      <div class="member-summary"><span>変更依頼</span><strong>${changes.length}件</strong></div>'''
    s = replace_once(s, old, new, "member summary reservation")

    old = '''    </section>
    ${riders.some((rider) => rider.canRequestChange) ? renderChangeForm(riders, data.serviceDate) : ""}
    <section class="member-card">'''
    new = '''    </section>
    ${(reservations.length || riders.some((rider) => rider.canRequestChange))
      ? renderReservationSection(
          riders,
          data.serviceDate,
          reservations,
          reservationLocations
        )
      : ""}
    ${riders.some((rider) => rider.canRequestChange) ? renderChangeForm(riders, data.serviceDate) : ""}
    <section class="member-card">'''
    s = replace_once(s, old, new, "member reservation section")

    s = s.replace(
        '  bindHomeActions(app, session, data.serviceDate);',
        '  bindHomeActions(app, session, data.serviceDate, data);',
        1
    )

    marker = "function renderChangeForm(riders, serviceDate) {"
    reservation_ui = r'''
function currentJstMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function reservationTimeOptions(serviceDate, selected = "") {
  const today = jstDateString();
  const nowMinutes = currentJstMinutes();
  const options = ['<option value="">選択してください</option>'];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 30]) {
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const total = hour * 60 + minute;
      const disabled = serviceDate === today && total < nowMinutes;
      options.push(
        `<option value="${value}"${selected === value ? " selected" : ""}${disabled ? " disabled" : ""}>${value}</option>`
      );
    }
  }
  return options.join("");
}

function reservationLocationOptions(locations, kind) {
  const filtered = locations.filter((location) =>
    kind === "clinic"
      ? location.locationType === "facility"
      : true
  );
  return `
    <option value="">選択してください</option>
    ${filtered.map((location) => `
      <option
        value="${escapeHtml(location.id)}"
        data-rider-id="${escapeHtml(location.riderId || "")}"
        data-location-type="${escapeHtml(location.locationType || "")}"
        data-default-pickup="${location.isDefaultPickup ? "1" : "0"}"
        data-default-dropoff="${location.isDefaultDropoff ? "1" : "0"}"
      >${escapeHtml(location.locationName)}${location.locationType === "facility" ? "（診療所）" : ""}</option>`).join("")}`;
}

function renderReservationSection(
  riders,
  serviceDate,
  reservations,
  reservationLocations
) {
  const allowed = riders.filter((rider) => rider.canRequestChange);
  const today = jstDateString();
  const reservationDate = isPastJstDate(serviceDate)
    ? today
    : serviceDate;
  const riderById = new Map(riders.map((rider) => [rider.id, rider]));
  const canCreate = allowed.length > 0;

  return `
    <section class="member-card">
      <header class="member-card-header">
        <div>
          <h2>送迎予約</h2>
          <p>新しい送迎を申し込みます。送信後は診療所の確認待ちになります。</p>
        </div>
      </header>
      <div class="member-card-body">
        ${canCreate ? `
          <form id="member-reservation-form" novalidate>
            <div class="member-grid">
              <div class="member-field">
                <label for="reservation-rider">患者<span class="member-required">必須</span></label>
                <select id="reservation-rider" name="riderId" required>
                  ${allowed.map((rider) => `<option value="${escapeHtml(rider.id)}">${escapeHtml(rider.fullName)}</option>`).join("")}
                </select>
              </div>
              <div class="member-field">
                <label for="reservation-date">送迎日<span class="member-required">必須</span></label>
                <input id="reservation-date" name="serviceDate" type="date" lang="ja-JP" min="${escapeHtml(today)}" value="${escapeHtml(reservationDate)}" required>
              </div>
              <div class="member-field">
                <label for="reservation-trip-type">利用区分<span class="member-required">必須</span></label>
                <select id="reservation-trip-type" name="tripType" required>
                  <option value="round_trip">往復</option>
                  <option value="outbound_to_clinic">行きのみ</option>
                  <option value="return_only">帰りのみ</option>
                </select>
              </div>
              <div class="member-field">
                <label for="reservation-appointment-time">受診予定時刻</label>
                <select id="reservation-appointment-time" name="appointmentTime">${reservationTimeOptions(reservationDate)}</select>
              </div>
              <div class="member-field" data-reservation-field="outbound-time">
                <label for="reservation-outbound-time">行き希望時間<span class="member-required">必須</span></label>
                <select id="reservation-outbound-time" name="outboundRequestedTime" required>${reservationTimeOptions(reservationDate)}</select>
              </div>
              <div class="member-field" data-reservation-field="return-mode">
                <label for="reservation-return-mode">帰り方法<span class="member-required">必須</span></label>
                <select id="reservation-return-mode" name="returnMode" required>
                  <option value="after_visit_ready">診療終了後に手配</option>
                  <option value="fixed_time">時間指定</option>
                </select>
              </div>
              <div class="member-field" data-reservation-field="return-time" hidden>
                <label for="reservation-return-time">帰り希望時間<span class="member-required">必須</span></label>
                <select id="reservation-return-time" name="returnRequestedTime">${reservationTimeOptions(reservationDate)}</select>
              </div>
              <div class="member-field" data-reservation-field="pickup-location">
                <label for="reservation-pickup-location">お迎え場所<span class="member-required">必須</span></label>
                <select id="reservation-pickup-location" name="pickupLocationId" required>${reservationLocationOptions(reservationLocations, "pickup")}</select>
              </div>
              <div class="member-field">
                <label for="reservation-clinic-location">診療所<span class="member-required">必須</span></label>
                <select id="reservation-clinic-location" name="clinicLocationId" required>${reservationLocationOptions(reservationLocations, "clinic")}</select>
              </div>
              <div class="member-field" data-reservation-field="return-location">
                <label for="reservation-return-location">帰り降車場所<span class="member-required">必須</span></label>
                <select id="reservation-return-location" name="returnDropoffLocationId" required>${reservationLocationOptions(reservationLocations, "return")}</select>
              </div>
              <div class="member-field is-full">
                <label for="reservation-note">診療所への連絡事項</label>
                <textarea id="reservation-note" name="customerNote" maxlength="1000" placeholder="送迎時に伝えておきたい内容があれば入力してください"></textarea>
                <p class="member-hint">病名・検査結果・処方など、送迎に不要な医療情報は入力しないでください。</p>
              </div>
            </div>
            <div class="member-actions">
              <button type="submit" class="member-button is-wide">送迎予約を申し込む</button>
            </div>
          </form>
        ` : '<div class="member-notice is-warning">この患者の新規送迎予約は診療所へご連絡ください。</div>'}
      </div>
    </section>
    <section class="member-card">
      <header class="member-card-header">
        <div><h2>予約の状況</h2><p>${escapeHtml(formatDate(serviceDate))}の予約を表示します。</p></div>
      </header>
      <div class="member-card-body">
        ${reservations.length ? `
          <div class="member-record-list">
            ${reservations.map((reservation) => {
              const rider = riderById.get(reservation.riderId);
              const timeText = [
                reservation.outboundRequestedTime
                  ? `行き ${formatTime(reservation.outboundRequestedTime)}`
                  : null,
                reservation.returnMode === "fixed_time" && reservation.returnRequestedTime
                  ? `帰り ${formatTime(reservation.returnRequestedTime)}`
                  : reservation.returnMode === "after_visit_ready"
                    ? "帰り 診療終了後"
                    : null
              ].filter(Boolean).join("／");
              const canCancel = ![
                "completed",
                "cancelled",
                "rejected",
                "cancel_requested"
              ].includes(reservation.reservationStatus);
              return `
                <article class="member-record">
                  <div class="member-record-top">
                    <h3>${escapeHtml(rider?.fullName || "患者")}・${escapeHtml(reservationTripTypeLabels[reservation.tripType] || reservation.tripType)}</h3>
                    <span class="member-status ${statusTone(reservation.reservationStatus)}">${escapeHtml(reservationStatusLabels[reservation.reservationStatus] || reservation.reservationStatus)}</span>
                  </div>
                  <p>${escapeHtml(timeText || "時間未設定")}</p>
                  ${reservation.customerNote ? `<p class="member-record-meta">連絡事項：${escapeHtml(reservation.customerNote)}</p>` : ""}
                  ${canCancel ? `
                    <div class="member-actions">
                      <button
                        type="button"
                        class="member-button is-danger"
                        data-member-action="cancel-reservation"
                        data-reservation-id="${escapeHtml(reservation.id)}"
                        data-reservation-version="${escapeHtml(reservation.version)}"
                      >取消を依頼</button>
                    </div>` : ""}
                </article>`;
            }).join("")}
          </div>
        ` : '<div class="member-empty"><strong>この日の予約はありません</strong><p>必要な場合は上のフォームから送迎を申し込めます。</p></div>'}
      </div>
    </section>`;
}

function syncReservationLocationOptions(form) {
  const riderId = String(form.elements.riderId?.value || "");
  for (const name of ["pickupLocationId", "returnDropoffLocationId"]) {
    const select = form.elements[name];
    if (!select) continue;
    for (const option of [...select.options]) {
      if (!option.value) {
        option.hidden = false;
        continue;
      }
      const locationRiderId = option.dataset.riderId || "";
      const locationType = option.dataset.locationType || "";
      option.hidden =
        locationType !== "facility" &&
        Boolean(riderId) &&
        locationRiderId !== riderId;
    }
    if (select.selectedOptions[0]?.hidden) {
      select.value = "";
    }
    if (!select.value) {
      const preferred = [...select.options].find((option) => {
        if (!option.value || option.hidden) return false;
        return name === "pickupLocationId"
          ? option.dataset.defaultPickup === "1"
          : option.dataset.defaultDropoff === "1";
      });
      const fallback = [...select.options].find(
        (option) => option.value && !option.hidden && option.dataset.locationType !== "facility"
      );
      select.value = preferred?.value || fallback?.value || "";
    }
  }

  const clinic = form.elements.clinicLocationId;
  if (clinic && !clinic.value) {
    const first = [...clinic.options].find((option) => option.value);
    clinic.value = first?.value || "";
  }
}

function syncReservationForm(form) {
  if (!form) return;
  const tripType = String(form.elements.tripType?.value || "round_trip");
  const returnMode = String(form.elements.returnMode?.value || "after_visit_ready");

  const outboundField = form.querySelector('[data-reservation-field="outbound-time"]');
  const pickupField = form.querySelector('[data-reservation-field="pickup-location"]');
  const returnModeField = form.querySelector('[data-reservation-field="return-mode"]');
  const returnTimeField = form.querySelector('[data-reservation-field="return-time"]');
  const returnLocationField = form.querySelector('[data-reservation-field="return-location"]');

  const hasOutbound = tripType !== "return_only";
  const hasReturn = tripType !== "outbound_to_clinic";
  if (outboundField) outboundField.hidden = !hasOutbound;
  if (pickupField) pickupField.hidden = !hasOutbound;
  if (returnModeField) returnModeField.hidden = !hasReturn;
  if (returnLocationField) returnLocationField.hidden = !hasReturn;
  if (returnTimeField) {
    returnTimeField.hidden = !hasReturn || returnMode !== "fixed_time";
  }

  form.elements.outboundRequestedTime.required = hasOutbound;
  form.elements.pickupLocationId.required = hasOutbound;
  form.elements.returnMode.required = hasReturn;
  form.elements.returnDropoffLocationId.required = hasReturn;
  form.elements.returnRequestedTime.required =
    hasReturn && returnMode === "fixed_time";

  if (!hasOutbound) {
    form.elements.outboundRequestedTime.value = "";
    form.elements.pickupLocationId.value = "";
  }
  if (!hasReturn) {
    form.elements.returnMode.value = "after_visit_ready";
    form.elements.returnRequestedTime.value = "";
    form.elements.returnDropoffLocationId.value = "";
  } else if (returnMode !== "fixed_time") {
    form.elements.returnRequestedTime.value = "";
  }

  syncReservationLocationOptions(form);
}

function refreshReservationTimeOptions(form) {
  const serviceDate = String(form.elements.serviceDate?.value || "");
  if (!serviceDate) return;
  for (const name of [
    "appointmentTime",
    "outboundRequestedTime",
    "returnRequestedTime"
  ]) {
    const select = form.elements[name];
    if (!select) continue;
    const previous = String(select.value || "");
    select.innerHTML = reservationTimeOptions(serviceDate, previous);
    if (
      previous &&
      [...select.options].some(
        (option) => option.value === previous && !option.disabled
      )
    ) {
      select.value = previous;
    }
  }
}

async function submitMemberReservation(
  form,
  app,
  session
) {
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const serviceDate = String(values.serviceDate || "");
  if (isPastJstDate(serviceDate)) {
    toast("過去日の送迎予約は登録できません。", true);
    return;
  }

  const tripType = String(values.tripType || "");
  const returnMode = tripType === "outbound_to_clinic"
    ? "none"
    : String(values.returnMode || "after_visit_ready");
  const outboundRequestedTime = tripType === "return_only"
    ? null
    : String(values.outboundRequestedTime || "") || null;
  const returnRequestedTime =
    tripType !== "outbound_to_clinic" && returnMode === "fixed_time"
      ? String(values.returnRequestedTime || "") || null
      : null;
  const appointmentTime =
    String(values.appointmentTime || "") || null;

  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, "送信中…");
  try {
    await api("/v1/reservations", {
      method: "POST",
      token: session.token,
      body: {
        riderId: String(values.riderId || ""),
        serviceDate,
        appointmentTime,
        tripType,
        returnMode,
        outboundRequestedTime,
        returnRequestedTime,
        pickupLocationId: tripType === "return_only"
          ? null
          : String(values.pickupLocationId || "") || null,
        clinicLocationId:
          String(values.clinicLocationId || "") || null,
        returnDropoffLocationId: tripType === "outbound_to_clinic"
          ? null
          : String(values.returnDropoffLocationId || "") || null,
        customerNote:
          String(values.customerNote || "").trim() || null
      }
    });
    toast("送迎予約を受け付けました。診療所の確認をお待ちください。");
    await renderHome(app, session, serviceDate);
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function requestReservationCancel(
  button,
  app,
  session,
  serviceDate
) {
  const reservationId = String(button.dataset.reservationId || "");
  const expectedVersion = Number(button.dataset.reservationVersion || 0);
  if (!reservationId || !expectedVersion) return;

  const reason = window.prompt(
    "取消理由を入力してください。診療所が確認後に確定します。",
    ""
  );
  if (reason === null) return;

  setBusy(button, true, "送信中…");
  try {
    await api(`/v1/reservations/${reservationId}/cancel`, {
      method: "POST",
      token: session.token,
      body: {
        expectedVersion,
        reason: String(reason).trim() || null
      }
    });
    toast("取消依頼を送信しました。診療所の確認をお待ちください。");
    await renderHome(app, session, serviceDate);
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

'''
    if marker not in s:
        raise SystemExit("PATCH ANCHOR NOT FOUND: renderChangeForm")
    s = s.replace(marker, reservation_ui + marker, 1)

    old = '''function bindHomeActions(app, session, serviceDate) {
  app
    .querySelector('[data-member-action="logout"]')
    ?.addEventListener("click", () => logoutMember(app, session));
  const form = document.getElementById("member-change-form");
  if (!form) return;'''
    new = '''function bindHomeActions(app, session, serviceDate, data) {
  app
    .querySelector('[data-member-action="logout"]')
    ?.addEventListener("click", () => logoutMember(app, session));

  const reservationForm = document.getElementById(
    "member-reservation-form"
  );
  if (reservationForm) {
    reservationForm.elements.riderId?.addEventListener(
      "change",
      () => syncReservationForm(reservationForm)
    );
    reservationForm.elements.tripType?.addEventListener(
      "change",
      () => syncReservationForm(reservationForm)
    );
    reservationForm.elements.returnMode?.addEventListener(
      "change",
      () => syncReservationForm(reservationForm)
    );
    reservationForm.elements.serviceDate?.addEventListener(
      "change",
      () => {
        refreshReservationTimeOptions(reservationForm);
        syncReservationForm(reservationForm);
      }
    );
    syncReservationForm(reservationForm);
    reservationForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitMemberReservation(
        reservationForm,
        app,
        session
      );
    });
  }

  for (const button of app.querySelectorAll(
    '[data-member-action="cancel-reservation"]'
  )) {
    button.addEventListener("click", async () => {
      await requestReservationCancel(
        button,
        app,
        session,
        serviceDate
      );
    });
  }

  const form = document.getElementById("member-change-form");
  if (!form) return;'''
    s = replace_once(s, old, new, "bind reservation actions")

    p.write_text(s, encoding="utf-8")

# =========================================================
# member.css
# =========================================================
p = Path("member.css")
css = p.read_text(encoding="utf-8")
if "PHASE3B_MEMBER_UI_R1" not in css:
    css = css.replace(
        "grid-template-columns: repeat(3, minmax(0, 1fr));",
        "grid-template-columns: repeat(4, minmax(0, 1fr));",
        1
    )
    css += r'''

/* PHASE3B_MEMBER_UI_R1 */
.member-record .member-actions {
  margin-top: 12px;
}
.member-record .member-actions .member-button {
  min-height: 44px;
  padding-block: 8px;
}
'''
    p.write_text(css, encoding="utf-8")

# =========================================================
# config.js / spec / status
# =========================================================
p = Path("config.js")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'version: "CLINIC-SHUTTLE-V2.1-R3-20260920",',
    'version: "CLINIC-SHUTTLE-V2.1-R4-20260920",'
)
p.write_text(s, encoding="utf-8")

spec_path = Path("CLINIC_SHUTTLE_BUILD_SPEC_V2_1.json")
if spec_path.exists():
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    spec["current_stage"] = "PHASE3B_MEMBER_RESERVATION_IMPLEMENTED_PENDING_RUNTIME_QA"
    spec.setdefault("phase3", {})
    spec["phase3"]["family_line_new_reservation_ui"] = True
    spec["phase3"]["guardian_reservation_privacy"] = True
    spec["phase3"]["reservation_location_guard"] = True
    spec["phase3"]["reservation_past_datetime_guard"] = True
    pending = [
        item
        for item in spec["phase3"].get("pending", [])
        if item != "family_new_reservation_ui"
    ]
    if "notification_dispatch" not in pending:
        pending.append("notification_dispatch")
    if "runtime_phase3b_qa" not in pending:
        pending.append("runtime_phase3b_qa")
    if "final_4_of_4" not in pending:
        pending.append("final_4_of_4")
    spec["phase3"]["pending"] = pending
    spec_path.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )

Path("PHASE3B_STATUS.txt").write_text(
    '''DPRO 診療所送迎予約 / PHASE 3-B STATUS

IMPLEMENTED:
- 家族/LINE側 新規送迎予約UI
- 行きのみ / 往復 / 帰りのみ
- 診療終了後に帰り便手配
- 30分単位
- 過去日・過去時刻ガード
- 患者に紐づく乗降場所のみ利用
- 診療所場所のテナント境界確認
- 家族側予約一覧
- 家族側取消依頼
- 家族APIで内部メモを返さない
- Worker / Frontend version R4

PENDING:
- PHASE 3-B runtime QA
- 通知配送連動
- System Check final
- 横断回帰QA
- FINAL 4/4
- FINAL LOCK
''',
    encoding="utf-8"
)
