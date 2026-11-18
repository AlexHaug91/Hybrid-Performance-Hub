"""Free workout builder E2E: python3 tests/browser-free-workout-builder.py."""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            for width, height in [(1280, 900), (375, 667), (393, 852)]:
                context = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=width < 760, has_touch=width < 760)
                page = context.new_page(); errors, dialogs = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('dialog', lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
                page.goto(f'http://127.0.0.1:{server.server_port}')
                original = page.evaluate('structuredClone(data.workouts)')

                def nav(label):
                    page.locator('#mobileNav' if width < 760 else '#sidenav').get_by_role('button', name=label, exact=False).click()

                def start(title, mode='mixed'):
                    nav('Plan'); page.get_by_role('button', name='Ny økt', exact=True).click()
                    page.locator('#editTitle').fill(title)
                    page.locator('#editDay').select_option('1')
                    page.locator('#editLocation').fill('Eget senter')
                    page.locator('#editFocus').fill('Eget fokus')
                    page.locator('#editDesc').fill('Min egen øktbeskrivelse')
                    page.locator('#editMode').select_option(mode)

                def save():
                    page.get_by_role('button', name='Lagre øktoppsett', exact=False).click()
                    assert not page.locator('#planEditor').is_visible()

                def card(title):
                    return page.locator('#planCards .workout-card').filter(has_text=title)

                start('Min styrke')
                assert page.locator('#planCards .workout-card').count() == 4
                page.get_by_role('button', name='+ Legg til øvelse', exact=True).click()
                inputs = page.locator('.builder-edit-card').first.locator('input')
                for index, value in [(0, 'Egen benkpress'), (1, '3 × 8'), (2, '60')]:
                    inputs.nth(index).fill(value); inputs.nth(index).press('Tab')
                save()
                strength_id = page.evaluate('data.workouts.at(-1).id')
                assert card('Min styrke').count() == 1
                assert page.locator('#logType option').count() == 5
                page.reload(); nav('Plan'); card('Min styrke').get_by_role('button', name='Logg', exact=True).click()
                assert page.locator('#logType').input_value() == strength_id
                assert page.locator('.log-entry').count() == 3
                page.get_by_text('✓ Marker alle sett utført', exact=True).click()
                page.locator('#logNotes').fill('Ny styrkeøkt loggført')
                page.locator('.log-save-bar .btn').last.click()
                assert page.evaluate('data.logs[0].type') == strength_id

                start('Mine intervaller', 'interval')
                page.get_by_role('button', name='+ Oppvarming', exact=True).click()
                page.get_by_role('button', name='4 × 4', exact=True).click()
                page.get_by_role('button', name='+ Legg til serie', exact=True).click()
                page.get_by_role('button', name='+ Nedjogging', exact=True).click()
                page.locator('.interval-row').nth(1).locator('select').nth(1).select_option('min/km')
                save()
                interval_id = page.evaluate('data.workouts.at(-1).id')
                assert interval_id not in ['interval', strength_id]
                assert page.evaluate('data.workouts.filter(w=>w.day===1).length') == 3
                card('Mine intervaller').get_by_role('button', name='Logg', exact=True).click()
                assert page.locator('#logType').input_value() == interval_id
                assert page.locator('#l4-1-0-value').input_value() == '4.80'
                assert page.locator('#l4-1-0-qty').input_value() == '4'
                page.get_by_role('button', name='✓ Registrer alle deler etter planen', exact=True).click()
                page.locator('.log-save-bar .btn').last.click()
                history_id = page.evaluate('data.logs.at(-1).id')
                history = page.evaluate('structuredClone(data.logs.at(-1))')
                nav('Plan'); card('Mine intervaller').get_by_role('button', name='Rediger', exact=True).click()
                assert page.locator('#editMode').is_disabled()
                page.locator('.interval-row').nth(1).get_by_role('button', name='Slett del', exact=True).click()
                page.locator('#editTitle').fill('Mine intervaller endret'); save()
                assert page.evaluate('data.logs.at(-1)') == history
                nav('Logg'); page.locator('#logHistory .log-history-item').filter(has_text='Mine intervaller').get_by_role('button', name='Vis / rediger', exact=True).click()
                assert float(page.locator('#l4-1-0-value').input_value()) == 4.8
                page.locator('#logNotes').fill('Historisk kladd for egen intervall-ID')

                start('Min HYROX og løping')
                page.get_by_role('button', name='+ Legg til øvelse', exact=True).click()
                inputs = page.locator('.builder-edit-card').first.locator('input')
                for index, value in [(0, 'Eget løp'), (1, '4 × 1 km'), (2, '4'), (3, 'km')]:
                    inputs.nth(index).fill(value); inputs.nth(index).press('Tab')
                save()
                card('Min HYROX og løping').get_by_role('button', name='Logg', exact=True).click()
                assert page.locator('#l4-0-0-value').input_value() == '1'
                page.get_by_text('✓ Marker alle sett utført', exact=True).click()
                page.locator('.log-save-bar .btn').last.click()
                assert page.evaluate('data.logs.at(-1).exercises[0].value') == 4
                assert page.evaluate('data.workouts.slice(0,4)') == original

                nav('Innstillinger')
                with page.expect_download() as event:
                    page.get_by_role('button', name='↓ Eksporter alle data (.json)', exact=True).click()
                backup = Path(event.value.path()).read_bytes()
                assert len(json.loads(backup)['workouts']) == 7
                page.locator('#importFile').set_input_files({'name': 'v5.json', 'mimeType': 'application/json', 'buffer': backup})
                page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
                assert page.locator('#toast').text_content() == 'Data importert'
                page.reload(); nav('Plan')
                assert page.locator('#planCards .workout-card').count() == 7
                assert page.locator('#logType option').count() == 7
                nav('Logg')
                page.locator('#logHistory .log-history-item').filter(has_text='Mine intervaller').get_by_role('button', name='Vis / rediger', exact=True).click()
                assert page.evaluate('logEditingId') == history_id
                assert page.locator('#logNotes').input_value() == 'Historisk kladd for egen intervall-ID'

                # Failed creation must retain the editor and allow retry with the same ID.
                start('Lagringsfeil')
                page.get_by_role('button', name='+ Legg til øvelse', exact=True).click()
                pending_id = page.evaluate('editing')
                page.evaluate("""() => {window.realSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='hyrox_performance_hub_v1')throw new DOMException('Full','QuotaExceededError');return window.realSetItem.call(this,key,value)}}""")
                page.get_by_role('button', name='Lagre øktoppsett', exact=False).click()
                assert page.locator('#planEditor').is_visible()
                assert page.evaluate('data.workouts.length') == 7
                assert page.locator('#editTitle').input_value() == 'Lagringsfeil'
                assert 'Øktoppsettet kunne ikke lagres' in dialogs[-1]
                page.evaluate('() => {Storage.prototype.setItem=window.realSetItem}')
                save(); assert page.evaluate('data.workouts.at(-1).id') == pending_id

                for label in ['Oversikt','Plan','Logg','Progresjon','Road to Pro','Kosthold','Innstillinger']:
                    nav(label)
                    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'), (width, label, 'horizontal overflow')
                assert not errors, errors
                print(f'PASS {width}x{height}: custom strength/interval/distance, same-day templates, logs, history, reload, JSON, failed-save retry, navigation; no JS errors')
                if width == 393:
                    nav('Plan'); page.screenshot(path='/tmp/hph-v5-mobile-plan.png')
                context.close()
            browser.close()
    finally:
        server.shutdown(); server.server_close()


if __name__ == '__main__':
    main()
