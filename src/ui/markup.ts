/** Reusable HTML builders for authenticated UI (presentation only). */

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

export function sectionCard(opts: {
  title?: string;
  subtitle?: string;
  actions?: string;
  body: string;
  className?: string;
  id?: string;
}): string {
  const head =
    opts.title || opts.actions
      ? `<div class="section-card-head">
          <div class="section-card-titles">
            ${opts.title ? `<h2 class="section-card-title">${esc(opts.title)}</h2>` : ""}
            ${opts.subtitle ? `<p class="section-card-subtitle">${esc(opts.subtitle)}</p>` : ""}
          </div>
          ${opts.actions ? `<div class="section-card-actions">${opts.actions}</div>` : ""}
        </div>`
      : "";

  return `<section class="section-card ${esc(opts.className || "")}"${opts.id ? ` id="${esc(opts.id)}"` : ""}>
    ${head}
    <div class="section-card-body">${opts.body}</div>
  </section>`;
}

export function metricCard(opts: {
  value: string | number;
  label: string;
  hint?: string;
  onClick?: string;
  active?: boolean;
  className?: string;
}): string {
  const tag = opts.onClick ? "button" : "div";
  const click = opts.onClick ? ` onclick="${opts.onClick}"` : "";
  const type = opts.onClick ? ` type="button"` : "";
  return `<${tag} class="metric-card ${opts.onClick ? "click-stat" : ""} ${opts.active ? "on" : ""} ${esc(opts.className || "")}"${type}${click}>
    <div class="metric-card-value">${esc(opts.value)}</div>
    <div class="metric-card-label">${esc(opts.label)}</div>
    ${opts.hint ? `<div class="metric-card-hint">${esc(opts.hint)}</div>` : ""}
  </${tag}>`;
}

export function statusBadge(label: string, tone: "scheduled" | "active" | "done" | string = "scheduled"): string {
  return `<span class="pill ${esc(tone)}">${esc(label)}</span>`;
}

export function emptyState(title: string, body: string, actionHtml = ""): string {
  return `<div class="empty-state"><strong>${esc(title)}</strong><div>${esc(body)}</div>${actionHtml}</div>`;
}

export function toolbar(body: string, className = ""): string {
  return `<div class="toolbar-bar ${esc(className)}">${body}</div>`;
}

export function pageStack(parts: string[]): string {
  return `<div class="page-stack">${parts.filter(Boolean).join("")}</div>`;
}

export function subPanel(opts: { title?: string; body: string; className?: string }): string {
  return `<div class="sub-panel ${esc(opts.className || "")}">
    ${opts.title ? `<div class="sub-panel-title">${esc(opts.title)}</div>` : ""}
    <div class="sub-panel-body">${opts.body}</div>
  </div>`;
}
