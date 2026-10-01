/** Procedure Rooms — separate from OT rooms: availability, current patient, timer, and a real queue. */
import { guardAttrs } from "../ui/guard";
import type { Tone } from "../core/derive";
import { fmtDur, fmtTime, isoMs, type Span } from "../core/time";
import { procRoomKeys, prName, state } from "../state";
import type { ProcedureRoom } from "../types";
import { avatar, badge, emptyState, phaseTimer, timerText } from "../ui/components";
import { E, plural } from "../ui/dom";
import { icon } from "../ui/icons";

export function prSpan(room: ProcedureRoom): Span {
  return { startMs: isoMs(room.patient?.startedAt), endMs: isoMs(room.patient?.endedAt), approx: false };
}

export function prStatusMeta(room: ProcedureRoom): { label: string; tone: Tone } {
  if (room.status === "completed") return { label: "Awaiting turnover", tone: "info" };
  if (room.status === "occupied") return room.patient?.startedAt ? { label: "In procedure", tone: "active" } : { label: "Occupied", tone: "attention" };
  return { label: "Available", tone: "success" };
}

function roomActions(key: string, room: ProcedureRoom): string {
  const hasPatient = Boolean(room.patient?.name);
  if (room.status === "completed") {
    return `<button type="button" class="btn primary" onclick="void dsa.prTurnover('${key}')">${icon("check")} Turnover complete</button>`;
  }
  if (room.status === "occupied") {
    return room.patient.startedAt
      ? `<button type="button" class="btn dark" ${guardAttrs(`pr:${key}`)} onclick="void dsa.prComplete('${key}')">${icon("stop")} Complete procedure</button>`
      : `<button type="button" class="btn primary" ${guardAttrs(`pr:${key}`)} onclick="void dsa.prStart('${key}')">${icon("play")} Start procedure</button>`;
  }
  const next = room.queue?.[0];
  return `${next ? `<button type="button" class="btn primary" onclick="void dsa.queueCall('${key}',0)">${icon("arrowRight")} Call ${E(next.patient.name)}</button>` : ""}
    <button type="button" class="btn ${next ? "ghost" : "primary"}" onclick="void dsa.prAssign('${key}')">${icon("plus")} ${hasPatient ? "Edit patient" : "Assign patient"}</button>`;
}

function queueList(key: string, room: ProcedureRoom): string {
  const q = room.queue || [];
  if (!q.length) return emptyState({ icon: "queue", title: "Queue is empty", body: "Patients waiting for this room will line up here.", compact: true });
  return `<ol class="queue">${q
    .map((item, i) => {
      const added = isoMs(item.addedAt);
      return `<li class="q-item">
        <span class="q-pos num" aria-label="Position ${i + 1}">${i + 1}</span>
        <div class="q-main">
          <strong>${E(item.patient.name || "Unnamed patient")}</strong>
          <span class="muted small">${E(item.procedure || "Procedure not set")}${item.patient.contact ? ` · ${E(item.patient.contact)}` : ""}</span>
          ${item.notes ? `<span class="q-note">${E(item.notes)}</span>` : ""}
        </div>
        <div class="q-wait">${added !== null ? `<span class="k">Waiting</span>${timerText({ startMs: added, endMs: null, approx: false }, "dur")}<span class="muted small">since ${fmtTime(added)}</span>` : ""}</div>
        <div class="q-actions">
          ${room.status === "available" ? `<button type="button" class="btn ghost sm" onclick="void dsa.queueCall('${key}',${i})">Call in</button>` : ""}
          <button type="button" class="icon-btn" onclick="dsa.queueMove('${key}',${i},-1)" ${i === 0 ? "disabled" : ""} aria-label="Move up">${icon("arrowUp")}</button>
          <button type="button" class="icon-btn" onclick="dsa.queueMove('${key}',${i},1)" ${i === q.length - 1 ? "disabled" : ""} aria-label="Move down">${icon("arrowDown")}</button>
          <button type="button" class="icon-btn danger" onclick="void dsa.queueRemove('${key}',${i})" aria-label="Remove ${E(item.patient.name)} from queue">${icon("trash")}</button>
        </div>
      </li>`;
    })
    .join("")}</ol>`;
}

function roomCard(key: string, index: number): string {
  const room = state.PR[key];
  if (!room) return "";
  const meta = prStatusMeta(room);
  const span = prSpan(room);
  const p = room.patient;
  const focused = state.selectedProcRoom === key;
  return `<section class="pr-card status-${room.status}${focused ? " is-focused" : ""}" id="pr-card-${key}" aria-label="${E(prName(index))}">
    <header class="prc-head">
      <div><span class="prc-name">${E(prName(index))}</span>${badge(meta.label, meta.tone, { dot: true })}</div>
      ${room.status === "occupied" || room.status === "completed" ? `<button type="button" class="icon-btn" onclick="void dsa.prAssign('${key}')" aria-label="Edit patient details" title="Edit">${icon("edit")}</button>` : ""}
    </header>
    <div class="prc-current">
      ${
        p.name
          ? `<div class="prc-patient">
              <strong>${E(p.name)}</strong>
              <span class="muted small">${E(room.procedure || "Procedure not set")}${p.contact ? ` · ${E(p.contact)}` : ""}</span>
              <span class="prc-assignee">${room.assignee ? `${avatar(room.assignee)} ${E(room.assignee)}` : `<span class="muted small">No staff assigned</span>`}</span>
              ${room.notes ? `<p class="prc-notes">${E(room.notes)}</p>` : ""}
            </div>
            <div class="prc-timer">${room.status === "available" ? "" : span.startMs !== null ? phaseTimer(span, { size: "lg" }) : `<div class="ptimer is-idle"><span class="ptimer-label">Not started</span></div>`}</div>`
          : `<div class="prc-empty">${icon("door")}<span>Room is free</span></div>`
      }
    </div>
    <div class="prc-actions">${roomActions(key, room)}</div>
    <div class="prc-queue">
      <div class="prc-queue-head"><strong>Queue</strong><span class="muted small">${room.queue?.length ? plural(room.queue.length, "patient") : ""}</span><button type="button" class="btn ghost sm" onclick="void dsa.queueAdd('${key}')">${icon("plus")} Add to queue</button></div>
      ${queueList(key, room)}
    </div>
  </section>`;
}

function completedToday(): string {
  const done = state.cfg.completedProcedureRooms || [];
  if (!done.length) return "";
  return `<section class="panel flush"><header class="panel-head"><div class="panel-titles"><h2>Completed today</h2><p>${plural(done.length, "patient")}</p></div></header>
    <table class="table"><thead><tr><th>Patient</th><th>Room</th><th>Procedure</th><th>Staff</th><th>Time</th><th>Duration</th></tr></thead><tbody>
    ${done
      .slice()
      .reverse()
      .map((d) => {
        const s = isoMs(d.room.patient?.startedAt);
        const e = isoMs(d.room.patient?.endedAt);
        return `<tr><td><strong>${E(d.room.patient?.name || "—")}</strong></td><td>${E(d.roomName)}</td><td>${E(d.room.procedure || "—")}</td><td>${E(d.room.assignee || "—")}</td><td class="num">${s !== null ? `${fmtTime(s)} – ${fmtTime(e)}` : "—"}</td><td class="num">${s !== null && e !== null ? fmtDur(e - s) : "—"}</td></tr>`;
      })
      .join("")}
    </tbody></table></section>`;
}

export function renderProcedureRooms(): string {
  const keys = procRoomKeys();
  const counts = { available: 0, occupied: 0, completed: 0, queue: 0 };
  keys.forEach((k) => {
    const r = state.PR[k];
    if (!r) return;
    counts[r.status] += 1;
    counts.queue += r.queue?.length || 0;
  });
  return `<div class="page">
    <div class="page-head">
      <div><p class="eyebrow">Separate from OT rooms</p><h2 class="page-title">Procedure rooms</h2></div>
      <div class="legend">
        ${badge(`${counts.available} available`, "success", { dot: true })}
        ${badge(`${counts.occupied} occupied`, "active", { dot: true })}
        ${badge(`${counts.completed} awaiting turnover`, "info", { dot: true })}
        ${badge(`${counts.queue} in queue`, "neutral")}
      </div>
    </div>
    <div class="pr-grid">${keys.map((k, i) => roomCard(k, i + 1)).join("") || emptyState({ title: "No procedure rooms", body: "Add procedure rooms in Settings.", action: `<button class="btn primary" onclick="dsa.openSettings('procRooms')">Open settings</button>` })}</div>
    ${completedToday()}
  </div>`;
}
