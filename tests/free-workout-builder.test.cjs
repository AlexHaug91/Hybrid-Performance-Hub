const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const script = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1].replace(/init\(\);\s*$/, '');
const MAIN = 'hyrox_performance_hub_v1', DRAFTS = 'hyrox_performance_hub_v4_drafts';
function setup(storage = new Map()) {
  const fields = new Map(), alerts = [], toasts = [], blocked = new Set();
  const context = vm.createContext({
    structuredClone, crypto: { randomUUID: () => 'deterministic-id' },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { if (blocked.has(key)) throw Error('Blocked'); storage.set(key, value); },
      removeItem: key => storage.delete(key),
    },
    document: {
      getElementById: id => {
        if (!fields.has(id)) fields.set(id, { value: '', innerHTML: '', textContent: '', style: { setProperty() {} }, disabled: false, classList: { add() {}, remove() {} }, scrollIntoView() {} });
        return fields.get(id);
      }, querySelector: () => null,
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

test('new workout reuses the existing editor and persists all metadata with a stable ID', () => {
  const app = setup(), before = app.snapshot('data.workouts');
  const id = app.create('Min økt', 4);
  assert.equal(app.snapshot('data.workouts.length'), 5);
  assert.deepEqual(app.snapshot('data.workouts.slice(0,4)'), before);
  assert.deepEqual(app.snapshot('data.workouts[4]'), { id, title: 'Min økt', day: 4, location: 'Treningssenter', focus: 'Eget fokus', description: 'Min beskrivelse', mode: 'mixed', exercises: [{ name: 'Ny øvelse', dose: '3 × 8', target: '', unit: 'kg' }] });
  assert.equal(JSON.parse(app.storage.get(MAIN)).workouts[4].id, id);
  assert.equal(app.snapshot('newWorkoutDraft'), null);
  assert.equal(app.toasts.at(-1), 'Ny økt lagret');
});

test('several workouts on the same day have unique IDs even with the same title and UUID seed', () => {
  const app = setup(), ids = Array.from({ length: 6 }, () => app.create('Samme navn', 1));
  assert.equal(new Set(ids).size, 6);
  assert.equal(app.snapshot('data.workouts.length'), 10);
  assert.equal(app.snapshot('getWorkouts().filter(w=>w.day===1).length'), 7);
});

test('fallback IDs work when randomUUID is unavailable', () => {
  const app = setup(); app.run('crypto.randomUUID=undefined');
  const first = app.create(), second = app.create();
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_.:-]+$/);
});

for (const day of [0,1,2,3,4,5,6]) test(`new workout supports weekday ${day}`, () => {
  const app = setup(), id = app.create('Ukedag', day);
  app.context.selectedId = id;
  assert.equal(app.snapshot('data.workouts.find(w=>w.id===selectedId).day'), day);
});

test('invalid/unfinished new workout is not saved; closing leaves existing data untouched', () => {
  const app = setup(), before = app.snapshot('data');
  app.run('persist();createWorkout();saveWorkout()');
  assert.deepEqual(app.snapshot('data'), before);
  assert.match(app.alerts.at(-1), /navn/);
  app.fields.get('editTitle').value = 'Mangler øvelser'; app.run('saveWorkout()');
  assert.match(app.alerts.at(-1), /minst én/);
  assert.deepEqual(app.snapshot('data'), before);
  app.run('addExercise();updateEditEx(0,"name","Ulagret øvelse");closeEdit()');
  assert.deepEqual(JSON.parse(app.storage.get(MAIN)), before);
});

test('invalid training day is rejected without adding the template', () => {
  const app = setup(); app.run('createWorkout();addExercise()');
  app.fields.get('editTitle').value = 'Ugyldig dag'; app.fields.get('editDay').value = '7'; app.run('saveWorkout()');
  assert.equal(app.snapshot('data.workouts.length'), 4);
  assert.match(app.alerts.at(-1), /treningsdag/);
});

test('new workout storage failure preserves editor, exercises and form values for retry', () => {
  const app = setup(); app.blocked.add(MAIN); app.create('Prøv igjen', 3);
  assert.equal(app.snapshot('data.workouts.length'), 4);
  assert.equal(app.snapshot('newWorkoutDraft.exercises.length'), 1);
  assert.equal(app.fields.get('editTitle').value, 'Prøv igjen');
  assert.ok(!app.toasts.includes('Ny økt lagret'));
  assert.match(app.alerts.at(-1), /kunne ikke lagres/);
  const id = app.snapshot('editing'); app.blocked.clear(); app.run('saveWorkout()');
  assert.equal(app.snapshot('data.workouts.length'), 5);
  assert.equal(app.snapshot('data.workouts[4].id'), id);
});

test('new workouts can be opened and logged immediately without reloading', () => {
  const app = setup(), id = app.create(); app.open(id);
  assert.equal(app.snapshot('logState.type'), id);
  assert.equal(app.snapshot('logState.items[0].entries.length'), 3);
  app.fields.get('l4-0-0-value').value = '60'; app.run('markAllSets(0);saveLog()');
  assert.equal(app.snapshot('data.logs.length'), 1);
  assert.equal(app.snapshot('data.logs[0].type'), id);
  assert.equal(app.snapshot('data.logs[0].exercises[0].sets[0].value'), 60);
  assert.equal(app.snapshot('data.logs[0].title'), 'Egen styrke');
});

test('saving a new workout updates the log choices while preserving current selection and draft', () => {
  const app = setup(); app.open('upper'); app.fields.get('logRpe').value = '8'; app.run('captureLogState()');
  const draft = app.snapshot('logDrafts'), id = app.create();
  assert.equal(app.fields.get('logType').value, 'upper');
  assert.ok(app.fields.get('logType').innerHTML.includes(id));
  assert.deepEqual(app.snapshot('logDrafts'), draft);
});

test('reopening and renaming a new template keeps its ID and updates the log choices', () => {
  const app = setup(), id = app.create(); app.context.selectedId = id; app.run('editWorkout(selectedId)');
  assert.equal(app.fields.get('editDay').disabled, true);
  app.fields.get('editTitle').value = 'Nytt navn'; app.run('saveWorkout()');
  assert.equal(app.snapshot('data.workouts[4].id'), id);
  assert.equal(app.snapshot('data.workouts[4].title'), 'Nytt navn');
  assert.match(app.fields.get('logType').innerHTML, /Nytt navn/);
});

test('custom interval ID uses the original interval builder, series, units and bulk logging', () => {
  const app = setup(); app.run('createWorkout();setWorkoutMode("interval");addIntervalPart("Oppvarming")');
  app.fields.get('editTitle').value = 'Egne intervaller';
  app.run("for(const id of ['seqCount','seqDuration','seqSpeed','seqPause'])document.getElementById(id)");
  app.fields.get('seqCount').value = '4'; app.fields.get('seqDuration').value = '4'; app.fields.get('seqSpeed').value = '12.5'; app.fields.get('seqPause').value = '2';
  app.run('addIntervalSeries();updateIntervalUnit(1,"min/km")');
  assert.equal(app.snapshot('newWorkoutDraft.exercises.length'), 8);
  assert.equal(app.snapshot('newWorkoutDraft.exercises[1].target'), '4.80');
  const id = app.snapshot('editing'); app.run('saveWorkout()'); app.open(id);
  assert.equal(app.snapshot('isIntervalLog(logState)'), true);
  assert.equal(app.snapshot('logState.items[1].entries[0].qty'), '4');
  assert.equal(app.snapshot('logState.items[1].entries[0].value'), '4.80');
  app.run('markAllIntervals();saveLog()');
  assert.equal(app.snapshot('data.logs[0].type'), id);
  assert.equal(app.snapshot('data.logs[0].exercises[1].kind'), 'interval');
  assert.equal(app.snapshot('data.logs[0].exercises[1].unit'), 'min/km');
});

test('several independent interval templates do not depend on the legacy interval ID', () => {
  const app = setup(), a = app.create('Intervall A', 1, 'interval'), b = app.create('Intervall B', 1, 'interval');
  for (const id of [a,b,'interval']) { app.open(id); assert.equal(app.snapshot('isIntervalLog(logState)'), true); }
});

test('builder mode cannot silently reinterpret an already populated new template', () => {
  const app = setup(); app.run('createWorkout();addExercise();setWorkoutMode("interval")');
  assert.equal(app.snapshot('newWorkoutDraft.mode'), 'mixed');
  assert.equal(app.snapshot('newWorkoutDraft.exercises.length'), 1);
  assert.match(app.alerts.at(-1), /før øvelsene/);
});

test('new mixed workout supports running distance and HYROX stations with the existing controls', () => {
  const app = setup(); app.run('createWorkout();addExercise();updateEditEx(0,"name","Løp");updateEditEx(0,"dose","4 × 1 km");updateEditEx(0,"target","4");updateEditEx(0,"unit","km");addExercise();updateEditEx(1,"name","Sled push")');
  app.fields.get('editTitle').value = 'Egen HYROX'; const id = app.snapshot('editing'); app.run('saveWorkout()'); app.open(id);
  assert.deepEqual(app.snapshot('logState.items[0].entries.map(e=>e.value)'), ['1','1','1','1']);
  assert.equal(app.snapshot('logState.items[1].kind'), 'weight');
});

test('new templates persist across environment restart without rewriting existing templates', () => {
  const app = setup(), defaults = app.snapshot('data.workouts'), id = app.create('Bevar meg', 0, 'interval');
  const restored = setup(app.storage); restored.context.selectedId = id;
  assert.deepEqual(restored.snapshot('data.workouts.slice(0,4)'), defaults);
  assert.equal(restored.snapshot('data.workouts.find(w=>w.id===selectedId).mode'), 'interval');
  restored.open(id); assert.equal(restored.snapshot('logState.items[0].kind'), 'interval');
});

test('new templates, custom interval logs and drafts survive JSON import/export', async () => {
  const app = setup(), id = app.create('JSON-intervaller', 2, 'interval'); app.open(id); app.run('markAllIntervals();saveLog()');
  app.fields.get('logNotes').value = 'Min historiske kladd'; app.run('captureLogState()');
  const backup = app.snapshot('validateBackup({...data,draftsV4:logDrafts})');
  const restored = setup(); restored.context.backupText = JSON.stringify(backup);
  await restored.run("importData({target:{files:[{text:async()=>backupText}],value:''}})");
  assert.deepEqual(restored.snapshot('data.workouts'), backup.workouts);
  assert.deepEqual(restored.snapshot('data.logs'), backup.logs);
  restored.open(id); assert.equal(restored.fields.get('logNotes').value, 'Min historiske kladd');
});

test('changes to a new template cannot alter its historical exercise snapshot', () => {
  const app = setup(), id = app.create(); app.open(id); app.run('markAllSets(0);saveLog()');
  const original = app.snapshot('data.logs[0]'); app.context.selectedId = id; app.run('editWorkout(selectedId);removeEx(0);addExercise();updateEditEx(0,"name","Ny øvelse etter logging")');
  app.fields.get('editTitle').value = 'Endret tittel'; app.run('saveWorkout()');
  assert.deepEqual(app.snapshot('data.logs[0]'), original);
  app.run('editSavedLog(data.logs[0].id);saveLog()');
  assert.deepEqual(app.snapshot('data.logs[0].exercises'), original.exercises);
  assert.equal(app.snapshot('data.logs[0].title'), original.title);
});

test('all four legacy templates retain their original logging semantics', () => {
  const app = setup();
  for (const type of ['interval','hyrox','upper','legs']) { app.open(type); assert.equal(app.snapshot('logState.type'), type); }
  assert.equal(app.snapshot('logState.items[0].kind'), 'weight');
  app.open('interval'); assert.equal(app.snapshot('logState.items[0].kind'), 'interval');
  assert.equal(app.snapshot('data.workouts.some(w=>w.mode!==undefined)'), false);
});

test('import rejects invalid custom builder modes', () => {
  const app = setup();
  assert.throws(() => app.run('validateBackup({...data,workouts:data.workouts.map((w,i)=>i?w:{...w,mode:"script"})})'), /mode/);
});

test('custom titles render as text and IDs stay safe for existing inline handlers', () => {
  const app = setup(), id = app.create('<img src=x onerror=alert(1)>', 1);
  assert.match(id, /^[A-Za-z0-9_.:-]+$/);
  app.run('renderPlan()');
  assert.ok(!app.fields.get('planCards').innerHTML.includes('<img src=x'));
  assert.ok(app.fields.get('planCards').innerHTML.includes('&lt;img'));
});

test('cancelling replacement of an unsaved new template leaves it intact', () => {
  const app = setup(); app.run('createWorkout();addExercise();confirm=()=>false');
  const before = app.snapshot('newWorkoutDraft'); app.run('createWorkout()');
  assert.deepEqual(app.snapshot('newWorkoutDraft'), before);
  app.run('editWorkout("upper")'); assert.deepEqual(app.snapshot('newWorkoutDraft'), before);
});
