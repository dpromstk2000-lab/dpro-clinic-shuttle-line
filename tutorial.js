(() => {
  "use strict";

  const STORAGE_KEY = "dpro_clinic_shuttle_tutorial_v1";
  const ROLE_KEY = "dpro_clinic_shuttle_tutorial_role_v1";
  const SAFE_PAGES = new Set(["index.html", "owner.html", "owner-ipad.html", "staff.html", "member.html"]);
  const OWNER_SECTION_BY_STEP = Object.freeze({
    "F10-02": "today",
    "F10-03": "riders",
    "F10-04": "families",
    "F10-05": "schedules",
    "F10-06": "resources",
    "F10-07": "changes",
    "F10-08": "today"
  });

  const state = {
    content: null,
    steps: [],
    index: 0,
    open: false,
    target: null,
    drag: null,
    raf: 0
  };

  const pageName = () => (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  const safePage = () => SAFE_PAGES.has(pageName());
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  function readProgress() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!value || typeof value !== "object") return null;
      return {
        stepId: typeof value.stepId === "string" ? value.stepId : null,
        completed: value.completed === true
      };
    } catch {
      return null;
    }
  }

  function saveProgress(stepId, completed = false) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ stepId, completed }));
    } catch {
      // Storage-disabled browsers can still use the current Tutorial session.
    }
  }

  function rememberRole(step) {
    const role = String(step?.role || "all");
    if (!role || role === "all") return;
    try {
      localStorage.setItem(ROLE_KEY, role);
    } catch {
      // Role-aware Guide Center falls back to "all" when storage is unavailable.
    }
  }

  async function loadContent() {
    const response = await fetch("CONTENT_PACKAGE.json", { method: "GET", cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`Tutorial data unavailable (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data?.first10) || data.first10.length !== 10) {
      throw new Error("Tutorial data must contain exactly 10 First10 steps.");
    }
    return data;
  }

  function ensureUi() {
    if (document.getElementById("dpro-tutorial-launcher")) return;

    const launcher = document.createElement("button");
    launcher.id = "dpro-tutorial-launcher";
    launcher.className = "dpro-tutorial-launcher";
    launcher.type = "button";
    updateLauncherLabel(launcher);
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.addEventListener("click", () => {
      const progress = readProgress();
      start(progress?.completed ? 0 : progressIndex(progress));
    });

    const target = document.createElement("div");
    target.id = "dpro-tutorial-target";
    target.className = "dpro-tutorial-target";
    target.hidden = true;
    target.setAttribute("aria-hidden", "true");

    const card = document.createElement("section");
    card.id = "dpro-tutorial-card";
    card.className = "dpro-tutorial-card";
    card.hidden = true;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "false");
    card.setAttribute("aria-labelledby", "dpro-tutorial-title");
    card.innerHTML = `
      <div class="dpro-tutorial-handle" data-dpro-tutorial-drag-handle tabindex="0" aria-label="説明カードをドラッグして移動">
        <span class="dpro-tutorial-grip">カードを移動</span>
        <span class="dpro-tutorial-step" data-tutorial-step-count></span>
      </div>
      <div class="dpro-tutorial-body">
        <p class="dpro-tutorial-eyebrow">FIRST 10 / SAFE GUIDE</p>
        <h2 class="dpro-tutorial-title" id="dpro-tutorial-title"></h2>
        <p class="dpro-tutorial-copy" data-tutorial-copy></p>
        <div class="dpro-tutorial-fallback" data-tutorial-fallback hidden></div>
        <span class="dpro-tutorial-role" data-tutorial-role></span>
        <div class="dpro-tutorial-actions">
          <button type="button" data-tutorial-back>戻る</button>
          <button type="button" class="is-primary" data-tutorial-next>次へ</button>
          <button type="button" class="dpro-tutorial-skip" data-tutorial-skip>スキップ</button>
        </div>
        <div class="dpro-tutorial-subactions">
          <button type="button" data-tutorial-close>閉じる</button>
          <button type="button" data-tutorial-replay>最初から</button>
          <a href="guide-center.html" data-tutorial-guide>ガイドセンター</a>
        </div>
      </div>`;

    document.body.append(target, card, launcher);

    card.querySelector("[data-tutorial-back]").addEventListener("click", previous);
    card.querySelector("[data-tutorial-next]").addEventListener("click", next);
    card.querySelector("[data-tutorial-skip]").addEventListener("click", skip);
    card.querySelector("[data-tutorial-close]").addEventListener("click", close);
    card.querySelector("[data-tutorial-replay]").addEventListener("click", () => start(0));
    card.querySelector("[data-tutorial-guide]").addEventListener("click", () => close(false));

    const handle = card.querySelector("[data-dpro-tutorial-drag-handle]");
    handle.addEventListener("pointerdown", beginDrag);
    window.addEventListener("pointermove", moveDrag, { passive: false });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", scheduleTargetRefresh, { passive: true });
    window.addEventListener("scroll", scheduleTargetRefresh, { passive: true, capture: true });
    document.addEventListener("keydown", handleKeydown);
  }

  function updateLauncherLabel(launcher = document.getElementById("dpro-tutorial-launcher")) {
    if (!launcher) return;
    const progress = readProgress();
    const completed = progress?.completed === true;
    launcher.hidden = completed;
    launcher.setAttribute("aria-hidden", completed ? "true" : "false");
    launcher.textContent = progress && !completed ? "操作ガイド（続きから）" : "操作ガイド";
  }

  function progressIndex(progress) {
    if (!progress?.stepId) return 0;
    const found = state.steps.findIndex((step) => step.id === progress.stepId);
    return found >= 0 ? found : 0;
  }

  function handleKeydown(event) {
    if (event.key === "Escape" && state.open) {
      event.preventDefault();
      close();
    }
  }

  function beginDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const card = document.getElementById("dpro-tutorial-card");
    if (!card || card.hidden) return;
    const rect = card.getBoundingClientRect();
    state.drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    const card = document.getElementById("dpro-tutorial-card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const margin = 8;
    const left = clamp(event.clientX - state.drag.offsetX, margin, window.innerWidth - rect.width - margin);
    const top = clamp(event.clientY - state.drag.offsetY, margin, window.innerHeight - rect.height - margin);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.right = "auto";
    card.style.bottom = "auto";
    event.preventDefault();
  }

  function endDrag(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    state.drag = null;
  }

  function clampCard() {
    const card = document.getElementById("dpro-tutorial-card");
    if (!card || card.hidden) return;
    const rect = card.getBoundingClientRect();
    const margin = 8;
    const left = clamp(rect.left, margin, window.innerWidth - rect.width - margin);
    const top = clamp(rect.top, margin, window.innerHeight - rect.height - margin);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.right = "auto";
    card.style.bottom = "auto";
  }

  function findTarget(step) {
    for (const selector of step?.target_selector_candidates || []) {
      try {
        const element = document.querySelector(selector);
        if (element && isVisible(element)) return element;
      } catch {
        // Invalid selector in content data must degrade to fallback, not break Tutorial.
      }
    }
    return null;
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function updateTarget() {
    const box = document.getElementById("dpro-tutorial-target");
    if (!box || !state.open || !state.target || !document.contains(state.target) || !isVisible(state.target)) {
      if (box) box.hidden = true;
      return;
    }
    const rect = state.target.getBoundingClientRect();
    const pad = 5;
    const left = clamp(rect.left - pad, 3, window.innerWidth - 6);
    const top = clamp(rect.top - pad, 3, window.innerHeight - 6);
    const right = clamp(rect.right + pad, 3, window.innerWidth - 3);
    const bottom = clamp(rect.bottom + pad, 3, window.innerHeight - 3);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${Math.max(0, right - left)}px`;
    box.style.height = `${Math.max(0, bottom - top)}px`;
    box.hidden = false;
  }

  function scheduleTargetRefresh() {
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(() => {
      clampCard();
      updateTarget();
    });
  }

  function safeNavigateSection(step) {
    const section = OWNER_SECTION_BY_STEP[step?.id];
    if (!section) return;
    const nav = document.querySelector(`[data-section="${section}"]`);
    if (!nav || nav.getAttribute("aria-current") === "page") return;
    // Only role navigation buttons are allowed. Never invoke data-action or form controls.
    if (nav.matches("button[data-section]") && !nav.disabled) nav.click();
  }

  function routeFor(step) {
    const route = String(step?.page || "index.html");
    const url = new URL(route, window.location.href);
    url.searchParams.set("tutorial", "1");
    url.searchParams.set("tutorialStep", step.id);
    if (new URLSearchParams(window.location.search).get("demo") === "1") url.searchParams.set("demo", "1");
    return url;
  }

  function isCurrentStepPage(step) {
    const expected = String(step?.page || "index.html").toLowerCase();
    return pageName() === expected;
  }

  function renderStep() {
    const step = state.steps[state.index];
    if (!step) return finish();
    rememberRole(step);
    saveProgress(step.id, false);

    if (!isCurrentStepPage(step)) {
      window.location.assign(routeFor(step));
      return;
    }

    safeNavigateSection(step);
    window.setTimeout(() => {
      const card = document.getElementById("dpro-tutorial-card");
      const targetBox = document.getElementById("dpro-tutorial-target");
      if (!card) return;
      state.target = findTarget(step);
      card.hidden = false;
      targetBox.hidden = !state.target;
      card.querySelector("[data-tutorial-step-count]").textContent = `${state.index + 1} / ${state.steps.length}`;
      card.querySelector("#dpro-tutorial-title").textContent = step.title;
      card.querySelector("[data-tutorial-copy]").textContent = step.fallback_copy;
      card.querySelector("[data-tutorial-role]").textContent = `対象：${step.role}`;
      const fallback = card.querySelector("[data-tutorial-fallback]");
      fallback.hidden = Boolean(state.target);
      fallback.textContent = state.target
        ? ""
        : "対象箇所は現在の表示状態では見つかりません。説明だけで続行できます。ログインや対象画面の表示後は「操作ガイド」から続き・再生ができます。";
      card.querySelector("[data-tutorial-back]").disabled = state.index === 0;
      card.querySelector("[data-tutorial-next]").textContent = state.index === state.steps.length - 1 ? "完了" : "次へ";
      card.style.left = "18px";
      card.style.top = "18px";
      state.open = true;
      scheduleTargetRefresh();
      card.querySelector("[data-tutorial-next]").focus({ preventScroll: true });
    }, 80);
  }

  function start(index = 0) {
    if (!state.steps.length) return;
    const launcher = document.getElementById("dpro-tutorial-launcher");
    if (launcher) {
      launcher.hidden = false;
      launcher.setAttribute("aria-hidden", "false");
    }
    state.index = clamp(Number(index) || 0, 0, state.steps.length - 1);
    state.open = true;
    renderStep();
  }

  function next() {
    if (state.index >= state.steps.length - 1) return finish();
    state.index += 1;
    renderStep();
  }

  function previous() {
    if (state.index <= 0) return;
    state.index -= 1;
    renderStep();
  }

  function close(save = true) {
    const card = document.getElementById("dpro-tutorial-card");
    const target = document.getElementById("dpro-tutorial-target");
    if (card) card.hidden = true;
    if (target) target.hidden = true;
    state.open = false;
    state.target = null;
    if (save && state.steps[state.index]) saveProgress(state.steps[state.index].id, false);
    updateLauncherLabel();
    document.getElementById("dpro-tutorial-launcher")?.focus({ preventScroll: true });
  }

  function skip() {
    saveProgress(state.steps[state.index]?.id || state.steps[0]?.id, true);
    close(false);
    updateLauncherLabel();
  }

  function finish() {
    saveProgress(state.steps[state.steps.length - 1]?.id, true);
    close(false);
    updateLauncherLabel();
  }

  function autoResumeFromQuery() {
    const query = new URLSearchParams(window.location.search);
    const requested = query.get("tutorialStep");
    const replay = query.get("tutorial") === "replay";
    if (replay) return start(0);
    if (requested) {
      const found = state.steps.findIndex((step) => step.id === requested);
      if (found >= 0) return start(found);
    }
    if (query.get("tutorial") === "1") {
      const progress = readProgress();
      return start(progressIndex(progress));
    }
  }

  async function init() {
    if (!safePage()) return;
    try {
      state.content = await loadContent();
      state.steps = [...state.content.first10].sort((a, b) => Number(a.order) - Number(b.order));
      ensureUi();
      autoResumeFromQuery();
    } catch (error) {
      console.error("DPRO Tutorial:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
