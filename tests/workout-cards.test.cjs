const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const script = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1].replace(/init\(\);\s*$/, '');
const MAIN = 'hyrox_performance_hub_v1', DRAFTS = 'hyrox_performance_hub_v4_drafts';
function setup(storage = new Map()) {
  const fields = new Map(), alerts = [], toasts = [], blocked = new Set();let uuid=0;
  const context = vm.createContext({
    structuredClone, crypto: { randomUUID: () => 'test-id-'+(++uuid) },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { if (blocked.has(key)) throw Error('Blocked'); storage.set(key, value); },
      removeItem: key => storage.delete(key),
    },
    document: {
      getElementById: id => {
        if (!fields.has(id)) fields.set(id, { value: '', innerHTML: '', textContent: '', style: { setProperty() {} }, disabled: false, classList: { add() {}, remove() {} }, scrollIntoView() {}, focus() {} });
        return fields.get(id);
      }, querySelector: () => null, querySelectorAll: () => [],
    },
    requestAnimationFrame: callback => callback(),
    alert: message => alerts.push(message), confirm: () => true, recordToast: message => toasts.push(message),
  });
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  const snapshot = expr => JSON.parse(run(`JSON.stringify(${expr})`));
  run(`
    nav=()=>{};toast=recordToast;renderAll=()=>{};
    renderLogUI=()=>{
      for(const [id,key] of [['logRpe','rpe'],['logDuration','duration'],['logNotes','notes']])document.getElementById(id).value=logState[key];
      logState.items.forEach((item,i)=>item.entries.forEach((entry,j)=>{for(const key of ['value','qty'])document.getElementById('l4-'+i+'-'+j+'-'+key).value=entry[key]}));
    };
  `);
  function create(title = 'Egen styrke', day = 2, mode = 'mixed') {
    run('createWorkout()');
    fields.get('editTitle').value = title; fields.get('editDay').value = String(day);
    fields.get('editLocation').value = 'Treningssenter'; fields.get('editFocus').value = 'Eget fokus'; fields.get('editDesc').value = 'Min beskrivelse';
    context.chosenMode = mode; run('setWorkoutMode(chosenMode);addExercise()');
    const id = snapshot('editing'); run('saveWorkout()'); return id;
  }
  function open(id, date = '2026-11-18') { context.selectedId = id; context.selectedDate = date; run('quickLog(selectedId,selectedDate)'); }
  return { storage, fields, alerts, toasts, blocked, run, snapshot, context, create, open };
}

test('repeat card exposes exactly one primary log action and one collapsed menu trigger',()=>{
 const a=setup(),before=a.snapshot('data');a.run('renderPlan()');const html=a.fields.get('planCards').innerHTML;
 assert.equal((html.match(/class="btn plan-primary"/g)||[]).length,4);assert.equal((html.match(/plan-menu-toggle/g)||[]).length,4);assert.equal((html.match(/aria-expanded="false"/g)||[]).length,4);
 assert.doesNotMatch(html,/>Rediger<|>Kopier<|>Flytt<|>Fjern/);assert.deepEqual(a.snapshot('data'),before);assert.equal(a.storage.size,0);
});
test('recurring occurrence menu contains all six actions with explicit scopes',()=>{
 const a=setup();assert.deepEqual(a.snapshot('planActions({kind:"repeat",skipped:false}).map(a=>a.key)'),['edit','copy','move','weekMove','skip','archive']);assert.equal(a.snapshot('planActions({kind:"repeat"}).find(a=>a.key==="archive").danger'),true);
});
test('extra occurrence only exposes week movement and reversible skipping',()=>{
 const a=setup();assert.deepEqual(a.snapshot('planActions({kind:"extra",skipped:false}).map(a=>a.key)'),['weekMove','skip']);assert.equal(a.snapshot('planActions({kind:"extra",skipped:true})[1].label'),'Ta med igjen');
});
test('skipped occurrence disables the card primary action while retaining its identity',()=>{
 const a=setup();a.run('data.weekPlans={[iso(targetWeek())]:{overrides:{upper:{skipped:true}},extras:[]}};renderPlan()');const html=a.fields.get('planCards').innerHTML;assert.match(html,/class="btn plan-primary" disabled onclick="quickLog\('upper','[0-9-]+','repeat:[^']+:upper'\)"/);
});
test('duplicate extra occurrences keep independent IDs in each primary action and trigger',()=>{
 const a=setup();a.run('data.weekPlans={[iso(targetWeek())]:{overrides:{},extras:[{id:"extra-a",workoutId:"upper",day:3},{id:"extra-b",workoutId:"upper",day:3}]}};renderPlan()');const html=a.fields.get('planCards').innerHTML;for(const id of ['extra-a','extra-b']){assert.ok(html.includes(`data-occurrence-id="${id}"`));assert.ok(html.includes(`,'${id}')`))}
});
for(const [key,fn,kind] of [['edit','editWorkout','repeat'],['copy','copyWorkout','repeat'],['move','moveWorkout','repeat'],['archive','archiveWorkout','repeat'],['weekMove','openWeekMove','extra'],['skip','toggleWeekSkip','extra']])test(`menu ${key} delegates to the existing ${fn} with the right ID`,()=>{
 const a=setup();a.run(`data.weekPlans={[iso(targetWeek())]:{overrides:{},extras:[{id:"extra-test",workoutId:"upper",day:3}]}};planMenuContext=${kind==='extra'?'"extra-test"':'"repeat:"+iso(targetWeek())+":upper"'};closePlanMenu=()=>{planMenuContext=null};${fn}=id=>globalThis.called=id`);a.context.key=key;a.run('runPlanAction(key)');assert.equal(a.run('called'),kind==='extra'?'extra-test':'upper');assert.equal(a.snapshot('planMenuContext'),null);
});
test('an invalid template action on an extra occurrence never dispatches',()=>{
 const a=setup();a.run('data.weekPlans={[iso(targetWeek())]:{overrides:{},extras:[{id:"extra-test",workoutId:"upper",day:3}]}};planMenuContext="extra-test";archiveWorkout=()=>{throw Error("must not archive")};runPlanAction("archive")');assert.equal(a.snapshot('planMenuContext'),null);
});
test('redraw and week navigation close menus without changing stored data',()=>{
 const a=setup(),before=a.snapshot('data');a.run('planMenuContext="repeat:2026-11-16:upper";renderPlan()');assert.equal(a.snapshot('planMenuContext'),null);a.run('planMenuContext="extra-stale";shiftWeek(1)');assert.equal(a.snapshot('planMenuContext'),null);assert.deepEqual(a.snapshot('data'),before);
});
test('imported title and description remain escaped in premium cards',()=>{
 const a=setup();a.run('data.workouts[0].title="<img src=x onerror=alert(1)>";data.workouts[0].description="<script>bad()</script>";renderPlan()');const html=a.fields.get('planCards').innerHTML;assert.ok(html.includes('&lt;img'));assert.doesNotMatch(html,/<img|<script>/);
});
