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
function priorStrength(a){
 a.run('logState=buildLogState("2026-11-18","upper");data.logs=[{id:"old",type:"upper",date:"2026-11-17",status:"complete",title:"Previous",notes:"",rpe:null,duration:null,created:100,exercises:logState.items.map(item=>({...summarizeExercise(item),sets:item.entries.map((e,i)=>({done:true,skipped:false,value:70+i,qty:8-i}))}))}];logKey="2026-11-18|upper";document.getElementById("logDate").value=logState.date;document.getElementById("logType").value=logState.type;renderLogUI()');
}
test('previous strength values are explicit, editable and never mark any set completed',()=>{
 const a=setup();priorStrength(a);const old=a.snapshot('data.logs');assert.equal(a.snapshot('previousValues(logState.items[0],0).value'),'70');a.run('applyPreviousSuggestion(0)');assert.equal(a.snapshot('logState.items[0].entries[0].value'),'70');assert.equal(a.snapshot('countLog().done'),0);assert.deepEqual(a.snapshot('data.logs'),old);a.fields.get('l4-0-0-value').value='75.5';a.run('captureLogState()');assert.equal(a.snapshot('logState.items[0].entries[0].value'),'75.5');
});
test('suggestions leave completed and skipped sets untouched',()=>{
 const a=setup();priorStrength(a);a.run('logState.items[0].entries[0]={done:true,skipped:false,value:"88",qty:"6"};logState.items[0].entries[1]={done:false,skipped:true,value:"99",qty:"5"};renderLogUI();applyPreviousSuggestion(0)');assert.deepEqual(a.snapshot('logState.items[0].entries.slice(0,2)'),[{done:true,skipped:false,value:'88',qty:'6'},{done:false,skipped:true,value:'99',qty:'5'}]);assert.equal(a.snapshot('logState.items[0].entries[2].value'),'72');
});
test('changed units never become proposals or automatic previous-weight prefills',()=>{
 const a=setup();priorStrength(a);a.run('data.logs[0].exercises[0].unit="km"');assert.equal(a.snapshot('previousValues(logState.items[0],0)'),null);assert.equal(a.snapshot('lastValue(data.logs[0],0,data.workouts.find(w=>w.id==="upper").exercises[0])'),null);
});
test('duplicate strength names are rejected when the prior exercise is ambiguous',()=>{
 const a=setup();priorStrength(a);a.run('data.logs[0].exercises.push(structuredClone(data.logs[0].exercises[0]))');assert.equal(a.snapshot('previousValues(logState.items[0],0)'),null);
});
test('historical editing never applies new previous-result suggestions',()=>{
 const a=setup();priorStrength(a);a.run('logEditingId="old"');const before=a.snapshot('logState');a.run('applyPreviousSuggestion(0)');assert.equal(a.snapshot('previousValues(logState.items[0],0)'),null);assert.deepEqual(a.snapshot('logState'),before);
});
test('no completed history means no suggested values',()=>{
 const a=setup();priorStrength(a);a.run('data.logs[0].status="partial"');assert.equal(a.snapshot('previousValues(logState.items[0],0)'),null);
});
test('draft status, failure and retry are per-session and add no fields to the backup',()=>{
 const a=setup();priorStrength(a);a.run('logDraftPersist()');assert.equal(a.snapshot('logSaveStates.get(logKey).status'),'draft');a.blocked.add(DRAFTS);a.run('logState.notes="Retained";logDraftPersist()');assert.equal(a.snapshot('logSaveStates.get(logKey).memoryOnly'),true);assert.equal(a.snapshot('logDrafts[logKey].state.notes'),'Retained');a.blocked.clear();a.run('logDraftPersist()');assert.equal(a.snapshot('logSaveStates.get(logKey).status'),'draft');assert.equal(a.snapshot('logSaveStates.get(logKey).memoryOnly'),false);assert.ok(!a.storage.get(DRAFTS).includes('memoryOnly'));a.run('validateBackup({...data,draftsV4:logDrafts})');
});
test('beforeunload warns only for changes that are still in memory',()=>{
 const a=setup();priorStrength(a);a.run('globalThis.prevented=false;globalThis.event={preventDefault(){globalThis.prevented=true}};setLogSaveState("error","draft");guardUnsavedDrafts(event)');assert.equal(a.run('prevented'),true);a.run('prevented=false;logDraftPersist();guardUnsavedDrafts(event)');assert.equal(a.run('prevented'),false);
});
test('failed main save shows an error while preserving the draft and original history',()=>{
 const a=setup();priorStrength(a);a.fields.get('logNotes').value='Failed save';a.run('logState.items[0].entries[0].done=true;renderLogUI()');const before=a.snapshot('data.logs');a.blocked.add(MAIN);a.run('saveLog("partial")');assert.deepEqual(a.snapshot('data.logs'),before);assert.equal(a.snapshot('logSaveStates.get(logKey).status'),'error');assert.equal(a.snapshot('logSaveStates.get(logKey).kind'),'main');assert.equal(a.snapshot('logSaveStates.get(logKey).memoryOnly'),false);a.blocked.clear();a.run('saveLog("partial")');assert.equal(a.snapshot('data.logs.length'),2);assert.equal(a.snapshot('logSaveStates.get(logKey).status'),'saved');
});
test('interval suggestions preserve canonical distance, time and clock pace',()=>{
 const a=setup();a.run('data.workouts[0].exercises=[makeIntervalPart("Intervall",{basis:"distance",meters:400,seconds:null,speedKmh:3600/330,speedUnit:"min/km",distanceUnit:"m",timeUnit:"min"})];logState=buildLogState("2026-11-18","interval");logKey="2026-11-18|interval";logState.items[0].entries[0]={value:"0.39",qty:String(130/60),done:true,skipped:false};data.logs=[{id:"old",type:"interval",date:"2026-11-17",status:"complete",exercises:logState.items.map(summarizeExercise)}];logState=buildLogState("2026-11-18","interval");renderLogUI();applyPreviousSuggestion(0)');assert.equal(a.snapshot('logState.items[0].entries[0].value'),'0.39');assert.equal(a.snapshot('logState.items[0].entries[0].qty'),String(130/60));assert.equal(a.snapshot('countLog().done'),0);assert.match(a.run('previousSuggestionText(logState.items[0],0)'),/390 m · 2:10/);assert.equal(a.snapshot('data.logs[0].exercises[0].sets[0].actual.meters'),390);
});
test('a changed interval amount is not comparable with an old planned distance',()=>{
 const a=setup();a.run('logState=buildLogState("2026-11-18","interval");data.logs=[{id:"old",type:"interval",date:"2026-11-17",status:"complete",exercises:logState.items.map(summarizeExercise)}];data.logs[0].exercises[1].dose="2"');assert.equal(a.snapshot('previousValues(logState.items[1],1)'),null);
});
test('the previous-result summary never labels a value using a different current unit',()=>{
 const a=setup();priorStrength(a);a.run('data.logs[0].exercises[0].unit="kg/hånd"');assert.equal(a.run('priorSummary(data.logs[0],0,logState.items[0])'),'Ingen sammenlignbare tidligere resultater');
});
