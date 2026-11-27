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
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
    page.goto(f'http://127.0.0.1:{server.server_port}/Hybrid-Performance-Hub/')
    page.wait_for_function("navigator.serviceWorker.controller&&document.getElementById('pwaStatus').textContent.includes('Offline-filer klare')")
    original=page.evaluate('structuredClone(defaultWorkouts)')
    def nav(label):page.locator('#mobileNav' if width<760 else '#sidenav').get_by_role('button',name=label,exact=False).click()
    def builder_group(index):
     group=page.locator('#editExercises > .hyrox-round').nth(index)
     if group.get_attribute('open') is None:group.locator('summary').click()
     return group
    def open_details(el):
     detail=el.locator('xpath=ancestor::details[1]')
     if detail.count() and detail.get_attribute('open') is None:detail.locator('summary').click()
    def fill(i,key,raw,j=0):
     el=page.locator(f'#hr-{i}-{j}-{key}');open_details(el);el.fill(raw)
    def mark(i,j=0):
     el=page.locator(f'#hr-{i}-{j}-note');open_details(el)
     el.locator('xpath=..').get_by_role('button',name='Marker utført',exact=True).click()
    # Everything from creation onwards is performed with a real disconnected context.
    context.set_offline(True);nav('Plan');page.get_by_role('button',name='Ny økt',exact=True).click()
    page.locator('#editMode').select_option('hyrox_rounds');page.locator('#editTitle').fill('Mine HYROX-runder')
    page.get_by_role('button',name='Hurtigmal · 4 runder',exact=True).click()
    assert builder_group(1).get_by_role('button',name='Kopier runde',exact=True).bounding_box()['height']>=44
    builder_group(1).get_by_role('button',name='Kopier runde',exact=True).click();assert page.locator('#hyroxCount').input_value()=='5'
    builder_group(2).get_by_role('button',name='Flytt runde ned',exact=True).click()
    builder_group(3).get_by_role('button',name='Slett runde',exact=True).click();assert page.locator('#hyroxCount').input_value()=='4'
    # An invalid temporary copied part must block save, then stop blocking after explicit deletion.
    builder_group(1).locator('.hyrox-part').first.get_by_role('button',name='Kopier del',exact=True).click()
    builder_group(1).locator('.hyrox-part').nth(1).locator('input[id$="-seconds"]').fill('5:')
    page.get_by_role('button',name='Lagre øktoppsett',exact=False).click()
    assert page.evaluate('data.workouts.length')==4
    assert page.locator('#planEditor').is_visible()
    builder_group(1).locator('.hyrox-part').nth(1).get_by_role('button',name='Slett del',exact=True).click()
    ids=page.evaluate('editedWorkout().hyroxRounds.rounds.map(r=>r.id)')
    assert len(set(ids))==4
    page.locator('#hyroxRest').fill('90')
    first=builder_group(1).locator('.hyrox-part')
    first.nth(1).locator('input[id$="-reps"]').fill('12');first.nth(1).locator('input[id$="-kg"]').fill('6')
    first.nth(3).locator('input[id$="-kg"]').fill('20');first.nth(3).locator('input[id$="-meters"]').fill('40')
    builder_group(2).locator('.hyrox-part').first.locator('input[id$="-meters"]').fill('0.8')
    assert page.evaluate('editedWorkout().exercises[0].hyrox.plan.meters')==1000
    # Optional warmup/cooldown remain separate from rounds and pause totals.
    for g in [0,5]:
     group=builder_group(g);group.get_by_role('button',name='Legg til del',exact=True).click()
     group=builder_group(g);group.locator('input[id$="-meters"]').fill('200');group.locator('input[id$="-seconds"]').fill('1:30')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    if width==393:page.screenshot(path='/tmp/hyrox-builder-393.png',full_page=True)
    page.get_by_role('button',name='Lagre øktoppsett',exact=False).click()
    workout=page.evaluate('structuredClone(data.workouts.at(-1))');wid=workout['id']
    card=page.locator('#planCards .workout-card').filter(has_text='Mine HYROX-runder')
    card.get_by_role('button',name='Logg økt',exact=True).click()
    assert page.evaluate('logState.hyroxRounds.rounds.length')==4
    items=page.evaluate('structuredClone(logState.items)');assert len([it for it in items if it['hyrox']['section']=='rest'])==3
    assert all(not e['done'] and all(not v for v in e['hyroxInput'].values()) for it in items for e in it['entries'])
    # Three completed rounds, one untouched round, and actual values distinct from targets.
    for i,it in enumerate(items):
     h=it['hyrox'];r=ids.index(h['roundId']) if h['roundId'] in ids else -1
     if h['section']=='round' and r==3:continue
     fill(i,'seconds','1:30' if h['section']=='rest' else '0:30')
     if h['station']=='run':fill(i,'meters','0.95' if h['plan']['distanceUnit']=='km' else '150')
     if h['station']=='wall':fill(i,'reps','10');fill(i,'kg','5')
     if h['station']=='farmers':fill(i,'meters','35');fill(i,'kg','18')
     mark(i)
    run_index=next(i for i,it in enumerate(items) if it['hyrox']['station']=='run' and it['hyrox']['section']=='round')
    fill(run_index,'note','Min egen kommentar <script>test</script>')
    page.locator('#logDuration').fill('60');page.locator('#savePartialButton').click()
    saved=page.evaluate('structuredClone(data.logs.at(-1))');logid=saved['id']
    assert saved['status']=='partial' and len(saved['hyroxRounds']['rounds'])==4
    results=page.evaluate('hyroxResults(data.logs.at(-1))');assert results['completedRounds']==3 and results['restSeconds']==270
    assert results['seconds']==17*30  # 15 stations plus before/after; duration=60 min is separate.
    assert saved['exercises'][run_index]['sets'][0]['hyroxActual']['meters']==950
    fill(run_index,'seconds','5:')
    # Raw unfinished input survives offline reload and exact historical reopening.
    page.reload();page.wait_for_function('navigator.serviceWorker.controller');nav('Logg')
    page.locator('#logHistory .log-history-item').filter(has_text='Mine HYROX-runder').get_by_role('button',name='Fortsett',exact=True).click()
    open_details(page.locator(f'#hr-{run_index}-0-seconds'));assert page.locator(f'#hr-{run_index}-0-seconds').input_value()=='5:'
    page.locator('#savePartialButton').click();assert page.evaluate('data.logs[0]')==saved
    fill(run_index,'seconds','5:00')
    # A blocked main write keeps the old log and the current exact input for retry.
    page.evaluate("() => {window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===KEY)throw Error('Full');return window.realSet.call(this,k,v)}}")
    page.locator('#savePartialButton').click();assert page.evaluate('data.logs[0]')==saved
    assert page.locator('#logSaveStatus').get_attribute('data-save-state')=='error'
    assert page.locator(f'#hr-{run_index}-0-seconds').input_value()=='5:00'
    page.evaluate('() => {Storage.prototype.setItem=window.realSet}');page.locator('#savePartialButton').click()
    saved=page.evaluate('structuredClone(data.logs[0])')
    # Editing and archiving the template must not change the historical snapshot.
    nav('Plan');plan_action(page,card,'Rediger').click()
    builder_group(1).locator('.hyrox-part').first.get_by_role('button',name='Slett del',exact=True).click()
    page.get_by_role('button',name='Lagre øktoppsett',exact=False).click()
    plan_action(page,card,'Fjern').click();nav('Logg')
    page.locator('#logHistory .log-history-item').filter(has_text='Mine HYROX-runder').get_by_role('button',name='Fortsett',exact=True).click()
    assert page.evaluate('data.logs[0]')==saved
    assert page.evaluate('logState.items.some(it=>it.hyrox.partId===data.logs[0].exercises[1].hyrox.partId)')
    page.locator('#savePartialButton').click();assert page.evaluate('data.logs[0].exercises')==saved['exercises']
    # Round-trip export/import, language and independent scheduled extras.
    nav('Innstillinger');page.locator('#languageChoice').select_option('en')
    with page.expect_download() as download:page.get_by_role('button',name='↓ Export all data (.json)',exact=True).click()
    payload=Path(download.value.path()).read_bytes();assert json.loads(payload)['logs'][0]['exercises']==saved['exercises']
    page.locator('input[type="file"]').set_input_files({'name':'rounds.json','mimeType':'application/json','buffer':payload})
    page.wait_for_function("document.getElementById('toast').textContent==='Data imported'")
    nav('Plan');page.locator('#archiveList').get_by_role('button',name='Restore',exact=True).click()
    plan_action(page,card,'Move this week').click();page.locator('#weekDay').select_option('0')
    page.get_by_role('button',name='Save plan change',exact=True).click()
    assert page.evaluate('data.workouts.find(w=>w.id===data.logs[0].type).day')==workout['day']
    assert page.evaluate('weekOccurrences(targetWeek()).find(o=>o.workoutId===data.logs[0].type&&o.kind==="repeat").day')==0
    assert page.evaluate('data.logs[0].exercises')==saved['exercises']
    assert page.evaluate('data.logs[0].id')==logid
    for _ in range(2):
     page.get_by_role('button',name='Extra workout this week',exact=True).click();page.locator('#extraWorkout').select_option(wid)
     page.locator('#weekDay').select_option(str(page.evaluate('new Date().getDay()')));page.get_by_role('button',name='Save plan change',exact=True).click()
    extras=page.evaluate('data.weekPlans[iso(startWeek(new Date()))].extras.map(e=>e.id)');assert len(set(extras))==2
    for index,occ in enumerate(extras):
     nav('Overview');page.locator(f'[data-today-occurrence="{occ}"]').get_by_role('button',name='Start workout',exact=True).click()
     el=page.locator('#hr-0-0-note');open_details(el);el.fill('Extra '+str(index));nav('Plan')
    drafts=page.evaluate('Object.values(logDrafts).filter(d=>d.state.occurrenceId?.startsWith("extra-")).map(d=>({occ:d.state.occurrenceId,note:d.state.items[0].entries[0].hyroxInput.note}))')
    assert sorted(d['note'] for d in drafts)==['Extra 0','Extra 1']
    nav('Log');page.locator('#logHistory .log-history-item').filter(has_text='Mine HYROX-runder').get_by_role('button',name='Continue',exact=True).click()
    assert page.locator('#logSessionBanner strong').text_content()=='HYROX'
    if width==393:page.screenshot(path='/tmp/hyrox-logging-393.png',full_page=True)
    assert page.locator('#logExercises script').count()==0  # user comment remains inert text
    for label in ['Overview','Plan','Log','Progress','Road to Pro','Nutrition','Settings']:
     nav(label);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),label
    assert page.evaluate('defaultWorkouts')==original
    assert not errors,errors
    if width==393:page.screenshot(path='/tmp/hyrox-rounds-393.png',full_page=True)
    print(f'PASS {width}x{height}: round/part copy/move/delete; SI actuals and 3/4 partial; raw drafts/reload; history/archive; JSON/language; separate extras; storage failure/retry; real offline; no app JS errors',flush=True)
    context.close()
   browser.close()
 finally:server.shutdown()
if __name__=='__main__':main()
