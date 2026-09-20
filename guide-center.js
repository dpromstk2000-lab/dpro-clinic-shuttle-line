(() => {
  "use strict";

  const ROLE_KEY = "dpro_clinic_shuttle_tutorial_role_v1";
  const CATEGORY_ROLES = Object.freeze({
    "GC-START": ["all"],
    "GC-FAMILY": ["family"],
    "GC-OWNER": ["owner"],
    "GC-IPAD": ["ipad", "owner"],
    "GC-STAFF": ["staff"],
    "GC-SAFETY": ["all"]
  });

  const RELATED_STEPS = Object.freeze({
    "GC-START": ["F10-01"],
    "GC-FAMILY": ["F10-10"],
    "GC-OWNER": ["F10-02", "F10-03", "F10-04", "F10-05", "F10-06", "F10-07"],
    "GC-IPAD": ["F10-08"],
    "GC-STAFF": ["F10-09"],
    "GC-SAFETY": []
  });

  let content = null;
  let role = "all";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizedRole(saved) {
    const value = String(saved || "").toLowerCase();
    if (value.includes("family") || value.includes("guardian")) return "family";
    if (value.includes("driver") || value.includes("attendant")) return "staff";
    if (value.includes("admin") || value.includes("dispatcher") || value.includes("reception")) return "owner";
    return ["all", "family", "owner", "ipad", "staff"].includes(value) ? value : "all";
  }

  function allowed(categoryId) {
    const roles = CATEGORY_ROLES[categoryId] || ["all"];
    return role === "all" || roles.includes("all") || roles.includes(role);
  }

  function render() {
    const grid = document.getElementById("guide-grid");
    const status = document.getElementById("guide-status");
    const categories = (content?.guide_center?.categories || []).filter((item) => allowed(item.id));
    grid.innerHTML = categories.map((category) => {
      const steps = RELATED_STEPS[category.id] || [];
      return `<article class="card" data-category-id="${escapeHtml(category.id)}">
        <h2>${escapeHtml(category.title)}</h2>
        <ul>${(category.topics || []).map((topic) => `<li>${escapeHtml(topic)}</li>`).join("")}</ul>
        <div class="trace">CONTENT ID: ${escapeHtml(category.id)}${steps.length ? ` / First10: ${steps.map(escapeHtml).join(", ")}` : ""}</div>
      </article>`;
    }).join("");
    status.textContent = `表示中：${role === "all" ? "すべての役割" : document.querySelector(`[data-guide-role="${role}"]`)?.textContent || role} ／ ${categories.length}カテゴリ`;
  }

  function setRole(nextRole) {
    role = normalizedRole(nextRole);
    document.querySelectorAll("[data-guide-role]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.guideRole === role));
    });
    render();
  }

  async function init() {
    const status = document.getElementById("guide-status");
    try {
      const response = await fetch("CONTENT_PACKAGE.json", { method: "GET", cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      content = await response.json();
      if (!Array.isArray(content?.guide_center?.categories)) throw new Error("guide_center categories missing");
      let saved = null;
      try {
        saved = localStorage.getItem(ROLE_KEY);
      } catch {
        saved = null;
      }
      setRole(normalizedRole(saved));
      document.querySelectorAll("[data-guide-role]").forEach((button) => {
        button.addEventListener("click", () => setRole(button.dataset.guideRole));
      });
    } catch (error) {
      status.classList.add("error");
      status.textContent = "ガイド内容を読み込めませんでした。操作デモ入口へ戻ってから、もう一度お試しください。";
      document.getElementById("guide-grid").innerHTML = "";
      console.error("DPRO Guide Center:", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
