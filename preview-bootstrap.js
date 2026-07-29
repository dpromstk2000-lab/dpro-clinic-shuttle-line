(() => {
  "use strict";

  const query = new URLSearchParams(window.location.search);
  const previewMode =
    query.get("preview") === "1" ||
    query.get("embed_demo") === "1";

  if (!previewMode || query.get("mock") !== "1") {
    return;
  }

  const config = window.DPRO_SHUTTLE_CONFIG || {};
  const page = window.location.pathname.split("/").pop() || "index.html";
  const facility = {
    facilityCode: config.facilityCode || "dpro_welfare_shuttle_demo",
    facilityName: "DPRO 福祉施設送迎 デモ事業所",
    environment: "demo",
    timezone: "Asia/Tokyo"
  };

  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const mainStorageKey =
    config.sessionStorageKey || "dpro_shuttle_session_v1";

  if (page === "owner.html" || page === "owner-ipad.html") {
    sessionStorage.setItem(
      mainStorageKey,
      JSON.stringify({
        token: "mock-admin-preview-token",
        role: "admin",
        loginMode: "admin",
        facility
      })
    );

    const requestedSection = query.get("section");
    const allowedSections = new Set([
      "today",
      "riders",
      "families",
      "schedules",
      "resources",
      "changes"
    ]);

    if (requestedSection && allowedSections.has(requestedSection)) {
      window.addEventListener("load", () => {
        let attempts = 0;
        const activate = () => {
          const button = document.querySelector(
            `[data-action="show-section"][data-section-target="${requestedSection}"]`
          );
          if (button) {
            button.click();
            return true;
          }
          attempts += 1;
          return attempts > 60;
        };

        if (activate()) return;
        const timer = window.setInterval(() => {
          if (activate()) window.clearInterval(timer);
        }, 100);
      });
    }
  }

  if (page === "staff.html") {
    sessionStorage.setItem(
      `${mainStorageKey}_staff`,
      JSON.stringify({
        token: "mock-staff-preview-token",
        role: "driver",
        staff: {
          id: "55555555-5555-4555-8555-555555555555",
          staffCode: "DEMO-DRV",
          fullName: "デモ 運転員"
        },
        facility
      })
    );
  }

  if (page === "member.html") {
    const memberStorageKey =
      config.memberSessionStorageKey ||
      "dpro_shuttle_member_session_v1";

    sessionStorage.setItem(
      memberStorageKey,
      JSON.stringify({
        token: "mock-member-preview-token",
        member: {
          guardianCode: "DEMO-G01",
          fullName: "デモ ご家族"
        },
        facility,
        demo: true
      })
    );

    const mockHome = {
      ok: true,
      serviceDate: today,
      member: {
        guardianCode: "DEMO-G01",
        fullName: "デモ ご家族"
      },
      riders: [
        {
          id: "preview-rider-1",
          riderCode: "DEMO-R01",
          fullName: "デモ 利用者A",
          canViewSchedule: true,
          canRequestChange: true
        }
      ],
      schedules: [],
      stops: [
        {
          id: "preview-stop-1",
          riderId: "preview-rider-1",
          riderName: "デモ 利用者A",
          serviceType: "pickup",
          stopStatus: "en_route",
          plannedPickupAt: `${today}T08:20:00+09:00`,
          plannedDropoffAt: `${today}T09:00:00+09:00`,
          pickupLocationName: "ご自宅",
          dropoffLocationName: "DPRO 福祉施設",
          runCode: "朝便A"
        },
        {
          id: "preview-stop-2",
          riderId: "preview-rider-1",
          riderName: "デモ 利用者A",
          serviceType: "dropoff",
          stopStatus: "planned",
          plannedPickupAt: `${today}T16:10:00+09:00`,
          plannedDropoffAt: `${today}T16:45:00+09:00`,
          pickupLocationName: "DPRO 福祉施設",
          dropoffLocationName: "ご自宅",
          runCode: "夕便A"
        }
      ],
      changeRequests: [
        {
          id: "preview-change-1",
          requestType: "time_change",
          requestStatus: "approved",
          requestedChanges: {
            requestedDropoffTime: "16:45",
            note: "通院のため送り時刻を変更"
          },
          reviewNotes: "変更後の時刻で手配済みです。"
        }
      ]
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const source =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input?.url || "";
      const url = new URL(source, window.location.href);
      const method = String(init.method || "GET").toUpperCase();

      if (url.pathname.endsWith("/v1/member/home")) {
        const requestedDate = url.searchParams.get("serviceDate");
        const response = {
          ...mockHome,
          serviceDate: requestedDate || today,
          stops: mockHome.stops.map((stop) => ({
            ...stop,
            plannedPickupAt: `${requestedDate || today}${stop.plannedPickupAt.slice(10)}`,
            plannedDropoffAt: `${requestedDate || today}${stop.plannedDropoffAt.slice(10)}`
          }))
        };
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (
        url.pathname.endsWith("/v1/change-requests") &&
        method === "POST"
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            changeRequest: {
              id: `preview-${Date.now()}`,
              requestStatus: "pending"
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (
        url.pathname.endsWith("/v1/auth/logout") &&
        method === "POST"
      ) {
        return new Response(
          JSON.stringify({ ok: true, loggedOut: true }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      return originalFetch(input, init);
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const badge = document.createElement("div");
    badge.textContent = "営業用プレビュー・架空データ";
    badge.setAttribute("aria-label", "営業用プレビュー");
    Object.assign(badge.style, {
      position: "fixed",
      right: "12px",
      bottom: "12px",
      zIndex: "99999",
      padding: "7px 11px",
      borderRadius: "999px",
      color: "#075e55",
      background: "rgba(236,253,245,.96)",
      border: "1px solid #99d8cf",
      boxShadow: "0 8px 24px rgba(15,62,58,.14)",
      font: "700 12px/1.2 system-ui, sans-serif",
      pointerEvents: "none"
    });
    document.body.appendChild(badge);
  });
})();
