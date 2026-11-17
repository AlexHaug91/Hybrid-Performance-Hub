const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = join(__dirname, '..');
const script = readFileSync(join(root, 'index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1].replace(/init\(\);\s*$/, '');
const MAIN = 'hyrox_performance_hub_v1';
const DRAFTS = 'hyrox_performance_hub_v4_drafts';
const BACKUP = 'hyrox_performance_hub_import_backup';
const PENDING = 'hyrox_performance_hub_import_pending';

function environment(storage = new Map(), intercept = () => {}) {
  const alerts = [], toasts = [], downloads = [], fields = new Map();
  const context = vm.createContext({
    structuredClone, console, crypto: { randomUUID: () => 'generated-id' },
    setTimeout: () => 0, clearTimeout: () => {}, window: {},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { intercept('set', key, value); storage.set(key, value); },
      removeItem: key => { intercept('remove', key); storage.delete(key); },
    },
    alert: message => alerts.push(message), confirm: () => true,
    document: { getElementById: id => {
      if (!fields.has(id)) fields.set(id, { value: '', innerHTML: '', style: { setProperty() {} }, classList: { add() {}, remove() {} } });
      return fields.get(id);
    } },
    toastMessage: message => toasts.push(message),
    downloadValue: value => downloads.push(JSON.parse(JSON.stringify(value))),
  });
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  const snapshot = expr => JSON.parse(run(`JSON.stringify(${expr})`));
  run('toast=toastMessage;renderAll=()=>{};renderLogFields=()=>{};downloadBackup=downloadValue');
  return { storage, alerts, toasts, downloads, context, fields, run, snapshot,
    async import(value, raw = false) {
      context.importText = raw ? value : JSON.stringify(value);
      await run("importData({target:{files:[{text:async()=>importText}],value:'backup.json'}})");
    },
  };
}
function fixture() {
  const app = environment();
  app.run(`
    data.logs=[{id:'old-log',date:'2026-11-16',type:'upper',title:'Gammel økt',rpe:6,duration:40,notes:'Behold meg',created:123,exercises:[{name:'Benkpress',dose:'4 × 6',unit:'kg',value:70}]}];
    logState=buildLogState('2026-11-16','upper');logState.notes='Uferdig økt';logKey='2026-11-16|upper';logEditingId='old-log';
    logDrafts[logKey]={state:logState,editingId:logEditingId,updated:123};
    logFresh=true;logForcedId='old-log';editing='upper';
    localStorage.setItem(KEY,JSON.stringify(data));localStorage.setItem(DRAFT_KEY,JSON.stringify(logDrafts));
  `);
  return app;
}
function candidate(app) {
  const value = app.snapshot('defaults()');
  value.settings.sessions = 5;
  value.workouts[0].title = 'Importert intervall';
  value.logs = [{ id: 'imported-log', date: '2026-11-15', type: 'interval', title: 'Importert økt', created: 456,
    updated: 789, status: 'complete', rpe: 7, duration: 50, notes: 'Nytt notat',
    exercises: [{ name: 'Intervall', dose: '4', unit: 'km/t', kind: 'interval', value: 12.5, completed: 1, skipped: 0,
      sets: [{ done: true, skipped: false, value: 12.5, qty: 4 }] }] }];
  value.nutrition = [{ date: '2026-11-15', weight: 80, kcal: 3000, protein: 150, note: 'Energi' }];
  const state = app.snapshot("buildLogState('2026-11-15','interval')");
  state.notes = 'Importert kladd';
  value.draftsV4 = { '2026-11-15|interval': { state, editingId: 'imported-log', updated: 789 } };
  return value;
}
function unchanged(app, before) {
  assert.equal(app.storage.get(MAIN), before.main);
  assert.equal(app.storage.get(DRAFTS), before.drafts);
  assert.deepEqual(app.snapshot('data'), before.data);
  assert.deepEqual(app.snapshot('logDrafts'), before.logDrafts);
  assert.deepEqual(app.snapshot('[logState,logKey,logEditingId,logFresh,logForcedId,editing]'), before.session);
  assert.ok(!app.toasts.includes('Data importert'));
}
function snapshot(app) {
  return { main: app.storage.get(MAIN), drafts: app.storage.get(DRAFTS), data: app.snapshot('data'),
    logDrafts: app.snapshot('logDrafts'), session: app.snapshot('[logState,logKey,logEditingId,logFresh,logForcedId,editing]') };
}

test('valid import saves every data category and drafts; resets old editor/session', async () => {
  const app = fixture(), value = candidate(app), before = snapshot(app);
  await app.import(value);
  assert.deepEqual(JSON.parse(app.storage.get(MAIN)), value);
  assert.deepEqual(JSON.parse(app.storage.get(DRAFTS)), value.draftsV4);
  assert.deepEqual(app.snapshot('data'), value);
  assert.deepEqual(app.snapshot('[logState,logKey,logEditingId,logFresh,logForcedId,editing]'), [null, '', null, false, null, null]);
  assert.match(app.fields.get('logType').innerHTML, /Importert intervall/);
  assert.equal(app.alerts.length, 0);
  assert.deepEqual(app.toasts, ['Data importert']);
  const backup = JSON.parse(app.storage.get(BACKUP));
  assert.deepEqual(backup.logs, before.data.logs);
  assert.deepEqual(backup.workouts, before.data.workouts);
  assert.deepEqual(backup.settings, before.data.settings);
  assert.deepEqual(backup.draftsV4, before.logDrafts);
  assert.equal(app.storage.has(PENDING), false);
});

test('invalid JSON is rejected without any writes', async () => {
  const app = fixture(), before = snapshot(app), entries = [...app.storage];
  await app.import('{broken', true);
  unchanged(app, before);
  assert.deepEqual([...app.storage], entries);
  assert.equal(app.alerts.length, 1);
});

const invalidCases = [
  ['null root', () => null], ['array root', () => []],
  ['unsupported version', v => { v.version = 2; }],
  ...['workouts', 'logs', 'nutrition', 'pro', 'settings'].map(key => [`missing ${key}`, v => { delete v[key]; }]),
  ['empty workouts', v => { v.workouts = []; }],
  ['missing nested field', v => { delete v.workouts[0].exercises[0].unit; }],
  ['wrong weight type', v => { v.nutrition[0].weight = '80'; }],
  ['invalid weight range', v => { v.nutrition[0].weight = 0; }],
  ['missing nutrition field', v => { delete v.nutrition[0].protein; }],
  ['nonfinite numeric input', v => { v.settings.calories = Infinity; }],
  ['wrong settings type', v => { v.settings.gain = '0.15'; }],
  ['invalid settings range', v => { v.settings.sessions = 0; }],
  ['invalid day', v => { v.workouts[0].day = 1.5; }],
  ['invalid date', v => { v.logs[0].date = '2026-02-30'; }],
  ['unknown workout reference', v => { v.logs[0].type = 'missing'; }],
  ['duplicate log ID', v => { v.logs.push(structuredClone(v.logs[0])); }],
  ['duplicate workout ID', v => { v.workouts[1].id = v.workouts[0].id; }],
  ['invalid log status', v => { v.logs[0].status = 'anything'; }],
  ['missing log exercises', v => { delete v.logs[0].exercises; }],
  ['wrong set boolean', v => { v.logs[0].exercises[0].sets[0].done = 'true'; }],
  ['conflicting set state', v => { v.logs[0].exercises[0].sets[0].skipped = true; }],
  ['invalid set value', v => { v.logs[0].exercises[0].sets[0].value = -1; }],
  ['missing draft state', v => { delete v.draftsV4['2026-11-15|interval'].state; }],
  ['invalid draft number', v => { v.draftsV4['2026-11-15|interval'].state.items[0].entries[0].value = 'script'; }],
  ['invalid draft kind', v => { v.draftsV4['2026-11-15|interval'].state.items[0].kind = 'script'; }],
  ['invalid draft reference', v => { v.draftsV4['2026-11-15|interval'].editingId = 'missing'; }],
  ['invalid draft key', v => { v.draftsV4.bad = v.draftsV4['2026-11-15|interval']; }],
  ['array drafts', v => { v.draftsV4 = []; }],
  ['script in workout ID', v => { v.workouts[0].id = "x');globalThis.pwned=1;//"; }],
  ['script in log ID', v => { v.logs[0].id = "x');globalThis.pwned=1;//"; }],
  ['HTML in numeric field', v => { v.pro[0].target = '<img src=x onerror=alert(1)>'; }],
  ['prototype metadata', v => { v.metadata = JSON.parse('{"__proto__":{"polluted":true}}'); }],
];
for (const [name, mutate] of invalidCases) test(`rejects ${name} and preserves all existing data`, async () => {
  const app = fixture(), before = snapshot(app), value = candidate(app);
  const result = mutate(value);
  await app.import(result === undefined ? value : result);
  unchanged(app, before);
  assert.equal(app.storage.has(BACKUP), false);
  assert.equal(app.alerts.length, 1);
});

for (const key of [BACKUP, PENDING, DRAFTS, MAIN]) test(`write failure at ${key} preserves data and permits retry`, async () => {
  const original = fixture(), before = snapshot(original), value = candidate(original);
  let failed = false;
  const app = environment(original.storage, (op, actual) => {
    if (!failed && op === 'set' && actual === key) { failed = true; throw Error('Simulated quota failure'); }
  });
  // Keep the same live session; failed imports must not replace it.
  const live = snapshot(app);
  await app.import(value);
  unchanged(app, live);
  assert.equal(app.storage.get(MAIN), before.main);
  assert.equal(app.storage.get(DRAFTS), before.drafts);
  assert.equal(app.alerts.length, 1);
  await app.import(value);
  assert.deepEqual(JSON.parse(app.storage.get(MAIN)), value);
  assert.ok(app.toasts.includes('Data importert'));
});

test('interrupted import recovers original drafts on reload', () => {
  const app = fixture(), before = snapshot(app), value = candidate(app);
  app.storage.set(PENDING, JSON.stringify({ previousDrafts: before.drafts, previousBackup: null, nextMain: JSON.stringify(value) }));
  app.storage.set(DRAFTS, JSON.stringify(value.draftsV4));
  const restored = environment(app.storage);
  assert.deepEqual(restored.snapshot('data'), before.data);
  assert.deepEqual(restored.snapshot('logDrafts'), before.logDrafts);
  assert.equal(restored.storage.get(DRAFTS), before.drafts);
  assert.equal(restored.storage.has(PENDING), false);
});

test('failed rollback retains journal, loads original drafts, then recovers when writes resume', async () => {
  const original = fixture(), before = snapshot(original), value = candidate(original);
  let draftsWritten = false;
  const block = (op, key) => {
    if (op === 'set' && key === MAIN) throw Error('Main blocked');
    if (op === 'set' && key === DRAFTS) {
      if (draftsWritten) throw Error('Rollback blocked');
      draftsWritten = true;
    }
  };
  const app = environment(original.storage, block);
  await app.import(value);
  assert.equal(app.storage.has(PENDING), true);
  assert.equal(app.storage.get(MAIN), before.main);
  assert.ok(!app.toasts.includes('Data importert'));
  const blockedReload = environment(app.storage, block);
  assert.deepEqual(blockedReload.snapshot('data'), before.data);
  assert.deepEqual(blockedReload.snapshot('logDrafts'), before.logDrafts);
  const recovered = environment(app.storage);
  assert.equal(recovered.storage.has(PENDING), false);
  assert.deepEqual(recovered.snapshot('logDrafts'), before.logDrafts);
});

test('committed import survives failure to remove journal', async () => {
  const original = fixture(), value = candidate(original);
  const app = environment(original.storage, (op, key) => {
    if (op === 'remove' && key === PENDING) throw Error('Cleanup blocked');
  });
  await app.import(value);
  assert.ok(app.toasts.includes('Data importert'));
  const restored = environment(app.storage);
  assert.deepEqual(restored.snapshot('data'), value);
  assert.deepEqual(restored.snapshot('logDrafts'), value.draftsV4);
  assert.equal(restored.storage.has(PENDING), false);
});

test('recovery backup can be downloaded and imported to restore all previous categories', async () => {
  const app = fixture(), before = snapshot(app);
  await app.import(candidate(app));
  app.run('exportImportBackup()');
  assert.equal(app.downloads.length, 1);
  await app.import(app.downloads[0]);
  assert.deepEqual(app.snapshot('data.logs'), before.data.logs);
  assert.deepEqual(app.snapshot('data.workouts'), before.data.workouts);
  assert.deepEqual(app.snapshot('data.settings'), before.data.settings);
  assert.deepEqual(app.snapshot('logDrafts'), before.logDrafts);
});

test('cancelled import leaves data and recovery backup untouched', async () => {
  const app = fixture(), before = snapshot(app);
  app.storage.set(BACKUP, 'previous recovery copy');
  app.run('confirm=()=>false');
  await app.import(candidate(app));
  unchanged(app, before);
  assert.equal(app.storage.get(BACKUP), 'previous recovery copy');
});

test('concurrent import requests cannot overwrite each other', async () => {
  const app = fixture();
  app.run('let finishReading;const pendingRead=new Promise(resolve=>finishReading=resolve)');
  const first = app.run("importData({target:{files:[{text:()=>pendingRead}],value:''}})");
  await app.import(candidate(app));
  assert.equal(app.toasts.length, 0);
  app.context.validText = JSON.stringify(candidate(app));
  app.run('finishReading(validText)');
  await first;
  assert.equal(app.toasts.filter(s => s === 'Data importert').length, 1);
});

// Fixtures use defaults from repository commits 4ecbb5e (v3) and d9df308 (v4),
// with representative log records and a v4 draft. No Git history is needed to run tests.
for (const file of ['backup-v3.json', 'backup-v4.json']) test(`accepts historical ${file}`, async () => {
  const historical = JSON.parse(readFileSync(join(__dirname, 'fixtures', file), 'utf8'));
  const app = fixture();
  await app.import(historical);
  assert.deepEqual(app.snapshot('data.logs'), historical.logs);
  assert.deepEqual(app.snapshot('data.workouts'), historical.workouts);
  assert.deepEqual(app.snapshot('logDrafts'), historical.draftsV4 || {});
  assert.ok(app.toasts.includes('Data importert'));
});

test('imported text is preserved as escaped text in rendered HTML', async () => {
  const app = fixture(), value = candidate(app);
  const payload = '<img src=x onerror="globalThis.pwned=1">\' & </script><script>globalThis.pwned=1</script>';
  value.workouts[0].title = payload;
  value.workouts[0].description = payload;
  value.logs[0].notes = payload;
  value.logs[0].exercises[0].name = payload;
  value.nutrition[0].note = payload;
  value.pro[0].name = payload;
  await app.import(value);
  app.run('renderHome();renderPlan();renderLogHistory();renderNutrition();renderPro();renderProgress()');
  for (const name of ['homeWeek', 'planCards', 'logHistory', 'nutritionHistory', 'proGoals']) {
    const html = app.fields.get(name).innerHTML;
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;img'));
  }
  assert.equal(app.context.pwned, undefined);
  assert.equal(app.snapshot('data.logs[0].notes'), payload);
});

test('identical main data can import changed drafts without a redundant main write', async () => {
  const original = fixture(), value = candidate(original);
  original.storage.set(MAIN, JSON.stringify(value));
  const app = environment(original.storage, (op, key) => {
    if (op === 'set' && key === MAIN) throw Error('Redundant main write');
  });
  await app.import(value);
  assert.deepEqual(app.snapshot('logDrafts'), value.draftsV4);
  assert.ok(app.toasts.includes('Data importert'));
});

test('interruption with identical main data but unwritten drafts preserves original drafts', () => {
  const app = fixture(), before = snapshot(app);
  app.storage.set(PENDING, JSON.stringify({ previousDrafts: before.drafts, previousBackup: null, nextMain: before.main, nextDrafts: '{}' }));
  const restored = environment(app.storage);
  assert.deepEqual(restored.snapshot('logDrafts'), before.logDrafts);
  assert.equal(restored.storage.has(PENDING), false);
});

for (const failedKey of [PENDING, BACKUP, DRAFTS, MAIN]) test(`failed import at ${failedKey} preserves the previous recovery copy`, async () => {
  const original = fixture();
  const oldBackup = JSON.stringify({ important: 'Do not replace this previous recovery copy' });
  original.storage.set(BACKUP, oldBackup);
  let failed = false;
  const app = environment(original.storage, (op, key) => {
    if (!failed && op === 'set' && key === failedKey) { failed = true; throw Error('Write blocked'); }
  });
  await app.import(candidate(app));
  assert.equal(app.storage.get(BACKUP), oldBackup);
  assert.ok(!app.toasts.includes('Data importert'));
});

test('interrupted failed import restores the previous recovery copy on restart', () => {
  const app = fixture(), before = snapshot(app);
  const oldBackup = 'previous recovery copy';
  app.storage.set(PENDING, JSON.stringify({ previousDrafts: before.drafts, previousBackup: oldBackup,
    nextMain: 'not committed', nextDrafts: '{}', nextBackup: 'new recovery copy' }));
  app.storage.set(BACKUP, 'new recovery copy');
  const restored = environment(app.storage);
  assert.equal(restored.storage.get(BACKUP), oldBackup);
  assert.equal(restored.storage.get(MAIN), before.main);
  assert.equal(restored.storage.get(DRAFTS), before.drafts);
  assert.equal(restored.storage.has(PENDING), false);
});

test('recovery download uses the original copy while rollback remains blocked', () => {
  const app = fixture(), before = snapshot(app), oldBackup = app.snapshot('defaults()');
  app.storage.set(PENDING, JSON.stringify({ previousDrafts: before.drafts, previousBackup: JSON.stringify(oldBackup),
    nextMain: 'not committed', nextDrafts: '{}', nextBackup: 'replacement' }));
  app.storage.set(BACKUP, 'replacement');
  app.run('exportImportBackup()');
  assert.deepEqual(app.downloads, [oldBackup]);
});
