import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
// Use raw HTTP because browser-compatible fetch may discard a custom Host.
const request=(url,options={})=>new Promise((resolve,reject)=>{
  const req=http.request(url,options,res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});
  req.on('error',reject);req.end(options.body);
});
import {readConfig,clientAddress,createAdmission,readProviderJSON} from './runtime-security.js';
import {createApp} from './server.js';

const production=overrides=>readConfig({NODE_ENV:'production',PUBLIC_ORIGIN:'https://sprites.example.com',...overrides});
test('production configuration fails closed and keeps local providers off',()=>{
  assert.throws(()=>readConfig({NODE_ENV:'production'}),/PUBLIC_ORIGIN/);
  for(const origin of ['http://example.com','https://example.com/path','https://user:secret@example.com','https://example.com/?key=secret'])assert.throws(()=>production({PUBLIC_ORIGIN:origin}),/PUBLIC_ORIGIN/);
  assert.equal(production().allowLocalProviders,false);assert.equal(production().allowCustomEndpoints,false);
  assert.equal(production({ALLOW_CUSTOM_ENDPOINTS:'true'}).allowCustomEndpoints,true);
  assert.equal(readConfig({}).allowLocalProviders,true);
  for(const name of ['PORT','TRUST_PROXY_HOPS','API_REQUESTS_PER_MINUTE','MAX_ACTIVE_REQUESTS'])assert.throws(()=>production({[name]:'-1'}),new RegExp(name));
});
test('proxy attribution ignores forwarded headers by default and selects from the trusted end',()=>{
  const req={socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'1.1.1.1, 8.8.8.8, 10.0.0.1'}};
  assert.equal(clientAddress(req),'127.0.0.1');assert.equal(clientAddress(req,1),'10.0.0.1');assert.equal(clientAddress(req,2),'8.8.8.8');
  req.headers['x-forwarded-for']='forged';assert.equal(clientAddress(req,1),'127.0.0.1');
});
test('admission bounds concurrency, rate and client memory with idempotent release',()=>{
  let time=0;const admit=createAdmission({rateLimit:3,maxActive:2,maxPerClient:1},{now:()=>time,maxClients:2});
  const a=admit('a');assert.throws(()=>admit('a'),e=>e.status===429);
  const b=admit('b');assert.throws(()=>admit('c'),e=>e.status===503);
  a();a();const again=admit('a');again();assert.throws(()=>admit('a'),e=>e.status===429);
  b();time=60000;admit('c')();
  const global=createAdmission({rateLimit:10,maxActive:1,maxPerClient:2});const release=global('a');
  assert.throws(()=>global('b'),e=>e.status===503);release();global('b')();
});
test('upstream JSON is bounded and rejected streams are cancelled',async()=>{
  assert.deepEqual(await readProviderJSON(Response.json({ok:true})),{ok:true});
  await assert.rejects(readProviderJSON(new Response('not JSON')),/unreadable/);
  await assert.rejects(readProviderJSON(new Response('null')),/unreadable/);
  let cancelled=false;const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(20));},cancel(){cancelled=true;}});
  await assert.rejects(readProviderJSON(new Response(body),10),/too large/);assert.equal(cancelled,true);
});
test('hosted HTTP enforces origins and provider policy while serving only public files',async t=>{
  let calls=0;const server=createApp({config:production(),fetchImpl:async()=>{calls++;return Response.json({data:[{id:'mock-model'}]});}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.shutdown({graceMs:10}));
  const base=`http://127.0.0.1:${server.address().port}`,headers={Host:'sprites.example.com',Origin:'https://sprites.example.com','Content-Type':'application/json',Authorization:'Bearer test-key'};
  const post=(body,extra={},path='/api/models')=>request(base+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  assert.equal((await request(base+'/healthz')).status,200);
  assert.equal((await request(base+'/')).status,403);
  for(const Origin of ['https://evil.example','null',''])assert.equal((await post({provider:'openai'},{Origin})).status,403);
  assert.equal((await post({provider:'openai'},{Host:'evil.example','X-Forwarded-Host':'sprites.example.com'})).status,403);
  for(const path of ['/api/models','/api/generate','/api/scene-plan'])for(const provider of ['ollama','lmstudio','custom'])assert.equal((await post({provider},{},path)).status,403);
  assert.equal(calls,0);
  assert.equal((await post(null)).status,400);
  assert.equal((await post({provider:'openai'})).status,200);assert.equal(calls,1);
  const page=await request(base+'/',{headers:{Host:'sprites.example.com'}});assert.equal(page.status,200);
  assert.match(await page.text(),/"allowLocalProviders":false,"allowCustomEndpoints":false/);
  assert.match(page.headers.get('strict-transport-security'),/max-age/);
  for(const path of ['/server.js','/runtime-security.js','/.env','/server.test.js','/package.json'])assert.equal((await request(base+path,{headers:{Host:'sprites.example.com'}})).status,404);
});
