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

if "PHASE3C_NOTIFICATION_MESSAGE_FIX_R1" not in s:
    s = s.replace(
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R5-20260920";',
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R5.1-20260920";\n'
        'const PHASE3C_NOTIFICATION_MESSAGE_FIX_R1 = true;'
    )

    old = '''function notificationTimeLabel(value) {
  if (!value) return "未定";
  const raw = String(value);
  const match = raw.match(/T(\\d{2}):(\\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  const timeMatch = raw.match(/^(\\d{2}):(\\d{2})/);
  if (timeMatch) return `${timeMatch[1]}:${timeMatch[2]}`;
  return "未定";
}'''
    new = '''function notificationTimeLabel(value) {
  if (!value) return "未定";

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  const raw = String(value);
  const timeMatch = raw.match(/^(\\d{2}):(\\d{2})/);
  if (timeMatch) {
    return `${timeMatch[1]}:${timeMatch[2]}`;
  }

  return "未定";
}

function notificationDepartureText(serviceType, riderName) {
  if (serviceType === "dropoff") {
    return `${riderName}さんの送り便が診療所を出発しました。`;
  }
  if (serviceType === "transfer") {
    return `${riderName}さんの施設間移送便が出発しました。`;
  }
  return `${riderName}さんのお迎えに向けて送迎車が出発しました。`;
}'''
    s = replace_once(s, old, new, "notification time formatter")

    old = '''  if (notificationType === "previous_day") {
    return [
      "【DPRO 診療所送迎予約】",
      `${riderName}さんの明日の送迎予定をご案内します。`,
      serviceDate ? `送迎日：${serviceDate}` : null,
      `乗車予定：${pickupTime}`,
      `降車予定：${dropoffTime}`,
      "変更・欠席がある場合は、ご家族用画面または診療所へご連絡ください。",
    ].filter(Boolean).join("\\\\n");
  }

  if (notificationType === "departure") {
    return [
      "【DPRO 診療所送迎予約】",
      `${riderName}さんのお迎えに向けて送迎車が出発しました。`,
      `乗車予定：${pickupTime}`,
    ].join("\\\\n");
  }

  if (notificationType === "boarding") {
    return [
      "【DPRO 診療所送迎予約】",
      `${riderName}さんの乗車を確認しました。`,
      `降車予定：${dropoffTime}`,
    ].join("\\\\n");
  }

  if (notificationType === "arrival") {
    return [
      "【DPRO 診療所送迎予約】",
      `${riderName}さんの到着を確認しました。`,
    ].join("\\\\n");
  }

  return [
    "【DPRO 診療所送迎予約】",
    `${riderName}さんの送迎状況が更新されました。`,
  ].join("\\\\n");'''
    new = '''  if (notificationType === "previous_day") {
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
      notificationDepartureText(
        context.run?.service_type,
        riderName
      ),
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
  ].join("\\n");'''
    s = replace_once(s, old, new, "notification message linebreaks")

    p.write_text(s, encoding="utf-8")

# =========================================================
# staff.js
# =========================================================
p = Path("staff.js")
s = p.read_text(encoding="utf-8")

if "PHASE3C_SERVICE_AWARE_EVENT_LABELS_R1" not in s:
    marker = '''const EVENT_LABELS = Object.freeze({
  confirm: "予定を確認",
  en_route: "お迎えへ出発",
  boarded: "乗車を記録",
  no_show: "不在を記録",
  arrived: "到着を記録",
  handed_over: "引渡しを記録",
  completed: "対応を完了",
  cancelled: "キャンセル"
});'''
    replacement = marker + '''

const PHASE3C_SERVICE_AWARE_EVENT_LABELS_R1 = true;

function eventLabelForService(eventType, serviceType) {
  if (eventType !== "en_route") {
    return EVENT_LABELS[eventType] || eventType;
  }
  if (serviceType === "dropoff") {
    return "送りへ出発";
  }
  if (serviceType === "transfer") {
    return "移送へ出発";
  }
  return "お迎えへ出発";
}'''
    s = replace_once(s, marker, replacement, "event label helper")

    s = replace_once(
        s,
        'stops.map(renderStopCard).join("")',
        'stops.map((stop) => renderStopCard(stop, run.serviceType)).join("")',
        "pass run service type to stop card"
    )

    s = replace_once(
        s,
        'function renderStopCard(stop) {',
        'function renderStopCard(stop, serviceType) {',
        "stop card signature"
    )

    s = replace_once(
        s,
        '${escapeHtml(EVENT_LABELS[action.eventType] || action.eventType)}',
        '${escapeHtml(eventLabelForService(action.eventType, serviceType))}',
        "service aware action button"
    )

    old = '''    const stop = state.runs
      .flatMap((run) => run.stops || [])
      .find((item) => item.id === button.dataset.stopId);
    const eventType = button.dataset.eventType;'''
    new = '''    const run = state.runs.find((item) =>
      (item.stops || []).some(
        (stop) => stop.id === button.dataset.stopId
      )
    );
    const stop = (run?.stops || [])
      .find((item) => item.id === button.dataset.stopId);
    const eventType = button.dataset.eventType;'''
    s = replace_once(s, old, new, "event dialog run context")

    old = '''    document.getElementById("event-dialog-title").textContent =
      EVENT_LABELS[eventType] || "状態を更新";'''
    new = '''    document.getElementById("event-dialog-title").textContent =
      eventLabelForService(
        eventType,
        run?.serviceType
      ) || "状態を更新";'''
    s = replace_once(s, old, new, "event dialog title")

    p.write_text(s, encoding="utf-8")

# =========================================================
# config.js
# =========================================================
p = Path("config.js")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'version: "CLINIC-SHUTTLE-V2.1-R5-20260920",',
    'version: "CLINIC-SHUTTLE-V2.1-R5.1-20260920",'
)
p.write_text(s, encoding="utf-8")

# =========================================================
# system-check.html
# =========================================================
p = Path("system-check.html")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'const CHECK_VERSION = "CLINIC-SHUTTLE-V2.1-R5-CHECK-20260920";',
    'const CHECK_VERSION = "CLINIC-SHUTTLE-V2.1-R5.1-CHECK-20260920";'
)
p.write_text(s, encoding="utf-8")

# =========================================================
# build spec/status
# =========================================================
spec_path = Path("CLINIC_SHUTTLE_BUILD_SPEC_V2_1.json")
if spec_path.exists():
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    spec["current_stage"] = (
        "PHASE3C_NOTIFICATION_MESSAGE_FIX_PENDING_RUNTIME_REQA"
    )
    spec.setdefault("phase3", {})
    spec["phase3"]["notification_jst_time_format"] = True
    spec["phase3"]["notification_real_linebreaks"] = True
    spec["phase3"]["service_aware_departure_copy"] = True
    spec_path.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )

Path("PHASE3C_NOTIFICATION_MESSAGE_FIX_STATUS.txt").write_text(
    '''DPRO 診療所送迎予約 / PHASE 3-C NOTIFICATION MESSAGE FIX

QA FINDINGS:
1. 通知時刻がUTC文字列を直接切り出し、16:00便を07:00と表示した。
2. 通知本文の改行が実改行ではなく "\\\\n" 文字列になっていた。
3. 送り便でも現場ボタン/通知が「お迎えへ出発」と表示されていた。

FIX:
- 通知時刻を Asia/Tokyo で整形
- 通知本文を実改行に修正
- 迎え/送り/施設間移送で出発文言を切替
- Worker / Frontend version R5.1

RUNTIME RE-QA:
- 16:00送り便の別患者で出発→乗車→到着
- departure row: skipped / line_not_linked
- boarding row: 0件（設定OFF）
- arrival row: skipped / line_not_linked
- 通知本文の乗車予定が16:00
- 送り便文言が「送り便が診療所を出発」
''',
    encoding="utf-8"
)
