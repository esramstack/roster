/** Settings — application administration with list/table management. */
import { staffAssignments } from "../core/derive";
import { caseKeys, procRoomKeys, prName, roomLead, roomName, state } from "../state";
import type { SettingsTab } from "../types";
import { avatar, badge, emptyState, field } from "../ui/components";
import { E, plural } from "../ui/dom";
import { icon } from "../ui/icons";

const TABS: Array<{ tab: SettingsTab; label: string; icon: string }> = [
  { tab: "staff", label: "Staff", icon: "users" },
  { tab: "rooms", label: "OT rooms", icon: "door" },
  { tab: "procRooms", label: "Procedure rooms", icon: "rooms" },
  { tab: "procedures", label: "Procedures", icon: "clipboard" },
  { tab: "checklist", label: "Pre-op checklist", icon: "check" },
  { tab: "clinic", label: "Clinic profile", icon: "flag" },
];

function section(title: string, sub: string, actions: string, body: string): string {
  return `<section class="panel settings-section">
    <header class="panel-head"><div class="panel-titles"><h2>${E(title)}</h2><p>${sub}</p></div><div class="panel-actions">${actions}</div></header>
    <div class="panel-body">${body}</div>
  </section>`;
}

function addRow(id: string, placeholder: string, onAdd: string, extra = ""): string {
  return `<form class="add-row" onsubmit="event.preventDefault(); ${onAdd}">
    <input id="${id}" placeholder="${E(placeholder)}" aria-label="${E(placeholder)}" autocomplete="off">${extra}
    <button type="submit" class="btn primary">${icon("plus")} Add</button>
  </form>`;
}

function resetBtn(type: string): string {
  return `<button type="button" class="btn ghost sm" onclick="void dsa.resetCfg('${type}')">${icon("refresh")} Reset to defaults</button>`;
}

function staffTab(): string {
  const map = staffAssignments();
  const rows = state.cfg.staff
    .map((name, i) => {
      const where = map.get(name) || [];
      const rooms = [...new Set(where.map((a) => `OT ${a.roomIndex}`))];
      return `<tr>
        <td class="t-name">${avatar(name)}<input class="cell-input" value="${E(name)}" aria-label="Staff name" onchange="void dsa.renameCfg('staff',${i},this.value)"></td>
        <td class="muted small">${rooms.length ? `Assigned today: ${rooms.join(", ")}` : "Not assigned today"}</td>
        <td class="t-act"><button type="button" class="icon-btn danger" onclick="void dsa.removeCfg('staff',${i})" aria-label="Remove ${E(name)}">${icon("trash")}</button></td>
      </tr>`;
    })
    .join("");
  return section(
    "Staff",
    `${plural(state.cfg.staff.length, "person", "people")} available for team assignment. Renaming updates today's assignments.`,
    resetBtn("staff"),
    `${addRow("newStaff", "Add staff member", "dsa.addCfg('staff','newStaff')")}
     ${rows ? `<table class="table"><tbody>${rows}</tbody></table>` : emptyState({ icon: "users", title: "No staff yet", compact: true })}`,
  );
}

function roomsTab(): string {
  const rows = caseKeys()
    .map((key, i) => {
      const n = i + 1;
      const occupied = Boolean(state.C[key]?.patient?.name);
      return `<tr>
        <td class="t-num">OT ${n}</td>
        <td><input class="cell-input" value="${E(roomName(n))}" aria-label="OT ${n} name" onchange="dsa.setRoomName(${i},this.value)"></td>
        <td><input class="cell-input" list="staffList" value="${E(roomLead(n))}" placeholder="Room lead" aria-label="OT ${n} lead" onchange="dsa.setRoomLead(${i},this.value)"></td>
        <td>${occupied ? badge("Occupied", "active", { dot: true }) : badge("Empty", "neutral", { dot: true })}</td>
      </tr>`;
    })
    .join("");
  return section(
    "OT rooms",
    `${plural(state.cc, "room")} in today's session. Removing the last room keeps its data; it returns if the room is added back.`,
    `<button type="button" class="btn ghost sm" onclick="void dsa.removeRoom()" ${state.cc <= 1 ? "disabled" : ""}>${icon("minus")} Remove OT ${state.cc}</button>
     <button type="button" class="btn primary sm" onclick="void dsa.addRoom()">${icon("plus")} Add room</button>`,
    `<table class="table"><thead><tr><th>#</th><th>Name</th><th>Lead</th><th>Today</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

function procRoomsTab(): string {
  const keys = procRoomKeys();
  const rows = keys
    .map((key, i) => {
      const room = state.PR[key];
      return `<tr>
        <td class="t-num">PR ${i + 1}</td>
        <td><input class="cell-input" value="${E(prName(i + 1))}" aria-label="Procedure room ${i + 1} name" onchange="void dsa.renameCfg('procRooms',${i},this.value)"></td>
        <td>${room?.status === "available" ? badge("Available", "success", { dot: true }) : room?.status === "occupied" ? badge("Occupied", "active", { dot: true }) : badge("Awaiting turnover", "info", { dot: true })}${room?.queue?.length ? ` <span class="muted small">${room.queue.length} queued</span>` : ""}</td>
      </tr>`;
    })
    .join("");
  return section(
    "Procedure rooms",
    "Rooms used for shorter procedures, with their own queue.",
    `<button type="button" class="btn ghost sm" onclick="void dsa.removeProcRoom()" ${keys.length <= 1 ? "disabled" : ""}>${icon("minus")} Remove last</button>
     <button type="button" class="btn primary sm" onclick="dsa.addProcRoom()">${icon("plus")} Add room</button>`,
    `<table class="table"><thead><tr><th>#</th><th>Name</th><th>Now</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

function proceduresTab(): string {
  const rows = state.cfg.procedures
    .map(
      (p, i) => `<tr>
        <td><input class="cell-input" value="${E(p)}" aria-label="Procedure name" onchange="void dsa.renameCfg('procedures',${i},this.value)"></td>
        <td class="t-act"><button type="button" class="icon-btn danger" onclick="void dsa.removeCfg('procedures',${i})" aria-label="Remove ${E(p)}">${icon("trash")}</button></td>
      </tr>`,
    )
    .join("");
  return section(
    "Procedures",
    "Procedure types offered on patient assessment and procedure-room forms.",
    resetBtn("procedures"),
    `${addRow("newProc", "Add procedure type", "dsa.addCfg('procedures','newProc')")}
     ${rows ? `<table class="table"><tbody>${rows}</tbody></table>` : emptyState({ title: "No procedures", compact: true })}`,
  );
}

function checklistTab(): string {
  const rows = state.cfg.checks
    .map(
      (c, i) => `<tr>
        <td class="t-num">${i + 1}</td>
        <td><input class="cell-input strong" value="${E(c.l)}" aria-label="Checklist label" onchange="dsa.editCheck(${i},'l',this.value)"></td>
        <td><input class="cell-input" value="${E(c.s)}" placeholder="Description" aria-label="Checklist description" onchange="dsa.editCheck(${i},'s',this.value)"></td>
        <td class="t-act">
          <button type="button" class="icon-btn" onclick="dsa.moveCheck(${i},-1)" ${i === 0 ? "disabled" : ""} aria-label="Move up">${icon("arrowUp")}</button>
          <button type="button" class="icon-btn" onclick="dsa.moveCheck(${i},1)" ${i === state.cfg.checks.length - 1 ? "disabled" : ""} aria-label="Move down">${icon("arrowDown")}</button>
          <button type="button" class="icon-btn danger" onclick="void dsa.removeCfg('checks',${i})" aria-label="Remove ${E(c.l)}">${icon("trash")}</button>
        </td>
      </tr>`,
    )
    .join("");
  return section(
    "Pre-op checklist",
    "Items confirmed on the Pre-Op step before a procedure starts.",
    resetBtn("checks"),
    `${addRow("newCheckLabel", "Checklist item", "dsa.addCheck()", `<input id="newCheckDesc" placeholder="Description (optional)" aria-label="Description">`)}
     ${rows ? `<table class="table"><thead><tr><th>#</th><th>Item</th><th>Description</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : emptyState({ title: "No checklist items", compact: true })}`,
  );
}

function clinicTab(): string {
  const c = state.cfg;
  return section(
    "Clinic profile",
    "Shown in the top bar and on records.",
    "",
    `<div class="grid g-3">
      ${field({ label: "Clinic name", id: "clinicName", control: `<input id="clinicName" value="${E(c.clinicName)}" onchange="dsa.setClinicField('clinicName',this.value)">` })}
      ${field({ label: "Phone", id: "clinicPhone", control: `<input id="clinicPhone" type="tel" value="${E(c.clinicPhone)}" onchange="dsa.setClinicField('clinicPhone',this.value)">` })}
      ${field({ label: "Email", id: "clinicEmail", control: `<input id="clinicEmail" type="email" value="${E(c.clinicEmail)}" onchange="dsa.setClinicField('clinicEmail',this.value)">` })}
    </div>`,
  );
}

export function renderSettings(): string {
  const body: Record<SettingsTab, () => string> = {
    staff: staffTab,
    rooms: roomsTab,
    procRooms: procRoomsTab,
    procedures: proceduresTab,
    checklist: checklistTab,
    clinic: clinicTab,
  };
  return `<div class="page settings">
    <nav class="settings-nav" aria-label="Settings sections">
      ${TABS.map((t) => `<button type="button" class="sn-item${state.cfgTab === t.tab ? " on" : ""}" onclick="dsa.openSettings('${t.tab}')" ${state.cfgTab === t.tab ? 'aria-current="page"' : ""}>${icon(t.icon)}<span>${t.label}</span></button>`).join("")}
    </nav>
    <div class="settings-body">${body[state.cfgTab]()}</div>
  </div>`;
}
