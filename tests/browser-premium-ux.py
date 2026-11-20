"""Coordinated Premium UX regression: language, today's plan and smarter logging."""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            for width,height in [(1280,900),(320,640),(375,667),(393,852)]:
                context=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<760,has_touch=width<760)
                page=context.new_page();errors=[];dialogs=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('dialog',lambda d:(dialogs.append(d.message),d.accept()))
                page.goto(f'http://127.0.0.1:{server.server_port}')
                def nav(label):page.locator('#mobileNav' if width<760 else '#sidenav').get_by_role('button',name=label,exact=False).click()
                original=page.evaluate('JSON.stringify(data)');original_drafts=page.evaluate('JSON.stringify(logDrafts)')
                nav('Innstillinger');page.locator('#languageChoice').select_option('en')
                assert page.locator('html').get_attribute('lang')=='en'
                assert page.evaluate('JSON.stringify(data)')==original
                assert page.evaluate('JSON.stringify(logDrafts)')==original_drafts
                assert page.evaluate('localStorage.getItem(KEY)') is None
                for label in ['Overview','Plan','Log','Progress','Road to Pro','Nutrition','Settings']:
                    nav(label);assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(width,label)
                assert 'Backup and data' in page.locator('#page-settings').inner_text()
                page.reload();assert page.locator('html').get_attribute('lang')=='en'
                nav('Plan');assert page.locator('#planCards .workout-card').first.locator('.plan-card-heading strong').text_content()=='Intervals'
                assert page.locator('#logType option').first.text_content()=='Intervals'
                base_card=page.locator('#planCards .workout-card').filter(has_text='Intervals')
                base_card.locator('.plan-menu-toggle').click()
                page.locator('#planActionDialog').get_by_role('button',name='Skip this week',exact=True).click()
                assert 'The recurring template, history and drafts are retained.' in dialogs[-1]
                assert base_card.get_by_role('button',name='Log workout',exact=True).is_disabled()
                base_card.locator('.plan-menu-toggle').click()
                page.locator('#planActionDialog').get_by_role('button',name='Include again',exact=True).click()
                assert base_card.get_by_role('button',name='Log workout',exact=True).is_enabled()
                # UI words are valid user content and must survive all language changes unchanged.
                page.get_by_role('button',name='New workout',exact=True).click()
                page.locator('#editTitle').fill('Ny økt');page.get_by_role('button',name='+ Add exercise',exact=True).click()
                page.get_by_role('button',name='✓ Save workout setup',exact=True).click()
                own_id=page.evaluate('data.workouts.at(-1).id')
                own=page.locator('#planCards .workout-card').filter(has_text='Ny økt')
                own.get_by_role('button',name='Log workout',exact=True).click()
                page.locator('#l4-0-0-value').fill('55.5');page.locator('#logNotes').fill('Rediger <img src=x onerror=alert(1)>')
                draft=page.evaluate('JSON.stringify(logState)')
                nav('Settings');page.locator('#languageChoice').select_option('nb')
                assert page.evaluate('JSON.stringify(logState)')==draft
                nav('Plan');assert page.locator('#planCards .workout-card').filter(has_text='Ny økt').count()==1
                nav('Innstillinger');page.locator('#languageChoice').select_option('en');nav('Log')
                assert page.locator('#logType').input_value()==own_id
                assert page.locator('#logNotes').input_value()=='Rediger <img src=x onerror=alert(1)>'
                assert page.locator('#l4-0-0-value').input_value()=='55.5'
                assert not page.evaluate('countLog().done')
                page.locator('.log-entry-controls .mark').first.click();page.locator('#savePartialButton').click()
                saved=page.evaluate('structuredClone(data.logs.at(-1))')
                assert saved['title']=='Ny økt' and saved['notes'].startswith('Rediger <img')
                assert page.locator('#toast').text_content()=='Workout in progress saved'
                nav('Settings')
                with page.expect_download() as event:page.get_by_role('button',name='↓ Export all data (.json)',exact=True).click()
                backup=Path(event.value.path()).read_bytes();payload=json.loads(backup)
                assert 'language' not in payload['settings'] and payload['version']==1
                page.locator('#importFile').set_input_files({'name':'premium.json','mimeType':'application/json','buffer':backup})
                page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
                assert page.locator('#toast').text_content()=='Data imported'
                assert page.evaluate('data.logs.at(-1)')==saved
                page.locator('#importFile').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'{bad'})
                page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
                assert 'Could not import:' in dialogs[-1]
                assert page.evaluate('data.logs.at(-1)')==saved
                # Language preference write failures must leave both UI and training data intact.
                before=page.evaluate('JSON.stringify(data)')
                page.evaluate("""() => {window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='hybrid_ui_language')throw Error('Full');return window.realSet.call(this,k,v)}}""")
                page.locator('#languageChoice').select_option('nb')
                assert page.locator('html').get_attribute('lang')=='en'
                assert 'Could not save the language preference' in dialogs[-1]
                assert page.evaluate('JSON.stringify(data)')==before
                page.evaluate('() => {Storage.prototype.setItem=window.realSet}')
                # Today's card uses occurrence IDs, including two extras of one template.
                page.evaluate('''id => {
                    const now=new Date(),week=iso(startWeek(now)),day=now.getDay();
                    data.weekPlans={[week]:{overrides:Object.fromEntries(data.workouts.map(w=>[w.id,{day:(day+1)%7}])),extras:[{id:'extra-today-a',workoutId:id,day},{id:'extra-today-b',workoutId:id,day}]}};
                    persist();renderAll();
                }''',own_id)
                nav('Overview')
                def today(occ):return page.locator(f'#todayWorkouts [data-today-occurrence="{occ}"]')
                assert page.locator('#todayWorkouts .today-workout').count()==2
                today('extra-today-a').get_by_role('button',name='Start workout',exact=True).click()
                assert page.evaluate('logState.occurrenceId')=='extra-today-a'
                assert page.locator('#logDate').input_value()==page.evaluate('iso(new Date())')
                page.locator('#l4-0-0-value').fill('70');page.locator('#logNotes').fill('Draft A')
                nav('Overview');page.reload()
                today('extra-today-a').get_by_role('button',name='Continue workout',exact=True).click()
                assert page.locator('#l4-0-0-value').input_value()=='70'
                assert page.locator('#logNotes').input_value()=='Draft A'
                assert page.evaluate('countLog().done')==0
                nav('Overview');today('extra-today-b').get_by_role('button',name='Start workout',exact=True).click()
                assert page.locator('#logNotes').input_value()==''
                page.locator('#l4-0-0-value').fill('80');page.locator('.log-entry-controls .mark').first.click()
                page.locator('#savePartialButton').click();partial_id=page.evaluate('logEditingId')
                nav('Overview');today('extra-today-a').get_by_role('button',name='Continue workout',exact=True).click()
                assert page.locator('#l4-0-0-value').input_value()=='70'
                page.locator('.log-entry-controls .mark').first.click();page.locator('#saveCompleteButton').click()
                complete_id=page.evaluate('logEditingId');saved_logs=page.evaluate('structuredClone(data.logs)')
                nav('Overview');today('extra-today-a').get_by_role('button',name='View workout',exact=True).click()
                assert page.evaluate('logEditingId')==complete_id
                nav('Overview');today('extra-today-b').get_by_role('button',name='Continue workout',exact=True).click()
                assert page.evaluate('logEditingId')==partial_id
                assert page.locator('#l4-0-0-value').input_value()=='80'
                nav('Plan')
                row_b=page.locator('#planCards .workout-card[data-occurrence-id="extra-today-b"]')
                row_b.locator('.plan-menu-toggle').click();page.locator('#planActionDialog').get_by_role('button',name='Skip this week',exact=True).click()
                nav('Overview');assert today('extra-today-b').get_by_role('button',name='Start workout',exact=True).is_disabled()
                assert page.evaluate('data.logs')==saved_logs
                nav('Plan');row_b.locator('.plan-menu-toggle').click();page.locator('#planActionDialog').get_by_role('button',name='Include again',exact=True).click()
                row_a=page.locator('#planCards .workout-card[data-occurrence-id="extra-today-a"]')
                row_a.locator('.plan-menu-toggle').click();page.locator('#planActionDialog').get_by_role('button',name='Move this week',exact=True).click()
                page.locator('#weekDay').select_option(str(page.evaluate('(new Date().getDay()+1)%7')))
                page.get_by_role('button',name='Save plan change',exact=True).click()
                nav('Overview');assert today('extra-today-a').count()==0
                assert today('extra-today-b').get_by_role('button',name='Continue workout',exact=True).is_enabled()
                assert page.evaluate('data.logs')==saved_logs
                # Archiving the template preserves both completed and ongoing sessions.
                nav('Plan')
                own_template=page.locator('#planCards .workout-card[data-occurrence-id^="repeat:"]').filter(has_text='Ny økt')
                own_template.locator('.plan-menu-toggle').click();page.locator('#planActionDialog').get_by_role('button',name='Remove from plan',exact=True).click()
                assert page.evaluate('data.logs')==saved_logs
                nav('Overview');assert page.locator('#todayWorkouts .today-workout').count()==0
                nav('Plan');page.locator('#archiveList').get_by_role('button',name='Restore',exact=True).click()
                assert page.evaluate('data.logs')==saved_logs
                nav('Overview');assert today('extra-today-b').count()==1
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
                assert not errors,errors
                print(f'PASS {width}x{height}: live language/reload, all pages, unchanged own text/models/drafts, partial history, JSON/failed import, preference storage failure, today/occurrence/draft/partial/completed/skip/move/archive/restore; no JS errors')
                context.close()
            browser.close()
    finally:server.shutdown();server.server_close()
if __name__=='__main__':main()
