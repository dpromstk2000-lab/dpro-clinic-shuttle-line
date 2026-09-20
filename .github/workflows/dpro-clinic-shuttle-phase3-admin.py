from pathlib import Path
import json

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"PATCH ANCHOR NOT FOUND: {label}")
    return text.replace(old, new, 1)

# ---------------- worker.js ----------------
p = Path("worker.js")
s = p.read_text(encoding="utf-8")
if "PHASE3_ADMIN_SURFACES_R1" not in s:
    s = s.replace(
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R2-20260920";',
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R3-20260920";\nconst PHASE3_ADMIN_SURFACES_R1 = true;'
    )
    s = s.replace(
        'apiStage: "CLINIC-SHUTTLE-V2.1-R2",',
        'apiStage: "CLINIC-SHUTTLE-V2.1-R3",'
    )

    old = """        case "POST /v1/contact-hub":
          return await handleContactHubCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/dashboard/today":"""
    new = """        case "POST /v1/contact-hub":
          return await handleContactHubCreate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/settings":
          return await handleSettingsGet(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "PATCH /v1/settings":
          return await handleSettingsUpdate(
            request,
            env,
            corsOrigin,
            requestId
          );

        case "GET /v1/dashboard/today":"""
    s = replace_once(s, old, new, "worker settings routes")

    old = """    {
      method: "POST",
      pattern: new RegExp(`^/v1/reservations/${uuidPattern}/return-ready$`, "i"),
      handler: handleReservationReturnReady,
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/staff/${uuidPattern}$`, "i"),
      handler: handleStaffUpdate,
    },"""
    new = """    {
      method: "POST",
      pattern: new RegExp(`^/v1/reservations/${uuidPattern}/return-ready$`, "i"),
      handler: handleReservationReturnReady,
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/contact-hub/${uuidPattern}$`, "i"),
      handler: handleContactHubUpdate,
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/v1/staff/${uuidPattern}$`, "i"),
      handler: handleStaffUpdate,
    },"""
    s = replace_once(s, old, new, "worker contact dynamic route")

    marker = "function publicContactEvent(row) {"
    insert = r'''
function publicSettings(row) {
  if (!row) return null;
  return {
    scheduleStepMinutes: Number(row.schedule_step_minutes),
    businessStartTime: row.business_start_time,
    businessEndTime: row.business_end_time,
    changeDeadlineTime: row.change_deadline_time,
    sameDayChangeAllowed: Boolean(row.same_day_change_allowed),
    notifyPreviousDay: Boolean(row.notify_previous_day),
    notifyDeparture: Boolean(row.notify_departure),
    notifyBoarding: Boolean(row.notify_boarding),
    notifyArrival: Boolean(row.notify_arrival),
    updatedAt: row.updated_at ?? null,
  };
}

async function loadFacilitySettings(env, facilityId) {
  const params = new URLSearchParams();
  params.set(
    "select",
    "facility_id,schedule_step_minutes,business_start_time,business_end_time,change_deadline_time,same_day_change_allowed,notify_previous_day,notify_departure,notify_boarding,notify_arrival,updated_at"
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
      404,
      "FACILITY_SETTINGS_MISSING",
      "診療所設定が見つかりません。システム確認を実行してください。"
    );
  }
  return settings;
}

async function handleSettingsGet(request, env, corsOrigin, requestId) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "settings-get", session);
  const settings = await loadFacilitySettings(env, session.facilityId);
  return successResponse(
    { settings: publicSettings(settings) },
    200,
    corsOrigin,
    requestId
  );
}

async function handleSettingsUpdate(request, env, corsOrigin, requestId) {
  const session = await requireSession(request, env, ["admin"]);
  await enforceRateLimit(request, env, "settings-update", session);
  const body = await readJsonObject(request);

  const scheduleStepMinutes = requireInteger(
    body.scheduleStepMinutes,
    "予約時間単位",
    30,
    30
  );
  const businessStartTime = requireTime(body.businessStartTime, "運行開始時刻");
  const businessEndTime = requireTime(body.businessEndTime, "運行終了時刻");
  const changeDeadlineTime = requireTime(body.changeDeadlineTime, "変更受付締切");
  const sameDayChangeAllowed = requireBoolean(body.sameDayChangeAllowed, "当日変更");
  const notifyPreviousDay = requireBoolean(body.notifyPreviousDay, "前日通知");
  const notifyDeparture = requireBoolean(body.notifyDeparture, "出発通知");
  const notifyBoarding = requireBoolean(body.notifyBoarding, "乗車通知");
  const notifyArrival = requireBoolean(body.notifyArrival, "到着通知");

  if (timeToMinutes(businessEndTime) <= timeToMinutes(businessStartTime)) {
    throw new AppError(
      400,
      "INVALID_BUSINESS_HOURS",
      "運行終了時刻は運行開始時刻より後にしてください。"
    );
  }

  const params = new URLSearchParams();
  params.set("facility_id", `eq.${session.facilityId}`);
  const rows = await supabaseRequest(
    env,
    `shuttle_settings?${params.toString()}`,
    {
      method: "PATCH",
      body: {
        schedule_step_minutes: scheduleStepMinutes,
        business_start_time: businessStartTime,
        business_end_time: businessEndTime,
        change_deadline_time: changeDeadlineTime,
        same_day_change_allowed: sameDayChangeAllowed,
        notify_previous_day: notifyPreviousDay,
        notify_departure: notifyDeparture,
        notify_boarding: notifyBoarding,
        notify_arrival: notifyArrival,
        updated_at: new Date().toISOString(),
      },
      prefer: "return=representation",
    }
  );
  const settings = Array.isArray(rows) ? rows[0] : null;
  if (!settings) {
    throw new AppError(
      409,
      "SETTINGS_UPDATE_FAILED",
      "設定を更新できませんでした。画面を更新して、もう一度お試しください。"
    );
  }

  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "update_settings",
    entityType: "settings",
    entityId: session.facilityId,
    requestId,
    request,
    newData: {
      scheduleStepMinutes,
      businessStartTime,
      businessEndTime,
      changeDeadlineTime,
      sameDayChangeAllowed,
      notifyPreviousDay,
      notifyDeparture,
      notifyBoarding,
      notifyArrival,
    },
  });

  return successResponse(
    { settings: publicSettings(settings) },
    200,
    corsOrigin,
    requestId
  );
}

async function handleContactHubUpdate(request, env, corsOrigin, requestId, contactId) {
  const session = await requireSession(request, env, [
    "admin",
    "dispatcher",
    "reception",
  ]);
  await enforceRateLimit(request, env, "contact-hub-update", session);
  const body = await readJsonObject(request);
  const expectedUpdatedAt = requireIsoTimestamp(body.expectedUpdatedAt, "更新前日時");
  const patch = {};

  if (body.status !== undefined) {
    patch.status = requireEnum(
      body.status,
      "対応状態",
      ["new", "assigned", "working", "closed"]
    );
  }
  if (body.assignedStaffId !== undefined) {
    patch.assigned_staff_id = optionalUuid(body.assignedStaffId, "担当スタッフID");
  }
  if (body.linkedRiderId !== undefined) {
    patch.linked_rider_id = optionalUuid(body.linkedRiderId, "患者ID");
  }
  if (body.linkedReservationId !== undefined) {
    patch.linked_reservation_id = optionalUuid(body.linkedReservationId, "送迎予約ID");
  }
  if (body.summary !== undefined) {
    patch.summary = requireString(body.summary, "問い合わせ内容", 1, 2000);
  }
  assertHasChanges(patch);
  patch.updated_at = new Date().toISOString();

  const params = new URLSearchParams();
  params.set("id", `eq.${contactId}`);
  params.set("facility_id", `eq.${session.facilityId}`);
  params.set("updated_at", `eq.${expectedUpdatedAt}`);

  const rows = await supabaseRequest(
    env,
    `shuttle_contact_events?${params.toString()}`,
    {
      method: "PATCH",
      body: patch,
      prefer: "return=representation",
    }
  );
  const contact = Array.isArray(rows) ? rows[0] : null;
  if (!contact) throw staleUpdateError();

  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: "update_contact_hub_event",
    entityType: "contact_event",
    entityId: contactId,
    requestId,
    request,
    newData: patch,
  });

  return successResponse(
    { contact: publicContactEvent(contact) },
    200,
    corsOrigin,
    requestId
  );
}

'''
    if marker not in s:
        raise SystemExit("PATCH ANCHOR NOT FOUND: publicContactEvent")
    s = s.replace(marker, insert + marker, 1)
    p.write_text(s, encoding="utf-8")

# ---------------- shuttle.js ----------------
p = Path("shuttle.js")
s = p.read_text(encoding="utf-8")
if "PHASE3_ADMIN_UI_R1" not in s:
    s = s.replace(
        '  const storageKey =\n    config.sessionStorageKey || "dpro_shuttle_session_v1";',
        '  const storageKey =\n    config.sessionStorageKey || "dpro_shuttle_session_v1";\n  const PHASE3_ADMIN_UI_R1 = true;'
    )
    s = s.replace(
        """      vehicles: [],
      changeRequests: [],
      systemCheck: null,
      demoPrepare: null""",
        """      vehicles: [],
      changeRequests: [],
      reservations: [],
      contacts: [],
      settings: null,
      systemCheck: null,
      demoPrepare: null"""
    )
    s = s.replace(
        """      vehicles: [],
      changeRequests: [],
      systemCheck: null
    };""",
        """      vehicles: [],
      changeRequests: [],
      reservations: [],
      contacts: [],
      settings: null,
      systemCheck: null,
      demoPrepare: null
    };"""
    )

    old = """    changes: {
      label: "変更依頼",
      shortLabel: "変更",
      icon: "▤",
      description: "欠席・時間・乗降場所などの変更依頼を確認します"
    },
    system: {"""
    new = """    changes: {
      label: "変更依頼",
      shortLabel: "変更",
      icon: "▤",
      description: "欠席・時間・乗降場所などの変更依頼を確認します"
    },
    reservations: {
      label: "予約管理",
      shortLabel: "予約",
      icon: "◫",
      description: "送迎予約・電話代理受付・往復・帰り便待ちを管理します"
    },
    contacts: {
      label: "CONTACT HUB",
      shortLabel: "受付",
      icon: "◎",
      description: "WEB・LINE・電話などの問い合わせを一元管理します"
    },
    settings: {
      label: "設定",
      shortLabel: "設定",
      icon: "☷",
      description: "運行時間・変更受付・通知設定を管理します"
    },
    system: {"""
    s = replace_once(s, old, new, "section meta phase3")

    old = """    guardianLinkStatus: {
      pending: "承認待ち",
      approved: "連携承認済み",
      rejected: "却下",
      suspended: "停止"
    },
    days: ["日", "月", "火", "水", "木", "金", "土"]"""
    new = """    guardianLinkStatus: {
      pending: "承認待ち",
      approved: "連携承認済み",
      rejected: "却下",
      suspended: "停止"
    },
    reservationStatus: {
      pending: "確認待ち",
      confirmed: "予約確認済み",
      assigned: "配車済み",
      outbound_in_progress: "行き運行中",
      at_clinic: "診療所到着",
      return_ready: "帰り便待ち",
      return_assigned: "帰り配車済み",
      return_in_progress: "帰り運行中",
      completed: "完了",
      change_requested: "変更依頼",
      cancel_requested: "取消依頼",
      cancelled: "取消",
      rejected: "却下"
    },
    tripType: {
      outbound_to_clinic: "行きのみ",
      round_trip: "往復",
      return_only: "帰りのみ"
    },
    returnMode: {
      none: "帰りなし",
      fixed_time: "時間指定",
      after_visit_ready: "診療終了後に手配"
    },
    sourceChannel: {
      owner: "管理画面",
      phone_proxy: "電話代理受付",
      web: "WEB",
      line: "LINE",
      instagram: "Instagram"
    },
    contactStatus: {
      new: "新規",
      assigned: "担当設定",
      working: "対応中",
      closed: "完了"
    },
    days: ["日", "月", "火", "水", "木", "金", "土"]"""
    s = replace_once(s, old, new, "labels phase3")

    s = s.replace(
        '${["today", "riders", "families", "schedules", "resources", "changes", "system"]',
        '${["today", "riders", "families", "schedules", "reservations", "resources", "changes", "contacts", "settings", "system"]',
        1
    )

    old = """      } else if (state.activeSection === "changes") {
        await Promise.all([loadChanges(), loadRiders("", true)]);
        renderChanges();
      } else if (state.activeSection === "system") {
        renderSystem();
      }"""
    new = """      } else if (state.activeSection === "changes") {
        await Promise.all([loadChanges(), loadRiders("", true)]);
        renderChanges();
      } else if (state.activeSection === "reservations") {
        await Promise.all([
          loadReservations(),
          loadRiders("", true),
          loadLocations()
        ]);
        renderReservations();
      } else if (state.activeSection === "contacts") {
        await Promise.all([
          loadContacts(),
          loadStaff(),
          loadRiders("", true)
        ]);
        renderContacts();
      } else if (state.activeSection === "settings") {
        await loadSettings();
        renderSettings();
      } else if (state.activeSection === "system") {
        renderSystem();
      }"""
    s = replace_once(s, old, new, "load active phase3")

    old = """  async function loadChanges() {
    const result = await api(
      `/v1/change-requests?serviceDate=${encodeURIComponent(state.serviceDate)}&limit=300`
    );
    state.data.changeRequests = result.changeRequests || [];
  }

  function renderSectionError(error) {"""
    new = """  async function loadChanges() {
    const result = await api(
      `/v1/change-requests?serviceDate=${encodeURIComponent(state.serviceDate)}&limit=300`
    );
    state.data.changeRequests = result.changeRequests || [];
  }

  async function loadReservations() {
    const result = await api(
      `/v1/reservations?serviceDate=${encodeURIComponent(state.serviceDate)}&limit=200`
    );
    state.data.reservations = result.reservations || [];
  }

  async function loadContacts() {
    const result = await api("/v1/contact-hub?limit=200");
    state.data.contacts = result.contacts || [];
  }

  async function loadSettings() {
    const result = await api("/v1/settings");
    state.data.settings = result.settings || null;
  }

  function renderSectionError(error) {"""
    s = replace_once(s, old, new, "loaders phase3")

    old = """    } else if (action === "run-system-check") {
      await runSystemCheck(actionButton);
    } else if (action === "prepare-demo") {"""
    new = """    } else if (action === "open-reservation-form") {
      openReservationForm();
    } else if (action === "confirm-reservation") {
      await confirmReservation(actionButton.dataset.id, actionButton);
    } else if (action === "return-ready-reservation") {
      await markReservationReturnReady(actionButton.dataset.id, actionButton);
    } else if (action === "cancel-reservation") {
      await cancelReservation(actionButton.dataset.id, actionButton);
    } else if (action === "open-contact-form") {
      openContactForm();
    } else if (action === "contact-status") {
      await updateContactStatus(
        actionButton.dataset.id,
        actionButton.dataset.status,
        actionButton
      );
    } else if (action === "settings-tab") {
      selectSettingsTab(actionButton.dataset.tab);
    } else if (action === "save-settings") {
      await saveSettings(actionButton);
    } else if (action === "run-system-check") {
      await runSystemCheck(actionButton);
    } else if (action === "prepare-demo") {"""
    s = replace_once(s, old, new, "click actions phase3")

    marker = "  function renderSystem() {"
    insert = r'''
  function phase3TimeOptions(selected = "") {
    const values = ['<option value="">選択してください</option>'];
    for (let hour = 0; hour < 24; hour += 1) {
      for (const minute of [0, 30]) {
        const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        values.push(
          `<option value="${value}"${selected && String(selected).slice(0, 5) === value ? " selected" : ""}>${value}</option>`
        );
      }
    }
    return values.join("");
  }

  function reservationTerminal(status) {
    return ["completed", "cancelled", "rejected"].includes(status);
  }

  function renderReservations() {
    const content = document.getElementById("main-content");
    const reservations = state.data.reservations || [];
    const riderById = new Map((state.data.riders || []).map((item) => [item.id, item]));
    const locationById = new Map((state.data.locations || []).map((item) => [item.id, item]));
    content.innerHTML = `
      <section class="content-header">
        <div>
          <h2 class="content-title">${escapeHtml(formatDate(state.serviceDate, { year: true, weekday: true }))}の予約</h2>
          <p class="content-description">WEB・LINE・電話代理受付を同じ予約台帳で管理します。時間は30分単位です。</p>
        </div>
        <div class="action-row">
          <button type="button" class="button" data-action="open-reservation-form">＋ 送迎予約</button>
        </div>
      </section>
      <section class="panel">
        <header class="panel-header">
          <div><h2 class="panel-title">予約一覧</h2><p class="panel-subtitle">${reservations.length}件</p></div>
        </header>
        ${reservations.length ? `
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr><th>患者・受付</th><th>利用</th><th>時間</th><th>状態</th><th>操作</th></tr></thead>
              <tbody>
                ${reservations.map((reservation) => {
                  const rider = riderById.get(reservation.riderId);
                  const pickup = locationById.get(reservation.pickupLocationId);
                  const clinic = locationById.get(reservation.clinicLocationId);
                  const dropoff = locationById.get(reservation.returnDropoffLocationId);
                  const times = [
                    reservation.outboundRequestedTime ? `行き ${formatTime(reservation.outboundRequestedTime)}` : null,
                    reservation.returnMode === "fixed_time" && reservation.returnRequestedTime
                      ? `帰り ${formatTime(reservation.returnRequestedTime)}`
                      : reservation.returnMode === "after_visit_ready" ? "帰り 診療終了後" : null
                  ].filter(Boolean).join("／") || "―";
                  return `<tr>
                    <td data-label="患者・受付"><span class="primary-cell">${escapeHtml(rider?.fullName || "患者不明")}</span><span class="secondary-cell">${escapeHtml(labels.sourceChannel[reservation.sourceChannel] || reservation.sourceChannel)}</span></td>
                    <td data-label="利用"><strong>${escapeHtml(labels.tripType[reservation.tripType] || reservation.tripType)}</strong><br><span class="secondary-cell">${escapeHtml([pickup?.locationName, clinic?.locationName, dropoff?.locationName].filter(Boolean).join(" → ") || "場所未設定")}</span></td>
                    <td data-label="時間">${escapeHtml(times)}</td>
                    <td data-label="状態">${statusBadge(reservation.reservationStatus, labels.reservationStatus)}</td>
                    <td data-label="操作"><div class="row-actions">
                      ${reservation.reservationStatus === "pending" ? `<button type="button" class="row-button" data-action="confirm-reservation" data-id="${escapeHtml(reservation.id)}">予約確認</button>` : ""}
                      ${reservation.returnMode === "after_visit_ready" && ["confirmed", "assigned", "outbound_in_progress", "at_clinic"].includes(reservation.reservationStatus) ? `<button type="button" class="row-button" data-action="return-ready-reservation" data-id="${escapeHtml(reservation.id)}">診療終了</button>` : ""}
                      ${!reservationTerminal(reservation.reservationStatus) ? `<button type="button" class="row-button is-danger" data-action="cancel-reservation" data-id="${escapeHtml(reservation.id)}">取消</button>` : ""}
                    </div></td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>` : emptyState("◫", "この日の予約はありません", "新規予約・電話代理受付は「送迎予約」から登録できます。", '<button type="button" class="button" data-action="open-reservation-form">送迎予約を登録</button>')}
      </section>`;
  }

  function reservationLocationOptions(kind, riderId = "") {
    const locations = (state.data.locations || []).filter((location) => {
      if (!location.isActive) return false;
      if (kind === "clinic") return location.locationType === "facility";
      return location.locationType === "facility" || !riderId || location.riderId === riderId;
    });
    return `<option value="">選択してください</option>${locations.map((location) => `<option value="${escapeHtml(location.id)}" data-rider-id="${escapeHtml(location.riderId || "")}" data-location-type="${escapeHtml(location.locationType || "")}">${escapeHtml(location.locationName)}（${location.locationType === "facility" ? "施設共通" : "患者別"}）</option>`).join("")}`;
  }

  function openReservationForm() {
    const riders = (state.data.riders || []).filter((rider) => rider.isActive !== false);
    if (!riders.length) {
      showToast("予約する患者を先に登録してください。", "warning");
      return;
    }
    const today = jstDateString(new Date());
    openModal({
      title: "送迎予約を登録",
      wide: true,
      body: `
        <form id="reservation-form" novalidate>
          <div class="form-grid">
            <div class="field"><label for="reservation-rider">患者<span class="required-mark">必須</span></label><select id="reservation-rider" name="riderId" required><option value="">選択してください</option>${riders.map((rider) => `<option value="${escapeHtml(rider.id)}">${escapeHtml(rider.fullName)}（${escapeHtml(rider.riderCode)}）</option>`).join("")}</select></div>
            <div class="field"><label for="reservation-source">受付経路<span class="required-mark">必須</span></label><select id="reservation-source" name="sourceChannel" required><option value="phone_proxy">電話代理受付</option><option value="owner">管理画面</option><option value="web">WEB</option><option value="instagram">Instagram</option></select></div>
            ${dateField("serviceDate", "送迎日", state.serviceDate < today ? today : state.serviceDate, true, today)}
            <div class="field"><label for="reservation-appointment-time">受診予定時刻</label><select id="reservation-appointment-time" name="appointmentTime">${phase3TimeOptions()}</select></div>
            <div class="field"><label for="reservation-trip-type">利用区分<span class="required-mark">必須</span></label><select id="reservation-trip-type" name="tripType" required>${Object.entries(labels.tripType).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select></div>
            <div class="field" data-reservation-field="return-mode"><label for="reservation-return-mode">帰り方法</label><select id="reservation-return-mode" name="returnMode"><option value="fixed_time">時間指定</option><option value="after_visit_ready">診療終了後に手配</option></select></div>
            <div class="field" data-reservation-field="outbound-time"><label for="reservation-outbound-time">行き希望時間<span class="required-mark">必須</span></label><select id="reservation-outbound-time" name="outboundRequestedTime">${phase3TimeOptions()}</select></div>
            <div class="field" data-reservation-field="return-time" hidden><label for="reservation-return-time">帰り希望時間</label><select id="reservation-return-time" name="returnRequestedTime">${phase3TimeOptions()}</select></div>
            <div class="field" data-reservation-field="pickup-location"><label for="reservation-pickup-location">お迎え場所</label><select id="reservation-pickup-location" name="pickupLocationId">${reservationLocationOptions("pickup")}</select></div>
            <div class="field"><label for="reservation-clinic-location">診療所<span class="required-mark">必須</span></label><select id="reservation-clinic-location" name="clinicLocationId" required>${reservationLocationOptions("clinic")}</select></div>
            <div class="field" data-reservation-field="return-location" hidden><label for="reservation-return-location">帰り降車場所</label><select id="reservation-return-location" name="returnDropoffLocationId">${reservationLocationOptions("return")}</select></div>
            <div class="field is-full"><label for="reservation-customer-note">ご本人・家族からの連絡事項</label><textarea id="reservation-customer-note" name="customerNote" maxlength="1000"></textarea></div>
            <div class="field is-full"><label for="reservation-internal-note">内部メモ</label><textarea id="reservation-internal-note" name="internalNote" maxlength="2000"></textarea><p class="field-hint">病名・検査結果・処方など、送迎に不要な医療情報は入力しないでください。</p></div>
          </div>
        </form>`,
      footer: modalFormFooter("reservation-form", "内容確認して登録"),
      onReady: (dialog) => {
        const form = dialog.querySelector("#reservation-form");
        const sync = () => syncReservationForm(form);
        form.elements.riderId?.addEventListener("change", sync);
        form.elements.tripType?.addEventListener("change", sync);
        form.elements.returnMode?.addEventListener("change", sync);
        sync();
        bindModalForm(dialog, "reservation-form", submitReservation);
      }
    });
  }

  function syncReservationForm(form) {
    if (!form) return;
    const riderId = String(form.elements.riderId?.value || "");
    const tripType = String(form.elements.tripType?.value || "outbound_to_clinic");
    const returnMode = String(form.elements.returnMode?.value || "fixed_time");
    const outbound = form.querySelector('[data-reservation-field="outbound-time"]');
    const returnModeField = form.querySelector('[data-reservation-field="return-mode"]');
    const returnTime = form.querySelector('[data-reservation-field="return-time"]');
    const pickup = form.querySelector('[data-reservation-field="pickup-location"]');
    const returnLocation = form.querySelector('[data-reservation-field="return-location"]');
    if (outbound) outbound.hidden = tripType === "return_only";
    if (pickup) pickup.hidden = tripType === "return_only";
    if (returnModeField) returnModeField.hidden = tripType === "outbound_to_clinic";
    if (returnLocation) returnLocation.hidden = tripType === "outbound_to_clinic";
    if (returnTime) returnTime.hidden = tripType === "outbound_to_clinic" || returnMode !== "fixed_time";
    if (form.elements.outboundRequestedTime) {
      form.elements.outboundRequestedTime.required = tripType !== "return_only";
      if (tripType === "return_only") form.elements.outboundRequestedTime.value = "";
    }
    if (form.elements.returnRequestedTime) {
      form.elements.returnRequestedTime.required = tripType !== "outbound_to_clinic" && returnMode === "fixed_time";
      if (returnMode !== "fixed_time" || tripType === "outbound_to_clinic") form.elements.returnRequestedTime.value = "";
    }
    for (const name of ["pickupLocationId", "returnDropoffLocationId"]) {
      const select = form.elements[name];
      if (!select) continue;
      for (const option of [...select.options]) {
        if (!option.value) { option.hidden = false; continue; }
        const locationRiderId = option.dataset.riderId || "";
        const locationType = option.dataset.locationType || "";
        option.hidden = locationType !== "facility" && Boolean(riderId) && locationRiderId !== riderId;
      }
      if (select.selectedOptions[0]?.hidden) select.value = "";
    }
  }

  async function submitReservation(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const tripType = String(values.tripType || "");
    const returnMode = tripType === "outbound_to_clinic" ? "none" : String(values.returnMode || "fixed_time");
    const outboundRequestedTime = tripType === "return_only" ? null : nullIfEmpty(String(values.outboundRequestedTime || ""));
    const returnRequestedTime = tripType !== "outbound_to_clinic" && returnMode === "fixed_time" ? nullIfEmpty(String(values.returnRequestedTime || "")) : null;
    for (const [label, value] of [["行き希望時間", outboundRequestedTime], ["帰り希望時間", returnRequestedTime], ["受診予定時刻", nullIfEmpty(String(values.appointmentTime || ""))]]) {
      if (value && !isThirtyMinuteStep(String(value).slice(0, 5))) throw new Error(`${label}は30分単位（00分・30分）で選択してください。`);
    }
    const rider = (state.data.riders || []).find((item) => item.id === String(values.riderId || ""));
    const summary = [`患者：${rider?.fullName || "患者"}`, `送迎日：${String(values.serviceDate || "")}`, `利用：${labels.tripType[tripType] || tripType}`, outboundRequestedTime ? `行き：${outboundRequestedTime}` : null, returnMode === "fixed_time" && returnRequestedTime ? `帰り：${returnRequestedTime}` : null, returnMode === "after_visit_ready" ? "帰り：診療終了後に手配" : null, `受付：${labels.sourceChannel[String(values.sourceChannel || "")] || values.sourceChannel || ""}`].filter(Boolean).join("\n");
    if (!window.confirm(`この内容で送迎予約を登録します。\n\n${summary}`)) return;
    await api("/v1/reservations", { method: "POST", body: {
      riderId: String(values.riderId || ""), sourceChannel: String(values.sourceChannel || "phone_proxy"), serviceDate: String(values.serviceDate || ""), appointmentTime: nullIfEmpty(String(values.appointmentTime || "")), tripType, returnMode, outboundRequestedTime, returnRequestedTime,
      pickupLocationId: tripType === "return_only" ? null : nullIfEmpty(String(values.pickupLocationId || "")), clinicLocationId: nullIfEmpty(String(values.clinicLocationId || "")), returnDropoffLocationId: tripType === "outbound_to_clinic" ? null : nullIfEmpty(String(values.returnDropoffLocationId || "")), customerNote: nullIfEmpty(String(values.customerNote || "")), internalNote: nullIfEmpty(String(values.internalNote || ""))
    }});
    closeModal(); await loadReservations(); renderReservations(); showToast("送迎予約を登録しました。");
  }

  async function confirmReservation(reservationId, button) {
    const reservation = (state.data.reservations || []).find((item) => item.id === reservationId);
    if (!reservation) return;
    setBusy(button, true, "更新中…");
    try {
      await api(`/v1/reservations/${reservationId}`, { method: "PATCH", body: { expectedVersion: reservation.version, reservationStatus: "confirmed" } });
      await loadReservations(); renderReservations(); showToast("予約を確認済みにしました。");
    } catch (error) { showToast(friendlyError(error), "error"); } finally { setBusy(button, false); }
  }

  async function markReservationReturnReady(reservationId, button) {
    const reservation = (state.data.reservations || []).find((item) => item.id === reservationId);
    if (!reservation) return;
    setBusy(button, true, "更新中…");
    try {
      await api(`/v1/reservations/${reservationId}/return-ready`, { method: "POST", body: { expectedVersion: reservation.version } });
      await loadReservations(); renderReservations(); showToast("診療終了を記録し、帰り便待ちにしました。");
    } catch (error) { showToast(friendlyError(error), "error"); } finally { setBusy(button, false); }
  }

  async function cancelReservation(reservationId, button) {
    const reservation = (state.data.reservations || []).find((item) => item.id === reservationId);
    if (!reservation) return;
    const reason = window.prompt("取消理由を入力してください。", "");
    if (reason === null) return;
    setBusy(button, true, "取消中…");
    try {
      await api(`/v1/reservations/${reservationId}/cancel`, { method: "POST", body: { expectedVersion: reservation.version, reason: nullIfEmpty(String(reason).trim()) } });
      await loadReservations(); renderReservations(); showToast("予約を取り消しました。");
    } catch (error) { showToast(friendlyError(error), "error"); } finally { setBusy(button, false); }
  }

  function renderContacts() {
    const content = document.getElementById("main-content");
    const contacts = state.data.contacts || [];
    const staffById = new Map((state.data.staff || []).map((item) => [item.id, item]));
    content.innerHTML = `
      <section class="content-header"><div><h2 class="content-title">CONTACT HUB</h2><p class="content-description">WEB・LINE・Instagram・電話の受付を1つの窓口で確認します。</p></div><div class="action-row"><button type="button" class="button" data-action="open-contact-form">＋ 受付を登録</button></div></section>
      <section class="panel"><header class="panel-header"><div><h2 class="panel-title">受付一覧</h2><p class="panel-subtitle">${contacts.length}件</p></div></header>
      ${contacts.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>受付</th><th>連絡先</th><th>内容</th><th>状態</th><th>操作</th></tr></thead><tbody>${contacts.map((contact) => `<tr><td data-label="受付"><span class="primary-cell">${escapeHtml(labels.sourceChannel[contact.sourceChannel] || contact.sourceChannel)}</span><span class="secondary-cell">${escapeHtml(formatDate(contact.createdAt, { year: true }))}</span></td><td data-label="連絡先"><strong>${escapeHtml(contact.customerName || "氏名未登録")}</strong><br><span class="secondary-cell">${escapeHtml(contact.phone || contact.email || "―")}</span></td><td data-label="内容">${escapeHtml(contact.summary)}</td><td data-label="状態">${statusBadge(contact.status, labels.contactStatus)}${contact.assignedStaffId ? `<div class="secondary-cell">${escapeHtml(staffById.get(contact.assignedStaffId)?.fullName || "担当設定済み")}</div>` : ""}</td><td data-label="操作"><div class="row-actions">${contact.status !== "working" && contact.status !== "closed" ? `<button type="button" class="row-button" data-action="contact-status" data-status="working" data-id="${escapeHtml(contact.id)}">対応中</button>` : ""}${contact.status !== "closed" ? `<button type="button" class="row-button" data-action="contact-status" data-status="closed" data-id="${escapeHtml(contact.id)}">完了</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>` : emptyState("◎", "受付はありません", "電話受付やWEB・LINEからの問い合わせをここへ集約します。", '<button type="button" class="button" data-action="open-contact-form">受付を登録</button>')}
      </section>`;
  }

  function openContactForm() {
    openModal({ title: "CONTACT HUBへ登録", body: `<form id="contact-form" novalidate><div class="form-grid"><div class="field"><label for="contact-source">受付経路<span class="required-mark">必須</span></label><select id="contact-source" name="sourceChannel" required><option value="phone_proxy">電話</option><option value="web">WEB</option><option value="line">LINE</option><option value="instagram">Instagram</option></select></div>${textField("customerName", "氏名", { maxlength: 100 })}${textField("phone", "電話番号", { maxlength: 30, inputmode: "tel" })}${textField("email", "メールアドレス", { maxlength: 320 })}<div class="field is-full"><label for="contact-summary">問い合わせ内容<span class="required-mark">必須</span></label><textarea id="contact-summary" name="summary" maxlength="2000" required></textarea></div></div></form>`, footer: modalFormFooter("contact-form", "登録する"), onReady: (dialog) => bindModalForm(dialog, "contact-form", submitContact) });
  }

  async function submitContact(form) {
    const phone = formValue(form, "phone");
    if (phone && !isValidPhone(phone)) throw new Error("電話番号を正しく入力してください。");
    await api("/v1/contact-hub", { method: "POST", body: { sourceChannel: formValue(form, "sourceChannel"), customerName: nullIfEmpty(formValue(form, "customerName")), phone: nullIfEmpty(phone), email: nullIfEmpty(formValue(form, "email")), summary: formValue(form, "summary") } });
    closeModal(); await loadContacts(); renderContacts(); showToast("受付をCONTACT HUBへ登録しました。");
  }

  async function updateContactStatus(contactId, status, button) {
    const contact = (state.data.contacts || []).find((item) => item.id === contactId);
    if (!contact) return;
    setBusy(button, true, "更新中…");
    try {
      await api(`/v1/contact-hub/${contactId}`, { method: "PATCH", body: { expectedUpdatedAt: contact.updatedAt, status } });
      await loadContacts(); renderContacts(); showToast(status === "closed" ? "受付を完了しました。" : "対応中へ変更しました。");
    } catch (error) { showToast(friendlyError(error), "error"); } finally { setBusy(button, false); }
  }

  function renderSettings() {
    const content = document.getElementById("main-content");
    const settings = state.data.settings;
    if (!settings) { content.innerHTML = `<section class="panel">${emptyState("!", "設定を読み込めません", "システム確認を実行してください。")}</section>`; return; }
    const readOnly = state.role !== "admin";
    content.innerHTML = `
      <section class="content-header"><div><h2 class="content-title">設定</h2><p class="content-description">左の項目を選び、右側で設定します。30分単位はDPRO固定仕様です。</p></div></section>
      <section class="settings-layout"><nav class="settings-index" aria-label="設定メニュー"><button type="button" class="settings-index-button is-active" data-action="settings-tab" data-tab="operation">運行・予約</button><button type="button" class="settings-index-button" data-action="settings-tab" data-tab="changes">変更受付</button><button type="button" class="settings-index-button" data-action="settings-tab" data-tab="notifications">通知</button></nav>
      <div class="panel settings-content"><form id="settings-form" novalidate>
        <section data-settings-panel="operation"><header class="panel-header"><div><h2 class="panel-title">運行・予約</h2><p class="panel-subtitle">営業時間と予約単位</p></div></header><div class="panel-body"><div class="form-grid"><div class="field"><label for="settings-step">予約時間単位</label><input id="settings-step" value="30分" disabled><p class="field-hint">DPRO標準：00分・30分のみ</p></div><div class="field"><label for="settings-start">運行開始時刻<span class="required-mark">必須</span></label><input id="settings-start" name="businessStartTime" type="time" step="1800" required value="${escapeHtml(String(settings.businessStartTime || "07:00").slice(0, 5))}" ${readOnly ? "disabled" : ""}></div><div class="field"><label for="settings-end">運行終了時刻<span class="required-mark">必須</span></label><input id="settings-end" name="businessEndTime" type="time" step="1800" required value="${escapeHtml(String(settings.businessEndTime || "20:00").slice(0, 5))}" ${readOnly ? "disabled" : ""}></div></div></div></section>
        <section data-settings-panel="changes" hidden><header class="panel-header"><div><h2 class="panel-title">変更受付</h2><p class="panel-subtitle">締切と当日変更</p></div></header><div class="panel-body"><div class="form-grid"><div class="field"><label for="settings-deadline">変更受付締切<span class="required-mark">必須</span></label><input id="settings-deadline" name="changeDeadlineTime" type="time" step="1800" required value="${escapeHtml(String(settings.changeDeadlineTime || "17:00").slice(0, 5))}" ${readOnly ? "disabled" : ""}></div><label class="switch-row"><span><strong>当日変更を許可</strong><small>欠席・時間変更などを当日も受付</small></span><input type="checkbox" name="sameDayChangeAllowed" ${settings.sameDayChangeAllowed ? "checked" : ""} ${readOnly ? "disabled" : ""}></label></div></div></section>
        <section data-settings-panel="notifications" hidden><header class="panel-header"><div><h2 class="panel-title">通知</h2><p class="panel-subtitle">通知タイミング</p></div></header><div class="panel-body"><div class="settings-switch-list">${[["notifyPreviousDay", "前日通知", settings.notifyPreviousDay], ["notifyDeparture", "出発通知", settings.notifyDeparture], ["notifyBoarding", "乗車通知", settings.notifyBoarding], ["notifyArrival", "到着通知", settings.notifyArrival]].map(([name, label, checked]) => `<label class="switch-row"><span><strong>${escapeHtml(label)}</strong><small>通知チャネル設定が有効な場合に使用</small></span><input type="checkbox" name="${escapeHtml(name)}" ${checked ? "checked" : ""} ${readOnly ? "disabled" : ""}></label>`).join("")}</div></div></section>
      </form><div class="settings-savebar">${readOnly ? '<span class="content-description">設定変更は管理者権限で行います。</span>' : '<button type="button" class="button" data-action="save-settings">設定を保存</button>'}</div></div></section>`;
  }

  function selectSettingsTab(tab) {
    for (const button of document.querySelectorAll("[data-action='settings-tab']")) button.classList.toggle("is-active", button.dataset.tab === tab);
    for (const panel of document.querySelectorAll("[data-settings-panel]")) panel.hidden = panel.dataset.settingsPanel !== tab;
  }

  async function saveSettings(button) {
    const form = document.getElementById("settings-form");
    if (!form || !form.reportValidity()) return;
    const values = new FormData(form);
    const start = String(values.get("businessStartTime") || "");
    const end = String(values.get("businessEndTime") || "");
    const deadline = String(values.get("changeDeadlineTime") || "");
    if (![start, end, deadline].every(isThirtyMinuteStep)) { showToast("時刻は30分単位（00分・30分）で選択してください。", "error"); return; }
    if (end <= start) { showToast("運行終了時刻は開始時刻より後にしてください。", "error"); return; }
    setBusy(button, true, "保存中…");
    try {
      const result = await api("/v1/settings", { method: "PATCH", body: { scheduleStepMinutes: 30, businessStartTime: start, businessEndTime: end, changeDeadlineTime: deadline, sameDayChangeAllowed: form.elements.sameDayChangeAllowed.checked, notifyPreviousDay: form.elements.notifyPreviousDay.checked, notifyDeparture: form.elements.notifyDeparture.checked, notifyBoarding: form.elements.notifyBoarding.checked, notifyArrival: form.elements.notifyArrival.checked } });
      state.data.settings = result.settings; renderSettings(); showToast("設定を保存しました。");
    } catch (error) { showToast(friendlyError(error), "error"); } finally { setBusy(button, false); }
  }

'''
    if marker not in s:
        raise SystemExit("PATCH ANCHOR NOT FOUND: renderSystem")
    s = s.replace(marker, insert + marker, 1)
    p.write_text(s, encoding="utf-8")

# ---------------- shuttle.css ----------------
p = Path("shuttle.css")
css = p.read_text(encoding="utf-8")
if "PHASE3_ADMIN_UI_R1" not in css:
    css += r'''

/* PHASE3_ADMIN_UI_R1 */
.settings-layout {
  display: grid;
  grid-template-columns: minmax(180px, 230px) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.settings-index {
  position: sticky;
  top: 96px;
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}
.settings-index-button {
  width: 100%;
  min-height: 46px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ink);
  text-align: left;
  font-weight: 800;
  cursor: pointer;
}
.settings-index-button:hover,
.settings-index-button.is-active {
  border-color: var(--teal);
  background: var(--teal-soft);
  color: var(--teal-dark);
}
.settings-content { overflow: hidden; }
.settings-content [data-settings-panel][hidden] { display: none !important; }
.settings-savebar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 18px 22px;
  border-top: 1px solid var(--line);
  background: var(--surface-soft);
}
.settings-switch-list { display: grid; gap: 10px; }
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 64px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
}
.switch-row span { display: grid; gap: 3px; }
.switch-row small { color: var(--muted); }
.switch-row input[type="checkbox"] { width: 46px; height: 26px; margin: 0; accent-color: var(--teal); }
@media (max-width: 820px) {
  .settings-layout { grid-template-columns: 1fr; }
  .settings-index { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .settings-index-button { text-align: center; padding-inline: 6px; }
}
'''
    p.write_text(css, encoding="utf-8")

# ---------------- config.js ----------------
p = Path("config.js")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'version: "CLINIC-SHUTTLE-V2.1-R2-20260920",',
    'version: "CLINIC-SHUTTLE-V2.1-R3-20260920",'
)
p.write_text(s, encoding="utf-8")

# ---------------- build spec / status ----------------
spec_path = Path("CLINIC_SHUTTLE_BUILD_SPEC_V2_1.json")
if spec_path.exists():
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    spec["current_stage"] = "PHASE3_ADMIN_SURFACES_IMPLEMENTED_PENDING_RUNTIME_QA"
    spec["phase3"] = {
        "admin_reservation_ui": True,
        "phone_proxy_reservation": True,
        "contact_hub_ui": True,
        "settings_left_index_right_panel": True,
        "settings_api": True,
        "contact_status_update_api": True,
        "pending": [
            "family_new_reservation_ui",
            "notification_dispatch",
            "runtime_phase3_qa",
            "final_4_of_4"
        ]
    }
    spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

Path("PHASE3_STATUS.txt").write_text(
    """DPRO 診療所送迎予約 / PHASE 3 STATUS

IMPLEMENTED:
- 管理側 予約管理画面
- 電話代理受付
- 行きのみ / 往復 / 帰りのみ
- 診療終了後の帰り便待ち
- CONTACT HUB 一覧 / 新規受付 / 対応中 / 完了
- 設定画面（左メニュー / 右パネル）
- 運行時間 / 変更締切 / 当日変更 / 通知設定
- GET/PATCH /v1/settings
- PATCH /v1/contact-hub/:id
- Frontend / Worker version R3

PENDING:
- 家族/LINE 新規送迎予約UI
- 通知配送連動
- PHASE3 runtime QA
- System Check final
- FACTORY FINAL 4/4
- FINAL LOCK
""",
    encoding="utf-8"
)
