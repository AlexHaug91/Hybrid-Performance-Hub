'use strict';
// Internal resource release only. The app's visible version and data schema do not change.
const RELEASE = 'hyrox-rounds-20261127-2';
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = 'hybrid-shell:' + encodeURIComponent(SCOPE.href) + ':';
const CACHE_NAME = CACHE_PREFIX + RELEASE;
const ASSETS = ['index.html','pwa.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png'];
const assetURLs = ASSETS.map(path => new URL(path, SCOPE).href);
const activationTokens = new Map();
function belongs(url){return url.origin===SCOPE.origin && url.pathname.startsWith(SCOPE.pathname)}
async function completeCache(name=CACHE_NAME){
 if(!(await caches.has(name)))return false;
 const cache=await caches.open(name),responses=await Promise.all(assetURLs.map(url=>cache.match(url)));
 if(responses.some(response=>!response||!response.ok))return false;
 const bodies=await Promise.all(responses.map(response=>response.arrayBuffer()));
 const decoder=new TextDecoder(),release=name.slice(CACHE_PREFIX.length),html=decoder.decode(bodies[0]),script=decoder.decode(bodies[1]);
 return html.includes('name="hybrid-shell-release" content="'+release+'"')&&script.includes("const RELEASE = '"+release+"'");
}
async function sameResources(cache,resources){
 for(let i=0;i<assetURLs.length;i++){
  const previous=await cache.match(assetURLs[i]);if(!previous)return false;
  const a=new Uint8Array(await previous.arrayBuffer()),b=new Uint8Array(resources[i].bytes);
  if(a.length!==b.length||a.some((byte,j)=>byte!==b[j]))return false;
 }
 return true;
}
async function downloadResources(){
 const resources=[];
 // Drain each response before fetching the next: leaving unread streams can exhaust
 // the browser's connection pool during installation. Nothing is committed yet.
 for(let i=0;i<assetURLs.length;i++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
  const url=assetURLs[i],response=await fetch(new Request(url,{cache:'reload',credentials:'same-origin',redirect:'error',signal:controller.signal}));
  if(!response.ok||!['basic','default'].includes(response.type)||(response.url&&response.url!==url))throw Error('Invalid app resource');
  const type=response.headers.get('content-type')||'';
  if(i===0&&!type.includes('text/html')||i===1&&!/javascript/.test(type)||i===2&&!/json/.test(type)||i>=3&&!type.includes('image/png'))throw Error('Unexpected resource type');
  resources.push({bytes:await response.arrayBuffer(),headers:response.headers});
  }finally{clearTimeout(timer)}
 }
 const decoder=new TextDecoder();
 if(!decoder.decode(resources[0].bytes).includes('name="hybrid-shell-release" content="'+RELEASE+'"')||!decoder.decode(resources[1].bytes).includes("const RELEASE = '"+RELEASE+"'"))throw Error('Mixed resource releases');
 return resources;
}
let repairing=null;
function repairIncompleteCache(){
 if(repairing)return repairing;
 repairing=(async()=>{
  if(await completeCache())return true;
  const resources=await downloadResources();
  if(await completeCache())return true;
  const cache=await caches.open(CACHE_NAME);
  for(let i=0;i<assetURLs.length;i++)await cache.put(assetURLs[i],new Response(resources[i].bytes,{status:200,headers:resources[i].headers}));
  return completeCache();
 })().finally(()=>{repairing=null});
 return repairing;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 // Fetch and validate every resource before opening a new cache. No old cache is touched.
 const resources=await downloadResources();
 if(await caches.has(CACHE_NAME)){
  const existing=await caches.open(CACHE_NAME);
  if(!await completeCache()||!await sameResources(existing,resources))throw Error('Resource release must be incremented');
  return;
 }
 try{
  const cache=await caches.open(CACHE_NAME);
  // Sequential writes keep cleanup from racing an unfinished put on quota failure.
  for(let i=0;i<assetURLs.length;i++)await cache.put(assetURLs[i],new Response(resources[i].bytes,{status:200,headers:resources[i].headers}));
  if(!await completeCache())throw Error('Incomplete app cache');
 }catch(error){await caches.delete(CACHE_NAME).catch(()=>{});throw error}
 // Deliberately no skipWaiting here. Updates require an explicit checked message.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 if(!await completeCache())throw Error('Cannot activate an incomplete cache');
 const owned=(await caches.keys()).filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME);
 let previous=null;
 for(const name of [...owned].reverse())if(await completeCache(name)){previous=name;break}
 // Keep one verified previous release; never delete caches outside this exact app scope.
 for(const name of owned)if(name!==previous)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||!belongs(url)||url.search)return;
 const navigation=request.mode==='navigate'&&(url.pathname===SCOPE.pathname||url.href===assetURLs[0]);
 if(!navigation&&!assetURLs.includes(url.href))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE_NAME),cached=await cache.match(navigation?assetURLs[0]:url.href);
  if(cached)return cached;
  // No runtime cache writes: exports, user data, other apps and third parties are never cached.
  try{return await fetch(request)}catch(error){return new Response('Hybrid is not available offline yet. Open it online to prepare offline files.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})}
 })());
});
async function onlyRequestingClient(source){
 if(!source?.id||!belongs(new URL(source.url)))return false;
 const windows=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(client=>belongs(new URL(client.url)));
 return windows.length===1&&windows[0].id===source.id;
}
self.addEventListener('message',event=>{
 const message=event.data,port=event.ports?.[0];if(!port||!message||!event.source?.url||!belongs(new URL(event.source.url)))return;
 const respond=value=>{port.postMessage(value);port.close()};
 const task=(async()=>{
  try{
   if(message.type==='REPAIR_CACHE'){respond({ok:true,release:RELEASE,ready:await repairIncompleteCache()});return}
   if(message.type==='CACHE_STATUS'){respond({ok:true,release:RELEASE,ready:await completeCache()});return}
   if(message.type==='PREPARE_UPDATE'){
    if(!await onlyRequestingClient(event.source)){respond({ok:false,reason:'other-windows'});return}
    if(!await completeCache()){respond({ok:false,reason:'incomplete-cache'});return}
    const token=crypto.randomUUID();activationTokens.clear();activationTokens.set(event.source.id,{token,expires:Date.now()+30000});
    respond({ok:true,token,release:RELEASE});return;
   }
   if(message.type==='ACTIVATE_UPDATE'){
    const pending=activationTokens.get(event.source.id);activationTokens.delete(event.source.id);
    if(!pending||pending.token!==message.token||pending.expires<Date.now()){respond({ok:false,reason:'not-authorized'});return}
    if(!await onlyRequestingClient(event.source)){respond({ok:false,reason:'other-windows'});return}
    if(!await completeCache()){respond({ok:false,reason:'incomplete-cache'});return}
    respond({ok:true,release:RELEASE});
    // Do not await activation inside the message that authorizes it.
    self.skipWaiting().catch(error=>console.warn('Hybrid activation failed',error));return;
   }
   respond({ok:false,reason:'unknown-message'});
  }catch(error){respond({ok:false,reason:'worker-error'})}
 })();
 event.waitUntil(task);
});
