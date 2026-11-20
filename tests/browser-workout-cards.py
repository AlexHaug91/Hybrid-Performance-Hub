"""Premium Plan cards: desktop, narrow mobile, accessibility and occurrence-safe actions."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright
from browser_plan_helpers import plan_action
ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT)))
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            for width,height in [(1280,900),(320,640),(375,667),(393,852)]:
                context=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<760,has_touch=width<760)
                page=context.new_page();errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('dialog',lambda d:d.accept())
                page.goto(f'http://127.0.0.1:{server.server_port}')
                def nav(label): page.locator('#mobileNav' if width<760 else '#sidenav').get_by_role('button',name=label,exact=False).click()
                def card(title): return page.locator('#planCards .workout-card').filter(has_text=title)
                def row(occ): return page.locator(f'#planCards [data-occurrence-id="{occ}"].workout-card')
                def open_menu(target):
                    target.locator('.plan-menu-toggle').click();assert page.locator('#planActionDialog').is_visible()
                def menu_closed(): assert not page.locator('#planActionDialog').is_visible()
                def bounded():
                    # Resize events are asynchronous; verify the fitted result after they run.
                    page.wait_for_function('''() => {
                        const r=document.getElementById('planActionDialog').getBoundingClientRect();
                        const vv=visualViewport, mobile=innerWidth<=760;
                        const bottom=mobile?document.getElementById('mobileNav').getBoundingClientRect().top:vv.height;
                        return r.top>=0 && r.bottom<=Math.min(vv.height,bottom)+1;
                    }''')
                    r=page.locator('#planActionDialog').bounding_box();assert r['x']>=0 and r['x']+r['width']<=width+1
                    assert r['y']>=0 and r['y']+r['height']<=page.evaluate('visualViewport.height')+1
                    if width<760: assert r['y']+r['height']<=page.locator('#mobileNav').bounding_box()['y']
                    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
                nav('Plan');before=page.evaluate('JSON.stringify(data)');drafts=page.evaluate('JSON.stringify(logDrafts)')
                assert page.locator('#planCards .workout-card').count()==4
                for target in page.locator('#planCards .workout-card').all():
                    assert target.get_by_role('button').count()==2
                    for btn in target.get_by_role('button').all():
                        r=btn.bounding_box();assert r['width']>=44 and r['height']>=44
                target=card('Intervaller');toggle=target.locator('.plan-menu-toggle')
                # Keyboard open, arrow navigation, native Tab trap and Escape restoration.
                toggle.focus();page.keyboard.press('Enter');bounded()
                assert toggle.get_attribute('aria-expanded')=='true'
                assert page.locator('#planActionList button').count()==6
                assert page.evaluate('document.activeElement.getAttribute("aria-label")')=='Rediger'
                page.keyboard.press('ArrowDown');assert page.evaluate('document.activeElement.getAttribute("aria-label")')=='Kopier'
                page.keyboard.press('End');assert page.evaluate('document.activeElement.getAttribute("aria-label")')=='Fjern fra planen'
                for _ in range(9):
                    page.keyboard.press('Tab');assert page.evaluate('document.activeElement.closest("#planActionDialog")!==null')
                page.keyboard.press('Escape');menu_closed();assert toggle.evaluate('(e)=>e===document.activeElement')
                assert toggle.get_attribute('aria-expanded')=='false'
                open_menu(target);page.locator('#planActionDialog').get_by_role('button',name='Lukk handlinger',exact=True).click();menu_closed()
                open_menu(target);page.mouse.click(2,2);menu_closed()
                # Opening/redrawing menus never writes any training data.
                open_menu(target);page.evaluate('renderPlan()');menu_closed()
                assert page.evaluate('JSON.stringify(data)')==before
                assert page.evaluate('JSON.stringify(logDrafts)')==drafts
                open_menu(card('Intervaller'));page.evaluate('shiftWeek(1)');menu_closed();page.evaluate('shiftWeek(-1)')
                # Existing edit/copy/move functions receive the correct template.
                plan_action(page,card('Intervaller'),'Rediger').click();menu_closed();assert page.evaluate('editing')=='interval'
                assert page.locator('#editTitle').evaluate('(e)=>e===document.activeElement')
                page.get_by_role('button',name='Lukk ✕',exact=True).click()
                plan_action(page,card('Intervaller'),'Kopier').click();assert page.evaluate('editing')!='interval'
                page.get_by_role('button',name='Lukk ✕',exact=True).click();assert page.evaluate('JSON.stringify(data)')==before
                plan_action(page,card('Intervaller'),'Flytt').click();assert page.locator('#editDay').evaluate('(e)=>e===document.activeElement')
                page.get_by_role('button',name='Lukk ✕',exact=True).click()
                # Weekly move to Sunday preserves the recurring plan and other weeks.
                plan_action(page,card('Intervaller'),'Flytt denne uken').click();menu_closed()
                page.locator('#weekDay').select_option('0');page.get_by_role('button',name='Lagre planendring',exact=True).click()
                occurrence=card('Intervaller').get_attribute('data-occurrence-id')
                planned_date=page.evaluate('findOccurrence',occurrence)['date']
                assert 'SØN' in card('Intervaller').text_content()
                assert page.evaluate('data.workouts[0].day')==1
                page.locator('.weeknav button').last.click();assert 'MAN' in card('Intervaller').text_content()
                page.locator('.weeknav button').first.click();assert 'SØN' in card('Intervaller').text_content()
                plan_action(page,card('Intervaller'),'Hopp over denne uken').click()
                assert card('Intervaller').get_by_role('button',name='Logg økt',exact=True).is_disabled()
                plan_action(page,card('Intervaller'),'Ta med igjen').click()
                card('Intervaller').get_by_role('button',name='Logg økt',exact=True).click()
                assert page.locator('#logDate').input_value()==planned_date
                assert page.evaluate('logState.occurrenceId')==occurrence
                assert page.evaluate('logState.type')=='interval'
                # Two same-day extras keep independent drafts and partial records.
                nav('Plan');extra_ids=[]
                for _ in range(2):
                    page.get_by_role('button',name='Ekstra økt denne uken',exact=True).click()
                    page.locator('#extraWorkout').select_option('upper');page.locator('#weekDay').select_option('4')
                    page.get_by_role('button',name='Lagre planendring',exact=True).click()
                extra_ids=page.locator('#planCards .workout-card').filter(has_text='Ekstra · kun denne uken').evaluate_all('(els)=>els.map(e=>e.dataset.occurrenceId)')
                assert len(set(extra_ids))==2
                open_menu(row(extra_ids[0]));assert page.locator('#planActionList button').count()==2
                assert page.locator('#planActionList').get_by_role('button',name='Fjern fra planen',exact=True).count()==0
                page.keyboard.press('Escape')
                for index,occ in enumerate(extra_ids):
                    row(occ).get_by_role('button',name='Logg økt',exact=True).click()
                    page.locator('#l4-0-0-value').fill(str(70+index*10));page.locator('#logNotes').fill('Ekstra '+str(index))
                    nav('Plan')
                for index,occ in enumerate(extra_ids):
                    row(occ).get_by_role('button',name='Logg økt',exact=True).click()
                    assert page.locator('#l4-0-0-value').input_value()==str(70+index*10)
                    assert page.locator('#logNotes').input_value()=='Ekstra '+str(index)
                    page.locator('.log-entry-controls .mark').first.click();page.locator('.log-save-bar .btn').first.click();nav('Plan')
                logs=page.evaluate('structuredClone(data.logs)');assert len(logs)==2
                assert {l['occurrenceId'] for l in logs}==set(extra_ids)
                # Bottom-of-screen menu and a smaller visual viewport (keyboard approximation).
                last=page.locator('#planCards .workout-card').last;last.scroll_into_view_if_needed();open_menu(last);bounded()
                if width<760:
                    page.set_viewport_size({'width':width,'height':400});bounded()
                    page.set_viewport_size({'width':width,'height':height})
                page.keyboard.press('Escape');menu_closed()
                # Archive uses the existing confirmation/retention path; restore keeps identity.
                plan_action(page,card('Overkropp + rolig løp').filter(has_text='Fast · alle uker'),'Fjern').click()
                assert page.evaluate('data.logs')==logs
                assert page.locator('#archiveCard').is_visible()
                page.locator('#archiveList').get_by_role('button',name='Gjenopprett',exact=True).click()
                assert page.evaluate('data.logs')==logs
                assert page.evaluate('data.workouts.find(w=>w.id==="upper").archived') is False
                page.reload();nav('Plan');assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
                if width in [1280,393]:
                    page.screenshot(path=f'/tmp/hph-premium-plan-{width}.png',full_page=True)
                    open_menu(card('Intervaller'));page.screenshot(path=f'/tmp/hph-premium-menu-{width}.png')
                # Long names and many same-day occurrences, including keyboard-sized height.
                page.keyboard.press('Escape')
                nav('Plan')
                raw_storage=page.evaluate('JSON.stringify({...localStorage})')
                page.evaluate('''() => {
                    data.workouts.find(w=>w.id==='interval').title='Langt øktnavn for intervaller '.repeat(12);
                    const week=iso(targetWeek());data.weekPlans??={};data.weekPlans[week]??={overrides:{},extras:[]};
                    for(let i=0;i<10;i++)data.weekPlans[week].extras.push({id:'extra-stress-'+i,workoutId:'interval',day:3});
                    renderPlan();
                }''')
                stress_data=page.evaluate('JSON.stringify(data)')
                stress_drafts=page.evaluate('JSON.stringify(logDrafts)')
                assert page.locator('#planCards .workout-card').count()==16
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
                # Recurring menu (six actions) and extra menu (two actions) both remain usable.
                for stress_card in [card('Langt øktnavn').filter(has_text='Endret · kun denne uken'),row('extra-stress-9')]:
                    page.set_viewport_size({'width':width,'height':400})
                    open_menu(stress_card);bounded()
                    assert page.locator('#planActionTitle').text_content()=='Langt øktnavn for intervaller '*12
                    first=page.locator('#planActionList button').first
                    r=first.bounding_box();menu=page.locator('#planActionDialog').bounding_box()
                    assert r['y']>=menu['y'] and r['y']+r['height']<=menu['y']+menu['height']
                    assert first.evaluate('(e)=>e===document.activeElement')
                    for button in page.locator('#planActionDialog button').all():
                        b=button.bounding_box();assert b['width']>=44 and b['height']>=44
                    page.keyboard.press('Shift+Tab');page.keyboard.press('Shift+Tab')
                    assert page.evaluate('document.activeElement.closest("#planActionDialog")!==null')
                    page.keyboard.press('Escape');menu_closed()
                assert page.evaluate('JSON.stringify(data)')==stress_data
                assert page.evaluate('JSON.stringify(logDrafts)')==stress_drafts
                assert page.evaluate('JSON.stringify({...localStorage})')==raw_storage
                page.set_viewport_size({'width':width,'height':height})
                assert not errors,errors
                print(f'PASS {width}x{height}: compact cards, keyboard/focus/outside/Escape, bounded menu, template and week actions, skipped state, exact occurrence logging, independent extras, archive/history/restore, reload, long names, ten same-day extras; no JS errors')
                context.close()
            browser.close()
    finally:
        server.shutdown();server.server_close()
if __name__=='__main__':main()
