import test from 'node:test';
import assert from 'node:assert/strict';
import {initEnvironment} from './environment.js';
import {createScene,sceneTransform,worldToScreen} from './scene.js';
import {SPRITE_DRAG_TYPE,beginSpriteDrag,hasSpriteDrag,takeSpriteDrop,endSpriteDrag,bindSpriteDropTab} from './sprite-transfer.js';

class Transfer {
  values=new Map();get types(){return [...this.values.keys()];}
  setData(type,value){this.values.set(type,value);}
  getData(type){return this.values.get(type)||'';}
}
class Element {
  value='';textContent='';hidden=false;dataset={};children=[];listeners=new Map();attributes=new Map();classes=new Set();
  classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)};
  constructor(register=()=>{}){this.register=register;this.previousElementSibling={textContent:''};}
  set innerHTML(html){for(const [,id] of html.matchAll(/id="([^"]+)"/g))this.register(id);}
  setAttribute(name,value){this.attributes.set(name,value);}
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  async fire(type,extra={}){const event={target:this,detail:1,preventDefault(){this.defaultPrevented=true;},...extra};for(const fn of this.listeners.get(type)||[])await fn(event);return event;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(selector==='.env-asset'&&child.className==='env-asset'?[child]:[]),...child.querySelectorAll(selector)]);}
  focus(){}setPointerCapture(){}
  getBoundingClientRect(){return {left:30,top:50,width:480,height:300};}
  getContext(){return {save(){},restore(){},translate(){},scale(){},rotate(){},drawImage(){},putImageData(){}};}
}

test('library double-click opens without placement; library and Studio drops honor rotated, scaled canvas coordinates',async t=>{
  const old={document:globalThis.document,window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame};
  t.after(()=>{endSpriteDrag();for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const elements=new Map();const add=id=>{const e=new Element(add);elements.set(id,e);return e;};
  const get=id=>{assert.ok(elements.has(id),`Missing element ${id}`);return elements.get(id);};
  add('environment-panel');add('generation-dialog');
  globalThis.document={getElementById:get,createElement:()=>new Element(add),body:new Element(add),addEventListener(){}};
  globalThis.window={addEventListener(){}};globalThis.requestAnimationFrame=()=>{};
  const image={width:32,height:8},src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
  let studio={image,asset:{name:'Rectangular stack',src,width:16,height:8,frames:2,spacing:2,radius:3}};
  const opened=[],messages=[];
  const environment=initEnvironment({getStudioSprite:()=>studio,openStudioSprite:sprite=>opened.push(sprite),toast:message=>messages.push(message),generator:{connection:()=>({provider:'openai',model:'test'}),open(){}}});
  const canvas=get('env-canvas');canvas.width=960;canvas.height=600;
  environment.addStudio();assert.equal(get('env-object-count').textContent,'1 objects');
  const entry=get('env-library').children[0],card=entry.children[0],assetId=card.dataset.assetId;
  await card.fire('click',{detail:1});await card.fire('click',{detail:2});await card.fire('dblclick');
  assert.equal(opened.length,1);assert.equal(get('env-object-count').textContent,'1 objects');
  assert.equal(opened[0].asset.spacing,2);assert.equal(opened[0].asset.height,8);assert.equal(opened[0].image,image);
  await card.fire('click',{detail:0});assert.equal(opened.length,2);assert.equal(get('env-object-count').textContent,'1 objects');
  get('env-camera').value='67';await get('env-camera').fire('change');
  const scene=createScene();scene.cameraRotation=67;scene.assets=[{...studio.asset,id:assetId}];scene.objects=[{id:'test',assetId,x:480,y:252,rotation:0,scale:2,solid:false}];
  const client=(x,y)=>{const p=worldToScreen(scene,sceneTransform(scene,960,600),x,y);return {clientX:30+p.x/2,clientY:50+p.y/2};};
  const transfer=new Transfer();await card.fire('dragstart',{dataTransfer:transfer});
  assert.equal((await canvas.fire('dragover',{dataTransfer:transfer})).defaultPrevented,true);
  await canvas.fire('drop',{dataTransfer:transfer,...client(230,180)});
  assert.equal(get('env-object-count').textContent,'2 objects');assert.equal(get('env-x').value,230);assert.equal(get('env-y').value,180);
  await canvas.fire('dblclick',client(230,180));assert.equal(opened.length,3);assert.equal(get('env-object-count').textContent,'2 objects');
  const studioTransfer=new Transfer();beginSpriteDrag({dataTransfer:studioTransfer},{kind:'studio',sprite:studio});
  await canvas.fire('drop',{dataTransfer:studioTransfer,...client(620,330)});
  assert.equal(get('env-object-count').textContent,'3 objects');assert.equal(get('env-asset-count').textContent,'(1)');assert.equal(get('env-x').value,620);assert.equal(get('env-y').value,330);
  // Explicit placement is still available without drag/double-click timing.
  await entry.children[1].fire('click');assert.equal(get('env-object-count').textContent,'4 objects');
  // Same PNG interpreted with different frame dimensions is a separate asset.
  studio={image,asset:{...studio.asset,width:32,frames:1}};environment.addStudio();assert.equal(get('env-asset-count').textContent,'(2)');
  const before=get('env-object-count').textContent;
  const foreign=new Transfer();foreign.setData(SPRITE_DRAG_TYPE,'foreign-token');await canvas.fire('drop',{dataTransfer:foreign,...client(100,100)});assert.equal(get('env-object-count').textContent,before);
  await get('env-play').fire('click');const playingTransfer=new Transfer();beginSpriteDrag({dataTransfer:playingTransfer},{kind:'studio',sprite:studio});
  await canvas.fire('drop',{dataTransfer:playingTransfer,...client(100,100)});assert.equal(get('env-object-count').textContent,before);assert.match(messages.at(-1),/Stop play mode/);
});

test('drag sessions reject foreign/stale drops, and tab hover switches without placing until drop',async t=>{
  t.after(endSpriteDrag);t.mock.timers.enable({apis:['setTimeout']});
  const tab=new Element(),transfer=new Transfer(),event={dataTransfer:transfer};let switched=0;const placed=[];
  const cancel=bindSpriteDropTab(tab,()=>switched++,payload=>placed.push(payload));
  const payload={kind:'studio',sprite:{asset:{name:'Snapshot'}}};beginSpriteDrag(event,payload);
  await tab.fire('dragover',event);t.mock.timers.tick(350);assert.equal(switched,1);assert.equal(placed.length,0);
  await tab.fire('drop',event);assert.equal(switched,2);assert.deepEqual(placed,[payload]);assert.equal(takeSpriteDrop(event),null);
  beginSpriteDrag(event,payload);await tab.fire('dragover',event);await tab.fire('dragleave');t.mock.timers.tick(350);assert.equal(switched,2);
  endSpriteDrag();assert.equal(hasSpriteDrag(event),false);await tab.fire('drop',event);assert.equal(placed.length,1);
  beginSpriteDrag(event,payload);const foreign=new Transfer();foreign.setData(SPRITE_DRAG_TYPE,'wrong');assert.equal(takeSpriteDrop({dataTransfer:foreign}),null);
  cancel();endSpriteDrag();
});
