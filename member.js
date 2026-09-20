const PHASE3B_MEMBER_UI_R1 = true;
const PHASE3B_CANCEL_REASON_MEMBER_R1 = true;

const runtimeConfig =
  typeof window !== "undefined"
    ? window.DPRO_SHUTTLE_CONFIG || {}
    : {};

const requestTypeLabels = Object.freeze({
  absence: "欠席",
  time_change: "時間変更",
  one_way: "片道利用",
  other: "その他"
});

const requestStatusLabels = Object.freeze({
  pending: "確認待ち",
  approved: "承認",
  rejected: "却下",
  cancelled: "取消"
});

const stopStatusLabels = Object.freeze({
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

const serviceTypeLabels = Object.freeze({
  pickup: "迎え",
  dropoff: "送り",
  transfer: "施設間移送"
});

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


export function jstDateString(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalizePhone(value) {
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

export function isValidJapanesePhone(value) {
  return /^0\d{9,10}$/.test(normalizePhone(value));
}

export function isPastJstDate(value, now = new Date()) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) &&
    String(value) < jstDateString(now);
}

export function buildChangePayload(values) {
  const type = String(values.requestType || "");
  const note = String(values.note || "").trim();
  if (!Object.hasOwn(requestTypeLabels, type)) {
    throw new Error("変更内容の種類を選択してください。");
  }
  if (type === "absence") {
    const reason = String(values.reason || "").trim();
    if (!reason) throw new Error("欠席理由を入力してください。");
    return {
      reason,
      direction: String(values.direction || "both"),
      ...(note ? { note } : {})
    };
  }
  if (type === "time_change") {
    const pickup = String(values.requestedPickupTime || "").trim();
    const dropoff = String(values.requestedDropoffTime || "").trim();
    if (!pickup && !dropoff) {
      throw new Error("希望する迎え時刻または送り時刻を入力してください。");
    }
    return {
      ...(pickup ? { requestedPickupTime: pickup } : {}),
      ...(dropoff ? { requestedDropoffTime: dropoff } : {}),
      ...(note ? { note } : {})
    };
  }
  if (type === "one_way") {
    const direction = String(values.direction || "");
    if (!["pickup", "dropoff"].includes(direction)) {
      throw new Error("利用する便を選択してください。");
    }
    return {
      direction,
      ...(note ? { note } : {})
    };
  }
  if (!note) throw new Error("変更内容を入力してください。");
  return { note };
}

export function statusTone(status) {
  if (
    [
      "approved",
      "completed",
      "handed_over",
      "arrived"
    ].includes(status)
  ) {
    return "is-good";
  }
  if (
    [
      "pending",
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
      "planned"
    ].includes(status)
  ) {
    return "is-progress";
  }
  if (
    ["rejected", "cancelled", "cancel_requested", "no_show"].includes(status)
  ) {
    return "is-danger";
  }
  return "";
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `member-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(value) {
  if (!value) return "―";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+09:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "―";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

function formatTime(value) {
  if (!value) return "―";
  const raw = String(value);

  const time = raw.match(/^(\d{2}):(\d{2})/);
  if (time) return `${time[1]}:${time[2]}`;

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

function changeSummary(changes = {}) {
  const labels = {
    reason: "理由",
    direction: "対象便",
    requestedPickupTime: "迎え希望",
    requestedDropoffTime: "送り希望",
    note: "内容"
  };
  const values = Object.entries(changes).map(([key, value]) => {
    const display =
      key === "direction"
        ? { pickup: "迎えのみ", dropoff: "送りのみ", both: "迎え・送り" }[value] || value
        : value;
    return `${labels[key] || key}：${display}`;
  });
  return values.join("／") || "内容なし";
}

function sessionStorageKey() {
  return (
    runtimeConfig.memberSessionStorageKey ||
    "dpro_shuttle_member_session_v1"
  );
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(sessionStorageKey());
    const value = raw ? JSON.parse(raw) : null;
    return value?.token ? value : null;
  } catch {
    return null;
  }
}

function saveSession(payload) {
  const session = {
    token: payload.token,
    member: payload.member,
    facility: payload.facility,
    demo: payload.demo === true
  };
  sessionStorage.setItem(sessionStorageKey(), JSON.stringify(session));
  return session;
}

function clearSession() {
  sessionStorage.removeItem(sessionStorageKey());
}

let memberSessionRefreshPromise = null;

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

async function refreshMemberSessionIfNeeded(currentToken) {
  const remaining = tokenSecondsRemaining(currentToken);
  if (remaining <= 0 || remaining > 600) {
    return currentToken;
  }
  if (memberSessionRefreshPromise) {
    return memberSessionRefreshPromise;
  }

  const base = String(runtimeConfig.apiBaseUrl || "").replace(/\/+$/, "");
  memberSessionRefreshPromise = (async () => {
    const response = await fetch(`${base}/v1/auth/refresh`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentToken}`
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

    const current = loadSession();
    if (current?.token === currentToken) {
      current.token = payload.token;
      sessionStorage.setItem(
        sessionStorageKey(),
        JSON.stringify(current)
      );
    }
    return payload.token;
  })().finally(() => {
    memberSessionRefreshPromise = null;
  });

  return memberSessionRefreshPromise;
}

async function api(path, options = {}) {
  const base = String(runtimeConfig.apiBaseUrl || "").replace(/\/+$/, "");
  if (!base.startsWith("https://")) {
    throw new Error("API接続先が正しく設定されていません。");
  }

  let requestToken = options.token || null;
  if (requestToken && !path.startsWith("/v1/auth/")) {
    try {
      requestToken = await refreshMemberSessionIfNeeded(requestToken);
    } catch {
      // 本リクエストの401/403処理で再ログインへ案内する。
    }
  }

  const headers = new Headers({ Accept: "application/json" });
  if (requestToken) {
    headers.set("Authorization", `Bearer ${requestToken}`);
  }
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const method = String(options.method || "GET").toUpperCase();
  if (
    ["POST", "PATCH"].includes(method) &&
    options.idempotent !== false
  ) {
    headers.set("Idempotency-Key", options.idempotencyKey || uuid());
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(runtimeConfig.requestTimeoutMs) || 12000
  );
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      cache: "no-store",
      signal: controller.signal
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok || payload.ok === false) {
      const error = new Error(
        payload?.error?.message ||
          `通信エラーが発生しました（${response.status}）。`
      );
      error.status = response.status;
      error.code = payload?.error?.code || "HTTP_ERROR";
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "通信に時間がかかっています。接続を確認して、もう一度お試しください。"
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toast(message, error = false) {
  const region = document.getElementById("member-toast-region");
  if (!region) return;
  const item = document.createElement("div");
  item.className = `member-toast${error ? " is-error" : ""}`;
  item.textContent = message;
  region.appendChild(item);
  window.setTimeout(() => item.remove(), error ? 8500 : 5200);
}

function setBusy(button, busy, text = "処理中…") {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = text;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function shell(content, session = null) {
  const facilityName =
    session?.facility?.facilityName || "DPRO 診療所送迎予約";
  return `
    <div class="member-shell">
      <header class="member-header">
        <div class="member-header-inner">
          <div class="member-brand">
            <span class="member-brand-mark" aria-hidden="true">▰</span>
            <span>
              <strong>DPRO 送迎連絡</strong>
              <span>${escapeHtml(facilityName)}</span>
            </span>
          </div>
          ${session ? '<button type="button" class="member-button is-secondary" data-member-action="logout">終了</button>' : ""}
        </div>
      </header>
      <main class="member-main">${content}</main>
      <footer class="member-footer">DPRO 診療所送迎予約　${escapeHtml(runtimeConfig.version || "SHUTTLE-7")}</footer>
    </div>`;
}

function renderDemoLogin(app) {
  app.className = "";
  app.removeAttribute("aria-busy");
  app.innerHTML = shell(`
    <section class="member-hero">
      <p class="member-eyebrow">ご家族用・デモ</p>
      <h1>送迎予定を確認</h1>
      <p>ご本人の送迎時刻と現在の状況を、分かりやすく確認できます。</p>
    </section>
    <div class="member-notice is-warning">
      これは架空データを使用するデモ画面です。本番の個人情報は含まれていません。
    </div>
    <section class="member-card">
      <header class="member-card-header">
        <div>
          <h2>家族デモログイン</h2>
          <p>管理画面の「デモデータを準備」を一度実行してからご利用ください。</p>
        </div>
      </header>
      <div class="member-card-body">
        <form id="member-demo-login" novalidate>
          <div class="member-grid">
            <div class="member-field is-full">
              <label for="demo-guardian-code">家族番号<span class="member-required">必須</span></label>
              <input id="demo-guardian-code" name="guardianCode" required maxlength="40" autocomplete="username" value="DEMO-G01">
            </div>
            <div class="member-field is-full">
              <label for="demo-member-pin">デモ暗証番号<span class="member-required">必須</span></label>
              <input id="demo-member-pin" name="pin" type="password" required inputmode="numeric" minlength="4" maxlength="4" pattern="[0-9]{4}" autocomplete="current-password" value="0301">
              <p class="member-hint">デモ用：家族番号 DEMO-G01／暗証番号 0301</p>
            </div>
          </div>
          <div class="member-actions">
            <button type="submit" class="member-button is-wide">デモ画面を開く</button>
          </div>
        </form>
      </div>
    </section>
    ${runtimeConfig.liffId ? '<div class="member-actions"><button type="button" class="member-button is-secondary is-wide" data-member-action="line-login">LINEで開く</button></div>' : ""}
  `);
  document
    .getElementById("member-demo-login")
    ?.addEventListener("submit", handleDemoLogin);
}

async function handleDemoLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, "確認中…");
  try {
    const values = new FormData(form);
    const result = await api("/v1/auth/member/demo", {
      method: "POST",
      body: {
        facilityCode: runtimeConfig.facilityCode,
        guardianCode: String(values.get("guardianCode") || "").trim(),
        pin: String(values.get("pin") || "").trim()
      }
    });
    const session = saveSession(result);
    await renderHome(document.getElementById("member-app"), session);
  } catch (error) {
    toast(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function loginWithLine(app) {
  if (!runtimeConfig.liffId || !globalThis.liff) {
    renderLineNotConfigured(app);
    return;
  }
  try {
    await globalThis.liff.init({ liffId: runtimeConfig.liffId });
    if (!globalThis.liff.isLoggedIn()) {
      globalThis.liff.login({ redirectUri: window.location.href });
      return;
    }
    const idToken = globalThis.liff.getIDToken();
    if (!idToken) {
      throw new Error(
        "LINEの本人確認情報を取得できませんでした。LINEから開き直してください。"
      );
    }
    try {
      const result = await api("/v1/auth/member", {
        method: "POST",
        body: {
          facilityCode: runtimeConfig.facilityCode,
          idToken
        }
      });
      const session = saveSession(result);
      await renderHome(app, session);
    } catch (error) {
      if (error.code === "MEMBER_LINK_NOT_APPROVED") {
        renderLinkRequest(app, idToken);
        return;
      }
      throw error;
    }
  } catch (error) {
    renderFatal(app, error.message);
  }
}

function renderLineNotConfigured(app) {
  app.className = "";
  app.removeAttribute("aria-busy");
  app.innerHTML = shell(`
    <section class="member-hero">
      <p class="member-eyebrow">ご家族用</p>
      <h1>LINE設定準備中</h1>
      <p>デモ確認後に、診療所専用のLIFF設定を行います。</p>
    </section>
    <div class="member-notice is-warning">
      本番用LIFF IDがまだ設定されていません。管理者へお問い合わせください。
    </div>
    ${runtimeConfig.environment === "demo" ? '<a class="member-button is-wide" href="member.html?demo=1">デモ画面を開く</a>' : ""}
  `);
}

function renderLinkRequest(app, idToken) {
  app.className = "";
  app.removeAttribute("aria-busy");
  app.innerHTML = shell(`
    <section class="member-hero">
      <p class="member-eyebrow">初回のみ</p>
      <h1>LINE連携を申請</h1>
      <p>家族番号と診療所へ登録済みの電話番号を照合します。</p>
    </section>
    <div class="member-notice">
      申請後、診療所が承認すると送迎予定を閲覧できます。別の方の情報と誤って連携しないため、承認前は予定を表示しません。
    </div>
    <section class="member-card">
      <header class="member-card-header">
        <div><h2>本人確認</h2><p>登録内容が分からない場合は診療所へご連絡ください。</p></div>
      </header>
      <div class="member-card-body">
        <form id="member-link-request" novalidate>
          <div class="member-grid">
            <div class="member-field is-full">
              <label for="link-guardian-code">家族番号<span class="member-required">必須</span></label>
              <input id="link-guardian-code" name="guardianCode" required maxlength="40" autocomplete="username">
            </div>
            <div class="member-field is-full">
              <label for="link-phone">登録電話番号<span class="member-required">必須</span></label>
              <input id="link-phone" name="phone" required inputmode="tel" maxlength="30" autocomplete="tel" placeholder="例：090-1234-5678">
            </div>
          </div>
          <div class="member-actions">
            <button type="submit" class="member-button is-wide">連携を申請する</button>
          </div>
        </form>
      </div>
    </section>
  `);
  document
    .getElementById("member-link-request")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const values = new FormData(form);
      const phone = String(values.get("phone") || "").trim();
      if (!isValidJapanesePhone(phone)) {
        toast("登録電話番号を正しく入力してください。", true);
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      setBusy(button, true, "申請中…");
      try {
        const result = await api("/v1/member/link/request", {
          method: "POST",
          body: {
            facilityCode: runtimeConfig.facilityCode,
            idToken,
            guardianCode: String(
              values.get("guardianCode") || ""
            ).trim(),
            phone
          }
        });
        app.innerHTML = shell(`
          <section class="member-hero">
            <p class="member-eyebrow">申請完了</p>
            <h1>診療所の承認待ちです</h1>
            <p>${escapeHtml(result.message || "承認後にLINEから開き直してください。")}</p>
          </section>
          <div class="member-notice">承認されるまで送迎予定や患者情報は表示されません。</div>
        `);
      } catch (error) {
        toast(error.message, true);
      } finally {
        setBusy(button, false);
      }
    });
}

async function renderHome(app, session, selectedDate = jstDateString()) {
  app.className = "member-loading";
  app.setAttribute("aria-busy", "true");
  app.innerHTML = `
    <div class="member-loading-card" role="status">
      <span class="member-spinner" aria-hidden="true"></span>
      <span>送迎予定を確認しています</span>
    </div>`;
  try {
    const result = await api(
      `/v1/member/home?serviceDate=${encodeURIComponent(selectedDate)}`,
      { token: session.token }
    );
    renderHomeData(app, session, result);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      clearSession();
    }
    renderFatal(app, error.message);
  }
}

function renderHomeData(app, session, data) {
  const riders = data.riders || [];
  const schedules = data.schedules || [];
  const stops = data.stops || [];
  const reservations = data.reservations || [];
  const reservationLocations = data.reservationLocations || [];
  const changes = data.changeRequests || [];
  const stopsByRider = new Map();
  for (const stop of stops) {
    const current = stopsByRider.get(stop.riderId) || [];
    current.push(stop);
    stopsByRider.set(stop.riderId, current);
  }
  app.className = "";
  app.removeAttribute("aria-busy");
  app.innerHTML = shell(`
    <section class="member-hero">
      <p class="member-eyebrow">ご家族用</p>
      <h1>${escapeHtml(data.member?.fullName || session.member?.fullName || "ご家族")}さん</h1>
      <p>${escapeHtml(formatDate(data.serviceDate))}の送迎予定です。</p>
    </section>
    <section class="member-card">
      <div class="member-card-body">
        <div class="member-field">
          <label for="member-service-date">確認する日</label>
          <div class="member-date-picker">
            <input class="member-date-control" id="member-service-date" type="date" lang="ja-JP" value="${escapeHtml(data.serviceDate)}" aria-label="確認する送迎日">
            <div class="member-date-display" aria-hidden="true">
              <span>${escapeHtml(formatDate(data.serviceDate))}</span>
              <span class="member-date-icon"></span>
            </div>
          </div>
        </div>
      </div>
    </section>
    <div class="member-summary-grid" aria-label="送迎概要">
      <div class="member-summary"><span>対象患者</span><strong>${riders.length}名</strong></div>
      <div class="member-summary"><span>当日の送迎</span><strong>${stops.length ? stops.filter((stop) => stop.stopStatus !== "cancelled").length : schedules.length}件</strong></div>
      <div class="member-summary"><span>送迎予約</span><strong>${reservations.length}件</strong></div>
      <div class="member-summary"><span>変更依頼</span><strong>${changes.length}件</strong></div>
    </div>
    <section class="member-card">
      <header class="member-card-header">
        <div><h2>送迎予定・運行状況</h2><p>診療所で当日の便が生成されると、現在の状況が表示されます。</p></div>
      </header>
      <div class="member-card-body">
        ${riders.length ? `
          <div class="member-record-list">
            ${riders.filter((rider) => rider.canViewSchedule).map((rider) => {
              const riderStops = stopsByRider.get(rider.id) || [];
              const riderSchedules = schedules.filter((item) => item.riderId === rider.id);
              if (riderStops.length) {
                return riderStops.map(renderStopRecord).join("");
              }
              if (riderSchedules.length) {
                return riderSchedules.map(renderScheduleRecord).join("");
              }
              return `<article class="member-record"><div class="member-record-top"><h3>${escapeHtml(rider.fullName)}</h3><span class="member-status">予定なし</span></div><p class="member-record-meta">選択した日の定期送迎予定はありません。</p></article>`;
            }).join("")}
          </div>` : '<div class="member-empty"><strong>閲覧できる患者がいません</strong><p>患者との紐づけを診療所へご確認ください。</p></div>'}
      </div>
    </section>
    ${(reservations.length || riders.some((rider) => rider.canRequestChange))
      ? renderReservationSection(
          riders,
          data.serviceDate,
          reservations,
          reservationLocations
        )
      : ""}
    ${riders.some((rider) => rider.canRequestChange) ? renderChangeForm(riders, data.serviceDate) : ""}
    <section class="member-card">
      <header class="member-card-header">
        <div><h2>変更依頼の状況</h2><p>選択した送迎日の依頼だけを表示します。</p></div>
      </header>
      <div class="member-card-body">
        ${changes.length ? `
          <div class="member-record-list">
            ${changes.map((request) => `
              <article class="member-record">
                <div class="member-record-top">
                  <h3>${escapeHtml(requestTypeLabels[request.requestType] || request.requestType)}</h3>
                  <span class="member-status ${statusTone(request.requestStatus)}">${escapeHtml(requestStatusLabels[request.requestStatus] || request.requestStatus)}</span>
                </div>
                <p>${escapeHtml(changeSummary(request.requestedChanges))}</p>
                ${request.reviewNotes ? `<p class="member-record-meta">診療所から：${escapeHtml(request.reviewNotes)}</p>` : ""}
              </article>`).join("")}
          </div>` : '<div class="member-empty"><strong>変更依頼はありません</strong><p>欠席・時間変更などがある場合は、上のフォームから連絡できます。</p></div>'}
      </div>
    </section>
  `, session);

  document
    .getElementById("member-service-date")
    ?.addEventListener("change", (event) => {
      if (event.target.value) {
        renderHome(app, session, event.target.value);
      }
    });
  bindHomeActions(app, session, data.serviceDate, data);
}

function renderStopRecord(stop) {
  return `
    <article class="member-record">
      <div class="member-record-top">
        <h3>${escapeHtml(stop.riderName)}・${escapeHtml(serviceTypeLabels[stop.serviceType] || "送迎")}</h3>
        <span class="member-status ${statusTone(stop.stopStatus)}">${escapeHtml(stopStatusLabels[stop.stopStatus] || stop.stopStatus || "予定")}</span>
      </div>
      <p><strong>${escapeHtml(formatTime(stop.plannedPickupAt))}</strong> ${escapeHtml(stop.pickupLocationName)} → <strong>${escapeHtml(formatTime(stop.plannedDropoffAt))}</strong> ${escapeHtml(stop.dropoffLocationName)}</p>
      <p class="member-record-meta">便番号：${escapeHtml(stop.runCode || "準備中")}</p>
    </article>`;
}

function renderScheduleRecord(schedule) {
  return `
    <article class="member-record">
      <div class="member-record-top">
        <h3>${escapeHtml(schedule.riderName)}・${escapeHtml(serviceTypeLabels[schedule.serviceType] || "送迎")}</h3>
        <span class="member-status is-progress">定期予定</span>
      </div>
      <p><strong>${escapeHtml(formatTime(schedule.scheduledPickupTime))}</strong> ${escapeHtml(schedule.pickupLocationName)} → <strong>${escapeHtml(formatTime(schedule.scheduledDropoffTime))}</strong> ${escapeHtml(schedule.dropoffLocationName)}</p>
      <p class="member-record-meta">当日の配車確定前の予定です。</p>
    </article>`;
}

function renderThirtyMinuteTimeOptions() {
  const options = ['<option value="">選択してください</option>'];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 30]) {
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      options.push(`<option value="${value}">${value}</option>`);
    }
  }
  return options.join("");
}


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
                  ${reservation.cancelRequestReason ? `<p class="member-record-meta">取消依頼理由：${escapeHtml(reservation.cancelRequestReason)}</p>` : ""}
                  ${reservation.cancelReason ? `<p class="member-record-meta">取消確定理由：${escapeHtml(reservation.cancelReason)}</p>` : ""}
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

function renderChangeForm(riders, serviceDate) {
  const allowed = riders.filter((rider) => rider.canRequestChange);
  const past = isPastJstDate(serviceDate);
  return `
    <section class="member-card">
      <header class="member-card-header">
        <div><h2>欠席・変更を連絡</h2><p>送信後は診療所の確認待ちになります。</p></div>
      </header>
      <div class="member-card-body">
        ${past ? '<div class="member-notice is-warning">過去日の変更依頼は送信できません。</div>' : ""}
        <form id="member-change-form" novalidate>
          <div class="member-grid">
            <div class="member-field">
              <label for="change-rider">患者<span class="member-required">必須</span></label>
              <select id="change-rider" name="riderId" required ${past ? "disabled" : ""}>
                ${allowed.map((rider) => `<option value="${escapeHtml(rider.id)}">${escapeHtml(rider.fullName)}</option>`).join("")}
              </select>
            </div>
            <div class="member-field">
              <label for="change-type">依頼の種類<span class="member-required">必須</span></label>
              <select id="change-type" name="requestType" required ${past ? "disabled" : ""}>
                ${Object.entries(requestTypeLabels).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}
              </select>
            </div>
            <div class="member-field" data-change-field="direction">
              <label for="change-direction">対象便</label>
              <select id="change-direction" name="direction" ${past ? "disabled" : ""}>
                <option value="both">迎え・送り</option>
                <option value="pickup">迎えのみ</option>
                <option value="dropoff">送りのみ</option>
              </select>
            </div>
            <div class="member-field is-full" data-change-field="reason">
              <label for="change-reason">欠席理由<span class="member-required">必須</span></label>
              <input id="change-reason" name="reason" maxlength="1000" placeholder="例：体調不良のため" ${past ? "disabled" : ""}>
            </div>
            <div class="member-field" data-change-field="pickup-time" hidden>
              <label for="change-pickup-time">迎え希望時刻</label>
              <select id="change-pickup-time" name="requestedPickupTime" ${past ? "disabled" : ""}>${renderThirtyMinuteTimeOptions()}</select>
            </div>
            <div class="member-field" data-change-field="dropoff-time" hidden>
              <label for="change-dropoff-time">送り希望時刻</label>
              <select id="change-dropoff-time" name="requestedDropoffTime" ${past ? "disabled" : ""}>${renderThirtyMinuteTimeOptions()}</select>
            </div>
            <div class="member-field is-full">
              <label for="change-note">補足・その他の内容</label>
              <textarea id="change-note" name="note" maxlength="1000" placeholder="診療所へ伝える内容を入力してください" ${past ? "disabled" : ""}></textarea>
              <p class="member-hint">緊急時はこの画面だけに頼らず、診療所へ電話してください。</p>
            </div>
          </div>
          <div class="member-actions">
            <button type="submit" class="member-button is-wide" ${past ? "disabled" : ""}>変更依頼を送信</button>
          </div>
        </form>
      </div>
    </section>`;
}

function updateChangeFields(form) {
  const type = String(form.elements.requestType?.value || "");
  const direction = form.querySelector('[data-change-field="direction"]');
  const reason = form.querySelector('[data-change-field="reason"]');
  const pickup = form.querySelector('[data-change-field="pickup-time"]');
  const dropoff = form.querySelector('[data-change-field="dropoff-time"]');
  if (direction) direction.hidden = !["absence", "one_way"].includes(type);
  if (reason) reason.hidden = type !== "absence";
  if (pickup) pickup.hidden = type !== "time_change";
  if (dropoff) dropoff.hidden = type !== "time_change";
  if (form.elements.reason) {
    form.elements.reason.required = type === "absence";
  }
  if (type === "one_way" && form.elements.direction?.value === "both") {
    form.elements.direction.value = "pickup";
  }
}

function bindHomeActions(app, session, serviceDate, data) {
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
  if (!form) return;
  form.elements.requestType?.addEventListener("change", () =>
    updateChangeFields(form)
  );
  updateChangeFields(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (isPastJstDate(serviceDate)) {
      toast("過去日の変更依頼は送信できません。", true);
      return;
    }
    const values = Object.fromEntries(new FormData(form).entries());
    let requestedChanges;
    try {
      requestedChanges = buildChangePayload(values);
    } catch (error) {
      toast(error.message, true);
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, "送信中…");
    try {
      await api("/v1/change-requests", {
        method: "POST",
        token: session.token,
        body: {
          riderId: String(values.riderId || ""),
          serviceDate,
          requestType: String(values.requestType || ""),
          requestedChanges
        }
      });
      toast("変更依頼を送信しました。診療所の確認をお待ちください。");
      await renderHome(app, session, serviceDate);
    } catch (error) {
      toast(error.message, true);
    } finally {
      setBusy(button, false);
    }
  });
}

async function logoutMember(app, session) {
  try {
    await api("/v1/auth/logout", {
      method: "POST",
      token: session.token,
      body: {},
      idempotent: false
    });
  } catch {
    // 端末側のセッション破棄を優先する。
  }
  clearSession();
  const query = new URLSearchParams(window.location.search);
  if (query.get("demo") === "1" || !runtimeConfig.liffId) {
    renderDemoLogin(app);
  } else {
    await loginWithLine(app);
  }
}

function renderFatal(app, message) {
  app.className = "";
  app.removeAttribute("aria-busy");
  app.innerHTML = shell(`
    <section class="member-hero">
      <p class="member-eyebrow">確認が必要です</p>
      <h1>画面を開けませんでした</h1>
      <p>${escapeHtml(message || "通信状態を確認して、もう一度お試しください。")}</p>
    </section>
    <div class="member-actions">
      <button type="button" class="member-button is-wide" data-member-action="retry">もう一度確認する</button>
      ${runtimeConfig.environment === "demo" ? '<a class="member-button is-secondary is-wide" href="member.html?demo=1">デモログインへ戻る</a>' : ""}
    </div>
  `);
  app
    .querySelector('[data-member-action="retry"]')
    ?.addEventListener("click", () => bootstrap());
}

async function bootstrap() {
  const app = document.getElementById("member-app");
  if (!app) return;
  if (!app.dataset.memberEventsBound) {
    app.addEventListener("click", (event) => {
      if (event.target.closest('[data-member-action="line-login"]')) {
        loginWithLine(app);
      }
    });
    app.dataset.memberEventsBound = "true";
  }
  const session = loadSession();
  if (session) {
    await renderHome(app, session);
    return;
  }
  const query = new URLSearchParams(window.location.search);
  if (
    query.get("demo") === "1" ||
    (runtimeConfig.environment === "demo" && !runtimeConfig.liffId)
  ) {
    renderDemoLogin(app);
    return;
  }
  await loginWithLine(app);
}

if (typeof document !== "undefined") {
  bootstrap().catch((error) => {
    const app = document.getElementById("member-app");
    if (app) renderFatal(app, error.message);
  });
}
