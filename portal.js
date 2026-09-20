(() => {
  "use strict";

  const config = window.DPRO_SHUTTLE_CONFIG || {};
  const query = new URLSearchParams(window.location.search);
  const isDemo = config.environment === "demo" || query.get("demo") === "1";
  const version = String(config.version || "SHUTTLE-9-FRONTEND-20260729");
  const facilityCode = String(config.facilityCode || "");

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = value;
  }

  function showToast(message) {
    const toast = byId("portal-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  }

  function pageUrl(page) {
    const url = new URL(page, window.location.href);
    if (isDemo) url.searchParams.set("demo", "1");
    return url.toString();
  }

  async function copyText(value) {
    if (!value) throw new Error("コピーする内容がありません。");
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("コピーできませんでした。");
  }

  document.querySelectorAll("[data-page]").forEach((link) => {
    const page = link.getAttribute("data-page");
    if (!page) return;
    link.href = pageUrl(page);
  });

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = byId(button.getAttribute("data-copy-target"));
      try {
        await copyText(target?.textContent?.trim() || "");
        showToast("コピーしました");
      } catch (error) {
        showToast(error?.message || "コピーできませんでした");
      }
    });
  });

  const demoSection = byId("demo-section");
  if (demoSection) demoSection.hidden = !isDemo;

  setText("environment-badge", isDemo ? "DEMO 環境" : "本番環境");
  setText("frontend-version", version);
  setText("footer-version", version);
  if (facilityCode) setText("facility-code", facilityCode);

  const facilityName =
    isDemo
      ? "DPRO 診療所送迎予約 デモ診療所"
      : "DPRO 診療所送迎予約";
  setText("facility-name", facilityName);
})();
