"""Draft/distance regression: python3 tests/browser-drafts-distance.py."""
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
            page = context.new_page(); errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.goto(f'http://127.0.0.1:{server.server_port}')
            page.evaluate("quickLog('upper','2026-11-17')")
            page.locator('#l4-0-0-value').fill('72.5')
            page.locator('#l4-0-0-qty').fill('9')
            page.locator('#logRpe').fill('8')
            page.locator('#logDuration').fill('55')
            assert page.evaluate('countLog().done') == 0
            original_draft = page.evaluate('structuredClone(logState)')
            page.evaluate("nav('plan');editWorkout('upper');moveInterval(0,1);duplicateEx(1);removeEx(0);updateEditEx(0,'name','Ny benk');saveWorkout()")
            assert page.evaluate('logState') == original_draft
            page.reload(); page.evaluate("quickLog('upper','2026-11-17')")
            assert page.locator('#l4-0-0-value').input_value() == '72.5'
            assert page.locator('#l4-0-0-qty').input_value() == '9'
            assert page.locator('#logRpe').input_value() == '8'
            assert page.locator('#logDuration').input_value() == '55'
            assert page.locator('.log-ex-title strong').first.text_content() == 'Benkpress'
            assert page.evaluate('countLog().done') == 0
            print('PASS: uncompleted draft retains values, RPE, duration and exercise snapshot after builder changes/reload')

            page.locator('.log-entry-controls .mark').first.click()
            page.locator('.log-save-bar .btn').first.click()
            page.reload(); page.evaluate("quickLog('upper','2026-11-17')")
            assert page.locator('#l4-0-0-value').input_value() == '72.5'
            assert page.locator('.log-entry-controls .mark').first.get_attribute('aria-pressed') == 'true'
            print('PASS: ongoing session continues from preserved draft')

            page.evaluate("quickLog('hyrox','2026-11-17')")
            assert page.locator('#l4-0-0-value').input_value() == '1'
            assert page.locator('#l4-0-3-value').input_value() == '1'
            assert '4 km totalt' in page.locator('.log-ex-title small').first.text_content()
            assert '1 km per drag' in page.locator('.log-ex-title small').first.text_content()
            page.get_by_text('✓ Marker alle sett utført', exact=True).first.click()
            page.locator('.log-save-bar .btn').last.click()
            saved_id = page.evaluate('logEditingId')
            assert page.evaluate("data.logs.find(l=>l.type==='hyrox').exercises[0].value") == 4
            print('PASS: 4 × 1 km displays 1 km per entry and saves 4 km total')

            # Update the plan; the already saved session must remain unchanged.
            historical = page.evaluate("structuredClone(data.logs.find(l=>l.type==='hyrox'))")
            page.evaluate("nav('plan');editWorkout('hyrox');updateEditEx(0,'name','Roing');updateEditEx(0,'dose','4 × 500 m');updateEditEx(0,'target','2');saveWorkout()")
            page.evaluate("quickLog('hyrox','2026-11-18')")
            assert page.locator('#l4-0-0-value').input_value() == '0.5'
            page.get_by_text('✓ Marker alle sett utført', exact=True).first.click()
            page.locator('.log-save-bar .btn').last.click()
            assert page.evaluate("data.logs.find(l=>l.date==='2026-11-18').exercises[0].value") == 2
            assert page.evaluate("data.logs.find(l=>l.date==='2026-11-17'&&l.type==='hyrox')") == historical
            print('PASS: another distance exercise converts 500 m to 0.5 km per entry; historical results remain unchanged')

            page.evaluate("nav('settings')")
            with page.expect_download() as event:
                page.get_by_text('↓ Eksporter alle data (.json)', exact=True).click()
            backup = Path(event.value.path()).read_bytes()
            page.locator('#importFile').set_input_files({'name': 'distance.json', 'mimeType': 'application/json', 'buffer': backup})
            page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
            assert page.locator('#toast').text_content() == 'Data importert'
            page.evaluate('editSavedLog', saved_id)
            assert page.locator('#l4-0-0-value').input_value() == '1'
            assert '4 km totalt' in page.locator('.log-ex-title small').first.text_content()
            print('PASS: JSON backup round trip preserves the historical distance plan and recorded entries')

            page.evaluate("quickLog('interval','2026-11-17')")
            assert page.locator('#l4-1-0-value').input_value() == '12.5'
            assert page.locator('#l4-1-0-qty').input_value() == '4'
            page.evaluate("nav('plan');editWorkout('interval');updateIntervalUnit(1,'min/km');saveWorkout()")
            page.evaluate("quickLog('interval','2026-11-18')")
            assert page.locator('#l4-1-0-value').input_value() == '4:48'
            assert page.locator('#l4-1-0-qty').input_value() == '4:00'
            print('PASS: time intervals, km/h and min/km remain supported')
            page.evaluate("nav('plan');editWorkout('hyrox');updateEditEx(0,'dose','4 × 1 km + 2 × 500 m');saveWorkout();quickLog('hyrox','2026-11-19')")
            assert page.locator('#l4-0-0-value').input_value() == ''
            assert 'uten distansemål' in page.locator('.log-ex-title small').first.text_content()
            assert not errors, errors
            print('PASS: compound doses do not prefill an incorrect subtotal; no JavaScript errors')
            context.close(); browser.close()
    finally:
        server.shutdown(); server.server_close()


if __name__ == '__main__':
    main()
