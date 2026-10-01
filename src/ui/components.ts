/** Reusable presentational building blocks. Pure functions → HTML strings. */
import { fmtClock, fmtDur, fmtTime, type Span, spanMs, spanState } from "../core/time";
import type { CaseView, GraftStats, JourneyStep, Tone } from "../core/derive";
import { journey } from "../core/derive";
import { E, initials } from "./dom";
import { icon } from "./icons";

export function badge(label: string, tone: Tone = "neutral", opts: { dot?: boolean; live?: boolean; title?: string } = {}): string {
  return `<span class="badge tone-${tone}${opts.live ? " is-live" : ""}"${opts.title ? ` title="${E(opts.title)}"` : ""}>${opts.dot || opts.live ? '<i class="badge-dot" aria-hidden="true"></i>' : ""}${E(label)}</span>`;
}

const AVATAR_HUES = [28, 200, 160, 262, 340, 90, 18, 230];
export function avatar(name: string, size: "sm" | "md" = "sm", extra = ""): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length];
  return `<span class="avatar ${size} ${extra}" style="--av-h:${hue}" title="${E(name)}" aria-hidden="true">${E(initials(name))}</span>`;
}

export function avatarStack(names: string[], max = 4): string {
  if (!names.length) return `<span class="muted small">No team</span>`;
  const shown = names.slice(0, max).map((n) => avatar(n)).join("");
  const more = names.length > max ? `<span class="avatar sm more">+${names.length - max}</span>` : "";
  return `<span class="avatar-stack" title="${E(names.join(", "))}">${shown}${more}</span><span class="sr-only">${E(names.join(", "))}</span>`;
}

/**
 * A live-updating time value. The ticker repaints elements whose end is empty;
 * the value itself is always computed from the stored timestamps.
 */
export function timerText(span: Span, format: "clock" | "dur" = "clock", className = ""): string {
  if (span.startMs === null) return `<span class="tmr ${className}">--:--:--</span>`;
  const ms = spanMs(span);
  const text = format === "clock" ? fmtClock(ms) : fmtDur(ms);
  return `<span class="tmr ${className}" data-t0="${span.startMs}" data-t1="${span.endMs ?? ""}" data-tf="${format}">${text}</span>`;
}

const APPROX = `<abbr class="approx" title="Recorded before exact timestamps were stored; minute precision.">≈</abbr>`;

/** NOT STARTED / ● 01:22:17 / 09:18 – 10:42 · 1h 24m — one dominant state. */
export function phaseTimer(span: Span, opts: { size?: "sm" | "lg"; historical?: boolean } = {}): string {
  const st = spanState(span);
  const size = opts.size ?? "sm";
  if (st === "idle") return `<div class="ptimer ${size} is-idle"><span class="ptimer-label">Not started</span></div>`;
  if (st === "invalid") return `<div class="ptimer ${size} is-invalid"><span class="ptimer-label">${icon("warn")} Times inconsistent</span></div>`;
  if (st === "active") {
    if (opts.historical) {
      return `<div class="ptimer ${size} is-open"><span class="ptimer-label">Started ${fmtTime(span.startMs)}${span.approx ? APPROX : ""}</span><span class="ptimer-sub">No end recorded</span></div>`;
    }
    return `<div class="ptimer ${size} is-active"><span class="ptimer-label"><i class="live-dot" aria-hidden="true"></i>Live</span>${timerText(span, "clock", "ptimer-clock")}<span class="ptimer-sub">since ${fmtTime(span.startMs)}${span.approx ? APPROX : ""}</span></div>`;
  }
  return `<div class="ptimer ${size} is-done"><span class="ptimer-label">${icon("check")} ${fmtDur(spanMs(span))}</span><span class="ptimer-sub">${fmtTime(span.startMs)} – ${fmtTime(span.endMs)}${span.approx ? APPROX : ""}</span></div>`;
}

/** Compact inline duration for tables: "1h 24m", live clock, or "—". */
export function durationCell(span: Span, historical = false): string {
  const st = spanState(span);
  if (st === "idle") return `<span class="muted">—</span>`;
  if (st === "invalid") return `<span class="text-danger">Invalid</span>`;
  if (st === "active") return historical ? `<span class="muted">No end</span>` : `<span class="live-inline"><i class="live-dot"></i>${timerText(span, "clock")}</span>`;
  return `<span class="num">${fmtDur(spanMs(span))}</span>`;
}

export function journeyTrack(v: CaseView, opts: { compact?: boolean } = {}): string {
  const steps = journey(v);
  const label = (s: JourneyStep) => (s.state === "live" ? "in progress" : s.state === "current" ? "up next" : s.state === "done" ? "done" : "not started");
  return `<ol class="journey ${opts.compact ? "compact" : ""}" aria-label="Case progress">
    ${steps
      .map(
        (s) => `<li class="jstep is-${s.state}" title="${E(s.label)}: ${label(s)}"><span class="jdot" aria-hidden="true"></span>${opts.compact ? "" : `<span class="jlabel">${E(s.label)}</span>`}<span class="sr-only">${E(s.label)}: ${label(s)}</span></li>`,
      )
      .join("")}
  </ol>`;
}

export function graftBar(g: GraftStats): string {
  const base = Math.max(g.estimate, g.extracted, 1);
  const ext = Math.min(100, (g.extracted / base) * 100);
  const pla = Math.min(100, (g.placed / base) * 100);
  return `<div class="graft-bar" role="img" aria-label="${g.extracted} extracted, ${g.placed} placed${g.estimate ? ` of ${g.estimate} estimated` : ""}">
    <span class="gb-ext" style="width:${ext}%"></span><span class="gb-pla" style="width:${pla}%"></span>
  </div>`;
}

export function statTile(opts: { label: string; value: string | number; sub?: string; tone?: Tone; onClick?: string; icon?: string }): string {
  const tag = opts.onClick ? "button" : "div";
  return `<${tag} class="stat tone-${opts.tone ?? "neutral"}"${opts.onClick ? ` type="button" onclick="${opts.onClick}"` : ""}>
    <span class="stat-label">${opts.icon ? icon(opts.icon) : ""}${E(opts.label)}</span>
    <span class="stat-value num">${E(opts.value)}</span>
    ${opts.sub ? `<span class="stat-sub">${opts.sub}</span>` : ""}
  </${tag}>`;
}

export function emptyState(opts: { icon?: string; title: string; body?: string; action?: string; compact?: boolean }): string {
  return `<div class="empty ${opts.compact ? "compact" : ""}">
    ${opts.icon ? `<span class="empty-ico">${icon(opts.icon)}</span>` : ""}
    <strong>${E(opts.title)}</strong>
    ${opts.body ? `<p>${E(opts.body)}</p>` : ""}
    ${opts.action ?? ""}
  </div>`;
}

export function skeleton(lines = 3, className = ""): string {
  return `<div class="skeleton-group ${className}" aria-busy="true" aria-label="Loading">${Array.from({ length: lines }, (_, i) => `<div class="skeleton" style="width:${[92, 76, 84, 64, 88][i % 5]}%"></div>`).join("")}</div>`;
}

export function panel(opts: { title?: string; sub?: string; actions?: string; body: string; className?: string; id?: string; flush?: boolean }): string {
  const head = opts.title || opts.actions
    ? `<header class="panel-head"><div class="panel-titles">${opts.title ? `<h2>${E(opts.title)}</h2>` : ""}${opts.sub ? `<p>${opts.sub}</p>` : ""}</div>${opts.actions ? `<div class="panel-actions">${opts.actions}</div>` : ""}</header>`
    : "";
  return `<section class="panel ${opts.flush ? "flush" : ""} ${opts.className ?? ""}"${opts.id ? ` id="${E(opts.id)}"` : ""}>${head}<div class="panel-body">${opts.body}</div></section>`;
}

/** Labelled form field wrapper. */
export function field(opts: { label: string; control: string; hint?: string; error?: string; span?: 1 | 2 | 3 | 4; id?: string; required?: boolean }): string {
  return `<div class="field${opts.error ? " has-error" : ""}${opts.span ? ` span-${opts.span}` : ""}">
    <label${opts.id ? ` for="${E(opts.id)}"` : ""}>${E(opts.label)}${opts.required ? ' <span class="req" aria-hidden="true">*</span>' : ""}</label>
    ${opts.control}
    ${opts.error ? `<span class="field-error" role="alert">${E(opts.error)}</span>` : opts.hint ? `<span class="field-hint">${E(opts.hint)}</span>` : ""}
  </div>`;
}

export function segmented(opts: { name: string; value: string; options: Array<{ value: string; label: string }>; onPick: string; label: string }): string {
  return `<div class="segmented" role="radiogroup" aria-label="${E(opts.label)}">
    ${opts.options
      .map(
        (o) => `<button type="button" role="radio" aria-checked="${o.value === opts.value}" class="seg${o.value === opts.value ? " on" : ""}" data-value="${E(o.value)}" onclick="${opts.onPick}">${E(o.label)}</button>`,
      )
      .join("")}
  </div>`;
}
