import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initGeneration} from './generation-ui.js';

// Minimal form DOM for event/request tests; this does not verify visual layout.
class Field {
  value='';textContent='';hidden=false;disabled=false;checked=false;
  children=[];listeners=new Map();classes=new Set();
  classList={contains:name=>this.classes.has(name),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};
  addEventListener(type,fn){this.listeners.set(type,fn);}
  async fire(type){await this.listeners.get(type)?.({preventDefault(){},target:this});}
  setAttribute(){}
  append(...children){for(const child of children){this.children.push(child);if(!this.value)this.value=child.value;}}
  replaceChildren(){this.children=[];this.value='';}
  querySelectorAll(){return [];}
  focus(){}
  scrollIntoView(){}
  close(){}
  getContext(){return {save(){},restore(){},translate(){},scale(){},rotate(){},drawImage(){},putImageData(){}};}
}

test('generation controls explain format tradeoffs and keep thinking explicit in sprite and scene settings',async t=>{
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  const fields=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Field()]));
  const field=id=>{assert.ok(fields.has(id),`Missing real form control: ${id}`);return fields.get(id);};
  for(const [id,value] of Object.entries({'generation-mode':'template','generation-template':'chair','generation-input-mode':'image','generation-token-limit':'8000','generation-size':'32','generation-layers':'auto','generation-thinking':'disabled','endpoint-auth':'bearer'}))field(id).value=value;
  const previous={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch,ImageData:globalThis.ImageData};
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  globalThis.document={getElementById:field,createElement:()=>new Field(),createTextNode:text=>({textContent:text})};
  globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
  globalThis.window={addEventListener(){}};
  const requests=[];
  globalThis.fetch=async(path,options)=>{requests.push({path,...options,body:JSON.parse(options.body)});return Response.json({error:'Mock failure; no model called.'},{status:400});};
  const applied=[];const generator=initGeneration({onApply:value=>applied.push(value)});
  const choose=async(id,value)=>{field(id).value=value;await field(id).fire('change');};
  assert.equal(requests.length,0);assert.equal(field('generation-token-limit').value,'8000');
  await field('preview-template').fire('click');
  assert.equal(requests.length,0);assert.equal(field('generation-error').hidden,true);assert.equal(field('template-adjustments').hidden,false);
  assert.match(field('generation-status').textContent,/Free template preview ready/);
  const widthInput=field('template-parameter-fields').children[0].children[1];widthInput.value='20';await widthInput.fire('change');
  assert.match(field('generation-status').textContent,/No API call/);assert.equal(requests.length,0);
  await field('apply-generation').fire('click');assert.equal(applied.length,1);assert.equal(applied[0].recipe.templateDesign.parameters.width,20);
  await choose('generation-format','prompt');
  assert.match(field('generation-format-hint').textContent,/does not enforce/);
  await choose('generation-format','schema');
  assert.doesNotMatch(field('generation-format-hint').textContent,/does not enforce/);
  await choose('generation-provider','gemini');
  assert.equal(field('generation-model').value,'gemini-3.1-pro-preview');assert.match(field('provider-preset-hint').textContent,/preview/);
  field('generation-model').value='my-model';await field('generation-model').fire('input');assert.equal(field('provider-preset-hint').hidden,true);
  await choose('generation-provider','mistral');assert.equal(field('generation-model').value,'mistral-large-latest');
  await choose('generation-provider','deepseek');
  assert.equal(field('generation-thinking-options').hidden,false);assert.equal(generator.connection().thinking,'disabled');
  assert.match(field('generation-format-hint').textContent,/no Strict Schema option/);
  await choose('generation-input-mode','text');assert.equal(field('reference-photo-guide').hidden,true);
  field('api-key').value='mock-key';field('generation-instructions').value='A table with four separate legs.';
  await field('generation-form').fire('submit');
  assert.equal(requests.length,1);assert.equal(requests[0].body.thinking,'disabled');assert.equal(requests[0].body.maxOutputTokens,8000);
  assert.equal(requests[0].body.generationMode,'template');assert.equal(requests[0].body.templateId,'chair');assert.equal(applied.length,1);
  await choose('generation-thinking','enabled');
  assert.equal(generator.connection().thinking,'enabled');assert.match(field('generation-disclosure').textContent,/thinking is enabled/);
  await field('generation-form').fire('submit');
  assert.equal(requests.length,2);assert.equal(requests[1].body.thinking,'enabled');assert.equal(requests[1].body.maxOutputTokens,8000);
  assert.ok(!('key' in requests[1].body));assert.ok(!('image' in requests[1].body));
  await choose('generation-provider','openai');
  assert.equal(generator.connection().thinking,'disabled');assert.equal(field('generation-thinking-options').hidden,true);assert.equal(field('api-key').value,'');
  await choose('generation-provider','deepseek');assert.equal(generator.connection().thinking,'disabled');
  assert.equal(requests.length,2); // Setting changes never generate or retry.
  await choose('generation-mode','freeform');assert.equal(field('template-choice').hidden,true);assert.equal(field('preview-template').hidden,true);
  field('api-key').value='mock-key';await field('generation-form').fire('submit');
  assert.equal(requests.length,3);assert.equal(requests[2].body.generationMode,'freeform');assert.equal(requests[2].body.templateId,'');assert.equal(applied.length,1);
});
