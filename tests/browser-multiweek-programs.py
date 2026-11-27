"""HYROX round builder, snapshots, SI measures, occurrences and real offline E2E."""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright
from browser_plan_helpers import plan_action
ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.webmanifest':'application/manifest+json','.js':'application/javascript'}
    def log_message(self,*args):pass
    def do_GET(self):
        try:super().do_GET()
        except (BrokenPipeError,ConnectionResetError):pass

def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT.parent)));Thread(target=server.serve_forever,daemon=True).start()
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   for width,height in [(1280,900),(320,640),(375,667),(393,852)]:
    context=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<760,has_touch=width<760)
    page=context.new_page();errors=[];dialogs=[];answers=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    def dialog(d):
     dialogs.append(d.message)
     if answers and not answers.pop(0):d.dismiss()
     else:d.accept()
    page.on('dialog',dialog)
    page.goto(f'http://127.0.0.1:{server.server_port}/Hybrid-Performance-Hub/')
    page.wait_for_function("navigator.serviceWorker.controller&&document.getElementById('pwaStatus').textContent.includes('Offline-filer klare')")
    context.set_offline(True);original=page.evaluate('structuredClone(defaultWorkouts)');today=page.evaluate('iso(new Date())')
    def nav(label):page.locator('#mobileNav' if width<760 else '#sidenav').get_by_role('button',name=label,exact=False).click()
    def row(sid):return page.locator('#programWeekBody article').filter(has=page.locator('#program-day-'+sid))
    def week(n):page.locator('#program-week').select_option(str(n))
    def save_plan():page.get_by_role('button',name='Lagre øktoppsett',exact=False).click()
    nav('Plan');page.get_by_role('button',name='Opprett program',exact=True).click()
    page.locator('#program-name').fill('Mitt eget <program>');page.locator('#program-description').fill('Ingen automatisk progresjon')
    length={1280:6,320:8,375:12,393:12}[width]
    page.locator('#program-goal').fill('Min HYROX og styrke');page.locator('#program-length').select_option(str(length))
    assert page.locator('#program-start').input_value()==today
    # Reuse the full existing builder directly from a program, without adding a recurring duplicate.
    page.get_by_role('button',name='Opprett ny øktmal',exact=True).click()
    page.locator('#editTitle').fill('Program-HYROX');page.locator('#editMode').select_option('hyrox_rounds')
    page.get_by_role('button',name='Hurtigmal · 4 runder',exact=True).click();save_plan()
    hyrox_id=page.evaluate('data.workouts.at(-1).id');assert page.evaluate('data.workouts.at(-1).programOnly') is True
    assert page.evaluate('weekOccurrences(targetWeek()).filter(o=>o.workoutId===data.workouts.at(-1).id).length')==0
    for wid in ['upper','interval',hyrox_id]:
     page.locator('#programEditor fieldset label').filter(has=page.locator(f'input[onchange*="{wid}"]')).locator('input').check()
    page.get_by_role('button',name='Fyll tomme uker',exact=True).click()
    # Week zero already contains HYROX; add strength and intervals explicitly.
    for wid,day in [('upper',0),('interval',2)]:
     page.locator('#program-add-workout').select_option(wid);page.locator('#program-add-day').select_option(str(day))
     page.get_by_role('button',name='Legg til økt / ekstraøkt',exact=True).click()
    assert page.evaluate('programDraft.sessions.length')==length*3
    pid=page.evaluate('programDraft.id')
    upper=page.evaluate('programDraft.sessions.find(s=>s.week===0&&s.workoutId==="upper").id')
    row(upper).get_by_role('button',name='Øktoppsett',exact=True).click()
    ex=page.locator('#editExercises .builder-edit-card').first
    ex.locator('input').nth(1).fill('2 × 6');ex.locator('input').nth(1).press('Tab')
    ex.locator('input').nth(2).fill('71');ex.locator('input').nth(2).press('Tab');save_plan()
    assert page.evaluate('programDraft.sessions.find(s=>s.id==="'+upper+'").plan.exercises[0].target')=='71'
    assert page.evaluate('data.workouts.find(w=>w.id==="upper").exercises[0].target')==original[2]['exercises'][0]['target']
    week(1);future=page.evaluate('programDraft.sessions.find(s=>s.week===1&&s.workoutId==="upper").id')
    row(future).get_by_role('button',name='Øktoppsett',exact=True).click()
    page.locator('#programPlanScope').select_option('following')
    ex=page.locator('#editExercises .builder-edit-card').first;ex.locator('input').nth(2).fill('72.5');ex.locator('input').nth(2).press('Tab');save_plan()
    assert page.evaluate('programDraft.sessions.filter(s=>s.week>=1&&s.workoutId==="upper").every(s=>s.plan.exercises[0].target==="72.5")')
    # Recovery edits use the same builders, then can restore the original weekly goals.
    week(2);page.locator('#program-recovery').check();recovery=page.evaluate('programDraft.sessions.find(s=>s.week===2&&s.workoutId==="upper").id')
    row(recovery).get_by_role('button',name='Øktoppsett',exact=True).click();ex=page.locator('#editExercises .builder-edit-card').first
    ex.locator('input').nth(2).fill('50');ex.locator('input').nth(2).press('Tab');save_plan()
    page.get_by_role('button',name='Angre restitusjonsendringer',exact=True).click()
    assert page.evaluate('programDraft.sessions.find(s=>s.id==="'+recovery+'").plan.exercises[0].target')=='72.5'
    page.locator('#program-recovery').check()
    week(1);moved=page.evaluate('programDraft.sessions.find(s=>s.week===1&&s.workoutId==="interval"&&!s.retired).id')
    page.locator('#program-week-'+moved).select_option('4');week(4)
    page.locator('#program-day-'+moved).select_option('5')
    sunday=page.evaluate('(7-parseDate(programDraft.startDate).getDay())%7')
    page.locator('#program-day-'+moved).select_option(str(sunday))
    assert page.evaluate('parseDate(programSessionDate(programDraft,programDraft.sessions.find(s=>s.id==="'+moved+'"))).getDay()')==0
    assert page.evaluate('programDraft.sessions.find(s=>s.id==="'+moved+'").week')==4
    week(0);page.locator('#program-week-label').fill('Min oppstart')
    # A rejected rest-day confirmation restores the visible checkbox as well as the model.
    answers.append(False);page.locator('#programWeekBody .program-rest-days input').nth(0).click()
    assert not page.locator('#programWeekBody .program-rest-days input').nth(0).is_checked()
    page.locator('#programWeekBody .program-rest-days input').nth(6).check()
    source_ids=page.evaluate('programDraft.sessions.filter(s=>s.week===0).map(s=>s.id)')
    page.locator('#program-copy-week').select_option('3');page.get_by_role('button',name='Kopier uke · erstatt plan',exact=True).click()
    assert page.evaluate('programDraft.sessions.filter(s=>s.week===3&&!s.retired).map(s=>s.id).every(id=>!'+str(source_ids).replace("'",'"')+'.includes(id))')
    # Several extras on the same day are explicit distinct planned occurrences.
    week(0)
    extras=[]
    for _ in range(2):
     page.locator('#program-add-workout').select_option('upper');page.locator('#program-add-day').select_option('0')
     page.get_by_role('button',name='Legg til økt / ekstraøkt',exact=True).click();extras.append(page.evaluate('programDraft.sessions.at(-1).id'))
    assert len(set(extras))==2
    row(extras[0]).get_by_role('button',name='Hopp over',exact=True).click()
    assert page.evaluate('programDraft.sessions.find(s=>s.id==="'+extras[0]+'").skipped') is True
    row(extras[0]).get_by_role('button',name='Ta med igjen',exact=True).click()
    assert page.evaluate('programDraft.sessions.find(s=>s.id==="'+extras[0]+'").skipped') is False
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.get_by_role('button',name='Lagre program',exact=True).click()
    assert page.evaluate('data.programs[0].active') is False
    assert page.evaluate('data.weekPlans||{}')=={}
    page.locator('#programList article').get_by_role('button',name='Aktiver',exact=True).click()
    assert page.evaluate('data.programs[0].active') is True
    # A program snapshot remains usable when its source template is archived.
    page.locator('#programTemplates .program-card').filter(has_text='Program-HYROX').get_by_role('button',name='Fjern fra planen',exact=True).click()
    hyrox_occ=page.evaluate('data.programs[0].sessions.find(s=>s.week===0&&s.workoutId==="'+hyrox_id+'").id')
    nav('Oversikt');page.locator(f'#todayWorkouts [data-today-occurrence="{hyrox_occ}"]').get_by_role('button',name='Start økt',exact=True).click()
    assert page.evaluate('logState.type')==hyrox_id and page.evaluate('logState.hyroxRounds.rounds.length')==4
    nav('Plan');page.locator('#archiveList').get_by_role('button',name='Gjenopprett',exact=True).click()
    nav('Plan');planned_card=page.locator('#planCards [data-occurrence-id="'+upper+'"]')
    plan_action(page,planned_card,'Åpne program').click();assert page.evaluate('programDraft.id')==pid
    page.locator('#programEditor').get_by_role('button',name='Lukk',exact=True).click()
    nav('Oversikt');assert page.locator('#todayWorkouts [data-today-occurrence^="program-occ-"]').count()==4
    page.locator(f'#todayWorkouts [data-today-occurrence="{upper}"]').get_by_role('button',name='Start økt',exact=True).click()
    assert page.locator('#l4-0-0-value').input_value()=='71'
    assert 'Mitt eget <program>' in page.locator('#logVariantTools').text_content()
    # A reviewed shortened variant belongs to this program occurrence, never its template.
    page.get_by_role('button',name='Jeg har bare 30 minutter',exact=True).click();page.get_by_role('button',name='Bruk forkortet økt',exact=True).click()
    assert page.evaluate('logState.variant.targetMinutes')==30
    page.locator('#l4-0-0-value').fill('73');page.locator('#l4-0-0-qty').fill('6')
    page.locator('.log-entry-controls .mark').first.click();page.locator('#savePartialButton').click()
    saved=page.evaluate('structuredClone(data.logs[0])');assert saved['occurrenceId']==upper and saved['programContext']['programId']==pid
    page.locator('#logNotes').fill('Behold denne programkladden');raw=page.evaluate('localStorage.getItem(DRAFT_KEY)')
    nav('Plan');page.locator('#programList article').get_by_role('button',name='Åpne program',exact=True).click()
    new_start=page.evaluate('programDate(iso(new Date()),7)');page.locator('#program-start').fill(new_start);page.locator('#program-start').press('Tab')
    page.get_by_role('button',name='Lagre program',exact=True).click()
    assert page.evaluate('findOccurrence("'+upper+'").date')==today
    assert page.evaluate('findOccurrence("'+extras[0]+'").date')==new_start
    assert page.evaluate('data.logs[0]')==saved and page.evaluate('localStorage.getItem(DRAFT_KEY)')==raw
    nav('Oversikt');page.locator(f'#todayWorkouts [data-today-occurrence="{upper}"]').get_by_role('button',name='Fortsett økt',exact=True).click()
    assert page.evaluate('logEditingId')==saved['id'] and page.locator('#logNotes').input_value()=='Behold denne programkladden'
    nav('Innstillinger');page.locator('#languageChoice').select_option('en')
    with page.expect_download() as d:page.get_by_role('button',name='↓ Export all data (.json)',exact=True).click()
    payload=Path(d.value.path()).read_bytes();assert json.loads(payload)['programs'][0]['id']==pid
    page.locator('input[type="file"]').set_input_files({'name':'programs.json','mimeType':'application/json','buffer':payload})
    page.wait_for_function("document.getElementById('toast').textContent==='Data imported'")
    page.reload();page.wait_for_function('navigator.serviceWorker.controller');nav('Plan')
    assert page.locator('#programList').get_by_text('Mitt eget <program>',exact=True).count()==1
    page.locator('#programList article').get_by_role('button',name='Archive',exact=True).click()
    assert page.evaluate('data.programs[0].archived') is True
    assert page.evaluate('weekOccurrences(targetWeek()).filter(o=>o.kind==="repeat").length')==4
    assert page.evaluate('data.logs[0]')==saved
    nav('Log');page.locator('#logHistory .log-history-item').get_by_role('button',name='Continue',exact=True).click()
    assert page.locator('#l4-0-0-value').input_value()=='73'
    assert page.locator('#logNotes').input_value()=='Behold denne programkladden'
    assert page.evaluate('data.workouts.slice(0,4)')==original
    for label in ['Overview','Plan','Log','Progress','Road to Pro','Nutrition','Settings']:
     nav(label);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),label
    assert not errors,errors
    if width==393:
     page.screenshot(path='/tmp/m9-programs-393.png',full_page=True)
     # An installed store containing only programs must warn before importing Safari data.
     solo=page.evaluate('''() => {const p=structuredClone(data.programs[0]);p.active=false;p.archived=false;p.sessions=[];p.weeks=p.weeks.map(w=>({label:w.label,recovery:false,restDays:[]}));const backup={...defaults(),programs:[p]};validateBackup(backup);return JSON.stringify(backup)}''')
     installed=browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True)
     installed.add_init_script("Object.defineProperty(navigator,'standalone',{get:()=>true});localStorage.setItem('hyrox_performance_hub_v1',"+json.dumps(solo)+")")
     app=installed.new_page();app.goto(f'http://127.0.0.1:{server.server_port}/Hybrid-Performance-Hub/')
     app.wait_for_function("document.getElementById('pwaTransfer')&&!document.getElementById('pwaTransfer').hidden")
     assert 'Denne appen har allerede lokale data' in app.locator('#pwaTransfer').text_content()
     assert app.evaluate('localStorage.getItem(KEY)')==solo
     installed.close()
    print(f'PASS {width}x{height}, {length} weeks: native program editor, direct HYROX template, all modes, manual scopes/recovery/undo, copied weeks, rest cancellation, same-day extras, today/short variant, frozen dates/history/drafts, archive, JSON/language/restart and real offline; no JS errors',flush=True)
    context.close()
   browser.close()
 finally:server.shutdown()
if __name__=='__main__':main()
