-- DPRO CLINIC_SHUTTLE
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
