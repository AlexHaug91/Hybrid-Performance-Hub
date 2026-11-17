const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/init\(\);\s*$/, '');
const KEY = 'hyrox_performance_hub_v1';
const DRAFT_KEY = 'hyrox_performance_hub_v4_drafts';

function setup() {
  const storage = new Map();
  const blocked = new Set();
  const alerts = [], toasts = [];
  const fields = new Map();
  const context = vm.createContext({
    structuredClone,
    crypto: { randomUUID: () => 'new-log-id' },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => {
        if (blocked.has(key)) throw new Error('Simulated storage failure');
        storage.set(key, value);
      },
    },
    document: { getElementById: id => {
      if (!fields.has(id)) fields.set(id, { value: '', style: {} });
      return fields.get(id);
    } },
    alert: message => alerts.push(message),
    confirm: () => true,
  });
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  context.recordToast = message => toasts.push(message);
  run(`
    toast=recordToast;
    renderAll=()=>{};
    renderLogFields=()=>{};
    logKey='2026-11-16|interval';
    logState=buildLogState('2026-11-16','interval');
    logState.items[0].entries[0].done=true;
    document.getElementById('logRpe').value='7';
    document.getElementById('logDuration').value='45';
    document.getElementById('logNotes').value='Behold denne økten';
    document.getElementById('l4-0-0-value').value='10.5';
    document.getElementById('l4-0-0-qty').value='11';
    persist();
    captureLogState();
  `);
  return { storage, blocked, alerts, toasts, run,
    snapshot: expression => JSON.parse(run(`JSON.stringify(${expression})`)) };
}

for (const status of ['complete', 'partial']) {
  test(`${status}: confirms only after a successful write; preserves format`, () => {
    const app = setup();
    app.run(`saveLog('${status}')`);
    const saved = JSON.parse(app.storage.get(KEY));
    assert.equal(saved.version, 1);
    assert.equal(saved.logs.length, 1);
    assert.equal(saved.logs[0].status, status);
    assert.equal(saved.logs[0].rpe, 7);
    assert.equal(saved.logs[0].duration, 45);
    assert.equal(saved.logs[0].notes, 'Behold denne økten');
    assert.equal(saved.logs[0].exercises[0].sets[0].done, true);
    assert.equal(saved.logs[0].exercises[0].sets[0].value, 10.5);
    assert.equal(saved.logs[0].exercises[0].sets[0].qty, 11);
    assert.equal(Object.keys(JSON.parse(app.storage.get(DRAFT_KEY))).length, 0);
    assert.equal(app.alerts.length, 0);
    assert.deepEqual(app.toasts, [status === 'complete' ? 'Økt fullført og lagret ✓' : 'Pågående økt lagret']);
    assert.deepEqual(app.snapshot('load()'), saved);
  });

  test(`${status}: failed write preserves data and draft; retry creates exactly one log`, () => {
    const app = setup();
    const before = app.storage.get(KEY);
    app.blocked.add(KEY);
    app.run(`saveLog('${status}')`);
    assert.equal(app.storage.get(KEY), before);
    assert.equal(app.snapshot('data.logs').length, 0);
    assert.equal(app.snapshot('logState').notes, 'Behold denne økten');
    assert.equal(app.snapshot('logKey'), '2026-11-16|interval');
    assert.equal(app.snapshot('logEditingId'), null);
    assert.equal(app.snapshot('logDrafts[logKey]').state.items[0].entries[0].done, true);
    assert.equal(app.snapshot('logDrafts[logKey]').state.items[0].entries[0].value, '10.5');
    assert.equal(JSON.parse(app.storage.get(DRAFT_KEY))['2026-11-16|interval'].state.notes, 'Behold denne økten');
    assert.match(app.alerts[0], /Økten kunne ikke lagres/);
    assert.equal(app.toasts.length, 0);
    app.blocked.clear();
    app.run(`saveLog('${status}')`);
    assert.equal(JSON.parse(app.storage.get(KEY)).logs.length, 1);
    assert.equal(app.toasts.length, 1);
  });
}

test('failed edit preserves original log; retry updates it without duplicates', () => {
  const app = setup();
  app.run(`
    data.logs=[{id:'existing',created:123,notes:'Original',exercises:[]}];
    logEditingId='existing';persist();
  `);
  const before = app.storage.get(KEY);
  app.blocked.add(KEY);
  app.run('saveLog()');
  assert.equal(app.storage.get(KEY), before);
  assert.equal(app.snapshot('data.logs[0].notes'), 'Original');
  assert.equal(app.snapshot('logEditingId'), 'existing');
  assert.equal(app.snapshot('logDrafts[logKey].editingId'), 'existing');
  app.blocked.clear();
  app.run('saveLog()');
  const logs = JSON.parse(app.storage.get(KEY)).logs;
  assert.equal(logs.length, 1);
  assert.equal(logs[0].id, 'existing');
  assert.equal(logs[0].created, 123);
  assert.equal(logs[0].notes, 'Behold denne økten');
});

test('when all storage writes fail, retains in-memory draft and previous persisted draft', () => {
  const app = setup();
  const previousDraft = app.storage.get(DRAFT_KEY);
  app.blocked.add(KEY);
  app.blocked.add(DRAFT_KEY);
  app.run("document.getElementById('logNotes').value='Nye tall';saveLog()");
  assert.equal(app.snapshot('logState.notes'), 'Nye tall');
  assert.equal(app.snapshot('logDrafts[logKey].state.notes'), 'Nye tall');
  assert.equal(app.storage.get(DRAFT_KEY), previousDraft);
  assert.equal(app.snapshot('data.logs').length, 0);
  assert.ok(!app.toasts.some(message => /fullført og lagret|Pågående økt lagret/.test(message)));
  assert.match(app.alerts[0], /Ikke lukk appen/);
});

test('draft cleanup failure after successful main write does not lose saved log', () => {
  const app = setup();
  app.blocked.add(DRAFT_KEY);
  app.run('saveLog()');
  assert.equal(JSON.parse(app.storage.get(KEY)).logs.length, 1);
  assert.ok(app.toasts.includes('Økt fullført og lagret ✓'));
});

test('persist keeps default callers compatible and reports success or failure', () => {
  const app = setup();
  assert.equal(app.run('persist()'), true);
  app.blocked.add(KEY);
  assert.equal(app.run('persist()'), false);
  assert.match(app.alerts[0], /Kunne ikke lagre/);
});

test('validation still blocks invalid workout values before saving', () => {
  const app = setup();
  const before = app.storage.get(KEY);
  app.run("document.getElementById('logRpe').value='11';saveLog()");
  assert.equal(app.storage.get(KEY), before);
  assert.equal(app.snapshot('data.logs').length, 0);
  assert.match(app.alerts[0], /RPE/);
  assert.equal(app.toasts.length, 0);
});

test('declining completion preserves pending entries and draft', () => {
  const app = setup();
  const before = app.storage.get(KEY);
  app.run('confirm=()=>false;saveLog()');
  assert.equal(app.storage.get(KEY), before);
  assert.equal(app.snapshot('countLog().remaining'), 8);
  assert.ok(app.snapshot('logDrafts[logKey]'));
  assert.equal(app.toasts.length, 0);
});
