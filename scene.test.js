import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createScene,validateScene,sceneData,sceneTransform,worldToScreen,screenToWorld,movePlayer,sortedObjects,pickObject} from './scene.js';
import {zipFiles,crc32,exportScene} from './scene-export.js';
import {validatePlanRequest,validatePlan,planContract,parsePlan} from './scene-generation.js';
import {buildProviderRequest,buildValidatedProviderRequest,parseProviderResponse} from './providers.js';
import {PROVIDERS} from './provider-catalog.js';
import {sceneFromPlan,generatePlanAssets,sceneAssetSettings} from './scene-ai.js';
import {SAMPLE_RECIPES} from './sample-recipes.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
function fixture(){const scene=createScene();scene.assets=[{id:'car',name:'Car',width:1,height:1,frames:1,spacing:1,radius:8,src:png}];scene.objects=[{id:'player',assetId:'car',x:100,y:100,rotation:0,scale:1,solid:false}];scene.playerId='player';return scene;}
const planInput={provider:'openai',description:'Let me drive a red car on a road with trees.',width:960,height:504,maxAssets:2,maxObjects:20};
function planFixture(){return {name:'Drive',notes:'A car on a road.',width:960,height:504,background:'#667755',controller:'drive',assets:[{id:'car',name:'Red car',description:'An upright red compact car with four black wheels, a long narrow footprint, and front toward negative y.'}],objects:[{assetId:'car',x:100,y:250,rotation:90,scale:2,solid:false,player:true}],ground:[{x:0,y:200,width:960,height:100,color:'#454545'}]};}

test('scene projection and picking remain correct after rotating the environment',()=>{
  const scene=fixture();scene.cameraRotation=45;const t=sceneTransform(scene,960,600),p=worldToScreen(scene,t,100,100),w=screenToWorld(scene,t,p.x,p.y);
  assert.ok(Math.abs(w.x-100)<1e-9&&Math.abs(w.y-100)<1e-9);assert.equal(pickObject(scene,t,p.x,p.y).id,'player');
  scene.objects.push({...scene.objects[0],id:'other',x:400,y:80});scene.cameraRotation=90;assert.deepEqual(sortedObjects(scene).map(o=>o.id),['player','other']);
});
test('WASD and arrows share eased normalized speed; Q/E orbit without moving or turning an idle player',()=>{
  const a=fixture(),b=fixture();movePlayer(a,new Set(['KeyW']),.05);movePlayer(b,new Set(['ArrowUp','ArrowRight']),.05);
  const distance=120*(1-Math.exp(-.5))*.05;
  assert.ok(Math.abs(a.objects[0].y-(100-distance))<1e-9);assert.ok(Math.abs(Math.hypot(b.objects[0].x-100,b.objects[0].y-100)-distance)<1e-9);
  const y=a.objects[0].y;movePlayer(a,new Set(['KeyE']),.05);assert.ok(Math.abs(a.cameraRotation-114.6*.05)<1e-9);assert.equal(a.objects[0].rotation,0);assert.equal(a.objects[0].y,y);
});
test('walking and vehicle movement both stay camera-relative instead of following the old heading',()=>{
  const distance=120*(1-Math.exp(-.5))*.05;
  const a=fixture();a.cameraRotation=90;movePlayer(a,new Set(['KeyW']),.05);assert.ok(Math.abs(a.objects[0].x-(100-distance))<1e-9);
  const b=fixture();b.controller.mode='drive';b.objects[0].rotation=90;movePlayer(b,new Set(['KeyW']),.05);assert.equal(b.objects[0].x,100);assert.ok(Math.abs(b.objects[0].y-(100-distance))<1e-9);assert.ok(b.objects[0].rotation<90);
});
test('movement respects world edges and solid props, while allowing escape from overlapping spawns',()=>{
  const scene=fixture();scene.objects[0].x=8;movePlayer(scene,new Set(['KeyA']),1);assert.equal(scene.objects[0].x,8);
  scene.objects[0].x=100;scene.objects.push({...scene.objects[0],id:'wall',x:118,solid:true});movePlayer(scene,new Set(['KeyD']),.05);assert.ok(scene.objects[0].x<=102);
  scene.objects[0].x=115;movePlayer(scene,new Set(['KeyA']),.05);assert.ok(scene.objects[0].x<115);
});
test('scene validation rejects unsafe image URLs, dangling IDs, NaN, duplicates, and oversized projects',()=>{
  assert.equal(validateScene(fixture()).width,960);
  const changes=[s=>s.assets[0].src='https://example.com/tracker.png',s=>s.playerId='missing',s=>s.objects[0].x=NaN,s=>s.objects.push({...s.objects[0]}),s=>s.assets[0].frames=900,s=>s.ground.push({x:950,y:0,width:100,height:20,color:'#888888'})];
  for(const change of changes){const s=fixture();change(s);assert.throws(()=>validateScene(s));}
  const s=fixture();s.apiKey='secret';s.assets[0].token='also-secret';assert.ok(!JSON.stringify(sceneData(s)).includes('secret'));
});
test('scene plans enforce the approved asset and placement budget and one valid player',()=>{
  const input=validatePlanRequest(planInput),plan=planFixture();assert.equal(validatePlan(plan,input),plan);assert.equal(input.inputMode,'text');assert.equal(input.maxOutputTokens,8000);
  for(const change of [p=>p.objects[0].player=false,p=>p.objects[0].assetId='unknown',p=>p.width=4096,p=>p.assets.push({...p.assets[0]}),p=>p.ground[0].width=1200]){const p=planFixture();change(p);assert.throws(()=>validatePlan(p,input));}
  assert.throws(()=>validatePlan({...plan,objects:Array.from({length:21},()=>plan.objects[0])},input));
  assert.throws(()=>validatePlanRequest({...planInput,maxAssets:9}));assert.throws(()=>parsePlan('not JSON',input));
});
test('scene plans declare template/freeform construction and enforce the selected asset policy',()=>{
  for(const mode of ['mixed','templates']){
    const input=validatePlanRequest({...planInput,assetMode:mode}),plan=planFixture();plan.assets[0].template='car';
    assert.equal(validatePlan(plan,input),plan);
    assert.deepEqual(planContract(input).schema.properties.assets.items.properties.template.enum,mode==='mixed'?['chair','table','car','tree','freeform']:['chair','table','car','tree']);
    const settings=sceneAssetSettings(plan.assets[0],4000,input);assert.equal(settings.generationMode,'template');assert.equal(settings.templateId,'car');assert.equal(settings.maxOutputTokens,4000);
    for(const template of [undefined,'unknown'])assert.throws(()=>validatePlan({...plan,assets:[{...plan.assets[0],template}]},input),/construction/);
    plan.assets[0].template='freeform';
    if(mode==='templates')assert.throws(()=>validatePlan(plan,input),/construction/);else{validatePlan(plan,input);assert.equal(sceneAssetSettings(plan.assets[0],4000,input).generationMode,'freeform');}
  }
  assert.throws(()=>validatePlanRequest({...planInput,assetMode:'unknown'}));
  assert.throws(()=>sceneAssetSettings({template:'unknown'},4000,planInput));
});
test('scene plans accept CRLF and LF fences and still validate the enclosed plan',()=>{
  const input=validatePlanRequest(planInput),plan=planFixture();
  for(const newline of ['\n','\r\n']){
    const wrap=value=>`\`\`\`json${newline}${JSON.stringify(value,null,2).replaceAll('\n',newline)}${newline}\`\`\``;
    assert.deepEqual(parsePlan(wrap(plan),input),plan);
    assert.throws(()=>parsePlan(wrap({...plan,width:42}),input),/world settings/);
    assert.throws(()=>parsePlan(`Here is the plan:\n${wrap(plan)}`,input),/unreadable scene plan/);
  }
});
test('scene planning preserves optional DeepSeek thinking with its fixed 8,000-token cap',()=>{
  const input=validatePlanRequest({...planInput,provider:'deepseek',thinking:'enabled',maxOutputTokens:14000});
  const request=buildValidatedProviderRequest(input,'key',planContract(input));
  assert.equal(input.thinking,'enabled');assert.equal(request.body.max_tokens,8000);
  assert.deepEqual(request.body.thinking,{type:'enabled'});
  assert.doesNotMatch(JSON.stringify(request.body),/L-shaped table|input_image|image_url/);
});
test('every provider can request a scene contract rather than a sprite recipe without sending an image',()=>{
  for(const p of PROVIDERS){const input=validatePlanRequest({...planInput,provider:p.id,model:p.model||'vendor/scene-model',endpoint:p.id==='custom'?'https://models.example.com/v1/chat/completions':''}),request=buildProviderRequest(input,p.local?'':'key',planContract(input)),body=JSON.stringify(request.body);
    assert.ok(body.includes('assetId'),p.id);assert.ok(!body.includes('image_url'),p.id);assert.ok(!body.includes('contour recipe'),p.id);
  }
  const input=validatePlanRequest(planInput),plan=planFixture();assert.deepEqual(parseProviderResponse({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]},input,parsePlan),plan);
});
test('assembling a plan reuses a single sprite asset across placements and preserves the player',()=>{
  const plan=planFixture();plan.objects.push({...plan.objects[0],x:300,player:false});const generated=new Map([['car',{asset:fixture().assets[0]}]]);
  const scene=sceneFromPlan(plan,generated);assert.equal(scene.assets.length,1);assert.equal(scene.objects.length,2);assert.equal(scene.playerId,'placed-0');validateScene(scene);
  assert.equal(sceneFromPlan(plan,new Map()).playerId,null);
});
test('a failed asset batch keeps completed sprites and retries only missing assets on explicit restart',async()=>{
  const plan={assets:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}]},generated=new Map(),signal=new AbortController().signal,calls=[];
  const makeAsset=(recipe,id)=>({asset:{id},image:{}});
  await assert.rejects(generatePlanAssets({plan,generated,signal,makeAsset,requestAsset:async asset=>{calls.push(asset.id);if(asset.id==='b')throw new Error('failed');return SAMPLE_RECIPES.vase;}}));
  assert.deepEqual(calls,['a','b']);assert.deepEqual([...generated.keys()],['a']);
  await generatePlanAssets({plan,generated,signal,makeAsset,requestAsset:async asset=>{calls.push(asset.id);return SAMPLE_RECIPES.vase;}});
  assert.deepEqual(calls,['a','b','b','c']);assert.equal(generated.size,3);
});
test('cancellation prevents subsequent asset requests and discards a late result',async()=>{
  const controller=new AbortController(),generated=new Map();let calls=0;
  const complete=await generatePlanAssets({plan:{assets:[{id:'a',name:'A'},{id:'b',name:'B'}]},generated,signal:controller.signal,makeAsset:()=>assert.fail('must not apply canceled output'),requestAsset:async()=>{calls++;controller.abort();return SAMPLE_RECIPES.vase;}});
  assert.equal(complete,false);assert.equal(calls,1);assert.equal(generated.size,0);
});
function unzipStored(bytes){const files=new Map();let offset=0;const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);while(data.getUint32(offset,true)===0x04034b50){const length=data.getUint32(offset+18,true),nameLength=data.getUint16(offset+26,true),extra=data.getUint16(offset+28,true),name=new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength)),start=offset+30+nameLength+extra,body=bytes.subarray(start,start+length);assert.equal(crc32(body),data.getUint32(offset+14,true));files.set(name,body);offset=start+length;}assert.equal(data.getUint32(offset,true),0x02014b50);assert.equal(data.getUint32(bytes.length-22,true),0x06054b50);return files;}
for(const multiline of [false,true])test(`ZIP export boots and rotates with ${multiline?'multiline CRLF':'single-line'} imports and no API credentials`,async()=>{
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  assert.throws(()=>zipFiles([{name:'../bad',data:'x'}]));
  const scene=fixture();scene.apiKey='DO-NOT-EXPORT';
  const zip=await exportScene(scene,async path=>{
    const source=await readFile(new URL(`.${path}`,import.meta.url),'utf8');
    return multiline?source.replace("import {drawStack,getFrameRects,projectedBounds} from './stack.js';","import {\n  drawStack,\n  getFrameRects,\n  projectedBounds,\n} from './stack.js';").replaceAll('\n','\r\n'):source;
  });
  const files=unzipStored(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual([...files.keys()].sort(),['stacked-scene/README.txt','stacked-scene/assets/sprite-0.png','stacked-scene/game.js','stacked-scene/index.html','stacked-scene/scene-data.js']);
  const code=new TextDecoder().decode(files.get('stacked-scene/game.js')),data=new TextDecoder().decode(files.get('stacked-scene/scene-data.js'));
  assert.ok(!data.includes('DO-NOT-EXPORT'));assert.ok(!code.includes('/api/'));assert.doesNotMatch(code,/^import |^export /m);new vm.Script(code);
  // Exercise the exported bootstrap as a classic script with local-image loading.
  const elements=new Map(),events=new Map();let scheduled=0,nextFrame;
  const context={clearRect(){},fillRect(){},save(){},restore(){},translate(){},scale(){},rotate(){},drawImage(){}};
  const sandbox={window:{addEventListener(){}},document:{getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',addEventListener(type,fn){events.set(`${id}:${type}`,fn);},getContext(){context.canvas=this;return context;},focus(){}});return elements.get(id);},addEventListener(){}},Image:class{set src(value){assert.equal(value,'assets/sprite-0.png');queueMicrotask(()=>this.onload());}},requestAnimationFrame(fn){scheduled++;nextFrame=fn;},structuredClone,console};
  vm.runInNewContext(data,sandbox);vm.runInNewContext(code,sandbox);await new Promise(resolve=>setImmediate(resolve));assert.equal(scheduled,1);assert.ok(elements.get('status').textContent.includes('WASD'));
  nextFrame(1000);events.get('game:keydown')({code:'KeyQ',preventDefault(){}});nextFrame(1050);
  assert.ok(sandbox.window.STACKED_SCENE.cameraRotation<0);assert.equal(sandbox.window.STACKED_SCENE.objects[0].rotation,0);
  elements.get('reset').onclick();assert.equal(sandbox.window.STACKED_SCENE.cameraRotation,0);nextFrame(1100);assert.equal(sandbox.window.STACKED_SCENE.cameraRotation,0);
});
test('export rejects unsupported imports and exports before producing a broken archive',async()=>{
  for(const declaration of ["import {drawStack} from './other.js';","import {missing} from './stack.js';","import {drawStack as alias} from './stack.js';","import stack from './stack.js';","export {drawStack};"]){
    await assert.rejects(exportScene(fixture(),async path=>{
      const source=await readFile(new URL(`.${path}`,import.meta.url),'utf8');
      return path==='/scene.js'?`${declaration}\n${source}`:source;
    }),/Unsupported export runtime module syntax/);
  }
});
