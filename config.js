window.DPRO_SHUTTLE_CONFIG = Object.freeze({
  apiBaseUrl: "https://dpro-welfare-shuttle-line-api.dpromstk2000.workers.dev",
  facilityCode: "dpro_welfare_shuttle_demo",
  environment: "demo",
  version: "SHUTTLE-9-FRONTEND-20260729",
  timezone: "Asia/Tokyo",
  sessionStorageKey: "dpro_shuttle_session_v1",
  memberSessionStorageKey: "dpro_shuttle_member_session_v1",
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
