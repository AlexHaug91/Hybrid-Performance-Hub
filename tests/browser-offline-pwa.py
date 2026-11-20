"""Real service-worker/offline regression under the GitHub Pages subpath.
Uses isolated temporary app copies; update fixtures never alter repository files.
"""
import json
import shutil
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE_RELEASE='offline-pwa-20261120-1'
FILES=['index.html','pwa.js','sw.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png']
class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.webmanifest':'application/manifest+json','.js':'application/javascript'}
    def log_message(self,*args):pass
    def do_GET(self):
        if self.server.fail_icon and urlsplit(self.path).path.endswith('/icon-512.png'):
            self.send_error(503);return
        try:super().do_GET()
        except (BrokenPipeError,ConnectionResetError):pass  # expected when an offline probe is aborted
    def end_headers(self):
        self.send_header('Cache-Control','no-store');super().end_headers()

def message(page,kind='CACHE_STATUS'):
    return page.evaluate("""type => new Promise((resolve,reject)=>{const c=new MessageChannel();const timer=setTimeout(()=>reject(Error('worker timeout')),7000);c.port1.onmessage=e=>{clearTimeout(timer);c.port1.close();resolve(e.data)};navigator.serviceWorker.controller.postMessage({type},[c.port2])})""",kind)
def wait_ready(page):
    try:
        page.wait_for_function("navigator.serviceWorker.controller && /Offline-filer klare|Offline files ready/.test(document.getElementById('pwaStatus')?.textContent)",timeout=20000)
    except Exception:
        print('PWA DEBUG',page.evaluate('''async()=>({status:document.getElementById('pwaStatus')?.textContent,update:document.getElementById('pwaUpdate')?.textContent,cache:await caches.keys(),workers:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.state,waiting:r.waiting?.state,installing:r.installing?.state}))})'''),flush=True)
        raise
def check_update(page):
    page.locator('#pwaCheckUpdates').click()
    page.wait_for_function("document.getElementById('pwaApplyUpdate') && !document.getElementById('pwaUpdate').hidden",timeout=20000)
def release_of(page):return page.locator('meta[name="hybrid-shell-release"]').get_attribute('content')

def wait_release(page,release):
    try:
        page.wait_for_function("release => document.querySelector('meta[name=\"hybrid-shell-release\"]').content===release",arg=release,timeout=25000)
    except Exception:
        print('UPDATE DEBUG',page.evaluate('''() => ({message:document.getElementById('pwaUpdate').textContent,reason:document.getElementById('pwaUpdate').dataset.reason,progress:document.getElementById('pwaUpdateProgress').open,context:sessionStorage.getItem('hybrid_pwa_update_return'),states:[...logSaveStates],editing,pendingWeekAction,importBusy})'''),flush=True)
        print('WORKER STATUS',message(page),page.evaluate('navigator.serviceWorker.getRegistration().then(r=>({active:r.active?.state,waiting:r.waiting?.state,installing:r.installing?.state}))'),flush=True)
        raise

def main():
    with TemporaryDirectory(prefix='hph-pwa-browser-') as tmp:
        base=Path(tmp);app=base/'Hybrid-Performance-Hub';app.mkdir()
        def release(number):
            value=BASE_RELEASE if number==1 else f'offline-pwa-test-{number}'
            for name in FILES:
                dest=app/name;dest.parent.mkdir(parents=True,exist_ok=True)
                if name in ['index.html','pwa.js','sw.js']:
                    source=(ROOT/name).read_text().replace(BASE_RELEASE,value)
                    dest.write_text(source)
                else:shutil.copyfile(ROOT/name,dest)
            return value
        release(1)
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(base)));server.fail_icon=False
        Thread(target=server.serve_forever,daemon=True).start()
        url=f'http://127.0.0.1:{server.server_port}/Hybrid-Performance-Hub/'
        try:
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                for width,height in [(1280,900),(320,640),(375,667),(393,852)]:
                    release(1);server.fail_icon=False
                    context=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<760,has_touch=width<760)
                    page=context.new_page();errors=[];dialogs=[]
                    page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:print('CONSOLE',m.text,flush=True) if m.type=='warning' else None)
                    page.on('dialog',lambda d:(dialogs.append(d.message),d.accept()))
                    page.goto(url);wait_ready(page)
                    assert (message(page))['ready'] is True
                    scope=page.evaluate('navigator.serviceWorker.getRegistration().then(r=>r.scope)');assert scope==url
                    cdp=context.new_cdp_session(page);manifest=cdp.send('Page.getAppManifest');assert manifest['errors']==[],manifest
                    assert json.loads(manifest['data'])['start_url']=='./'
                    names=page.evaluate('caches.keys()');owned=[n for n in names if n.startswith('hybrid-shell:')];assert len(owned)==1
                    resources=page.evaluate('''async name => (await (await caches.open(name)).keys()).map(r=>r.url)''',owned[0])
                    assert len(resources)==7 and all(r.startswith(url) for r in resources)
                    def nav(label):page.locator('#mobileNav' if width<760 else '#sidenav').get_by_role('button',name=label,exact=False).click()
                    # Create an actual planned occurrence before disconnecting.
                    nav('Plan');page.get_by_role('button',name='Ekstra økt denne uken',exact=True).click()
                    page.locator('#extraWorkout').select_option('upper');page.locator('#weekDay').select_option(str(page.evaluate('new Date().getDay()')))
                    page.get_by_role('button',name='Lagre planendring',exact=True).click()
                    occurrence=page.evaluate('data.weekPlans[iso(startWeek(new Date()))].extras[0].id')
                    original_workouts=page.evaluate('structuredClone(data.workouts)')
                    context.set_offline(True)
                    nav('Oversikt');page.locator(f'#todayWorkouts [data-today-occurrence="{occurrence}"]').get_by_role('button',name='Start økt',exact=True).click()
                    page.locator('#l4-0-0-value').fill('77.5');page.locator('#l4-0-0-qty').fill('6');page.locator('#logNotes').fill('Offline draft')
                    assert page.locator('#logSaveStatus').get_attribute('data-save-state')=='draft'
                    nav('Innstillinger');page.locator('#languageChoice').select_option('en')
                    assert 'Offline files ready' in page.locator('#pwaStatus').text_content()
                    for label in ['Overview','Plan','Log','Progress','Road to Pro','Nutrition','Settings']:
                        nav(label);assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(width,label)
                    with page.expect_download() as event:page.get_by_role('button',name='↓ Export all data (.json)',exact=True).click()
                    backup=Path(event.value.path()).read_bytes()
                    page.locator('#importFile').set_input_files({'name':'offline.json','mimeType':'application/json','buffer':backup})
                    page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
                    assert page.locator('#toast').text_content()=='Data imported'
                    page.reload();wait_ready(page)
                    nav('Overview');page.locator(f'#todayWorkouts [data-today-occurrence="{occurrence}"]').get_by_role('button',name='Continue workout',exact=True).click()
                    assert page.locator('#l4-0-0-value').input_value()=='77.5'
                    assert page.locator('#l4-0-0-qty').input_value()=='6'
                    assert page.locator('#logNotes').input_value()=='Offline draft'
                    assert page.evaluate('logState.occurrenceId')==occurrence
                    page.locator('.log-entry-controls .mark').first.click();page.locator('#saveCompleteButton').click()
                    saved=page.evaluate('structuredClone(data.logs[0])');assert saved['exercises'][0]['sets'][0]['value']==77.5
                    assert saved['occurrenceId']==occurrence
                    page.locator('#logNotes').fill('Unsaved history edit offline')
                    raw_main=page.evaluate('localStorage.getItem(KEY)')
                    # A new page opened offline must be served by the worker, not just the previous DOM.
                    page.close();page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:print('CONSOLE',m.text,flush=True) if m.type=='warning' else None);page.on('dialog',lambda d:d.accept())
                    page.goto(url+'index.html');wait_ready(page);assert page.locator('html').get_attribute('lang')=='en'
                    assert page.evaluate('localStorage.getItem(KEY)')==raw_main
                    # A misleading navigator hint cannot make cached/offline fetches look connected.
                    page.evaluate("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});dispatchEvent(new Event('online'))")
                    page.wait_for_function("document.getElementById('pwaStatus').textContent.includes('No confirmed network connection')")
                    assert 'Offline files ready' in page.locator('#pwaStatus').text_content()
                    page.evaluate("delete navigator.onLine;dispatchEvent(new Event('offline'))")
                    nav('Log');page.locator('#logHistory').get_by_role('button',name='View / edit',exact=True).click()
                    assert page.locator('#logNotes').input_value()=='Unsaved history edit offline'
                    assert page.evaluate('data.logs[0]')==saved
                    assert page.evaluate('data.workouts')==original_workouts
                    if width==393:
                        context.set_offline(False);nav('Settings')
                        page.wait_for_function("document.getElementById('pwaStatus').textContent.includes('Connected')")
                        # Foreign caches are never deleted during updates.
                        await_script="""async () => {await (await caches.open('foreign-cache')).put('/foreign-resource',new Response('keep'));await (await caches.open('hybrid-shell:other-scope:old')).put('/other-resource',new Response('keep'))}"""
                        page.evaluate(await_script)
                        old_state=page.evaluate('JSON.stringify(logState)');old_main=page.evaluate('localStorage.getItem(KEY)');page.evaluate('window.noAutomaticReload="sentinel"')
                        new_release=release(2);check_update(page)
                        assert page.evaluate('window.noAutomaticReload')=='sentinel'
                        assert message(page)['release']==BASE_RELEASE
                        assert release_of(page)==BASE_RELEASE
                        # Never reload an unsaved non-logging form.
                        nav('Nutrition');page.locator('#nutriNote').fill('Keep this nutrition form')
                        page.locator('#pwaApplyUpdate').click()
                        assert 'save form values' in page.locator('#pwaUpdate').text_content()
                        assert page.locator('#nutriNote').input_value()=='Keep this nutrition form'
                        assert message(page)['release']==BASE_RELEASE
                        page.locator('#nutriNote').fill('')
                        # Never publish a half-built workout just to update resources.
                        nav('Plan');page.get_by_role('button',name='New workout',exact=True).click();page.locator('#editTitle').fill('Unfinished builder')
                        page.get_by_role('button',name='+ Add exercise',exact=True).click();pending=page.evaluate('editing')
                        page.locator('#pwaApplyUpdate').click()
                        assert page.evaluate('editing')==pending
                        assert page.locator('#editTitle').input_value()=='Unfinished builder'
                        page.get_by_role('button',name='Close ✕',exact=True).click()
                        page.evaluate('importBusy=true');page.locator('#pwaApplyUpdate').click()
                        assert 'Wait until import' in page.locator('#pwaUpdate').text_content();page.evaluate('importBusy=false')
                        # A failed draft flush cannot activate the waiting worker.
                        page.evaluate("""() => {window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='hyrox_performance_hub_v4_drafts')throw new DOMException('Full','QuotaExceededError');return window.realSet.call(this,k,v)}}""")
                        page.locator('#pwaApplyUpdate').click()
                        assert 'Could not verify storage' in page.locator('#pwaUpdate').text_content()
                        assert page.evaluate('JSON.stringify(logState)')==old_state
                        assert message(page)['release']==BASE_RELEASE
                        assert page.evaluate('localStorage.getItem(KEY)')==old_main
                        page.evaluate('() => {Storage.prototype.setItem=window.realSet}')
                        # Multi-window activation is refused even after all drafts can be saved.
                        other=context.new_page();other.goto(url);wait_ready(other)
                        page.locator('#pwaApplyUpdate').click()
                        page.wait_for_function("document.getElementById('pwaUpdate').textContent.includes('Close other Hybrid windows')")
                        assert message(page)['release']==BASE_RELEASE
                        other.close()
                        nav('Log');page.locator('#logNotes').fill('Update keeps this exact history draft')
                        expected=page.evaluate('JSON.stringify(logState)');main_before=page.evaluate('localStorage.getItem(KEY)')
                        page.locator('#pwaApplyUpdate').click()
                        wait_release(page,new_release)
                        wait_ready(page)
                        assert page.evaluate('logEditingId')==saved['id']
                        assert page.evaluate('JSON.stringify(logState)')==expected
                        assert page.evaluate('localStorage.getItem(KEY)')==main_before
                        assert page.evaluate("sessionStorage.getItem('hybrid_pwa_update_return')") is None
                        assert message(page)['release']==new_release
                        # Failed installation leaves the entire old offline shell usable.
                        failed_release=release(3);server.fail_icon=True;nav('Settings');page.locator('#pwaCheckUpdates').click()
                        page.wait_for_function("document.getElementById('pwaUpdate').textContent.includes('could not be prepared')",timeout=20000)
                        assert message(page)['release']==new_release
                        assert page.evaluate('JSON.stringify(logState)')==expected
                        context.set_offline(True);page.reload();wait_ready(page)
                        assert release_of(page)==new_release
                        assert page.evaluate('localStorage.getItem(KEY)')==main_before
                        context.set_offline(False);server.fail_icon=False;nav('Settings');check_update(page)
                        page.locator('#pwaApplyUpdate').click()
                        wait_release(page,failed_release)
                        wait_ready(page)
                        caches_after=page.evaluate('caches.keys()');own=[n for n in caches_after if n.startswith('hybrid-shell:') and 'other-scope' not in n]
                        assert len(own)==2 and not any(n.endswith(BASE_RELEASE) for n in own)
                        assert 'foreign-cache' in caches_after and 'hybrid-shell:other-scope:old' in caches_after
                        assert page.evaluate('localStorage.getItem(KEY)')==main_before
                        # Repair a missing own resource without a release switch, reload or data write.
                        page.evaluate('''async name => {await (await caches.open(name)).delete(new URL('./icons/icon-192.png',location.href).href);window.repairSentinel='keep'}''',[n for n in own if n.endswith(failed_release)][0])
                        assert message(page)['ready'] is False
                        page.locator('#pwaCheckUpdates').click()
                        repair_end=time.monotonic()+20
                        while not message(page)['ready'] and time.monotonic()<repair_end:time.sleep(.1)
                        assert message(page)['ready'] is True
                        wait_ready(page)
                        assert page.evaluate('window.repairSentinel')=='keep'
                        assert page.evaluate('localStorage.getItem(KEY)')==main_before
                        page.screenshot(path='/tmp/hph-pwa-settings-393.png',full_page=True)
                    # Exercise the actual distance-interval builder and measurements offline too.
                    context.set_offline(True);nav('Plan')
                    page.get_by_role('button',name='New workout',exact=True).click()
                    page.locator('#editTitle').fill('Offline distance intervals');page.locator('#editMode').select_option('interval')
                    page.locator('#seqBasis').select_option('distance');page.locator('#seqCount').fill('4')
                    page.locator('#seqDistance').fill('1');page.locator('#seqSpeed').fill('12');page.locator('#seqPause').fill('1:30')
                    assert '4 km' in page.locator('#seriesPreview').text_content()
                    page.locator('button[onclick="addIntervalSeries()"]').click()
                    page.locator('button[onclick="saveWorkout()"]').click()
                    interval_id=page.evaluate('data.workouts.at(-1).id')
                    page.evaluate('id=>quickLog(id,iso(new Date()))',interval_id)
                    page.locator('#l4-0-0-value').fill('0.95');page.locator('#l4-0-0-qty').fill('5:30')
                    page.locator('.log-entry-controls .mark').first.click();page.locator('#savePartialButton').click()
                    interval_log=page.evaluate('structuredClone(data.logs.at(-1))')
                    assert interval_log['exercises'][0]['intervalPlan']['meters']==1000
                    assert interval_log['exercises'][0]['sets'][0]['actual']['meters']==950
                    assert interval_log['exercises'][0]['sets'][0]['actual']['seconds']==330
                    page.reload();wait_ready(page);nav('Log')
                    page.locator('#logHistory .log-history-item').filter(has_text='Offline distance intervals').get_by_role('button',name='Continue',exact=True).click()
                    assert page.locator('#l4-0-0-value').input_value()=='0.95'
                    assert page.locator('#l4-0-0-qty').input_value()=='5:30'
                    assert page.evaluate('data.logs.find(l=>l.id===logEditingId)')==interval_log
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    assert not errors,errors
                    print(f'PASS {width}x{height}: manifest/subpath/worker, real offline navigation/log/draft/history/JSON/language, reload and new page; no app JS errors',flush=True)
                    context.close()
                # Separate contexts model separate stores; real iOS partitioning is a manual test.
                release(1);server.fail_icon=False
                safari=browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True)
                old=safari.new_page();old.on('dialog',lambda d:d.accept());old.goto(url);wait_ready(old)
                old.evaluate("quickLog('upper',iso(new Date()))")
                old.locator('#logNotes').fill('Safari-only history');old.locator('#savePartialButton').click()
                old_main=old.evaluate('localStorage.getItem(KEY)')
                old.evaluate("nav('settings')")
                with old.expect_download() as event:old.get_by_role('button',name='↓ Eksporter alle data (.json)',exact=True).click()
                exported=Path(event.value.path()).read_bytes()
                # Installation prompt is used only when the browser supplies the API.
                old.evaluate("""() => {window.promptCalls=0;const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{window.promptCalls++};e.userChoice=Promise.resolve({outcome:'dismissed'});dispatchEvent(e)}""")
                old.locator('#pwaInstall').click();assert old.evaluate('window.promptCalls')==1
                installed=browser.new_context(viewport={'width':393,'height':852},is_mobile=True,has_touch=True)
                installed.add_init_script("Object.defineProperty(navigator,'standalone',{get:()=>true})")
                app_page=installed.new_page();accept={'value':False}
                app_page.on('dialog',lambda d:d.accept() if accept['value'] else d.dismiss())
                app_page.goto(url);wait_ready(app_page)
                assert app_page.evaluate('data.logs.length')==0
                assert app_page.locator('#pwaTransfer').is_visible()
                app_page.evaluate("quickLog('upper',iso(new Date()))")
                app_page.locator('#logNotes').fill('PWA-only history');app_page.locator('#savePartialButton').click()
                own_main=app_page.evaluate('localStorage.getItem(KEY)')
                app_page.wait_for_function("document.getElementById('pwaTransfer').textContent.includes('allerede lokale data')")
                app_page.evaluate("nav('settings')")
                for accepted in [False,True]:
                    accept['value']=accepted
                    app_page.locator('#importFile').set_input_files({'name':'safari.json','mimeType':'application/json','buffer':exported})
                    app_page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
                    if not accepted:assert app_page.evaluate('localStorage.getItem(KEY)')==own_main
                    else:assert app_page.evaluate('data.logs[0].notes')=='Safari-only history'
                with app_page.expect_download() as event:app_page.get_by_role('button',name='↓ Last ned kopi fra før siste import',exact=True).click()
                recovery=Path(event.value.path()).read_bytes();assert json.loads(recovery)['logs'][0]['notes']=='PWA-only history'
                assert old.evaluate('localStorage.getItem(KEY)')==old_main
                app_page.locator('#importFile').set_input_files({'name':'recover-pwa.json','mimeType':'application/json','buffer':recovery})
                app_page.wait_for_function("!importBusy && document.getElementById('importFile').value === ''")
                assert app_page.evaluate('data.logs[0].notes')=='PWA-only history'
                app_page.locator('#pwaTransferAck').click();assert not app_page.locator('#pwaTransfer').is_visible()
                app_page.reload();wait_ready(app_page);assert not app_page.locator('#pwaTransfer').is_visible()
                assert app_page.evaluate('data.logs[0].notes')=='PWA-only history'
                print('PASS separate browser/PWA contexts: no auto-transfer, first-launch guide, existing-data warning, cancel/confirm import, recovery backup, independent original store, explicit install prompt',flush=True)
                installed.close();safari.close();browser.close()
        finally:server.shutdown();server.server_close()
if __name__=='__main__':main()
