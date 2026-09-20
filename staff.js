const ROLE_LABELS = Object.freeze({
  admin: "管理者",
  dispatcher: "配車担当",
  driver: "運転員",
  attendant: "添乗員",
  reception: "受付"
});

const SERVICE_LABELS = Object.freeze({
  pickup: "迎え",
  dropoff: "送り",
  transfer: "施設間移送"
});

const RUN_STATUS_LABELS = Object.freeze({
  planned: "未確認",
  ready: "準備完了",
  in_progress: "運行中",
  completed: "完了",
  cancelled: "キャンセル"
});

const STOP_STATUS_LABELS = Object.freeze({
  planned: "予定",
  confirmed: "確認済み",
  en_route: "向かっています",
  boarded: "乗車済み",
  no_show: "不在",
  arrived: "到着",
  handed_over: "引渡し済み",
  completed: "完了",
  cancelled: "キャンセル"
});

const SUPPORT_LABELS = Object.freeze({
  independent: "自立",
  supervision: "見守り",
  partial_assist: "一部介助",
  full_assist: "全介助",
  wheelchair: "車いす"
});

const EVENT_LABELS = Object.freeze({
  confirm: "予定を確認",
  en_route: "お迎えへ出発",
  boarded: "乗車を記録",
  no_show: "不在を記録",
  arrived: "到着を記録",
  handed_over: "引渡しを記録",
  completed: "対応を完了",
  cancelled: "キャンセル"
});

const TERMINAL_STOP_STATUSES = new Set([
  "completed",
  "cancelled",
  "no_show"
]);

export function jstDateString(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function nextStopActions(stop) {
  const status = String(stop?.stopStatus || "");
  if (status === "planned") {
    return [{ eventType: "confirm", tone: "primary" }];
  }
  if (status === "confirmed") {
    return [
      { eventType: "en_route", tone: "primary" },
      { eventType: "boarded", tone: "secondary" },
      { eventType: "no_show", tone: "danger" }
    ];
  }
  if (status === "en_route") {
    return [
      { eventType: "boarded", tone: "primary" },
      { eventType: "no_show", tone: "danger" }
    ];
  }
  if (status === "boarded") {
    return [{ eventType: "arrived", tone: "primary" }];
  }
  if (status === "arrived") {
    return [{
      eventType: stop?.rider?.requiresHandover
        ? "handed_over"
        : "completed",
      tone: "primary"
    }];
  }
  if (status === "handed_over") {
    return [{ eventType: "completed", tone: "primary" }];
  }
  return [];
}

export function statusTone(status) {
  if (["ready", "confirmed", "completed", "handed_over"].includes(status)) {
    return "status-ready";
  }
  if (["in_progress", "en_route", "boarded", "arrived"].includes(status)) {
    return "status-running";
  }
  if (["no_show", "planned"].includes(status)) {
    return "status-warning";
  }
  if (["cancelled"].includes(status)) {
    return "status-danger";
  }
  return "";
}

export function effectiveRunStatus(run) {
  if (["cancelled", "completed"].includes(run?.runStatus)) {
    return run.runStatus;
  }
  const stops = Array.isArray(run?.stops) ? run.stops : [];
  if (
    stops.length > 0 &&
    stops.every((stop) => TERMINAL_STOP_STATUSES.has(stop.stopStatus))
  ) {
    return "completed";
  }
  if (
    stops.some((stop) =>
      ["en_route", "boarded", "arrived", "handed_over"].includes(
        stop.stopStatus
      )
    )
  ) {
    return "in_progress";
  }
  if (
    stops.length > 0 &&
    stops.every((stop) =>
      ["confirmed", "completed", "cancelled", "no_show"].includes(
        stop.stopStatus
      )
    )
  ) {
    return "ready";
  }
  return run?.runStatus || "planned";
}

export function formatJstTime(value) {
  if (!value) return "―";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }
  const match = String(value).match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "―";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createStaffApplication() {
  const config = window.DPRO_SHUTTLE_CONFIG || {};
  const query = new URLSearchParams(window.location.search);
  const mockMode = query.get("mock") === "1";
  const demoMode =
    query.get("demo") === "1" || config.environment === "demo";
  const storageKey = `${
    config.sessionStorageKey || "dpro_shuttle_session_v1"
  }_staff`;
  const app = document.getElementById("staff-app");
  const toastRegion = document.getElementById("staff-toast");
  const eventDialog = document.getElementById("event-dialog");
  const eventForm = document.getElementById("event-form");
  const eventAttemptKeys = new Map();

  const state = {
    token: null,
    role: null,
    staff: null,
    facility: null,
    serviceDate: jstDateString(),
    runs: [],
    loading: false,
    pendingEvent: null
  };

  function getSession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (!session || typeof session.token !== "string") return null;
      if (!["admin", "dispatcher", "driver", "attendant"].includes(session.role)) {
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  function saveSession() {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        token: state.token,
        role: state.role,
        staff: state.staff,
        facility: state.facility
      })
    );
  }

  function clearSession() {
    sessionStorage.removeItem(storageKey);
    state.token = null;
    state.role = null;
    state.staff = null;
    state.facility = null;
    state.runs = [];
  }

  function restoreSession() {
    const session = getSession();
    if (!session) return false;
    state.token = session.token;
    state.role = session.role;
    state.staff = session.staff;
    state.facility = session.facility;
    return true;
  }

  async function api(path, options = {}) {
    if (mockMode) return mockApi(path, options);
    const base = String(config.apiBaseUrl || "").replace(/\/+$/, "");
    if (!base.startsWith("https://")) {
      throw new Error("API接続先が正しく設定されていません。");
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      Number(config.requestTimeoutMs) || 12000
    );
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers({ Accept: "application/json" });
    if (state.token) {
      headers.set("Authorization", `Bearer ${state.token}`);
    }
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (["POST", "PATCH"].includes(method) && options.idempotent !== false) {
      headers.set("Idempotency-Key", options.idempotencyKey || uuid());
    }
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
        signal: controller.signal,
        cache: "no-store"
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      if (!response.ok || payload.ok === false) {
        const message =
          payload?.error?.message ||
          (response.status === 401
            ? "ログインの有効期限が切れました。もう一度ログインしてください。"
            : response.status === 403
              ? "担当していない便、または権限のない操作です。"
              : response.status === 409
                ? "他の端末で先に更新されました。最新情報を読み直してください。"
                : `通信エラーが発生しました（${response.status}）。`);
        const error = new Error(message);
        error.status = response.status;
        error.code = payload?.error?.code || "HTTP_ERROR";
        if (response.status === 401) {
          clearSession();
          window.setTimeout(() => renderLogin(message), 0);
        }
        throw error;
      }
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function mockApi(path, options = {}) {
    const baseDate = state.serviceDate;
    if (path === "/v1/auth/staff") {
      return Promise.resolve({
        ok: true,
        token: "mock-staff-token",
        role: "driver",
        staff: {
          id: "55555555-5555-4555-8555-555555555555",
          staffCode: "DEMO-DRV",
          fullName: "デモ 運転員"
        },
        facility: {
          facilityCode: config.facilityCode,
          facilityName: "DPRO 診療所送迎予約 デモ診療所",
          environment: "demo"
        }
      });
    }
    if (path.startsWith("/v1/runs?")) {
      if (!state.runs.length) {
        state.runs = [{
          id: "88888888-8888-4888-8888-888888888888",
          serviceDate: baseDate,
          runCode: "デモ朝便A",
          serviceType: "pickup",
          routeGroupCode: "北エリア",
          scheduledStartAt: `${baseDate}T08:00:00+09:00`,
          scheduledEndAt: `${baseDate}T09:30:00+09:00`,
          runStatus: "in_progress",
          notes: "道路工事のため東側から進入",
          vehicle: {
            vehicleName: "デモ送迎車1号",
            plateNumber: "福岡 500 で 10-01",
            hasLift: true
          },
          assignments: [{
            staffId: "55555555-5555-4555-8555-555555555555",
            duty: "driver",
            staff: { fullName: "デモ 運転員" }
          }],
          stops: [
            mockStop("1", 1, "デモ 患者A", "confirmed", false, true, "08:05"),
            mockStop("2", 2, "デモ 患者B", "en_route", true, true, "08:20"),
            mockStop("3", 3, "デモ 患者C", "completed", false, false, "08:35")
          ]
        }];
      }
      return Promise.resolve({
        ok: true,
        serviceDate: baseDate,
        runs: structuredClone(state.runs),
        count: state.runs.length
      });
    }
    if (/^\/v1\/stops\/[^/]+\/events$/.test(path) && options.method === "POST") {
      const stopId = path.split("/")[3];
      const stop = state.runs.flatMap((run) => run.stops)
        .find((item) => item.id === stopId);
      if (stop) {
        const statusByEvent = {
          confirm: "confirmed",
          en_route: "en_route",
          boarded: "boarded",
          no_show: "no_show",
          arrived: "arrived",
          handed_over: "handed_over",
          completed: "completed",
          cancelled: "cancelled"
        };
        stop.stopStatus = statusByEvent[options.body.eventType];
        stop.version = Number(stop.version || 1) + 1;
      }
      return Promise.resolve({
        ok: true,
        rideEvent: {
          duplicate: false,
          stop_id: stopId,
          status: stop?.stopStatus
        }
      });
    }
    if (path === "/v1/auth/logout") {
      return Promise.resolve({ ok: true, loggedOut: true });
    }
    return Promise.reject(new Error("画面検査用APIに未対応の操作です。"));
  }

  function mockStop(id, order, name, status, wheelchair, handover, time) {
    return {
      id,
      version: 1,
      stopOrder: order,
      stopStatus: status,
      plannedPickupAt: `${state.serviceDate}T${time}:00+09:00`,
      plannedDropoffAt: `${state.serviceDate}T09:15:00+09:00`,
      rider: {
        riderCode: `DEMO-R0${order}`,
        fullName: name,
        transportSupportLevel: wheelchair ? "wheelchair" : "supervision",
        usesWheelchair: wheelchair,
        requiresHandover: handover,
        transportNotes: handover ? "ご家族への引渡し確認が必要です。" : null
      },
      pickupLocation: {
        locationName: `${name}様 ご自宅`,
        addressLine1: "福岡県デモ市1-2-3",
        accessNotes: order === 2 ? "玄関前は狭いため道路側で乗車" : null
      },
      dropoffLocation: {
        locationName: "DPRO デモ福祉施設",
        addressLine1: "福岡県デモ市4-5-6"
      },
      supportSummary: wheelchair ? "リフト操作・車いす固定" : null,
      handoverNotes: handover ? "ご家族へ対面で引渡し" : null
    };
  }

  function renderLogin(errorMessage = "") {
    app.className = "";
    app.removeAttribute("aria-busy");
    app.innerHTML = `
      <main class="login-page">
        <section class="login-brand" aria-label="DPRO診療所送迎予約">
          <div class="brand-lockup">
            <span class="brand-mark" aria-hidden="true">▰</span>
            <div>
              <p class="brand-name">DPRO</p>
              <p class="brand-subtitle">診療所送迎予約 LINE</p>
            </div>
          </div>
          <div class="login-message">
            <h1>今日の担当便を、<br>スマホで確実に。</h1>
            <p>乗車・到着・引渡しを順番どおりに記録し、二重操作を防ぎます。</p>
          </div>
        </section>
        <section class="login-panel-wrap">
          <div class="login-panel">
            <p class="eyebrow">現場スタッフ画面</p>
            <h2>ログイン</h2>
            <p class="login-lead">診療所から発行されたスタッフIDを入力してください。</p>
            <div class="login-card">
              ${errorMessage
                ? `<p class="login-error" role="alert">${escapeHtml(errorMessage)}</p>`
                : ""}
              <form id="staff-login-form" novalidate>
                <div class="field">
                  <label for="facility-code">診療所コード<span class="required">必須</span></label>
                  <input id="facility-code" name="facilityCode" type="text" autocomplete="organization" required maxlength="80" value="${escapeHtml(config.facilityCode || "")}">
                </div>
                <div class="field">
                  <label for="login-id">スタッフID<span class="required">必須</span></label>
                  <input id="login-id" name="loginId" type="text" autocomplete="username" required minlength="3" maxlength="100" value="${demoMode ? "demo.driver" : ""}">
                </div>
                <div class="field">
                  <label for="staff-pin">暗証番号<span class="required">必須</span></label>
                  <div class="input-with-clear">
                    <input id="staff-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required minlength="4" maxlength="64" value="${demoMode ? "5678" : ""}">
                    <button type="button" class="clear-button" data-clear="staff-pin" aria-label="暗証番号を削除">×</button>
                  </div>
                </div>
                <button type="submit" class="button button-wide">担当便を開く</button>
              </form>
              ${demoMode
                ? '<p class="demo-note">デモ運転員：スタッフID「demo.driver」／暗証番号「5678」<br>先に管理・配車画面で運転員を便へ割り当ててください。</p>'
                : ""}
              <div class="login-links">
                <a class="button button-secondary button-wide" href="owner.html">管理・配車画面へ戻る</a>
              </div>
            </div>
            <p class="version-line">${escapeHtml(config.version || "SHUTTLE-6-FRONTEND-20260728")}</p>
          </div>
        </section>
      </main>`;
    app.querySelector("[data-clear]")?.addEventListener("click", (event) => {
      const input = document.getElementById(event.currentTarget.dataset.clear);
      if (input) {
        input.value = "";
        input.focus();
      }
    });
    document.getElementById("staff-login-form")
      ?.addEventListener("submit", handleLogin);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]');
    setBusy(submit, true, "確認しています…");
    const data = new FormData(form);
    try {
      const result = await api("/v1/auth/staff", {
        method: "POST",
        body: {
          facilityCode: String(data.get("facilityCode") || "").trim(),
          loginId: String(data.get("loginId") || "").trim(),
          pin: String(data.get("pin") || "")
        },
        idempotent: false
      });
      if (!["admin", "dispatcher", "driver", "attendant"].includes(result.role)) {
        throw new Error("このスタッフ権限では現場運行画面を利用できません。");
      }
      state.token = result.token;
      state.role = result.role;
      state.staff = result.staff || {
        fullName: ROLE_LABELS[result.role] || "スタッフ"
      };
      state.facility = result.facility;
      saveSession();
      renderShell();
      await loadRuns();
      showToast("担当便を読み込みました。");
    } catch (error) {
      renderLogin(friendlyError(error));
    } finally {
      setBusy(submit, false);
    }
  }

  function renderShell() {
    app.className = "";
    app.removeAttribute("aria-busy");
    app.innerHTML = `
      <div class="staff-shell">
        <header class="topbar">
          <div class="topbar-brand">
            <span class="brand-mark" aria-hidden="true">▰</span>
            <div>
              <p class="brand-name">DPRO</p>
              <p class="brand-subtitle">診療所送迎予約 現場</p>
            </div>
          </div>
          <div class="staff-identity">
            <strong>${escapeHtml(state.staff?.fullName || "スタッフ")}</strong>
            <span>${escapeHtml(ROLE_LABELS[state.role] || state.role || "―")}</span>
          </div>
        </header>
        <main class="main">
          <section class="page-head">
            <div>
              <h1>本日の担当便</h1>
              <p>${escapeHtml(formatServiceDate(state.serviceDate))}・${escapeHtml(state.facility?.facilityName || "DPRO 診療所送迎予約")}</p>
            </div>
            <div class="head-actions">
              <button type="button" class="icon-button" data-action="refresh" aria-label="担当便を更新" title="担当便を更新">↻</button>
              <button type="button" class="icon-button" data-action="logout" aria-label="ログアウト" title="ログアウト">⇥</button>
            </div>
          </section>
          <div id="staff-content">
            <div class="empty-state" role="status">
              <span class="spinner" aria-hidden="true"></span>
              <h2>担当便を読み込んでいます</h2>
            </div>
          </div>
          <div class="footer-actions">
            <a class="button button-secondary" href="owner.html">管理・配車画面</a>
          </div>
        </main>
      </div>`;
    app.querySelector('[data-action="refresh"]')
      ?.addEventListener("click", (event) => loadRuns(event.currentTarget));
    app.querySelector('[data-action="logout"]')
      ?.addEventListener("click", logout);
  }

  async function loadRuns(button = null) {
    if (state.loading) return;
    state.loading = true;
    setBusy(button, true, "…");
    try {
      const result = await api(
        `/v1/runs?serviceDate=${encodeURIComponent(state.serviceDate)}`
      );
      state.runs = Array.isArray(result.runs) ? result.runs : [];
      renderRuns();
    } catch (error) {
      renderLoadError(error);
    } finally {
      state.loading = false;
      setBusy(button, false);
    }
  }

  function renderRuns() {
    const content = document.getElementById("staff-content");
    if (!content) return;
    const stops = state.runs.flatMap((run) => run.stops || []);
    const remaining = stops.filter(
      (stop) => !TERMINAL_STOP_STATUSES.has(stop.stopStatus)
    ).length;
    const attentions = stops.filter(
      (stop) =>
        stop.rider?.usesWheelchair ||
        stop.rider?.requiresHandover ||
        stop.supportSummary ||
        stop.handoverNotes
    ).length;
    content.innerHTML = `
      <section class="summary-grid" aria-label="担当便の概要">
        ${summaryCard("担当便", state.runs.length, "便")}
        ${summaryCard("残り", remaining, "名")}
        ${summaryCard("要注意", attentions, "名")}
      </section>
      ${["admin", "dispatcher"].includes(state.role)
        ? '<div class="info-strip">配車担当として全便を表示しています。運転員・添乗員は、自分に割り当てられた便だけが表示されます。</div>'
        : ""}
      ${state.runs.length
        ? `<section class="run-list">${state.runs.map(renderRunCard).join("")}</section>`
        : renderEmptyRuns()}`;
    content.querySelectorAll("[data-event-type]").forEach((button) => {
      button.addEventListener("click", () => openEventDialog(button));
    });
  }

  function summaryCard(label, value, unit) {
    return `
      <article class="summary-card">
        <span>${escapeHtml(label)}</span>
        <strong>${Number(value || 0)}<small>${escapeHtml(unit)}</small></strong>
      </article>`;
  }

  function renderRunCard(run) {
    const stops = Array.isArray(run.stops) ? run.stops : [];
    const driver = (run.assignments || [])
      .find((item) => item.duty === "driver")?.staff?.fullName;
    const completed = stops.filter(
      (stop) => TERMINAL_STOP_STATUSES.has(stop.stopStatus)
    ).length;
    return `
      <article class="run-card">
        <header class="run-card-header">
          <div class="run-time">${escapeHtml(formatJstTime(run.scheduledStartAt))}</div>
          <div class="run-title">
            <h2>${escapeHtml(run.runCode || "送迎便")}</h2>
            <p>${escapeHtml(SERVICE_LABELS[run.serviceType] || run.serviceType || "送迎")}・${escapeHtml(run.routeGroupCode || "ルート未設定")}</p>
          </div>
          ${statusBadge(effectiveRunStatus(run), RUN_STATUS_LABELS)}
        </header>
        <div class="run-meta">
          <div><span>車両</span><strong>${escapeHtml(run.vehicle?.vehicleName || "未割当")}</strong></div>
          <div><span>運転</span><strong>${escapeHtml(driver || "未割当")}</strong></div>
          <div><span>進捗</span><strong>${completed} / ${stops.length}名</strong></div>
        </div>
        ${run.notes
          ? `<div class="info-strip" style="margin:12px 14px 0">${escapeHtml(run.notes)}</div>`
          : ""}
        <div class="stop-list">
          ${stops.length
            ? stops.map(renderStopCard).join("")
            : '<div class="empty-state"><h2>乗車予定はありません</h2><p>この便には患者が登録されていません。</p></div>'}
        </div>
      </article>`;
  }

  function renderStopCard(stop) {
    const actions = nextStopActions(stop);
    const terminal = TERMINAL_STOP_STATUSES.has(stop.stopStatus);
    const rider = stop.rider || {};
    const attentionParts = [
      rider.usesWheelchair ? "車いす対応" : "",
      rider.requiresHandover ? "引渡し確認必須" : "",
      stop.supportSummary || "",
      rider.transportNotes || "",
      stop.handoverNotes || "",
      stop.pickupLocation?.accessNotes || ""
    ].filter(Boolean);
    return `
      <section class="stop-card${terminal ? " is-terminal" : ""}">
        <header class="stop-head">
          <span class="stop-order">${Number(stop.stopOrder || 0)}</span>
          <div>
            <p class="rider-name">${escapeHtml(rider.fullName || "患者不明")}</p>
            <p class="rider-code">${escapeHtml(rider.riderCode || "患者番号なし")}・${escapeHtml(SUPPORT_LABELS[rider.transportSupportLevel] || "支援区分未設定")}</p>
          </div>
          ${statusBadge(stop.stopStatus, STOP_STATUS_LABELS)}
        </header>
        <div class="stop-detail">
          <div class="detail-box">
            <span>乗車 ${escapeHtml(formatJstTime(stop.plannedPickupAt))}</span>
            <strong>${escapeHtml(stop.pickupLocation?.locationName || "乗車場所未設定")}</strong>
          </div>
          <div class="detail-box">
            <span>降車 ${escapeHtml(formatJstTime(stop.plannedDropoffAt))}</span>
            <strong>${escapeHtml(stop.dropoffLocation?.locationName || "降車場所未設定")}</strong>
          </div>
          ${attentionParts.length
            ? `<div class="attention-box"><strong>注意事項</strong>${escapeHtml(attentionParts.join("／"))}</div>`
            : ""}
        </div>
        ${actions.length
          ? `<div class="action-grid">${actions.map((action) => `
              <button type="button" class="button ${action.tone === "secondary" ? "button-secondary" : action.tone === "danger" ? "button-danger" : "is-primary"}"
                data-event-type="${escapeHtml(action.eventType)}"
                data-stop-id="${escapeHtml(stop.id)}">
                ${escapeHtml(EVENT_LABELS[action.eventType] || action.eventType)}
              </button>`).join("")}</div>`
          : ""}
      </section>`;
  }

  function statusBadge(status, dictionary) {
    return `<span class="status ${statusTone(status)}">${escapeHtml(dictionary[status] || status || "未設定")}</span>`;
  }

  function renderEmptyRuns() {
    const isRestricted = ["driver", "attendant"].includes(state.role);
    return `
      <section class="empty-state">
        <span class="empty-state-icon" aria-hidden="true">▰</span>
        <h2>${isRestricted ? "担当便はありません" : "本日の便はありません"}</h2>
        <p>${isRestricted
          ? "配車担当へ便の割当を確認してください。割当後に「更新」を押すと表示されます。"
          : "管理・配車画面で本日の便を生成し、担当スタッフを割り当ててください。"}</p>
        <button type="button" class="button" data-empty-refresh>更新する</button>
      </section>`;
  }

  function renderLoadError(error) {
    const content = document.getElementById("staff-content");
    if (!content) return;
    content.innerHTML = `
      <section class="empty-state">
        <span class="empty-state-icon" aria-hidden="true">!</span>
        <h2>担当便を読み込めませんでした</h2>
        <p>${escapeHtml(friendlyError(error))}</p>
        <button type="button" class="button" data-empty-refresh>もう一度確認</button>
      </section>`;
    content.querySelector("[data-empty-refresh]")
      ?.addEventListener("click", (event) => loadRuns(event.currentTarget));
  }

  function openEventDialog(button) {
    const stop = state.runs
      .flatMap((run) => run.stops || [])
      .find((item) => item.id === button.dataset.stopId);
    const eventType = button.dataset.eventType;
    if (!stop || !nextStopActions(stop).some((action) => action.eventType === eventType)) {
      showToast(
        "表示が古くなっています。最新情報を読み直してください。",
        "error"
      );
      loadRuns();
      return;
    }
    const attemptKey = `${stop.id}:${eventType}:${stop.version || 1}`;
    const idempotencyKey = eventAttemptKeys.get(attemptKey) || uuid();
    eventAttemptKeys.set(attemptKey, idempotencyKey);
    state.pendingEvent = {
      stop,
      eventType,
      attemptKey,
      idempotencyKey
    };
    document.getElementById("event-dialog-title").textContent =
      EVENT_LABELS[eventType] || "状態を更新";
    document.getElementById("event-dialog-description").textContent =
      `${stop.rider?.fullName || "患者"}さんの状態を「${
        STOP_STATUS_LABELS[eventStatus(eventType)] || eventType
      }」へ更新します。内容を確認して記録してください。`;
    const notes = document.getElementById("event-notes");
    const required = eventType === "no_show";
    notes.value = "";
    notes.required = required;
    notes.placeholder = required
      ? "不在確認の状況を入力してください"
      : "必要な場合だけ入力してください";
    document.getElementById("event-notes-required").hidden = !required;
    document.getElementById("event-submit").className =
      `button${eventType === "no_show" ? " button-danger" : ""}`;
    eventDialog.showModal();
  }

  function eventStatus(eventType) {
    return {
      confirm: "confirmed",
      en_route: "en_route",
      boarded: "boarded",
      no_show: "no_show",
      arrived: "arrived",
      handed_over: "handed_over",
      completed: "completed",
      cancelled: "cancelled"
    }[eventType];
  }

  async function submitEvent(event) {
    event.preventDefault();
    if (!state.pendingEvent || !eventForm.reportValidity()) return;
    const submit = document.getElementById("event-submit");
    const notes = String(
      new FormData(eventForm).get("notes") || ""
    ).trim();
    const pending = state.pendingEvent;
    setBusy(submit, true, "記録しています…");
    try {
      await api(
        `/v1/stops/${encodeURIComponent(pending.stop.id)}/events`,
        {
          method: "POST",
          idempotencyKey: pending.idempotencyKey,
          body: {
            eventType: pending.eventType,
            eventAt: new Date().toISOString(),
            notes: notes || null,
            idempotencyKey: pending.idempotencyKey
          }
        }
      );
      eventAttemptKeys.delete(pending.attemptKey);
      state.pendingEvent = null;
      eventDialog.close();
      await loadRuns();
      showToast(
        `${pending.stop.rider?.fullName || "患者"}さんを「${
          STOP_STATUS_LABELS[eventStatus(pending.eventType)] || pending.eventType
        }」で記録しました。`
      );
    } catch (error) {
      showToast(friendlyError(error), "error");
    } finally {
      setBusy(submit, false);
    }
  }

  function closeEventDialog() {
    state.pendingEvent = null;
    if (eventDialog.open) eventDialog.close();
  }

  async function logout() {
    if (!window.confirm("現場スタッフ画面からログアウトしますか？")) {
      return;
    }
    try {
      if (state.token) {
        await api("/v1/auth/logout", {
          method: "POST",
          body: {},
          idempotent: false
        });
      }
    } catch {
      // 端末側のセッション破棄を優先する。
    }
    clearSession();
    renderLogin();
  }

  function setBusy(button, busy, label = "処理中…") {
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = label;
      button.setAttribute("aria-busy", "true");
    } else {
      button.disabled = false;
      button.textContent =
        button.dataset.originalLabel || button.textContent;
      button.removeAttribute("aria-busy");
    }
  }

  function friendlyError(error) {
    if (error?.name === "AbortError") {
      return "通信に時間がかかっています。電波状況を確認して、もう一度お試しください。";
    }
    return error?.message ||
      "通信できませんでした。時間をおいて、もう一度お試しください。";
  }

  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " is-error" : ""}`;
    toast.innerHTML = `
      <span class="status ${type === "error" ? "status-danger" : "status-ready"}" aria-hidden="true">${type === "error" ? "!" : "✓"}</span>
      <span>
        <strong>${type === "error" ? "操作できませんでした" : "記録しました"}</strong>
        <span class="toast-message">${escapeHtml(message)}</span>
      </span>
      <button type="button" class="toast-close" aria-label="通知を閉じる">×</button>`;
    toast.querySelector(".toast-close")
      ?.addEventListener("click", () => toast.remove());
    toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), type === "error" ? 9000 : 5200);
  }

  function formatServiceDate(value) {
    const date = new Date(`${value}T00:00:00+09:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short"
    }).format(date);
  }

  function initialize() {
    if (!config.apiBaseUrl || !config.facilityCode) {
      app.className = "";
      app.innerHTML = `
        <section class="empty-state">
          <span class="empty-state-icon">!</span>
          <h1>設定ファイルを確認してください</h1>
          <p>API接続先または診療所コードが設定されていません。</p>
        </section>`;
      return;
    }
    eventForm.addEventListener("submit", submitEvent);
    eventDialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
      button.addEventListener("click", closeEventDialog);
    });
    eventDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeEventDialog();
    });
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-empty-refresh]")) {
        loadRuns(event.target.closest("[data-empty-refresh]"));
      }
    });
    if (restoreSession()) {
      renderShell();
      loadRuns();
    } else {
      renderLogin();
    }
  }

  return { initialize };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  createStaffApplication().initialize();
}
