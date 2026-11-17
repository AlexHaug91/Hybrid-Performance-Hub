"""History regression: python3 tests/browser-history.py (Playwright + Chromium)."""
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
            context = browser.new_context(viewport={'width': 390, 'height': 844})
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.goto(f'http://127.0.0.1:{server.server_port}')
            # Create two actual sessions using the mobile logging controls.
            page.evaluate("quickLog('upper','2026-11-15')")
            page.locator('#l4-0-0-value').fill('70')
            page.locator('#l4-0-0-qty').fill('6')
            page.locator('.log-entry-controls .mark').first.click()
            page.locator('#l4-0-1-value').fill('75')
            page.locator('#l4-0-1-qty').fill('5')
            page.locator('.log-entry-controls .mark').nth(1).click()
            page.locator('#logNotes').fill('Økt A opprinnelig')
            page.locator('.log-save-bar .btn').last.click()
            a = page.evaluate('data.logs[0].id')
            original_a = page.evaluate('structuredClone(data.logs[0])')
            page.get_by_text('+ Ny økt', exact=True).click()
            page.locator('#l4-0-0-value').fill('60')
            page.locator('#l4-0-0-qty').fill('8')
            page.locator('.log-entry-controls .mark').first.click()
            page.locator('#logNotes').fill('Økt B opprinnelig')
            page.locator('.log-save-bar .btn').last.click()
            b = page.evaluate('data.logs[1].id')
            original_b = page.evaluate('structuredClone(data.logs[1])')
            assert a != b
            print('PASS: two independently saved sessions on the same date/type')

            # Change the template through its existing builder, including unit, name and dose.
            page.evaluate("nav('plan');editWorkout('upper')")
            fields = page.locator('#editExercises .builder-edit-card').first.locator('input')
            fields.nth(0).fill('Erstattet øvelse'); fields.nth(0).press('Tab')
            fields.nth(1).fill('1 × 99'); fields.nth(1).press('Tab')
            fields.nth(3).fill('reps'); fields.nth(3).press('Tab')
            page.evaluate("moveInterval(0,1);removeEx(0);document.getElementById('editTitle').value='Ny mal';saveWorkout()")
            assert page.evaluate('data.logs[0]') == original_a
            assert page.evaluate('data.logs[1]') == original_b
            print('PASS: builder rename, units, dose, move and deletion do not mutate stored sessions')

            page.evaluate('editSavedLog', a)
            assert page.locator('.log-ex-title strong').first.text_content() == 'Benkpress'
            assert page.locator('#l4-0-0-value').input_value() == '70'
            assert page.locator('#l4-0-1-value').input_value() == '75'
            assert page.locator('#l4-0-1-qty').input_value() == '5'
            page.locator('#logNotes').fill('Kladd A')
            page.locator('#l4-0-0-value').fill('72.5')
            page.evaluate('editSavedLog', b)
            assert page.locator('#l4-0-0-value').input_value() == '60'
            page.locator('#logNotes').fill('Kladd B')
            page.reload()
            page.evaluate('editSavedLog', a)
            assert page.locator('#logNotes').input_value() == 'Kladd A'
            assert page.locator('#l4-0-0-value').input_value() == '72.5'
            assert page.evaluate('logEditingId') == a
            print('PASS: original history renders; ID-specific drafts survive switches and reload')

            page.locator('.log-save-bar .btn').last.click()
            assert page.evaluate('data.logs.length') == 2
            assert page.evaluate('data.logs[1]') == original_b
            saved_a = page.evaluate('data.logs[0]')
            assert saved_a['title'] == original_a['title']
            assert saved_a['exercises'][1:] == original_a['exercises'][1:]
            assert saved_a['exercises'][0]['sets'][0]['value'] == 72.5
            assert saved_a['exercises'][0]['sets'][1]['qty'] == 5
            page.evaluate('editSavedLog', b)
            assert page.locator('#logNotes').input_value() == 'Kladd B'
            page.locator('.log-save-bar .btn').last.click()
            assert page.evaluate('data.logs[0]') == saved_a
            assert page.evaluate('data.logs[1].notes') == 'Kladd B'
            print('PASS: saving edits changes only the selected unique ID')

            # Back up pending edits in both sessions and import through the actual UI.
            page.evaluate('editSavedLog', a); page.locator('#logNotes').fill('JSON-kladd A')
            page.evaluate('editSavedLog', b); page.locator('#logNotes').fill('JSON-kladd B')
            page.evaluate("nav('settings')")
            with page.expect_download() as event:
                page.get_by_text('↓ Eksporter alle data (.json)', exact=True).click()
            backup = Path(event.value.path()).read_bytes()
            page.locator('#importFile').set_input_files({'name': 'history.json', 'mimeType': 'application/json', 'buffer': backup})
            page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
            assert page.locator('#toast').text_content() == 'Data importert'
            page.evaluate('editSavedLog', a); assert page.locator('#logNotes').input_value() == 'JSON-kladd A'
            page.evaluate('editSavedLog', b); assert page.locator('#logNotes').input_value() == 'JSON-kladd B'
            print('PASS: JSON export/import preserves both ID-specific drafts and original snapshots')

            # A new session still uses the edited template, not an historical snapshot.
            page.get_by_text('+ Ny økt', exact=True).click()
            assert page.locator('.log-ex-title strong').first.text_content() == 'Erstattet øvelse'
            assert page.evaluate('logEditingId') is None
            assert not errors, errors
            print('PASS: new sessions use edited template; no JavaScript errors')
            context.close(); browser.close()
    finally:
        server.shutdown(); server.server_close()


if __name__ == '__main__':
    main()
