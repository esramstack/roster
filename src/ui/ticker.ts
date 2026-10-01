/**
 * One shared 1-second repaint loop for every running timer on screen.
 * It only rewrites text from stored timestamps (data-t0 = start ms), so all
 * views show the same logical time and nothing drifts or resets on re-render.
 */
import { fmtClock, fmtDur } from "../core/time";

let handle: number | null = null;
let onSecond: (() => void) | null = null;

export function paintTimers(now = Date.now()): void {
  document.querySelectorAll<HTMLElement>(".tmr[data-t0]").forEach((el) => {
    if (el.dataset.t1) return;
    const start = Number(el.dataset.t0);
    if (!Number.isFinite(start)) return;
    const ms = Math.max(0, now - start);
    const text = el.dataset.tf === "dur" ? fmtDur(ms) : fmtClock(ms);
    if (el.textContent !== text) el.textContent = text;
  });
}

function loop(): void {
  paintTimers();
  onSecond?.();
  // Align to the next wall-clock second so every counter flips together.
  handle = window.setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
}

export function startTicker(everySecond?: () => void): void {
  onSecond = everySecond ?? null;
  if (handle !== null) window.clearTimeout(handle);
  loop();
  // Background tabs throttle timers; repaint immediately when visible again.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) paintTimers();
  });
}
