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
      logState.items.forEach((item,i)=>item.entries.forEach((entry,j)=>{if(item.hyrox)for(const key of ['meters','seconds','reps','kg','note'])document.getElementById('hr-'+i+'-'+j+'-'+key).value=entry.hyroxInput[key];for(const key of ['value','qty'])document.getElementById('l4-'+i+'-'+j+'-'+key).value=entry[key]}));
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

function rounds(count=4){const a=setup();a.run('createWorkout()');for(const [id,value]of [['editTitle','Min HYROX'],['editLocation','Studio'],['editFocus','Eget fokus'],['editDesc','Egen beskrivelse']])a.fields.get(id).value=value;a.run('setWorkoutMode("hyrox_rounds");hyroxQuickTemplate()');if(count!==4)a.run('setHyroxCount('+count+')');const id=a.snapshot('editing');a.run('saveWorkout()');assert.ok(a.snapshot('data.workouts').some(w=>w.id===id),a.alerts.join(';'));a.id=id;return a}
function backup(a){return a.snapshot('({...data,draftsV4:logDrafts})')}
function valid(a,payload=backup(a)){a.context.payload=structuredClone(payload);return a.run('validateBackup(payload)')}
function value(a,i,key,raw,j=0){a.run(`document.getElementById('hr-${i}-${j}-${key}').value=${JSON.stringify(raw)};captureLogState()`)}
function done(a,i,j=0){a.run(`toggleLogEntry(${i},${j},'done')`)}

function openDefault(a,type='upper'){a.open(type);return a.snapshot('logState')}
function validateAll(a){a.run('validateBackup({...data,draftsV4:logDrafts})')}
for(const [type,title]of [['upper','strength'],['interval','interval']])test('a '+title+' proposal is reviewable and cancellation leaves template, log and storage untouched',()=>{const a=setup();openDefault(a,type);const state=a.snapshot('logState'),model=a.snapshot('data'),stored=[...a.storage];a.run('openShortDraft()');assert.ok(a.snapshot('!!shortDraft'));a.run('closeShortDraft()');assert.deepEqual(a.snapshot('logState'),state);assert.deepEqual(a.snapshot('data'),model);assert.deepEqual([...a.storage],stored)});
test('strength shortening reduces sets only after confirmation and never edits the original template',()=>{const a=setup();openDefault(a);const before=a.snapshot('data.workouts'),n=a.snapshot('logState.items[0].entries.length');a.run('openShortDraft()');a.context.confirm=()=>false;assert.equal(a.run('applyShortDraft()'),false);assert.equal(a.snapshot('logState.variant||null'),null);a.context.confirm=()=>true;assert.equal(a.run('applyShortDraft()'),true);assert.equal(a.snapshot('logState.items[0].entries.length'),Math.ceil(n/2));assert.equal(a.snapshot('countLog().done'),0);assert.deepEqual(a.snapshot('data.workouts'),before);assert.equal(a.snapshot('logState.variant.targetMinutes'),30);validateAll(a)});
test('shortening interval work retains warm-up/cool-down and avoids an automatic trailing pause',()=>{const a=setup();openDefault(a,'interval');const before=a.snapshot('logState.items');a.run('openShortDraft();applyShortDraft()');const after=a.snapshot('logState.items');assert.equal(after[0].name,'Oppvarming');assert.equal(after.at(-1).name,'Nedjogging');assert.ok(after.filter(it=>it.name==='Intervall').length<before.filter(it=>it.name==='Intervall').length);const last=after.map((it,i)=>[it.name,i]).filter(([name])=>name==='Intervall').at(-1)[1];assert.ok(after.slice(last+1).every(it=>it.name!=='Pause'));assert.equal(a.snapshot('countLog().done'),0);validateAll(a)});
test('a shorter HYROX keeps original round/part identities while retaining fewer rounds and proper rests',()=>{const a=rounds(4),original=a.snapshot('data.workouts.at(-1)');a.run('editWorkout(data.workouts.at(-1).id);setHyroxRest("90");saveWorkout()');a.open(a.id);a.run('openShortDraft();applyShortDraft()');assert.equal(a.snapshot('logState.hyroxRounds.rounds.length'),2);assert.equal(a.snapshot('logState.items.filter(it=>it.hyrox.section==="rest").length'),1);assert.equal(a.snapshot('logState.items.length'),11);assert.equal(a.snapshot('logState.variant.originalPlan.hyroxRounds.rounds.length'),4);assert.equal(a.snapshot('logState.items[0].hyrox.partId'),original.exercises[0].hyrox.partId);validateAll(a)});
test('review can exclude one exercise and override the proposed set counts before acceptance',()=>{const a=setup();openDefault(a);a.run('openShortDraft();shortDraft.keep[1]=false;shortDraft.counts[0]=1;applyShortDraft()');assert.equal(a.snapshot('logState.items[0].entries.length'),1);assert.equal(a.snapshot('logState.variant.selection.some(s=>s.item===1)'),false);validateAll(a)});
test('entered or marked results block a new shortening proposal without losing the draft',()=>{const a=setup();openDefault(a);a.fields.get('l4-0-0-value').value='82.5';a.run('captureLogState()');const before=a.snapshot('logState');a.run('openShortDraft()');assert.equal(a.snapshot('shortDraft'),null);assert.deepEqual(a.snapshot('logState'),before);a.run('toggleLogEntry(0,0,"done");openShortDraft()');assert.equal(a.snapshot('shortDraft'),null)});
test('a stale proposal cannot overwrite values entered after it was opened',()=>{const a=setup();openDefault(a);a.run('openShortDraft()');a.fields.get('logNotes').value='Keep newer edits';a.run('captureLogState();applyShortDraft()');assert.equal(a.snapshot('logState.notes'),'Keep newer edits');assert.equal(a.snapshot('logState.variant||null'),null)});
test('failed variant draft storage preserves the original state, proposal and previous valid storage',()=>{const a=setup();openDefault(a);a.run('openShortDraft()');const state=a.snapshot('logState'),before=[...a.storage];a.blocked.add(DRAFTS);assert.equal(a.run('applyShortDraft()'),false);assert.deepEqual(a.snapshot('logState'),state);assert.ok(a.snapshot('!!shortDraft'));assert.deepEqual([...a.storage],before);a.blocked.clear();assert.equal(a.run('applyShortDraft()'),true);validateAll(a)});
test('shortened partial logs resume after restart with the original plan and exact recorded values',()=>{const a=setup();openDefault(a);a.run('openShortDraft();applyShortDraft()');a.fields.get('l4-0-0-value').value='77.5';a.fields.get('l4-0-0-qty').value='7';a.run('toggleLogEntry(0,0,"done");saveLog("partial")');const saved=a.snapshot('data.logs[0]');assert.equal(saved.variant.kind,'shortened');assert.equal(saved.status,'partial');const b=setup(a.storage);b.run('editSavedLog(data.logs[0].id)');assert.equal(b.snapshot('logState.items[0].entries[0].value'),'77.5');assert.deepEqual(b.snapshot('logState.variant'),saved.variant);validateAll(b)});
test('completion applies only to the accepted shorter variant and qualifies the original occurrence status',()=>{const a=setup();a.run('document.getElementById("logType").value="upper";document.getElementById("logDate").value="2026-11-18";logOccurrenceId="repeat:2026-11-16:upper";renderLogFields();openShortDraft();applyShortDraft()');const entries=a.snapshot('countLog().count'),original=a.snapshot('buildLogState("2026-11-18","upper",null,logState.variant.originalPlan).items.reduce((n,it)=>n+it.entries.length,0)');a.run('logState.items.forEach(it=>it.entries.forEach(e=>e.done=true));renderLogUI();saveLog("complete")');assert.ok(entries<original);assert.equal(a.snapshot('data.logs[0].status'),'complete');assert.equal(a.snapshot('data.logs[0].exercises.reduce((n,it)=>n+it.sets.length,0)'),entries);assert.ok(a.toasts.at(-1).includes('Forkortet'));assert.ok(a.run('occurrenceLabel(findOccurrence("repeat:2026-11-16:upper"))').includes('Kortvariant fullført'));validateAll(a)});
test('existing historical logs cannot be shortened into a different plan',()=>{const a=setup();openDefault(a);a.run('toggleLogEntry(0,0,"done");saveLog("partial")');const stored=a.storage.get(MAIN),state=a.snapshot('logState');a.run('openShortDraft()');assert.equal(a.snapshot('shortDraft'),null);assert.equal(a.storage.get(MAIN),stored);assert.deepEqual(a.snapshot('logState'),state)});
test('card identities use item identity and semantic keys rather than only list position',()=>{const a=setup();openDefault(a);const key=a.run('logItemViewKey(logState.items[0],0)');a.context.card=key;a.run('logView().open.set(card,false);logState.items.reverse()');const index=a.snapshot('logState.items.length')-1;assert.equal(a.run('logItemViewKey(logState.items['+index+'],'+index+')'),key);assert.equal(a.run('logView().open.get(card)'),false)});
test('folding state is per log session and is never written to the backup or training model',()=>{const a=setup();openDefault(a);const data=a.snapshot('data'),state=a.snapshot('logState'),stored=[...a.storage];a.run('const key=logItemViewKey(logState.items[0],0);logView().open.set(key,false)');assert.deepEqual(a.snapshot('data'),data);assert.deepEqual(a.snapshot('logState'),state);assert.deepEqual([...a.storage],stored);a.run('logKey="another-session"');assert.equal(a.snapshot('logView().open.size'),0)});
test('save adopts card openness for the new exact historical log ID without changing results',()=>{const a=setup();openDefault(a);a.context.card=a.run('logItemViewKey(logState.items[0],0)');a.run('logView().open.set(card,false);toggleLogEntry(0,0,"done");saveLog("partial")');assert.equal(a.run('logView().open.get(card)'),false);assert.equal(a.snapshot('logState.items[0].entries[0].done'),true)});
for(const [name,mutate]of [
 ['duplicate item selection',v=>v.logs[0].variant.selection.push(v.logs[0].variant.selection[0])],
 ['invalid original ID',v=>v.logs[0].variant.originalPlan.id='other'],
 ['out of range set',v=>v.logs[0].variant.selection[0].entries=[999]],
 ['invalid duration target',v=>v.logs[0].variant.targetMinutes=0],
 ['mismatched snapshot',v=>v.logs[0].exercises[0].name='Wrong exercise']
])test('invalid shortened backup is rejected without changing stored data: '+name,()=>{const a=setup();openDefault(a);a.run('openShortDraft();applyShortDraft();toggleLogEntry(0,0,"done");saveLog("partial")');const raw=a.storage.get(MAIN),backup=a.snapshot('({...data,draftsV4:logDrafts})');mutate(backup);a.context.backup=backup;assert.throws(()=>a.run('validateBackup(backup)'));assert.equal(a.storage.get(MAIN),raw)});
test('HYROX short variants with actual results and unfinished drafts validate after saving history',()=>{const a=rounds(4);a.run('editWorkout(data.workouts.at(-1).id);setHyroxRest("90");saveWorkout()');a.open(a.id);a.run('openShortDraft();applyShortDraft()');value(a,0,'meters','0.8');value(a,0,'seconds','4:00');done(a,0);a.run('saveLog("partial")');assert.equal(a.snapshot('data.logs[0].exercises[0].sets[0].hyroxActual.meters'),800);validateAll(a);value(a,0,'seconds','5:');validateAll(a);const b=setup(a.storage);b.run('editSavedLog(data.logs[0].id)');assert.equal(b.snapshot('logState.items[0].entries[0].hyroxInput.seconds'),'5:');assert.equal(b.snapshot('logState.variant.originalPlan.hyroxRounds.rounds.length'),4)});
test('a repeated-distance short variant separates per-entry distance from its reduced total',()=>{const a=setup();const id=a.create('Distance');a.context.id=id;a.run('data.workouts.find(w=>w.id===id).exercises=[{name:"Run",dose:"4 × 1 km",target:"4",unit:"km"}];persist()');a.open(id);a.run('openShortDraft();applyShortDraft()');assert.equal(a.snapshot('logState.items[0].entries.length'),2);assert.equal(a.snapshot('logState.items[0].plannedDistance.total'),2);assert.equal(a.snapshot('logState.items[0].plannedDistance.perEntry'),1);assert.equal(a.snapshot('logState.items[0].target'),'2');a.run('toggleLogEntry(0,0,"done");saveLog("partial")');assert.equal(a.snapshot('data.logs[0].exercises[0].value'),1);validateAll(a)});
test('warm-up and cooldown sets retain full volume in the default short suggestion',()=>{const a=setup(),id=a.create('Warmup');a.context.id=id;a.run('data.workouts.find(w=>w.id===id).exercises=[{name:"Oppvarming",dose:"4 × 6",target:"20",unit:"kg"},{name:"Working sets",dose:"4 × 6",target:"60",unit:"kg"}];persist()');a.open(id);a.run('openShortDraft()');assert.deepEqual(a.snapshot('shortDraft.counts'),[4,2])});
