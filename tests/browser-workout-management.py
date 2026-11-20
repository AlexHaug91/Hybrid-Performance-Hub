"""Workout management E2E: python3 tests/browser-workout-management.py."""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright
from browser_plan_helpers import plan_action

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
                accept = {'value': True}
                def handle(dialog):
                    dialogs.append(dialog.message)
                    dialog.accept() if accept['value'] else dialog.dismiss()
                page.on('dialog', handle)
                page.goto(f'http://127.0.0.1:{server.server_port}')

                def nav(label):
                    page.locator('#mobileNav' if width < 760 else '#sidenav').get_by_role('button', name=label, exact=False).click()

                def card(title):
                    return page.locator('#planCards .workout-card').filter(has_text=title)

                def save_template():
                    page.get_by_role('button', name='Lagre øktoppsett', exact=False).click()
                    assert not page.locator('#planEditor').is_visible()

                nav('Plan')
                original = page.evaluate("structuredClone(data.workouts.find(w=>w.id==='interval'))")
                plan_action(page, card('Intervaller'), 'Kopier').click()
                page.locator('#editTitle').fill('Intervallkopi')
                page.locator('#editDay').select_option('1')
                page.locator('.interval-row').nth(1).locator('input').nth(1).fill('14')
                page.locator('.interval-row').nth(1).locator('input').nth(1).press('Tab')
                save_template()
                copied_id = page.evaluate('data.workouts.at(-1).id')
                assert copied_id != 'interval'
                assert page.evaluate("data.workouts.find(w=>w.id==='interval')") == original
                card('Intervallkopi').get_by_role('button', name='Logg økt', exact=True).click()
                assert page.locator('#l4-1-0-value').input_value() == '14'
                page.get_by_role('button', name='✓ Registrer alle deler etter planen', exact=True).click()
                page.locator('.log-save-bar .btn').last.click()
                history_id = page.evaluate('data.logs[0].id')
                history = page.evaluate('structuredClone(data.logs[0])')

                nav('Plan'); plan_action(page, card('Intervallkopi'), 'Flytt').click()
                assert page.locator('#editDay').is_enabled()
                page.locator('#editDay').select_option('0'); save_template()
                assert page.evaluate('data.workouts.at(-1).id') == copied_id
                assert page.evaluate('data.workouts.at(-1).day') == 0
                assert page.evaluate('data.logs[0]') == history
                page.reload(); nav('Plan')
                assert 'SØN' in card('Intervallkopi').text_content()

                # Removing a template is cancellable and cannot remove its log.
                accept['value'] = False
                plan_action(page, card('Intervallkopi'), 'Fjern').click()
                assert card('Intervallkopi').count() == 1
                accept['value'] = True
                plan_action(page, card('Intervallkopi'), 'Fjern').click()
                assert card('Intervallkopi').count() == 0
                assert page.evaluate('data.logs[0]') == history
                assert page.locator(f'#logType option[value="{copied_id}"]').count() == 0
                nav('Logg')
                page.locator('#logHistory .log-history-item').get_by_role('button', name='Vis / rediger', exact=True).click()
                assert page.locator('#logType').input_value() == copied_id
                assert float(page.locator('#l4-1-0-value').input_value()) == 14
                page.locator('#logNotes').fill('Historikk etter arkivering')
                page.locator('.log-save-bar .btn').last.click()
                assert page.evaluate('data.logs[0].id') == history_id
                assert page.evaluate('data.logs[0].notes') == 'Historikk etter arkivering'
                assert page.get_by_role('button', name='+ Ny økt', exact=True).count() == 0

                # A draft without a saved record remains accessible from Plan.
                page.locator('#logType').select_option('upper')
                assert page.locator(f'#logType option[value="{copied_id}"]').count() == 0
                page.locator('#l4-0-0-value').fill('72.5')
                page.locator('#logNotes').fill('Beholdt styrkekladd')
                nav('Plan'); plan_action(page, card('Overkropp + rolig løp'), 'Fjern').click()
                assert card('Overkropp + rolig løp').count() == 0
                assert page.locator('#archivedDraftsCard').is_visible()
                page.reload(); nav('Plan')
                page.locator('#archivedDrafts').get_by_role('button', name='Fortsett kladd', exact=True).click()
                assert page.locator('#l4-0-0-value').input_value() == '72.5'
                assert page.locator('#logNotes').input_value() == 'Beholdt styrkekladd'
                page.locator('.log-entry-controls .mark').first.click()
                page.locator('.log-save-bar .btn').first.click()
                assert page.evaluate('data.logs.at(-1).status') == 'partial'
                page.reload(); nav('Logg')
                page.locator('#logHistory .log-history-item').filter(has_text='Beholdt styrkekladd').get_by_role('button', name='Fortsett', exact=True).click()
                assert page.locator('#l4-0-0-value').input_value() == '72.5'
                page.locator('.log-save-bar .btn').last.click()

                # Actual file download/import includes the archive references and historical records.
                nav('Innstillinger')
                with page.expect_download() as event:
                    page.get_by_role('button', name='↓ Eksporter alle data (.json)', exact=True).click()
                backup = Path(event.value.path()).read_bytes()
                assert sum(bool(w.get('archived')) for w in json.loads(backup)['workouts']) == 2
                page.locator('#importFile').set_input_files({'name': 'management.json', 'mimeType': 'application/json', 'buffer': backup})
                page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
                assert page.locator('#toast').text_content() == 'Data importert'
                nav('Plan'); assert card('Intervallkopi').count() == 0
                nav('Logg'); assert page.locator('#logHistory .log-history-item').count() == 2

                # Failed archive must not disappear from Plan or corrupt existing data.
                nav('Plan')
                before = page.evaluate('JSON.stringify(data)')
                page.evaluate("""() => {window.realSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='hyrox_performance_hub_v1')throw new DOMException('Full','QuotaExceededError');return window.realSetItem.call(this,key,value)}}""")
                plan_action(page, card('Bein + lett kondisjon'), 'Fjern').click()
                assert page.evaluate('JSON.stringify(data)') == before
                assert card('Bein + lett kondisjon').count() == 1
                assert 'kunne ikke fjernes' in dialogs[-1]
                page.evaluate('() => {Storage.prototype.setItem=window.realSetItem}')
                plan_action(page, card('Bein + lett kondisjon'), 'Fjern').click()
                plan_action(page, card('HYROX + løping'), 'Fjern').click()
                plan_action(page, card('Intervaller'), 'Fjern').click()
                assert page.locator('#planCards .workout-card').count() == 0
                assert 'Ingen aktive økter' in page.locator('#planCards').text_content()
                page.reload(); nav('Logg')
                assert page.locator('#saveCompleteButton').is_disabled()
                page.locator('#logHistory .log-history-item').filter(has_text='Historikk etter arkivering').get_by_role('button', name='Vis / rediger', exact=True).click()
                assert page.locator('#logType').input_value() == copied_id
                assert page.locator('#saveCompleteButton').is_enabled()
                nav('Plan'); page.get_by_role('button', name='Ny økt', exact=True).click()
                page.locator('#editTitle').fill('Ny start')
                page.get_by_role('button', name='+ Legg til øvelse', exact=True).click()
                save_template(); assert page.locator('#planCards .workout-card').count() == 1
                for label in ['Oversikt','Plan','Logg','Progresjon','Road to Pro','Kosthold','Innstillinger']:
                    nav(label)
                    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'), (width,label)
                assert not errors, errors
                print(f'PASS {width}x{height}: copy, move, archive/cancel, history edit, rescued draft/partial, reload, JSON, storage failure, empty plan; no JS errors', flush=True)
                if width == 393:
                    nav('Plan'); page.screenshot(path='/tmp/hph-management-mobile.png')
                context.close()
            browser.close()
    finally:
        server.shutdown(); server.server_close()


if __name__ == '__main__':
    main()
