'use strict';
(() => {
 const RELEASE = 'hyrox-rounds-20261127-2';
 const RETURN_KEY='hybrid_pwa_update_return',HELP_KEY='hybrid_pwa_transfer_help_seen';
 const formSelectors={nutrition:'#page-nutrition input,#page-nutrition textarea',settings:'[id^="setting"]',pro:'#proGoals input'};
 const baselines=new WeakMap();
 const state={registration:null,cacheReady:false,cachePreparing:false,network:'checking',waiting:null,warning:'',storageProblem:false,prompt:null,busy:false,phase:'idle',attempt:0,expectedRelease:null,reloading:false,installed:false,transfer:false};
 let networkAttempt=0,networkAbort=null,activationTimer=null;
 const text=source=>t(source);
 function nodes(area){return [...document.querySelectorAll(formSelectors[area])]}
 function rememberForms(area){for(const name of area?[area]:Object.keys(formSelectors))for(const el of nodes(name))baselines.set(el,el.value)}
 function dirtyForms(){
  for(const area of Object.keys(formSelectors))for(const el of nodes(area)){
   if(!baselines.has(el)){
    // Pro inputs are replaced by normal rendering; derive their baseline from saved model values.
    const index=el.id.match(/^pro(\d+)$/);baselines.set(el,index?String(data.pro[Number(index[1])]?.current??''):el.value);
   }
   if(el.value!==baselines.get(el))return true;
  }
  return false;
 }
 function standalone(){return window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}
 function hasData(){return data.logs.length>0||data.nutrition.length>0||data.pro.some(p=>p.current!==null)||Object.keys(logDrafts).length>0||Object.keys(data.weekPlans||{}).length>0||data.workouts.some(w=>!defaultWorkouts.some(original=>original.id===w.id))}
 function reply(worker,type,extra={},timeout=4500){
  return new Promise((resolve,reject)=>{
   if(!worker){reject(Error('worker-unavailable'));return}
   const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('worker-timeout'))},timeout);
   channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data)};
   try{worker.postMessage({type,...extra},[channel.port2])}catch(error){clearTimeout(timer);channel.port1.close();reject(error)}
  });
 }
 function setContent(el,html){if(el.innerHTML!==html)el.innerHTML=html}
 function bind(id,handler){const el=document.getElementById(id);if(el)el.onclick=handler}
 function render(){
  const focused=document.activeElement?.id,open=document.getElementById('pwaInstallHelp')?.open;
  const network={checking:'Nettverk ikke kontrollert',online:'Tilkoblet',offline:'Offline – kun lokal lagring',unverified:'Ingen bekreftet nettilkobling'}[state.network];
  const logError=[...logSaveStates.values()].some(s=>s.status==='error'||s.memoryOnly);
  setContent(document.getElementById('pwaStatus'),ui`<span>${text(network)}</span><span>${text(state.cacheReady?'Offline-filer klare på denne enheten':'Offline-filer er ikke klare')}</span>${state.storageProblem||logError?ui`<strong class="pwa-error">Kunne ikke lagre data</strong>`:''}`);
  const update=document.getElementById('pwaUpdate');update.hidden=!state.waiting&&!state.warning;
  setContent(update,ui`${state.waiting?ui`<strong>Oppdatering tilgjengelig</strong><button id="pwaApplyUpdate" type="button" class="btn small" ${state.busy||state.cachePreparing?'disabled':''}>Oppdater trygt</button>`:''}${state.warning?ui`<p class="note pwa-error" role="status">${text(state.warning)}</p>`:''}`);
  bind('pwaApplyUpdate',applyUpdate);
  const settings=document.getElementById('pwaSettings');
  setContent(settings,ui`<h2 class="heading">Installer Hybrid og bruk appen offline</h2><p class="note">Åpne appen med nett først, og vent til «Offline-filer klare» vises. Treningsdata lagres lokalt, uten skysynkronisering.</p><details id="pwaInstallHelp"><summary>Installasjon på iPhone og Android</summary><h3>iPhone · Safari</h3><p class="note">Åpne Hybrid i Safari. Trykk Del, velg Legg til på Hjem-skjerm og åpne appikonet. iPhone tilbyr ikke automatisk installasjon fra denne knappen.</p><h3>Android · Chrome</h3><p class="note">Bruk Installer-knappen når nettleseren tilbyr den, eller menyen i Chrome og Installer app / Legg til på startskjermen.</p></details>${state.prompt&&!state.installed?ui`<button id="pwaInstall" type="button" class="btn secondary">Installer Hybrid</button>`:''}<p class="note">Safari og en installert iPhone-app kan ha forskjellige lokale data. Eksporter JSON i den gamle Safari-versjonen, åpne den installerte appen og importer kopien under Sikkerhetskopi og data.</p><p class="note">Har den installerte appen allerede egne logger eller økter? Eksporter en kopi der først. Import erstatter data etter bekreftelse og oppretter en gjenopprettingskopi. Ingenting overføres eller overskrives automatisk.</p><p class="note">Offline-filer og lagrede treningsdata er forskjellige. Hvis nettleseren sletter lagringen, må appfilene lastes ned igjen. Behold jevnlige JSON-sikkerhetskopier.</p><button id="pwaCheckUpdates" type="button" class="btn secondary" ${state.busy||state.cachePreparing?'disabled':''}>Sjekk oppdateringer</button>`);
  if(open)document.getElementById('pwaInstallHelp').open=true;
  bind('pwaInstall',install);
  bind('pwaCheckUpdates',checkUpdates);
  const transfer=document.getElementById('pwaTransfer');transfer.hidden=!state.transfer;
  setContent(transfer,state.transfer?ui`<strong>Installert app · data lagres separat</strong><p class="note">Historikken fra Safari følger ikke nødvendigvis med. Eksporter JSON fra Safari og importer kopien her. Det finnes ingen automatisk synkronisering.</p>${hasData()?ui`<p class="note pwa-error">Denne appen har allerede lokale data. Eksporter en kopi her før du importerer noe annet.</p>`:''}<div class="inline-actions"><button id="pwaTransferGuide" type="button" class="btn small secondary">Vis overføringsveiledning</button><button id="pwaTransferAck" type="button" class="btn small ghost">Jeg forstår</button></div>`:'');
  bind('pwaTransferGuide',()=>{nav('settings');document.getElementById('pwaInstallHelp').open=true;settings.scrollIntoView({block:'start'})});
  bind('pwaTransferAck',()=>{try{localStorage.setItem(HELP_KEY,'yes');if(localStorage.getItem(HELP_KEY)!=='yes')throw Error('not-stored');state.transfer=false}catch(error){state.warning='Kunne ikke lagre innstillingen. Treningsdata er ikke endret.'}render()});
  const progress=document.getElementById('pwaUpdateProgress');
  document.getElementById('pwaProgressTitle').textContent=text('Oppdaterer appfilene');
  document.getElementById('pwaProgressText').textContent=text(state.phase==='activating'?'Kladdene er kontrollert. Venter på ny appversjon.':'Kontrollerer skjemaer, kladder og offline-filer.');
  const cancel=document.getElementById('pwaCancelUpdate');cancel.textContent=text('Avbryt');cancel.disabled=state.phase==='activating';
  if(focused&&document.getElementById(focused)&&!progress.open)document.getElementById(focused).focus({preventScroll:true});
 }
 async function refreshCache(){
  if(state.busy&&state.phase==='activating')return;
  const worker=navigator.serviceWorker?.controller||state.registration?.active;
  try{const result=await reply(worker,'CACHE_STATUS');state.cacheReady=result.ok&&result.ready}catch(error){state.cacheReady=false}
  render();
 }
 async function repairOfflineFiles(){
  if(state.cacheReady||state.cachePreparing||state.busy||state.network!=='online'||!state.registration?.active)return;
  state.cachePreparing=true;render();
  try{const result=await reply(state.registration.active,'REPAIR_CACHE',{},30000);state.cacheReady=!!(result.ok&&result.ready)}
  catch(error){state.warning='Offline-filene kunne ikke klargjøres. Åpne appen med nett og prøv igjen.'}
  finally{state.cachePreparing=false;render()}
 }
 async function probeNetwork(){
  const attempt=++networkAttempt;networkAbort?.abort();const controller=new AbortController();networkAbort=controller;
  if(navigator.onLine===false){state.network='offline';render()}
  const timer=setTimeout(()=>controller.abort(),5000);
  try{
   const url=new URL('./manifest.webmanifest',document.baseURI);url.searchParams.set('hybrid-network',Date.now()+'-'+attempt);
   // The worker deliberately does not intercept query URLs. A cached response cannot prove connectivity.
   const response=await fetch(url,{cache:'no-store',signal:controller.signal});
   const manifest=await response.json();if(!response.ok||response.redirected||manifest.name!=='Hybrid Performance Hub')throw Error('not-confirmed');
   if(attempt===networkAttempt)state.network='online';
  }catch(error){if(attempt===networkAttempt)state.network=navigator.onLine===false?'offline':'unverified'}
  finally{clearTimeout(timer);if(attempt===networkAttempt){render();repairOfflineFiles()}}
 }
 function observeInstalling(worker){
  if(!worker)return;
  worker.addEventListener('statechange',()=>{
   if(worker.state==='installed'){state.waiting=state.registration.waiting;refreshCache()}
   if(worker.state==='redundant'){state.warning=state.registration.active?'Oppdateringen kunne ikke klargjøres. Den aktive versjonen er beholdt.':'Offline-filene kunne ikke klargjøres. Åpne appen med nett og prøv igjen.';render()}
  });
 }
 async function checkUpdates(){
  if(!state.registration){state.warning='Offline-støtte er ikke tilgjengelig her. Bruk HTTPS eller localhost.';render();return}
  state.warning='';render();
  try{await state.registration.update();state.waiting=state.registration.waiting;await refreshCache();await probeNetwork();await repairOfflineFiles()}
  catch(error){state.warning='Kunne ikke kontrollere oppdateringer. Den aktive appen er ikke endret.';render()}
 }
 async function install(){
  const prompt=state.prompt;if(!prompt)return;
  state.prompt=null;render();
  try{await prompt.prompt();await prompt.userChoice}catch(error){state.warning='Installasjonen ble ikke fullført. Bruk nettleserens meny.';render()}
 }
 function updateError(reason){return {
  busy:'Vent til import eller lagring er ferdig, og prøv igjen.',
  forms:'Avslutt eller lukk åpne byggere og lagre skjemaverdiene før du oppdaterer.',
  'unsaved-data':'Data i den åpne appen er ikke bekreftet lagret. Lagre endringene eller eksporter en kopi før oppdatering.',
  cancelled:'Oppdatering avbrutt. Den åpne appen er beholdt.',
  'storage-error':'Kunne ikke kontrollere lagringen. Innholdet er beholdt i den åpne appen. Prøv igjen før du lukker.',
  'other-windows':'Lukk andre Hybrid-vinduer før du oppdaterer. Ingen vinduer er lastet inn på nytt.',
  'incomplete-cache':'Oppdateringens offline-filer er ikke komplette. Den aktive appen er beholdt.'
 }[reason]||'Oppdateringen kunne ikke fullføres. Den åpne appen er beholdt. Prøv igjen.'}
 function finishFailure(reason){
  document.getElementById('pwaUpdate').dataset.reason=reason;
  clearTimeout(activationTimer);state.attempt++;state.busy=false;state.phase='idle';state.expectedRelease=null;state.reloading=false;
  try{sessionStorage.removeItem(RETURN_KEY)}catch(error){}
  const progress=document.getElementById('pwaUpdateProgress');if(progress.open)progress.close();state.warning=updateError(reason);render();
  document.getElementById('pwaApplyUpdate')?.focus({preventScroll:true});
 }
 async function applyUpdate(){
  if(state.busy||state.cachePreparing||!state.waiting)return;
  state.busy=true;state.phase='checking';state.warning='';const attempt=++state.attempt;render();document.getElementById('pwaUpdateProgress').showModal();
  try{
   if(dirtyForms())throw Error('forms');
   const barrier=prepareDataForPwaUpdate();if(!barrier.ok)throw Error(barrier.reason);
   const worker=state.waiting,prepared=await reply(worker,'PREPARE_UPDATE');if(attempt!==state.attempt)return;
   if(!prepared.ok)throw Error(prepared.reason);
   // Recheck after the asynchronous handshake. The modal prevents new user edits.
   if(dirtyForms())throw Error('forms');const second=prepareDataForPwaUpdate();if(!second.ok)throw Error(second.reason);
   const snapshot=JSON.stringify({release:prepared.release,expires:Date.now()+120000,context:pwaLogContext()});
   sessionStorage.setItem(RETURN_KEY,snapshot);if(sessionStorage.getItem(RETURN_KEY)!==snapshot)throw Error('storage-error');
   state.expectedRelease=prepared.release;state.phase='activating';render();
   const result=await reply(worker,'ACTIVATE_UPDATE',{token:prepared.token});if(attempt!==state.attempt)return;if(!result.ok)throw Error(result.reason);
   if(state.reloading)return;activationTimer=setTimeout(()=>finishFailure('activation-timeout'),12000);
   // Wait for controllerchange. Pinging the old worker here can race its shutdown
   // and keep Chromium's activation pending despite a verified new cache.
  }catch(error){if(attempt===state.attempt)finishFailure(error.message)}
 }
 async function onControllerChange(){
  if(state.reloading)return;
  if(!state.busy||state.phase!=='activating'){await refreshCache();return}
  try{
   const result=await reply(navigator.serviceWorker.controller,'CACHE_STATUS');
   if(!result.ok||!result.ready||result.release!==state.expectedRelease)return;
   state.reloading=true;clearTimeout(activationTimer);window.location.reload();
  }catch(error){finishFailure('worker-error')}
 }
 function restoreReturnContext(){
  try{
   const raw=sessionStorage.getItem(RETURN_KEY);if(!raw)return;const saved=JSON.parse(raw);
   if(saved.release===RELEASE&&typeof saved.expires==='number'&&saved.expires>Date.now()){
    restorePwaLogContext(saved.context);sessionStorage.removeItem(RETURN_KEY);
   }else if(saved.expires<Date.now())sessionStorage.removeItem(RETURN_KEY);
  }catch(error){state.warning='Åpne eventuelle beholdte kladder fra Plan. Ingen treningsdata er endret.'}
 }
 async function initialize(){
  const status=document.createElement('div');status.id='pwaStatus';status.className='pwa-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  document.querySelector('.top').after(status);
  const update=document.createElement('section');update.id='pwaUpdate';update.className='pwa-update';update.hidden=true;status.after(update);
  const transfer=document.createElement('section');transfer.id='pwaTransfer';transfer.className='card pwa-transfer';transfer.hidden=true;update.after(transfer);
  const settings=document.createElement('section');settings.id='pwaSettings';settings.className='card mt pwa-settings';document.getElementById('page-settings').appendChild(settings);
  const progress=document.createElement('dialog');progress.id='pwaUpdateProgress';progress.className='pwa-progress';progress.setAttribute('aria-labelledby','pwaProgressTitle');progress.innerHTML='<h2 id="pwaProgressTitle"></h2><p id="pwaProgressText"></p><button id="pwaCancelUpdate" type="button" class="btn secondary"></button>';document.body.appendChild(progress);
  const cancel=()=>{if(state.phase==='checking')finishFailure('cancelled')};document.getElementById('pwaCancelUpdate').addEventListener('click',cancel);progress.addEventListener('cancel',event=>{event.preventDefault();cancel()});
  state.installed=standalone();try{state.transfer=state.installed&&localStorage.getItem(HELP_KEY)!=='yes'}catch(error){state.transfer=state.installed}
  restoreReturnContext();rememberForms();render();probeNetwork();
  window.addEventListener('hybrid:languagechange',render);
  window.addEventListener('hybrid:storage',event=>{state.storageProblem=!event.detail.ok;render()});
  window.addEventListener('hybrid:formsaved',event=>{if(Object.hasOwn(formSelectors,event.detail.area))rememberForms(event.detail.area)});
  new MutationObserver(render).observe(document.getElementById('logSaveStatus'),{childList:true,attributes:true});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();state.prompt=event;render()});
  window.addEventListener('appinstalled',()=>{state.installed=true;state.prompt=null;render()});
  window.addEventListener('online',probeNetwork);window.addEventListener('offline',probeNetwork);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){probeNetwork();refreshCache()}});
  setInterval(()=>{if(!document.hidden)probeNetwork()},60000);
  if(!window.isSecureContext||!navigator.serviceWorker||typeof navigator.serviceWorker.register!=='function'){state.warning='Offline-støtte er ikke tilgjengelig her. Bruk HTTPS eller localhost.';render();return}
  navigator.serviceWorker.addEventListener('controllerchange',onControllerChange);
  try{
   const scope=new URL('./',document.baseURI).href,known=await navigator.serviceWorker.getRegistration(scope);
   const reused=known?.scope===scope;
   state.registration=reused?known:await navigator.serviceWorker.register(new URL('./sw.js',document.baseURI),{scope:'./',updateViaCache:'none'});
   state.waiting=state.registration.waiting;observeInstalling(state.registration.installing);
   state.registration.addEventListener('updatefound',()=>observeInstalling(state.registration.installing));
   if(!state.registration.active)await navigator.serviceWorker.ready;
   state.waiting=state.registration.waiting;await refreshCache();
   // A failed network update check must not hide an already verified offline cache.
   if(reused)state.registration.update().catch(()=>{});
   await probeNetwork();await repairOfflineFiles();
  }catch(error){state.warning='Offline-filene kunne ikke klargjøres. Åpne appen med nett og prøv igjen.';render()}
 }
 initialize().catch(error=>{const host=document.getElementById('pwaStatus');if(host)host.textContent=text('Offline-støtte kunne ikke startes. Treningsappen kan fortsatt brukes uten offline-filer.');console.warn('Hybrid PWA enhancement unavailable',error)});
})();
