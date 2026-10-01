/**
 * Double-tap guard for critical actions (phase Start/End, discharge).
 *
 * While a key is cooling down, any button rendered with `data-guard="<key>"`
 * is disabled, so staff can see the control is not ready yet instead of a tap
 * being silently ignored. The buttons re-enable themselves when the cooldown ends.
 */
const busy = new Set<string>();

export function isGuarded(key: string): boolean {
  return busy.has(key);
}

/** Attributes to spread onto a guarded button. */
export function guardAttrs(key: string): string {
  return `data-guard="${key}"${busy.has(key) ? ` disabled aria-disabled="true"` : ""}`;
}

function release(key: string): void {
  busy.delete(key);
  document.querySelectorAll<HTMLButtonElement>(`[data-guard="${CSS.escape(key)}"]`).forEach((btn) => {
    if (btn.dataset.lock === "1") return; // disabled for another reason (e.g. no patient)
    btn.disabled = false;
    btn.removeAttribute("aria-disabled");
  });
}

export async function once(key: string, fn: () => Promise<void>, cooldownMs = 700): Promise<void> {
  if (busy.has(key)) return;
  busy.add(key);
  try {
    await fn();
  } finally {
    window.setTimeout(() => release(key), cooldownMs);
  }
}
