import "./styles.css";
import { actions, handleAuthLost, showLogin, startApp } from "./actions";
import { getSessionUser } from "./api";
import { initSyncListeners, setSyncHooks } from "./core/sync";
import { flushPendingRefresh, renderChrome, softRefresh } from "./render";
import { state } from "./state";
import { isEditing, maybeId } from "./ui/dom";
import { icon } from "./ui/icons";
import { isDialogOpen, toast } from "./ui/overlay";
import { startTicker } from "./ui/ticker";

function bindShell(): void {
  window.dsa = actions;
  document.querySelectorAll<HTMLElement>("[data-ico]").forEach((el) => {
    el.innerHTML = icon(el.dataset.ico || "dot");
  });
  try {
    const saved = localStorage.getItem("msk_duty_remember_email");
    if (saved) {
      (maybeId<HTMLInputElement>("logEmail") as HTMLInputElement).value = saved;
      const remember = maybeId<HTMLInputElement>("rememberMe");
      if (remember) remember.checked = true;
    }
    if (localStorage.getItem("msk_sidebar_collapsed") === "1") maybeId("mainApp")?.classList.add("sidebar-collapsed");
  } catch {
    /* ignore */
  }

  maybeId("loginForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void actions.login();
  });
  maybeId("togglePass")?.addEventListener("click", () => {
    const input = maybeId<HTMLInputElement>("logPass")!;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    const btn = maybeId("togglePass")!;
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
  maybeId("nav")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    if (btn?.dataset.tab) actions.go(btn.dataset.tab as typeof state.currentTab);
  });
  maybeId("menuToggle")?.addEventListener("click", () => actions.toggleSidebar());
  maybeId("sidebarScrim")?.addEventListener("click", () => actions.closeSidebar());
  maybeId("collapseBtn")?.addEventListener("click", () => actions.collapseSidebar());
  maybeId("logoutBtn")?.addEventListener("click", () => void actions.logout());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") actions.closeSidebar();
    if (!state.curUser || isEditing() || isDialogOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      void actions.openSearch();
    } else if (state.currentTab === "roster" && (e.key === "[" || e.key === "]")) {
      e.preventDefault();
      actions.shiftRoom(e.key === "]" ? 1 : -1);
    }
  });
  // Deferred background refreshes run once the user stops editing.
  document.addEventListener("focusout", () => window.setTimeout(flushPendingRefresh, 50));
  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 1025px)").matches) actions.closeSidebar();
  });
}

async function boot(): Promise<void> {
  bindShell();
  setSyncHooks({
    onRemoteChange: softRefresh,
    onStatus: renderChrome,
    toast,
    onAuthLost: handleAuthLost,
  });
  initSyncListeners();
  // Timers repaint every second; time-derived alerts refresh every 30 s.
  let seconds = 0;
  startTicker(() => {
    seconds += 1;
    if (seconds % 30 === 0 && state.curUser && ["dash", "live", "roster"].includes(state.currentTab)) softRefresh();
  });
  const clock = maybeId("sidebarClock");
  if (clock) {
    const paint = () => (clock.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    paint();
    window.setInterval(paint, 15_000);
  }
  try {
    const user = await getSessionUser();
    if (user) await startApp(user);
    else showLogin();
  } catch (error) {
    console.error(error);
    showLogin(error instanceof Error ? error.message : "Couldn't restore your session.");
  }
}

boot().catch((error: unknown) => {
  const root = document.getElementById("view") || document.body;
  root.textContent = error instanceof Error ? error.message : "Failed to start the app.";
});

