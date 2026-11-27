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
    context.set_offline(True)
    def nav(label):page.locator('#mobileNav' if width<760 else '#sidenav').get_by_role('button',name=label,exact=False).click()
    def expand_field(selector):
     el=page.locator(selector)
     for ancestor in el.locator('xpath=ancestor::details').all():
      if ancestor.get_attribute('open') is None:ancestor.locator('summary').first.click()
     card=el.locator('xpath=ancestor::article[1]')
     if card.count() and card.locator('.log-card-toggle').count() and card.locator('.log-card-toggle').get_attribute('aria-expanded')=='false':card.locator('.log-card-toggle').click()
     return el
    def mark(i,j=0):
     expand_field(f'#l4-{i}-{j}-value');page.locator(f'button[onclick="toggleLogEntry({i},{j},\'done\')"]').click()
    nav('Plan');page.get_by_role('button',name='Ny økt',exact=True).click()
    assert page.locator('#editMode option').all_text_contents()==['Styrke','Intervaller','HYROX']
    page.locator('#editTitle').fill('Min egen styrke');page.get_by_role('button',name='+ Legg til øvelse',exact=True).click()
    first=page.locator('#editExercises .builder-edit-card').first
    first.locator('input').nth(0).fill('Benkpress med mitt eget navn');first.locator('input').nth(0).press('Tab')
    first.locator('input').nth(1).fill('4 × 6');first.locator('input').nth(1).press('Tab')
    page.get_by_role('button',name='+ Legg til øvelse',exact=True).click()
    second=page.locator('#editExercises .builder-edit-card').nth(1);second.locator('input').nth(0).fill('Min andre øvelse');second.locator('input').nth(0).press('Tab')
    second.locator('input').nth(1).fill('4 × 8');second.locator('input').nth(1).press('Tab')
    page.get_by_role('button',name='Lagre øktoppsett',exact=False).click();wid=page.evaluate('data.workouts.at(-1).id')
    source=page.evaluate('structuredClone(data.workouts.at(-1))')
    card=page.locator('#planCards .workout-card').filter(has_text='Min egen styrke');card.get_by_role('button',name='Logg økt',exact=True).click()
    cards=page.locator('#logExercises .log-ex-card');toggle=lambda i:cards.nth(i).locator('.log-card-toggle')
    state=page.evaluate('JSON.stringify(logState)');drafts=page.evaluate('localStorage.getItem(DRAFT_KEY)');main=page.evaluate('localStorage.getItem(KEY)')
    assert toggle(0).bounding_box()['height']>=44 and toggle(0).get_attribute('aria-expanded')=='true'
    toggle(0).click();assert toggle(0).get_attribute('aria-expanded')=='false';assert not cards.nth(0).locator('.log-ex-body').is_visible()
    assert page.evaluate('JSON.stringify(logState)')==state and page.evaluate('localStorage.getItem(DRAFT_KEY)')==drafts and page.evaluate('localStorage.getItem(KEY)')==main
    toggle(0).focus();toggle(0).press('Space');assert toggle(0).get_attribute('aria-expanded')=='true'
    for j in [0,1]:
     page.locator(f'#l4-0-{j}-value').fill(str(75+j));page.locator(f'#l4-0-{j}-qty').fill('6');mark(0,j)
    assert cards.nth(0).locator('[role="progressbar"]').get_attribute('aria-valuenow')=='2'
    toggle(0).click();assert toggle(0).get_attribute('aria-expanded')=='false'
    page.locator('button[onclick="toggleLogEntry(1,0,\'skip\')"]').click()
    assert cards.nth(1).locator('[role="progressbar"]').get_attribute('aria-valuenow')=='0'
    before=page.evaluate('JSON.stringify(logState)');nav('Plan');nav('Logg')
    assert toggle(0).get_attribute('aria-expanded')=='false' and toggle(1).get_attribute('aria-expanded')=='true'
    assert page.evaluate('JSON.stringify(logState)')==before
    page.locator('#savePartialButton').click();plain=page.evaluate('structuredClone(data.logs[0])')
    assert toggle(0).get_attribute('aria-expanded')=='false'
    toggle(0).click()
    for j in [2,3]:page.locator(f'#l4-0-{j}-value').fill('77');page.locator(f'#l4-0-{j}-qty').fill('6');mark(0,j)
    assert toggle(0).get_attribute('aria-expanded')=='true'
    assert cards.nth(0).locator('[role="progressbar"]').get_attribute('aria-valuenow')=='4'
    toggle(0).click();assert toggle(0).get_attribute('aria-expanded')=='false'
    toggle(0).focus();toggle(0).press('Enter');assert toggle(0).get_attribute('aria-expanded')=='true'
    page.locator('#savePartialButton').click()
    # A new same-day session has its own view state and can take a reviewed short variant.
    page.locator('#logSessionBanner button').click();assert toggle(0).get_attribute('aria-expanded')=='true'
    original_state=page.evaluate('JSON.stringify(logState)');raw=page.evaluate('localStorage.getItem(DRAFT_KEY)')
    page.get_by_role('button',name='Jeg har bare 30 minutter',exact=True).click();page.get_by_role('button',name='Avbryt',exact=True).click()
    assert page.evaluate('JSON.stringify(logState)')==original_state and page.evaluate('localStorage.getItem(DRAFT_KEY)')==raw
    page.get_by_role('button',name='Jeg har bare 30 minutter',exact=True).click()
    page.locator('#short-count-0').fill('3');page.locator('#short-count-0').press('Tab')
    page.locator('#shortEditor input[onchange="shortChoice(1,this.checked,null)"]').uncheck()
    page.evaluate("() => {window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===DRAFT_KEY)throw Error('Full');return window.realSet.call(this,k,v)}}")
    page.get_by_role('button',name='Bruk forkortet økt',exact=True).click()
    assert page.locator('#shortEditor').is_visible() and page.evaluate('logState.variant||null') is None
    assert page.evaluate('JSON.stringify(logState)')==original_state and page.evaluate('localStorage.getItem(DRAFT_KEY)')==raw
    page.evaluate('() => {Storage.prototype.setItem=window.realSet}')
    page.get_by_role('button',name='Bruk forkortet økt',exact=True).click()
    assert page.evaluate('logState.items.length')==1 and page.evaluate('logState.items[0].entries.length')==3
    assert page.evaluate('data.workouts.find(w=>w.id==="'+wid+'")')==source
    page.locator('#l4-0-0-value').fill('77.5');page.locator('#l4-0-0-qty').fill('6');mark(0,0);page.locator('#savePartialButton').click()
    shortened=page.evaluate('structuredClone(data.logs.at(-1))');assert shortened['variant']['targetMinutes']==30
    page.reload();page.wait_for_function('navigator.serviceWorker.controller');nav('Logg')
    page.locator('#logHistory .log-history-item').filter(has_text='Forkortet økt').get_by_role('button',name='Fortsett',exact=True).click()
    assert page.evaluate('logEditingId')==shortened['id'] and page.locator('#l4-0-0-value').input_value()=='77.5'
    page.locator('#saveCompleteButton').click();saved=page.evaluate('data.logs.find(l=>l.id==="'+shortened['id']+'")')
    assert saved['status']=='complete' and len(saved['exercises'][0]['sets'])==3
    assert sum(s['done'] for s in saved['exercises'][0]['sets'])==1
    assert sum(s['skipped'] for s in saved['exercises'][0]['sets'])==2
    nav('Oversikt');assert 'Kortvariant fullført' in page.locator('#todayWorkouts').text_content()
    nav('Plan');page.locator('#planCards .workout-card').filter(has_text='Intervaller').get_by_role('button',name='Logg økt',exact=True).click()
    old_interval=page.evaluate('structuredClone(data.workouts.find(w=>w.id==="interval"))')
    page.get_by_role('button',name='Jeg har bare 30 minutter',exact=True).click();page.get_by_role('button',name='Bruk forkortet økt',exact=True).click()
    assert page.evaluate('logState.items[0].name')=='Oppvarming' and page.evaluate('logState.items.at(-1).name')=='Nedjogging'
    mark(0,0);page.locator('#savePartialButton').click();assert page.evaluate('data.workouts.find(w=>w.id==="interval")')==old_interval
    # Both individual HYROX parts and entire rounds retain independent disclosure state.
    nav('Plan');page.get_by_role('button',name='Ny økt',exact=True).click();page.locator('#editTitle').fill('Min HYROX-variant')
    page.locator('#editMode').select_option('hyrox_rounds');page.get_by_role('button',name='Hurtigmal · 4 runder',exact=True).click();page.locator('#hyroxRest').fill('90')
    page.get_by_role('button',name='Lagre øktoppsett',exact=False).click();hyrox_id=page.evaluate('data.workouts.at(-1).id');hyrox=page.evaluate('structuredClone(data.workouts.at(-1))')
    page.locator('#planCards .workout-card').filter(has_text='Min HYROX-variant').get_by_role('button',name='Logg økt',exact=True).click()
    parts=page.locator('#logExercises .hyrox-log-card');rounds=page.locator('#logExercises details[data-log-round]')
    parts.first.locator('.log-card-toggle').click();assert parts.first.locator('.log-card-toggle').get_attribute('aria-expanded')=='false'
    state=page.evaluate('JSON.stringify(logState)');raw=page.evaluate('localStorage.getItem(DRAFT_KEY)')
    rounds.first.locator('summary').click();page.wait_for_function("document.querySelector('#logExercises details[data-log-round] summary').getAttribute('aria-expanded')==='false'")
    assert page.evaluate('JSON.stringify(logState)')==state and page.evaluate('localStorage.getItem(DRAFT_KEY)')==raw
    rounds.nth(1).locator('summary').click();assert rounds.nth(1).get_attribute('open') is not None
    nav('Plan');nav('Logg');assert rounds.first.get_attribute('open') is None and rounds.nth(1).get_attribute('open') is not None
    page.get_by_role('button',name='Jeg har bare 30 minutter',exact=True).click()
    third=page.evaluate('shortDraft.base.hyroxRounds.rounds[2].id')
    indices=page.evaluate('id=>shortDraft.base.items.map((it,i)=>({it,i})).filter(({it})=>it.hyrox.section==="round"&&it.hyrox.roundId===id).map(({i})=>i)',third)
    for i in indices:page.locator(f'#shortEditor input[onchange="shortChoice({i},this.checked,null)"]').check()
    page.get_by_role('button',name='Bruk forkortet økt',exact=True).click()
    assert page.evaluate('logState.hyroxRounds.rounds.length')==3 and page.evaluate('logState.items.filter(it=>it.hyrox.section==="rest").length')==2
    expand_field('#hr-0-0-meters').fill('0.9');page.locator('#hr-0-0-seconds').fill('4:30')
    page.locator('#hr-0-0-note').locator('xpath=..').get_by_role('button',name='Marker utført',exact=True).click();page.locator('#savePartialButton').click()
    hs=page.evaluate('structuredClone(data.logs.at(-1))');assert hs['variant']['originalPlan']['hyroxRounds']['rounds']==hyrox['hyroxRounds']['rounds']
    assert len(hs['hyroxRounds']['rounds'])==3 and page.evaluate('data.workouts.at(-1)')==hyrox
    expand_field('#hr-0-0-seconds').fill('5:');nav('Innstillinger');page.locator('#languageChoice').select_option('en')
    with page.expect_download() as d:page.get_by_role('button',name='↓ Export all data (.json)',exact=True).click()
    payload=Path(d.value.path()).read_bytes();page.locator('input[type="file"]').set_input_files({'name':'variants.json','mimeType':'application/json','buffer':payload})
    page.wait_for_function("document.getElementById('toast').textContent==='Data imported'")
    page.reload();page.wait_for_function('navigator.serviceWorker.controller');nav('Log')
    page.locator('#logHistory .log-history-item').filter(has_text='Min HYROX-variant').get_by_role('button',name='Continue',exact=True).click()
    assert expand_field('#hr-0-0-seconds').input_value()=='5:'
    assert page.locator('#editMode option').all_text_contents()==['Strength','Intervals','HYROX']
    assert page.evaluate('data.workouts.find(w=>w.id==="'+wid+'").title')=='Min egen styrke'
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    if width==393:page.screenshot(path='/tmp/m9-logging-393.png',full_page=True)
    print(f'PASS {width}x{height}: 0/4, 2/4, 4/4 disclosures, keyboard/ARIA/progress/skip, independent cards/rounds, save/nav focus state; reviewed/cancelled/failed/retried variants for all modes; source/history/JSON/raw draft protection; real offline and names; no JS errors',flush=True)
    context.close()
   browser.close()
 finally:server.shutdown()
if __name__=='__main__':main()
