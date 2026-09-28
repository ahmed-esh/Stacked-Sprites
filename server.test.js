import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from './server.js';
import {MAX_REFERENCE_BYTES,MAX_REQUEST_BODY_BYTES} from './generation.js';
import {templateDefaults} from './sprite-templates.js';
import {sceneAssetSettings,generatePlanAssets} from './scene-ai.js';

const recipe={version:2,name:'Tapered column',notes:'Test fixture; no provider called.',size:16,layers:16,parts:[{name:'Column',shape:'ellipse',operation:'paint',color:'#BC9876',sections:[{z:0,points:[{x:4,y:4},{x:12,y:12}]},{z:15,points:[{x:1,y:1},{x:15,y:15}]}]}]};
const input={image:'data:image/png;base64,YWJj',size:16,layers:16,model:'gpt-4.1'};
const auth={'Content-Type':'application/json','Authorization':'Bearer test-user-supplied-key'};
async function app(t,fetchImpl,options={}) {
  const server=createApp({fetchImpl,...options});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return `http://127.0.0.1:${server.address().port}`;
}
test('HTTP limits admit the maximum image with metadata and reject excess bodies before forwarding',async t=>{
  let calls=0;
  const base=await app(t,async()=>{calls++;return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(recipe)}]}]});});
  const send=body=>fetch(`${base}/api/generate`,{method:'POST',headers:auth,body});
  const body=JSON.stringify({...input,image:`data:image/png;base64,${Buffer.alloc(MAX_REFERENCE_BYTES).toString('base64')}`,instructions:'\u0000'.repeat(2000)});
  assert.equal((await send(body)).status,200);assert.equal(calls,1);
  const tooLarge=await send(JSON.stringify({...input,image:`data:image/png;base64,${Buffer.alloc(MAX_REFERENCE_BYTES+1).toString('base64')}`}));
  assert.equal(tooLarge.status,400);assert.match((await tooLarge.json()).error,/up to 4 MB/);assert.equal(calls,1);
  const padded=JSON.stringify(input).padEnd(MAX_REQUEST_BODY_BYTES,' ');
  assert.equal((await send(padded)).status,200);assert.equal(calls,2);
  const overflow=await send(padded+' ');assert.equal(overflow.status,413);assert.match((await overflow.json()).error,/request is too large/);assert.equal(calls,2);
});
test('generation forwards a user key only to fixed provider and returns validated slices',async t=>{
  let calls=0;
  const base=await app(t,async(url,options)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,auth.Authorization);
    assert.equal(JSON.parse(options.body).store,false);assert.equal(options.redirect,'error');
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(recipe)}]}]});
  });
  const response=await fetch(`${base}/api/generate`,{method:'POST',headers:{...auth,Origin:base},body:JSON.stringify(input)});
  assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.recipe,recipe);assert.equal(calls,1);assert.ok(!JSON.stringify(data).includes('test-user-supplied-key'));
});
test('template API compiles settings without extra calls and rejects bad settings without fallback',async t=>{
  const design={version:1,template:'chair',name:'Blue chair',notes:'Mock template settings.',parameters:{...templateDefaults('chair'),accentColor:'#335599'}};
  let calls=0,reply=design;
  const base=await app(t,async(url,options)=>{
    calls++;const body=JSON.parse(options.body);assert.equal(body.text.format.name,'sprite_template');assert.equal(body.max_output_tokens,2000);assert.ok(body.text.format.schema.properties.parameters);assert.ok(!body.text.format.schema.properties.parts);
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(reply)}]}],usage:{input_tokens:100,output_tokens:120}});
  });
  const settings={...input,size:32,layers:'auto',generationMode:'template',templateId:'chair',maxOutputTokens:2000};
  const send=body=>fetch(`${base}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify(body)});
  let response=await send(settings);assert.equal(response.status,200);let data=await response.json();assert.equal(data.recipe.version,2);assert.equal(data.recipe.templateDesign.parameters.accentColor,'#335599');assert.equal(data.recipe.layers,43);assert.equal(calls,1);
  for(const bad of [{...design,parameters:{...design.parameters,width:100}},recipe,{...design,template:'car'}]){
    reply=bad;response=await send(settings);assert.equal(response.status,502);data=await response.json();assert.equal(data.usage.totalTokens,220);
  }
  assert.equal(calls,4);
  assert.equal((await send({...settings,templateId:'animal'})).status,400);assert.equal(calls,4);
  assert.equal((await fetch(`${base}/sprite-templates.js`)).status,200);
});
test('DeepSeek thinking is forwarded once without raising caps or returning private reasoning',async t=>{
  let calls=0;
  const base=await app(t,async(url,options)=>{
    calls++;const body=JSON.parse(options.body);
    assert.equal(url,'https://api.deepseek.com/chat/completions');assert.deepEqual(body.thinking,{type:'enabled'});assert.equal(body.max_tokens,4000);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(recipe),reasoning_content:'PRIVATE-REASONING'}}],usage:{prompt_tokens:100,completion_tokens:300,completion_tokens_details:{reasoning_tokens:200}}});
  });
  const body={...input,provider:'deepseek',model:'deepseek-flash',thinking:'enabled',maxOutputTokens:4000};
  const response=await fetch(`${base}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify(body)});
  assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.recipe,recipe);assert.equal(data.usage.totalTokens,400);assert.equal(data.usage.reasoningTokens,200);assert.doesNotMatch(JSON.stringify(data),/PRIVATE-REASONING/);assert.equal(calls,1);
  const invalid=await fetch(`${base}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify({...body,thinking:'unlimited'})});
  assert.equal(invalid.status,400);assert.equal(calls,1);
});
test('missing keys, cross-origin requests, invalid settings, and nonpublic files are blocked before provider calls',async t=>{
  const base=await app(t,()=>{assert.fail('must not call provider');});
  assert.equal((await fetch(`${base}/api/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,401);
  assert.equal((await fetch(`${base}/api/generate`,{method:'POST',headers:{...auth,Origin:'https://unrelated.example'},body:JSON.stringify(input)})).status,403);
  assert.equal((await fetch(`${base}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify({...input,layers:9000})})).status,400);
  for(const path of ['/server.js','/.env','/package.json'])assert.equal((await fetch(base+path)).status,404);
  const page=await fetch(base);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);assert.match(await page.text(),/generation-dialog/);
});
test('provider errors are sanitized and invalid recipes are rejected',async t=>{
  const base=await app(t,async()=>Response.json({error:{message:'secret-reflected-key'}},{status:401}));
  const response=await fetch(`${base}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify(input)});
  assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/secret-reflected-key/);
  const broken=await app(t,async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...recipe,layers:24})}]}]}));
  assert.equal((await fetch(`${broken}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify(input)})).status,502);
});
test('timeout aborts upstream without automatically retrying a billed request',async t=>{
  let calls=0,aborted=false;
  const base=await app(t,async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});});},{timeoutMs:30});
  const response=await fetch(`${base}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify(input)});
  assert.equal(response.status,504);assert.equal(calls,1);assert.equal(aborted,true);
});
test('client cancellation aborts the provider request',async t=>{
  let started;const ready=new Promise(resolve=>started=resolve);let finish;
  const done=new Promise(resolve=>finish=resolve);
  const base=await app(t,async(url,{signal})=>{started();return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{finish();reject(new Error('aborted'));},{once:true});});});
  const controller=new AbortController();
  const response=fetch(`${base}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify(input),signal:controller.signal});
  await ready;controller.abort();await assert.rejects(response);await done;
});

test('native provider HTTP path uses its own credential header and preserves reported usage',async t=>{
  const base=await app(t,async(url,options)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(options.headers['x-api-key'],'test-user-supplied-key');assert.equal(options.headers.Authorization,undefined);
    return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(recipe)}],usage:{input_tokens:100,output_tokens:200}});
  });
  const response=await fetch(`${base}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify({...input,provider:'anthropic',model:'claude-sonnet-4-6'})});
  const data=await response.json();assert.equal(response.status,200);assert.equal(data.provider,'anthropic');assert.equal(data.usage.totalTokens,300);
});
test('model catalog fetch is metadata only and preserves modality labels',async t=>{
  const base=await app(t,async(url,options)=>{
    assert.equal(url,'https://openrouter.ai/api/v1/models');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    return Response.json({data:[{id:'vendor/vision',architecture:{input_modalities:['text','image']}},{id:'vendor/text',architecture:{input_modalities:['text']}}]});
  });
  const response=await fetch(`${base}/api/models`,{method:'POST',headers:auth,body:JSON.stringify({provider:'openrouter'})});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.models.find(m=>m.id==='vendor/vision').vision,true);assert.equal(data.models.find(m=>m.id==='vendor/text').vision,false);
});
test('local model generation permits an empty key and omits authorization',async t=>{
  const base=await app(t,async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:11434/v1/chat/completions');assert.equal(options.headers.Authorization,undefined);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(recipe)}}]});
  });
  const response=await fetch(`${base}/api/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,provider:'ollama',model:'local-model'})});
  assert.equal(response.status,200);
});
test('invalid generated slices still report token usage to the user',async t=>{
  const base=await app(t,async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:'invalid json'}]}],usage:{input_tokens:100,output_tokens:250}}));
  const response=await fetch(`${base}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify(input)});
  assert.equal(response.status,502);assert.equal((await response.json()).usage.totalTokens,350);
});
test('concurrent generations with the same provider key are blocked then released',async t=>{
  let started,release,calls=0;const ready=new Promise(resolve=>started=resolve);
  const base=await app(t,async()=>{
    calls++;if(calls===1){started();await new Promise(resolve=>release=resolve);}
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(recipe)}]}]});
  });
  const request=()=>fetch(`${base}/api/generate`,{method:'POST',headers:auth,body:JSON.stringify(input)});
  const first=request();await ready;assert.equal((await request()).status,429);assert.equal(calls,1);
  release();assert.equal((await first).status,200);assert.equal((await request()).status,200);assert.equal(calls,2);
});

test('scene planning shares provider authentication and validates plan budgets before any asset calls',async t=>{
  const plan={name:'Car park',notes:'A playable car.',width:960,height:504,background:'#556655',controller:'drive',assets:[{id:'car',name:'Car',description:'A red compact car with four wheels, a narrow rectangular footprint, and front toward negative y.'}],objects:[{assetId:'car',x:480,y:250,rotation:0,scale:2,solid:false,player:true}],ground:[]};
  let calls=0;const base=await app(t,async(url,options)=>{
    calls++;const body=JSON.parse(options.body);assert.equal(options.headers.Authorization,auth.Authorization);assert.equal(body.text.format.name,'scene_plan');assert.ok(body.text.format.schema.properties.assets);assert.equal(body.max_output_tokens,8000);assert.equal(body.input[0].content.length,1);
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}],usage:{input_tokens:500,output_tokens:300}});
  });
  const body={description:'Let me drive a car in an open park.',width:960,height:504,maxAssets:2,maxObjects:30};
  const response=await fetch(`${base}/api/scene-plan`,{method:'POST',headers:auth,body:JSON.stringify(body)});assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.plan,plan);assert.equal(data.usage.totalTokens,800);assert.equal(calls,1);
  assert.equal((await fetch(`${base}/api/scene-plan`,{method:'POST',headers:auth,body:JSON.stringify({...body,maxAssets:99})})).status,400);assert.equal(calls,1);
  for(const path of ['/environment.js','/environment.css','/scene.js','/scene-ai.js','/scene-generation.js','/scene-export.js','/sprite-transfer.js'])assert.equal((await fetch(base+path)).status,200,path);
});

test('mixed scene generation uses one planning call and one customization per unique template asset',async t=>{
  const design={version:1,template:'car',name:'Red car',notes:'Mock bounded car.',parameters:templateDefaults('car')};
  const plan={name:'Car park',notes:'Two copies of one car.',width:960,height:504,background:'#556655',controller:'drive',assets:[{id:'car',template:'car',name:'Car',description:'A red compact car with four wheels, a narrow rectangular footprint, and front toward negative y.'}],objects:[{assetId:'car',x:300,y:250,rotation:0,scale:2,solid:false,player:true},{assetId:'car',x:600,y:250,rotation:90,scale:2,solid:false,player:false}],ground:[]};
  const calls=[];const base=await app(t,async(url,options)=>{
    const body=JSON.parse(options.body),name=body.text.format.name;calls.push(name);
    if(name==='scene_plan')assert.deepEqual(body.text.format.schema.properties.assets.items.properties.template.enum,['chair','table','car','tree','freeform']);
    else{assert.equal(name,'sprite_template');assert.equal(body.max_output_tokens,2000);}
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(name==='scene_plan'?plan:design)}]}]});
  });
  const send=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:auth,body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
  const {plan:reviewed}=await send('/api/scene-plan',{description:'Let me drive one of two red cars in an open park.',width:960,height:504,maxAssets:2,maxObjects:20,assetMode:'mixed'});
  assert.deepEqual(calls,['scene_plan']);
  const generated=new Map(),run=()=>generatePlanAssets({plan:reviewed,generated,signal:new AbortController().signal,requestAsset:async asset=>(await send('/api/generate',sceneAssetSettings(asset,2000,reviewed))).recipe,makeAsset:(recipe,id)=>{assert.equal(recipe.templateDesign.template,'car');return {asset:{id},recipe};}});
  assert.equal(await run(),true);assert.equal(await run(),true);
  assert.deepEqual(calls,['scene_plan','sprite_template']);assert.equal(generated.size,1);assert.equal(reviewed.objects.length,2);
});
