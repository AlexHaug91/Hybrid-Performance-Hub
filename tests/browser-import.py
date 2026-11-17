"""Browser regression checks. Run: python3 tests/browser-import.py

Requires Python Playwright and Chromium (/usr/bin/chromium in the cloud environment).
Uses an isolated browser context and a temporary local HTTP server; no user data is used.
"""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MAIN = 'hyrox_performance_hub_v1'
DRAFTS = 'hyrox_performance_hub_v4_drafts'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': 390, 'height': 844})
            page = context.new_page()
            errors, dialogs = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('dialog', lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
            page.goto(f'http://127.0.0.1:{server.server_port}')

            def upload(value, raw=False):
                page.evaluate("nav('settings')")
                content = value if raw else json.dumps(value, ensure_ascii=False)
                page.locator('#importFile').set_input_files({
                    'name': 'backup.json', 'mimeType': 'application/json', 'buffer': content.encode()})
                page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")

            def stored():
                return page.evaluate('({main:localStorage.getItem(KEY),drafts:localStorage.getItem(DRAFT_KEY)})')

            # Existing builder and logging workflow, including copying and reordering.
            for button in page.locator('.mobile-nav button').all():
                button.click()
                assert page.locator('.tabpage.active').count() == 1
            page.evaluate("nav('plan');editWorkout('upper');duplicateEx(0);moveInterval(1,1);saveWorkout()")
            assert page.evaluate("data.workouts.find(w=>w.id==='upper').exercises.length") == 7
            page.evaluate("editWorkout('interval');setSeriesPreset(4,4,12.5,2);addIntervalSeries();saveWorkout()")
            assert page.evaluate('data.workouts[0].exercises.length') == 16
            page.evaluate("quickLog('interval','2026-11-16')")
            page.locator('#l4-0-0-value').fill('10.5')
            page.locator('#l4-0-0-qty').fill('11')
            page.locator('.log-entry-controls .mark').first.click()
            page.locator('.log-save-bar .btn').first.click()
            assert page.evaluate('data.logs[0].status') == 'partial'
            page.locator('#logNotes').fill('Aktiv kladd må bevares')
            before = stored()
            print('PASS: mobile navigation, interval/strength builders, logging and draft')

            upload('{bad JSON', raw=True)
            assert stored() == before
            malformed = json.loads((ROOT / 'tests/fixtures/backup-v3.json').read_text())
            malformed['nutrition'] = [{'date': '2026-11-16', 'weight': 'bad', 'kcal': None, 'protein': None, 'note': ''}]
            upload(malformed)
            assert stored() == before
            print('PASS: invalid JSON/types preserve existing storage and active draft')

            payload = '<img src=x onerror="globalThis.importExecuted=1">\' & </script><script>globalThis.importExecuted=1</script>'
            valid = json.loads((ROOT / 'tests/fixtures/backup-v4.json').read_text())
            valid['workouts'][0]['title'] = payload
            valid['logs'][0]['notes'] = payload
            valid['logs'][0]['title'] = payload
            valid['pro'][0]['name'] = payload
            valid['nutrition'] = [{'date': '2026-11-16', 'weight': 80, 'kcal': None, 'protein': None, 'note': payload}]
            upload(valid)
            assert page.locator('#toast').text_content() == 'Data importert'
            assert page.locator('#logType').input_value() == 'interval'
            for button in page.locator('.mobile-nav button').all():
                button.click()
            assert page.evaluate('globalThis.importExecuted') is None
            assert page.locator('.app img').count() == 0
            assert page.locator('.app script').count() == 0
            assert page.locator('#logHistory').text_content().find(payload) >= 0
            page.evaluate("quickLog('interval','2026-11-16')")
            assert page.locator('#logNotes').input_value() == 'Kladd fra v4'
            page.reload()
            page.evaluate("quickLog('interval','2026-11-16')")
            assert page.locator('#logNotes').input_value() == 'Kladd fra v4'
            print('PASS: valid v4 import and drafts survive reload; hostile text remains plain text')

            # Download the actual recovery file through the existing backup area.
            page.evaluate("nav('settings')")
            with page.expect_download() as download:
                page.get_by_text('↓ Last ned kopi fra før siste import', exact=True).click()
            recovery = json.loads(Path(download.value.path()).read_text())
            assert recovery['logs'][0]['status'] == 'partial'
            recovery_draft = next(d for d in recovery['draftsV4'].values() if d['editingId'] == recovery['logs'][0]['id'])
            assert recovery_draft['state']['notes'] == 'Aktiv kladd må bevares'
            upload(recovery)
            page.evaluate("quickLog('interval','2026-11-16')")
            assert page.locator('#logNotes').input_value() == 'Aktiv kladd må bevares'
            assert page.locator('#l4-0-0-value').input_value() == '10.5'
            print('PASS: downloaded recovery file restores previous history, plan and active draft')

            # Reject JavaScript in identifiers used in inline event handlers.
            before = stored()
            invalid_id = json.loads(json.dumps(valid))
            invalid_id['logs'][0]['id'] = "x');globalThis.importExecuted=1;//"
            upload(invalid_id)
            assert stored() == before
            assert page.evaluate('globalThis.importExecuted') is None
            print('PASS: script-bearing identifiers rejected before rendering')

            # Simulate failure at the last write, after imported drafts have been written.
            page.evaluate("""() => {
                window.realSetItem = Storage.prototype.setItem;
                Storage.prototype.setItem = function(key, value) {
                    if (key === 'hyrox_performance_hub_v1') throw new DOMException('Full', 'QuotaExceededError');
                    return window.realSetItem.call(this, key, value);
                };
            }""")
            upload(valid)
            assert stored() == before
            assert page.locator('#toast').text_content() != 'Data importert'
            assert 'Kunne ikke importere' in dialogs[-1]
            page.reload()
            page.evaluate("quickLog('interval','2026-11-16')")
            assert page.locator('#logNotes').input_value() == 'Aktiv kladd må bevares'
            upload(valid)
            assert page.locator('#toast').text_content() == 'Data importert'
            print('PASS: failed import rolls drafts back, reload preserves data, retry succeeds')

            upload(json.loads((ROOT / 'tests/fixtures/backup-v3.json').read_text()))
            page.evaluate("quickLog('upper','2026-11-15')")
            assert page.locator('#l4-0-0-value').input_value() == '65'
            assert page.locator('.log-entry-controls .mark').first.get_attribute('aria-pressed') == 'true'
            page.locator('.log-save-bar .btn').last.click()
            assert page.evaluate('data.logs.length') == 1
            assert page.evaluate('data.logs[0].exercises[0].value') == 65
            assert page.evaluate("'sets' in data.logs[0].exercises[0]") is False
            assert not errors, errors
            print('PASS: legacy log import, editing and saving; no JavaScript errors')
            context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
