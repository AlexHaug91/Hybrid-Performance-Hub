const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const script = readFileSync(join(__dirname,'..','index.html'),'utf8').match(/<script>([\s\S]*)<\/script>/)[1].replace(/init\(\);\s*$/,'');
const MAIN='hyrox_performance_hub_v1', DRAFTS='hyrox_performance_hub_v4_drafts', WEEK='2026-11-16';
function setup(storage=new Map()){
 const fields=new Map(),alerts=[],toasts=[],blocked=new Set();let n=0;
 const context=vm.createContext({structuredClone,crypto:{randomUUID:()=> 'test-'+(++n)},
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{if(blocked.has(k))throw Error('Blocked');storage.set(k,v)},removeItem:k=>storage.delete(k)},
  document:{getElementById:id=>{if(!fields.has(id))fields.set(id,{value:'',innerHTML:'',textContent:'',style:{setProperty(){}},classList:{add(){},remove(){}},focus(){},scrollIntoView(){}});return fields.get(id)},querySelector:()=>null},
  requestAnimationFrame:cb=>cb(),alert:m=>alerts.push(m),confirm:()=>true,recordToast:m=>toasts.push(m)});
 vm.runInContext(script,context);const run=c=>vm.runInContext(c,context),snapshot=e=>JSON.parse(run(`JSON.stringify(${e})`));
 run(`nav=()=>{};toast=recordToast;renderAll=()=>{};weekOffset=Math.round((parseDate('${WEEK}')-startWeek(new Date()))/(7*86400000));refreshWorkoutChoices();
 renderLogUI=()=>{for(const [id,key] of [['logRpe','rpe'],['logDuration','duration'],['logNotes','notes']])document.getElementById(id).value=logState[key];logState.items.forEach((item,i)=>item.entries.forEach((entry,j)=>{for(const key of ['value','qty'])document.getElementById('l4-'+i+'-'+j+'-'+key).value=entry[key]}))};persist();`);
 function extra(type='upper',day=1){run('openExtraWorkout()');fields.get('extraWorkout').value=type;fields.get('weekDay').value=String(day);run('saveWeekAction()');return snapshot(`data.weekPlans['${WEEK}'].extras.at(-1).id`)}
 function move(id,day,scope='week'){context.id=id;run('openWeekMove(id)');fields.get('weekDay').value=String(day);fields.get('weekScope').value=scope;run('saveWeekAction()')}
 function open(type,date,occurrenceId=null){Object.assign(context,{type,date,occurrenceId});run('quickLog(type,date,occurrenceId)')}
 function note(value){fields.get('logNotes').value=value;run('captureLogState()')}
 return {run,snapshot,extra,move,open,note,fields,storage,alerts,toasts,blocked,context};
}
const repeat=type=>'repeat:'+WEEK+':'+type;

test('without weekPlans the unchanged fixed templates generate recurring occurrences',()=>{
 const app=setup(),original=app.snapshot('data.workouts');
 assert.equal(app.snapshot('data.weekPlans??null'),null);
 const occurrences=app.snapshot(`weekOccurrences(parseDate('${WEEK}'))`);
 assert.equal(occurrences.length,4);assert.ok(occurrences.every(o=>!o.changed&&o.kind==='repeat'));
 assert.equal(occurrences[0].id,repeat('interval'));assert.deepEqual(app.snapshot('data.workouts'),original);
});

for(const day of [0,1,2,3,4,5,6])test(`moves one occurrence to weekday ${day} without changing the template or other weeks`,()=>{
 const app=setup(),before=app.snapshot('data');app.move(repeat('upper'),day);
 assert.deepEqual(app.snapshot('data.workouts'),before.workouts);
 assert.equal(app.snapshot(`weekOccurrences(parseDate('${WEEK}')).find(o=>o.workoutId==='upper').day`),day);
 assert.equal(app.snapshot("weekOccurrences(parseDate('2026-11-23')).find(o=>o.workoutId==='upper').day"),6);
 assert.equal(setup(app.storage).snapshot(`weekOccurrences(parseDate('${WEEK}')).find(o=>o.workoutId==='upper').day`),day);
});

test('explicit all-weeks scope changes only the fixed day and preserves history/drafts',()=>{
 const app=setup();app.open('upper','2026-11-18');app.note('Kladd');const drafts=app.snapshot('logDrafts');
 app.move(repeat('upper'),2,'all');
 assert.equal(app.snapshot("data.workouts.find(w=>w.id==='upper').day"),2);
 assert.equal(app.snapshot("weekOccurrences(parseDate('2026-11-23')).find(o=>o.workoutId==='upper').day"),2);
 assert.deepEqual(app.snapshot('logDrafts'),drafts);
});

test('skip affects only its week and can be reversed without archiving the template',()=>{
 const app=setup(),original=app.snapshot('data.workouts');app.run(`toggleWeekSkip('${repeat('interval')}')`);
 assert.equal(app.snapshot(`weekOccurrences(parseDate('${WEEK}')).some(o=>o.workoutId==='interval')`),false);
 assert.equal(app.snapshot("weekOccurrences(parseDate('2026-11-23')).some(o=>o.workoutId==='interval')"),true);
 assert.deepEqual(app.snapshot('data.workouts'),original);
 app.run(`toggleWeekSkip('${repeat('interval')}')`);
 assert.equal(app.snapshot(`weekOccurrences(parseDate('${WEEK}')).some(o=>o.workoutId==='interval')`),true);
});

test('extra occurrences share a template but have independent stable IDs and never repeat next week',()=>{
 const app=setup(),original=app.snapshot('data.workouts'),a=app.extra('upper',6),b=app.extra('upper',6);
 assert.notEqual(a,b);assert.deepEqual(app.snapshot('data.workouts'),original);
 assert.equal(app.snapshot(`weekOccurrences(parseDate('${WEEK}')).filter(o=>o.workoutId==='upper').length`),3);
 assert.equal(app.snapshot("weekOccurrences(parseDate('2026-11-23')).filter(o=>o.workoutId==='upper').length"),1);
 assert.equal(setup(app.storage).snapshot(`weekOccurrences(parseDate('${WEEK}')).find(o=>o.id==='${a}').id`),a);
});

test('an extra occurrence can move or skip without changing another occurrence or the template',()=>{
 const app=setup(),id=app.extra('upper',6);app.move(id,1);
 assert.equal(app.snapshot(`findOccurrence('${id}').day`),1);
 assert.equal(app.snapshot(`findOccurrence('${repeat('upper')}').day`),6);
 app.run(`toggleWeekSkip('${id}')`);assert.equal(app.snapshot(`findOccurrence('${id}').skipped`),true);
 assert.equal(app.snapshot("!!data.workouts.find(w=>w.id==='upper').archived"),false);
});

test('two extra occurrences of the same template and date keep separate drafts and logs',()=>{
 const app=setup(),a=app.extra('upper',1),b=app.extra('upper',1);
 app.open('upper','2026-11-16',a);app.note('Kladd A');app.fields.get('l4-0-0-value').value='70';app.run('captureLogState()');
 app.open('upper','2026-11-16',b);app.note('Kladd B');app.fields.get('l4-0-0-value').value='80';app.run('captureLogState()');
 app.open('upper','2026-11-16',a);assert.equal(app.fields.get('logNotes').value,'Kladd A');assert.equal(app.fields.get('l4-0-0-value').value,'70');app.run('markAllSets(0);saveLog()');
 app.open('upper','2026-11-16',b);assert.equal(app.fields.get('logNotes').value,'Kladd B');app.run('markAllSets(0);saveLog()');
 assert.equal(app.snapshot('data.logs.length'),2);
 assert.deepEqual(app.snapshot('data.logs.map(l=>l.occurrenceId)'),[a,b]);
 assert.deepEqual(app.snapshot('data.logs.map(l=>l.exercises[0].sets[0].value)'),[70,80]);
 app.run('validateBackup({...data,draftsV4:logDrafts})');
});

test('fixed and extra occurrences on the same day cannot overwrite each other',()=>{
 const app=setup(),extra=app.extra('upper',6);app.open('upper','2026-11-22',repeat('upper'));app.run('markAllSets(0);saveLog()');
 const original=app.snapshot('data.logs[0]');app.open('upper','2026-11-22',extra);assert.equal(app.snapshot('logEditingId'),null);app.run('markAllSets(0);saveLog()');
 assert.deepEqual(app.snapshot('data.logs[0]'),original);assert.equal(app.snapshot('data.logs.length'),2);
});

test('moving a planned occurrence preserves and reopens its draft at the recorded date',()=>{
 const app=setup(),id=app.extra('upper',1);app.open('upper','2026-11-16',id);app.note('Ikke flytt faktiske data');const drafts=app.snapshot('logDrafts');
 app.move(id,3);assert.deepEqual(app.snapshot('logDrafts'),drafts);
 app.open('upper','2026-11-18',id);assert.equal(app.fields.get('logNotes').value,'Ikke flytt faktiske data');assert.equal(app.snapshot('logState.date'),'2026-11-16');
});

test('moving or skipping a logged occurrence cannot alter its historical dates or exercises',()=>{
 const app=setup(),id=app.extra('interval',1);app.open('interval','2026-11-16',id);app.run('markAllIntervals();saveLog()');const original=app.snapshot('data.logs[0]');
 app.move(id,4);app.run(`toggleWeekSkip('${id}')`);assert.deepEqual(app.snapshot('data.logs[0]'),original);
 app.open('interval','2026-11-19',id);assert.equal(app.snapshot('logEditingId'),original.id);assert.equal(app.snapshot('logState.date'),original.date);
});

test('partial logs and their historical drafts retain occurrence ownership after reload',()=>{
 const app=setup(),id=app.extra('upper',1);app.open('upper','2026-11-16',id);app.run('markAllSets(0);saveLog("partial")');app.note('Pågående med kladd');
 const restored=setup(app.storage);restored.open('upper','2026-11-16',id);assert.equal(restored.fields.get('logNotes').value,'Pågående med kladd');
 assert.equal(restored.snapshot('logState.occurrenceId'),id);assert.equal(restored.snapshot('data.logs.length'),1);
});

test('legacy logs and legacy drafts remain compatible with recurring occurrences',()=>{
 const app=setup();app.open('upper','2026-11-22');app.run('markAllSets(0);saveLog()');const original=app.snapshot('data.logs[0]');
 app.open('upper','2026-11-22',repeat('upper'));assert.equal(app.snapshot('logEditingId'),original.id);app.run('saveLog()');assert.equal(app.snapshot('data.logs[0].occurrenceId??null'),null);
 app.open('hyrox','2026-11-18');app.note('Eldre kladd');const key=app.snapshot('logKey');app.open('hyrox','2026-11-18',repeat('hyrox'));
 assert.equal(app.fields.get('logNotes').value,'Eldre kladd');assert.equal(app.snapshot('logKey'),key);
});

test('archived templates restore with original IDs/exercises and selected fixed day, without touching logs/drafts',()=>{
 const app=setup();app.open('upper','2026-11-18');app.run('markAllSets(0);saveLog("partial")');app.note('Kladd');app.run("archiveWorkout('upper')");
 const logs=app.snapshot('data.logs'),drafts=app.snapshot('logDrafts'),exercises=app.snapshot("data.workouts.find(w=>w.id==='upper').exercises"),rawDrafts=app.storage.get(DRAFTS);
 app.run("restoreWorkout('upper','2')");
 assert.equal(app.snapshot("data.workouts.find(w=>w.id==='upper').day"),2);assert.equal(app.snapshot("data.workouts.find(w=>w.id==='upper').archived"),false);
 assert.deepEqual(app.snapshot('data.logs'),logs);assert.deepEqual(app.snapshot('logDrafts'),drafts);assert.equal(app.storage.get(DRAFTS),rawDrafts);
 assert.deepEqual(app.snapshot("data.workouts.find(w=>w.id==='upper').exercises"),exercises);assert.equal(app.snapshot("data.workouts.filter(w=>w.id==='upper').length"),1);
});

test('restoration preserves explicit weekly exceptions and is included in archive rendering',()=>{
 const app=setup();app.move(repeat('upper'),4);app.run("archiveWorkout('upper');renderArchive()");assert.match(app.fields.get('archiveList').innerHTML,/Gjenopprett/);
 app.run("restoreWorkout('upper',1)");assert.equal(app.snapshot(`findOccurrence('${repeat('upper')}').day`),4);
 assert.equal(app.snapshot("weekOccurrences(parseDate('2026-11-23')).find(o=>o.workoutId==='upper').day"),1);
});

test('restore storage failure leaves archived template, logs and drafts unchanged for retry',()=>{
 const app=setup();app.run("archiveWorkout('upper')");const before=app.snapshot('data');app.blocked.add(MAIN);app.run("restoreWorkout('upper',2)");
 assert.deepEqual(app.snapshot('data'),before);assert.ok(!app.toasts.some(m=>m.startsWith('Økten er gjenopprettet')));
 app.blocked.clear();app.run("restoreWorkout('upper',2)");assert.equal(app.snapshot("data.workouts.find(w=>w.id==='upper').archived"),false);
});

for(const day of ['',null,-1,7,1.5])test(`invalid restoration day ${JSON.stringify(day)} is rejected`,()=>{
 const app=setup();app.run("archiveWorkout('upper')");app.context.day=day;const before=app.snapshot('data');app.run("restoreWorkout('upper',day)");assert.deepEqual(app.snapshot('data'),before);
});

for(const kind of ['move','extra','skip'])test(`failed weekly ${kind} save leaves fixed plan, history and drafts unchanged`,()=>{
 const app=setup();app.open('upper','2026-11-18');app.note('Behold');const before=app.snapshot('data'),drafts=app.snapshot('logDrafts'),raw=app.storage.get(MAIN);app.blocked.add(MAIN);
 if(kind==='move')app.move(repeat('upper'),2);else if(kind==='skip')app.run(`toggleWeekSkip('${repeat('upper')}')`);else{app.run('openExtraWorkout()');app.fields.get('extraWorkout').value='upper';app.run('saveWeekAction()')}
 assert.deepEqual(app.snapshot('data'),before);assert.deepEqual(app.snapshot('logDrafts'),drafts);assert.equal(app.storage.get(MAIN),raw);
});

test('cancelling an action or switching weeks does not save an unfinished weekly change',()=>{
 const app=setup(),before=app.snapshot('data');app.run(`openWeekMove('${repeat('upper')}')`);app.fields.get('weekDay').value='2';app.run('closeWeekEditor()');assert.deepEqual(app.snapshot('data'),before);
 app.run(`openWeekMove('${repeat('upper')}');shiftWeek(1)`);assert.equal(app.snapshot('pendingWeekAction'),null);
 app.run(`confirm=()=>false;toggleWeekSkip('${repeat('upper')}')`);assert.deepEqual(app.snapshot('data'),before);
});

test('week plans, restored archives, extra logs and drafts survive JSON import/export',async()=>{
 const app=setup();app.move(repeat('upper'),2);const id=app.extra('interval',3);app.open('interval','2026-11-18',id);app.run('markAllIntervals();saveLog("partial")');app.note('JSON-kladd');app.run("archiveWorkout('upper');restoreWorkout('upper',1)");
 const backup=app.snapshot('validateBackup({...data,draftsV4:logDrafts})');const restored=setup();restored.context.backupText=JSON.stringify(backup);
 await restored.run("importData({target:{files:[{text:async()=>backupText}],value:''}})");
 assert.deepEqual(restored.snapshot('data.weekPlans'),backup.weekPlans);assert.deepEqual(restored.snapshot('data.logs'),backup.logs);
 restored.run('editSavedLog(data.logs[0].id)');assert.equal(restored.fields.get('logNotes').value,'JSON-kladd');assert.equal(restored.snapshot('logState.occurrenceId'),id);
});

for(const file of ['backup-v3.json','backup-v4.json'])test(`${file} still imports with a fixed weekly schedule`,async()=>{
 const app=setup();app.context.backupText=readFileSync(join(__dirname,'fixtures',file),'utf8');await app.run("importData({target:{files:[{text:async()=>backupText}],value:''}})");
 assert.equal(app.snapshot('data.weekPlans??null'),null);assert.equal(app.snapshot(`weekOccurrences(parseDate('${WEEK}')).length`),4);
});

for(const [name,mutation] of [
 ['invalid week date',"backup.weekPlans['2026-11-17']=backup.weekPlans['2026-11-16'];delete backup.weekPlans['2026-11-16']"],
 ['unknown template',"backup.weekPlans['2026-11-16'].extras[0].workoutId='missing'"],
 ['invalid day',"backup.weekPlans['2026-11-16'].extras[0].day=7"],
 ['invalid skipped flag',"backup.weekPlans['2026-11-16'].extras[0].skipped='yes'"],
 ['duplicate occurrence ID',"backup.weekPlans['2026-11-16'].extras.push(structuredClone(backup.weekPlans['2026-11-16'].extras[0]))"],
 ['malicious ID',"backup.weekPlans['2026-11-16'].extras[0].id=\"x');alert(1)//\""],
 ['unknown override',"backup.weekPlans['2026-11-16'].overrides.missing={day:1}"],
 ['wrong override shape',"backup.weekPlans['2026-11-16'].overrides.upper=[]"],
 ['wrong occurrence owner',"backup.logs[0].occurrenceId='repeat:2026-11-16:interval'"],
 ['unknown extra reference',"backup.logs[0].occurrenceId='extra-missing'"],
])test(`JSON rejects ${name} before replacing data`,async()=>{
 const app=setup(),id=app.extra('upper',1);app.open('upper','2026-11-16',id);app.run('markAllSets(0);saveLog()');const before=app.snapshot('data'),raw=app.storage.get(MAIN);
 app.run('let backup=structuredClone(data)');app.run(mutation);app.context.backupText=app.snapshot('JSON.stringify(backup)');await app.run("importData({target:{files:[{text:async()=>backupText}],value:''}})");
 assert.deepEqual(app.snapshot('data'),before);assert.equal(app.storage.get(MAIN),raw);assert.match(app.alerts.at(-1),/Kunne ikke importere/);
});

test('skipped extra draft remains resumable and can be completed after archive and restoration',()=>{
 const app=setup(),id=app.extra('upper',1);app.open('upper','2026-11-16',id);app.note('Behold ekstra kladd');const key=app.snapshot('logKey');
 app.run(`toggleWeekSkip('${id}');archiveWorkout('upper');renderArchivedDrafts()`);
 assert.match(app.fields.get('archivedDrafts').innerHTML,/Fortsett kladd/);app.context.key=key;app.run('resumeArchivedDraft(key);markAllSets(0);saveLog("partial")');
 assert.equal(app.snapshot('data.logs[0].occurrenceId'),id);const logs=app.snapshot('data.logs');app.note('Senere kladd');const drafts=app.snapshot('logDrafts');
 app.run("restoreWorkout('upper',4)");assert.deepEqual(app.snapshot('data.logs'),logs);assert.deepEqual(app.snapshot('logDrafts'),drafts);
 app.run('validateBackup({...data,draftsV4:logDrafts});editSavedLog(data.logs[0].id)');assert.equal(app.fields.get('logNotes').value,'Senere kladd');
});

test('changing log date or choosing a different template never transfers an occurrence to the wrong owner',()=>{
 const app=setup(),id=app.extra('upper',1);app.open('upper','2026-11-16',id);app.note('Opprinnelig ekstra');
 app.fields.get('logType').value='hyrox';app.run('selectLogWorkout()');assert.equal(app.snapshot('logState.occurrenceId??null'),null);
 app.open('upper','2026-11-16',id);app.fields.get('logDate').value='2026-11-17';app.run('selectLogDate()');assert.equal(app.snapshot('logState.occurrenceId??null'),null);
 app.run('validateBackup({...data,draftsV4:logDrafts})');
});
