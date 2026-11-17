const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const script = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1].replace(/init\(\);\s*$/, '');
const MAIN = 'hyrox_performance_hub_v1', DRAFTS = 'hyrox_performance_hub_v4_drafts';
const records = [
  { id: 'session-a', type: 'upper', date: '2026-11-15', created: 0, updated: 100, title: 'Opprinnelig økt', status: 'complete', rpe: 7, duration: 55, notes: 'Opprinnelig kommentar',
    exercises: [
      { name: 'Benkpress', dose: '2 × 6', target: '70', unit: 'kg', kind: 'weight', value: 75, completed: 2, skipped: 0,
        sets: [{ done: true, skipped: false, value: 70, qty: 6, note: 'Første sett' }, { done: true, skipped: false, value: 75, qty: 5 }] },
      { name: 'Løp', dose: '5 km', unit: 'km', kind: 'amount', value: 5, completed: 1, skipped: 0,
        sets: [{ done: true, skipped: false, value: 5, qty: null }] },
    ] },
  { id: 'session-b', type: 'upper', date: '2026-11-15', created: 2, updated: 200, title: 'Andre økt', status: 'complete', rpe: 5, duration: 30, notes: 'Andre kommentar',
    exercises: [{ name: 'Roing', dose: '1 × 8', unit: 'kg', kind: 'weight', value: 60, completed: 1, skipped: 0,
      sets: [{ done: true, skipped: false, value: 60, qty: 8 }] }] },
];
function setup(storage = new Map()) {
  const fields = new Map(), alerts = [], toasts = [], blocked = new Set();
  const context = vm.createContext({
    structuredClone, crypto: { randomUUID: () => 'new-session' },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { if (blocked.has(key)) throw Error('Blocked'); storage.set(key, value); },
      removeItem: key => storage.delete(key),
    },
    document: { getElementById: id => {
      if (!fields.has(id)) fields.set(id, { value: '', style: {}, scrollIntoView() {}, classList: { add() {} } });
      return fields.get(id);
    } },
    alert: message => alerts.push(message), confirm: () => true,
    recordToast: message => toasts.push(message),
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
  if (!storage.has(MAIN)) {
    context.initialRecords = structuredClone(records);
    run('data.logs=initialRecords;persist()');
  }
  return { run, snapshot, storage, fields, alerts, toasts, blocked,
    open: id => { context.requestedId = id; run('editSavedLog(requestedId)'); },
    note: value => { fields.get('logNotes').value = value; run('captureLogState()'); },
  };
}

for (const [name, change] of [
  ['reordering', 'w.exercises.reverse()'],
  ['renaming', "w.exercises[0].name='Nytt navn'"],
  ['deleting', 'w.exercises.splice(0,3)'],
  ['empty template', 'w.exercises=[]'],
  ['units, targets and dose', "w.exercises[0].unit='reps';w.exercises[0].dose='10 × 99';w.exercises[0].target='999'"],
  ['template title', "w.title='Ny økttittel'"],
]) test(`history survives ${name} in the current template and an edit/save round trip`, () => {
  const app = setup();
  app.run(`{const w=data.workouts.find(w=>w.id==='upper');${change};persist()}`);
  app.open('session-a');
  assert.deepEqual(app.snapshot('logState.items.map(e=>e.name)'), ['Benkpress', 'Løp']);
  assert.equal(app.snapshot('logState.items[0].entries[1].value'), '75');
  app.run('saveLog()');
  assert.deepEqual(app.snapshot('data.logs[0].exercises'), records[0].exercises);
  assert.equal(app.snapshot('data.logs[0].title'), records[0].title);
  assert.equal(app.snapshot('data.logs[0].notes'), records[0].notes);
  assert.equal(app.snapshot('data.logs[0].created'), 0);
  assert.deepEqual(app.snapshot('data.logs[1]'), records[1]);
});

test('same-day sessions maintain independent drafts and update only the selected ID', () => {
  const app = setup();
  app.open('session-a');app.note('Kladd A');
  app.fields.get('l4-0-0-value').value = '72.5';app.run('captureLogState()');
  app.open('session-b');app.note('Kladd B');
  app.open('session-a');
  assert.equal(app.snapshot('logEditingId'), 'session-a');
  assert.equal(app.fields.get('logNotes').value, 'Kladd A');
  assert.equal(app.fields.get('l4-0-0-value').value, '72.5');
  app.run('saveLog()');
  assert.equal(app.snapshot('data.logs.length'), 2);
  assert.equal(app.snapshot('data.logs[0].notes'), 'Kladd A');
  assert.equal(app.snapshot('data.logs[0].exercises[0].sets[0].value'), 72.5);
  assert.equal(app.snapshot('data.logs[0].exercises[0].sets[0].note'), 'Første sett');
  assert.deepEqual(app.snapshot('data.logs[1]'), records[1]);
  app.open('session-b');
  assert.equal(app.fields.get('logNotes').value, 'Kladd B');
  app.run('saveLog()');
  assert.equal(app.snapshot('data.logs[1].notes'), 'Kladd B');
  assert.equal(app.snapshot('data.logs[0].notes'), 'Kladd A');
});

test('drafts remain independent after browser reload', () => {
  const app = setup();
  app.open('session-a');app.note('A etter reload');app.open('session-b');app.note('B etter reload');
  const reloaded = setup(app.storage);
  reloaded.open('session-a');assert.equal(reloaded.fields.get('logNotes').value, 'A etter reload');
  reloaded.open('session-b');assert.equal(reloaded.fields.get('logNotes').value, 'B etter reload');
});

test('legacy shared draft for B cannot override explicit request to edit A', () => {
  const app = setup();
  app.run("logDrafts['2026-11-15|upper']={state:stateFromLog(data.logs[1]),editingId:'session-b',updated:50};logDrafts['2026-11-15|upper'].state.notes='Eldre kladd B'");
  app.open('session-a');
  assert.equal(app.snapshot('logEditingId'), 'session-a');
  assert.equal(app.fields.get('logNotes').value, records[0].notes);
  app.open('session-b');assert.equal(app.fields.get('logNotes').value, 'Eldre kladd B');
});

test('template-derived legacy draft cannot delete or reorder saved exercises', () => {
  const app = setup();
  app.run(`
    const legacy=stateFromLog(data.logs[0]);delete legacy.historyId;
    legacy.items=[legacy.items[1]];legacy.notes='Gammel kladd';
    logDrafts['2026-11-15|upper']={state:legacy,editingId:'session-a',updated:50};
  `);
  app.open('session-a');app.run('saveLog()');
  assert.deepEqual(app.snapshot('data.logs[0].exercises'), records[0].exercises);
  assert.equal(app.snapshot('data.logs[0].notes'), 'Gammel kladd');
});

test('template save preserves the draft for an existing historical session', () => {
  const app = setup();
  app.open('session-a');app.note('');
  app.run("logState.items.forEach(i=>i.entries.forEach(e=>e.done=false));logDraftPersist();editing='upper'");
  for (const id of ['editTitle','editLocation','editFocus','editDesc']) app.fields.set(id, { value: 'Ny mal' });
  app.run('saveWorkout()');
  assert.equal(app.snapshot('logState.historyId'), 'session-a');
  assert.equal(app.snapshot('Object.keys(logDrafts).length'), 1);
});

test('new session uses current template and does not consume existing session drafts', () => {
  const app = setup();
  app.open('session-a');app.note('Kladd A');app.run('newLogSession()');
  assert.equal(app.snapshot('logEditingId'), null);
  assert.equal(app.snapshot('logKey'), '2026-11-15|upper|new');
  assert.equal(app.snapshot('logState.items.length'), 6);
  app.note('Ny økt');app.run('saveLog("partial")');
  assert.equal(app.snapshot('data.logs.length'), 3);
  assert.deepEqual(app.snapshot('data.logs[0]'), records[0]);
  app.open('session-a');assert.equal(app.fields.get('logNotes').value, 'Kladd A');
});

test('legacy aggregate logs retain their original totals and units without inventing sets', () => {
  const app = setup();
  app.run("data.logs[0].exercises=[{name:'Løp',dose:'4 × 1 km',value:4,unit:'km'},{name:'Wall balls',dose:'3 × 15',value:45,unit:'reps'}]");
  const before = app.snapshot('data.logs[0].exercises');
  app.open('session-a');
  assert.deepEqual(app.snapshot('logState.items.map(e=>e.entries.length)'), [1, 1]);
  app.run('saveLog()');
  assert.deepEqual(app.snapshot('data.logs[0].exercises'), before);
});

test('interval history preserves pace, duration, targets and skipped sets', () => {
  const app = setup();
  app.run(`data.logs[0].type='interval';data.logs[0].exercises=[{name:'Drag',dose:'4',target:'4.5',value:4.6,unit:'min/km',kind:'interval',completed:1,skipped:1,sets:[{done:true,skipped:false,value:4.6,qty:3.5},{done:false,skipped:true,value:4.5,qty:4}]}]`);
  const before = app.snapshot('data.logs[0].exercises');
  app.run("data.workouts.find(w=>w.id==='interval').exercises=[]");
  app.open('session-a');app.run('saveLog()');
  assert.deepEqual(app.snapshot('data.logs[0].exercises'), before);
});

test('failed history save preserves both drafts and existing stored records, retry updates one', () => {
  const app = setup();
  app.open('session-b');app.note('Kladd B');app.open('session-a');app.note('Kladd A');
  const before = app.storage.get(MAIN);
  app.blocked.add(MAIN);app.run('saveLog()');
  assert.equal(app.storage.get(MAIN), before);
  assert.deepEqual(app.snapshot('data.logs'), records);
  assert.equal(app.snapshot('Object.keys(logDrafts).length'), 2);
  app.blocked.clear();app.run('saveLog()');
  assert.equal(app.snapshot('data.logs[0].notes'), 'Kladd A');
  assert.deepEqual(app.snapshot('data.logs[1]'), records[1]);
});

test('missing selected record is not recreated and cannot update another record', () => {
  const app = setup();app.open('session-a');app.note('Behold kladd');
  app.run("data.logs=data.logs.filter(l=>l.id!=='session-a');saveLog()");
  assert.deepEqual(app.snapshot('data.logs'), [records[1]]);
  assert.match(app.alerts.at(-1), /finnes ikke lenger/);
  assert.equal(app.snapshot('Object.keys(logDrafts).length'), 1);
});

test('deleting one session cleans only its drafts and leaves other drafts importable', () => {
  const app = setup();app.open('session-a');app.note('Kladd A');app.open('session-b');app.note('Kladd B');
  app.run("deleteLog('session-a');validateBackup({...data,draftsV4:logDrafts})");
  assert.equal(app.snapshot('Object.keys(logDrafts).length'), 1);
  assert.equal(app.snapshot('logEditingId'), 'session-b');
  assert.equal(app.snapshot('logDrafts[logKey].state.notes'), 'Kladd B');
});

for (const file of ['backup-v3.json','backup-v4.json']) test(`${file} preserves log contents when reopened and saved after template changes`, () => {
  const app = setup();
  app.contextBackup = JSON.parse(readFileSync(join(__dirname, 'fixtures', file), 'utf8'));
  // JSON crosses the sandbox boundary via its textual representation.
  app.run(`data=validateBackup(JSON.parse(${JSON.stringify(JSON.stringify(app.contextBackup))}));logDrafts=data.draftsV4||{};data.workouts.find(w=>w.id==='upper').exercises=[]`);
  const before = app.snapshot('data.logs[0].exercises');
  app.open('legacy-id');app.run('saveLog()');
  assert.deepEqual(app.snapshot('data.logs[0].exercises'), before);
});

test('ID-specific draft exports validate and reload with the correct owner', () => {
  const app = setup();app.open('session-a');app.note('A');app.open('session-b');app.note('B');
  app.run('validateBackup({...data,draftsV4:logDrafts})');
  const backup = app.snapshot('({...data,draftsV4:logDrafts})');
  const restored = setup();
  restored.run(`data=validateBackup(JSON.parse(${JSON.stringify(JSON.stringify(backup))}));logDrafts=data.draftsV4`);
  restored.open('session-a');assert.equal(restored.fields.get('logNotes').value, 'A');
  restored.open('session-b');assert.equal(restored.fields.get('logNotes').value, 'B');
});

test('reordered JSON object properties do not change historical exercise values on save', () => {
  const app = setup();app.open('session-a');
  app.run("logState.items=logState.items.map(i=>({entries:i.entries,kind:i.kind,unit:i.unit,target:i.target,dose:i.dose,name:i.name}))");
  app.run('saveLog()');assert.deepEqual(app.snapshot('data.logs[0].exercises'), records[0].exercises);
});

test('legacy reordered template defaults never replace historical performed sets', () => {
  const app = setup();
  app.run(`
    const legacy=stateFromLog(data.logs[0]);delete legacy.historyId;
    legacy.items.reverse();legacy.items[1].entries.forEach(e=>{e.done=false;e.value='999'});
    logDrafts['2026-11-15|upper']={state:legacy,editingId:'session-a',updated:50};
  `);
  app.open('session-a');app.run('saveLog()');
  assert.deepEqual(app.snapshot('data.logs[0].exercises'), records[0].exercises);
});

test('same-name exercises retain their own units, order, values and repetitions', () => {
  const app = setup();
  app.run(`data.logs[0].exercises=[
    {name:'Drag',dose:'1',value:4.5,unit:'min/km',kind:'interval',sets:[{done:true,skipped:false,value:4.5,qty:4}]},
    {name:'Drag',dose:'1',value:13,unit:'km/t',kind:'interval',sets:[{done:true,skipped:false,value:13,qty:2}]},
    {name:'Drag',dose:'1',value:0,unit:'kg',kind:'weight',sets:[{done:true,skipped:false,value:0,qty:10}]}
  ]`);
  const before = app.snapshot('data.logs[0].exercises');
  app.open('session-a');app.note('Kun kommentaren endret');app.run('saveLog()');
  assert.deepEqual(app.snapshot('data.logs[0].exercises'), before);
});
