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
    originals=page.evaluate('structuredClone(defaultWorkouts)');context.set_offline(True)
    def nav(label):page.locator('#mobileNav' if width<760 else '#sidenav').get_by_role('button',name=label,exact=False).click()
    def group():return page.locator('#editExercises > .hyrox-round').nth(1)
    def part(pid):return page.locator('#hp-'+pid+'-station').locator('xpath=..')
    def switch(pid,key):page.locator('#hp-'+pid+'-station').select_option(key)
    def fill(pid,key,value):page.locator('#hp-'+pid+'-'+key).fill(value)
    nav('Plan');page.get_by_role('button',name='Ny økt',exact=True).click();page.locator('#editMode').select_option('hyrox_rounds')
    page.locator('#editTitle').fill('Mine valgte øvelser')
    add=lambda:group().locator('select[id^="station-"]')
    options=add().locator('option').all_text_contents()
    assert len(options)==11 and 'Annen styrkeøvelse' in options and 'Egendefinert øvelse' in options
    fields={'run':['meters','seconds'],'ski':['meters','seconds'],'push':['meters','kg','seconds'],'pull':['meters','kg','seconds'],'burpees':['meters','reps','seconds'],'row':['meters','seconds'],'farmers':['meters','kg','seconds'],'lunges':['meters','reps','kg','seconds'],'wall':['reps','kg','seconds'],'strength':['reps','kg','seconds'],'custom':['meters','reps','kg','seconds']}
    ids={}
    for station,expected in fields.items():
     add().select_option(station);group().get_by_role('button',name='Legg til del',exact=True).click()
     pid=page.evaluate('editedWorkout().exercises.at(-1).hyrox.partId');ids[station]=pid
     assert page.locator('#hp-'+pid+'-station').input_value()==station
     for key in ['meters','seconds','reps','kg']:
      assert page.locator('#hp-'+pid+'-'+key).count()==(1 if key in expected else 0),(station,key)
     assert page.locator('#hp-'+pid+'-station').bounding_box()['height']>=40
    assert 'Ballvekt (kg)' in part(ids['wall']).text_content()
    assert 'Sandsekkvekt (kg)' in part(ids['lunges']).text_content()
    assert 'Vekt per hånd (kg)' in part(ids['farmers']).text_content()
    add().select_option('run');group().get_by_role('button',name='Legg til del',exact=True).click()
    duplicate_run=page.evaluate('editedWorkout().exercises.at(-1).hyrox.partId');assert duplicate_run!=ids['run']
    part(duplicate_run).get_by_role('button',name='Kopier del',exact=True).click()
    copied=page.evaluate('editedWorkout().exercises.at(-1).hyrox.partId');assert copied!=duplicate_run
    part(copied).get_by_role('button',name='Flytt opp',exact=True).click()
    assert page.evaluate('new Set(editedWorkout().exercises.map(e=>e.hyrox.partId)).size')==13
    # Loss confirmation rejects without mutating either values or the visible selection.
    fill(ids['run'],'meters','1000');fill(ids['run'],'seconds','5:00');fill(ids['run'],'speedKmh','12')
    before=page.evaluate('structuredClone(editedWorkout())');answers.append(False);switch(ids['run'],'row')
    assert page.evaluate('editedWorkout()')==before and page.locator('#hp-'+ids['run']+'-station').input_value()=='run'
    assert '12' in dialogs[-1]
    switch(ids['run'],'row');assert page.locator('#hp-'+ids['run']+'-meters').input_value()=='1000'
    assert page.locator('#hp-'+ids['run']+'-seconds').input_value()=='5:00'
    count=len(dialogs);switch(ids['run'],'ski');assert len(dialogs)==count
    fill(ids['farmers'],'meters','40');fill(ids['farmers'],'kg','24');fill(ids['farmers'],'seconds','1:30')
    before=page.evaluate('structuredClone(editedWorkout())');answers.append(False);switch(ids['farmers'],'push');assert page.evaluate('editedWorkout()')==before
    switch(ids['farmers'],'push');assert page.locator('#hp-'+ids['farmers']+'-kg').input_value()==''
    assert page.locator('#hp-'+ids['farmers']+'-meters').input_value()=='40'
    assert page.locator('#hp-'+ids['farmers']+'-seconds').input_value()=='1:30'
    fill(ids['farmers'],'kg','100')
    fill(ids['burpees'],'reps','15');fill(ids['burpees'],'meters','20')
    fill(ids['lunges'],'reps','20');fill(ids['lunges'],'kg','15')
    fill(ids['custom'],'name','Min egen Løping');switch(ids['custom'],'wall');assert page.locator('#hp-'+ids['custom']+'-name').input_value()=='Min egen Løping'
    nav('Innstillinger');page.locator('#languageChoice').select_option('en');nav('Plan')
    options=add().locator('option').all_text_contents();assert 'Other strength exercise' in options and 'Custom exercise' in options and 'Running' in options
    assert page.locator('#hp-'+ids['custom']+'-name').input_value()=='Min egen Løping'
    assert 'Ball weight (kg)' in part(ids['wall']).text_content()
    assert 'Sandbag weight (kg)' in part(ids['lunges']).text_content()
    # Native selects remain operable by keyboard on PC.
    if width==1280:
     selector=page.locator('#hp-'+duplicate_run+'-station');selector.focus();selector.press('End')
     assert selector.input_value()=='custom'
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    if width==393:page.screenshot(path='/tmp/hyrox-picker-393.png',full_page=True)
    page.get_by_role('button',name='Save workout setup',exact=False).click()
    wid=page.evaluate('data.workouts.at(-1).id');rid=page.evaluate('data.workouts.at(-1).hyroxRounds.rounds[0].id')
    card=page.locator('#planCards .workout-card').filter(has_text='Mine valgte øvelser')
    card.get_by_role('button',name='Log workout',exact=True).click()
    page.locator('#hr-0-0-meters').fill('900');page.locator('#hr-0-0-seconds').fill('4:30')
    page.locator('#hr-0-0-note').locator('xpath=..').get_by_role('button',name='Mark completed',exact=True).click()
    page.locator('#savePartialButton').click();saved=page.evaluate('structuredClone(data.logs[0])')
    page.locator('#hr-0-0-note').fill('Behold min kladd');drafts=page.evaluate('localStorage.getItem(DRAFT_KEY)')
    nav('Plan');plan_action(page,card,'Edit').click();switch(ids['run'],'wall')
    assert page.evaluate('editedWorkout().exercises[0].hyrox.partId')==ids['run']
    assert page.evaluate('editedWorkout().exercises[0].hyrox.roundId')==rid
    page.get_by_role('button',name='Save workout setup',exact=False).click()
    assert page.evaluate('data.logs[0]')==saved and page.evaluate('localStorage.getItem(DRAFT_KEY)')==drafts
    nav('Settings')
    with page.expect_download() as download:page.get_by_role('button',name='↓ Export all data (.json)',exact=True).click()
    backup=Path(download.value.path()).read_bytes();page.locator('input[type="file"]').set_input_files({'name':'picker.json','mimeType':'application/json','buffer':backup})
    page.wait_for_function("document.getElementById('toast').textContent==='Data imported'")
    assert page.evaluate('data.workouts.at(-1).exercises[0].hyrox.station')=='wall'
    assert page.evaluate('data.logs[0].exercises[0].hyrox.station')=='ski'
    assert page.evaluate('data.workouts.at(-1).exercises[0].hyrox.partId')==ids['run']
    page.reload();page.wait_for_function('navigator.serviceWorker.controller');nav('Log')
    page.locator('#logHistory .log-history-item').filter(has_text='Mine valgte øvelser').get_by_role('button',name='Continue',exact=True).click()
    assert page.locator('#hr-0-0-meters').input_value()=='900'
    assert page.locator('#hr-0-0-note').input_value()=='Behold min kladd'
    assert page.evaluate('defaultWorkouts')==originals
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    print(f'PASS {width}x{height}: eleven native choices; dynamic fields; repeated/copy/move; cancel/confirm and kg semantics; bilingual own names; exact IDs/history/drafts; JSON/reload; real offline; no horizontal overflow or app JS errors',flush=True)
    context.close()
   browser.close()
 finally:server.shutdown()
if __name__=='__main__':main()
