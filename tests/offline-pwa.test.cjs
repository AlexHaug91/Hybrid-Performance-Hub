const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const manifest=JSON.parse(read('manifest.webmanifest')),workerSource=read('sw.js');
const SCOPE='https://alexhaug91.github.io/Hybrid-Performance-Hub/';
const RELEASE=workerSource.match(/const RELEASE = '([^']+)'/)[1];
const PREFIX='hybrid-shell:'+encodeURIComponent(SCOPE)+':',CURRENT=PREFIX+RELEASE;
function worker(options={}){
 const stores=options.stores||new Map(),listeners={},fetches=[],deleted=[],skips=[],closedPorts=[];
 const blocked=new Set(options.fail||[]),windows=options.windows||[{id:'one',url:SCOPE}],putFailure=options.putFailure;
 const caches={has:async n=>stores.has(n),keys:async()=>[...stores.keys()],delete:async n=>{deleted.push(n);return stores.delete(n)},open:async n=>{
  if(!stores.has(n))stores.set(n,new Map());const store=stores.get(n);
  return {match:async req=>store.get(typeof req==='string'?req:req.url)?.clone(),put:async(req,res)=>{if(putFailure)throw Error('quota');store.set(typeof req==='string'?req:req.url,res.clone())},keys:async()=>[...store.keys()].map(url=>new Request(url))};
 }};
 const context=vm.createContext({URL,Request,Response,Uint8Array,TextDecoder,AbortController,setTimeout,clearTimeout,crypto:{randomUUID:()=> 'single-use-token'},caches,fetch:async request=>{
  const url=typeof request==='string'?request:request.url;fetches.push(url);const name=new URL(url).pathname.slice(new URL(SCOPE).pathname.length);
  if(blocked.has(name))throw Error('offline');
  const bytes=fs.readFileSync(path.join(ROOT,name)),type=name.endsWith('.png')?'image/png':name.endsWith('.html')?'text/html':name.endsWith('.js')?'application/javascript':'application/manifest+json';
  const response=new Response(bytes,{headers:{'Content-Type':type}});Object.defineProperty(response,'url',{value:url});return response;
 },self:{registration:{scope:SCOPE},addEventListener:(name,fn)=>listeners[name]=fn,clients:{matchAll:async()=>windows,claim:async()=>{}},skipWaiting:async()=>{skips.push(true)}}});
 vm.runInContext(workerSource,context);
 async function lifecycle(type){let promise;listeners[type]({waitUntil:p=>promise=p});await promise}
 async function request(url,method='GET',navigate=false){let promise;const req=new Request(url,{method});if(navigate)Object.defineProperty(req,'mode',{value:'navigate'});listeners.fetch({request:req,respondWith:p=>promise=p});return promise?await promise:undefined}
 async function message(type,extra={},source=windows[0]){let promise,result;listeners.message({data:{type,...extra},source,ports:[{postMessage:r=>result=r,close:()=>closedPorts.push(type)}],waitUntil:p=>promise=p});await promise;return result}
 return {stores,caches,fetches,deleted,skips,closedPorts,lifecycle,request,message,blocked};
}
test('manifest uses installable names, standalone display and relative GitHub Pages paths',()=>{
 assert.equal(manifest.name,'Hybrid Performance Hub');assert.equal(manifest.short_name,'Hybrid');assert.equal(manifest.display,'standalone');
 for(const key of ['id','scope','start_url']){assert.equal(manifest[key],'./');assert.equal(new URL(manifest[key],SCOPE).href,SCOPE)}
 assert.equal(manifest.theme_color,'#0c111a');assert.equal(manifest.background_color,'#0b1018');
 for(const icon of manifest.icons){assert.ok(icon.src.startsWith('./icons/'));assert.ok(new URL(icon.src,SCOPE).href.startsWith(SCOPE));assert.equal(icon.type,'image/png')}
 assert.ok(manifest.icons.some(i=>i.sizes==='192x192'));assert.ok(manifest.icons.some(i=>i.sizes==='512x512'&&i.purpose==='maskable'));
});
for(const [file,size]of [['icons/icon-192.png',192],['icons/icon-512.png',512],['icons/icon-maskable-512.png',512],['icons/apple-touch-icon.png',180]])test(`${file} is an actual square PNG at the declared dimensions`,()=>{
 const buffer=fs.readFileSync(path.join(ROOT,file));assert.equal(buffer.subarray(1,4).toString(),'PNG');assert.equal(buffer.readUInt32BE(16),size);assert.equal(buffer.readUInt32BE(20),size);
});
test('shell release markers and relative manifest/script/apple links agree',()=>{
 const html=read('index.html');assert.ok(html.includes('name="hybrid-shell-release" content="'+RELEASE+'"'));assert.ok(read('pwa.js').includes("const RELEASE = '"+RELEASE+"'"));
 for(const href of ['./manifest.webmanifest','./icons/apple-touch-icon.png'])assert.ok(html.includes('href="'+href+'"'));assert.ok(html.includes('src="./pwa.js" defer'));
 assert.doesNotMatch(workerSource,/localStorage|indexedDB|caches\.clear\(/);assert.doesNotMatch(read('pwa.js'),/localStorage\.clear|indexedDB/);
});
test('initial worker caches exactly seven own app resources and never skips waiting on install',async()=>{
 const w=worker();await w.lifecycle('install');assert.equal(w.stores.get(CURRENT).size,7);assert.ok([...w.stores.get(CURRENT).keys()].every(url=>url.startsWith(SCOPE)));assert.equal(w.skips.length,0);assert.equal((await w.message('CACHE_STATUS')).ready,true);
});
test('failed resource download preserves the previous cache and foreign caches',async()=>{
 const old=new Map([['sentinel',new Response('older')]]),stores=new Map([[PREFIX+'older',old],['unrelated',new Map()]]),w=worker({stores,fail:['icons/icon-512.png']});await assert.rejects(w.lifecycle('install'));assert.equal(stores.get(PREFIX+'older'),old);assert.ok(stores.has('unrelated'));assert.ok(!stores.has(CURRENT));assert.equal(w.skips.length,0);
});
test('partial quota failure removes only the newly created resource cache',async()=>{
 const stores=new Map([[PREFIX+'older',new Map()]]),w=worker({stores,putFailure:true});await assert.rejects(w.lifecycle('install'),/quota/);assert.deepEqual([...stores.keys()],[PREFIX+'older']);assert.deepEqual(w.deleted,[CURRENT]);
});
test('the same release is never allowed to overwrite a different existing shell',async()=>{
 const cache=new Map([['sentinel',new Response('keep')]]),stores=new Map([[CURRENT,cache]]),w=worker({stores});await assert.rejects(w.lifecycle('install'),/incremented/);assert.equal(stores.get(CURRENT),cache);assert.equal(await cache.get('sentinel').text(),'keep');assert.deepEqual(w.deleted,[]);
});
test('a complete identical release can be reused without any cache writes',async()=>{
 const first=worker();await first.lifecycle('install');const second=worker({stores:first.stores,putFailure:true});await second.lifecycle('install');assert.equal((await second.message('CACHE_STATUS')).ready,true);
});
test('cache-first offline navigation and assets work without further network requests',async()=>{
 const w=worker();await w.lifecycle('install');const before=w.fetches.length;
 assert.match(await (await w.request(SCOPE,'GET',true)).text(),/Hybrid Performance Hub/);assert.match(await (await w.request(SCOPE+'pwa.js')).text(),/const RELEASE/);assert.equal(w.fetches.length,before);
});
for(const [url,method]of [[SCOPE+'export.json','GET'],[SCOPE+'manifest.webmanifest?hybrid-network=1','GET'],['https://alexhaug91.github.io/another-app/index.html','GET'],['https://example.com/file.js','GET'],[SCOPE+'manifest.webmanifest','POST']])test(`worker ignores non-app resource ${method} ${url}`,async()=>{
 const w=worker();assert.equal(await w.request(url,method),undefined);assert.equal(w.stores.size,0);assert.equal(w.fetches.length,0);
});
test('explicit update uses a one-time token and rechecks open clients',async()=>{
 const w=worker();await w.lifecycle('install');assert.equal((await w.message('ACTIVATE_UPDATE',{token:'fake'})).ok,false);assert.equal(w.skips.length,0);
 const prepared=await w.message('PREPARE_UPDATE');assert.equal(prepared.ok,true);assert.equal((await w.message('ACTIVATE_UPDATE',{token:prepared.token})).ok,true);assert.equal(w.skips.length,1);assert.equal((await w.message('ACTIVATE_UPDATE',{token:prepared.token})).ok,false);
});
test('a second Hybrid window prevents activation without affecting other apps',async()=>{
 const windows=[{id:'one',url:SCOPE},{id:'two',url:SCOPE+'index.html'}],w=worker({windows});await w.lifecycle('install');assert.equal((await w.message('PREPARE_UPDATE')).reason,'other-windows');assert.equal(w.skips.length,0);
 windows.pop();windows.push({id:'foreign',url:'https://alexhaug91.github.io/another-app/'});assert.equal((await w.message('PREPARE_UPDATE')).ok,true);
});
test('a window opened after preparation blocks the final activation',async()=>{
 const windows=[{id:'one',url:SCOPE}],w=worker({windows});await w.lifecycle('install');const prepared=await w.message('PREPARE_UPDATE');windows.push({id:'two',url:SCOPE});assert.equal((await w.message('ACTIVATE_UPDATE',{token:prepared.token})).reason,'other-windows');assert.equal(w.skips.length,0);
});
test('incomplete cache and messages from outside the app cannot activate a worker',async()=>{
 const w=worker();assert.equal((await w.message('PREPARE_UPDATE')).reason,'incomplete-cache');assert.equal(await w.message('ACTIVATE_UPDATE',{token:'anything'},{id:'other',url:'https://alexhaug91.github.io/other/'}),undefined);assert.equal(w.skips.length,0);await assert.rejects(w.lifecycle('activate'));
});
test('activation retains one verified previous release and removes only older caches in this scope',async()=>{
 const w=worker();await w.lifecycle('install');const current=w.stores.get(CURRENT);
 async function releaseCache(release){const result=new Map();for(const [url,response]of current){if(url.endsWith('index.html')||url.endsWith('pwa.js'))result.set(url,new Response((await response.clone().text()).replaceAll(RELEASE,release),{headers:response.headers}));else result.set(url,response.clone())}return result}
 const oldest=PREFIX+'oldest',previous=PREFIX+'previous',foreign='hybrid-shell:'+encodeURIComponent('https://alexhaug91.github.io/other/')+':old';
 w.stores.set(oldest,await releaseCache('oldest'));w.stores.set(previous,await releaseCache('previous'));w.stores.set(foreign,new Map());w.stores.set('another-cache',new Map());await w.lifecycle('activate');assert.ok(w.stores.has(CURRENT));assert.ok(w.stores.has(previous));assert.ok(!w.stores.has(oldest));assert.ok(w.stores.has(foreign));assert.ok(w.stores.has('another-cache'));
});
test('missing own offline files can be repaired without deleting another resource cache',async()=>{
 const w=worker();await w.lifecycle('install');w.stores.get(CURRENT).delete(SCOPE+'icons/icon-192.png');w.stores.set('foreign-cache',new Map());assert.equal((await w.message('CACHE_STATUS')).ready,false);const result=await w.message('REPAIR_CACHE');assert.equal(result.ready,true);assert.equal(w.stores.get(CURRENT).size,7);assert.ok(w.stores.has('foreign-cache'));assert.equal(w.skips.length,0);
});
test('failed repair never modifies a previous complete release',async()=>{
 const w=worker();await w.lifecycle('install');const previous=new Map(w.stores.get(CURRENT));w.stores.set(PREFIX+'previous',previous);w.stores.get(CURRENT).delete(SCOPE+'icons/icon-192.png');w.blocked.add('icons/icon-192.png');assert.equal((await w.message('REPAIR_CACHE')).ok,false);assert.equal(w.stores.get(PREFIX+'previous'),previous);assert.equal(previous.size,7);assert.equal(w.skips.length,0);
});

test('worker closes reply ports on success and rejection so old workers are not kept alive',async()=>{
 const w=worker();await w.lifecycle('install');await w.message('CACHE_STATUS');await w.message('ACTIVATE_UPDATE',{token:'invalid'});assert.deepEqual(w.closedPorts,['CACHE_STATUS','ACTIVATE_UPDATE']);
});
