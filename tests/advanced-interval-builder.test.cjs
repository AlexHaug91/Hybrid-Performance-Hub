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

function series(app, values = {}) {
  const config = { seqBasis:'distance',seqCount:'4',seqDuration:'5',seqDistance:'1',seqDistanceUnit:'km',seqSpeed:'12',seqSpeedUnit:'km/t',seqPause:'90',seqPauseUnit:'sec', ...values };
  for (const [id, value] of Object.entries(config)) { app.context.fieldId=id; app.run('document.getElementById(fieldId)'); app.fields.get(id).value=value; }
  return app.snapshot('seriesParts()');
}
function interval(app, values={}) {
  app.run('createWorkout();setWorkoutMode("interval")');
  app.fields.get('editTitle').value='Avansert intervall';
  series(app, values);app.run('addIntervalSeries()');
  const id=app.snapshot('editing');app.run('saveWorkout()');app.open(id);return id;
}
function backup(app) { return app.snapshot('({...data,draftsV4:logDrafts})'); }

test('4 × 1 km at 12 km/h creates 4 distinct 1 km runs, 3 pauses and 4 km work',()=>{
  const a=setup(), parts=series(a);
  assert.equal(parts.length,7);
  assert.deepEqual(parts.filter(p=>p.name==='Intervall').map(p=>p.intervalPlan.meters),[1000,1000,1000,1000]);
  assert.deepEqual(parts.filter(p=>p.name==='Pause').map(p=>p.intervalPlan.seconds),[90,90,90]);
  a.context.parts=parts;assert.match(a.run('intervalTotals(parts)'),/4 km arbeid · 20:00 arbeidstid · 3 pauser \(4:30\) · totalt 24:30/);
});
test('4 × 5 minutes at 12 km/h has 1 km and 300 seconds per run',()=>{
  const a=setup();a.context.parts=series(a,{seqBasis:'time'});
  assert.deepEqual(a.snapshot('parts.filter(p=>p.name==="Intervall").map(p=>intervalEstimate(p.intervalPlan))'),Array(4).fill({seconds:300,meters:1000}));
});
test('10 × 400 meters has 4 km total, 2 minutes per run and 9 pauses',()=>{
  const a=setup();a.context.parts=series(a,{seqCount:'10',seqDistance:'400',seqDistanceUnit:'m'});
  assert.equal(a.snapshot('parts.length'),19);
  assert.deepEqual(a.snapshot('intervalEstimate(parts[0].intervalPlan)'),{seconds:120,meters:400});
  assert.match(a.run('intervalTotals(parts)'),/10 drag · 4 km arbeid/);
});
test('pace 5:30 is 330 seconds, not 5.30 decimal minutes',()=>{
  const a=setup();a.context.parts=series(a,{seqSpeed:'5:30',seqSpeedUnit:'min/km'});
  assert.equal(a.snapshot('parts[0].intervalPlan.speedKmh'),3600/330);
  assert.equal(a.run('paceText(parts[0].intervalPlan.speedKmh)'),'5:30');
  assert.equal(a.snapshot('intervalEstimate(parts[0].intervalPlan).seconds'),330);
});
test('12 km/h corresponds to clock pace 5:00 and 1 km in five minutes',()=>{
  const a=setup();assert.equal(a.run('paceText(12)'),'5:00');a.context.parts=series(a);assert.equal(a.snapshot('intervalEstimate(parts[0].intervalPlan).seconds'),300);
});
test('comma decimals and decimal-minute rest are accepted consistently',()=>{
  const a=setup();const parts=series(a,{seqDistance:'0,4',seqSpeed:'12,5',seqPause:'1,5',seqPauseUnit:'min'});
  assert.equal(parts[0].intervalPlan.meters,400);assert.equal(parts[0].intervalPlan.speedKmh,12.5);assert.equal(parts[1].intervalPlan.seconds,90);
});
test('1:30 rest equals 90 seconds; zero rest creates no pauses',()=>{
  const a=setup();assert.equal(series(a,{seqPause:'1:30'})[1].intervalPlan.seconds,90);
  assert.equal(series(a,{seqPause:'0'}).length,4);
});
test('trailing pause is only added by explicit choice',()=>{
  const a=setup();series(a);a.run('document.getElementById("seqTrailingPause").checked=true');
  const parts=a.snapshot('seriesParts()');assert.equal(parts.length,8);assert.equal(parts.at(-1).name,'Pause');
});
for(const [field,bad] of [['seqCount','0'],['seqCount','-2'],['seqCount','1.5'],['seqCount','41'],['seqDistance','0'],['seqDistance','-1'],['seqDistance','abc'],['seqSpeed','0'],['seqSpeed','-12'],['seqPause','-1'],['seqSpeed','5:60'],['seqSpeed','5:3'],['seqSpeed','NaN']]) {
 test(`series rejects ${field}=${bad} before changing the workout`,()=>{const a=setup();a.run('createWorkout();setWorkoutMode("interval")');const before=a.snapshot('newWorkoutDraft');assert.throws(()=>series(a,{[field]:bad,...(bad.includes(':')?{seqSpeedUnit:'min/km'}:{})}));assert.deepEqual(a.snapshot('newWorkoutDraft'),before)});
}
for(const raw of [null,undefined,0,-1,'','5:60','5:3','-1:30','abc'])test(`invalid clock/pace ${String(raw)} is rejected`,()=>{const a=setup();a.context.raw=raw;assert.equal(a.run('parseSpeed(raw,"min/km")'),null)});
test('warmup, rest and cooldown support distance or time without changing other parts',()=>{
 const a=setup();a.run('createWorkout();setWorkoutMode("interval");addIntervalPart("Oppvarming");addIntervalPart("Pause");addIntervalPart("Nedjogging")');
 a.run('updateAdvancedPart(0,"basis","distance");updateAdvancedPart(0,"amount","2");updateAdvancedPart(1,"amountUnit","sec");updateAdvancedPart(1,"amount","90");updateAdvancedPart(2,"basis","distance");updateAdvancedPart(2,"amountUnit","m");updateAdvancedPart(2,"amount","500")');
 assert.deepEqual(a.snapshot('newWorkoutDraft.exercises.map(e=>[e.name,e.intervalPlan.seconds,e.intervalPlan.meters])'),[['Oppvarming',null,2000],['Pause',90,null],['Nedjogging',null,500]]);
 a.run('updateAdvancedPart(1,"basis","distance");updateAdvancedPart(1,"amount","0,2")');assert.equal(a.snapshot('newWorkoutDraft.exercises[1].intervalPlan.meters'),200);
});
test('copy is deep, order is editable and individual pace does not affect original',()=>{
 const a=setup();a.run('createWorkout();setWorkoutMode("interval")');series(a);a.run('addIntervalSeries();duplicateEx(0);updateAdvancedPart(1,"speed","13");moveInterval(1,1);removeEx(1)');
 assert.equal(a.snapshot('newWorkoutDraft.exercises[0].intervalPlan.speedKmh'),12);
 assert.equal(a.snapshot('newWorkoutDraft.exercises[1].intervalPlan.speedKmh'),13);
 assert.equal(a.snapshot('newWorkoutDraft.exercises.length'),7);
});
test('switching speed display repeatedly preserves exact SI speed',()=>{
 const a=setup();a.run('createWorkout();setWorkoutMode("interval")');series(a,{seqSpeed:'13.7'});a.run('addIntervalSeries();for(let i=0;i<20;i++){updateIntervalUnit(0,"min/km");updateIntervalUnit(0,"km/t")}');assert.equal(a.snapshot('newWorkoutDraft.exercises[0].intervalPlan.speedKmh'),13.7);
});
test('multiple series append rather than replace existing parts',()=>{
 const a=setup();a.run('createWorkout();setWorkoutMode("interval")');series(a);a.run('addIntervalSeries()');const before=a.snapshot('newWorkoutDraft.exercises');series(a,{seqBasis:'time'});a.run('addIntervalSeries()');assert.deepEqual(a.snapshot('newWorkoutDraft.exercises.slice(0,7)'),before);assert.equal(a.snapshot('newWorkoutDraft.exercises.length'),14);
});
test('distance logs distinguish planned distance, actual distance and actual time',()=>{
 const a=setup();interval(a);assert.equal(a.snapshot('logState.items[0].entries[0].value'),'1');assert.equal(a.snapshot('logState.items[0].entries[0].qty'),'');
 a.run('logState.items[0].entries[0]={done:true,skipped:false,value:"0.95",qty:"5.5"}');
 const result=a.snapshot('summarizeExercise(logState.items[0])');assert.equal(result.intervalPlan.meters,1000);assert.equal(result.value,.95);assert.deepEqual(result.sets[0].actual,{meters:950,seconds:330,speedKmh:Number((60*.95/5.5).toPrecision(12))});
});
test('meter UI converts actual distance to canonical kilometers without multiplying repetitions',()=>{
 const a=setup();assert.equal(a.run('readIntervalInput({},"value",{value:"390",dataset:{format:"meters"}})'),'.39'.replace(/^\./,'0.'));
 assert.equal(a.run('readIntervalInput({},"qty",{value:"1:55",dataset:{format:"duration"}})'),String(115/60));
});
test('pace typing and auto-capture preserve exact values when a rounded clock is untouched',()=>{
 const a=setup();assert.equal(a.run('readIntervalInput({value:String(60/13.7)},"value",{value:paceText(13.7),dataset:{format:"pace"}})'),String(60/13.7));
 assert.equal(a.run('readIntervalInput({},"value",{value:"5:30",dataset:{format:"pace"}})'),'5.5');
});
test('unfinished/invalid clock input stays in draft and blocks misleading successful save',()=>{
 const a=setup();interval(a);a.run('logState.items[0].entries[0].inputText={qty:"5:"};logState.items[0].entries[0].done=true;logDraftPersist()');
 assert.match(a.run('validateLogValues()'),/sjekk faktisk tid/);const state=a.snapshot('logState');a.run('saveLog()');assert.equal(a.snapshot('data.logs.length'),0);assert.deepEqual(Object.values(JSON.parse(a.storage.get(DRAFTS)))[0].state,state);
});
test('partial distance session saves actual metrics and reopens independently of template changes',()=>{
 const a=setup();const id=interval(a);a.fields.get('l4-0-0-value').value='0.98';a.fields.get('l4-0-0-qty').value='5.25';a.run('logState.items[0].entries[0].done=true;saveLog("partial")');
 const saved=a.snapshot('data.logs[0]');assert.equal(saved.status,'partial');assert.equal(saved.exercises[0].sets[0].actual.meters,980);
 a.context.templateId=id;a.run('editWorkout(templateId);removeEx(0);moveInterval(0,1);updateAdvancedPart(1,"speed","15");saveWorkout();editSavedLog(data.logs[0].id)');
 assert.deepEqual(a.snapshot('logState.items[0].intervalPlan'),saved.exercises[0].intervalPlan);assert.equal(a.snapshot('logState.items[0].entries[0].value'),'0.98');assert.deepEqual(a.snapshot('data.logs[0]'),saved);
});
test('failed actual-log storage retains state, draft, previous data and enables retry',()=>{
 const a=setup();interval(a);a.fields.get('l4-0-0-value').value='.98';a.fields.get('l4-0-0-qty').value='5';a.run('logState.items[0].entries[0].done=true;captureLogState()');const original=a.storage.get(MAIN);a.blocked.add(MAIN);a.run('saveLog()');assert.equal(a.storage.get(MAIN),original);assert.ok(a.storage.get(DRAFTS));assert.equal(a.snapshot('data.logs.length'),0);assert.ok(!a.toasts.includes('Økt fullført og lagret'));a.blocked.clear();a.run('saveLog()');assert.equal(a.snapshot('data.logs.length'),1);
});
test('new interval templates, actual metrics and unfinished draft text round-trip validation',()=>{
 const a=setup();interval(a);a.run('logState.items[0].entries[0].inputText={qty:"5:"};logDraftPersist()');a.context.payload=backup(a);assert.doesNotThrow(()=>a.run('validateBackup(payload)'));
 const b=setup(new Map([[MAIN,JSON.stringify(a.snapshot('data'))],[DRAFTS,JSON.stringify(a.snapshot('logDrafts'))]]));assert.deepEqual(b.snapshot('data'),a.snapshot('data'));assert.deepEqual(b.snapshot('logDrafts'),a.snapshot('logDrafts'));
});
for(const fixture of ['backup-v3.json','backup-v4.json'])test(`older ${fixture} validates and stored data is never automatically migrated`,()=>{
 const payload=JSON.parse(readFileSync(join(__dirname,'fixtures',fixture),'utf8')), a=setup(new Map([[MAIN,JSON.stringify(payload)]]));a.context.payload=payload;assert.doesNotThrow(()=>a.run('validateBackup(payload)'));assert.deepEqual(a.snapshot('data.workouts'),payload.workouts);
});
for(const [key,value] of [['basis','bad'],['seconds',0],['meters',-1],['speedKmh',0],['speedKmh','12'],['speedUnit','miles'],['timeUnit','hours'],['distanceUnit','mile']])test(`backup rejects malformed intervalPlan.${key}`,()=>{
 const a=setup();interval(a);const payload=backup(a),p=payload.workouts.at(-1).exercises[0].intervalPlan;p[key]=value;if(key==='seconds'){p.basis='time';p.meters=null}a.context.payload=payload;assert.throws(()=>a.run('validateBackup(payload)'));
});
test('imported text stays escaped in advanced amount and draft text fields',()=>{
 const a=setup();interval(a);a.context.hostile='"><img src=x onerror=alert(1)>';a.run('logState.items[0].entries[0].inputText={qty:hostile}');assert.match(a.run('advancedLogFields(logState.items[0],0,logState.items[0].entries[0],0)'),/&lt;img/);assert.doesNotMatch(a.run('advancedLogFields(logState.items[0],0,logState.items[0].entries[0],0)'),/<img/);
});
test('uncompleted parts never claim actual distance or speed',()=>{
 const a=setup();interval(a);assert.deepEqual(a.snapshot('summarizeExercise(logState.items[0]).sets[0].actual'),{meters:null,seconds:null,speedKmh:null});
});
test('actual derived numbers and unit metadata are validated on backup import',()=>{
 const a=setup();interval(a);a.fields.get('l4-0-0-qty').value='5';a.run('logState.items[0].entries[0].done=true;saveLog()');
 const payload=backup(a);a.context.payload=payload;assert.doesNotThrow(()=>a.run('validateBackup(payload)'));
 payload.logs[0].exercises[0].sets[0].actual.seconds='300';assert.throws(()=>a.run('validateBackup(payload)'));
 payload.logs[0].exercises[0].sets[0].actual.seconds=300;payload.logs[0].exercises[0].unit='<img src=x onerror=alert(1)>';assert.throws(()=>a.run('validateBackup(payload)'));
});
test('builder save failure does not claim a saved series or copy and keeps editable parts',()=>{
 const a=setup();const id=interval(a), stored=a.storage.get(MAIN);a.context.id=id;a.run('editWorkout(id)');series(a);a.toasts.length=0;a.blocked.add(MAIN);a.run('addIntervalSeries();duplicateEx(0)');assert.equal(a.storage.get(MAIN),stored);assert.equal(a.toasts.length,0);assert.equal(a.snapshot('editedWorkout().exercises.length'),15);assert.ok(a.alerts.length>=2);a.blocked.clear();a.run('saveWorkout()');assert.equal(JSON.parse(a.storage.get(MAIN)).workouts.at(-1).exercises.length,15);
});
test('cancelled creation never stores advanced parts or mutates the existing standard templates',()=>{
 const a=setup(),before=a.snapshot('data');a.run('createWorkout();setWorkoutMode("interval")');series(a);a.run('addIntervalSeries();closeEdit()');assert.deepEqual(a.snapshot('data'),before);assert.equal(a.storage.has(MAIN),false);
});
test('same-day occurrence logs and drafts keep their independent actual results',()=>{
 const a=setup();const id=interval(a);a.context.id=id;
 a.run('data.weekPlans={"2026-11-16":{overrides:{},extras:[{id:"extra-a",workoutId:id,day:3},{id:"extra-b",workoutId:id,day:3}]}};quickLog(id,"2026-11-18","extra-a")');
 a.fields.get('l4-0-0-value').value='0.9';a.fields.get('l4-0-0-qty').value='5';a.run('logState.items[0].entries[0].done=true;saveLog("partial")');
 a.run('quickLog(id,"2026-11-18","extra-b")');a.fields.get('l4-0-0-value').value='1.1';a.fields.get('l4-0-0-qty').value='6';a.run('logState.items[0].entries[0].done=true;saveLog("partial")');
 assert.deepEqual(a.snapshot('data.logs.map(l=>[l.occurrenceId,l.exercises[0].sets[0].actual.meters])'),[['extra-a',900],['extra-b',1100]]);
 a.context.payload=backup(a);assert.doesNotThrow(()=>a.run('validateBackup(payload)'));
});
test('explicitly switching a legacy part to pace upgrades only that part and preserves full speed precision',()=>{
 const a=setup();a.run('data.workouts[0].exercises[1].target="13.7"');const before=a.snapshot('data.workouts[0].exercises');a.run('editWorkout("interval");updateIntervalUnit(1,"min/km");updateIntervalUnit(1,"km/t")');assert.equal(a.snapshot('data.workouts[0].exercises[1].intervalPlan.speedKmh'),13.7);assert.deepEqual(a.snapshot('data.workouts[0].exercises.filter((e,i)=>i!==1)'),before.filter((e,i)=>i!==1));
});
test('oldest bundled interval shapes are readable without startup or stored-template migration',()=>{
 const a=setup();const payload=a.snapshot('data');payload.workouts[0].exercises=[{name:'Oppvarming rolig',dose:'10 min',target:'',unit:'min'},{name:'Intervaller 4x4',dose:'4 × 4 min',target:'12.5',unit:'km/t'},{name:'Nedjogging rolig',dose:'8 min',target:'',unit:'min'}];const storage=new Map([[MAIN,JSON.stringify(payload)]]),b=setup(storage);
 assert.deepEqual(b.snapshot('data'),payload);b.open('interval');assert.deepEqual(b.snapshot('logState.items.map(it=>[it.name,it.entries[0].qty,it.entries[0].value])'),[['Oppvarming','10','9'],['Intervall','4','12.5'],['Nedjogging','8','8']]);assert.equal(storage.get(MAIN),JSON.stringify(payload));
});
for(const [pace,speed] of [['5:00',12],['5:30',3600/330],['4:45',3600/285]])test(`QA clock pace ${pace} converts correctly in both directions`,()=>{
 const a=setup();a.context.pace=pace;assert.equal(a.run('parseSpeed(pace,"min/km")'),speed);a.context.speed=speed;assert.equal(a.run('paceText(speed)'),pace);
});
test('QA 10 × 400 m at 5:30 has 4 km work and exactly 132 seconds per run',()=>{
 const a=setup();a.context.parts=series(a,{seqCount:'10',seqDistance:'400',seqDistanceUnit:'m',seqSpeed:'5:30',seqSpeedUnit:'min/km'});assert.deepEqual(a.snapshot('parts.filter(p=>p.name==="Intervall").map(p=>intervalEstimate(p.intervalPlan).seconds)'),Array(10).fill(132));assert.match(a.run('intervalTotals(parts)'),/4 km arbeid · 22:00 arbeidstid · 9 pauser/);assert.equal(a.run('clockText(parts[1].intervalPlan.seconds)'),'1:30');
});
test('QA series selector converts 12 km/h to 5:00 and back without changing the workout',()=>{
 const a=setup();series(a);const before=a.snapshot('data');a.run('document.getElementById("seqSpeedUnit").value="min/km";changeSeriesSpeedUnit("min/km")');assert.equal(a.fields.get('seqSpeed').value,'5:00');assert.equal(a.snapshot('seriesParts()[0].intervalPlan.speedKmh'),12);a.run('document.getElementById("seqSpeedUnit").value="km/t";changeSeriesSpeedUnit("km/t")');assert.equal(a.fields.get('seqSpeed').value,'12');assert.deepEqual(a.snapshot('data'),before);
});
test('QA repeated selector conversions retain exact speed despite rounded clock display',()=>{
 const a=setup();series(a,{seqSpeed:'13.7'});a.run('for(let i=0;i<10;i++){document.getElementById("seqSpeedUnit").value="min/km";changeSeriesSpeedUnit("min/km");document.getElementById("seqSpeedUnit").value="km/t";changeSeriesSpeedUnit("km/t")}');assert.equal(a.fields.get('seqSpeed').value,'13.7');assert.equal(a.snapshot('seriesParts()[0].intervalPlan.speedKmh'),13.7);
});
test('QA individually varied distance and pace use each part rather than a series multiplier',()=>{
 const a=setup();a.run('createWorkout();setWorkoutMode("interval")');series(a);a.run('addIntervalSeries();updateAdvancedPart(0,"amount","0.4");updateIntervalUnit(0,"min/km");updateAdvancedPart(0,"speed","5:30");updateAdvancedPart(2,"amount","2");updateAdvancedPart(2,"speed","15")');assert.deepEqual(a.snapshot('intervalEstimate(newWorkoutDraft.exercises[0].intervalPlan)'),{meters:400,seconds:132});assert.deepEqual(a.snapshot('intervalEstimate(newWorkoutDraft.exercises[2].intervalPlan)'),{meters:2000,seconds:480});assert.match(a.run('intervalTotals(newWorkoutDraft.exercises)'),/4,4 km arbeid/);
});
test('QA legacy decimal pace and fractional duration remain unchanged through explicit editing and JSON',()=>{
 const a=setup();a.run('data.workouts[0].exercises[1]={name:"Intervall bakke",dose:"0.125",target:"5.123",unit:"min/km"}');const old=a.snapshot('data.workouts[0].exercises[1]');a.open('interval');assert.equal(a.snapshot('logState.items[1].entries[0].value'),'5.123');assert.equal(a.snapshot('logState.items[1].entries[0].qty'),'0.125');a.run('editWorkout("interval");updateIntervalUnit(1,"km/t")');assert.equal(a.snapshot('data.workouts[0].exercises[1].intervalPlan.speedKmh'),60/5.123);assert.equal(a.snapshot('data.workouts[0].exercises[1].intervalPlan.seconds'),7.5);a.context.payload=backup(a);assert.doesNotThrow(()=>a.run('validateBackup(payload)'));assert.equal(old.target,'5.123');
});
test('QA untouched meter display preserves the exact stored number when editing notes',()=>{
 const a=setup();a.context.exact='0.123456789012345';const display=String(Number((Number(a.context.exact)*1000).toPrecision(12)));a.context.display=display;assert.equal(a.run('readIntervalInput({value:exact},"value",{value:display,dataset:{format:"meters"}})'),a.context.exact);
});
test('QA imported raw input cannot silently disagree with the actual number being saved',()=>{
 const a=setup();assert.equal(a.run('readIntervalInput({value:"2",inputText:{value:"1"}},"value",{value:"1",dataset:{format:"number"}})'),'1');assert.equal(a.run('readIntervalInput({qty:"5",inputText:{qty:"5:"}},"qty",{value:"5:",dataset:{format:"duration"}})'),'');
});
