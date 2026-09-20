(() => {
  "use strict";

  const config = window.DPRO_SHUTTLE_CONFIG || {};
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastRegion = document.getElementById("toast-region");
  const query = new URLSearchParams(window.location.search);
  const mockMode = query.get("mock") === "1";
  const demoMode =
    query.get("demo") === "1" || config.environment === "demo";
  const storageKey =
    config.sessionStorageKey || "dpro_shuttle_session_v1";

  const state = {
    token: null,
    role: null,
    loginMode: null,
    facility: null,
    activeSection: "today",
    serviceDate: jstDateString(new Date()),
    loading: false,
    requestController: null,
    data: {
      dashboard: null,
      riders: [],
      riderQueryRequired: false,
      riderSearchPerformed: false,
      guardians: [],
      guardianLinks: [],
      regularSchedules: [],
      locations: [],
      staff: [],
      vehicles: [],
      changeRequests: [],
      systemCheck: null,
      demoPrepare: null
    }
  };

  const sectionMeta = Object.freeze({
    today: {
      label: "当日運行",
      shortLabel: "当日",
      icon: "▣",
      description: "本日の送迎便・変更依頼・注意事項をまとめて確認します"
    },
    riders: {
      label: "患者",
      shortLabel: "患者",
      icon: "♙",
      description: "送迎患者、移動支援区分、緊急連絡先を管理します"
    },
    families: {
      label: "家族・LINE連携",
      shortLabel: "家族",
      icon: "♧",
      description: "家族情報、患者との関係、LINE連携の承認状態を管理します"
    },
    schedules: {
      label: "定期予定",
      shortLabel: "予定",
      icon: "▦",
      description: "曜日別の送迎予定と乗降場所を管理します"
    },
    resources: {
      label: "車両・スタッフ",
      shortLabel: "車両",
      icon: "▰",
      description: "運行に使用する車両とスタッフアカウントを管理します"
    },
    changes: {
      label: "変更依頼",
      shortLabel: "変更",
      icon: "▤",
      description: "欠席・時間・乗降場所などの変更依頼を確認します"
    },
    system: {
      label: "システム確認",
      shortLabel: "確認",
      icon: "⚙",
      description: "Worker・データベース・安全設定をまとめて検査します"
    }
  });

  const labels = Object.freeze({
    roles: {
      admin: "管理者",
      dispatcher: "配車担当",
      driver: "運転員",
      attendant: "添乗員",
      reception: "受付"
    },
    runStatus: {
      planned: "未確認",
      ready: "準備完了",
      in_progress: "運行中",
      completed: "完了",
      cancelled: "キャンセル"
    },
    serviceType: {
      pickup: "迎え",
      dropoff: "送り",
      transfer: "施設間移送"
    },
    stopStatus: {
      planned: "予定",
      confirmed: "確認済み",
      en_route: "向かっています",
      boarded: "乗車済み",
      no_show: "不在",
      arrived: "到着",
      handed_over: "引渡し済み",
      completed: "完了",
      cancelled: "キャンセル"
    },
    supportLevel: {
      independent: "自立",
      supervision: "見守り",
      partial_assist: "一部介助",
      full_assist: "全介助",
      wheelchair: "車いす"
    },
    vehicleStatus: {
      available: "利用可能",
      maintenance: "整備中",
      unavailable: "利用不可"
    },
    requestType: {
      absence: "欠席",
      time_change: "時間変更",
      location_change: "乗降場所変更",
      one_way: "片道利用",
      temporary_use: "臨時利用",
      other: "その他"
    },
    requestStatus: {
      pending: "確認待ち",
      approved: "承認",
      rejected: "却下",
      cancelled: "取消"
    },
    guardianLinkStatus: {
      pending: "承認待ち",
      approved: "連携承認済み",
      rejected: "却下",
      suspended: "停止"
    },
    days: ["日", "月", "火", "水", "木", "金", "土"]
  });

  function jstDateString(date) {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value ?? {});
    } catch {
      return "{}";
    }
  }

  function formatDate(value, options = {}) {
    if (!value) return "―";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00+09:00`)
      : new Date(value);
    if (Number.isNaN(date.getTime())) return "―";
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: options.year ? "numeric" : undefined,
      month: "numeric",
      day: "numeric",
      weekday: options.weekday ? "short" : undefined
    }).format(date);
  }

  function formatTime(value) {
    if (!value) return "―";
    const raw = String(value);
    const timeMatch = raw.match(/^(\d{2}):(\d{2})/);
    if (timeMatch) return `${timeMatch[1]}:${timeMatch[2]}`;

    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(date);
    }
    return "―";
  }

  function normalizePhone(value) {
    const half = String(value ?? "").replace(/[０-９]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0)
    );
    let digits = half.replace(/[^\d+]/g, "");
    if (digits.startsWith("+81")) {
      digits = `0${digits.slice(3)}`;
    } else if (digits.startsWith("81") && digits.length >= 11) {
      digits = `0${digits.slice(2)}`;
    }
    return digits.replace(/\D/g, "");
  }

  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const session = raw ? JSON.parse(raw) : null;
      if (!session || typeof session.token !== "string") return null;
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
        loginMode: state.loginMode,
        facility: state.facility
      })
    );
  }

  function clearSession() {
    sessionStorage.removeItem(storageKey);
    state.token = null;
    state.role = null;
    state.loginMode = null;
    state.facility = null;
    state.data = {
      dashboard: null,
      riders: [],
      riderQueryRequired: false,
      riderSearchPerformed: false,
      guardians: [],
      guardianLinks: [],
      regularSchedules: [],
      locations: [],
      staff: [],
      vehicles: [],
      changeRequests: [],
      systemCheck: null
    };
  }

  function statusClass(value) {
    if (["ready", "approved", "available", "active"].includes(value)) {
      return "status-ready";
    }
    if (["in_progress", "pending", "confirmed", "en_route", "boarded"].includes(value)) {
      return "status-running";
    }
    if (["maintenance", "no_show", "warning"].includes(value)) {
      return "status-warning";
    }
    if (["rejected", "cancelled", "unavailable", "danger"].includes(value)) {
      return "status-danger";
    }
    return "status-muted";
  }

  function statusBadge(value, dictionary) {
    const text = dictionary?.[value] || value || "未設定";
    return `<span class="status-badge ${statusClass(value)}">${escapeHtml(text)}</span>`;
  }

  function setBusy(button, busy, busyLabel = "処理中…") {
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = busyLabel;
      button.setAttribute("aria-busy", "true");
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.removeAttribute("aria-busy");
    }
  }

  function showToast(message, type = "success", title = "") {
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " is-error" : ""}${
      type === "warning" ? " is-warning" : ""
    }`;
    const icon = type === "error" ? "!" : type === "warning" ? "△" : "✓";
    toast.innerHTML = `
      <span class="status-badge ${type === "error" ? "status-danger" : type === "warning" ? "status-warning" : "status-ready"}" aria-hidden="true">${icon}</span>
      <span>
        <span class="toast-title">${escapeHtml(title || (type === "error" ? "操作できませんでした" : type === "warning" ? "ご確認ください" : "完了しました"))}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
      </span>
      <button type="button" class="toast-close" aria-label="通知を閉じる">×</button>`;
    toast.querySelector(".toast-close")?.addEventListener("click", () => toast.remove());
    toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), type === "error" ? 9000 : 5200);
  }

  function friendlyError(error) {
    if (error?.name === "AbortError") {
      return "通信に時間がかかっています。接続を確認して、もう一度お試しください。";
    }
    if (error?.message) return error.message;
    return "通信できませんでした。時間をおいて、もう一度お試しください。";
  }

  let sessionRefreshPromise = null;

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

    const base = String(config.apiBaseUrl || "").replace(/\/+$/, "");

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
    const base = String(config.apiBaseUrl || "").replace(/\/+$/, "");
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
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      Number(config.requestTimeoutMs) || 12000
    );
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers({
      Accept: "application/json"
    });
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (["POST", "PATCH"].includes(method) && options.idempotent !== false) {
      headers.set("Idempotency-Key", options.idempotencyKey || uuid());
    }
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
              ? "この操作を行う権限がありません。"
              : response.status === 409
                ? "他の画面で内容が更新されました。画面を更新して、もう一度お試しください。"
                : `通信エラーが発生しました（${response.status}）。`);
        const error = new Error(message);
        error.status = response.status;
        error.code = payload?.error?.code || "HTTP_ERROR";
        if (response.status === 401) {
          clearSession();
          window.setTimeout(renderLogin, 0);
        }
        throw error;
      }
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function mockApi(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const now = new Date().toISOString();
    const sampleRiders = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        riderCode: "R-001",
        fullName: "田中 一郎",
        fullNameKana: "たなか いちろう",
        phone: "090-1234-5678",
        transportSupportLevel: "supervision",
        usesWheelchair: false,
        requiresHandover: true,
        transportNotes: "玄関前でご家族へ声かけ",
        emergencyContactName: "田中 花子",
        emergencyContactPhone: "090-1111-2222",
        isActive: true,
        updatedAt: now
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        riderCode: "R-002",
        fullName: "佐藤 美代子",
        fullNameKana: "さとう みよこ",
        phone: "090-2222-3333",
        transportSupportLevel: "wheelchair",
        usesWheelchair: true,
        requiresHandover: true,
        transportNotes: "リフト車必須",
        emergencyContactName: "佐藤 健一",
        emergencyContactPhone: "090-3333-4444",
        isActive: true,
        updatedAt: now
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        riderCode: "R-003",
        fullName: "山本 和子",
        fullNameKana: "やまもと かずこ",
        phone: "090-5555-6666",
        transportSupportLevel: "partial_assist",
        usesWheelchair: false,
        requiresHandover: false,
        transportNotes: null,
        emergencyContactName: "山本 誠",
        emergencyContactPhone: "090-7777-8888",
        isActive: true,
        updatedAt: now
      }
    ];
    const staff = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        staffCode: "S-001",
        fullName: "山田 太郎",
        staffRole: "dispatcher",
        phone: "090-1000-2000",
        loginId: "yamada",
        isActive: true,
        updatedAt: now
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        staffCode: "S-002",
        fullName: "鈴木 花子",
        staffRole: "driver",
        phone: "090-3000-4000",
        loginId: "suzuki",
        isActive: true,
        updatedAt: now
      }
    ];
    const vehicles = [
      {
        id: "66666666-6666-4666-8666-666666666666",
        vehicleCode: "V-001",
        vehicleName: "ハイエース1号車",
        plateNumber: "福岡300 さ 12-34",
        passengerCapacity: 8,
        wheelchairCapacity: 2,
        hasLift: true,
        vehicleStatus: "available",
        isActive: true,
        updatedAt: now
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        vehicleCode: "V-002",
        vehicleName: "キャラバン2号車",
        plateNumber: "福岡300 さ 56-78",
        passengerCapacity: 6,
        wheelchairCapacity: 1,
        hasLift: true,
        vehicleStatus: "available",
        isActive: true,
        updatedAt: now
      }
    ];
    const baseDate = state.serviceDate;
    const runSeeds = [
      ["08:30", "朝便A", "ready", 6, "北エリア", vehicles[0], staff[0], null],
      ["09:00", "朝便B", "in_progress", 5, "東エリア", vehicles[1], staff[1], "欠席1名"],
      ["10:30", "午前便C", "planned", 4, "南エリア", vehicles[0], null, null],
      ["13:00", "昼便D", "in_progress", 5, "西エリア", vehicles[1], staff[1], "道路工事による迂回"],
      ["14:30", "午後便E", "planned", 3, "北西エリア", vehicles[0], null, null],
      ["15:30", "夕便F", "ready", 1, "東エリア", vehicles[1], staff[0], null],
      ["16:30", "夕便G", "planned", 0, "北エリア", vehicles[0], null, null],
      ["17:30", "最終便H", "planned", 0, "南エリア", vehicles[1], null, null]
    ];
    const runs = runSeeds.map((seed, index) => ({
      id: `88888888-8888-4888-8${String(index).padStart(3, "0")}-888888888888`.slice(0, 36),
      serviceDate: baseDate,
      runCode: seed[1],
      serviceType: index < 3 ? "pickup" : "dropoff",
      routeGroupCode: seed[4],
      scheduledStartAt: `${baseDate}T${seed[0]}:00+09:00`,
      scheduledEndAt: `${baseDate}T${String((Number(seed[0].slice(0, 2)) + 1) % 24).padStart(2, "0")}:${seed[0].slice(3)}:00+09:00`,
      runStatus: seed[2],
      notes: seed[7],
      version: 1,
      vehicle: seed[5],
      assignments: seed[6]
        ? [{ staffId: seed[6].id, duty: seed[6].staffRole === "driver" ? "driver" : "attendant", staff: seed[6] }]
        : [],
      stops: Array.from({ length: seed[3] }, (_, stopIndex) => ({
        id: `${index}-${stopIndex}`,
        rider: sampleRiders[stopIndex % sampleRiders.length],
        stopStatus: seed[2] === "in_progress" ? "en_route" : "planned",
        plannedPickupAt: `${baseDate}T${seed[0]}:00+09:00`
      }))
    }));
    const dashboard = {
      serviceDate: baseDate,
      runCount: runs.length,
      riderStopCount: runs.reduce((sum, run) => sum + run.stops.length, 0),
      pendingChangeRequestCount: 3,
      openIncidentCount: 2,
      emergencyIncidentCount: 0,
      statusCounts: { planned: 4, ready: 2, in_progress: 2 },
      runs
    };
    const changeRequests = [
      {
        id: "99999999-9999-4999-8999-999999999991",
        riderId: sampleRiders[0].id,
        serviceDate: baseDate,
        requestType: "absence",
        requestedChanges: { reason: "体調不良のため欠席" },
        requestStatus: "pending",
        createdAt: now,
        updatedAt: now
      },
      {
        id: "99999999-9999-4999-8999-999999999992",
        riderId: sampleRiders[1].id,
        serviceDate: baseDate,
        requestType: "time_change",
        requestedChanges: { requestedTime: "14:30", note: "受診後の利用" },
        requestStatus: "pending",
        createdAt: now,
        updatedAt: now
      }
    ];
    const locations = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        riderId: null,
        locationType: "facility",
        locationName: "デモ福祉送迎センター",
        addressLine1: "福岡県糟屋郡志免町デモ1-2-3",
        isDefaultPickup: false,
        isDefaultDropoff: false,
        isActive: true,
        updatedAt: now
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        riderId: sampleRiders[0].id,
        locationType: "home",
        locationName: "田中様ご自宅",
        addressLine1: "福岡県糟屋郡志免町デモ4-5-6",
        isDefaultPickup: true,
        isDefaultDropoff: true,
        isActive: true,
        updatedAt: now
      }
    ];
    const guardians = [
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        guardianCode: "G-001",
        fullName: "田中 花子",
        relationship: "長女",
        phone: "090-1111-2222",
        hasLineLink: true,
        linkStatus: "pending",
        notificationPreferences: {},
        isActive: true,
        updatedAt: now
      }
    ];
    const guardianLinks = [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        guardianId: guardians[0].id,
        riderId: sampleRiders[0].id,
        isPrimary: true,
        canViewSchedule: true,
        canRequestChange: true,
        approvedAt: now
      }
    ];

    if (path === "/v1/auth/admin" || path === "/v1/auth/staff") {
      return Promise.resolve({
        ok: true,
        token: "mock-session-token",
        role: path.endsWith("/staff") ? "dispatcher" : "admin",
        facility: {
          facilityCode: config.facilityCode,
          facilityName: "DPRO 診療所送迎予約 デモ診療所",
          environment: "demo"
        }
      });
    }
    if (path.startsWith("/v1/dashboard/today")) {
      return Promise.resolve({ ok: true, dashboard });
    }
    if (path.startsWith("/v1/riders") && method === "GET") {
      return Promise.resolve({ ok: true, riders: sampleRiders, count: sampleRiders.length });
    }
    if (path === "/v1/riders" && method === "POST") {
      return Promise.resolve({
        ok: true,
        rider: { id: uuid(), ...options.body, isActive: true, updatedAt: now }
      });
    }
    if (path.startsWith("/v1/guardians/") && method === "PATCH") {
      return Promise.resolve({
        ok: true,
        guardian: {
          ...guardians[0],
          linkStatus: options.body.linkStatus || "pending",
          hasLineLink: options.body.clearLineLink ? false : true,
          updatedAt: now
        }
      });
    }
    if (path.startsWith("/v1/guardians") && method === "GET") {
      return Promise.resolve({
        ok: true,
        guardians,
        count: guardians.length
      });
    }
    if (path === "/v1/guardians" && method === "POST") {
      return Promise.resolve({
        ok: true,
        guardian: {
          id: uuid(),
          ...options.body,
          hasLineLink: false,
          isActive: true,
          updatedAt: now
        }
      });
    }
    if (
      path.startsWith("/v1/guardian-rider-links") &&
      method === "GET"
    ) {
      return Promise.resolve({
        ok: true,
        links: guardianLinks,
        count: guardianLinks.length
      });
    }
    if (
      path === "/v1/guardian-rider-links" &&
      method === "POST"
    ) {
      return Promise.resolve({
        ok: true,
        link: { id: uuid(), ...options.body, approvedAt: now }
      });
    }
    if (path.startsWith("/v1/staff") && method === "GET") {
      return Promise.resolve({ ok: true, staff, count: staff.length });
    }
    if (path === "/v1/staff" && method === "POST") {
      return Promise.resolve({
        ok: true,
        staff: { id: uuid(), ...options.body, isActive: true, updatedAt: now }
      });
    }
    if (path.startsWith("/v1/vehicles") && method === "GET") {
      return Promise.resolve({ ok: true, vehicles, count: vehicles.length });
    }
    if (path === "/v1/vehicles" && method === "POST") {
      return Promise.resolve({
        ok: true,
        vehicle: { id: uuid(), ...options.body, isActive: true, updatedAt: now }
      });
    }
    if (path.startsWith("/v1/locations") && method === "GET") {
      return Promise.resolve({ ok: true, locations, count: locations.length });
    }
    if (path === "/v1/locations" && method === "POST") {
      return Promise.resolve({
        ok: true,
        location: { id: uuid(), ...options.body, isActive: true, updatedAt: now }
      });
    }
    if (path.startsWith("/v1/regular-schedules") && method === "GET") {
      return Promise.resolve({ ok: true, regularSchedules: [], count: 0 });
    }
    if (path === "/v1/regular-schedules" && method === "POST") {
      return Promise.resolve({
        ok: true,
        regularSchedule: { id: uuid(), ...options.body, isActive: true, updatedAt: now }
      });
    }
    if (path.startsWith("/v1/change-requests") && method === "GET") {
      return Promise.resolve({ ok: true, changeRequests, count: changeRequests.length });
    }
    if (path.includes("/review") && method === "POST") {
      return Promise.resolve({ ok: true, changeRequest: { ...changeRequests[0], requestStatus: options.body.decision } });
    }
    if (path === "/v1/runs/generate" && method === "POST") {
      return Promise.resolve({ ok: true, generated: { created: 8 }, serviceDate: options.body.serviceDate, runs });
    }
    if (path === "/v1/demo/prepare" && method === "POST") {
      return Promise.resolve({
        ok: true,
        demoData: {
          version: "SHUTTLE-7-DEMO-20260728",
          prepared: true,
          duplicateSafe: true,
          counts: {
            staff: 2,
            vehicles: 2,
            riders: 4,
            locations: 5,
            regular_schedules: 40
          }
        },
        demoStaff: {
          loginId: "demo.dispatcher",
          pin: "5678",
          role: "dispatcher"
        },
        demoMember: {
          guardianCode: "DEMO-G01",
          pin: "0301",
          fullName: "デモ 家族A",
          riderName: "デモ 患者A"
        }
      });
    }
    if (path === "/v1/system/check" && method === "POST") {
      return Promise.resolve({
        ok: true,
        systemCheck: {
          ok: true,
          stage: "SHUTTLE-7",
          worker: { status: "pass", version: "SHUTTLE-7-WORKER-20260728" },
          database: { status: "pass", version: "SHUTTLE-1-DB-20260727", missingTables: [], missingRpcs: [], rlsDisabledTables: [], constraintCount: 155, indexCount: 65 },
          facility: { status: "pass", facilityCode: config.facilityCode, environment: "demo", scheduleStepMinutes: 30, businessStartTime: "07:00:00", businessEndTime: "20:00:00" },
          phoneNormalization: { status: "pass", normalizedValue: "09012345678" },
          productionGuard: { status: "pass" },
          demoData: {
            status: "pass",
            version: "SHUTTLE-7-DEMO-20260728",
            prepared: true,
            duplicateSafe: true,
            staffCount: 2,
            vehicleCount: 2,
            riderCount: 4,
            locationCount: 5,
            scheduleCount: 40,
            dispatcherLoginReady: true,
            memberLoginReady: true,
            guardianCount: 1,
            guardianLinkCount: 1
          },
          browserCors: { status: "pass" },
          lineMemberAuthentication: { status: "pending", configured: false, requiredAtStep: "SHUTTLE-7", demoPortalReady: true },
          rateLimiting: { status: "recommended" },
          operationalApi: { status: "pass" }
        }
      });
    }
    return Promise.resolve({ ok: true });
  }

  function restoreSession() {
    const session = getSession();
    if (!session) return false;
    state.token = session.token;
    state.role = session.role;
    state.loginMode = session.loginMode;
    state.facility = session.facility;
    return true;
  }

  function renderLogin(errorMessage = "") {
    document.body.classList.remove("sidebar-open");
    document.body.classList.remove("modal-open");
    modalRoot.replaceChildren();
    app.className = "";
    app.removeAttribute("aria-busy");
    app.innerHTML = `
      <main class="login-page">
        <section class="login-brand" aria-label="DPRO診療所送迎予約">
          <div class="brand-lockup">
            <span class="brand-mark" aria-hidden="true">▰</span>
            <div>
              <p class="brand-name"><strong>DPRO</strong></p>
              <p class="brand-subtitle">診療所送迎予約</p>
            </div>
          </div>
          <div class="login-message">
            <h2>今日の送迎を、<br>ひとつの画面で確実に。</h2>
            <p>配車、患者、車両、変更依頼をまとめて確認。送迎業務の見落としと二重対応を防ぎます。</p>
          </div>
          <ul class="login-points">
            <li>当日運行を一覧化</li>
            <li>二重登録防止</li>
            <li>権限別アクセス</li>
          </ul>
        </section>
        <section class="login-panel-wrap">
          <div class="login-panel">
            ${mockMode ? '<div class="test-banner">画面検査用の表示データを使用しています</div>' : ""}
            <p class="eyebrow">管理・配車画面</p>
            <h1>ログイン</h1>
            <p class="login-lead">施設の認証方法を選んでください。</p>
            <div class="login-card">
              <div class="auth-tabs" role="tablist" aria-label="ログイン方法">
                <button type="button" class="auth-tab is-active" role="tab" aria-selected="true" data-auth-tab="admin">管理コード</button>
                <button type="button" class="auth-tab" role="tab" aria-selected="false" data-auth-tab="staff">スタッフID</button>
              </div>
              ${errorMessage ? `<p class="login-error" role="alert">${escapeHtml(errorMessage)}</p>` : ""}
              <form id="login-form" novalidate>
                <input type="hidden" name="authMode" value="admin">
                <div class="field">
                  <label for="facility-code">診療所コード<span class="required-mark">必須</span></label>
                  <input id="facility-code" name="facilityCode" type="text" autocomplete="organization" required maxlength="80" value="${escapeHtml(config.facilityCode || "")}">
                </div>
                <div id="admin-auth-fields">
                  <div class="field">
                    <label for="management-code">管理コード<span class="required-mark">必須</span></label>
                    <div class="input-with-clear">
                      <input id="management-code" name="managementCode" type="password" inputmode="numeric" autocomplete="current-password" required minlength="4" maxlength="128" value="${demoMode ? "1234" : ""}">
                      <button type="button" class="clear-input" data-clear-input="management-code" aria-label="管理コードを削除">×</button>
                    </div>
                    <p class="field-hint">初期設定、スタッフ登録、閲覧確認に使用します。</p>
                  </div>
                </div>
                <div id="staff-auth-fields" hidden>
                  <div class="field">
                    <label for="login-id">スタッフID<span class="required-mark">必須</span></label>
                    <input id="login-id" name="loginId" type="text" autocomplete="username" minlength="3" maxlength="100">
                  </div>
                  <div class="field">
                    <label for="staff-pin">暗証番号<span class="required-mark">必須</span></label>
                    <div class="input-with-clear">
                      <input id="staff-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" minlength="4" maxlength="64">
                      <button type="button" class="clear-input" data-clear-input="staff-pin" aria-label="暗証番号を削除">×</button>
                    </div>
                    <p class="field-hint">運行生成・変更承認など、担当者を記録する操作に使用します。</p>
                  </div>
                </div>
                <button type="submit" class="button button-wide">ログインする</button>
              </form>
              ${demoMode ? '<p class="demo-note"><strong>デモ環境：</strong>管理コードは「1234」です。実運行操作は、登録済みスタッフIDでログインしてください。</p>' : ""}
              <a class="button button-secondary button-wide" href="staff.html" style="margin-top:12px">現場スタッフ画面を開く</a>
            </div>
            <p class="version-line">${escapeHtml(config.version || "SHUTTLE-4")}</p>
          </div>
        </section>
      </main>`;
    bindLoginEvents();
  }

  function bindLoginEvents() {
    app.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.authTab;
        app.querySelectorAll("[data-auth-tab]").forEach((tab) => {
          const active = tab === button;
          tab.classList.toggle("is-active", active);
          tab.setAttribute("aria-selected", active ? "true" : "false");
        });
        const form = document.getElementById("login-form");
        form.elements.authMode.value = mode;
        document.getElementById("admin-auth-fields").hidden = mode !== "admin";
        document.getElementById("staff-auth-fields").hidden = mode !== "staff";
        form.elements.managementCode.required = mode === "admin";
        form.elements.loginId.required = mode === "staff";
        form.elements.pin.required = mode === "staff";
      });
    });
    app.querySelectorAll("[data-clear-input]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = document.getElementById(button.dataset.clearInput);
        if (target) {
          target.value = "";
          target.focus();
        }
      });
    });
    document.getElementById("login-form")?.addEventListener("submit", handleLogin);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]');
    setBusy(submit, true, "確認しています…");
    const data = new FormData(form);
    const mode = String(data.get("authMode"));
    const facilityCode = String(data.get("facilityCode") || "").trim();
    const endpoint = mode === "staff" ? "/v1/auth/staff" : "/v1/auth/admin";
    const body =
      mode === "staff"
        ? {
            facilityCode,
            loginId: String(data.get("loginId") || "").trim(),
            pin: String(data.get("pin") || "")
          }
        : {
            facilityCode,
            managementCode: String(data.get("managementCode") || "")
          };
    try {
      const result = await api(endpoint, {
        method: "POST",
        body,
        idempotent: false
      });
      state.token = result.token;
      state.role = result.role;
      state.loginMode = mode;
      state.facility = result.facility;
      saveSession();
      renderShell();
      await loadActiveSection();
      showToast("送迎管理画面へログインしました。");
    } catch (error) {
      renderLogin(friendlyError(error));
    } finally {
      setBusy(submit, false);
    }
  }

  function navigationButton(key, mobile = false) {
    const item = sectionMeta[key];
    const active = state.activeSection === key;
    const className = mobile ? "bottom-nav-button" : "nav-button";
    return `
      <button type="button" class="${className}${active ? " is-active" : ""}" data-section="${key}" ${active ? 'aria-current="page"' : ""}>
        <span class="nav-icon" aria-hidden="true">${item.icon}</span>
        <span>${escapeHtml(mobile ? item.shortLabel : item.label)}</span>
      </button>`;
  }

  function renderShell() {
    const facilityName =
      state.facility?.facilityName ||
      state.facility?.facility_name ||
      "DPRO 診療所送迎予約";
    app.className = "";
    app.removeAttribute("aria-busy");
    app.innerHTML = `
      ${mockMode ? '<div class="test-banner">画面検査用の表示データです。実データは変更しません。</div>' : ""}
      <div class="app-shell">
        <aside class="sidebar" id="sidebar" aria-label="メインメニュー">
          <div class="sidebar-brand">
            <span class="brand-mark" aria-hidden="true">▰</span>
            <div>
              <p class="sidebar-brand-name">DPRO</p>
              <span class="sidebar-brand-sub">診療所送迎予約</span>
            </div>
          </div>
          <nav class="sidebar-nav">
            ${["today", "riders", "families", "schedules", "resources", "changes", "system"]
              .map((key) => navigationButton(key))
              .join("")}
          </nav>
          <div class="sidebar-footer">
            <button type="button" class="account-card" data-action="account-menu">
              <span class="account-avatar" aria-hidden="true">●</span>
              <span>
                <span class="account-name">${escapeHtml(labels.roles[state.role] || state.role || "管理者")}</span>
                <span class="account-role">${escapeHtml(state.loginMode === "staff" ? "スタッフIDログイン" : "管理コードログイン")}</span>
              </span>
              <span aria-hidden="true">⌄</span>
            </button>
          </div>
        </aside>
        <button type="button" class="drawer-overlay" data-action="close-menu" aria-label="メニューを閉じる"></button>
        <div class="main-area">
          <header class="topbar">
            <button type="button" class="menu-toggle" data-action="open-menu" aria-label="メニューを開く" aria-controls="sidebar">☰</button>
            <div class="page-heading">
              <h1 id="page-title">${escapeHtml(sectionMeta[state.activeSection].label)}</h1>
              <p id="page-subtitle">${escapeHtml(sectionMeta[state.activeSection].description)}</p>
            </div>
            <div class="topbar-actions">
              <span class="facility-pill" title="${escapeHtml(facilityName)}">
                <span aria-hidden="true">▦</span>
                <span>${escapeHtml(facilityName)}</span>
              </span>
              <label class="date-control">
                <span aria-hidden="true">▣</span>
                <span class="sr-only">表示日</span>
                <input type="date" id="service-date" value="${escapeHtml(state.serviceDate)}" aria-label="表示日">
              </label>
              <button type="button" class="button button-secondary" data-action="refresh" title="画面を更新">
                <span aria-hidden="true">↻</span><span class="button-label">更新</span>
              </button>
            </div>
          </header>
          <main id="main-content" class="content" tabindex="-1"></main>
        </div>
        <nav class="mobile-bottom-nav" aria-label="スマートフォンメニュー">
          ${["today", "riders", "families", "schedules", "changes"]
            .map((key) => navigationButton(key, true))
            .join("")}
        </nav>
      </div>`;
    bindShellEvents();
    renderLoading();
  }

  function bindShellEvents() {
    if (!app.dataset.eventsBound) {
      app.addEventListener("click", handleDelegatedClick);
      app.dataset.eventsBound = "true";
    }
    document.getElementById("service-date")?.addEventListener("change", async (event) => {
      const value = event.target.value;
      if (!value) return;
      state.serviceDate = value;
      await loadActiveSection();
    });
  }

  function renderLoading() {
    const content = document.getElementById("main-content");
    if (!content) return;
    content.innerHTML = `
      <div class="loading-state" role="status">
        <div>
          <span class="spinner" aria-hidden="true"></span>
          <p>情報を読み込んでいます</p>
        </div>
      </div>`;
  }

  async function handleDelegatedClick(event) {
    const sectionButton = event.target.closest("[data-section]");
    if (sectionButton) {
      state.activeSection = sectionButton.dataset.section;
      document.body.classList.remove("sidebar-open");
      renderShell();
      await loadActiveSection();
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === "open-menu") {
      document.body.classList.add("sidebar-open");
    } else if (action === "close-menu") {
      document.body.classList.remove("sidebar-open");
    } else if (action === "refresh") {
      setBusy(actionButton, true, "更新中…");
      await loadActiveSection();
      setBusy(actionButton, false);
    } else if (action === "account-menu") {
      openAccountModal();
    } else if (action === "logout") {
      await logout();
    } else if (action === "open-rider-form") {
      openRiderForm();
    } else if (action === "edit-rider") {
      openRiderEditForm(actionButton.dataset.id);
    } else if (action === "toggle-rider-status") {
      await updateRiderActiveStatus(
        actionButton.dataset.id,
        actionButton.dataset.active === "true",
        actionButton
      );
    } else if (action === "open-guardian-form") {
      openGuardianForm();
    } else if (action === "approve-guardian-link") {
      await updateGuardianLinkStatus(
        actionButton.dataset.id,
        "approved",
        actionButton
      );
    } else if (action === "suspend-guardian-link") {
      await updateGuardianLinkStatus(
        actionButton.dataset.id,
        "suspended",
        actionButton
      );
    } else if (action === "clear-guardian-link") {
      await clearGuardianLineLink(
        actionButton.dataset.id,
        actionButton
      );
    } else if (action === "open-location-form") {
      await openLocationForm();
    } else if (action === "open-schedule-form") {
      await openScheduleForm();
    } else if (action === "jump-schedule-day") {
      jumpToScheduleDay(actionButton.dataset.day);
    } else if (action === "jump-schedule-top") {
      jumpToScheduleDay(null);
    } else if (action === "edit-schedule") {
      await openScheduleEditForm(actionButton.dataset.id);
    } else if (action === "toggle-schedule-status") {
      await updateScheduleActiveStatus(
        actionButton.dataset.id,
        actionButton.dataset.active === "true",
        actionButton
      );
    } else if (action === "open-vehicle-form") {
      openVehicleForm();
    } else if (action === "open-staff-form") {
      openStaffForm();
    } else if (action === "generate-runs") {
      await generateRuns(actionButton);
    } else if (action === "review-change") {
      openReviewForm(actionButton.dataset.id, actionButton.dataset.decision);
    } else if (action === "run-detail") {
      const run = state.data.dashboard?.runs?.find((item) => item.id === actionButton.dataset.id);
      if (run) {
        try {
          await openRunDetail(run);
        } catch (error) {
          showToast(friendlyError(error), "error");
        }
      }
    } else if (action === "run-system-check") {
      await runSystemCheck(actionButton);
    } else if (action === "prepare-demo") {
      await prepareDemo(actionButton);
    } else if (action === "search-riders") {
      await loadRiders(String(document.getElementById("rider-search")?.value || ""));
      renderRiders();
    } else if (action === "show-all-riders") {
      const input = document.getElementById("rider-search");
      if (input) input.value = "";
      await loadRiders("", true);
      renderRiders();
    } else if (action === "clear-rider-search") {
      const input = document.getElementById("rider-search");
      if (input) input.value = "";
      await loadRiders("", false);
      renderRiders();
    } else if (action === "show-section") {
      state.activeSection = actionButton.dataset.sectionTarget;
      renderShell();
      await loadActiveSection();
    }
  }

  async function logout() {
    try {
      if (state.token) {
        await api("/v1/auth/logout", {
          method: "POST",
          body: {},
          idempotent: false
        });
      }
    } catch {
      // ローカルのセッション破棄を優先する。
    }
    clearSession();
    closeModal();
    renderLogin();
  }

  async function loadActiveSection() {
    if (state.loading) return;
    state.loading = true;
    renderLoading();
    try {
      if (state.activeSection === "today") {
        await loadDashboard();
        renderToday();
      } else if (state.activeSection === "riders") {
        await loadRiders("");
        renderRiders();
      } else if (state.activeSection === "families") {
        await Promise.all([
          loadRiders("", true),
          loadGuardians(),
          loadGuardianLinks()
        ]);
        renderFamilies();
      } else if (state.activeSection === "schedules") {
        await Promise.all([loadSchedules(), loadLocations(), loadRiders("", true)]);
        renderSchedules();
      } else if (state.activeSection === "resources") {
        await Promise.all([loadStaff(), loadVehicles()]);
        renderResources();
      } else if (state.activeSection === "changes") {
        await Promise.all([loadChanges(), loadRiders("", true)]);
        renderChanges();
      } else if (state.activeSection === "system") {
        renderSystem();
      }
    } catch (error) {
      renderSectionError(error);
    } finally {
      state.loading = false;
    }
  }

  async function loadDashboard() {
    const result = await api(
      `/v1/dashboard/today?serviceDate=${encodeURIComponent(state.serviceDate)}`
    );
    state.data.dashboard = result.dashboard;
  }

  async function loadRiders(search = "", explicitAll = false) {
    const normalized = String(search || "").trim();
    const suffix = normalized
      ? `?query=${encodeURIComponent(normalized)}&limit=100`
      : explicitAll
        ? "?all=1&limit=100"
        : "?limit=100";
    const result = await api(`/v1/riders${suffix}`);
    state.data.riders = result.riders || [];
    state.data.riderQueryRequired = result.queryRequired === true;
    state.data.riderSearchPerformed = Boolean(normalized) || explicitAll;
  }

  async function loadGuardians() {
    const result = await api("/v1/guardians?limit=200");
    state.data.guardians = result.guardians || [];
  }

  async function loadGuardianLinks() {
    const result = await api("/v1/guardian-rider-links?limit=500");
    state.data.guardianLinks = result.links || [];
  }

  async function loadSchedules() {
    const result = await api("/v1/regular-schedules?limit=300");
    state.data.regularSchedules = result.regularSchedules || [];
  }

  async function loadLocations() {
    const result = await api("/v1/locations?limit=300");
    state.data.locations = result.locations || [];
  }

  async function loadStaff() {
    const result = await api("/v1/staff?limit=200");
    state.data.staff = result.staff || [];
  }

  async function loadVehicles() {
    const result = await api("/v1/vehicles");
    state.data.vehicles = result.vehicles || [];
  }

  async function loadChanges() {
    const result = await api(
      `/v1/change-requests?serviceDate=${encodeURIComponent(state.serviceDate)}&limit=300`
    );
    state.data.changeRequests = result.changeRequests || [];
  }

  function renderSectionError(error) {
    const content = document.getElementById("main-content");
    if (!content) return;
    content.innerHTML = `
      <section class="panel">
        <div class="empty-state">
          <div>
            <span class="empty-state-icon" aria-hidden="true">!</span>
            <h3>情報を読み込めませんでした</h3>
            <p>${escapeHtml(friendlyError(error))}</p>
            <button type="button" class="button" data-action="refresh">もう一度確認する</button>
          </div>
        </div>
      </section>`;
  }

  function renderToday() {
    const dashboard = state.data.dashboard || {
      runCount: 0,
      riderStopCount: 0,
      pendingChangeRequestCount: 0,
      openIncidentCount: 0,
      emergencyIncidentCount: 0,
      runs: []
    };
    const content = document.getElementById("main-content");
    const canOperate = state.loginMode === "staff";
    const runs = dashboard.runs || [];
    content.innerHTML = `
      <section class="content-header">
        <div>
          <h2 class="content-title">${escapeHtml(formatDate(state.serviceDate, { year: true, weekday: true }))}の運行</h2>
          <p class="content-description">送迎便、乗車予定、変更依頼、注意事項を確認します。</p>
        </div>
        <div class="action-row">
          <button type="button" class="button" data-action="generate-runs" ${canOperate ? "" : 'disabled title="スタッフIDでログインしてください"'}>
            <span aria-hidden="true">＋</span>選択日の便を生成
          </button>
        </div>
      </section>
      ${!canOperate ? `
        <div class="info-strip is-warning" role="status">
          <span aria-hidden="true">△</span>
          <div><strong>初期設定・閲覧モードです。</strong><br>送迎便の生成や変更承認は、担当者を記録するためスタッフIDでログインしてください。</div>
        </div>` : ""}
      <section class="kpi-grid" aria-label="当日の概要">
        ${kpiCard("▰", "本日運行", dashboard.runCount, "便")}
        ${kpiCard("♙", "送迎予定", dashboard.riderStopCount, "名")}
        ${kpiCard("▤", "変更依頼", dashboard.pendingChangeRequestCount, "件", "warning")}
        ${kpiCard("△", "注意", dashboard.openIncidentCount, "件", dashboard.emergencyIncidentCount > 0 ? "danger" : "warning")}
      </section>
      ${dashboard.pendingChangeRequestCount > 0 || dashboard.openIncidentCount > 0 ? `
        <div class="notice-strip">
          <span class="kpi-icon" aria-hidden="true">△</span>
          <div>
            <strong>確認が必要な情報があります</strong><br>
            変更依頼 ${Number(dashboard.pendingChangeRequestCount || 0)}件・対応中の注意 ${Number(dashboard.openIncidentCount || 0)}件
          </div>
          <button type="button" class="button button-secondary" data-action="show-section" data-section-target="changes">内容を確認</button>
        </div>` : ""}
      <section class="panel">
        <header class="panel-header">
          <div>
            <h2 class="panel-title">選択日の運行予定</h2>
            <p class="panel-subtitle">時間順に表示しています。状態は色と文字の両方で示します。</p>
          </div>
          <span class="status-badge status-active">${runs.length}便</span>
        </header>
        ${runs.length ? renderRunsTable(runs) : emptyState("▰", "送迎便はまだありません", canOperate ? "「選択日の便を生成」を押すと、定期予定から当日の便を重複なく作成します。" : "定期予定を登録後、スタッフIDでログインして当日の便を生成してください。", canOperate ? '<button type="button" class="button" data-action="generate-runs">選択日の便を生成</button>' : '<button type="button" class="button button-secondary" data-action="show-section" data-section-target="schedules">定期予定を確認</button>')}
      </section>`;
  }

  function kpiCard(icon, label, value, unit, tone = "") {
    return `
      <article class="kpi-card${tone ? ` is-${tone}` : ""}">
        <span class="kpi-icon" aria-hidden="true">${icon}</span>
        <div>
          <p class="kpi-label">${escapeHtml(label)}</p>
          <p class="kpi-value">${Number(value || 0)}<span class="kpi-unit">${escapeHtml(unit)}</span></p>
        </div>
      </article>`;
  }

  function renderRunsTable(runs) {
    return `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">出発時刻・便名</th>
              <th scope="col">状態</th>
              <th scope="col">区分・ルート</th>
              <th scope="col">担当</th>
              <th scope="col">車両</th>
              <th scope="col">予定人数</th>
              <th scope="col">備考</th>
              <th scope="col"><span class="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            ${runs.map((run) => {
              const driver =
                (run.assignments || []).find((item) => item.duty === "driver")?.staff?.fullName ||
                "未割当";
              const notes = run.notes || "―";
              return `
                <tr>
                  <td class="cell-primary" data-label="出発時刻・便名">
                    <span class="primary-cell">${escapeHtml(formatTime(run.scheduledStartAt))} ${escapeHtml(run.runCode)}</span>
                  </td>
                  <td data-label="状態">${statusBadge(run.runStatus, labels.runStatus)}</td>
                  <td data-label="区分・ルート">
                    ${escapeHtml(labels.serviceType[run.serviceType] || run.serviceType || "―")}
                    <span class="secondary-cell">${escapeHtml(run.routeGroupCode || "ルート未設定")}</span>
                  </td>
                  <td data-label="担当">${escapeHtml(driver)}</td>
                  <td data-label="車両">
                    ${escapeHtml(run.vehicle?.vehicleName || "未割当")}
                    ${run.vehicle?.plateNumber ? `<span class="secondary-cell">${escapeHtml(run.vehicle.plateNumber)}</span>` : ""}
                  </td>
                  <td data-label="予定人数">${Number(run.stops?.length || 0)}名</td>
                  <td data-label="備考">${escapeHtml(notes)}</td>
                  <td data-label="操作">
                    <div class="row-actions">
                      <button type="button" class="row-button" data-action="run-detail" data-id="${escapeHtml(run.id)}">詳細</button>
                    </div>
                  </td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function renderRiders() {
    const content = document.getElementById("main-content");
    const riders = state.data.riders || [];
    content.innerHTML = `
      <section class="content-header">
        <div>
          <h2 class="content-title">患者管理</h2>
          <p class="content-description">氏名・電話番号・患者番号から検索できます。</p>
        </div>
        <div class="action-row">
          <button type="button" class="button" data-action="open-rider-form"><span aria-hidden="true">＋</span>患者を登録</button>
        </div>
      </section>
      <section class="panel">
        <header class="panel-header">
          <div>
            <h2 class="panel-title">登録患者</h2>
            <p class="panel-subtitle">電話番号はハイフン・空白・全角・+81形式でも同一判定します。</p>
          </div>
          <div class="search-group">
            <input class="control" id="rider-search" type="search" maxlength="100" placeholder="氏名・電話番号・患者番号" aria-label="患者検索">
            <button type="button" class="button" data-action="search-riders">検索</button>
            <button type="button" class="button button-secondary" data-action="show-all-riders">全件表示</button>
            <button type="button" class="button button-secondary" data-action="clear-rider-search">クリア</button>
          </div>
        </header>
        ${riders.length
          ? renderRidersTable(riders)
          : state.data.riderQueryRequired
            ? emptyState(
                "♙",
                "患者を検索してください",
                "氏名・電話番号・患者番号で検索するか、「全件表示」で最大100件まで表示できます。",
                '<button type="button" class="button button-secondary" data-action="show-all-riders">全件表示</button>'
              )
            : state.data.riderSearchPerformed
              ? emptyState(
                  "♙",
                  "該当する患者はいません",
                  "検索条件を変更するか、クリアしてもう一度お試しください。",
                  '<button type="button" class="button button-secondary" data-action="clear-rider-search">検索をクリア</button>'
                )
              : emptyState(
                  "♙",
                  "患者が登録されていません",
                  "最初に送迎を利用する方の基本情報を登録してください。医療・健康情報は必要最小限だけ入力します。",
                  '<button type="button" class="button" data-action="open-rider-form">患者を登録</button>'
                )}
      </section>`;
  }

  function renderRidersTable(riders) {
    return `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">患者</th>
              <th scope="col">電話番号</th>
              <th scope="col">移動支援</th>
              <th scope="col">車いす</th>
              <th scope="col">引渡し</th>
              <th scope="col">送迎上の注意</th>
              <th scope="col">状態</th>
              <th scope="col"><span class="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            ${riders.map((rider) => `
              <tr>
                <td class="cell-primary" data-label="患者">
                  <span class="primary-cell">${escapeHtml(rider.fullName)}</span>
                  <span class="secondary-cell">${escapeHtml(rider.riderCode)}${rider.fullNameKana ? `・${escapeHtml(rider.fullNameKana)}` : ""}</span>
                </td>
                <td data-label="電話番号">${escapeHtml(rider.phone || "―")}</td>
                <td data-label="移動支援">${escapeHtml(labels.supportLevel[rider.transportSupportLevel] || rider.transportSupportLevel || "―")}</td>
                <td data-label="車いす">${rider.usesWheelchair ? "利用あり" : "なし"}</td>
                <td data-label="引渡し">${rider.requiresHandover ? "確認必須" : "通常"}</td>
                <td data-label="送迎上の注意">${escapeHtml(rider.transportNotes || "―")}</td>
                <td data-label="状態">${statusBadge(rider.isActive ? "active" : "inactive", { active: "利用中", inactive: "停止" })}</td>
                <td data-label="操作">
                  <div class="row-actions">
                    <button type="button" class="row-button" data-action="edit-rider" data-id="${escapeHtml(rider.id)}">編集</button>
                    <button
                      type="button"
                      class="row-button${rider.isActive ? " is-danger" : ""}"
                      data-action="toggle-rider-status"
                      data-id="${escapeHtml(rider.id)}"
                      data-active="${rider.isActive ? "false" : "true"}"
                    >${rider.isActive ? "停止" : "再開"}</button>
                  </div>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function renderFamilies() {
    const content = document.getElementById("main-content");
    const guardians = state.data.guardians || [];
    const links = state.data.guardianLinks || [];
    const riderById = new Map(
      (state.data.riders || []).map((item) => [item.id, item])
    );
    const linksByGuardian = new Map();
    for (const link of links) {
      const current = linksByGuardian.get(link.guardianId) || [];
      current.push(link);
      linksByGuardian.set(link.guardianId, current);
    }
    const canManage = ["admin", "reception"].includes(state.role);
    const isAdmin = state.role === "admin";
    const pendingCount = guardians.filter(
      (guardian) =>
        guardian.hasLineLink && guardian.linkStatus === "pending"
    ).length;

    content.innerHTML = `
      <section class="content-header">
        <div>
          <h2 class="content-title">家族・LINE連携</h2>
          <p class="content-description">家族と患者の閲覧範囲を分け、LINE連携申請を診療所側で承認します。</p>
        </div>
        <div class="action-row">
          <a class="button button-secondary" href="member.html?demo=1" target="_blank" rel="noopener">家族デモ画面</a>
          <button type="button" class="button" data-action="open-guardian-form" ${canManage && state.data.riders.length ? "" : "disabled"}><span aria-hidden="true">＋</span>家族を登録</button>
        </div>
      </section>
      ${!canManage ? `
        <div class="info-strip is-warning">
          <span aria-hidden="true">△</span>
          <div><strong>閲覧のみ可能です。</strong><br>家族登録とLINE連携状態の変更には、管理者または受付の権限が必要です。</div>
        </div>` : ""}
      ${!state.data.riders.length ? `
        <div class="info-strip is-warning">
          <span aria-hidden="true">△</span>
          <div><strong>最初に患者を登録してください。</strong><br>家族情報は、閲覧対象となる患者と必ず紐づけて登録します。</div>
        </div>` : ""}
      <section class="panel">
        <header class="panel-header">
          <div>
            <h2 class="panel-title">登録家族</h2>
            <p class="panel-subtitle">承認待ち ${pendingCount}件。電話番号は本人確認に使用しますが、家族画面へは返しません。</p>
          </div>
          ${statusBadge(pendingCount ? "pending" : "approved", {
            pending: `${pendingCount}件 承認待ち`,
            approved: "承認待ちなし"
          })}
        </header>
        ${guardians.length ? `
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">家族</th>
                  <th scope="col">電話番号</th>
                  <th scope="col">対象患者</th>
                  <th scope="col">LINE連携</th>
                  <th scope="col">閲覧・変更権限</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                ${guardians.map((guardian) => {
                  const guardianLinks = linksByGuardian.get(guardian.id) || [];
                  const riderNames = guardianLinks
                    .map((link) => riderById.get(link.riderId)?.fullName)
                    .filter(Boolean);
                  const permissions = guardianLinks.map((link) => {
                    const rider = riderById.get(link.riderId);
                    const scopes = [
                      link.canViewSchedule ? "予定閲覧" : null,
                      link.canRequestChange ? "変更依頼" : null
                    ].filter(Boolean);
                    return `${rider?.fullName || "患者"}：${scopes.join("・") || "権限なし"}`;
                  });
                  const canApprove =
                    canManage &&
                    guardian.hasLineLink &&
                    guardian.linkStatus === "pending";
                  const canSuspend =
                    canManage &&
                    guardian.hasLineLink &&
                    guardian.linkStatus === "approved";
                  return `
                    <tr>
                      <td class="cell-primary" data-label="家族">
                        <span class="primary-cell">${escapeHtml(guardian.fullName)}</span>
                        <span class="secondary-cell">${escapeHtml(guardian.guardianCode)}${guardian.relationship ? `・${escapeHtml(guardian.relationship)}` : ""}</span>
                      </td>
                      <td data-label="電話番号">${escapeHtml(guardian.phone || "―")}</td>
                      <td data-label="対象患者">${escapeHtml(riderNames.join("、") || "未紐付け")}</td>
                      <td data-label="LINE連携">
                        ${guardian.hasLineLink
                          ? statusBadge(guardian.linkStatus, labels.guardianLinkStatus)
                          : statusBadge("inactive", { inactive: "未申請" })}
                      </td>
                      <td data-label="閲覧・変更権限">
                        ${permissions.length
                          ? permissions.map((item) => `<span class="secondary-cell">${escapeHtml(item)}</span>`).join("")
                          : "―"}
                      </td>
                      <td data-label="操作">
                        <div class="row-actions">
                          <button type="button" class="row-button" data-action="approve-guardian-link" data-id="${escapeHtml(guardian.id)}" ${canApprove ? "" : "disabled"}>承認</button>
                          <button type="button" class="row-button" data-action="suspend-guardian-link" data-id="${escapeHtml(guardian.id)}" ${canSuspend ? "" : "disabled"}>停止</button>
                          <button type="button" class="row-button" data-action="clear-guardian-link" data-id="${escapeHtml(guardian.id)}" ${isAdmin && guardian.hasLineLink ? "" : "disabled"}>連携解除</button>
                        </div>
                      </td>
                    </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>` : emptyState("♧", "家族が登録されていません", "患者を選択し、家族番号・氏名・電話番号を登録してください。", canManage && state.data.riders.length ? '<button type="button" class="button" data-action="open-guardian-form">家族を登録</button>' : "")}
      </section>`;
  }

  function renderSchedules() {
    const content = document.getElementById("main-content");
    const schedules = state.data.regularSchedules || [];
    const locations = state.data.locations || [];
    const riderById = new Map((state.data.riders || []).map((item) => [item.id, item]));
    const locationById = new Map(locations.map((item) => [item.id, item]));
    const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
    const weekdayCounts = schedules.reduce((counts, schedule) => {
      counts[schedule.dayOfWeek] = (counts[schedule.dayOfWeek] || 0) + 1;
      return counts;
    }, {});
    content.innerHTML = `
      <section class="content-header">
        <div>
          <h2 class="content-title">定期送迎予定</h2>
          <p class="content-description">曜日・乗降場所・予定時刻を登録し、当日の送迎便生成に使用します。</p>
        </div>
        <div class="action-row">
          <button type="button" class="button button-secondary" data-action="open-location-form"><span aria-hidden="true">＋</span>乗降場所</button>
          <button type="button" class="button" data-action="open-schedule-form" ${(state.data.riders.length && locations.length >= 2) ? "" : "disabled"}><span aria-hidden="true">＋</span>定期予定</button>
        </div>
      </section>
      ${!state.data.riders.length || locations.length < 2 ? `
        <div class="info-strip is-warning">
          <span aria-hidden="true">△</span>
          <div><strong>定期予定を登録する前に準備が必要です。</strong><br>患者と、乗車場所・降車場所を登録してください。</div>
        </div>` : ""}
      <section class="split-grid">
        <div class="panel schedule-list-panel">
          <header class="panel-header">
            <div>
              <h2 class="panel-title">曜日別予定</h2>
              <p class="panel-subtitle">時間は30分単位、診療所の運行時間内で登録します。</p>
            </div>
            <span class="status-badge status-active">${schedules.length}件</span>
          </header>
          ${schedules.length ? `
            <nav class="weekday-index" aria-label="曜日別予定インデックス">
              <button type="button" class="weekday-index-button is-all" data-action="jump-schedule-top">
                <span>全件</span><strong>${schedules.length}</strong>
              </button>
              ${weekdayOrder.map((day) => `
                <button
                  type="button"
                  class="weekday-index-button"
                  data-action="jump-schedule-day"
                  data-day="${day}"
                  ${weekdayCounts[day] ? "" : "disabled"}
                >
                  <span>${escapeHtml(labels.days[day])}</span>
                  <strong>${weekdayCounts[day] || 0}</strong>
                </button>`).join("")}
            </nav>
            <div class="data-table-wrap" data-schedule-list-top>
              <table class="data-table">
                <thead><tr><th>曜日・患者</th><th>区分</th><th>時間</th><th>適用期間</th><th>乗車場所</th><th>降車場所</th><th>状態</th><th><span class="sr-only">操作</span></th></tr></thead>
                <tbody>
                  ${schedules.map((schedule) => {
                    const rider = riderById.get(schedule.riderId);
                    return `<tr data-schedule-day="${Number(schedule.dayOfWeek)}">
                      <td class="cell-primary" data-label="曜日・患者"><span class="primary-cell">${escapeHtml(labels.days[schedule.dayOfWeek])}曜日・${escapeHtml(rider?.fullName || "患者不明")}</span><span class="secondary-cell">${escapeHtml(schedule.routeGroupCode || "A")}</span></td>
                      <td data-label="区分">${escapeHtml(labels.serviceType[schedule.serviceType] || schedule.serviceType)}</td>
                      <td data-label="時間">${escapeHtml(formatTime(schedule.scheduledPickupTime))} → ${escapeHtml(formatTime(schedule.scheduledDropoffTime))}</td>
                      <td data-label="適用期間">${escapeHtml(schedule.effectiveFrom || "―")} ～ ${escapeHtml(schedule.effectiveTo || "継続")}</td>
                      <td data-label="乗車場所">${escapeHtml(locationById.get(schedule.pickupLocationId)?.locationName || "―")}</td>
                      <td data-label="降車場所">${escapeHtml(locationById.get(schedule.dropoffLocationId)?.locationName || "―")}</td>
                      <td data-label="状態">${statusBadge(schedule.isActive ? "active" : "inactive", { active: "有効", inactive: "停止" })}</td>
                      <td data-label="操作">
                        <div class="row-actions">
                          <button type="button" class="row-button" data-action="edit-schedule" data-id="${escapeHtml(schedule.id)}">編集</button>
                          <button
                            type="button"
                            class="row-button${schedule.isActive ? " is-danger" : ""}"
                            data-action="toggle-schedule-status"
                            data-id="${escapeHtml(schedule.id)}"
                            data-active="${schedule.isActive ? "false" : "true"}"
                          >${schedule.isActive ? "停止" : "再開"}</button>
                        </div>
                      </td>
                    </tr>`;
                  }).join("")}
                </tbody>
              </table>
            </div>` : emptyState("▦", "定期予定が登録されていません", "患者と乗降場所を登録後、曜日別の予定を作成してください。", state.data.riders.length && locations.length >= 2 ? '<button type="button" class="button" data-action="open-schedule-form">定期予定を登録</button>' : "")}
        </div>
        <aside class="panel">
          <header class="panel-header">
            <div>
              <h2 class="panel-title">登録済み乗降場所</h2>
              <p class="panel-subtitle">施設共通・患者別</p>
            </div>
          </header>
          <div class="panel-body">
            ${locations.length ? `
              <div class="record-details">
                ${locations.slice(0, 12).map((location) => `
                  <article class="record-card">
                    <div class="record-card-header">
                      <div><h3>${escapeHtml(location.locationName)}</h3><p class="record-code">${escapeHtml(location.locationType === "facility" ? "施設共通" : "患者別")}</p></div>
                      ${statusBadge(location.isActive ? "active" : "inactive", { active: "有効", inactive: "停止" })}
                    </div>
                    <p>${escapeHtml(location.addressLine1 || "住所未設定")}</p>
                  </article>`).join("")}
              </div>` : `<p class="content-description">乗降場所がありません。</p>`}
          </div>
        </aside>
      </section>`;
  }

  function renderResources() {
    const content = document.getElementById("main-content");
    const staff = state.data.staff || [];
    const vehicles = state.data.vehicles || [];
    const isAdmin = state.role === "admin";
    content.innerHTML = `
      <section class="content-header">
        <div>
          <h2 class="content-title">車両・スタッフ</h2>
          <p class="content-description">配車に使用する車両と、権限別のスタッフアカウントを管理します。</p>
        </div>
        <div class="action-row">
          <button type="button" class="button button-secondary" data-action="open-vehicle-form" ${isAdmin ? "" : "disabled"}>＋ 車両</button>
          <button type="button" class="button" data-action="open-staff-form" ${isAdmin ? "" : "disabled"}>＋ スタッフ</button>
        </div>
      </section>
      ${!isAdmin ? '<div class="info-strip is-warning"><span>△</span><div>車両・スタッフの新規登録は管理者権限が必要です。</div></div>' : ""}
      <section class="split-grid">
        <div class="panel">
          <header class="panel-header"><div><h2 class="panel-title">車両</h2><p class="panel-subtitle">定員・車いす定員・リフト有無を確認します。</p></div><span class="status-badge status-active">${vehicles.length}台</span></header>
          ${vehicles.length ? `
            <div class="card-grid panel-body">
              ${vehicles.map((vehicle) => `
                <article class="record-card">
                  <div class="record-card-header">
                    <div><h3>${escapeHtml(vehicle.vehicleName)}</h3><p class="record-code">${escapeHtml(vehicle.vehicleCode)}・${escapeHtml(vehicle.plateNumber || "ナンバー未設定")}</p></div>
                    ${statusBadge(vehicle.vehicleStatus, labels.vehicleStatus)}
                  </div>
                  <div class="record-details">
                    <div class="record-line"><span class="record-label">通常座席</span><span class="record-value">${Number(vehicle.passengerCapacity || 0)}名</span></div>
                    <div class="record-line"><span class="record-label">車いす</span><span class="record-value">${Number(vehicle.wheelchairCapacity || 0)}台</span></div>
                    <div class="record-line"><span class="record-label">リフト</span><span class="record-value">${vehicle.hasLift ? "あり" : "なし"}</span></div>
                  </div>
                </article>`).join("")}
            </div>` : emptyState("▰", "車両が登録されていません", "送迎に使用する車両の定員と装備を登録してください。", isAdmin ? '<button type="button" class="button" data-action="open-vehicle-form">車両を登録</button>' : "")}
        </div>
        <div class="panel">
          <header class="panel-header"><div><h2 class="panel-title">スタッフ</h2><p class="panel-subtitle">権限とログインIDを管理します。</p></div><span class="status-badge status-active">${staff.length}名</span></header>
          ${staff.length ? `
            <div class="panel-body">
              <div class="record-details">
                ${staff.map((person) => `
                  <article class="record-card">
                    <div class="record-card-header">
                      <div><h3>${escapeHtml(person.fullName)}</h3><p class="record-code">${escapeHtml(person.staffCode)}・${escapeHtml(person.loginId || "ログインなし")}</p></div>
                      ${statusBadge(person.isActive ? "active" : "inactive", { active: labels.roles[person.staffRole] || person.staffRole, inactive: "停止" })}
                    </div>
                    <div class="record-details">
                      <div class="record-line"><span class="record-label">電話番号</span><span class="record-value">${escapeHtml(person.phone || "―")}</span></div>
                    </div>
                  </article>`).join("")}
              </div>
            </div>` : emptyState("♙", "スタッフが登録されていません", "最初に管理者または配車担当のスタッフIDを作成してください。", isAdmin ? '<button type="button" class="button" data-action="open-staff-form">スタッフを登録</button>' : "")}
        </div>
      </section>`;
  }

  function renderChanges() {
    const content = document.getElementById("main-content");
    const requests = state.data.changeRequests || [];
    const riderById = new Map((state.data.riders || []).map((item) => [item.id, item]));
    const canReview = state.loginMode === "staff" && ["admin", "dispatcher"].includes(state.role);
    content.innerHTML = `
      <section class="content-header">
        <div>
          <h2 class="content-title">変更依頼</h2>
          <p class="content-description">${escapeHtml(formatDate(state.serviceDate, { year: true, weekday: true }))}の欠席・時間・乗降場所変更を確認します。</p>
        </div>
      </section>
      ${!canReview ? '<div class="info-strip is-warning"><span>△</span><div><strong>閲覧のみ可能です。</strong><br>承認・却下には管理者または配車担当のスタッフIDログインが必要です。</div></div>' : ""}
      <section class="panel">
        <header class="panel-header"><div><h2 class="panel-title">受付一覧</h2><p class="panel-subtitle">確認待ちを優先して表示します。</p></div><span class="status-badge status-pending">${requests.filter((item) => item.requestStatus === "pending").length}件確認待ち</span></header>
        ${requests.length ? `
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr><th>患者・送迎日</th><th>依頼種別</th><th>変更内容</th><th>状態</th><th>受付日時</th><th>操作</th></tr></thead>
              <tbody>
                ${requests.map((request) => {
                  const rider = riderById.get(request.riderId);
                  return `<tr>
                    <td class="cell-primary" data-label="患者・送迎日"><span class="primary-cell">${escapeHtml(rider?.fullName || "患者不明")}</span><span class="secondary-cell">${escapeHtml(formatDate(request.serviceDate, { year: true, weekday: true }))}</span></td>
                    <td data-label="依頼種別">${escapeHtml(labels.requestType[request.requestType] || request.requestType)}</td>
                    <td data-label="変更内容">${escapeHtml(changeSummary(request.requestedChanges))}</td>
                    <td data-label="状態">${statusBadge(request.requestStatus, labels.requestStatus)}</td>
                    <td data-label="受付日時">${escapeHtml(request.createdAt ? `${formatDate(request.createdAt)} ${formatTime(request.createdAt)}` : "―")}</td>
                    <td data-label="操作">
                      <div class="row-actions">
                        <button type="button" class="row-button" data-action="review-change" data-id="${escapeHtml(request.id)}" data-decision="approved" ${canReview && request.requestStatus === "pending" ? "" : "disabled"}>承認</button>
                        <button type="button" class="row-button" data-action="review-change" data-id="${escapeHtml(request.id)}" data-decision="rejected" ${canReview && request.requestStatus === "pending" ? "" : "disabled"}>却下</button>
                      </div>
                    </td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>` : emptyState("▤", "変更依頼はありません", "選択した送迎日の変更依頼はありません。", "")}
      </section>`;
  }

  function changeSummary(changes) {
    if (!changes || typeof changes !== "object") return "内容未入力";
    const values = Object.entries(changes)
      .filter(([, value]) => value !== null && value !== "")
      .map(([key, value]) => {
        const keyLabel = {
          reason: "理由",
          requestedTime: "希望時刻",
          requestedPickupTime: "迎え希望",
          requestedDropoffTime: "送り希望",
          note: "備考",
          locationName: "希望場所",
          pickupLocationId: "迎え場所",
          dropoffLocationId: "送り場所",
          direction: "対象便"
        }[key] || key;
        const display =
          key === "direction"
            ? {
                pickup: "迎えのみ",
                dropoff: "送りのみ",
                both: "迎え・送り"
              }[value] || value
            : value;
        return `${keyLabel}：${typeof display === "object" ? safeJson(display) : display}`;
      });
    return values.join("／") || "内容未入力";
  }

  function renderSystem() {
    const content = document.getElementById("main-content");
    const check = state.data.systemCheck;
    const demoPrepare = state.data.demoPrepare;
    const canPrepareDemo =
      state.role === "admin" &&
      config.environment === "demo";
    content.innerHTML = `
      <section class="content-header">
        <div>
          <h2 class="content-title">システム確認</h2>
          <p class="content-description">営業・運行開始前に、API、データベース、安全設定を一括確認します。</p>
        </div>
        <div class="action-row">
          <button type="button" class="button" data-action="run-system-check">一括検査を実行</button>
        </div>
      </section>
      ${canPrepareDemo ? `
        <section class="panel">
          <header class="panel-header">
            <div>
              <h2 class="panel-title">デモ環境の準備</h2>
              <p class="panel-subtitle">架空の患者4名、家族1名、スタッフ2名、車両2台、平日の定期予定40件を重複なく準備します。</p>
            </div>
            ${statusBadge(
              demoPrepare?.prepared
                ? "approved"
                : check?.demoData?.prepared
                  ? "approved"
                  : "warning",
              {
                approved: "準備済み",
                warning: "未準備"
              }
            )}
          </header>
          <div class="record-details">
            <div class="record-line"><span class="record-label">配車担当ログインID</span><span class="record-value">demo.dispatcher</span></div>
            <div class="record-line"><span class="record-label">デモ暗証番号</span><span class="record-value">5678</span></div>
            <div class="record-line"><span class="record-label">家族デモ</span><span class="record-value">家族番号 DEMO-G01／暗証番号 0301</span></div>
            <div class="record-line"><span class="record-label">重複防止</span><span class="record-value">同じ操作を再実行しても追加重複しません</span></div>
          </div>
          <div class="action-row">
            <button type="button" class="button" data-action="prepare-demo">デモデータを準備</button>
          </div>
        </section>` : ""}
      ${check ? renderSystemCheckResult(check) : `
        <section class="panel">
          ${emptyState("✓", "まだ検査を実行していません", "「一括検査を実行」を押すと、Worker・DB・電話番号正規化・production_guardなどを確認します。", '<button type="button" class="button" data-action="run-system-check">一括検査を実行</button>')}
        </section>`}`;
  }

  function renderSystemCheckResult(check) {
    const rows = [
      ["Worker API", check.worker?.status, check.worker?.version],
      ["データベース", check.database?.status, check.database?.version],
      ["必要テーブル・RPC", (check.database?.missingTables?.length || check.database?.missingRpcs?.length) ? "fail" : "pass", `不足テーブル ${check.database?.missingTables?.length || 0}／不足RPC ${check.database?.missingRpcs?.length || 0}`],
      ["RLS", check.database?.rlsDisabledTables?.length ? "fail" : "pass", `無効テーブル ${check.database?.rlsDisabledTables?.length || 0}`],
      ["診療所設定", check.facility?.status, `${check.facility?.businessStartTime || "―"}～${check.facility?.businessEndTime || "―"}／${check.facility?.scheduleStepMinutes || "―"}分単位`],
      ["電話番号正規化", check.phoneNormalization?.status, check.phoneNormalization?.normalizedValue],
      ["production_guard", check.productionGuard?.status, check.facility?.environment],
      ["デモデータ", check.demoData?.status, check.demoData?.prepared ? `スタッフ ${check.demoData?.staffCount || 0}名／車両 ${check.demoData?.vehicleCount || 0}台／患者 ${check.demoData?.riderCount || 0}名／定期予定 ${check.demoData?.scheduleCount || 0}件` : "システム確認からデモデータを準備してください"],
      ["家族デモポータル", check.demoData?.memberLoginReady ? "pass" : "pending", check.demoData?.memberLoginReady ? `家族 ${check.demoData?.guardianCount || 0}名／患者紐づけ ${check.demoData?.guardianLinkCount || 0}件` : "デモデータ準備で家族情報を作成します"],
      ["ブラウザCORS", check.browserCors?.status, check.browserCors?.status === "pass" ? "許可元設定済み" : "フロント公開前に設定"],
      ["LINE会員認証", check.lineMemberAuthentication?.status, check.lineMemberAuthentication?.configured ? "LINE Channel ID設定済み" : "本番LIFF公開前にLINE Channel IDを設定"],
      ["レート制限", check.rateLimiting?.status, check.rateLimiting?.status === "pass" ? "設定済み" : "本番前に推奨"]
    ];
    return `
      <section class="panel">
        <header class="panel-header">
          <div><h2 class="panel-title">検査結果</h2><p class="panel-subtitle">実処理できる項目まで確認しています。</p></div>
          ${statusBadge(check.ok ? "approved" : "danger", { approved: "必須項目 合格", danger: "要確認" })}
        </header>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr><th>検査項目</th><th>結果</th><th>確認内容</th></tr></thead>
            <tbody>
              ${rows.map(([label, status, detail]) => `<tr><td class="cell-primary" data-label="検査項目"><span class="primary-cell">${escapeHtml(label)}</span></td><td data-label="結果">${statusBadge(status === "pass" ? "approved" : status === "pending" || status === "recommended" || status === "not_applicable" ? "warning" : "danger", { approved: "合格", warning: status === "recommended" ? "推奨" : status === "not_applicable" ? "対象外" : "保留", danger: "不合格" })}</td><td data-label="確認内容">${escapeHtml(detail || "―")}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function emptyState(icon, title, message, actionHtml = "") {
    return `
      <div class="empty-state">
        <div>
          <span class="empty-state-icon" aria-hidden="true">${icon}</span>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
          ${actionHtml}
        </div>
      </div>`;
  }

  function openModal({ title, body, footer = "", wide = false, onReady = null }) {
    document.body.classList.add("modal-open");
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop>
        <section class="modal-dialog${wide ? " is-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <header class="modal-header">
            <h2 id="modal-title">${escapeHtml(title)}</h2>
            <button type="button" class="modal-close" data-modal-close aria-label="閉じる">×</button>
          </header>
          <div class="modal-content">${body}</div>
          ${footer ? `<footer class="modal-footer">${footer}</footer>` : ""}
        </section>
      </div>`;
    const dialog = modalRoot.querySelector(".modal-dialog");
    modalRoot.querySelector("[data-modal-close]")?.addEventListener("click", closeModal);
    modalRoot.querySelector("[data-modal-backdrop]")?.addEventListener("click", (event) => {
      if (event.target.matches("[data-modal-backdrop]")) closeModal();
    });
    dialog?.querySelector("input, select, textarea, button")?.focus();
    if (typeof onReady === "function") onReady(dialog);
  }

  function closeModal() {
    modalRoot.replaceChildren();
    document.body.classList.remove("modal-open");
  }

  function openAccountModal() {
    openModal({
      title: "ログイン情報",
      body: `
        <div class="record-details">
          <div class="record-line"><span class="record-label">診療所</span><span class="record-value">${escapeHtml(state.facility?.facilityName || "DPRO 診療所送迎予約")}</span></div>
          <div class="record-line"><span class="record-label">権限</span><span class="record-value">${escapeHtml(labels.roles[state.role] || state.role || "―")}</span></div>
          <div class="record-line"><span class="record-label">認証方法</span><span class="record-value">${escapeHtml(state.loginMode === "staff" ? "スタッフID" : "管理コード")}</span></div>
          <div class="record-line"><span class="record-label">環境</span><span class="record-value">${escapeHtml(state.facility?.environment || config.environment || "―")}</span></div>
          <div class="record-line"><span class="record-label">画面版</span><span class="record-value">${escapeHtml(config.version || "SHUTTLE-7")}</span></div>
        </div>`,
      footer: `
        <a class="button button-secondary" href="staff.html">現場スタッフ画面</a>
        <a class="button button-secondary" href="member.html?demo=1">家族デモ画面</a>
        <button type="button" class="button button-secondary" data-modal-close-button>閉じる</button>
        <button type="button" class="button button-danger" data-account-logout>ログアウト</button>`,
      onReady: (dialog) => {
        dialog.querySelector("[data-modal-close-button]")?.addEventListener("click", closeModal);
        dialog.querySelector("[data-account-logout]")?.addEventListener("click", logout);
      }
    });
  }

  function formValue(form, name) {
    return String(new FormData(form).get(name) || "").trim();
  }

  function checked(form, name) {
    return Boolean(form.querySelector(`[name="${name}"]`)?.checked);
  }

  function openRiderForm() {
    openModal({
      title: "患者を登録",
      wide: true,
      body: `
        <form id="rider-form" novalidate>
          <div class="form-grid">
            ${textField("riderCode", "患者番号", { required: true, placeholder: "例：R-001", maxlength: 40 })}
            ${textField("fullName", "氏名", { required: true, autocomplete: "name", maxlength: 100 })}
            ${textField("fullNameKana", "ふりがな", { maxlength: 100 })}
            ${textField("phone", "電話番号", { inputmode: "tel", autocomplete: "tel", maxlength: 30, placeholder: "例：090-1234-5678" })}
            <div class="field">
              <label for="transport-support-level">移動支援区分<span class="required-mark">必須</span></label>
              <select id="transport-support-level" name="transportSupportLevel" required>
                ${Object.entries(labels.supportLevel).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}
              </select>
            </div>
            ${textField("emergencyContactName", "緊急連絡先氏名", { maxlength: 100 })}
            ${textField("emergencyContactPhone", "緊急連絡先電話番号", { inputmode: "tel", maxlength: 30 })}
            <div class="field is-full">
              <span class="field-label">送迎時の確認</span>
              <div class="segmented">
                <label><input type="checkbox" name="usesWheelchair">車いすを利用</label>
                <label><input type="checkbox" name="requiresHandover">引渡し確認が必要</label>
              </div>
            </div>
            <div class="field is-full">
              <label for="transport-notes">送迎上の注意</label>
              <textarea id="transport-notes" name="transportNotes" maxlength="1000" placeholder="乗降介助、玄関、鍵、声かけ等、送迎に必要な情報だけを入力"></textarea>
              <p class="field-hint">診断名など、送迎業務に不要な医療情報は入力しないでください。</p>
            </div>
          </div>
        </form>`,
      footer: modalFormFooter("rider-form", "登録する"),
      onReady: (dialog) => {
        bindModalForm(dialog, "rider-form", submitRider);
        dialog.querySelector('[name="transportSupportLevel"]')?.addEventListener("change", (event) => {
          if (event.target.value === "wheelchair") {
            dialog.querySelector('[name="usesWheelchair"]').checked = true;
          }
        });
      }
    });
  }

  async function submitRider(form) {
    const phone = formValue(form, "phone");
    const emergencyPhone = formValue(form, "emergencyContactPhone");
    if (phone && !isValidPhone(phone)) {
      throw new Error("電話番号を正しく入力してください。");
    }
    if (emergencyPhone && !isValidPhone(emergencyPhone)) {
      throw new Error("緊急連絡先電話番号を正しく入力してください。");
    }
    const body = {
      riderCode: formValue(form, "riderCode"),
      fullName: formValue(form, "fullName"),
      fullNameKana: nullIfEmpty(formValue(form, "fullNameKana")),
      phone: nullIfEmpty(phone),
      transportSupportLevel: formValue(form, "transportSupportLevel"),
      usesWheelchair: checked(form, "usesWheelchair"),
      requiresHandover: checked(form, "requiresHandover"),
      transportNotes: nullIfEmpty(formValue(form, "transportNotes")),
      emergencyContactName: nullIfEmpty(formValue(form, "emergencyContactName")),
      emergencyContactPhone: nullIfEmpty(emergencyPhone)
    };
    await api("/v1/riders", { method: "POST", body });
    closeModal();
    await loadRiders("", true);
    renderRiders();
    showToast(`${body.fullName}さんを登録しました。`);
  }


  function openRiderEditForm(riderId) {
    const rider = (state.data.riders || []).find(
      (item) => item.id === riderId
    );
    if (!rider) {
      showToast("対象の患者情報が見つかりません。", "error");
      return;
    }

    openModal({
      title: "患者情報を編集",
      wide: true,
      body: `
        <form id="rider-edit-form" novalidate>
          <div class="form-grid">
            <div class="field">
              <label>患者番号</label>
              <input value="${escapeHtml(rider.riderCode)}" disabled>
              <p class="field-hint">患者番号は履歴保持のため変更しません。</p>
            </div>
            ${textField("fullName", "氏名", {
              required: true,
              autocomplete: "name",
              maxlength: 100,
              value: rider.fullName || ""
            })}
            ${textField("fullNameKana", "ふりがな", {
              maxlength: 100,
              value: rider.fullNameKana || ""
            })}
            ${textField("phone", "電話番号", {
              inputmode: "tel",
              autocomplete: "tel",
              maxlength: 30,
              value: rider.phone || ""
            })}
            <div class="field">
              <label for="edit-transport-support-level">移動支援区分<span class="required-mark">必須</span></label>
              <select id="edit-transport-support-level" name="transportSupportLevel" required>
                ${Object.entries(labels.supportLevel).map(([value, label]) =>
                  `<option value="${value}"${value === rider.transportSupportLevel ? " selected" : ""}>${escapeHtml(label)}</option>`
                ).join("")}
              </select>
            </div>
            ${textField("emergencyContactName", "緊急連絡先氏名", {
              maxlength: 100,
              value: rider.emergencyContactName || ""
            })}
            ${textField("emergencyContactPhone", "緊急連絡先電話番号", {
              inputmode: "tel",
              maxlength: 30,
              value: rider.emergencyContactPhone || ""
            })}
            <div class="field is-full">
              <span class="field-label">送迎時の確認</span>
              <div class="segmented">
                <label><input type="checkbox" name="usesWheelchair"${rider.usesWheelchair ? " checked" : ""}>車いすを利用</label>
                <label><input type="checkbox" name="requiresHandover"${rider.requiresHandover ? " checked" : ""}>引渡し確認が必要</label>
              </div>
            </div>
            <div class="field is-full">
              <label for="edit-transport-notes">送迎上の注意</label>
              <textarea id="edit-transport-notes" name="transportNotes" maxlength="1000">${escapeHtml(rider.transportNotes || "")}</textarea>
              <p class="field-hint">診断名など、送迎業務に不要な医療情報は入力しないでください。</p>
            </div>
          </div>
        </form>`,
      footer: modalFormFooter("rider-edit-form", "更新する"),
      onReady: (dialog) => {
        bindModalForm(
          dialog,
          "rider-edit-form",
          (form) => submitRiderEdit(form, rider)
        );
      }
    });
  }

  async function submitRiderEdit(form, rider) {
    const phone = formValue(form, "phone");
    const emergencyPhone = formValue(form, "emergencyContactPhone");

    if (phone && !isValidPhone(phone)) {
      throw new Error("電話番号を正しく入力してください。");
    }
    if (emergencyPhone && !isValidPhone(emergencyPhone)) {
      throw new Error("緊急連絡先電話番号を正しく入力してください。");
    }

    const body = {
      expectedUpdatedAt: rider.updatedAt,
      fullName: formValue(form, "fullName"),
      fullNameKana: nullIfEmpty(formValue(form, "fullNameKana")),
      phone: nullIfEmpty(phone),
      transportSupportLevel: formValue(form, "transportSupportLevel"),
      usesWheelchair: checked(form, "usesWheelchair"),
      requiresHandover: checked(form, "requiresHandover"),
      transportNotes: nullIfEmpty(formValue(form, "transportNotes")),
      emergencyContactName: nullIfEmpty(formValue(form, "emergencyContactName")),
      emergencyContactPhone: nullIfEmpty(emergencyPhone)
    };

    await api(`/v1/riders/${encodeURIComponent(rider.id)}`, {
      method: "PATCH",
      body
    });

    closeModal();
    await loadRiders("", true);
    renderRiders();
    showToast(`${body.fullName}さんの情報を更新しました。`);
  }

  async function updateRiderActiveStatus(
    riderId,
    nextActive,
    button
  ) {
    const rider = (state.data.riders || []).find(
      (item) => item.id === riderId
    );
    if (!rider) {
      showToast("対象の患者情報が見つかりません。", "error");
      return;
    }

    const actionLabel = nextActive ? "利用を再開" : "利用を停止";
    const historyMessage = nextActive
      ? "過去の履歴はそのまま保持されます。"
      : "過去の送迎履歴は削除せず保持します。";

    if (
      !window.confirm(
        `${rider.fullName}さんの${actionLabel}します。\n${historyMessage}\n実行しますか？`
      )
    ) {
      return;
    }

    setBusy(button, true, "処理中…");
    try {
      await api(`/v1/riders/${encodeURIComponent(rider.id)}`, {
        method: "PATCH",
        body: {
          expectedUpdatedAt: rider.updatedAt,
          isActive: nextActive
        }
      });
      await loadRiders("", true);
      renderRiders();
      showToast(`${rider.fullName}さんの${actionLabel}しました。`);
    } catch (error) {
      showToast(friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  function openGuardianForm() {
    if (!["admin", "reception"].includes(state.role)) {
      showToast(
        "家族の登録には管理者または受付の権限が必要です。",
        "warning"
      );
      return;
    }
    const riders = state.data.riders || [];
    if (!riders.length) {
      showToast(
        "家族と紐づける患者を先に登録してください。",
        "warning"
      );
      return;
    }
    openModal({
      title: "家族と閲覧対象を登録",
      wide: true,
      body: `
        <form id="guardian-form" novalidate>
          <div class="form-grid">
            ${textField("guardianCode", "家族番号", {
              required: true,
              placeholder: "例：G-001",
              maxlength: 40
            })}
            ${textField("fullName", "家族氏名", {
              required: true,
              autocomplete: "name",
              maxlength: 100
            })}
            ${textField("relationship", "続柄", {
              placeholder: "例：長女",
              maxlength: 50
            })}
            ${textField("phone", "本人確認用電話番号", {
              required: true,
              inputmode: "tel",
              autocomplete: "tel",
              maxlength: 30,
              placeholder: "例：090-1234-5678"
            })}
            <div class="field is-full">
              <label for="guardian-rider-id">閲覧対象の患者<span class="required-mark">必須</span></label>
              <select id="guardian-rider-id" name="riderId" required>
                <option value="">選択してください</option>
                ${riders.map((rider) => `<option value="${escapeHtml(rider.id)}">${escapeHtml(rider.fullName)}（${escapeHtml(rider.riderCode)}）</option>`).join("")}
              </select>
            </div>
            <div class="field is-full">
              <span class="field-label">家族画面の権限</span>
              <div class="segmented">
                <label><input type="checkbox" name="isPrimary" checked>主連絡先</label>
                <label><input type="checkbox" name="canViewSchedule" checked>送迎予定を閲覧</label>
                <label><input type="checkbox" name="canRequestChange" checked>変更依頼を送信</label>
              </div>
              <p class="field-hint">家族画面には内部メモ・住所・電話番号・緊急連絡先を表示しません。</p>
            </div>
          </div>
        </form>`,
      footer: modalFormFooter("guardian-form", "登録して紐づける"),
      onReady: (dialog) => {
        bindModalForm(dialog, "guardian-form", submitGuardian);
      }
    });
  }

  async function submitGuardian(form) {
    const phone = formValue(form, "phone");
    if (!isValidPhone(phone)) {
      throw new Error("本人確認用電話番号を正しく入力してください。");
    }
    const guardianBody = {
      guardianCode: formValue(form, "guardianCode"),
      fullName: formValue(form, "fullName"),
      relationship: nullIfEmpty(formValue(form, "relationship")),
      phone,
      linkStatus: "pending",
      notificationPreferences: {},
      isActive: true
    };
    const guardianResult = await api("/v1/guardians", {
      method: "POST",
      body: guardianBody
    });
    const guardianId = guardianResult.guardian?.id;
    if (!guardianId) {
      throw new Error(
        "家族情報の登録結果を確認できませんでした。画面を更新してご確認ください。"
      );
    }
    try {
      await api("/v1/guardian-rider-links", {
        method: "POST",
        body: {
          guardianId,
          riderId: formValue(form, "riderId"),
          isPrimary: checked(form, "isPrimary"),
          canViewSchedule: checked(form, "canViewSchedule"),
          canRequestChange: checked(form, "canRequestChange")
        }
      });
    } catch (error) {
      throw new Error(
        `家族情報は登録されましたが、患者との紐づけを完了できませんでした。画面を更新して家族番号「${guardianBody.guardianCode}」をご確認ください。${error?.message ? `（${error.message}）` : ""}`
      );
    }
    closeModal();
    await Promise.all([loadGuardians(), loadGuardianLinks()]);
    renderFamilies();
    showToast(
      `${guardianBody.fullName}さんを登録し、患者と紐づけました。`
    );
  }

  async function updateGuardianLinkStatus(
    guardianId,
    linkStatus,
    button
  ) {
    const guardian = (state.data.guardians || []).find(
      (item) => item.id === guardianId
    );
    if (!guardian) {
      showToast("対象の家族情報が見つかりません。", "error");
      return;
    }
    const actionLabel =
      linkStatus === "approved" ? "LINE連携を承認" : "LINE連携を停止";
    if (
      !window.confirm(
        `${guardian.fullName}さんの${actionLabel}します。よろしいですか？`
      )
    ) {
      return;
    }
    setBusy(button, true, "処理中…");
    try {
      await api(`/v1/guardians/${encodeURIComponent(guardian.id)}`, {
        method: "PATCH",
        body: {
          expectedUpdatedAt: guardian.updatedAt,
          linkStatus
        }
      });
      await loadGuardians();
      renderFamilies();
      showToast(`${guardian.fullName}さんの${actionLabel}しました。`);
    } catch (error) {
      showToast(friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function clearGuardianLineLink(guardianId, button) {
    const guardian = (state.data.guardians || []).find(
      (item) => item.id === guardianId
    );
    if (!guardian) {
      showToast("対象の家族情報が見つかりません。", "error");
      return;
    }
    if (state.role !== "admin") {
      showToast("LINE連携の解除には管理者権限が必要です。", "warning");
      return;
    }
    if (
      !window.confirm(
        `${guardian.fullName}さんのLINEアカウント連携を解除します。\n再利用するには、ご家族からの再申請と診療所の再承認が必要です。実行しますか？`
      )
    ) {
      return;
    }
    setBusy(button, true, "解除中…");
    try {
      await api(`/v1/guardians/${encodeURIComponent(guardian.id)}`, {
        method: "PATCH",
        body: {
          expectedUpdatedAt: guardian.updatedAt,
          clearLineLink: true
        }
      });
      await loadGuardians();
      renderFamilies();
      showToast(`${guardian.fullName}さんのLINE連携を解除しました。`);
    } catch (error) {
      showToast(friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  function openVehicleForm() {
    openModal({
      title: "車両を登録",
      body: `
        <form id="vehicle-form" novalidate>
          <div class="form-grid">
            ${textField("vehicleCode", "車両コード", { required: true, placeholder: "例：V-001", maxlength: 40 })}
            ${textField("vehicleName", "車両名", { required: true, placeholder: "例：ハイエース1号車", maxlength: 100 })}
            ${textField("plateNumber", "ナンバープレート", { maxlength: 50, placeholder: "例：福岡300 さ 12-34" })}
            <div class="field">
              <label for="vehicle-status">車両状態</label>
              <select id="vehicle-status" name="vehicleStatus">
                ${Object.entries(labels.vehicleStatus).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}
              </select>
            </div>
            ${numberField("passengerCapacity", "通常座席数", 0, 100, 4)}
            ${numberField("wheelchairCapacity", "車いす定員", 0, 20, 0)}
            <div class="field is-full">
              <label class="check-row"><input type="checkbox" name="hasLift"><span>リフトを装備している</span></label>
            </div>
          </div>
        </form>`,
      footer: modalFormFooter("vehicle-form", "登録する"),
      onReady: (dialog) => bindModalForm(dialog, "vehicle-form", submitVehicle)
    });
  }

  async function submitVehicle(form) {
    const body = {
      vehicleCode: formValue(form, "vehicleCode"),
      vehicleName: formValue(form, "vehicleName"),
      plateNumber: nullIfEmpty(formValue(form, "plateNumber")),
      passengerCapacity: Number(formValue(form, "passengerCapacity")),
      wheelchairCapacity: Number(formValue(form, "wheelchairCapacity")),
      hasLift: checked(form, "hasLift"),
      vehicleStatus: formValue(form, "vehicleStatus")
    };
    await api("/v1/vehicles", { method: "POST", body });
    closeModal();
    await loadVehicles();
    renderResources();
    showToast(`${body.vehicleName}を登録しました。`);
  }

  function openStaffForm() {
    openModal({
      title: "スタッフを登録",
      body: `
        <form id="staff-form" novalidate>
          <div class="form-grid">
            ${textField("staffCode", "スタッフコード", { required: true, placeholder: "例：S-001", maxlength: 40 })}
            ${textField("fullName", "氏名", { required: true, autocomplete: "name", maxlength: 100 })}
            <div class="field">
              <label for="staff-role">権限<span class="required-mark">必須</span></label>
              <select id="staff-role" name="staffRole" required>
                ${Object.entries(labels.roles).map(([value, label]) => `<option value="${value}"${value === "dispatcher" ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
              </select>
            </div>
            ${textField("phone", "電話番号", { inputmode: "tel", maxlength: 30 })}
            ${textField("loginId", "ログインID", { required: true, autocomplete: "username", minlength: 3, maxlength: 100, pattern: "[A-Za-z0-9._@-]{3,100}", placeholder: "半角英数字3文字以上" })}
            ${textField("pin", "暗証番号", { required: true, type: "password", inputmode: "numeric", autocomplete: "new-password", minlength: 4, maxlength: 64, placeholder: "4文字以上" })}
            <div class="field is-full">
              <p class="demo-note"><strong>重要：</strong>暗証番号は画面やAPIへそのまま保存されず、安全なハッシュへ変換されます。本人へ直接伝えてください。</p>
            </div>
          </div>
        </form>`,
      footer: modalFormFooter("staff-form", "登録する"),
      onReady: (dialog) => bindModalForm(dialog, "staff-form", submitStaff)
    });
  }

  async function submitStaff(form) {
    const phone = formValue(form, "phone");
    if (phone && !isValidPhone(phone)) {
      throw new Error("電話番号を正しく入力してください。");
    }
    const body = {
      staffCode: formValue(form, "staffCode"),
      fullName: formValue(form, "fullName"),
      staffRole: formValue(form, "staffRole"),
      phone: nullIfEmpty(phone),
      loginId: formValue(form, "loginId"),
      pin: formValue(form, "pin")
    };
    await api("/v1/staff", { method: "POST", body });
    closeModal();
    await loadStaff();
    renderResources();
    showToast(`${body.fullName}さんのスタッフIDを登録しました。`);
  }

  async function openLocationForm() {
    if (!state.data.riders.length) {
      try {
        await loadRiders("", true);
      } catch {
        // フォーム内で患者なしとして扱う。
      }
    }
    openModal({
      title: "乗降場所を登録",
      body: `
        <form id="location-form" novalidate>
          <div class="form-grid">
            <div class="field">
              <label for="location-type">場所区分<span class="required-mark">必須</span></label>
              <select id="location-type" name="locationType" required>
                <option value="home">自宅</option>
                <option value="school">学校・通所先</option>
                <option value="facility">施設共通</option>
                <option value="other">その他</option>
              </select>
            </div>
            <div class="field" id="location-rider-field">
              <label for="location-rider">患者<span class="required-mark">必須</span></label>
              <select id="location-rider" name="riderId" required>
                <option value="">選択してください</option>
                ${(state.data.riders || []).map((rider) => `<option value="${escapeHtml(rider.id)}">${escapeHtml(rider.fullName)}（${escapeHtml(rider.riderCode)}）</option>`).join("")}
              </select>
            </div>
            ${textField("locationName", "場所名", { required: true, maxlength: 100, placeholder: "例：田中様ご自宅" })}
            ${textField("postalCode", "郵便番号", { maxlength: 20, inputmode: "numeric" })}
            <div class="field is-full">${textFieldInner("addressLine1", "住所", { required: true, maxlength: 250 })}</div>
            <div class="field is-full">${textFieldInner("addressLine2", "建物名・部屋番号", { maxlength: 250 })}</div>
            <div class="field is-full">
              <label for="access-notes">乗降時の注意</label>
              <textarea id="access-notes" name="accessNotes" maxlength="1000" placeholder="玄関位置、駐車場所、声かけ等"></textarea>
            </div>
            <div class="field is-full">
              <div class="segmented">
                <label><input type="checkbox" name="isDefaultPickup">標準乗車場所</label>
                <label><input type="checkbox" name="isDefaultDropoff">標準降車場所</label>
              </div>
            </div>
          </div>
        </form>`,
      footer: modalFormFooter("location-form", "登録する"),
      onReady: (dialog) => {
        bindModalForm(dialog, "location-form", submitLocation);
        const type = dialog.querySelector('[name="locationType"]');
        const riderField = dialog.querySelector("#location-rider-field");
        const rider = dialog.querySelector('[name="riderId"]');
        type?.addEventListener("change", () => {
          const facility = type.value === "facility";
          riderField.hidden = facility;
          rider.required = !facility;
          if (facility) rider.value = "";
        });
      }
    });
  }

  async function submitLocation(form) {
    const type = formValue(form, "locationType");
    const body = {
      locationType: type,
      riderId: type === "facility" ? null : formValue(form, "riderId"),
      locationName: formValue(form, "locationName"),
      postalCode: nullIfEmpty(formValue(form, "postalCode")),
      addressLine1: formValue(form, "addressLine1"),
      addressLine2: nullIfEmpty(formValue(form, "addressLine2")),
      accessNotes: nullIfEmpty(formValue(form, "accessNotes")),
      isDefaultPickup: checked(form, "isDefaultPickup"),
      isDefaultDropoff: checked(form, "isDefaultDropoff")
    };
    await api("/v1/locations", { method: "POST", body });
    closeModal();
    await loadLocations();
    renderSchedules();
    showToast(`${body.locationName}を登録しました。`);
  }

  async function openScheduleForm() {
    if (!state.data.riders.length || state.data.locations.length < 2) {
      showToast("患者と乗降場所を先に登録してください。", "warning");
      return;
    }
    const today = jstDateString(new Date());
    openModal({
      title: "定期送迎予定を登録",
      wide: true,
      body: `
        <form id="schedule-form" novalidate>
          <div class="form-grid">
            <div class="field">
              <label for="schedule-rider">患者<span class="required-mark">必須</span></label>
              <select id="schedule-rider" name="riderId" required>
                <option value="">選択してください</option>
                ${state.data.riders.map((rider) => `<option value="${escapeHtml(rider.id)}">${escapeHtml(rider.fullName)}（${escapeHtml(rider.riderCode)}）</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="schedule-day">曜日<span class="required-mark">必須</span></label>
              <select id="schedule-day" name="dayOfWeek" required>
                ${labels.days.map((day, index) => `<option value="${index}">${day}曜日</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="service-type">送迎区分<span class="required-mark">必須</span></label>
              <select id="service-type" name="serviceType" required>
                ${Object.entries(labels.serviceType).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}
              </select>
            </div>
            ${textField("routeGroupCode", "ルートコード", { required: true, maxlength: 30, value: "A" })}
            <div class="field">
              <label for="pickup-location">乗車場所<span class="required-mark">必須</span></label>
              <select id="pickup-location" name="pickupLocationId" required>${locationOptions(state.data.locations)}</select>
            </div>
            <div class="field">
              <label for="dropoff-location">降車場所<span class="required-mark">必須</span></label>
              <select id="dropoff-location" name="dropoffLocationId" required>${locationOptions(state.data.locations)}</select>
            </div>
            ${timeField("scheduledPickupTime", "乗車予定時刻", "08:30")}
            ${timeField("scheduledDropoffTime", "降車予定時刻", "09:00")}
            ${dateField("effectiveFrom", "適用開始日", today, true, today)}
            ${dateField("effectiveTo", "適用終了日", "", false)}
            <div class="field is-full">
              <label for="schedule-notes">備考</label>
              <textarea id="schedule-notes" name="notes" maxlength="1000"></textarea>
            </div>
          </div>
        </form>`,
      footer: modalFormFooter("schedule-form", "登録する"),
      onReady: (dialog) => bindModalForm(dialog, "schedule-form", submitSchedule)
    });
  }

  async function submitSchedule(form) {
    const pickup = formValue(form, "scheduledPickupTime");
    const dropoff = formValue(form, "scheduledDropoffTime");
    if (!isThirtyMinuteStep(pickup) || !isThirtyMinuteStep(dropoff)) {
      throw new Error("送迎時刻は30分単位（00分・30分）で選択してください。");
    }
    if (dropoff <= pickup) {
      throw new Error("降車予定時刻は乗車予定時刻より後にしてください。");
    }
    const effectiveFrom = formValue(form, "effectiveFrom");
    const effectiveTo = formValue(form, "effectiveTo");
    const today = jstDateString(new Date());
    if (effectiveFrom < today) {
      throw new Error("過去日を適用開始日には指定できません。");
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new Error("適用終了日は開始日以降にしてください。");
    }
    const body = {
      riderId: formValue(form, "riderId"),
      dayOfWeek: Number(formValue(form, "dayOfWeek")),
      serviceType: formValue(form, "serviceType"),
      routeGroupCode: formValue(form, "routeGroupCode"),
      pickupLocationId: formValue(form, "pickupLocationId"),
      dropoffLocationId: formValue(form, "dropoffLocationId"),
      scheduledPickupTime: pickup,
      scheduledDropoffTime: dropoff,
      effectiveFrom,
      effectiveTo: nullIfEmpty(effectiveTo),
      notes: nullIfEmpty(formValue(form, "notes"))
    };
    await api("/v1/regular-schedules", { method: "POST", body });
    closeModal();
    await loadSchedules();
    renderSchedules();
    showToast("定期送迎予定を登録しました。");
  }

  function jumpToScheduleDay(day) {
    const target = day === null
      ? document.querySelector("[data-schedule-list-top]")
      : document.querySelector(`[data-schedule-day="${CSS.escape(String(day))}"]`);
    if (!target) {
      showToast("この曜日の定期予定はありません。", "warning");
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function openScheduleEditForm(scheduleId) {
    const schedule = (state.data.regularSchedules || []).find(
      (item) => item.id === scheduleId
    );
    if (!schedule) {
      showToast("対象の定期予定が見つかりません。画面を更新してください。", "error");
      return;
    }

    const rider = (state.data.riders || []).find(
      (item) => item.id === schedule.riderId
    );

    openModal({
      title: "定期送迎予定を編集",
      wide: true,
      body: `
        <form id="schedule-edit-form" novalidate>
          <div class="form-grid">
            <div class="field">
              <label>患者</label>
              <input value="${escapeHtml(rider?.fullName || "患者不明")}" disabled>
              <p class="field-hint">患者を変更する場合は、新しい定期予定として登録してください。</p>
            </div>
            <div class="field">
              <label for="edit-schedule-day">曜日<span class="required-mark">必須</span></label>
              <select id="edit-schedule-day" name="dayOfWeek" required>
                ${labels.days.map((day, index) => `<option value="${index}"${Number(schedule.dayOfWeek) === index ? " selected" : ""}>${day}曜日</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="edit-service-type">送迎区分<span class="required-mark">必須</span></label>
              <select id="edit-service-type" name="serviceType" required>
                ${Object.entries(labels.serviceType).map(([value, label]) => `<option value="${value}"${schedule.serviceType === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
              </select>
            </div>
            ${textField("routeGroupCode", "ルートコード", { required: true, maxlength: 30, value: schedule.routeGroupCode || "A" })}
            <div class="field">
              <label for="edit-pickup-location">乗車場所<span class="required-mark">必須</span></label>
              <select id="edit-pickup-location" name="pickupLocationId" required>
                <option value="">選択してください</option>
                ${state.data.locations.map((location) => `<option value="${escapeHtml(location.id)}"${location.id === schedule.pickupLocationId ? " selected" : ""}>${escapeHtml(location.locationName)}（${location.locationType === "facility" ? "施設共通" : "患者別"}）</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="edit-dropoff-location">降車場所<span class="required-mark">必須</span></label>
              <select id="edit-dropoff-location" name="dropoffLocationId" required>
                <option value="">選択してください</option>
                ${state.data.locations.map((location) => `<option value="${escapeHtml(location.id)}"${location.id === schedule.dropoffLocationId ? " selected" : ""}>${escapeHtml(location.locationName)}（${location.locationType === "facility" ? "施設共通" : "患者別"}）</option>`).join("")}
              </select>
            </div>
            ${timeField("scheduledPickupTime", "乗車予定時刻", formatTime(schedule.scheduledPickupTime))}
            ${timeField("scheduledDropoffTime", "降車予定時刻", formatTime(schedule.scheduledDropoffTime))}
            ${dateField("effectiveFrom", "適用開始日", schedule.effectiveFrom || "", true)}
            ${dateField("effectiveTo", "適用終了日", schedule.effectiveTo || "", false)}
            <div class="field is-full">
              <label for="edit-schedule-notes">備考</label>
              <textarea id="edit-schedule-notes" name="notes" maxlength="1000">${escapeHtml(schedule.notes || "")}</textarea>
            </div>
          </div>
        </form>`,
      footer: modalFormFooter("schedule-edit-form", "更新する"),
      onReady: (dialog) => {
        bindModalForm(
          dialog,
          "schedule-edit-form",
          (form) => submitScheduleEdit(form, schedule)
        );
      }
    });
  }

  async function submitScheduleEdit(form, schedule) {
    const pickup = formValue(form, "scheduledPickupTime");
    const dropoff = formValue(form, "scheduledDropoffTime");
    if (!isThirtyMinuteStep(pickup) || !isThirtyMinuteStep(dropoff)) {
      throw new Error("送迎時刻は30分単位（00分・30分）で選択してください。");
    }
    if (dropoff <= pickup) {
      throw new Error("降車予定時刻は乗車予定時刻より後にしてください。");
    }

    const effectiveFrom = formValue(form, "effectiveFrom");
    const effectiveTo = formValue(form, "effectiveTo");
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new Error("適用終了日は開始日以降にしてください。");
    }
    if (
      effectiveFrom !== schedule.effectiveFrom &&
      effectiveFrom < jstDateString(new Date())
    ) {
      throw new Error("過去日を新しい適用開始日には指定できません。");
    }

    await api(
      `/v1/regular-schedules/${encodeURIComponent(schedule.id)}`,
      {
        method: "PATCH",
        body: {
          expectedUpdatedAt: schedule.updatedAt,
          dayOfWeek: Number(formValue(form, "dayOfWeek")),
          serviceType: formValue(form, "serviceType"),
          routeGroupCode: formValue(form, "routeGroupCode"),
          pickupLocationId: formValue(form, "pickupLocationId"),
          dropoffLocationId: formValue(form, "dropoffLocationId"),
          scheduledPickupTime: pickup,
          scheduledDropoffTime: dropoff,
          effectiveFrom,
          effectiveTo: nullIfEmpty(effectiveTo),
          notes: nullIfEmpty(formValue(form, "notes"))
        }
      }
    );

    closeModal();
    await loadSchedules();
    renderSchedules();
    showToast("定期送迎予定を更新しました。");
  }

  async function updateScheduleActiveStatus(
    scheduleId,
    nextActive,
    button
  ) {
    const schedule = (state.data.regularSchedules || []).find(
      (item) => item.id === scheduleId
    );
    if (!schedule) {
      showToast("対象の定期予定が見つかりません。", "error");
      return;
    }

    const rider = (state.data.riders || []).find(
      (item) => item.id === schedule.riderId
    );
    const actionLabel = nextActive ? "再開" : "停止";
    if (
      !window.confirm(
        `${rider?.fullName || "この患者"}の定期予定を${actionLabel}します。\n過去の運行履歴は削除せず保持します。\n実行しますか？`
      )
    ) {
      return;
    }

    setBusy(button, true, "処理中…");
    try {
      await api(
        `/v1/regular-schedules/${encodeURIComponent(schedule.id)}`,
        {
          method: "PATCH",
          body: {
            expectedUpdatedAt: schedule.updatedAt,
            isActive: nextActive
          }
        }
      );
      await loadSchedules();
      renderSchedules();
      showToast(`定期送迎予定を${actionLabel}しました。`);
    } catch (error) {
      showToast(friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  function openReviewForm(requestId, decision) {
    const request = state.data.changeRequests.find((item) => item.id === requestId);
    if (!request) {
      showToast("対象の変更依頼が見つかりません。画面を更新してください。", "error");
      return;
    }
    const decisionLabel = decision === "approved" ? "承認" : "却下";
    openModal({
      title: `変更依頼を${decisionLabel}`,
      body: `
        <div class="info-strip${decision === "rejected" ? " is-warning" : ""}">
          <span aria-hidden="true">${decision === "approved" ? "✓" : "△"}</span>
          <div><strong>${escapeHtml(labels.requestType[request.requestType] || request.requestType)}</strong><br>${escapeHtml(changeSummary(request.requestedChanges))}</div>
        </div>
        <form id="review-form" novalidate>
          <input type="hidden" name="requestId" value="${escapeHtml(request.id)}">
          <input type="hidden" name="decision" value="${escapeHtml(decision)}">
          <input type="hidden" name="expectedUpdatedAt" value="${escapeHtml(request.updatedAt)}">
          <div class="field">
            <label for="review-notes">確認メモ${decision === "rejected" ? '<span class="required-mark">入力推奨</span>' : ""}</label>
            <textarea id="review-notes" name="reviewNotes" maxlength="1000" placeholder="${decision === "approved" ? "配車変更内容など" : "却下理由など"}"></textarea>
          </div>
        </form>`,
      footer: modalFormFooter("review-form", `${decisionLabel}する`, decision === "rejected" ? "button-danger" : ""),
      onReady: (dialog) => bindModalForm(dialog, "review-form", submitReview)
    });
  }

  async function submitReview(form) {
    if (state.loginMode !== "staff") {
      throw new Error("承認・却下にはスタッフIDでログインしてください。");
    }
    const requestId = formValue(form, "requestId");
    const body = {
      decision: formValue(form, "decision"),
      expectedUpdatedAt: formValue(form, "expectedUpdatedAt"),
      reviewNotes: nullIfEmpty(formValue(form, "reviewNotes"))
    };
    await api(`/v1/change-requests/${encodeURIComponent(requestId)}/review`, {
      method: "POST",
      body
    });
    closeModal();
    await loadChanges();
    renderChanges();
    showToast(`変更依頼を${body.decision === "approved" ? "承認" : "却下"}しました。`);
  }

  async function openRunDetail(run) {
    const canAssign =
      state.loginMode === "staff" &&
      ["admin", "dispatcher"].includes(state.role);
    if (canAssign && !state.data.staff.length) {
      await loadStaff();
    }
    const assignments = run.assignments || [];
    const stops = run.stops || [];
    const assignmentControls = renderRunAssignmentControls(
      run,
      assignments,
      canAssign
    );
    openModal({
      title: `${formatTime(run.scheduledStartAt)} ${run.runCode}`,
      wide: true,
      body: `
        <div class="form-grid">
          <div class="record-card">
            <div class="record-card-header">
              <div><h3>運行情報</h3><p class="record-code">${escapeHtml(labels.serviceType[run.serviceType] || run.serviceType)}・${escapeHtml(run.routeGroupCode || "ルート未設定")}</p></div>
              ${statusBadge(run.runStatus, labels.runStatus)}
            </div>
            <div class="record-details">
              <div class="record-line"><span class="record-label">予定時間</span><span class="record-value">${escapeHtml(formatTime(run.scheduledStartAt))}～${escapeHtml(formatTime(run.scheduledEndAt))}</span></div>
              <div class="record-line"><span class="record-label">車両</span><span class="record-value">${escapeHtml(run.vehicle?.vehicleName || "未割当")}</span></div>
              <div class="record-line"><span class="record-label">担当</span><span class="record-value">${escapeHtml(assignments.map((item) => `${item.staff?.fullName || "不明"}（${item.duty === "driver" ? "運転" : "添乗"}）`).join("、") || "未割当")}</span></div>
              <div class="record-line"><span class="record-label">備考</span><span class="record-value">${escapeHtml(run.notes || "―")}</span></div>
            </div>
          </div>
          <div class="record-card">
            <div class="record-card-header"><div><h3>乗車予定</h3><p class="record-code">${stops.length}名</p></div></div>
            <div class="record-details">
              <div class="record-line"><span class="record-label">車いす</span><span class="record-value">${stops.filter((stop) => stop.rider?.usesWheelchair).length}名</span></div>
              <div class="record-line"><span class="record-label">引渡し確認</span><span class="record-value">${stops.filter((stop) => stop.rider?.requiresHandover).length}名</span></div>
            </div>
          </div>
        </div>
        ${assignmentControls}
        <section class="panel">
          <header class="panel-header"><div><h3 class="panel-title">患者・乗降状況</h3><p class="panel-subtitle">内部メモや不要な個人情報は表示しません。</p></div></header>
          ${stops.length ? `
            <div class="data-table-wrap">
              <table class="data-table">
                <thead><tr><th>順番・患者</th><th>予定時刻</th><th>状態</th><th>移動支援</th><th>乗車場所</th><th>降車場所</th></tr></thead>
                <tbody>
                  ${stops.map((stop) => `<tr>
                    <td class="cell-primary" data-label="順番・患者"><span class="primary-cell">${Number(stop.stopOrder || 0)}. ${escapeHtml(stop.rider?.fullName || "患者不明")}</span><span class="secondary-cell">${escapeHtml(stop.rider?.riderCode || "―")}</span></td>
                    <td data-label="予定時刻">${escapeHtml(formatTime(stop.plannedPickupAt))}</td>
                    <td data-label="状態">${statusBadge(stop.stopStatus, labels.stopStatus)}</td>
                    <td data-label="移動支援">${escapeHtml(labels.supportLevel[stop.rider?.transportSupportLevel] || "―")}</td>
                    <td data-label="乗車場所">${escapeHtml(stop.pickupLocation?.locationName || "―")}</td>
                    <td data-label="降車場所">${escapeHtml(stop.dropoffLocation?.locationName || "―")}</td>
                  </tr>`).join("")}
                </tbody>
              </table>
            </div>` : emptyState("♙", "患者の割当はありません", "この便にはまだ患者が割り当てられていません。", "")}
        </section>`,
      footer: '<a class="button button-secondary" href="staff.html">現場スタッフ画面</a><button type="button" class="button" data-modal-close-button>閉じる</button>',
      onReady: (dialog) => {
        dialog.querySelector("[data-modal-close-button]")
          ?.addEventListener("click", closeModal);
        dialog.querySelectorAll("[data-assign-run-staff]").forEach((button) => {
          button.addEventListener("click", () =>
            assignRunStaff(run.id, button.dataset.duty, button, dialog)
          );
        });
        dialog.querySelectorAll("[data-remove-run-staff]").forEach((button) => {
          button.addEventListener("click", () =>
            removeRunStaff(
              run.id,
              button.dataset.staffId,
              button.dataset.duty,
              button
            )
          );
        });
      }
    });
  }

  function renderRunAssignmentControls(run, assignments, canAssign) {
    if (!canAssign) {
      return `
        <div class="info-strip is-warning" role="status">
          <span aria-hidden="true">△</span>
          <div>
            <strong>担当割当は配車担当のスタッフIDログインで行います。</strong><br>
            管理コードは初期設定・閲覧用です。現場スタッフへ便を表示するには、配車担当でログインし直してください。
          </div>
        </div>`;
    }

    const activeStaff = (state.data.staff || []).filter(
      (staff) => staff.isActive !== false
    );
    const assignedKeys = new Set(
      assignments.map((item) => `${item.staffId}:${item.duty}`)
    );
    const assignedStaffIds = new Set(
      assignments.map((item) => item.staffId)
    );
    const driver = assignments.find((item) => item.duty === "driver");
    const attendants = assignments.filter(
      (item) => item.duty === "attendant"
    );
    const driverOptions = activeStaff.filter(
      (staff) =>
        staff.staffRole === "driver" &&
        !assignedKeys.has(`${staff.id}:driver`) &&
        !assignedStaffIds.has(staff.id)
    );
    const attendantOptions = activeStaff.filter(
      (staff) =>
        staff.staffRole === "attendant" &&
        !assignedKeys.has(`${staff.id}:attendant`) &&
        !assignedStaffIds.has(staff.id)
    );

    return `
      <section class="panel">
        <header class="panel-header">
          <div>
            <h3 class="panel-title">担当スタッフ割当</h3>
            <p class="panel-subtitle">同じ時間帯への重複割当はデータベース側でも拒否します。</p>
          </div>
        </header>
        <div class="form-grid" style="padding:16px">
          <div class="record-card">
            <div class="record-card-header">
              <div><h3>運転担当</h3><p class="record-code">1便につき1名</p></div>
            </div>
            ${driver
              ? `<div class="record-details">
                  <div class="record-line">
                    <span class="record-label">割当済み</span>
                    <span class="record-value">${escapeHtml(driver.staff?.fullName || "不明")}
                      <button type="button" class="row-button" data-remove-run-staff data-staff-id="${escapeHtml(driver.staffId)}" data-duty="driver">解除</button>
                    </span>
                  </div>
                </div>`
              : `<div class="field" style="margin:16px">
                  <label for="run-driver-select">運転員を選択</label>
                  <select id="run-driver-select" data-assignment-select="driver">
                    <option value="">選択してください</option>
                    ${staffAssignmentOptions(driverOptions)}
                  </select>
                  <button type="button" class="button button-wide" data-assign-run-staff data-duty="driver" style="margin-top:10px" ${driverOptions.length ? "" : "disabled"}>運転担当へ割り当て</button>
                </div>`}
          </div>
          <div class="record-card">
            <div class="record-card-header">
              <div><h3>添乗担当</h3><p class="record-code">必要な場合だけ割当</p></div>
            </div>
            <div class="record-details">
              ${attendants.length
                ? attendants.map((item) => `
                    <div class="record-line">
                      <span class="record-label">割当済み</span>
                      <span class="record-value">${escapeHtml(item.staff?.fullName || "不明")}
                        <button type="button" class="row-button" data-remove-run-staff data-staff-id="${escapeHtml(item.staffId)}" data-duty="attendant">解除</button>
                      </span>
                    </div>`).join("")
                : '<div class="record-line"><span class="record-label">割当</span><span class="record-value">なし</span></div>'}
            </div>
            <div class="field" style="margin:16px">
              <label for="run-attendant-select">添乗員を追加</label>
              <select id="run-attendant-select" data-assignment-select="attendant">
                <option value="">選択してください</option>
                ${staffAssignmentOptions(attendantOptions)}
              </select>
              <button type="button" class="button button-secondary button-wide" data-assign-run-staff data-duty="attendant" style="margin-top:10px" ${attendantOptions.length ? "" : "disabled"}>添乗担当へ追加</button>
            </div>
          </div>
        </div>
      </section>`;
  }

  function staffAssignmentOptions(staff) {
    return staff.map((item) => `
      <option value="${escapeHtml(item.id)}">
        ${escapeHtml(item.fullName)}（${escapeHtml(labels.roles[item.staffRole] || item.staffRole)}）
      </option>`).join("");
  }

  async function assignRunStaff(runId, duty, button, dialog) {
    const select = dialog.querySelector(
      `[data-assignment-select="${duty}"]`
    );
    const staffId = String(select?.value || "");
    if (!staffId) {
      showToast("割り当てるスタッフを選択してください。", "warning");
      select?.focus();
      return;
    }
    setBusy(button, true, "割当中…");
    try {
      await api(`/v1/runs/${encodeURIComponent(runId)}/staff`, {
        method: "POST",
        body: { staffId, duty }
      });
      await refreshRunDetail(runId);
      showToast(
        `${duty === "driver" ? "運転" : "添乗"}担当を割り当てました。`
      );
    } catch (error) {
      showToast(friendlyError(error), "error");
      setBusy(button, false);
    }
  }

  async function removeRunStaff(runId, staffId, duty, button) {
    const confirmed = window.confirm(
      `${duty === "driver" ? "運転" : "添乗"}担当の割当を解除しますか？`
    );
    if (!confirmed) return;
    setBusy(button, true, "解除中…");
    try {
      await api(
        `/v1/runs/${encodeURIComponent(runId)}/staff/remove`,
        {
          method: "POST",
          body: { staffId, duty }
        }
      );
      await refreshRunDetail(runId);
      showToast(
        `${duty === "driver" ? "運転" : "添乗"}担当を解除しました。`
      );
    } catch (error) {
      showToast(friendlyError(error), "error");
      setBusy(button, false);
    }
  }

  async function refreshRunDetail(runId) {
    closeModal();
    await loadDashboard();
    renderToday();
    const updated = state.data.dashboard?.runs?.find(
      (item) => item.id === runId
    );
    if (updated) {
      await openRunDetail(updated);
    }
  }

  async function generateRuns(button) {
    if (state.loginMode !== "staff") {
      showToast("担当者を記録するため、スタッフIDでログインしてください。", "warning");
      return;
    }
    const confirmed = window.confirm(
      `${formatDate(state.serviceDate, { year: true, weekday: true })}の送迎便を定期予定から生成します。\n同じ便は二重作成されません。実行しますか？`
    );
    if (!confirmed) return;
    setBusy(button, true, "生成中…");
    try {
      await api("/v1/runs/generate", {
        method: "POST",
        body: { serviceDate: state.serviceDate }
      });
      await loadDashboard();
      renderToday();
      showToast("当日の送迎便を生成しました。同じ内容は二重作成されません。");
    } catch (error) {
      showToast(friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function prepareDemo(button) {
    if (
      state.role !== "admin" ||
      config.environment !== "demo"
    ) {
      showToast(
        "デモデータの準備は、デモ環境へ管理者でログインした場合だけ実行できます。",
        "warning"
      );
      return;
    }
    const confirmed = window.confirm(
      "架空の患者・家族・スタッフ・車両・定期予定を準備します。\n同じ操作を再実行しても重複登録されません。実行しますか？"
    );
    if (!confirmed) return;
    setBusy(button, true, "準備中…");
    try {
      const result = await api("/v1/demo/prepare", {
        method: "POST",
        body: {}
      });
      state.data.demoPrepare = result.demoData || null;
      const checkResult = await api("/v1/system/check", {
        method: "POST",
        body: {},
        idempotent: false
      });
      state.data.systemCheck = checkResult.systemCheck;
      renderSystem();
      showToast(
        `デモデータを準備しました。スタッフIDは「${result.demoStaff?.loginId || "demo.dispatcher"}」／暗証番号「${result.demoStaff?.pin || "5678"}」、家族番号は「${result.demoMember?.guardianCode || "DEMO-G01"}」／暗証番号「${result.demoMember?.pin || "0301"}」です。`,
        "success",
        "demo-prepare"
      );
    } catch (error) {
      showToast(
        friendlyError(error),
        "error",
        "demo-prepare"
      );
    } finally {
      setBusy(button, false);
    }
  }

  async function runSystemCheck(button) {
    setBusy(button, true, "検査中…");
    try {
      const result = await api("/v1/system/check", {
        method: "POST",
        body: {},
        idempotent: false
      });
      state.data.systemCheck = result.systemCheck;
      renderSystem();
      showToast(
        result.systemCheck?.ok
          ? "必須項目はすべて合格しました。"
          : "確認が必要な項目があります。",
        result.systemCheck?.ok ? "success" : "warning",
        "system-check"
      );
    } catch (error) {
      showToast(friendlyError(error), "error", "system-check");
    } finally {
      setBusy(button, false);
    }
  }

  function bindModalForm(dialog, formId, submitHandler) {
    dialog.querySelector("[data-form-cancel]")?.addEventListener("click", closeModal);
    const form = dialog.querySelector(`#${formId}`);
    const submit = dialog.querySelector(`[data-form-submit="${formId}"]`);
    submit?.addEventListener("click", () => form?.requestSubmit());
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      setBusy(submit, true, "登録中…");
      try {
        await submitHandler(form, submit);
      } catch (error) {
        showToast(friendlyError(error), "error");
        setBusy(submit, false);
      }
    });
  }

  function modalFormFooter(formId, submitLabel, extraClass = "") {
    return `
      <button type="button" class="button button-secondary" data-form-cancel>キャンセル</button>
      <button type="button" class="button ${extraClass}" data-form-submit="${escapeHtml(formId)}">${escapeHtml(submitLabel)}</button>`;
  }

  function textField(name, label, options = {}) {
    return `<div class="field">${textFieldInner(name, label, options)}</div>`;
  }

  function textFieldInner(name, label, options = {}) {
    const id = options.id || name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const type = options.type || "text";
    const attributes = [
      `id="${escapeHtml(id)}"`,
      `name="${escapeHtml(name)}"`,
      `type="${escapeHtml(type)}"`,
      options.required ? "required" : "",
      options.autocomplete ? `autocomplete="${escapeHtml(options.autocomplete)}"` : "",
      options.inputmode ? `inputmode="${escapeHtml(options.inputmode)}"` : "",
      options.minlength ? `minlength="${Number(options.minlength)}"` : "",
      options.maxlength ? `maxlength="${Number(options.maxlength)}"` : "",
      options.pattern ? `pattern="${escapeHtml(options.pattern)}"` : "",
      options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : "",
      options.value !== undefined ? `value="${escapeHtml(options.value)}"` : ""
    ].filter(Boolean).join(" ");
    return `
      <label for="${escapeHtml(id)}">${escapeHtml(label)}${options.required ? '<span class="required-mark">必須</span>' : ""}</label>
      <input ${attributes}>`;
  }

  function numberField(name, label, min, max, value) {
    const id = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return `
      <div class="field">
        <label for="${id}">${escapeHtml(label)}<span class="required-mark">必須</span></label>
        <input id="${id}" name="${escapeHtml(name)}" type="number" required min="${Number(min)}" max="${Number(max)}" step="1" value="${Number(value)}">
      </div>`;
  }

  function timeField(name, label, value) {
    const id = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return `
      <div class="field">
        <label for="${id}">${escapeHtml(label)}<span class="required-mark">必須</span></label>
        <input id="${id}" name="${escapeHtml(name)}" type="time" required step="1800" value="${escapeHtml(value)}">
      </div>`;
  }

  function dateField(name, label, value, required, minValue = "") {
    const id = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return `
      <div class="field">
        <label for="${id}">${escapeHtml(label)}${required ? '<span class="required-mark">必須</span>' : ""}</label>
        <input id="${id}" name="${escapeHtml(name)}" type="date" ${required ? "required" : ""} ${minValue ? `min="${escapeHtml(minValue)}"` : ""} value="${escapeHtml(value)}">
      </div>`;
  }

  function locationOptions(locations) {
    return `
      <option value="">選択してください</option>
      ${locations.map((location) => `<option value="${escapeHtml(location.id)}">${escapeHtml(location.locationName)}（${location.locationType === "facility" ? "施設共通" : "患者別"}）</option>`).join("")}`;
  }

  function nullIfEmpty(value) {
    return value === "" ? null : value;
  }

  function isValidPhone(value) {
    const digits = normalizePhone(value);
    return /^0\d{9,10}$/.test(digits);
  }

  function isThirtyMinuteStep(value) {
    const match = String(value).match(/^(\d{2}):(\d{2})$/);
    return Boolean(match && ["00", "30"].includes(match[2]));
  }

  function initialize() {
    if (!config.apiBaseUrl || !config.facilityCode) {
      app.className = "";
      app.innerHTML = `
        <div class="empty-state">
          <div>
            <span class="empty-state-icon">!</span>
            <h1>設定ファイルを確認してください</h1>
            <p>API接続先または診療所コードが設定されていません。</p>
          </div>
        </div>`;
      return;
    }
    if (restoreSession()) {
      renderShell();
      loadActiveSection();
    } else {
      renderLogin();
    }
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (document.body.classList.contains("modal-open")) {
        closeModal();
      } else {
        document.body.classList.remove("sidebar-open");
      }
    }
  });

  initialize();
})();
