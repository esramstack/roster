/** Toasts and dialogs (confirm + general purpose). */
import { byId, E } from "./dom";
import { icon } from "./icons";

type ToastKind = "info" | "success" | "error";

export function toast(message: string, kind: ToastKind = "info"): void {
  const host = byId("toastHost");
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = `<span class="toast-ico">${icon(kind === "success" ? "check" : kind === "error" ? "alert" : "info")}</span><span class="toast-msg">${E(message)}</span>`;
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild?.remove();
  requestAnimationFrame(() => el.classList.add("in"));
  window.setTimeout(() => {
    el.classList.remove("in");
    el.classList.add("out");
    window.setTimeout(() => el.remove(), 220);
  }, kind === "error" ? 5200 : 2800);
}

export interface DialogAction {
  label: string;
  value: string;
  kind?: "primary" | "ghost" | "danger" | "success";
  /** Action runs `validate` before closing. */
  validate?: boolean;
}

export interface DialogOptions {
  title: string;
  /** Trusted HTML body. */
  body?: string;
  tone?: "default" | "warn" | "danger" | "success";
  actions?: DialogAction[];
  wide?: boolean;
  /** Return an error message to keep the dialog open. */
  validate?: (root: HTMLElement, value: string) => string | null;
  onOpen?: (root: HTMLElement) => void;
}

let active: { resolve: (v: { value: string; root: HTMLElement } | null) => void; root: HTMLElement; lastFocus: Element | null } | null = null;

function close(result: { value: string; root: HTMLElement } | null): void {
  if (!active) return;
  const { resolve, lastFocus } = active;
  const host = byId("dialogHost");
  host.classList.remove("on");
  host.classList.add("closing");
  active = null;
  window.setTimeout(() => {
    if (active) return;
    host.classList.remove("closing");
    host.hidden = true;
    host.innerHTML = "";
  }, 160);
  resolve(result);
  if (lastFocus instanceof HTMLElement && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

/**
 * Opens a modal dialog. Resolves with the chosen action value and the dialog
 * root (so callers can read form fields), or null when dismissed.
 */
export function dialog(opts: DialogOptions): Promise<{ value: string; root: HTMLElement } | null> {
  if (active) close(null);
  const host = byId("dialogHost");
  const actions = opts.actions ?? [{ label: "OK", value: "ok", kind: "primary" }];
  const toneIcon = opts.tone === "warn" ? "warn" : opts.tone === "danger" ? "alert" : opts.tone === "success" ? "check" : "";
  host.hidden = false;
  host.innerHTML = `<div class="dialog-scrim" data-dismiss></div>
    <div class="dialog ${opts.wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
      <div class="dialog-head">
        ${toneIcon ? `<span class="dialog-tone tone-${opts.tone}">${icon(toneIcon)}</span>` : ""}
        <h2 id="dlgTitle">${E(opts.title)}</h2>
        <button type="button" class="icon-btn" data-dismiss aria-label="Close">${icon("close")}</button>
      </div>
      ${opts.body ? `<div class="dialog-body">${opts.body}</div>` : ""}
      <div class="dialog-error" role="alert" hidden></div>
      <div class="dialog-foot">
        ${actions.map((a) => `<button type="button" class="btn ${a.kind ?? "ghost"}" data-value="${E(a.value)}">${E(a.label)}</button>`).join("")}
      </div>
    </div>`;
  const root = host.querySelector<HTMLElement>(".dialog")!;
  return new Promise((resolve) => {
    active = { resolve, root, lastFocus: document.activeElement };
    requestAnimationFrame(() => host.classList.add("on"));
    // A double tap on the button that opened the dialog must not land on the scrim and dismiss it.
    const openedAt = Date.now();
    host.querySelector<HTMLElement>(".dialog-scrim")?.addEventListener("click", () => {
      if (Date.now() - openedAt > 450) close(null);
    });
    root.querySelector<HTMLElement>(".dialog-head [data-dismiss]")?.addEventListener("click", () => close(null));
    root.querySelectorAll<HTMLButtonElement>(".dialog-foot [data-value]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = btn.dataset.value || "";
        const action = actions.find((a) => a.value === value);
        if (action?.validate && opts.validate) {
          const err = opts.validate(root, value);
          const box = root.querySelector<HTMLElement>(".dialog-error")!;
          if (err) {
            box.textContent = err;
            box.hidden = false;
            return;
          }
          box.hidden = true;
        }
        close({ value, root });
      });
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(null);
      }
      if (event.key === "Tab") {
        const focusables = Array.from(root.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
        const primary = root.querySelector<HTMLButtonElement>(".dialog-foot .btn.primary, .dialog-foot .btn.success, .dialog-foot .btn.danger");
        if (primary) {
          event.preventDefault();
          primary.click();
        }
      }
    });
    opts.onOpen?.(root);
    const autofocus = root.querySelector<HTMLElement>("[autofocus]") || root.querySelector<HTMLElement>(".dialog-foot .btn.primary, .dialog-foot .btn.success, .dialog-foot .btn.danger") || root.querySelector<HTMLElement>(".dialog-foot .btn");
    autofocus?.focus();
  });
}

export async function confirmDialog(opts: {
  title: string;
  message?: string;
  body?: string;
  confirm?: string;
  cancel?: string;
  tone?: "default" | "warn" | "danger" | "success";
  kind?: "primary" | "danger" | "success";
}): Promise<boolean> {
  const result = await dialog({
    title: opts.title,
    tone: opts.tone ?? "default",
    body: opts.body ?? (opts.message ? `<p>${E(opts.message)}</p>` : ""),
    actions: [
      { label: opts.cancel ?? "Cancel", value: "cancel", kind: "ghost" },
      { label: opts.confirm ?? "Confirm", value: "ok", kind: opts.kind ?? "primary" },
    ],
  });
  return result?.value === "ok";
}

export function dialogValue(root: HTMLElement, name: string): string {
  const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`);
  return el ? el.value.trim() : "";
}

export function isDialogOpen(): boolean {
  return active !== null;
}

export function closeDialog(): void {
  close(null);
}
