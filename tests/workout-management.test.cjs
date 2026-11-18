const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const script = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1].replace(/init\(\);\s*$/, '');
const MAIN = 'hyrox_performance_hub_v1', DRAFTS = 'hyrox_performance_hub_v4_drafts';
function setup(storage = new Map()) {
  const fields = new Map(), alerts = [], toasts = [], confirmations = [], blocked = new Set();
  let sequence = 0;
  const context = vm.createContext({
    structuredClone, crypto: { randomUUID: () => 'id-'+(++sequence) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (blocked.has(key)) throw Error('Blocked'); storage.set(key, value); }, removeItem: key => storage.delete(key) },
    document: {
      getElementById: id => {
        if (!fields.has(id)) fields.set(id, { value: '', innerHTML: '', textContent: '', style: { setProperty() {} }, classList: { add() {}, remove() {} }, scrollIntoView() {}, focus() {} });
        return fields.get(id);
      }, querySelector: () => null,
    },
    requestAnimationFrame: callback => callback(), alert: message => alerts.push(message), confirm: message => { confirmations.push(message); return true; }, recordToast: message => toasts.push(message),
  });
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  const snapshot = expr => JSON.parse(run(`JSON.stringify(${expr})`));
  run(`nav=()=>{};toast=recordToast;renderAll=()=>{};
    renderLogUI=()=>{
      for(const [id,key] of [['logRpe','rpe'],['logDuration','duration'],['logNotes','notes']])document.getElementById(id).value=logState[key];
      logState.items.forEach((item,i)=>item.entries.forEach((entry,j)=>{for(const key of ['value','qty'])document.getElementById('l4-'+i+'-'+j+'-'+key).value=entry[key]}));
    };persist();refreshWorkoutChoices();`);
  const open = (type, date = '2026-11-18') => { context.selectedType = type; context.selectedDate = date; run('quickLog(selectedType,selectedDate)'); };
  const archive = type => { context.selectedType = type; run('archiveWorkout(selectedType)'); };
  const copy = type => { context.selectedType = type; run('copyWorkout(selectedType)'); };
  const note = value => { fields.get('logNotes').value = value; run('captureLogState()'); };
  return { run, snapshot, storage, fields, alerts, toasts, confirmations, blocked, context, open, archive, copy, note };
}

for (const type of ['interval','hyrox','upper','legs']) test(`copies ${type} with independent exercise data and a new stable ID`, () => {
  const app = setup(), original = app.snapshot('data.workouts'); app.copy(type);
  const id = app.snapshot('editing'), originalTemplate = original.find(w => w.id === type);
  assert.notEqual(id, type);
  assert.deepEqual(app.snapshot('newWorkoutDraft.exercises'), originalTemplate.exercises);
  for (const key of ['location','focus','description','day']) assert.equal(app.snapshot('newWorkoutDraft.'+key), originalTemplate[key]);
  assert.equal(app.snapshot('newWorkoutDraft.mode'), type === 'interval' ? 'interval' : 'mixed');
  app.fields.get('editTitle').value = 'Min kopi'; app.fields.get('editDay').value = '2';
  app.run("editedWorkout().exercises[0].name='Kun kopien';saveWorkout()");
  assert.deepEqual(app.snapshot('data.workouts.slice(0,4)'), original);
  assert.equal(app.snapshot('data.workouts[4].day'), 2);
  assert.equal(app.snapshot('data.workouts[4].id'), id);
  const restored = setup(app.storage); restored.open(id);
  assert.equal(restored.snapshot('logState.items[0].name'), 'Kun kopien');
});

test('copy never inherits logs or ongoing drafts from its source', () => {
  const app = setup(); app.open('upper'); app.run('markAllSets(0);saveLog("partial")'); app.note('Kladd original');
  const logs = app.snapshot('data.logs'), drafts = app.snapshot('logDrafts');
  app.copy('upper'); const id = app.snapshot('editing'); app.run('saveWorkout()'); app.open(id);
  assert.deepEqual(app.snapshot('data.logs'), logs);
  assert.deepEqual(app.snapshot('logDrafts'), drafts);
  assert.equal(app.snapshot('logEditingId'), null);
  assert.equal(app.snapshot('logState.notes'), '');
  assert.equal(app.snapshot('countLog().done'), 0);
});

test('copy deeply isolates optional nested set metadata and converts the legacy interval mode', () => {
  const app = setup(); app.run("data.workouts[0].exercises[0].sets=[{qty:4}]"); app.copy('interval');
  app.run('newWorkoutDraft.exercises[0].sets[0].qty=99');
  assert.equal(app.snapshot('data.workouts[0].exercises[0].sets[0].qty'), 4);
  const id = app.snapshot('editing'); app.run('saveWorkout()'); app.open(id);
  assert.equal(app.snapshot('isIntervalLog(logState)'), true);
});

test('copy cancellation and reload before save leave no duplicate template', () => {
  const app = setup(), before = app.snapshot('data'); app.copy('upper'); app.run('duplicateEx(0);closeEdit()');
  assert.deepEqual(app.snapshot('data'), before);
  assert.deepEqual(setup(app.storage).snapshot('data'), before);
});

test('failed copy save keeps staged copy and original data intact for retry', () => {
  const app = setup(), before = app.storage.get(MAIN); app.copy('upper'); const id = app.snapshot('editing');
  app.blocked.add(MAIN); app.run('saveWorkout()');
  assert.equal(app.storage.get(MAIN), before);
  assert.equal(app.snapshot('data.workouts.length'), 4);
  assert.equal(app.snapshot('newWorkoutDraft.id'), id);
  app.blocked.clear(); app.run('saveWorkout()'); assert.equal(app.snapshot('data.workouts[4].id'), id);
});

for (const day of [0,1,2,3,4,5,6]) test(`moves an existing workout to weekday ${day} without changing its ID or history`, () => {
  const app = setup(); app.open('upper'); app.run('markAllSets(0);saveLog()');
  const logs = app.snapshot('data.logs'); app.run("moveWorkout('upper')");
  assert.equal(app.fields.get('editDay').disabled, false); app.fields.get('editDay').value = String(day); app.run('saveWorkout()');
  assert.equal(app.snapshot("data.workouts.find(w=>w.id==='upper').day"), day);
  assert.deepEqual(app.snapshot('data.logs'), logs);
  assert.equal(setup(app.storage).snapshot("data.workouts.find(w=>w.id==='upper').day"), day);
});

test('several moved workouts may share the same day; closing movement leaves day unchanged', () => {
  const app = setup();
  app.run("moveWorkout('upper')"); app.fields.get('editDay').value = '1'; app.run('closeEdit()');
  assert.equal(app.snapshot("data.workouts.find(w=>w.id==='upper').day"), 6);
  for (const type of ['upper','legs']) { app.context.selectedType = type; app.run('moveWorkout(selectedType)'); app.fields.get('editDay').value = '1'; app.run('saveWorkout()'); }
  assert.equal(app.snapshot('getWorkouts().filter(w=>w.day===1).length'), 3);
});

test('failed move cannot change stored day or history and retains the chosen day for retry', () => {
  const app = setup(), before = app.storage.get(MAIN); app.run("moveWorkout('upper')"); app.fields.get('editDay').value = '2';
  app.blocked.add(MAIN); app.run('saveWorkout()');
  assert.equal(app.storage.get(MAIN), before); assert.equal(app.snapshot("data.workouts.find(w=>w.id==='upper').day"), 6);
  assert.equal(app.fields.get('editDay').value, '2');
  app.blocked.clear(); app.run('saveWorkout()'); assert.equal(app.snapshot("data.workouts.find(w=>w.id==='upper').day"), 2);
});

test('archiving without history retains the template but removes normal plan/log choices', () => {
  const app = setup(), before = app.snapshot('data.workouts[2]'); app.archive('upper');
  assert.equal(app.snapshot('data.workouts.length'), 4);
  assert.deepEqual(app.snapshot('({...data.workouts[2],archived:undefined,archivedAt:undefined})'), before);
  assert.equal(app.snapshot('data.workouts[2].archived'), true);
  assert.equal(app.snapshot("getWorkouts().some(w=>w.id==='upper')"), false);
  assert.ok(!app.fields.get('logType').innerHTML.includes('value="upper"'));
  assert.match(app.confirmations[0], /historikk|Treningshistorikk/);
  app.open('upper'); assert.match(app.alerts.at(-1), /fjernet/);
});

for (const status of ['complete','partial']) test(`historical ${status} record can be edited by ID after its template is archived`, () => {
  const app = setup(); app.open('upper'); app.run(`markAllSets(0);saveLog('${status}')`); const before = app.snapshot('data.logs[0]');
  app.archive('upper'); assert.deepEqual(app.snapshot('data.logs[0]'), before);
  app.run('editSavedLog(data.logs[0].id)');
  assert.equal(app.fields.get('logType').value, 'upper');
  assert.match(app.fields.get('logType').innerHTML, /fjernet fra planen/);
  app.note('Redigert historikk'); app.run(`saveLog('${status}')`);
  assert.equal(app.snapshot('data.logs.length'), 1);
  assert.equal(app.snapshot('data.logs[0].id'), before.id);
  assert.equal(app.snapshot('data.logs[0].notes'), 'Redigert historikk');
  assert.deepEqual(app.snapshot('data.logs[0].exercises'), before.exercises);
});

test('unbound archived draft is accessible from Plan and can be completed with the original snapshot', () => {
  const app = setup(); app.open('upper'); app.fields.get('l4-0-0-value').value = '72.5'; app.note('Fortsett meg');
  const key = app.snapshot('logKey'); app.archive('upper');
  app.run('renderArchivedDrafts()'); assert.match(app.fields.get('archivedDrafts').innerHTML, /Fortsett kladd/);
  app.context.key = key; app.run('resumeArchivedDraft(key)');
  assert.equal(app.fields.get('l4-0-0-value').value, '72.5'); assert.equal(app.snapshot('logState.notes'), 'Fortsett meg');
  app.run('markAllSets(0);saveLog()');
  assert.equal(app.snapshot('data.logs[0].type'), 'upper');
  assert.equal(app.snapshot('data.logs[0].exercises[0].sets[0].value'), 72.5);
  assert.equal(app.snapshot('Object.keys(logDrafts).length'), 0);
});

test('archived new-session draft never replaces a saved record with the same date and type', () => {
  const app = setup(); app.open('upper'); app.run('markAllSets(0);saveLog();newLogSession()'); app.note('Ny separat kladd');
  const key = app.snapshot('logKey'), original = app.snapshot('data.logs[0]'); app.archive('upper');
  app.context.key = key; app.run('resumeArchivedDraft(key);markAllSets(0);saveLog()');
  assert.equal(app.snapshot('data.logs.length'), 2);
  assert.deepEqual(app.snapshot('data.logs[0]'), original);
});

test('multiple same-day historical drafts remain isolated after archiving', () => {
  const app = setup(); app.open('upper'); app.run('markAllSets(0);saveLog();newLogSession();markAllSets(0);saveLog()');
  const ids = app.snapshot('data.logs.map(l=>l.id)');
  app.context.a = ids[0]; app.context.b = ids[1]; app.run('editSavedLog(a)'); app.note('Kladd A'); app.run('editSavedLog(b)'); app.note('Kladd B');
  app.archive('upper'); app.run('editSavedLog(a)'); assert.equal(app.fields.get('logNotes').value, 'Kladd A');
  app.run('editSavedLog(b)'); assert.equal(app.fields.get('logNotes').value, 'Kladd B');
});

test('archiving all templates gives a safe empty plan but historical edits and new creation still work', () => {
  const app = setup(); app.open('interval'); app.run('markAllIntervals();saveLog()');
  for (const type of ['interval','hyrox','upper','legs']) app.archive(type);
  assert.deepEqual(app.snapshot('getWorkouts()'), []);
  assert.equal(app.fields.get('logType').value, '');
  assert.equal(app.snapshot('logState'), null);
  assert.equal(app.fields.get('saveCompleteButton').disabled, true);
  app.run('validateBackup({...data,draftsV4:logDrafts});editSavedLog(data.logs[0].id)');
  assert.equal(app.snapshot('logState.type'), 'interval');
  app.run('createWorkout();addExercise()'); app.fields.get('editTitle').value = 'Ny plan'; app.run('saveWorkout()');
  assert.equal(app.snapshot('getWorkouts().length'), 1);
});

test('switching from archived history to an active workout removes its context-only choice', () => {
  const app = setup(); app.open('upper'); app.run('markAllSets(0);saveLog()'); app.archive('upper'); app.run('editSavedLog(data.logs[0].id)');
  app.fields.get('logType').value = 'hyrox'; app.run('selectLogWorkout()');
  assert.ok(!app.fields.get('logType').innerHTML.includes('value="upper"'));
  assert.equal(app.snapshot('logState.type'), 'hyrox');
});

test('new blank logging is blocked for removed templates; prior history remains editable', () => {
  const app = setup(); app.open('upper'); app.run('markAllSets(0);saveLog()'); app.archive('upper'); app.run('editSavedLog(data.logs[0].id)');
  const before = app.snapshot('data.logs'); app.run('newLogSession()'); assert.deepEqual(app.snapshot('data.logs'), before);
  assert.match(app.alerts.at(-1), /fjernet/);
  app.fields.get('logDate').value = '2026-12-31'; app.run('renderLogFields()');
  assert.notEqual(app.snapshot('logState?.type||null'), 'upper');
});

test('cancelling archive is a complete no-op including storage and drafts', () => {
  const app = setup(); app.open('upper'); app.note('Kladd');
  const state = app.snapshot('data'), drafts = app.snapshot('logDrafts'), stored = [...app.storage];
  app.run('confirm=()=>false'); app.archive('upper');
  assert.deepEqual(app.snapshot('data'), state); assert.deepEqual(app.snapshot('logDrafts'), drafts); assert.deepEqual([...app.storage], stored);
});

for (const key of [MAIN,DRAFTS]) test(`archive storage failure at ${key} leaves template active and preserves logs/drafts`, () => {
  const app = setup(); app.open('upper'); app.run('markAllSets(0);saveLog("partial")'); app.note('Ulagret endring');
  const original = app.snapshot('data'), drafts = app.snapshot('logDrafts'); app.blocked.add(key); app.archive('upper');
  assert.deepEqual(app.snapshot('data'), original);
  assert.equal(app.snapshot("!!data.workouts.find(w=>w.id==='upper').archived"), false);
  assert.equal(app.snapshot('logState.notes'), 'Ulagret endring');
  assert.ok(!app.toasts.some(t => t.startsWith('Økten er fjernet')));
  assert.deepEqual(app.snapshot('Object.keys(logDrafts)'), Object.keys(drafts));
  app.blocked.clear(); app.archive('upper'); assert.equal(app.snapshot("data.workouts.find(w=>w.id==='upper').archived"), true);
});

test('removed template, partial record and draft survive restart and JSON round trip', async () => {
  const app = setup(); app.open('interval'); app.run('markAllIntervals();saveLog("partial")'); app.note('Intervallkladd'); app.archive('interval');
  const backup = app.snapshot('validateBackup({...data,draftsV4:logDrafts})');
  const restored = setup(app.storage); restored.run('editSavedLog(data.logs[0].id)'); assert.equal(restored.snapshot('logState.notes'), 'Intervallkladd');
  const imported = setup(); imported.context.backupText = JSON.stringify(backup);
  await imported.run("importData({target:{files:[{text:async()=>backupText}],value:''}})");
  assert.deepEqual(imported.snapshot('data.workouts'), backup.workouts); assert.deepEqual(imported.snapshot('data.logs'), backup.logs);
  imported.run('editSavedLog(data.logs[0].id)'); assert.equal(imported.snapshot('isIntervalLog(logState)'), true);
  assert.equal(imported.snapshot('logState.notes'), 'Intervallkladd');
});

for (const file of ['backup-v3.json','backup-v4.json']) test(`legacy ${file} remains active without archive flags`, () => {
  const app = setup(), backup = JSON.parse(readFileSync(join(__dirname,'fixtures',file),'utf8'));
  app.context.backup = backup; app.run('data=validateBackup(backup);refreshWorkoutChoices()');
  assert.equal(app.snapshot('getWorkouts().length'), backup.workouts.length);
});

test('invalid archive metadata is rejected by JSON validation', () => {
  const app = setup();
  assert.throws(() => app.run('validateBackup({...data,workouts:data.workouts.map(w=>({...w,archived:"true"}))})'), /archived/);
  assert.throws(() => app.run('validateBackup({...data,workouts:data.workouts.map(w=>({...w,archivedAt:-1}))})'), /archivedAt/);
});

test('copy of an archived interval is active, isolated and has the correct mode', () => {
  const app = setup(); app.archive('interval'); app.copy('interval'); const id = app.snapshot('editing'); app.run('saveWorkout()');
  app.context.id = id; assert.equal(app.snapshot('!!data.workouts.find(w=>w.id===id).archived'), false);
  app.open(id); assert.equal(app.snapshot('isIntervalLog(logState)'), true);
});

test('moving a template keeps unrelated ongoing draft data unchanged', () => {
  const app = setup(); app.open('upper'); app.note('Kladd på gammel dato'); const drafts = app.snapshot('logDrafts');
  app.run("moveWorkout('upper')"); app.fields.get('editDay').value = '4'; app.run('saveWorkout()');
  assert.deepEqual(app.snapshot('logDrafts'), drafts);
  assert.equal(app.snapshot('logState.date'), '2026-11-18');
});

test('archiving a completed template does not subtract already completed weekly activity', () => {
  const app = setup();
  app.run("data.logs=[{id:'week-log',type:'upper',date:iso(new Date()),title:'Gjennomført',rpe:null,duration:null,notes:'',status:'complete',exercises:[]}];renderHome()");
  const before = app.fields.get('ringNum').textContent;
  app.archive('upper'); app.run('renderHome()');
  assert.equal(app.fields.get('ringNum').textContent, before);
  assert.equal(before, '1/4');
});

test('archiving an untouched automatically displayed log does not invent an empty draft', () => {
  const app = setup(); app.open('upper');
  assert.equal(app.snapshot('Object.keys(logDrafts).length'), 0);
  app.archive('upper');
  assert.equal(app.snapshot('Object.keys(logDrafts).length'), 0);
});

test('movement updates both Overview and Plan weekly dates without changing historical dates', () => {
  const app = setup(); app.open('upper'); app.run('markAllSets(0);saveLog()');
  const date = app.snapshot('data.logs[0].date');
  app.run("moveWorkout('upper')"); app.fields.get('editDay').value = '2'; app.run('saveWorkout();renderHome();renderPlan()');
  const plannedDate = app.snapshot('iso(dayInWeek(startWeek(new Date()),2))');
  for (const host of ['homeWeek','planCards']) assert.ok(app.fields.get(host).innerHTML.includes("quickLog('upper','"+plannedDate+"',"));
  assert.equal(app.snapshot('data.logs[0].date'), date);
});
