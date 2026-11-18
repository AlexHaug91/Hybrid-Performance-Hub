"""Archive restore and week planning: python3 tests/browser-week-planning.py."""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            for width,height in [(1280,900),(375,667),(393,852)]:
                context=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<760,has_touch=width<760)
                page=context.new_page();errors=[];dialogs=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('dialog',lambda d:(dialogs.append(d.message),d.accept()))
                page.goto(f'http://127.0.0.1:{server.server_port}')
                def nav(label): page.locator('#mobileNav' if width<760 else '#sidenav').get_by_role('button',name=label,exact=False).click()
                def card(title): return page.locator('#planCards .workout-card').filter(has_text=title)
                def row(occurrence): return page.locator(f'#planCards [data-occurrence-id="{occurrence}"]')
                def week_move(target,day):
                    target.get_by_role('button',name='Flytt denne uken',exact=True).click()
                    assert page.locator('#weekScope').input_value()=='week'
                    page.locator('#weekDay').select_option(str(day))
                    page.get_by_role('button',name='Lagre planendring',exact=True).click()
                original_templates=page.evaluate('structuredClone(data.workouts)')
                nav('Plan');card('Overkropp + rolig løp').get_by_role('button',name='Logg',exact=True).click()
                page.locator('#l4-0-0-value').fill('75');page.locator('.log-entry-controls .mark').first.click()
                page.locator('.log-save-bar .btn').first.click();page.locator('#logNotes').fill('Kladd før arkivering')
                history=page.evaluate('structuredClone(data.logs[0])')
                nav('Plan');card('Overkropp + rolig løp').get_by_role('button',name='Fjern',exact=True).click()
                assert page.locator('#archiveCard').is_visible()
                drafts=page.evaluate('JSON.stringify(logDrafts)')
                page.locator('#archiveList select').select_option('2')
                page.locator('#archiveList').get_by_role('button',name='Gjenopprett',exact=True).click()
                assert card('Overkropp + rolig løp').count()==1
                assert 'TIR' in card('Overkropp + rolig løp').text_content()
                assert page.evaluate('data.logs[0]')==history
                assert page.evaluate('JSON.stringify(logDrafts)')==drafts
                assert page.evaluate("data.workouts.find(w=>w.id==='upper').exercises")==original_templates[2]['exercises']
                week_move(card('Intervaller'),4)
                assert 'TOR' in card('Intervaller').text_content()
                assert 'Endret · kun denne uken' in card('Intervaller').text_content()
                assert page.evaluate("data.workouts.find(w=>w.id==='interval').day")==1
                page.locator('.weeknav button').last.click();assert 'MAN' in card('Intervaller').text_content()
                page.locator('.weeknav button').first.click();assert 'TOR' in card('Intervaller').text_content()
                card('HYROX + løping').get_by_role('button',name='Hopp over denne uken',exact=True).click()
                assert card('HYROX + løping').get_by_role('button',name='Logg',exact=True).is_disabled()
                assert not page.evaluate("!!data.workouts.find(w=>w.id==='hyrox').archived")
                card('HYROX + løping').get_by_role('button',name='Ta med igjen',exact=True).click()
                week_move(card('Overkropp + rolig løp'),4)
                extras=[]
                for _ in range(2):
                    page.get_by_role('button',name='Ekstra økt denne uken',exact=True).click()
                    page.locator('#extraWorkout').select_option('upper');page.locator('#weekDay').select_option('4')
                    page.get_by_role('button',name='Lagre planendring',exact=True).click()
                    extras=page.locator('#planCards .workout-card').filter(has_text='Ekstra · kun denne uken').evaluate_all('(rows)=>rows.map(r=>r.dataset.occurrenceId)')
                assert len(set(extras))==2
                row(extras[0]).get_by_role('button',name='Logg',exact=True).click()
                page.locator('#l4-0-0-value').fill('70');page.locator('#logNotes').fill('Ekstra A')
                nav('Plan');row(extras[1]).get_by_role('button',name='Logg',exact=True).click()
                page.locator('#l4-0-0-value').fill('80');page.locator('#logNotes').fill('Ekstra B')
                nav('Plan');row(extras[0]).get_by_role('button',name='Logg',exact=True).click()
                assert page.locator('#logNotes').input_value()=='Ekstra A'
                assert page.locator('#l4-0-0-value').input_value()=='70'
                page.locator('.log-entry-controls .mark').first.click();page.locator('.log-save-bar .btn').first.click()
                a=page.evaluate('structuredClone(data.logs.at(-1))')
                nav('Plan');row(extras[1]).get_by_role('button',name='Logg',exact=True).click()
                assert page.locator('#l4-0-0-value').input_value()=='80'
                page.locator('.log-entry-controls .mark').first.click();page.locator('.log-save-bar .btn').last.click()
                assert page.evaluate('data.logs.length')==3
                assert page.evaluate('data.logs[0]')==history
                nav('Plan');week_move(row(extras[0]),5)
                row(extras[0]).get_by_role('button',name='Logg',exact=True).click()
                assert page.evaluate('logEditingId')==a['id']
                assert page.locator('#logDate').input_value()==a['date']
                page.locator('#logNotes').fill('Ekstra A bevart kladd')
                nav('Innstillinger')
                with page.expect_download() as event: page.get_by_role('button',name='↓ Eksporter alle data (.json)',exact=True).click()
                backup=Path(event.value.path()).read_bytes();assert json.loads(backup)['weekPlans']
                page.locator('#importFile').set_input_files({'name':'weeks.json','mimeType':'application/json','buffer':backup})
                page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
                assert page.locator('#toast').text_content()=='Data importert'
                page.reload();nav('Plan')
                assert 'FRE' in row(extras[0]).text_content()
                row(extras[0]).get_by_role('button',name='Logg',exact=True).click()
                assert page.locator('#logNotes').input_value()=='Ekstra A bevart kladd'
                assert page.evaluate('logEditingId')==a['id']
                nav('Plan');card('Intervaller').get_by_role('button',name='Flytt denne uken',exact=True).click()
                page.locator('#weekDay').select_option('6');before=page.evaluate('JSON.stringify(data)')
                page.evaluate("""() => {window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='hyrox_performance_hub_v1')throw new DOMException('Full','QuotaExceededError');return window.originalSetItem.call(this,k,v)}}""")
                page.get_by_role('button',name='Lagre planendring',exact=True).click()
                assert page.evaluate('JSON.stringify(data)')==before
                assert page.locator('#weekEditor').is_visible()
                assert 'kunne ikke lagres' in dialogs[-1]
                page.evaluate('() => {Storage.prototype.setItem=window.originalSetItem}')
                page.get_by_role('button',name='Lagre planendring',exact=True).click()
                page.locator('.weeknav button').last.click()
                assert 'MAN' in card('Intervaller').text_content()
                assert page.locator('#planCards .workout-card').filter(has_text='Ekstra · kun denne uken').count()==0
                for label in ['Oversikt','Plan','Logg','Progresjon','Road to Pro','Kosthold','Innstillinger']:
                    nav(label);assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(width,label)
                assert not errors,errors
                print(f'PASS {width}x{height}: restore same ID/day/history, scoped move/skip, separate same-day extra logs/drafts, JSON/reload, failed-save retry; no JS errors',flush=True)
                if width==393:
                    nav('Plan');page.locator('.weeknav button').first.click();page.screenshot(path='/tmp/hph-week-planning-mobile.png')
                context.close()
            browser.close()
    finally: server.shutdown();server.server_close()
if __name__=='__main__': main()
