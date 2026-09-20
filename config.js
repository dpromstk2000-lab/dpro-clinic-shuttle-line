window.DPRO_SHUTTLE_CONFIG = Object.freeze({
  systemCode: "CLINIC_SHUTTLE",
  productName: "DPRO 診療所送迎予約",
  apiBaseUrl: "https://dpro-clinic-shuttle-line-api.dpromstk2000.workers.dev",
  facilityCode: "dpro_clinic_shuttle_demo",
  environment: "demo",
  version: "CLINIC-SHUTTLE-V2.1-R4-20260920",
  databaseSchema: "dpro_clinic_shuttle",
  reservationSlotMinutes: 30,
  timezone: "Asia/Tokyo",
  sessionStorageKey: "dpro_clinic_shuttle_session_v1",
  memberSessionStorageKey: "dpro_clinic_shuttle_member_session_v1",
  liffId: "",
  requestTimeoutMs: 12000
});

(() => {
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
})();
