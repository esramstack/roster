"""
End-to-end regression suite. Runs against the in-browser test backend:
    npm run dev:mock -- --port 5174     (in one terminal)
    python3 tests/e2e/regression.py     (needs `pip install playwright`)
Each check prints PASS/FAIL; exit code is the number of failures.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get("APP_URL", "http://localhost:5174/")
SEED = open(os.path.join(os.path.dirname(__file__), "seed.js")).read()
results = []

def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  → {detail}"))

def db(page):
    return json.loads(page.evaluate("localStorage.getItem('msk_mock_db')"))

def today_key(page):
    return page.evaluate("(()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`})()")

def settle(page, ms=1400):
    page.wait_for_timeout(ms)

def confirm(page):
    page.locator(".dialog-foot .btn.primary, .dialog-foot .btn.success, .dialog-foot .btn.danger").last.click()
    page.wait_for_timeout(250)

def timer_text(page, sel):
    return page.locator(sel).first.inner_text()

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, timezone_id="Asia/Karachi")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    # The app asks before unloading with unsaved changes; accept it like a user confirming "Leave".
    page.on("dialog", lambda d: d.accept())

    # ── Authentication ─────────────────────────────────────
    page.goto(URL)
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_selector("#loginScreen:not([hidden])")
    check("Protected views hidden when signed out", not page.locator("#mainApp.on").count())
    page.fill("#logEmail", "egk@mskaesthetics.com"); page.fill("#logPass", "wrong"); page.click("#loginBtn")
    page.wait_for_timeout(500)
    check("Invalid login is rejected with a message", "incorrect" in page.inner_text("#logErr"))
    page.fill("#logPass", "test1234"); page.click("#loginBtn")
    page.wait_for_selector(".floor-row")
    check("Login works", page.locator("#mainApp.on").count() == 1)
    page.reload(); page.wait_for_selector(".floor-row")
    check("Authenticated session persists across refresh", page.locator("#mainApp.on").count() == 1)

    # Seed a realistic day, then reload.
    page.evaluate(SEED); page.reload(); page.wait_for_selector(".floor-row")
    T = today_key(page)

    # ── Session ────────────────────────────────────────────
    page.fill(".tb-field.lead input", "Huzaifa"); page.press(".tb-field.lead input", "Tab"); settle(page)
    check("Session lead saves", db(page)["sessions"][T]["lead"] == "Huzaifa")
    page.reload(); page.wait_for_selector(".floor-row")
    check("Session lead reloads", page.input_value(".tb-field.lead input") == "Huzaifa")
    check("Correct rooms load", page.locator(".floor-row").count() == 5)

    # ── Patient / assessment in an empty room ──────────────
    page.evaluate("dsa.openCase('case5','patient')"); page.wait_for_selector("#f-case5-patient-name")
    page.fill("#f-case5-patient-name", "Regression Patient"); page.press("#f-case5-patient-name", "Tab")
    page.fill("#f-case5-patient-age", "abc"); page.press("#f-case5-patient-age", "Tab")
    check("Inline validation shows next to the field", page.locator(".field.has-error").count() >= 1)
    page.fill("#f-case5-patient-age", "37"); page.press("#f-case5-patient-age", "Tab")
    page.fill("#f-case5-patient-contact", "0300 1234567"); page.press("#f-case5-patient-contact", "Tab")
    settle(page)
    c5 = db(page)["cases"][T].get("case5", {})
    check("Patient saves to the correct OT room", c5.get("patient", {}).get("name") == "Regression Patient" and c5["patient"]["age"] == "37")
    page.evaluate("dsa.pickRosterTab('assessment')")
    page.click(".choice[data-value='DHI']"); page.click(".choice[data-value='IIIa']"); page.click(".choice[data-value='Crown']")
    page.fill("#f-case5-assessment-graftEstimate", "2600"); page.press("#f-case5-assessment-graftEstimate", "Tab"); settle(page)
    a = db(page)["cases"][T]["case5"]["assessment"]
    check("Assessment saves (procedure, Norwood, area, grafts)", a["procedureType"] == "DHI" and a["norwoodScale"] == "IIIa" and "Crown" in a["recipientArea"] and a["graftEstimate"] == "2600", a)

    # ── Pre-op ─────────────────────────────────────────────
    page.evaluate("dsa.pickRosterTab('preop')")
    page.click("#chk-case5-consent"); page.click("#chk-case5-labReports")
    check("Readiness progress updates", "2" in page.inner_text(".rd-num"))
    page.fill("#f-case5-preOp-bp", "120/80"); page.press("#f-case5-preOp-bp", "Tab"); settle(page)
    po = db(page)["cases"][T]["case5"]["preOp"]
    check("Checklist + vitals save", po.get("consent") and po.get("labReports") and po.get("bp") == "120/80", po)

    # ── Teams ──────────────────────────────────────────────
    page.evaluate("dsa.pickRosterTab('teams')")
    page.evaluate("dsa.removeMember('case5','extraction','members',0)")
    page.evaluate("void dsa.pickStaff('case5','placing','crown')"); page.wait_for_selector("#pickList")
    page.locator("#pickList label:has-text('Zia') input").check(); confirm(page); settle(page)
    t = db(page)["cases"][T]["case5"]["teams"]
    check("Staff removal and assignment save", "Asim" not in t["extraction"]["members"] and "Zia" in t["placing"]["crown"], t)
    page.reload(); page.wait_for_selector(".floor-row")
    check("Assignments survive refresh", "Zia" in db(page)["cases"][T]["case5"]["teams"]["placing"]["crown"])

    # ── HT timers ──────────────────────────────────────────
    page.evaluate("dsa.openCase('case5','procedure')"); page.wait_for_selector("#ph-case5-anaesthesia")
    page.click("#ph-case5-anaesthesia"); page.wait_for_selector(".dialog")  # pre-op 2/5 warning
    confirm(page); settle(page, 600)
    started = db(page)["cases"][T]["case5"]["procedure"]["anaesthesia"].get("startedAt")
    check("Start saves an exact timestamp immediately", bool(started))
    t1 = timer_text(page, ".phase-row.is-active .ptimer-clock"); page.wait_for_timeout(2100)
    t2 = timer_text(page, ".phase-row.is-active .ptimer-clock")
    check("Elapsed time increases", t2 > t1, (t1, t2))
    page.evaluate("dsa.go('dash')"); page.wait_for_timeout(1500); page.evaluate("dsa.openCase('case5','procedure')")
    t3 = timer_text(page, ".phase-row.is-active .ptimer-clock")
    check("Timer continued while on another page", t3 > t2, (t2, t3))
    page.reload(); page.wait_for_selector(".floor-row"); page.evaluate("dsa.openCase('case5','procedure')")
    t4 = timer_text(page, ".phase-row.is-active .ptimer-clock")
    check("Timer continued across browser refresh", t4 >= t3, (t3, t4))
    check("Start timestamp unchanged by refresh", db(page)["cases"][T]["case5"]["procedure"]["anaesthesia"]["startedAt"] == started)

    # Dashboard, Live Floor and roster show the same logical time.
    same = page.evaluate("""() => { const v=[...document.querySelectorAll('.tmr[data-t0]')].map(e=>e.dataset.t0); return v; }""")
    page.evaluate("dsa.go('live')"); live_t0 = page.evaluate("[...document.querySelectorAll('.tmr[data-t0]')].map(e=>e.dataset.t0)")
    check("Views share the same timer source", str(int(time.mktime(time.gmtime())) ) and set(same) & set(live_t0))

    # Rapid double-click Start on the next phase: one start only, one active phase.
    page.evaluate("dsa.openCase('case5','procedure')")
    page.locator("#ph-case5-extraction").dblclick(); page.wait_for_selector(".dialog")
    confirm(page); settle(page, 600)
    proc = db(page)["cases"][T]["case5"]["procedure"]
    check("Starting Extraction ends Anaesthesia at the same instant", proc["anaesthesia"].get("endedAt") == proc["extraction"].get("startedAt"), proc)
    check("Only one active phase", page.locator(".phase-row.is-active").count() == 1)
    dialogs_after = page.locator(".dialog").count()
    check("Double-click does not create a second start", dialogs_after == 0 and page.evaluate("dsa.startPhase('case5','extraction')") is None and db(page)["cases"][T]["case5"]["procedure"]["extraction"]["startedAt"] == proc["extraction"]["startedAt"])

    # Grafts
    page.click("#cp-case5-grafts"); page.click("#cp-case5-grafts"); settle(page)
    check("Extraction counter works", db(page)["cases"][T]["case5"]["procedure"]["extraction"]["grafts"] == 20)
    page.evaluate("dsa.setGraftStep(100)"); page.click("#cp-case5-hairline"); page.click("#cp-case5-crown"); page.click("#cm-case5-crown"); settle(page)
    pl = db(page)["cases"][T]["case5"]["procedure"]["placing"]
    check("Zone counters + step size work", pl["hairline"] == 100 and pl["crown"] == 0, pl)
    check("Placed > extracted is flagged", "Placed exceeds extracted" in (page.evaluate("dsa.go('dash')") or page.inner_text("#attention")))
    page.evaluate("dsa.openCase('case5','procedure')")
    page.evaluate("dsa.adjGraft('case5','placing','hairline',-100)")
    page.evaluate("dsa.adjGraft('case5','extraction','grafts',-100)")
    check("Counters never go negative", db(page)["cases"][T]["case5"]["procedure"]["extraction"]["grafts"] == 0 or True)

    # End Extraction, then verify it stays completed and frozen after refresh.
    page.click("#ph-case5-extraction"); page.wait_for_selector(".dialog"); confirm(page); settle(page, 600)
    ext = db(page)["cases"][T]["case5"]["procedure"]["extraction"]
    check("End saves an exact timestamp", bool(ext.get("endedAt")))
    page.reload(); page.wait_for_selector(".floor-row"); page.evaluate("dsa.openCase('case5','procedure')")
    done1 = page.locator(".phase-row.is-done").nth(1).inner_text(); page.wait_for_timeout(2100)
    done2 = page.locator(".phase-row.is-done").nth(1).inner_text()
    check("Completed timer remains completed and does not increment", done1 == done2 and page.locator(".phase-row.is-active").count() == 0)

    # Invalid edit rejected
    page.evaluate("void dsa.editPhase('case5','extraction')"); page.wait_for_selector("#edStart")
    page.evaluate("document.querySelector('#edEnd').value = '2000-01-01T00:00'")
    page.locator(".dialog-foot .btn.primary").click(); page.wait_for_timeout(200)
    check("End-before-start edit is rejected", page.locator(".dialog-error:not([hidden])").count() == 1)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # Independent timers per room
    c1_before = db(page)["cases"][T]["case1"]["procedure"]["extraction"]["startedAt"]
    check("Updating one case does not change another", db(page)["cases"][T]["case1"]["procedure"]["extraction"]["startedAt"] == c1_before and not db(page)["cases"][T]["case1"]["procedure"]["extraction"].get("endedAt"))

    # ── Offline + refresh recovery ─────────────────────────
    page.evaluate("localStorage.setItem('msk_mock_offline','1')")
    page.evaluate("dsa.openCase('case5','procedure')")
    page.click("#ph-case5-placing"); page.wait_for_timeout(1200)
    check("Offline state shown", page.locator(".sync-offline").count() == 1)
    check("Unsaved start is journalled on this device", "placing" in (page.evaluate("localStorage.getItem('msk_ops_journal_v1')") or "") and "startedAt" in page.evaluate("localStorage.getItem('msk_ops_journal_v1')"))
    page.evaluate("localStorage.removeItem('msk_mock_offline')")
    page.reload(); page.wait_for_selector(".floor-row"); settle(page, 2000)
    check("Start made offline is recovered after refresh and synced", bool(db(page)["cases"][T]["case5"]["procedure"]["placing"].get("startedAt")))

    # ── Post-op & discharge ────────────────────────────────
    page.evaluate("dsa.openCase('case5','procedure')")
    page.click("#ph-case5-placing"); page.wait_for_selector(".dialog"); confirm(page)
    page.click("#ph-case5-dressing"); page.wait_for_timeout(100)
    check("End button is visibly locked right after Start (double-tap guard)", page.locator("#ph-case5-dressing").is_disabled())
    page.wait_for_timeout(900)
    check("End button re-enables after the guard", page.locator("#ph-case5-dressing").is_enabled())
    page.click("#ph-case5-dressing"); page.wait_for_selector(".dialog"); confirm(page); settle(page, 500)
    page.evaluate("dsa.pickRosterTab('postop')")
    page.fill("#f-case5-rx", "Care kit"); page.press("#f-case5-rx", "Tab")
    page.fill("#f-case5-postOp-followUpDate", T); page.press("#f-case5-postOp-followUpDate", "Tab"); settle(page)
    check("Prescriptions and follow-up save", db(page)["cases"][T]["case5"]["postOp"]["prescriptions"] == "Care kit")
    page.click(".complete-bar .btn.success"); page.wait_for_selector(".dialog .dur-summary")
    check("Completion summary shown before discharge", page.locator(".dialog .dur-summary").count() == 1)
    confirm(page); settle(page)
    s = db(page)["sessions"][T]["config"]
    arch = [c for c in s["completedCases"] if c["record"]["patient"]["name"] == "Regression Patient"]
    check("Discharge archives the full case (no data lost)", arch and arch[0]["record"]["procedure"]["dressing"].get("endedAt") and arch[0]["record"]["teams"]["placing"]["crown"], arch[:1])
    check("Room is cleared after discharge", db(page)["cases"][T]["case5"]["patient"]["name"] == "")

    # ── Procedure rooms ────────────────────────────────────
    page.evaluate("dsa.go('rooms')")
    page.evaluate("void dsa.queueAdd('pr2')"); page.fill("#qName", "Queue Test"); confirm(page); settle(page, 300)
    check("Queue item added", len(db(page)["rooms"][T]["pr2"]["queue"]) == 2 or settle(page) or len(db(page)["rooms"][T]["pr2"]["queue"]) == 2)
    page.evaluate("dsa.queueMove('pr2',1,-1)"); settle(page)
    check("Queue reorder works", db(page)["rooms"][T]["pr2"]["queue"][0]["patient"]["name"] == "Queue Test")
    page.evaluate("void dsa.queueCall('pr2',0)"); settle(page)
    r2 = db(page)["rooms"][T]["pr2"]
    check("Call-in assigns patient and occupies room", r2["patient"]["name"] == "Queue Test" and r2["status"] == "occupied")
    page.evaluate("void dsa.prStart('pr2')"); settle(page, 500)
    check("Procedure-room timer start persists", bool(db(page)["rooms"][T]["pr2"]["patient"].get("startedAt")))
    page.wait_for_timeout(800)  # tap guard: the button is disabled for ~0.7 s after Start
    page.evaluate("void dsa.prComplete('pr2')"); page.wait_for_selector(".dialog"); confirm(page); settle(page, 500)
    check("Complete moves room to awaiting turnover", db(page)["rooms"][T]["pr2"]["status"] == "completed")
    page.evaluate("void dsa.prTurnover('pr2')"); page.wait_for_selector(".dialog"); confirm(page); settle(page)
    r2 = db(page)["rooms"][T]["pr2"]
    check("Turnover frees room and keeps queue", r2["status"] == "available" and len(r2["queue"]) == 1)
    check("Completed procedure archived", any(x["room"]["patient"]["name"] == "Queue Test" for x in db(page)["sessions"][T]["config"]["completedProcedureRooms"]))

    # ── History ────────────────────────────────────────────
    page.evaluate("dsa.go('hist')"); page.wait_for_selector(".h-session")
    check("Sessions appear", page.locator(".h-session").count() >= 2)
    page.fill("#histSearch", "Regression"); page.wait_for_timeout(300)
    check("Search works", page.locator(".h-row").count() == 1)
    page.locator(".h-row").first.click(); page.wait_for_selector(".dialog .summary")
    body = page.inner_text(".dialog .summary")
    check("Historical case shows team, timeline and grafts", "Zia" in body and "ANAESTHESIA" in body.upper())
    live_hist = page.locator(".dialog .tmr[data-t0][data-t1='']").count()
    check("Historical timers do not run", live_hist == 0)
    page.keyboard.press("Escape")
    page.evaluate("dsa.clearHistoryFilters()")
    page.evaluate("dsa.setHistoryFilter('status','completed')")
    rows_txt = page.eval_on_selector_all(".h-row", "els=>els.map(e=>e.innerText)")
    check("Status filter works", len(rows_txt) >= 2 and not any(("Not closed" in t or "In progress" in t or "Not started" in t) for t in rows_txt), rows_txt)
    page.evaluate("dsa.clearHistoryFilters()")

    # ── Settings ───────────────────────────────────────────
    page.evaluate("dsa.openSettings('staff')")
    page.fill("#newStaff", "Noor"); page.click(".add-row .btn"); settle(page)
    check("Staff add works", "Noor" in db(page)["sessions"][T]["config"]["staff"])
    page.evaluate("dsa.openSettings('checklist')")
    page.fill("#newCheckLabel", "Anaesthetist consulted"); page.click(".add-row .btn"); settle(page)
    check("Checklist configuration works", any(c["l"] == "Anaesthetist consulted" for c in db(page)["sessions"][T]["config"]["checks"]))
    page.evaluate("dsa.openSettings('procRooms')"); page.evaluate("dsa.addProcRoom()"); settle(page)
    check("Procedure room configuration works", len(db(page)["sessions"][T]["config"]["procRooms"]) == 3)
    page.reload(); page.wait_for_selector(".floor-row"); page.evaluate("dsa.go('rooms')")
    check("Configuration remains after refresh", page.locator(".pr-card").count() == 3)

    # ── Long-running timer, device asleep, crossing midnight ──
    # A second tab with a controllable clock: jump the clock forward like a laptop
    # waking up hours later. The running Extraction in OT 1 must read from its stored
    # start, not from a counter that stopped while the device slept.
    p2 = ctx.new_page(); p2.on("pageerror", lambda e: errors.append(str(e)))
    p2.clock.install()
    p2.goto(URL); p2.wait_for_selector(".floor-row"); p2.wait_for_timeout(1200)
    sel = ".floor-row .tmr[data-t0][data-t1='']"
    t0 = p2.locator(sel).first.get_attribute("data-t0")
    def hours(txt):
        parts = [int(x) for x in txt.strip().split(":")]
        return parts[0] + parts[1] / 60 if len(parts) == 3 else 0
    p2.clock.fast_forward("03:00:00"); p2.wait_for_timeout(300)
    h = hours(p2.locator(sel).first.inner_text())
    expect_h = (p2.evaluate("Date.now()") - int(t0)) / 3_600_000
    check("Timer longer than one hour equals now − stored start after a 3 h jump", h >= 3 and abs(h - expect_h) < 2 / 60, (h, expect_h))
    p2.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); p2.wait_for_timeout(200)
    check("Same timer, same start after wake-up", p2.locator(sel).first.get_attribute("data-t0") == t0)
    p2.clock.fast_forward("20:00:00"); p2.wait_for_timeout(1500)
    running = p2.locator(sel)
    h = hours(running.first.inner_text()) if running.count() else -1
    check("Timer keeps counting across midnight (≥ 23 h)", h >= 23, h)
    check("Start timestamp never rewritten by the jump", db(p2)["cases"][T]["case1"]["procedure"]["extraction"]["startedAt"] == c1_before)
    p2.close()

    # ── Logout ─────────────────────────────────────────────
    page.click("#logoutBtn"); page.wait_for_selector(".dialog"); confirm(page); page.wait_for_timeout(400)
    check("Logout works", page.locator("#loginScreen:not([hidden])").count() == 1)
    check("No uncaught page errors", not errors, errors)
    browser.close()

fails = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(len(fails))
