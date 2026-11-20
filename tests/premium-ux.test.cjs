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

test('language defaults to bokmål and never creates or rewrites training storage',()=>{
 const a=setup();assert.equal(a.snapshot('uiLanguage'),'nb');assert.equal(a.storage.size,0);assert.equal(a.run('t("Logg økt")'),'Logg økt');
});
test('saved English preference is read without modifying older training data',()=>{
 const storage=new Map([['hybrid_ui_language','en']]);const a=setup(storage);assert.equal(a.snapshot('uiLanguage'),'en');assert.equal(a.run('t("Logg økt")'),'Log workout');assert.equal(storage.size,1);a.run('validateBackup(data)');
});
test('UI templates translate source fragments but never interpolated user content',()=>{
 const a=setup();a.run('uiLanguage="en"');a.context.own='Ny økt <script>e()</script>';assert.equal(a.run('ui`<strong>Rediger</strong><span>${escapeHTML(own)}</span>`'),'<strong>Edit</strong><span>Ny økt &lt;script&gt;e()&lt;/script&gt;</span>');
});
test('HTML translation preserves canonical option values and inline action arguments',()=>{
 const a=setup();a.run('uiLanguage="en"');assert.equal(a.run('uiHTML(\'<button onclick="addIntervalPart(\\\'Oppvarming\\\')">Oppvarming</button>\')'),'<button onclick="addIntervalPart(\'Oppvarming\')">Warm-up</button>');
});
test('standard templates can be translated as a view without changing their stored model',()=>{
 const a=setup(),before=a.snapshot('data');a.run('uiLanguage="en"');assert.equal(a.snapshot('displayWorkout(data.workouts[0]).title'),'Intervals');assert.deepEqual(a.snapshot('data'),before);
});
test('user-created and edited workout text is never translated even when it matches UI words',()=>{
 const a=setup();a.run('uiLanguage="en";data.workouts[0].title="Rediger"');assert.equal(a.snapshot('displayWorkout(data.workouts[0]).title'),'Rediger');a.run('data.workouts.push({...structuredClone(defaultWorkouts[0]),id:"my-own"})');assert.equal(a.snapshot('displayWorkout(data.workouts.at(-1)).title'),'Intervaller');
});
test('UI locale, number display and speed labels change without changing pace calculations',()=>{
 const a=setup();a.run('uiLanguage="en"');assert.equal(a.run('uiLocale()'),'en-GB');assert.equal(a.run('displayNumber(12.5)'),'12.5');assert.equal(a.run('unitLabel("km/t")'),'km/h');assert.equal(a.run('unitLabel("Mine tall")'),'Mine tall');assert.equal(a.run('parseSpeed("5:30","min/km")'),3600/330);
});
test('English error messages preserve dynamic exercise names and backup field names',()=>{
 const a=setup();a.run('uiLanguage="en"');a.context.name='Ny økt';assert.equal(a.run('ui`${name}: ugyldig resultat`'),'Ny økt: invalid result');assert.throws(()=>a.run('validateBackup({})'),/Invalid value or missing field/);
});
test('translated menus preserve the original occurrence action keys',()=>{
 const a=setup();a.run('uiLanguage="en"');assert.deepEqual(a.snapshot('planActions({kind:"extra",skipped:true}).map(a=>[a.key,a.label])'),[['weekMove','Move this week'],['skip','Include again']]);
});
test('unknown text and custom interval names never resolve inherited catalogue properties',()=>{
 const a=setup();a.run('uiLanguage="en"');for(const value of ['constructor','toString','Mine økter']){a.context.value=value;if(value!=='Mine økter')assert.equal(a.run('t(value)'),value);assert.equal(a.run('intervalRoleName(value)'),value)}
});
function todayPlan(a,date='2026-11-18'){
 a.context.date=date;a.run('data.workouts.forEach(w=>w.day=1);data.weekPlans={"2026-11-16":{overrides:{upper:{day:3}},extras:[{id:"extra-today-a",workoutId:"upper",day:3},{id:"extra-today-b",workoutId:"upper",day:3}]}}');
 return a.snapshot('todayOccurrences(date)');
}
test('today uses real weekly overrides and independent same-day extras without changing templates',()=>{
 const a=setup(),occ=todayPlan(a);assert.deepEqual(occ.map(o=>o.id),['repeat:2026-11-16:upper','extra-today-a','extra-today-b']);assert.equal(a.snapshot('data.workouts.find(w=>w.id==="upper").day'),1);assert.equal(a.snapshot('todayOccurrences("2026-11-25").length'),0);
});
test('today retains a skipped occurrence as disabled and does not start it',()=>{
 const a=setup();todayPlan(a);a.run('data.weekPlans["2026-11-16"].extras[0].skipped=true');assert.equal(a.snapshot('todaySession(todayOccurrences(date)[1]).status'),'skipped');
});
test('today associates exact log IDs with extras rather than another same-day session',()=>{
 const a=setup();todayPlan(a);a.run('data.logs=[{id:"saved-a",type:"upper",date,occurrenceId:"extra-today-a",status:"partial",updated:100},{id:"saved-b",type:"upper",date,occurrenceId:"extra-today-b",status:"complete",updated:200}]');assert.deepEqual(a.snapshot('todayOccurrences(date).map(todaySession)'),[{status:'planned'},{status:'partial',logId:'saved-a'},{status:'complete',logId:'saved-b'}]);
});
test('today matches an older unbound log only to the recurring occurrence',()=>{
 const a=setup();todayPlan(a);a.run('data.logs=[{id:"legacy",type:"upper",date,status:"complete"}]');assert.equal(a.snapshot('todaySession(todayOccurrences(date)[0]).logId'),'legacy');assert.equal(a.snapshot('todaySession(todayOccurrences(date)[1]).status'),'planned');
});
test('today resumes occurrence drafts after movement without rewriting their original date',()=>{
 const a=setup();todayPlan(a);a.run('logDrafts={"old-date-key":{editingId:null,updated:500,state:{type:"upper",date:"2026-11-17",occurrenceId:"extra-today-a"}}}');assert.deepEqual(a.snapshot('todaySession(todayOccurrences(date)[1])'),{status:'draft',draftKey:'old-date-key'});assert.equal(a.snapshot('logDrafts["old-date-key"].state.date'),'2026-11-17');
});
test('today does not let a stale draft hide a more recent completed log',()=>{
 const a=setup();todayPlan(a);a.run('data.logs=[{id:"done",type:"upper",date,occurrenceId:"extra-today-a",updated:200,status:"complete"}];logDrafts={stale:{editingId:null,updated:100,state:{type:"upper",date,occurrenceId:"extra-today-a"}}}');assert.equal(a.snapshot('todaySession(todayOccurrences(date)[1]).status'),'complete');
});
test('archived templates disappear from today without deleting any existing logs or drafts',()=>{
 const a=setup();todayPlan(a);a.run('data.workouts.find(w=>w.id==="upper").archived=true;data.logs=[{id:"keep"}];logDrafts={keep:{state:{type:"upper"}}}');assert.equal(a.snapshot('todayOccurrences(date).length'),0);assert.equal(a.snapshot('data.logs[0].id'),'keep');assert.equal(a.snapshot('Object.keys(logDrafts)[0]'),'keep');
});
test('today rendering and session lookup are read-only in both languages',()=>{
 const a=setup(),before=a.snapshot('data');a.run('renderTodayWorkouts();uiLanguage="en";renderTodayWorkouts()');assert.deepEqual(a.snapshot('data'),before);assert.equal(a.storage.size,0);assert.match(a.fields.get('todayWorkouts').innerHTML,/Start workout|No workouts planned today/);
});
for(const [session,expected] of [[{status:'planned'},['quick','upper','2026-11-18','extra-today-a']],[{status:'draft',draftKey:'draft-a'},['draft','draft-a']],[{status:'complete',logId:'historical-a'},['log','historical-a']]])test(`today ${session.status} opens the exact existing handler without generating a second log`,()=>{
 const a=setup();a.context.session=session;a.run('todayOccurrences=()=>[{id:"extra-today-a",workoutId:"upper",date:"2026-11-18",skipped:false}];todaySession=()=>session;quickLog=(...args)=>globalThis.opened=["quick",...args];resumeArchivedDraft=key=>globalThis.opened=["draft",key];editSavedLog=id=>globalThis.opened=["log",id];startTodayWorkout("extra-today-a")');assert.deepEqual(a.snapshot('opened'),expected);assert.equal(a.snapshot('data.logs.length'),0);
});
test('today completed sessions stay matched after moving their occurrence date',()=>{
 const a=setup();todayPlan(a);a.run('data.logs=[{id:"moved-complete",type:"upper",date:"2026-11-17",occurrenceId:"extra-today-a",status:"complete"}]');assert.equal(a.snapshot('todaySession(todayOccurrences(date)[1]).logId'),'moved-complete');assert.equal(a.snapshot('data.logs[0].date'),'2026-11-17');
});
