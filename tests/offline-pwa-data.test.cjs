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

test('a clean update barrier writes neither default training data nor empty drafts',()=>{
 const a=setup(),before=a.snapshot('data');assert.equal(a.snapshot('prepareDataForPwaUpdate().ok'),true);assert.equal(a.storage.size,0);assert.deepEqual(a.snapshot('data'),before);
});
test('updates are blocked during imports and while template/week builders remain open',()=>{
 const a=setup();for(const expr of ['importBusy=true','importBusy=false;editing="upper"','editing=null;pendingWeekAction={kind:"extra"}']){a.run(expr);assert.equal(a.snapshot('prepareDataForPwaUpdate().ok'),false)}assert.equal(a.storage.size,0);
});
test('unpersisted in-memory changes can never be overwritten by an update reload',()=>{
 const a=setup();a.run('persist();data.settings.sessions=5');const stored=a.storage.get(MAIN);assert.equal(a.snapshot('prepareDataForPwaUpdate().reason'),'unsaved-data');assert.equal(a.storage.get(MAIN),stored);assert.equal(a.snapshot('data.settings.sessions'),5);
});
test('a failed active-draft flush retains raw entries and memory-only warning',()=>{
 const a=setup();a.run('document.getElementById("logDate").value="2026-11-20";document.getElementById("logType").value="upper";renderLogFields()');a.fields.get('logNotes').value='Keep this draft';a.blocked.add(DRAFTS);a.run('captureLogState()');const state=a.snapshot('logState');assert.equal(a.snapshot('prepareDataForPwaUpdate().reason'),'storage-error');assert.deepEqual(a.snapshot('logState'),state);assert.equal(a.snapshot('logSaveStates.get(logKey).memoryOnly'),true);
 a.blocked.clear();assert.equal(a.snapshot('prepareDataForPwaUpdate().ok'),true);assert.equal(a.snapshot('logSaveStates.get(logKey).memoryOnly'),false);assert.equal(JSON.parse(a.storage.get(DRAFTS))[a.snapshot('logKey')].state.notes,'Keep this draft');assert.equal(a.storage.has(MAIN),false);
});
test('the barrier flushes older memory-only drafts even when another session is selected',()=>{
 const a=setup();a.run('persist();logDrafts={"2026-11-20|upper":{editingId:null,updated:100,state:buildLogState("2026-11-20","upper")}};logDrafts["2026-11-20|upper"].state.notes="Unbound draft";logSaveStates.set("2026-11-20|upper",{status:"error",kind:"draft",memoryOnly:true})');assert.equal(a.snapshot('prepareDataForPwaUpdate().ok'),true);assert.equal(JSON.parse(a.storage.get(DRAFTS))['2026-11-20|upper'].state.notes,'Unbound draft');assert.equal(a.snapshot('logSaveStates.get("2026-11-20|upper").memoryOnly'),false);
});
test('corrupt existing storage is never replaced with fallback defaults by an update',()=>{
 const storage=new Map([[MAIN,'broken-json']]),a=setup(storage);assert.equal(a.snapshot('prepareDataForPwaUpdate().reason'),'storage-error');assert.equal(storage.get(MAIN),'broken-json');
});
test('backup-only metadata does not cause a false unsaved-model warning',()=>{
 const a=setup();a.run('data.draftsV4={};data.exportedAt="2026-11-20T12:00:00Z";persist();data.draftsV4.changed={state:{notes:"metadata"}}');assert.equal(a.snapshot('prepareDataForPwaUpdate().ok'),true);
});
test('restoring fresh log context cannot open or overwrite an older same-day log',()=>{
 const a=setup();a.run('data.logs=[{id:"old",type:"upper",date:"2026-11-20"}];restorePwaLogContext({tab:"log",type:"upper",date:"2026-11-20",fresh:true,weekOffset:0})');assert.equal(a.snapshot('logEditingId'),null);assert.equal(a.snapshot('logFresh'),true);assert.equal(a.snapshot('data.logs.length'),1);assert.equal(a.snapshot('data.logs[0].id'),'old');
});
test('restore context uses exact saved log IDs rather than same-date/type guesses',()=>{
 const a=setup();a.run('data.logs=[{id:"one",type:"upper",date:"2026-11-20"},{id:"two",type:"upper",date:"2026-11-20"}];editSavedLog=id=>globalThis.opened=id;restorePwaLogContext({tab:"log",type:"upper",date:"2026-11-20",logId:"one"})');assert.equal(a.run('opened'),'one');
});
test('failed goal saving leaves fields and memory intact and shows no success toast',()=>{
 const a=setup();for(const [id,value]of [['settingSessions','5'],['settingCalories','3000'],['settingProtein','150'],['settingGain','0.15']]){a.context.id=id;a.run('document.getElementById(id)');a.fields.get(id).value=value}a.blocked.add(MAIN);a.run('saveSettings()');assert.equal(a.toasts.length,0);assert.equal(a.fields.get('settingSessions').value,'5');assert.equal(a.snapshot('prepareDataForPwaUpdate().ok'),false);
});
test('failed nutrition saving preserves note fields and gives no success confirmation',()=>{
 const a=setup();for(const [id,value]of [['nutriDate','2026-11-20'],['nutriWeight','75'],['nutriKcal','3000'],['nutriProtein','150'],['nutriNote','Do not clear this']]){a.context.id=id;a.run('document.getElementById(id)');a.fields.get(id).value=value}a.blocked.add(MAIN);a.run('saveNutrition()');assert.equal(a.toasts.length,0);assert.equal(a.fields.get('nutriNote').value,'Do not clear this');assert.equal(a.storage.has(MAIN),false);assert.equal(a.snapshot('prepareDataForPwaUpdate().reason'),'unsaved-data');
});
test('failed Pro saving retains the editable result and gives no success toast',()=>{
 const a=setup();a.run('document.getElementById("pro0").value="90"');a.blocked.add(MAIN);a.run('savePro(0)');assert.equal(a.toasts.length,0);assert.equal(a.fields.get('pro0').value,'90');assert.equal(a.storage.has(MAIN),false);assert.equal(a.snapshot('prepareDataForPwaUpdate().reason'),'unsaved-data');
});
test('equivalent legacy JSON field order does not block updates or rewrite stored data',()=>{
 const a=setup();a.run('persist()');const original=JSON.parse(a.storage.get(MAIN));
 function reverseKeys(value){if(Array.isArray(value))return value.map(reverseKeys);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reverseKeys(value[key])]));return value}
 const reordered=JSON.stringify(reverseKeys(original));a.storage.set(MAIN,reordered);
 assert.equal(a.snapshot('prepareDataForPwaUpdate().ok'),true);assert.equal(a.storage.get(MAIN),reordered);
 a.run('data.workouts.reverse()');assert.equal(a.snapshot('prepareDataForPwaUpdate().reason'),'unsaved-data');
});
