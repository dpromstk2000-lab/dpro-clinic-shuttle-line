#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parent
EXPECTED_ANCESTOR = "e56ffc7059e4be725874b31893fd8b41e1dbff9d"
SYSTEM_CODE = "CLINIC_SHUTTLE"
PRODUCT_NAME = "DPRO 診療所送迎予約"
SCHEMA = "dpro_clinic_shuttle"
WORKER_NAME = "dpro-clinic-shuttle-line-api"
WORKER_URL = "https://dpro-clinic-shuttle-line-api.dpromstk2000.workers.dev"
PAGES_ROOT = "https://dpromstk2000-lab.github.io/dpro-clinic-shuttle-line/"
MASTER_SHA256 = "c5a441b43de71e5541568400c20d7c38a5932a1e11e0af40e3ab97fad0932b02"
FRONTEND_VERSION = "CLINIC-SHUTTLE-V2.1-R1-20260920"
WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R1-20260920"
DATABASE_VERSION = "CLINIC-SHUTTLE-V2.1-DB-R1-20260920"
DEMO_PREPARE_VERSION = "CLINIC-SHUTTLE-V2.1-DEMO-R1-20260920"

APP_TEXT_FILES = [
    "CONTENT_PACKAGE.json",
    "demo-guide.html",
    "guide-center.html",
    "guide-center.js",
    "index.html",
    "member.css",
    "member.html",
    "member.js",
    "owner-ipad.html",
    "owner.html",
    "portal.css",
    "portal.js",
    "preview-bootstrap.js",
    "shuttle.css",
    "shuttle.js",
    "staff.css",
    "staff.html",
    "staff.js",
    "system-check.html",
    "tutorial.css",
    "tutorial.js",
    "worker.js",
]

LEGACY_WORKFLOWS = [
    ".github/workflows/product-ready-r2-final-qa.yml",
    ".github/workflows/product-ready-r2-remediation.yml",
    ".github/workflows/step-dpro-systems-4-shuttle-operation-demo.yml",
]
LEGACY_MIGRATION = "migrations/20260825_welfare_shuttle_r2.sql"

def fail(message: str) -> None:
    raise SystemExit(message)

def read(path: str) -> str:
    p = ROOT / path
    if not p.exists():
        fail(f"required file missing: {path}")
    return p.read_text(encoding="utf-8")

def write(path: str, content: str) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8", newline="\n")

def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        fail(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)

def verify_lineage() -> None:
    try:
        subprocess.check_call(
            ["git", "merge-base", "--is-ancestor", EXPECTED_ANCESTOR, "HEAD"],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        fail(
            "Imported source lineage mismatch. "
            f"{EXPECTED_ANCESTOR} must be an ancestor of HEAD."
        )

def move_reference_assets() -> None:
    ref_root = ROOT / "reference"
    (ref_root / "workflows").mkdir(parents=True, exist_ok=True)
    (ref_root / "migrations").mkdir(parents=True, exist_ok=True)

    for source in LEGACY_WORKFLOWS:
        src = ROOT / source
        if src.exists():
            dst = ref_root / "workflows" / src.name
            if dst.exists():
                dst.unlink()
            shutil.move(str(src), str(dst))

    src_migration = ROOT / LEGACY_MIGRATION
    if src_migration.exists():
        dst = ref_root / "migrations" / src_migration.name
        if dst.exists():
            dst.unlink()
        shutil.move(str(src_migration), str(dst))

def apply_identity_replacements() -> None:
    replacements = [
        ("https://dpro-welfare-shuttle-line-api.dpromstk2000.workers.dev", WORKER_URL),
        ("https://dpromstk2000-lab.github.io/dpro-welfare-shuttle-line/", PAGES_ROOT),
        ("dpromstk2000-lab/dpro-welfare-shuttle-line", "dpromstk2000-lab/dpro-clinic-shuttle-line"),
        ("DPRO 福祉施設送迎 LINE", PRODUCT_NAME),
        ("DPRO 福祉施設送迎", PRODUCT_NAME),
        ("福祉施設送迎", "診療所送迎予約"),
        ("WELFARE_SHUTTLE", SYSTEM_CODE),
        ("WELFARE SHUTTLE", "CLINIC SHUTTLE"),
        ("DPRO Welfare Shuttle API", "DPRO Clinic Shuttle API"),
        ("DPRO Welfare Shuttle Database", "DPRO Clinic Shuttle Database"),
        ("dpro-welfare-shuttle-line-api", WORKER_NAME),
        ("dpro-welfare-shuttle-line", "dpro-clinic-shuttle-line"),
        ("dpro-welfare-shuttle-api", "dpro-clinic-shuttle-api"),
        ("dpro-welfare-shuttle", "dpro-clinic-shuttle"),
        ("dpro_welfare_shuttle_demo", "dpro_clinic_shuttle_demo"),
        ("dpro_welfare_shuttle", "dpro_clinic_shuttle"),
        ("welfare_shuttle", "clinic_shuttle"),
        ("Welfare Shuttle", "Clinic Shuttle"),
        ("ご家族・保護者", "患者・ご家族"),
        ("家族連絡画面", "患者・ご家族画面"),
        ("事業所", "診療所"),
        ("利用者", "患者"),
    ]

    for rel in APP_TEXT_FILES:
        p = ROOT / rel
        if not p.exists():
            continue
        s = p.read_text(encoding="utf-8")
        for old, new in replacements:
            s = s.replace(old, new)
        s = s.replace("https://dpro-shop.com/systems/shuttle", "https://dpro-shop.com/")
        s = s.replace('step="300"', 'step="1800"')
        p.write_text(s, encoding="utf-8", newline="\n")

def write_config() -> None:
    content = f'''window.DPRO_SHUTTLE_CONFIG = Object.freeze({{
  systemCode: "{SYSTEM_CODE}",
  productName: "{PRODUCT_NAME}",
  apiBaseUrl: "{WORKER_URL}",
  facilityCode: "dpro_clinic_shuttle_demo",
  environment: "demo",
  version: "{FRONTEND_VERSION}",
  databaseSchema: "{SCHEMA}",
  reservationSlotMinutes: 30,
  timezone: "Asia/Tokyo",
  sessionStorageKey: "dpro_clinic_shuttle_session_v1",
  memberSessionStorageKey: "dpro_clinic_shuttle_member_session_v1",
  liffId: "",
  requestTimeoutMs: 12000
}});

(() => {{
  "use strict";

  const currentPage = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  const tutorialHosts = new Set([
    "index.html",
    "owner.html",
    "owner-ipad.html",
    "staff.html",
    "member.html"
  ]);
  if (!tutorialHosts.has(currentPage)) return;
  if (document.querySelector('script[data-dpro-tutorial-loader]')) return;

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "tutorial.css";
  stylesheet.dataset.dproTutorialLoader = "style";
  document.head.appendChild(stylesheet);

  const script = document.createElement("script");
  script.src = "tutorial.js";
  script.defer = true;
  script.dataset.dproTutorialLoader = "script";
  document.head.appendChild(script);
}})();
'''
    write("config.js", content)

def write_wrangler() -> None:
    content = f'''// DPRO CLINIC_SHUTTLE / MASTER STANDARD V2.1
{{
  "$schema": "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/wrangler/config-schema.json",
  "name": "{WORKER_NAME}",
  "main": "worker.js",
  "compatibility_date": "2026-09-20",
  "workers_dev": true,
  "keep_vars": true,
  "vars": {{
    "ALLOWED_ORIGINS": "https://dpromstk2000-lab.github.io",
    "DPRO_SYSTEM_CODE": "{SYSTEM_CODE}",
    "SUPABASE_SCHEMA": "{SCHEMA}"
  }},
  "observability": {{
    "enabled": true
  }},
  "secrets": {{
    "required": [
      "SUPABASE_SECRET_KEY",
      "SESSION_SECRET"
    ]
  }}
}}
'''
    write("wrangler.jsonc", content)

def patch_worker() -> None:
    p = ROOT / "worker.js"
    s = p.read_text(encoding="utf-8")

    s = re.sub(
        r'const SERVICE_NAME = "[^"]+";',
        'const SERVICE_NAME = "DPRO Clinic Shuttle API";',
        s,
        count=1,
    )
    s = re.sub(
        r'const WORKER_VERSION = "[^"]+";',
        f'const WORKER_VERSION = "{WORKER_VERSION}";',
        s,
        count=1,
    )
    s = re.sub(
        r'const DATABASE_VERSION = "[^"]+";',
        f'const DATABASE_VERSION = "{DATABASE_VERSION}";',
        s,
        count=1,
    )
    s = re.sub(
        r'const DEMO_PREPARE_VERSION = "[^"]+";',
        f'const DEMO_PREPARE_VERSION = "{DEMO_PREPARE_VERSION}";',
        s,
        count=1,
    )

    if 'const SYSTEM_CODE = "CLINIC_SHUTTLE";' not in s:
        marker = f'const DATABASE_VERSION = "{DATABASE_VERSION}";'
        s = replace_once(
            s,
            marker,
            marker + f'\nconst SYSTEM_CODE = "{SYSTEM_CODE}";\nconst SUPABASE_SCHEMA = "{SCHEMA}";',
            "worker system/schema constants",
        )

    health_anchor = "service: SERVICE_NAME,\n              version: WORKER_VERSION,"
    if "systemCode: SYSTEM_CODE" not in s[:s.find('case "GET /v1/system/version":')]:
        s = replace_once(
            s,
            health_anchor,
            "service: SERVICE_NAME,\n              systemCode: SYSTEM_CODE,\n              version: WORKER_VERSION,\n              databaseSchema: SUPABASE_SCHEMA,",
            "worker health runtime truth",
        )

    version_start = s.find('case "GET /v1/system/version":')
    version_end = s.find('case "POST /v1/auth/admin":', version_start)
    version_block = s[version_start:version_end]
    if "databaseSchema: SUPABASE_SCHEMA" not in version_block:
        s = replace_once(
            s,
            "service: SERVICE_NAME,\n              workerVersion: WORKER_VERSION,",
            "service: SERVICE_NAME,\n              systemCode: SYSTEM_CODE,\n              workerVersion: WORKER_VERSION,\n              databaseSchema: SUPABASE_SCHEMA,",
            "worker version runtime truth",
        )

    header_anchor = '''  const headers = new Headers({
    apikey: serverKey,
    accept: "application/json",
  });
'''
    schema_headers = header_anchor + '''
  // DPRO system isolation: this product uses a dedicated PostgREST schema.
  headers.set("accept-profile", SUPABASE_SCHEMA);
  if (["POST", "PATCH", "PUT", "DELETE"].includes(String(method).toUpperCase())) {
    headers.set("content-profile", SUPABASE_SCHEMA);
  }
'''
    if 'headers.set("accept-profile", SUPABASE_SCHEMA);' not in s:
        s = replace_once(
            s,
            header_anchor,
            schema_headers,
            "Supabase schema headers",
        )

    if 'DPRO_SYSTEM_CODE_MISMATCH' not in s:
        anchor = '''function assertBaseConfiguration(env, options = {}) {
  const { requireSession = false } = options;
'''
        replacement = anchor + '''  if (
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
'''
        s = replace_once(s, anchor, replacement, "worker runtime identity guard")

    p.write_text(s, encoding="utf-8", newline="\n")

def patch_member_time_controls() -> None:
    p = ROOT / "member.js"
    if not p.exists():
        return
    s = p.read_text(encoding="utf-8")

    if "function renderThirtyMinuteTimeOptions" not in s:
        anchor = "function renderChangeForm(riders, serviceDate) {"
        helper = '''function renderThirtyMinuteTimeOptions() {
  const options = ['<option value="">選択してください</option>'];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of [0, 30]) {
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      options.push(`<option value="${value}">${value}</option>`);
    }
  }
  return options.join("");
}

'''
        s = replace_once(s, anchor, helper + anchor, "member 30-minute helper")

    s = s.replace(
        '<input id="change-pickup-time" name="requestedPickupTime" type="time" step="1800" ${past ? "disabled" : ""}>',
        '<select id="change-pickup-time" name="requestedPickupTime" ${past ? "disabled" : ""}>${renderThirtyMinuteTimeOptions()}</select>',
    )
    s = s.replace(
        '<input id="change-dropoff-time" name="requestedDropoffTime" type="time" step="1800" ${past ? "disabled" : ""}>',
        '<select id="change-dropoff-time" name="requestedDropoffTime" ${past ? "disabled" : ""}>${renderThirtyMinuteTimeOptions()}</select>',
    )
    p.write_text(s, encoding="utf-8", newline="\n")

def write_build_spec() -> None:
    jst = timezone(timedelta(hours=9))
    spec = {
        "schema_version": "DPRO_CLINIC_SHUTTLE_BUILD_SPEC_V2_1_R1",
        "generated_at": datetime.now(jst).isoformat(timespec="seconds"),
        "product_name": PRODUCT_NAME,
        "system_code": SYSTEM_CODE,
        "dev_code": "PD-20260919140524-2709EE",
        "master_standard": {
            "version": "DPRO MASTER STANDARD V2.1",
            "sha256": MASTER_SHA256,
        },
        "reference": {
            "system_code": "WELFARE_SHUTTLE",
            "repository": "dpromstk2000-lab/dpro-welfare-shuttle-line",
            "imported_source_sha": EXPECTED_ANCESTOR,
            "reuse_policy": "reuse_proven_components_without_unnecessary_reimplementation",
        },
        "identity": {
            "repository": "dpromstk2000-lab/dpro-clinic-shuttle-line",
            "pages_root": PAGES_ROOT,
            "worker_name": WORKER_NAME,
            "worker_url": WORKER_URL,
            "supabase_schema": SCHEMA,
            "demo_facility_code": "dpro_clinic_shuttle_demo",
            "frontend_version": FRONTEND_VERSION,
            "worker_version": WORKER_VERSION,
            "database_version": DATABASE_VERSION,
        },
        "product_boundary": {
            "included": [
                "WEB/LINE送迎予約",
                "電話受付による代理登録",
                "患者本人・家族台帳",
                "お迎え先登録",
                "送迎日・希望時間",
                "片道・往復・帰りのみ",
                "予約変更・取消",
                "予約一覧・運行スケジュール",
                "車両・ドライバー割当",
                "当日運行管理",
                "診療終了後の帰り便管理",
                "予約確定・変更通知",
                "権限別画面",
                "CONTACT HUB",
            ],
            "excluded": [
                "電子カルテ本体",
                "診療記録",
                "病名",
                "検査結果",
                "処方内容",
                "医療費請求",
                "レセプト",
                "医療判断",
            ],
        },
        "reservation_design": {
            "time_booking": True,
            "customer_slot_minutes": 30,
            "arbitrary_one_minute_customer_input": False,
            "past_datetime_booking": False,
            "trip_types": ["outbound_to_clinic", "round_trip", "return_only"],
            "change_cancel_semantics": "request_then_staff_confirmation_by_default",
            "final_summary_before_submit": True,
            "duplicate_guard": True,
            "capacity_guard": True,
            "resource_conflict_guard": ["vehicle", "driver"],
            "operational_actual_timestamps": "server_recorded_exact_timestamp",
        },
        "appointment_boundary": {
            "allowed": [
                "受診予定日",
                "受診予定時刻",
                "外部予約参照IDまたは受付メモ（診療内容を含まない）",
            ],
            "forbidden": ["病名", "検査結果", "処方", "詳細診療内容"],
            "driver_visibility": "transport_only",
        },
        "staff_vehicle_lifecycle": {
            "create_edit": True,
            "activate_suspend": True,
            "soft_delete": True,
            "preserve_history": True,
            "new_assignment_active_only": True,
            "in_use_suspend_guard": True,
        },
        "patient_search": {
            "empty_search_lists_all": False,
            "explicit_all_action_with_limit": True,
            "default_all_limit": 100,
            "search_progress_and_count": True,
        },
        "owner_settings": {
            "enabled": True,
            "desktop_layout": "left_index_right_panel",
            "boolean_controls": "switch",
            "save_state": ["unsaved", "saving", "saved", "failed"],
            "dpro_fixed_fields": [
                "system_code",
                "schema",
                "security_boundaries",
                "audit_rules",
            ],
        },
        "channels": {
            "base_model": "Website + Official LINE + DPRO",
            "supported_compositions": [
                "Website + Official LINE + DPRO",
                "Website + DPRO",
                "Official LINE + DPRO",
            ],
            "contact_sources": ["web", "line", "instagram", "phone_proxy"],
            "channel_failure_isolation": True,
        },
        "data_safety": {
            "medical_data_minimized": True,
            "status_history": True,
            "audit_log": True,
            "internal_note_separated_from_customer_copy": True,
            "secrets_in_browser": False,
            "demo_real_data_forbidden": True,
        },
        "delivery_sequence": [
            "SYSTEM_CODE separation",
            "dedicated DB schema",
            "Worker adaptation",
            "Owner/iPad/Staff/Patient-Family UI",
            "WEB/LINE/CONTACT integration",
            "System Check",
            "cross-role QA",
            "FACTORY FINAL 4/4",
            "FINAL LOCK and return ZIP",
        ],
        "current_stage": "SYSTEM_CODE_SEPARATION_COMPLETE_PENDING_GITHUB_RUN",
    }
    write(
        "CLINIC_SHUTTLE_BUILD_SPEC_V2_1.json",
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
    )

def write_status() -> None:
    content = (
        "DPRO 診療所送迎予約 / PHASE 1 STATUS\n\n"
        "MASTER: DPRO MASTER STANDARD V2.1\n"
        f"MASTER SHA256: {MASTER_SHA256}\n"
        f"SYSTEM CODE: {SYSTEM_CODE}\n"
        f"REFERENCE SOURCE: WELFARE_SHUTTLE @ {EXPECTED_ANCESTOR}\n\n"
        "PHASE 1:\n"
        "- Imported repository lineage verified\n"
        "- Runtime identity separated from WELFARE_SHUTTLE\n"
        "- Worker name/API URL separated\n"
        "- Demo facility/session storage separated\n"
        f"- Supabase custom schema fixed to {SCHEMA}\n"
        "- Legacy Welfare workflows moved out of .github/workflows\n"
        "- Legacy Welfare R2 migration moved to reference/migrations\n"
        "- UI terminology adapted to clinic/patient context\n"
        "- Inherited 5-minute time step removed; customer change-time selects use 30-minute options\n"
        "- MASTER V2.1 build specification generated\n\n"
        "NOT YET COMPLETE:\n"
        "- Dedicated CLINIC_SHUTTLE DB schema/tables/RPC migration\n"
        "- New WEB/LINE/phone reservation domain\n"
        "- Staff/vehicle soft-delete + in-use guards\n"
        "- Patient search empty-query guard + explicit limited all-list\n"
        "- Owner settings V2.1 surface\n"
        "- CONTACT HUB\n"
        "- System Check V2.1 expansion\n"
        "- Cross-role QA / FINAL 4/4\n\n"
        "NEXT:\n"
        "Run PHASE 2 DB + reservation engine implementation.\n"
    )
    write("PHASE1_STATUS.txt", content)

def verify_result() -> None:
    runtime_files = [ROOT / x for x in APP_TEXT_FILES if (ROOT / x).exists()]
    forbidden = [
        "dpro-welfare-shuttle-line-api.dpromstk2000.workers.dev",
        "dpro_welfare_shuttle_demo",
        "DPRO 福祉施設送迎",
    ]
    for p in runtime_files:
        text = p.read_text(encoding="utf-8")
        for token in forbidden:
            if token in text:
                fail(f"runtime separation failed: {token!r} remains in {p.relative_to(ROOT)}")

    config = read("config.js")
    required_config = [
        'systemCode: "CLINIC_SHUTTLE"',
        f'apiBaseUrl: "{WORKER_URL}"',
        f'databaseSchema: "{SCHEMA}"',
        "reservationSlotMinutes: 30",
    ]
    for token in required_config:
        if token not in config:
            fail(f"config verification failed: {token}")

    worker = read("worker.js")
    required_worker = [
        f'const SYSTEM_CODE = "{SYSTEM_CODE}";',
        f'const SUPABASE_SCHEMA = "{SCHEMA}";',
        'headers.set("accept-profile", SUPABASE_SCHEMA);',
        'headers.set("content-profile", SUPABASE_SCHEMA);',
        "DPRO_SYSTEM_CODE_MISMATCH",
        "DPRO_SCHEMA_MISMATCH",
    ]
    for token in required_worker:
        if token not in worker:
            fail(f"worker verification failed: {token}")

    wrangler = read("wrangler.jsonc")
    if f'"name": "{WORKER_NAME}"' not in wrangler:
        fail("wrangler worker name was not separated")

    for old in LEGACY_WORKFLOWS:
        if (ROOT / old).exists():
            fail(f"legacy workflow is still active: {old}")
    if (ROOT / LEGACY_MIGRATION).exists():
        fail("legacy welfare migration is still in active migrations directory")

    for p in runtime_files:
        if 'step="300"' in p.read_text(encoding="utf-8"):
            fail(f"5-minute time step remains: {p.relative_to(ROOT)}")

def main() -> None:
    verify_lineage()
    move_reference_assets()
    apply_identity_replacements()
    write_config()
    write_wrangler()
    patch_worker()
    patch_member_time_controls()
    write_build_spec()
    write_status()
    verify_result()
    print("CLINIC_SHUTTLE PHASE 1: PASS")

if __name__ == "__main__":
    main()
