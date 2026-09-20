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

if "PHASE3B_CANCEL_REASON_FIX_R1" not in s:
    s = s.replace(
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R4-20260920";',
        'const WORKER_VERSION = "CLINIC-SHUTTLE-V2.1-WORKER-R4.1-20260920";\n'
        'const PHASE3B_CANCEL_REASON_FIX_R1 = true;'
    )

    s = s.replace(
        'version,cancel_requested_at,cancelled_at,created_at,updated_at',
        'version,cancel_requested_at,cancel_request_reason,cancelled_at,cancel_reason,created_at,updated_at'
    )

    old = '''    version: row.version,
    cancelRequestedAt: row.cancel_requested_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    createdAt: row.created_at ?? null,'''
    new = '''    version: row.version,
    cancelRequestedAt: row.cancel_requested_at ?? null,
    cancelRequestReason: row.cancel_request_reason ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelReason: row.cancel_reason ?? null,
    createdAt: row.created_at ?? null,'''
    s = replace_once(s, old, new, "public reservation cancel fields")

    idx = s.index("function publicMemberReservation(row)")
    head, tail = s[:idx], s[idx:]
    tail = replace_once(
        tail,
        '''    version: row.version,
    cancelRequestedAt: row.cancel_requested_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    createdAt: row.created_at ?? null,''',
        '''    version: row.version,
    cancelRequestedAt: row.cancel_requested_at ?? null,
    cancelRequestReason: row.cancel_request_reason ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelReason: row.cancel_reason ?? null,
    createdAt: row.created_at ?? null,''',
        "public member reservation cancel fields"
    )
    s = head + tail

    old = '''  const patch = guardianRequest
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
      };'''
    new = '''  const patch = guardianRequest
    ? {
        reservation_status: "cancel_requested",
        cancel_requested_at: new Date().toISOString(),
        cancel_request_reason:
          reason || current.cancel_request_reason || null,
      }
    : {
        reservation_status: "cancelled",
        cancel_requested_at:
          current.cancel_requested_at || new Date().toISOString(),
        cancelled_at: new Date().toISOString(),
        cancelled_by_staff_id:
          isUuid(session.actorId) ? session.actorId : null,
        cancel_reason:
          reason ||
          current.cancel_reason ||
          current.cancel_request_reason ||
          null,
      };'''
    s = replace_once(s, old, new, "reservation cancel patch")

    old = '''  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: guardianRequest ? "request_reservation_cancel" : "cancel_reservation",
    entityType: "reservation",
    entityId: reservationId,
    requestId, request,
  });
  return successResponse({ reservation: publicReservationForSession(reservation, session) }, 200, corsOrigin, requestId);'''
    new = '''  await writeAuditLog(env, {
    facilityId: session.facilityId,
    actorType: session.actorType,
    actorId: session.actorId,
    action: guardianRequest
      ? "request_reservation_cancel"
      : "cancel_reservation",
    entityType: "reservation",
    entityId: reservationId,
    requestId,
    request,
    newData: {
      reservationStatus: reservation.reservation_status,
      cancelRequestReason:
        reservation.cancel_request_reason ?? null,
      cancelReason: reservation.cancel_reason ?? null,
    },
  });
  return successResponse(
    {
      reservation: publicReservationForSession(
        reservation,
        session
      ),
    },
    200,
    corsOrigin,
    requestId
  );'''
    s = replace_once(s, old, new, "reservation cancel audit")

    p.write_text(s, encoding="utf-8")

# =========================================================
# shuttle.js
# =========================================================
p = Path("shuttle.js")
s = p.read_text(encoding="utf-8")

if "PHASE3B_CANCEL_REASON_UI_R1" not in s:
    s = s.replace(
        '  const PHASE3_ADMIN_UI_R1 = true;',
        '  const PHASE3_ADMIN_UI_R1 = true;\n'
        '  const PHASE3B_CANCEL_REASON_UI_R1 = true;'
    )

    old = '''                    <td data-label="状態">${statusBadge(reservation.reservationStatus, labels.reservationStatus)}</td>
                    <td data-label="操作"><div class="row-actions">'''
    new = '''                    <td data-label="状態">
                      ${statusBadge(
                        reservation.reservationStatus,
                        labels.reservationStatus
                      )}
                      ${reservation.cancelRequestReason ? `
                        <div class="secondary-cell">
                          取消依頼理由：${escapeHtml(
                            reservation.cancelRequestReason
                          )}
                        </div>` : ""}
                      ${reservation.cancelReason ? `
                        <div class="secondary-cell">
                          取消確定理由：${escapeHtml(
                            reservation.cancelReason
                          )}
                        </div>` : ""}
                    </td>
                    <td data-label="操作"><div class="row-actions">'''
    s = replace_once(s, old, new, "admin cancel reason display")

    p.write_text(s, encoding="utf-8")

# =========================================================
# member.js
# =========================================================
p = Path("member.js")
s = p.read_text(encoding="utf-8")

if "PHASE3B_CANCEL_REASON_MEMBER_R1" not in s:
    s = s.replace(
        'const PHASE3B_MEMBER_UI_R1 = true;',
        'const PHASE3B_MEMBER_UI_R1 = true;\n'
        'const PHASE3B_CANCEL_REASON_MEMBER_R1 = true;'
    )

    old = '''                  ${reservation.customerNote ? `<p class="member-record-meta">連絡事項：${escapeHtml(reservation.customerNote)}</p>` : ""}
                  ${canCancel ? `'''
    new = '''                  ${reservation.customerNote ? `<p class="member-record-meta">連絡事項：${escapeHtml(reservation.customerNote)}</p>` : ""}
                  ${reservation.cancelRequestReason ? `<p class="member-record-meta">取消依頼理由：${escapeHtml(reservation.cancelRequestReason)}</p>` : ""}
                  ${reservation.cancelReason ? `<p class="member-record-meta">取消確定理由：${escapeHtml(reservation.cancelReason)}</p>` : ""}
                  ${canCancel ? `'''
    s = replace_once(s, old, new, "member cancel reason display")

    p.write_text(s, encoding="utf-8")

# =========================================================
# config.js
# =========================================================
p = Path("config.js")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'version: "CLINIC-SHUTTLE-V2.1-R4-20260920",',
    'version: "CLINIC-SHUTTLE-V2.1-R4.1-20260920",'
)
p.write_text(s, encoding="utf-8")

# =========================================================
# migration source sync
# =========================================================
migration = Path(
    "reference/migrations/"
    "20260920_clinic_shuttle_reservation_cancel_reason_r1.sql"
)
migration.parent.mkdir(parents=True, exist_ok=True)
migration.write_text(
    '''-- DPRO CLINIC_SHUTTLE
-- PHASE 3-B QA fix: preserve original customer/internal notes.

alter table dpro_clinic_shuttle.shuttle_reservations
  add column if not exists cancel_request_reason text,
  add column if not exists cancel_reason text;

comment on column
  dpro_clinic_shuttle.shuttle_reservations.cancel_request_reason
  is 'Reason submitted by rider/guardian when requesting cancellation.';

comment on column
  dpro_clinic_shuttle.shuttle_reservations.cancel_reason
  is 'Final cancellation reason recorded by staff/admin.';
''',
    encoding="utf-8"
)

# =========================================================
# status/spec
# =========================================================
spec_path = Path("CLINIC_SHUTTLE_BUILD_SPEC_V2_1.json")
if spec_path.exists():
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    spec["current_stage"] = (
        "PHASE3B_CANCEL_REASON_FIX_PENDING_RUNTIME_QA"
    )
    spec.setdefault("phase3", {})
    spec["phase3"]["cancel_reason_preservation"] = True
    spec["phase3"]["cancel_reason_admin_visibility"] = True
    spec_path.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )

Path("PHASE3B_CANCEL_REASON_FIX_STATUS.txt").write_text(
    '''DPRO 診療所送迎予約 / PHASE 3-B CANCEL REASON FIX

QA FINDING:
- 家族の取消理由が customer_note を上書きしていた。
- 管理側の取消理由も internal_note を上書きする設計だった。

FIX:
- cancel_request_reason を追加
- cancel_reason を追加
- customer_note / internal_note を保持
- 家族側と管理側で取消理由を表示
- 取消監査ログに取消理由を保持
- Worker / Frontend version R4.1

DB:
- Schema migration is already applied to the demo Supabase project.
- This package synchronizes migration source into GitHub.

NEXT:
- 管理側で取消依頼理由表示を確認
- 管理側で取消確定
- 家族側で取消確定表示を確認
''',
    encoding="utf-8"
)
