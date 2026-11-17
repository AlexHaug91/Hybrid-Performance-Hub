const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const script = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1].replace(/init\(\);\s*$/, '');
const MAIN = 'hyrox_performance_hub_v1', DRAFTS = 'hyrox_performance_hub_v4_drafts';
function setup(storage = new Map()) {
  const fields = new Map(), alerts = [];
  const context = vm.createContext({
    structuredClone, crypto: { randomUUID: () => 'distance-session' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { getElementById: id => {
      if (!fields.has(id)) fields.set(id, { value: '', style: {}, classList: { add() {} }, scrollIntoView() {} });
      return fields.get(id);
    } }, alert: message => alerts.push(message), confirm: () => true,
  });
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  const snapshot = expr => JSON.parse(run(`JSON.stringify(${expr})`));
  run(`
    toast=()=>{};renderAll=()=>{};renderEditExercises=()=>{};
    renderLogUI=()=>{
      for(const [id,key] of [['logRpe','rpe'],['logDuration','duration'],['logNotes','notes']])document.getElementById(id).value=logState[key];
      logState.items.forEach((item,i)=>item.entries.forEach((entry,j)=>{for(const key of ['value','qty'])document.getElementById('l4-'+i+'-'+j+'-'+key).value=entry[key]}));
    };
  `);
  const begin = type => {
    context.selectedType = type;
    run("document.getElementById('logType').value=selectedType;document.getElementById('logDate').value='2026-11-17';renderLogFields()");
  };
  const saveTemplate = type => {
    context.selectedType = type;
    run("editing=selectedType;const template=data.workouts.find(w=>w.id===selectedType);for(const [id,key] of [['editTitle','title'],['editLocation','location'],['editFocus','focus'],['editDesc','description']])document.getElementById(id).value=template[key];saveWorkout()");
  };
  return { run, snapshot, begin, saveTemplate, fields, storage, context, alerts };
}

for (const [name, field, value] of [
  ['weight', 'l4-0-0-value', '72.5'], ['repetitions', 'l4-0-0-qty', '9'],
  ['RPE', 'logRpe', '8'], ['duration', 'logDuration', '55'], ['notes', 'logNotes', 'Dagsform'],
]) test(`template save preserves a draft containing ${name}, even with zero completed sets`, () => {
  const app = setup(); app.begin('upper');
  app.fields.get(field).value = value; app.run('captureLogState()');
  const before = app.snapshot('logState'), persisted = app.storage.get(DRAFTS);
  app.saveTemplate('upper');
  assert.deepEqual(app.snapshot('logState'), before);
  assert.equal(app.storage.get(DRAFTS), persisted);
  const reloaded = setup(app.storage); reloaded.begin('upper');
  assert.equal(reloaded.fields.get(field).value, value);
  assert.equal(reloaded.snapshot('countLog().done'), 0);
});

for (const [name, mutation] of [
  ['move', 'moveInterval(0,1)'], ['copy', 'duplicateEx(0)'], ['delete', 'removeEx(0)'],
  ['rename', "updateEditEx(0,'name','Ny øvelse')"],
  ['change dose', "updateEditEx(0,'dose','10 × 20')"],
  ['change unit', "updateEditEx(0,'unit','reps')"],
]) test(`${name} in a template preserves the original draft snapshot and entered values`, () => {
  const app = setup(); app.begin('upper');
  app.fields.get('l4-0-0-value').value = '75'; app.run('captureLogState()');
  const before = app.snapshot('logState');
  app.run(`editing='upper';${mutation}`); app.saveTemplate('upper');
  assert.deepEqual(app.snapshot('logState'), before);
  const restored = setup(app.storage); restored.begin('upper');
  assert.deepEqual(restored.snapshot('logState'), before);
});

test('skipped-only draft and other session drafts are retained after a template save', () => {
  const app = setup(); app.begin('upper'); app.run("toggleLogEntry(0,0,'skip')");
  app.begin('hyrox'); app.fields.get('logRpe').value = '6'; app.run('captureLogState()');
  const before = app.snapshot('logDrafts'); app.saveTemplate('hyrox');
  assert.deepEqual(app.snapshot('logDrafts'), before);
});

test('unpersisted untouched initial state refreshes from the edited template', () => {
  const app = setup(); app.begin('upper');
  assert.equal(app.snapshot('Object.keys(logDrafts).length'), 0);
  app.run("data.workouts.find(w=>w.id==='upper').exercises[0].name='Ny benk'");
  app.saveTemplate('upper'); app.run('renderLogFields()');
  assert.equal(app.snapshot('logState.items[0].name'), 'Ny benk');
});

test('default 4 x 1 km prefills 1 km per entry and saves 4 km total', () => {
  const app = setup(); app.begin('hyrox');
  assert.deepEqual(app.snapshot('logState.items[0].entries.map(e=>e.value)'), ['1','1','1','1']);
  assert.deepEqual(app.snapshot('logState.items[0].plannedDistance'), { count: 4, perEntry: 1, total: 4, unit: 'km' });
  app.run('markAllSets(0);saveLog()');
  const saved = app.snapshot('data.logs[0].exercises[0]');
  assert.equal(saved.value, 4);
  assert.deepEqual(saved.sets.map(e => e.value), [1,1,1,1]);
  assert.equal(saved.plannedDistance.total, 4);
  assert.equal(JSON.parse(app.storage.get(MAIN)).logs[0].exercises[0].value, 4);
});

for (const [dose, target, unit, count, perEntry, total] of [
  ['4 × 1 km', '4', 'km', 4, 1, 4], ['4x500 m', '2', 'km', 4, 0.5, 2],
  ['5 X 0,4 km', '2000', 'm', 5, 400, 2000], ['6 × 250 meter', '1500', 'm', 6, 250, 1500],
  ['3 × 0.5 kilometers', '1.5', 'km', 3, 0.5, 1.5], ['4 × 1', '4', 'km', 4, 1, 4],
  ['4 drag', '2', 'km', 4, 0.5, 2], ['3 runder', '900', 'm', 3, 300, 900],
  ['5 km (rolig)', '5', 'km', 1, 5, 5], ['Valgfri løping', '8', 'km', 1, 8, 8],
  ['4 × 1 km', '7', 'km', 4, 1, 4], ['40 × 100 m', '4000', 'm', 40, 100, 4000],
  ['3 × 0.1 km', '0.3', 'km', 3, 0.1, 0.3],
]) test(`${dose}, target ${target} ${unit}: separates total from each entry`, () => {
  const app = setup();
  app.context.exercise = { name: 'Distanse', dose, target, unit };
  app.run("data.workouts.find(w=>w.id==='hyrox').exercises=[exercise]"); app.begin('hyrox');
  assert.deepEqual(app.snapshot('logState.items[0].plannedDistance'), { count, perEntry, total, unit });
  assert.equal(app.snapshot('logState.items[0].entries.length'), count);
  assert.ok(app.snapshot('logState.items[0].entries').every(e => Number(e.value) === perEntry));
  app.run('markAllSets(0);saveLog()');
  assert.equal(app.snapshot('data.logs[0].exercises[0].value'), total);
});

test('only completed distances are summed; changed actual distances do not change the plan', () => {
  const app = setup(); app.begin('hyrox');
  app.fields.get('l4-0-0-value').value = '0.8'; app.run("toggleLogEntry(0,0,'done');toggleLogEntry(0,1,'done');saveLog()");
  assert.equal(app.snapshot('data.logs[0].exercises[0].value'), 1.8);
  assert.equal(app.snapshot('data.logs[0].exercises[0].plannedDistance.total'), 4);
});

for (const dose of ['4 × 2 min', '4 × 8 reps', '4 × 500–800 m']) test(`ambiguous distance dose '${dose}' is not guessed`, () => {
  const app = setup(); app.context.dose = dose;
  app.run("data.workouts.find(w=>w.id==='hyrox').exercises=[{name:'Distanse',dose,target:'4',unit:'km'}]"); app.begin('hyrox');
  assert.equal(app.snapshot('logState.items[0].plannedDistance.total'), null);
  assert.deepEqual(app.snapshot('logState.items[0].entries.map(e=>e.value)'), ['','','','']);
});

test('time intervals, km/h, min/km and strength retain their previous handling', () => {
  const app = setup(); app.begin('interval');
  assert.equal(app.snapshot('logState.items[1].kind'), 'interval');
  assert.equal(app.snapshot('logState.items[1].entries[0].value'), '12.5');
  assert.equal(app.snapshot('logState.items[1].entries[0].qty'), '4');
  app.run("data.workouts[0].exercises[1].unit='min/km';data.workouts[0].exercises[1].target='4.8';logKey='';logState=null;renderLogFields()");
  assert.equal(app.snapshot('logState.items[1].entries[0].value'), '4.8');
  assert.equal(app.snapshot('logState.items[1].entries[0].qty'), '4');
  app.begin('upper');
  assert.equal(app.snapshot('logState.items[0].entries.length'), 4);
  assert.equal(app.snapshot('logState.items[0].entries[0].qty'), '6');
  assert.equal(app.snapshot("plannedDistance({unit:'min',dose:'4 × 4',target:'16'})"), null);
});

test('existing distance drafts keep entered values even when they contain the old prefills', () => {
  const app = setup(); app.begin('hyrox');
  app.run("delete logState.items[0].plannedDistance;logState.items[0].entries.forEach(e=>e.value='4');renderLogUI();captureLogState()");
  const old = app.snapshot('logState'); app.saveTemplate('hyrox');
  const restored = setup(app.storage); restored.begin('hyrox');
  assert.deepEqual(restored.snapshot('logState'), old);
  assert.deepEqual(restored.snapshot('logState.items[0].entries.map(e=>e.value)'), ['4','4','4','4']);
});

test('existing historical distance results are not recalculated by the new planning logic', () => {
  const app = setup();
  app.run("data.logs=[{id:'old',created:1,date:'2026-11-17',type:'hyrox',title:'Eldre økt',status:'complete',rpe:null,duration:null,notes:'',exercises:[{name:'Løp',dose:'4 × 1 km',value:16,unit:'km',kind:'amount',sets:Array.from({length:4},()=>({done:true,skipped:false,value:4,qty:null}))}]}];persist()");
  const old = app.snapshot('data.logs[0].exercises'); app.begin('hyrox'); app.run('saveLog()');
  assert.deepEqual(app.snapshot('data.logs[0].exercises'), old);
});

test('distance draft, saved snapshots and ongoing sessions survive reload and JSON validation', () => {
  const app = setup(); app.begin('hyrox'); app.fields.get('logRpe').value = '6'; app.run('captureLogState()');
  const before = app.snapshot('logState');
  app.run('validateBackup({...data,draftsV4:logDrafts})');
  const restored = setup(app.storage); restored.begin('hyrox');
  assert.deepEqual(restored.snapshot('logState'), before);
  restored.run("markAllSets(0);saveLog('partial');validateBackup({...data,draftsV4:logDrafts})");
  const again = setup(restored.storage); again.begin('hyrox');
  assert.equal(again.snapshot('logState.items[0].plannedDistance.total'), 4);
  assert.equal(again.snapshot('logState.items[0].entries[0].done'), true);
});

test('JSON rejects malformed distance metadata without loosening existing import checks', () => {
  const app = setup(); app.begin('hyrox'); app.run('captureLogState()');
  assert.throws(() => app.run("validateBackup({...data,draftsV4:{[logKey]:{...logDrafts[logKey],state:{...logState,items:logState.items.map((i,n)=>n?i:{...i,plannedDistance:{count:4,perEntry:1,total:16,unit:'km'}})}}}})"), /plannedDistance/);
});

for (const dose of ['4 × 1 km + 2 × 500 m', '3 km + 2 km', '3 km og 2 km', '2 × 500 m; 2 × 1000 m']) test(`compound dose '${dose}' never prefills only its first distance`, () => {
  const app = setup(); app.context.dose = dose;
  app.run("data.workouts.find(w=>w.id==='hyrox').exercises=[{name:'Sammensatt løp',dose,target:'5',unit:'km'}]");
  app.begin('hyrox');
  assert.equal(app.snapshot('logState.items[0].plannedDistance.total'), null);
  assert.equal(app.snapshot('logState.items[0].plannedDistance.perEntry'), null);
  assert.ok(app.snapshot('logState.items[0].entries').every(entry => entry.value === ''));
});
