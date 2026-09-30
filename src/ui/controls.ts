/** Elegant custom select + time pickers (presentation only; values stay HH:MM / strings). */

export type SelectChoice = { value: string; label: string };

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parse stored HH:MM (24h) into display parts. */
export function parseTime24(value: string): { hour12: number; minute: number; ampm: "am" | "pm" } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  const ampm: "am" | "pm" = hour >= 12 ? "pm" : "am";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return { hour12: hour, minute, ampm };
}

export function formatTimeDisplay(value: string): string {
  const parsed = parseTime24(value);
  if (!parsed) return "Select time";
  return `${pad2(parsed.hour12)}:${pad2(parsed.minute)} ${parsed.ampm.toUpperCase()}`;
}

export function toTime24(hour12: number, minute: number, ampm: "am" | "pm"): string {
  let hour = hour12 % 12;
  if (ampm === "pm") hour += 12;
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function mskSelect(opts: {
  value: string;
  choices: SelectChoice[];
  /** Pipe-separated action chunks, e.g. "setField|patient.gender;pickRosterTab|patient" */
  commit: string;
  placeholder?: string;
  className?: string;
  clearAfter?: boolean;
  inputId?: string;
}): string {
  const placeholder = opts.placeholder ?? "Select";
  const selected = opts.choices.find((c) => c.value === opts.value);
  const label = selected?.label || placeholder;
  const isEmpty = !opts.value;
  const hidden = opts.inputId
    ? `<input type="hidden" id="${esc(opts.inputId)}" value="${esc(opts.value)}" />`
    : "";

  return `${hidden}<div class="msk-select ${esc(opts.className || "")}" data-msk-select data-commit="${esc(opts.commit)}" data-value="${esc(opts.value)}" data-clear="${opts.clearAfter ? "1" : "0"}"${opts.inputId ? ` data-input-id="${esc(opts.inputId)}"` : ""}>
    <button type="button" class="msk-select__trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="msk-select__label${isEmpty ? " is-placeholder" : ""}">${esc(label)}</span>
      <span class="msk-select__chev" aria-hidden="true"></span>
    </button>
    <div class="msk-select__menu" role="listbox" hidden>
      ${opts.choices
        .map(
          (choice) =>
            `<button type="button" class="msk-select__opt${choice.value === opts.value ? " is-on" : ""}${!choice.value ? " is-empty" : ""}" role="option" data-value="${esc(choice.value)}" aria-selected="${choice.value === opts.value ? "true" : "false"}">${esc(choice.label || placeholder)}</button>`,
        )
        .join("")}
    </div>
  </div>`;
}

export function mskTime(opts: {
  value: string;
  commit: string;
  className?: string;
  title?: string;
}): string {
  const parsed = parseTime24(opts.value) || { hour12: 10, minute: 0, ampm: "am" as const };
  const display = opts.value ? formatTimeDisplay(opts.value) : "Select time";
  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  return `<div class="msk-time ${esc(opts.className || "")}" data-msk-time data-commit="${esc(opts.commit)}" data-value="${esc(opts.value)}" title="${esc(opts.title || "Time")}">
    <button type="button" class="msk-time__trigger" aria-haspopup="dialog" aria-expanded="false">
      <span class="msk-time__label${opts.value ? "" : " is-placeholder"}">${esc(display)}</span>
      <span class="msk-time__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>
      </span>
    </button>
    <div class="msk-time__panel" hidden>
      <div class="msk-time__head">
        <strong>Set time</strong>
        <button type="button" class="msk-time__clear" data-msk-time-clear>Clear</button>
      </div>
      <div class="msk-time__cols" data-h="${parsed.hour12}" data-m="${parsed.minute}" data-a="${parsed.ampm}">
        <div class="msk-time__col" data-col="h">
          ${hours.map((h) => `<button type="button" class="msk-time__cell${h === parsed.hour12 ? " is-on" : ""}" data-h="${h}">${pad2(h)}</button>`).join("")}
        </div>
        <div class="msk-time__col" data-col="m">
          ${minutes.map((m) => `<button type="button" class="msk-time__cell${m === parsed.minute ? " is-on" : ""}" data-m="${m}">${pad2(m)}</button>`).join("")}
        </div>
        <div class="msk-time__col" data-col="a">
          <button type="button" class="msk-time__cell${parsed.ampm === "am" ? " is-on" : ""}" data-a="am">AM</button>
          <button type="button" class="msk-time__cell${parsed.ampm === "pm" ? " is-on" : ""}" data-a="pm">PM</button>
        </div>
      </div>
      <div class="msk-time__foot">
        <button type="button" class="btn ghost compact" data-msk-time-cancel>Cancel</button>
        <button type="button" class="btn primary compact" data-msk-time-apply>Apply</button>
      </div>
    </div>
  </div>`;
}

function syncTimeLabel(root: HTMLElement, value: string): void {
  root.dataset.value = value;
  const label = root.querySelector(".msk-time__label");
  if (!label) return;
  label.textContent = value ? formatTimeDisplay(value) : "Select time";
  label.classList.toggle("is-placeholder", !value);
}

function syncSelectLabel(root: HTMLElement, value: string, display: string, placeholder: string): void {
  root.dataset.value = value;
  const label = root.querySelector(".msk-select__label");
  if (!label) return;
  label.textContent = display || placeholder;
  label.classList.toggle("is-placeholder", !value);
  root.querySelectorAll(".msk-select__opt").forEach((opt) => {
    const on = (opt as HTMLElement).dataset.value === value;
    opt.classList.toggle("is-on", on);
    opt.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function closeAllControls(except?: Element | null): void {
  document.querySelectorAll(".msk-select.is-open, .msk-time.is-open").forEach((node) => {
    if (except && node === except) return;
    node.classList.remove("is-open");
    const trigger = node.querySelector<HTMLButtonElement>(".msk-select__trigger, .msk-time__trigger");
    const menu = node.querySelector<HTMLElement>(".msk-select__menu, .msk-time__panel");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (menu) {
      menu.hidden = true;
      menu.classList.remove("is-flip");
      menu.style.left = "";
      menu.style.right = "";
    }
  });
}

function runCommit(spec: string, value: string): void {
  const dsa = window.dsa;
  if (!dsa || !spec) return;
  for (const chunk of spec.split(";")) {
    const parts = chunk.split("|").map((p) => p.trim()).filter(Boolean);
    const fn = parts[0];
    if (!fn) continue;
    if (fn === "setField" && parts[1]) dsa.setField(parts[1], value);
    else if (fn === "pickRosterTab" && parts[1]) dsa.pickRosterTab(parts[1] as "patient" | "preop" | "teams" | "postop");
    else if (fn === "setCaseField" && parts[1] && parts[2]) dsa.setCaseField(parts[1], parts[2], value);
    else if (fn === "setProcedureRoomField" && parts[1] && parts[2]) dsa.setProcedureRoomField(parts[1], parts[2], value);
    else if (fn === "changeRoomCount") void dsa.changeRoomCount(value);
    else if (fn === "addMember" && parts[1] && parts[2]) dsa.addMember(parts[1], parts[2], value);
    else if (fn === "addMemberForCase" && parts[1] && parts[2] && parts[3]) dsa.addMemberForCase(parts[1], parts[2], parts[3], value);
  }
}

function scrollOnCellIntoView(col: Element | null, on: Element | null): void {
  if (!col || !on) return;
  const top = (on as HTMLElement).offsetTop - (col as HTMLElement).clientHeight / 2 + (on as HTMLElement).clientHeight / 2;
  (col as HTMLElement).scrollTop = Math.max(0, top);
}

function repositionFloatingPanel(root: HTMLElement, panel: HTMLElement): void {
  panel.classList.remove("is-flip");
  panel.style.left = "";
  panel.style.right = "";
  const panelRect = panel.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  if (panelRect.bottom > window.innerHeight - 12) {
    panel.classList.add("is-flip");
  }
  if (panelRect.right > window.innerWidth - 8) {
    panel.style.left = "auto";
    panel.style.right = "0";
  } else if (rootRect.left + panelRect.width > window.innerWidth - 8) {
    panel.style.left = "auto";
    panel.style.right = "0";
  }
}

function openTimePanel(root: HTMLElement): void {
  closeAllControls(root);
  root.classList.add("is-open");
  const trigger = root.querySelector<HTMLButtonElement>(".msk-time__trigger");
  const panel = root.querySelector<HTMLElement>(".msk-time__panel");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
  if (panel) {
    panel.hidden = false;
    requestAnimationFrame(() => repositionFloatingPanel(root, panel));
  }
  const cols = root.querySelector(".msk-time__cols");
  if (!cols) return;
  requestAnimationFrame(() => {
    scrollOnCellIntoView(cols.querySelector('[data-col="h"]'), cols.querySelector('[data-col="h"] .is-on'));
    scrollOnCellIntoView(cols.querySelector('[data-col="m"]'), cols.querySelector('[data-col="m"] .is-on'));
  });
}

let controlsBound = false;

export function initMskControls(): void {
  if (controlsBound) return;
  controlsBound = true;

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    const selectOpt = target.closest<HTMLElement>(".msk-select__opt");
    if (selectOpt) {
      event.preventDefault();
      const root = selectOpt.closest<HTMLElement>("[data-msk-select]");
      if (!root) return;
      const value = selectOpt.dataset.value ?? "";
      const commit = root.dataset.commit || "";
      const clearAfter = root.dataset.clear === "1";
      const inputId = root.dataset.inputId;
      if (inputId) {
        const hidden = document.getElementById(inputId) as HTMLInputElement | null;
        if (hidden) hidden.value = value;
      }
      closeAllControls();
      if (!clearAfter) {
        syncSelectLabel(root, value, selectOpt.textContent || value, "Select");
      }
      if (value || !clearAfter) runCommit(commit, value);
      return;
    }

    const selectTrigger = target.closest<HTMLElement>(".msk-select__trigger");
    if (selectTrigger) {
      event.preventDefault();
      const root = selectTrigger.closest<HTMLElement>("[data-msk-select]");
      if (!root) return;
      const willOpen = !root.classList.contains("is-open");
      closeAllControls(willOpen ? root : null);
      if (willOpen) {
        root.classList.add("is-open");
        selectTrigger.setAttribute("aria-expanded", "true");
        const menu = root.querySelector<HTMLElement>(".msk-select__menu");
        if (menu) {
          menu.hidden = false;
          requestAnimationFrame(() => repositionFloatingPanel(root, menu));
        }
      }
      return;
    }

    const timeClear = target.closest<HTMLElement>("[data-msk-time-clear]");
    if (timeClear) {
      event.preventDefault();
      const root = timeClear.closest<HTMLElement>("[data-msk-time]");
      if (!root) return;
      closeAllControls();
      syncTimeLabel(root, "");
      runCommit(root.dataset.commit || "", "");
      return;
    }

    const timeCancel = target.closest<HTMLElement>("[data-msk-time-cancel]");
    if (timeCancel) {
      event.preventDefault();
      closeAllControls();
      return;
    }

    const timeApply = target.closest<HTMLElement>("[data-msk-time-apply]");
    if (timeApply) {
      event.preventDefault();
      const root = timeApply.closest<HTMLElement>("[data-msk-time]");
      const cols = root?.querySelector<HTMLElement>(".msk-time__cols");
      if (!root || !cols) return;
      const hour12 = Number(cols.dataset.h || 12);
      const minute = Number(cols.dataset.m || 0);
      const ampm = (cols.dataset.a === "pm" ? "pm" : "am") as "am" | "pm";
      const value = toTime24(hour12, minute, ampm);
      closeAllControls();
      syncTimeLabel(root, value);
      runCommit(root.dataset.commit || "", value);
      return;
    }

    const timeCell = target.closest<HTMLElement>(".msk-time__cell");
    if (timeCell) {
      event.preventDefault();
      const cols = timeCell.closest<HTMLElement>(".msk-time__cols");
      if (!cols) return;
      if (timeCell.dataset.h) {
        cols.dataset.h = timeCell.dataset.h;
        cols.querySelectorAll('[data-col="h"] .msk-time__cell').forEach((el) => el.classList.toggle("is-on", el === timeCell));
      }
      if (timeCell.dataset.m !== undefined && timeCell.hasAttribute("data-m")) {
        cols.dataset.m = timeCell.dataset.m;
        cols.querySelectorAll('[data-col="m"] .msk-time__cell').forEach((el) => el.classList.toggle("is-on", el === timeCell));
      }
      if (timeCell.dataset.a) {
        cols.dataset.a = timeCell.dataset.a;
        cols.querySelectorAll('[data-col="a"] .msk-time__cell').forEach((el) => el.classList.toggle("is-on", el === timeCell));
      }
      return;
    }

    const timeTrigger = target.closest<HTMLElement>(".msk-time__trigger");
    if (timeTrigger) {
      event.preventDefault();
      const root = timeTrigger.closest<HTMLElement>("[data-msk-time]");
      if (!root) return;
      if (root.classList.contains("is-open")) closeAllControls();
      else openTimePanel(root);
      return;
    }

    if (!target.closest("[data-msk-select], [data-msk-time]")) closeAllControls();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllControls();
  });
}
