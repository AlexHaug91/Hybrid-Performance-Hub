"""Advanced intervals E2E in Chromium desktop and iPhone-sized viewports."""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass

def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            for width, height in [(1280, 900), (375, 667), (393, 852)]:
                context = browser.new_context(viewport={'width':width,'height':height},is_mobile=width<760,has_touch=width<760)
                page = context.new_page(); errors=[]; dialogs=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('dialog',lambda d:(dialogs.append(d.message),d.accept()))
                page.goto(f'http://127.0.0.1:{server.server_port}')
                original = page.evaluate('structuredClone(data.workouts)')
                def nav(label): page.locator('#mobileNav' if width<760 else '#sidenav').get_by_role('button',name=label,exact=False).click()
                def start(title):
                    nav('Plan');page.get_by_role('button',name='Ny økt',exact=True).click()
                    page.locator('#editTitle').fill(title);page.locator('#editMode').select_option('interval')
                def save(): page.get_by_role('button',name='Lagre øktoppsett',exact=False).click()
                def card(title): return page.locator('#planCards .workout-card').filter(has_text=title)
                def row(i): return page.locator('#editExercises .interval-row').nth(i)
                def change(i, field, value):
                    el=row(i).locator('input').nth(field);el.fill(value);el.press('Tab')
                def history():
                    nav('Logg');page.locator('#logHistory .log-history-item').filter(has_text='Avansert distanse').get_by_role('button',name='Fortsett',exact=True).click()
                start('Avansert distanse')
                page.locator('#seqBasis').select_option('distance')
                assert not page.locator('#seqDuration').is_visible()
                assert page.locator('#seqDistance').is_visible()
                page.locator('#seqCount').fill('4');page.locator('#seqDistance').fill('1')
                page.locator('#seqSpeed').fill('12');page.locator('#seqPause').fill('1:30')
                assert '4 km arbeid' in page.locator('#seriesPreview').text_content()
                assert '24:30' in page.locator('#seriesPreview').text_content()
                page.locator('#seqSpeedUnit').select_option('min/km')
                assert page.locator('#seqSpeed').input_value()=='5:00'
                assert '4 km arbeid' in page.locator('#seriesPreview').text_content()
                page.locator('#seqSpeedUnit').select_option('km/t')
                assert page.locator('#seqSpeed').input_value()=='12'
                # A rounded clock display must not change the exact target across toggles.
                page.locator('#seqSpeed').fill('13,7')
                for _ in range(3):
                    page.locator('#seqSpeedUnit').select_option('min/km')
                    page.locator('#seqSpeedUnit').select_option('km/t')
                assert page.locator('#seqSpeed').input_value()=='13.7'
                page.locator('#seqSpeed').fill('12')
                page.get_by_role('button',name='+ Legg til serie',exact=True).click()
                assert page.locator('#editExercises .interval-row').count()==7
                assert row(0).locator('input').first.input_value()=='1'
                assert row(0).get_by_role('button',name='Kopier del',exact=True).bounding_box()['height']>=44
                assert row(0).get_by_role('button',name='Kopier del',exact=True).bounding_box()['width']>=44
                row(0).locator('select').nth(1).select_option('min/km')
                assert row(0).locator('input').nth(1).input_value()=='5:00'
                row(0).get_by_role('button',name='Kopier del',exact=True).click()
                change(1,1,'5:30')
                assert page.evaluate('editedWorkout().exercises[1].intervalPlan.speedKmh')==3600/330
                assert page.evaluate('editedWorkout().exercises[0].intervalPlan.speedKmh')==12
                row(1).get_by_role('button',name='Flytt ned',exact=True).click()
                assert page.evaluate('editedWorkout().exercises[2].intervalPlan.speedKmh')==3600/330
                row(2).get_by_role('button',name='Slett del',exact=True).click()
                save();workout_id=page.evaluate('data.workouts.at(-1).id')
                card('Avansert distanse').get_by_role('button',name='Logg',exact=True).click()
                assert page.locator('#l4-0-0-value').input_value()=='1'
                assert page.locator('#l4-0-0-qty').input_value()==''
                assert '1 km' in page.locator('.log-ex-title small').first.text_content()
                page.locator('#l4-0-0-value').fill('0,95');page.locator('#l4-0-0-qty').fill('5:30')
                page.locator('.log-entry-controls .mark').first.click()
                page.locator('#logNotes').fill('Faktisk distanse og tid')
                page.locator('.log-save-bar .btn').first.click()
                saved=page.evaluate('structuredClone(data.logs.at(-1))')
                assert saved['status']=='partial'
                assert saved['exercises'][0]['sets'][0]['actual']['meters']==950
                assert saved['exercises'][0]['sets'][0]['actual']['seconds']==330
                assert saved['exercises'][0]['intervalPlan']['meters']==1000
                assert saved['exercises'][1]['sets'][0]['actual']=={'meters':None,'seconds':None,'speedKmh':None}
                page.reload();history()
                assert page.locator('#l4-0-0-value').input_value()=='0.95'
                assert page.locator('#l4-0-0-qty').input_value()=='5:30'
                nav('Plan');card('Avansert distanse').get_by_role('button',name='Rediger',exact=True).click()
                row(0).get_by_role('button',name='Slett del',exact=True).click();save()
                assert page.evaluate('data.logs.at(-1)')==saved
                history();assert page.locator('#l4-0-0-value').input_value()=='0.95'
                assert '1 km' in page.locator('.log-ex-title small').first.text_content()
                page.locator('#l4-0-0-qty').fill('5:')
                nav('Innstillinger')
                with page.expect_download() as event: page.get_by_role('button',name='↓ Eksporter alle data (.json)',exact=True).click()
                backup=Path(event.value.path()).read_bytes();payload=json.loads(backup)
                assert payload['logs'][-1]['exercises'][0]['intervalPlan']['meters']==1000
                assert any(d['state']['items'][0]['entries'][0].get('inputText',{}).get('qty')=='5:' for d in payload['draftsV4'].values())
                page.locator('#importFile').set_input_files({'name':'advanced.json','mimeType':'application/json','buffer':backup})
                page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
                assert page.locator('#toast').text_content()=='Data importert'
                page.reload();history();assert page.locator('#l4-0-0-qty').input_value()=='5:'
                page.locator('.log-save-bar .btn').first.click();assert 'sjekk faktisk tid' in dialogs[-1]
                assert page.evaluate('data.logs.at(-1)')==saved
                page.locator('#l4-0-0-qty').fill('5:35');page.locator('#logNotes').fill('Forsøk igjen ved feil')
                page.evaluate("""() => {window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='hyrox_performance_hub_v1')throw new DOMException('Full','QuotaExceededError');return window.realSet.call(this,k,v)}}""")
                page.locator('.log-save-bar .btn').first.click()
                assert 'kunne ikke lagres' in dialogs[-1]
                assert page.evaluate('data.logs.at(-1)')==saved
                assert page.locator('#l4-0-0-qty').input_value()=='5:35'
                page.evaluate('() => {Storage.prototype.setItem=window.realSet}')
                page.locator('.log-save-bar .btn').first.click()
                assert page.evaluate('data.logs.length')==1
                assert page.evaluate('data.logs[0].id')==saved['id']
                assert page.evaluate('data.logs[0].exercises[0].sets[0].actual.seconds')==335

                start('Avansert tid')
                page.locator('#seqDuration').fill('5');page.locator('#seqSpeed').fill('12')
                page.locator('#seqPause').fill('90');page.locator('#seqPauseUnit').select_option('sec')
                assert '4 km arbeid' in page.locator('#seriesPreview').text_content()
                page.get_by_role('button',name='+ Legg til serie',exact=True).click()
                assert page.locator('#editExercises .interval-row').count()==7
                page.get_by_role('button',name='+ Oppvarming',exact=True).click()
                row(7).locator('select').nth(2).select_option('distance');change(7,0,'2')
                page.get_by_role('button',name='+ Nedjogging',exact=True).click()
                row(8).locator('select').nth(2).select_option('distance');row(8).locator('select').nth(3).select_option('m');change(8,0,'500')
                assert page.evaluate('editedWorkout().exercises[8].intervalPlan.meters')==500
                # Add a second series, now meter-based; parts remain independently editable.
                page.locator('#seqBasis').select_option('distance');page.locator('#seqCount').fill('10')
                page.locator('#seqDistanceUnit').select_option('m');page.locator('#seqDistance').fill('400')
                page.locator('#seqSpeedUnit').select_option('min/km');page.locator('#seqSpeed').fill('5:30')
                assert '4 km arbeid' in page.locator('#seriesPreview').text_content()
                assert '22:00 arbeidstid' in page.locator('#seriesPreview').text_content()
                page.get_by_role('button',name='+ Legg til serie',exact=True).click()
                assert page.locator('#editExercises .interval-row').count()==28
                assert page.evaluate('editedWorkout().exercises[9].intervalPlan.meters')==400
                assert '2:12' in row(9).text_content()
                assert page.evaluate('intervalEstimate(editedWorkout().exercises[9].intervalPlan).seconds')==132
                page.locator('#seqSpeedUnit').select_option('min/km');page.locator('#seqSpeed').fill('5:60')
                assert 'Sjekk' in page.locator('#seriesPreview').text_content()
                page.get_by_role('button',name='+ Legg til serie',exact=True).click()
                assert page.locator('#editExercises .interval-row').count()==28
                # Focused fields stay accessible in a reduced viewport (keyboard approximation).
                if width<760:
                    page.set_viewport_size({'width':width,'height':400});page.locator('#seqSpeed').fill('5:30')
                    page.locator('#seqSpeed').scroll_into_view_if_needed();assert page.locator('#seqSpeed').is_visible()
                    page.set_viewport_size({'width':width,'height':height})
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
                if width==393: page.screenshot(path='/tmp/hph-advanced-interval-mobile.png',full_page=True)
                save();assert page.evaluate('data.workouts.slice(0,4)')==original
                assert not errors,errors
                print(f'PASS {width}x{height}: distance/time/meter series, clock pace, individual copy/move/delete, actual performance, partial/draft/history, JSON/reload, failed-save retry, mobile scrolling; no JS errors')
                context.close()
            browser.close()
    finally:
        server.shutdown();server.server_close()

if __name__=='__main__': main()
