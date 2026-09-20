from pathlib import Path
import json

def require_in(text, needle, label):
    if needle not in text:
        raise SystemExit(f"PATCH ANCHOR NOT FOUND: {label}")

def replace_once(text, old, new, label):
    require_in(text, old, label)
    return text.replace(old, new, 1)

def patch_segment(text, start_marker, end_marker, transform, label):
    start = text.find(start_marker)
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f"PATCH SEGMENT NOT FOUND: {label}")
    return text[:start] + transform(text[start:end]) + text[end:]

# =========================================================
# member.js
# =========================================================
p = Path("member.js")
s = p.read_text(encoding="utf-8")

if "FINAL_BRUSHUP_R1" not in s:
    s = replace_once(
        s,
        "const PHASE3B_CANCEL_REASON_MEMBER_R1 = true;",
        "const PHASE3B_CANCEL_REASON_MEMBER_R1 = true;\nconst FINAL_BRUSHUP_R1 = true;",
        "member brushup marker",
    )

    s = replace_once(
        s,
        '''      ? renderReservationSection(
          riders,
          data.serviceDate,
          reservations,
          reservationLocations
        )''',
        '''      ? renderReservationSection(
          riders,
          data.serviceDate,
          reservations,
          reservationLocations,
          stops.length > 0 || schedules.length > 0
        )''',
        "reservation section call",
    )

    def patch_reservation(seg):
        seg = replace_once(
            seg,
            '''  reservationLocations
) {''',
            '''  reservationLocations,
  hasExistingTransport = false
) {''',
            "reservation function signature",
        )

        section_start = seg.find('    <section class="member-card">')
        body_start = seg.find('      <div class="member-card-body">', section_start)
        if section_start < 0 or body_start < 0:
            raise SystemExit("PATCH ANCHOR NOT FOUND: reservation card header")

        body_tag = '      <div class="member-card-body">'
        after_body = body_start + len(body_tag)
        summary = '''    <details class="member-card member-disclosure">
      <summary class="member-disclosure-summary">
        <span class="member-disclosure-copy">
          <strong>送迎予約</strong>
          <span>必要なときだけ開いて、新しい送迎を申し込みます。</span>
        </span>
        <span class="member-disclosure-action">入力する</span>
      </summary>
      <div class="member-card-body">'''
        seg = seg[:section_start] + summary + seg[after_body:]

        seg = replace_once(
            seg,
            '''      <div class="member-card-body">
        ${canCreate ? `''',
            '''      <div class="member-card-body">
        ${hasExistingTransport ? '<div class="member-notice is-warning">この日はすでに送迎予定があります。追加の送迎が必要な場合だけ申し込んでください。</div>' : ""}
        ${canCreate ? `''',
            "existing transport warning",
        )

        seg = replace_once(
            seg,
            '''      </div>
    </section>
    <section class="member-card">''',
            '''      </div>
    </details>
    <section class="member-card">''',
            "reservation details close",
        )
        return seg

    s = patch_segment(
        s,
        "function renderReservationSection(",
        "function syncReservationLocationOptions(",
        patch_reservation,
        "reservation section",
    )

    def patch_change(seg):
        section_start = seg.find('    <section class="member-card">')
        body_start = seg.find('      <div class="member-card-body">', section_start)
        if section_start < 0 or body_start < 0:
            raise SystemExit("PATCH ANCHOR NOT FOUND: change card header")

        body_tag = '      <div class="member-card-body">'
        after_body = body_start + len(body_tag)
        summary = '''    <details class="member-card member-disclosure">
      <summary class="member-disclosure-summary">
        <span class="member-disclosure-copy">
          <strong>欠席・変更を連絡</strong>
          <span>欠席・時間変更・片道利用などがあるときに開きます。</span>
        </span>
        <span class="member-disclosure-action">連絡する</span>
      </summary>
      <div class="member-card-body">'''
        seg = seg[:section_start] + summary + seg[after_body:]

        seg = replace_once(
            seg,
            '''      </div>
    </section>`;''',
            '''      </div>
    </details>`;''',
            "change details close",
        )
        return seg

    s = patch_segment(
        s,
        "function renderChangeForm(",
        "function updateChangeFields(",
        patch_change,
        "change form",
    )

p.write_text(s, encoding="utf-8")

# =========================================================
# member.css
# =========================================================
p = Path("member.css")
s = p.read_text(encoding="utf-8")

if "FINAL_BRUSHUP_R1" not in s:
    s += '''

/* FINAL_BRUSHUP_R1: compact family actions while keeping statuses visible. */
.member-disclosure {
  overflow: hidden;
}

.member-disclosure-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  padding: 18px 20px;
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.member-disclosure-summary::-webkit-details-marker {
  display: none;
}

.member-disclosure-copy {
  min-width: 0;
}

.member-disclosure-copy strong,
.member-disclosure-copy span {
  display: block;
}

.member-disclosure-copy strong {
  color: var(--member-navy);
  font-size: 21px;
  line-height: 1.4;
}

.member-disclosure-copy span {
  margin-top: 4px;
  color: var(--member-muted);
  font-size: 14px;
  font-weight: 650;
}

.member-disclosure-action {
  color: var(--member-teal-dark);
  font-size: 14px;
  font-weight: 850;
  white-space: nowrap;
}

.member-disclosure-summary::after {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid #a8cbc7;
  border-radius: 50%;
  color: var(--member-teal-dark);
  background: var(--member-teal-soft);
  content: "＋";
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.member-disclosure[open] > .member-disclosure-summary {
  border-bottom: 1px solid var(--member-line);
}

.member-disclosure[open] > .member-disclosure-summary::after {
  content: "−";
}

.member-disclosure .member-card-body > .member-notice:first-child {
  margin-top: 0;
}

@media (max-width: 560px) {
  .member-disclosure-summary {
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 16px;
  }

  .member-disclosure-action {
    display: none;
  }

  .member-disclosure-copy strong {
    font-size: 19px;
  }

  .member-disclosure-summary::after {
    grid-column: 2;
    grid-row: 1;
  }
}

/* FINAL_BRUSHUP_R1 */
'''

p.write_text(s, encoding="utf-8")

# =========================================================
# worker.js
# =========================================================
p = Path("worker.js")
s = p.read_text(encoding="utf-8")

if "FINAL_BRUSHUP_CONFLICT_MESSAGE_R1" not in s:
    s = replace_once(
        s,
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R5.1-20260920";',
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R6-20260920";\n'
        'const FINAL_BRUSHUP_CONFLICT_MESSAGE_R1 = true;',
        "worker version",
    )

    s = s.replace(
        'apiStage: "CLINIC-SHUTTLE-V2.1-R5",',
        'apiStage: "CLINIC-SHUTTLE-V2.1-R6",',
        1,
    )
    s = s.replace(
        'stage: "CLINIC-SHUTTLE-V2.1-R5",',
        'stage: "CLINIC-SHUTTLE-V2.1-R6",',
        1,
    )

    s = replace_once(
        s,
        '''  if (
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
  }''',
        '''  if (databaseCode === "23P01") {
    let publicMessage =
      "同じ時間帯に予定が重複しています。別の時間または担当を選択してください。";
    if (internalMessage.includes("車両")) {
      publicMessage =
        "この車両は同じ時間帯の別便に割り当て済みです。別の車両を選択してください。";
    } else if (internalMessage.includes("スタッフ")) {
      publicMessage =
        "このスタッフは同じ時間帯の別便に割り当て済みです。別の担当者を選択してください。";
    } else if (internalMessage.includes("患者")) {
      publicMessage =
        "この患者は同じ時間帯の別便に予定があります。時間または便を確認してください。";
    }
    return new AppError(
      409,
      "SCHEDULE_CONFLICT",
      publicMessage,
      internalMessage
    );
  }
  if (status === 409 || databaseCode === "23505") {
    return new AppError(
      409,
      "DUPLICATE_CONFLICT",
      "同じ内容がすでに登録されています。画面を更新してご確認ください。",
      internalMessage
    );
  }''',
        "specific conflict message mapping",
    )

p.write_text(s, encoding="utf-8")

# =========================================================
# config.js
# =========================================================
p = Path("config.js")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'version: "CLINIC-SHUTTLE-V2.1-R5.1-20260920",',
    'version: "CLINIC-SHUTTLE-V2.1-R6-20260920",',
)
p.write_text(s, encoding="utf-8")

# =========================================================
# system-check.html
# =========================================================
p = Path("system-check.html")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'const CHECK_VERSION = "CLINIC-SHUTTLE-V2.1-R5.1-CHECK-20260920";',
    'const CHECK_VERSION = "CLINIC-SHUTTLE-V2.1-R6-CHECK-20260920";',
)
p.write_text(s, encoding="utf-8")

# =========================================================
# build spec
# =========================================================
p = Path("CLINIC_SHUTTLE_BUILD_SPEC_V2_1.json")
spec = json.loads(p.read_text(encoding="utf-8"))
spec["generated_at"] = "2026-09-20T22:35:00+09:00"
spec["current_stage"] = "FINAL_BRUSHUP_APPLIED_PENDING_FINAL_4_OF_4"
spec["identity"]["frontend_version"] = "CLINIC-SHUTTLE-V2.1-R6-20260920"
spec["identity"]["worker_version"] = "CLINIC-SHUTTLE-V2.1-WORKER-R6-20260920"
spec.setdefault("phase3", {})
spec["phase3"].update({
    "runtime_notification_qa": True,
    "system_check_final": True,
    "cross_role_regression_qa": True,
    "final_brushup": True,
    "member_compact_disclosures": True,
    "existing_transport_warning": True,
    "specific_resource_conflict_messages": True,
    "qa_fixture_cleanup": True,
    "pending": ["final_4_of_4", "final_lock"],
})
p.write_text(
    json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)

# =========================================================
# final brushup status
# =========================================================
Path("FINAL_BRUSHUP_STATUS.txt").write_text(
    '''DPRO 診療所送迎予約 / FINAL BRUSHUP R1

STATUS:
- FINAL System Check: PASS
- Cross-role regression QA: PASS
- Notification runtime QA: PASS
- Final brushup: APPLIED
- Next: FINAL 4/4 -> FINAL LOCK

UX:
- Family portal "送迎予約" is collapsed by default and opens only when needed.
- Family portal "欠席・変更を連絡" is collapsed by default.
- Reservation status and change-request status stay visible.
- Existing shuttle activity on the selected date shows an additional-booking warning.
- Pickup/dropoff/transfer departure wording remains service-aware.

ERROR UX:
- Vehicle overlap identifies the vehicle conflict.
- Staff overlap identifies the staff conflict.
- Rider overlap identifies the rider conflict.
- Duplicate-record conflict stays separate.

QA CLEANUP:
- TEST-R05 soft-deleted; history retained.
- TEST-G02 soft-deleted; history retained.
- TEST-R05 regular schedule disabled.
- TEST-R05 location disabled.
- Open TEST-R05 reservation cancelled with QA cleanup reason.
- Historical completed/no-show run records retained.
- Temporary TEST staff/vehicle/QA overlap run: none active.
- Temporary DEMO-G01 <-> DEMO-R03 notification link: removed.

RELEASE:
- Frontend: CLINIC-SHUTTLE-V2.1-R6-20260920
- Worker: CLINIC-SHUTTLE-V2.1-WORKER-R6-20260920
- Database: CLINIC-SHUTTLE-V2.1-DB-R2-20260920
''',
    encoding="utf-8",
)
