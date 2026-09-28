import {getProvider} from './provider-catalog.js';
import {validatePlan,validatePlanRequest} from './scene-generation.js';
import {validateRecipe,inspectRecipe} from './generation.js';
import {createScene,drawScene} from './scene.js';
import {isTemplate} from './sprite-templates.js';
const $=id=>document.getElementById(id);

export function sceneAssetSettings(asset,tokens,world){
  const template=asset.template??'freeform';
  if(template!=='freeform'&&!isTemplate(template))throw new Error('Unknown scene asset template.');
  return {inputMode:'text',size:32,layers:'auto',maxOutputTokens:tokens,generationMode:template==='freeform'?'freeform':'template',templateId:template==='freeform'?'':template,instructions:`Create one standalone sprite for a ${world.width}×${world.height} 2D sprite-stack world. ${asset.description} Keep the object's orientation and dimensions described here. Vehicle front points toward negative y. Transparent background. ${template==='freeform'?'A horizontal cross-section at each height, never a repeated side-view picture.':'Customize the selected template using its bounded parameters.'}`};
}

export async function generatePlanAssets({plan,generated,signal,requestAsset,makeAsset,onProgress=()=>{}}){
  for(const a of plan.assets){
    if(generated.has(a.id))continue;if(signal.aborted)return false;
    const recipe=await requestAsset(a);if(signal.aborted)return false;
    const result=makeAsset(recipe,`ai-${a.id}`);result.asset.name=a.name;result.warnings=inspectRecipe(recipe).warnings;
    generated.set(a.id,result);onProgress();
  }
  return true;
}

export function sceneFromPlan(plan,generated){
  const scene=createScene();Object.assign(scene,{name:plan.name,width:plan.width,height:plan.height,background:plan.background,ground:plan.ground.map(g=>({...g}))});scene.controller.mode=plan.controller;
  scene.assets=[...generated.values()].map(g=>g.asset);
  scene.objects=plan.objects.flatMap((o,i)=>generated.has(o.assetId)?[{id:`placed-${i}`,assetId:generated.get(o.assetId).asset.id,x:o.x,y:o.y,rotation:o.rotation,scale:o.scale,solid:o.solid}]:[]);
  const player=plan.objects.findIndex(o=>o.player);scene.playerId=generated.has(plan.objects[player]?.assetId)?`placed-${player}`:null;
  return scene;
}
export function initSceneAI({generator,getScene,makeAsset,install,toast}){
  const dialog=document.createElement('dialog');dialog.id='scene-ai-dialog';dialog.setAttribute('aria-labelledby','scene-ai-title');
  dialog.innerHTML=`<button id="scene-ai-close" class="icon-button close-dialog" aria-label="Close scene generation">×</button><span class="eyebrow">DESCRIBE → PLAN → GENERATE → PLAY</span><h2 id="scene-ai-title">Describe your world</h2><p class="field-hint">A layout request, then one request per unique sprite. Repeated placements reuse the same PNG.</p>
    <div class="env-actions"><button id="scene-connection" class="button">Configure model connection</button><span id="scene-connection-label" class="field-hint"></span></div>
    <fieldset id="scene-ai-settings"><label class="field-label" for="scene-description">Scene description</label><textarea id="scene-description" maxlength="2000" rows="4" placeholder="Let me control a red car on a road, with trees along the sides and small houses nearby."></textarea>
    <label class="field-label" for="scene-asset-mode">Sprite construction</label><select id="scene-asset-mode"><option value="mixed">Templates where supported · freeform for other objects</option><option value="templates">Templates only · chair, table, car, tree</option><option value="freeform">Freeform for every sprite</option></select><p class="field-hint">Review the construction label on each planned asset before generating. Templates constrain structure; freeform can represent other objects but is less predictable. One request per unique sprite, with no extra classification call or automatic fallback.</p>
    <div class="scene-budget-fields"><div><label class="field-label" for="scene-max-assets">Max unique sprites</label><input id="scene-max-assets" type="number" min="1" max="8" value="4"></div><div><label class="field-label" for="scene-max-objects">Max placements</label><input id="scene-max-objects" type="number" min="1" max="120" value="60"></div><div><label class="field-label" for="scene-asset-tokens">Output tokens / sprite</label><input id="scene-asset-tokens" type="number" min="2000" max="14000" step="1000" value="4000"></div></div><p class="field-hint" id="scene-world-size"></p></fieldset>
    <p class="field-hint">Templates return compact settings. Complex freeform objects may need a larger token cap. Raising this limit can increase the cost of every unique sprite; repeated placements reuse an asset.</p>
    <p class="generation-disclosure" id="scene-disclosure"></p><div class="env-actions"><button id="scene-plan" class="button primary">Generate layout plan</button><button id="scene-cancel" class="button" hidden>Cancel</button></div>
    <p id="scene-status" role="status" aria-live="polite"></p><p id="scene-usage" class="field-hint"></p><p id="scene-error" class="generation-error" role="alert" hidden></p>
    <section id="scene-review" hidden><h3 id="scene-plan-name"></h3><p id="scene-plan-notes" class="field-hint"></p><ul id="scene-asset-list"></ul><canvas id="scene-plan-preview" width="720" height="400" aria-label="Preview of the proposed ground layout and generated sprites"></canvas><p class="field-hint">Sprites appear here as their generation completes. Review the complete scene before applying.</p><p id="scene-next-cost" class="field-hint"></p><div class="env-actions"><button id="scene-generate" class="button primary">Generate missing sprites</button><button id="scene-apply" class="button" disabled>Use this environment</button></div><p class="field-hint">Use this environment replaces the current layout. Restore previous environment brings it back. Cancel or a failed request keeps completed sprites here; retrying generates only missing ones.</p></section>`;
  document.body.append(dialog);
  let plan=null,generated=new Map(),controller=null,usage=0,expected=null,spriteTokens=4000;
  function connection(){const c=generator.connection(),p=getProvider(c.provider);if(!p.local&&!c.key)throw new Error('Configure your model connection and enter its API key first.');return c;}
  function disclosure(){const c=generator.connection(),p=getProvider(c.provider);$('scene-connection-label').textContent=`${p.name} · ${c.model}${c.thinking==='enabled'?' · thinking on':''}`;const s=getScene();$('scene-world-size').textContent=`World: ${s.width} × ${s.height} px. Change dimensions in the environment sidebar before planning.`;$('scene-disclosure').textContent=`Requests send written descriptions to ${p.name} at ${p.id==='custom'?(c.endpoint||'your custom endpoint'):p.endpoint}. No photo or existing project is sent. Plan: one request, up to 8,000 output tokens. Sprite requests use the separate limit above.${c.thinking==='enabled'?' DeepSeek thinking is enabled for the plan and every sprite, sharing each request’s output limit.':''} Input and reasoning tokens may also be billed. No automatic retries. These limits are not dollar spending caps.`;}
  function busy(value){$('scene-ai-settings').disabled=value;for(const id of ['scene-plan','scene-connection','scene-generate'])$(id).disabled=value;$('scene-cancel').hidden=!value;$('scene-apply').disabled=value||!plan||generated.size!==plan.assets.length;}
  function error(message){$('scene-error').textContent=message;$('scene-error').hidden=false;}
  async function request(path,body,c,signal){
    const {key,...settings}=c,timer=setTimeout(()=>controller?.abort('timeout'),190000);
    try{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({...settings,...body}),signal});let data;try{data=await response.json();}catch{throw new Error('The app server returned an unreadable response.');}
      if(data.usage){usage+=data.usage.totalTokens;$('scene-usage').textContent=`Reported scene requests this session: ${usage.toLocaleString()} tokens. Canceled requests may incur additional unreported charges.`;}
      if(!response.ok)throw new Error(data.error||'Generation failed.');return data;
    }finally{clearTimeout(timer);}
  }
  function review(){
    $('scene-review').hidden=false;$('scene-plan-name').textContent=plan.name;$('scene-plan-notes').textContent=`${plan.notes} · ${plan.objects.length} placements, ${plan.assets.length} unique sprites.`;
    $('scene-asset-list').replaceChildren();
    for(const a of plan.assets){const li=document.createElement('li'),strong=document.createElement('strong');strong.textContent=`${generated.has(a.id)?'✓':'○'} ${a.name} · ${isTemplate(a.template)?`${a.template} template`:'Freeform'}`;const desc=document.createElement('p');desc.textContent=a.description;li.append(strong,desc);const result=generated.get(a.id);if(result?.warnings.length){const warning=document.createElement('p');warning.className='scene-asset-warning';warning.textContent=result.warnings.join(' ');li.append(warning);}$('scene-asset-list').append(li);}
    const remaining=plan.assets.length-generated.size;$('scene-next-cost').textContent=remaining?`Next action: ${remaining} sequential sprite request${remaining===1?'':'s'}, each capped at ${spriteTokens.toLocaleString()} output tokens (${(remaining*spriteTokens).toLocaleString()} combined output-token ceiling). Reused placements cost no additional requests.`:'All sprites are ready. Applying, editing, playing, and exporting use no API tokens.';
    $('scene-generate').textContent=`Generate ${remaining} missing sprite${remaining===1?'':'s'}`;$('scene-generate').disabled=Boolean(controller)||remaining===0;$('scene-apply').disabled=Boolean(controller)||remaining!==0;
    const canvas=$('scene-plan-preview');drawScene(canvas.getContext('2d'),sceneFromPlan(plan,generated),new Map([...generated.values()].map(g=>[g.asset.id,g.image])));
  }
  async function run(work){if(controller)return;$('scene-error').hidden=true;const active=new AbortController();controller=active;busy(true);try{await work(active.signal);}catch(e){if(active.signal.aborted){$('scene-status').textContent=active.signal.reason==='timeout'?'Request timed out. Completed sprites are kept.':'Stopped. Completed sprites are kept.';error('Cancellation requests an abort; the provider may still process or bill the current request.');}else{error(e.message);$('scene-status').textContent='Stopped. No automatic retry was made.';}}finally{controller=null;busy(false);if(plan)review();}}
  $('env-ai').addEventListener('click',()=>{disclosure();dialog.showModal();});
  $('scene-connection').addEventListener('click',()=>generator.open(true));$('generation-dialog').addEventListener('close',()=>{if(dialog.open)disclosure();});
  $('scene-asset-mode').addEventListener('change',()=>{if(plan)$('scene-status').textContent='Construction setting applies to the next layout plan. This reviewed plan keeps its labeled asset types.';});
  $('scene-asset-tokens').addEventListener('change',()=>{const value=Number($('scene-asset-tokens').value);if(Number.isInteger(value)&&value>=2000&&value<=14000){spriteTokens=value;if(plan)review();}});
  $('scene-ai-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>controller?.abort());$('scene-cancel').addEventListener('click',()=>controller?.abort());window.addEventListener('pagehide',()=>controller?.abort());
  $('scene-plan').addEventListener('click',()=>run(async signal=>{
    const c=connection(),world=getScene(),body={description:$('scene-description').value.trim(),width:world.width,height:world.height,maxAssets:Number($('scene-max-assets').value),maxObjects:Number($('scene-max-objects').value),assetMode:$('scene-asset-mode').value};
    const tokens=Number($('scene-asset-tokens').value);if(!Number.isInteger(tokens)||tokens<2000||tokens>14000)throw new Error('Sprite output limit must be 2,000–14,000 tokens.');
    const settings=validatePlanRequest({...c,...body});$('scene-status').textContent='Designing the layout. No sprite requests have started.';
    const data=await request('/api/scene-plan',body,c,signal);if(signal.aborted)return;
    const next=validatePlan(data.plan,settings);plan=next;expected=settings;spriteTokens=tokens;generated=new Map();$('scene-status').textContent='Plan ready. Review the assets and request count below.';review();
  }));
  $('scene-generate').addEventListener('click',()=>run(async signal=>{
    if(!plan)return;const c=connection();
    const limit=Number($('scene-asset-tokens').value);if(!Number.isInteger(limit)||limit<2000||limit>14000)throw new Error('Sprite output limit must be 2,000–14,000 tokens.');spriteTokens=limit;
    const complete=await generatePlanAssets({plan,generated,signal,makeAsset,onProgress:review,requestAsset:async a=>{
      $('scene-status').textContent=`Generating ${a.name} (${generated.size+1}/${plan.assets.length})…`;
      const settings=sceneAssetSettings(a,spriteTokens,expected);
      const data=await request('/api/generate',settings,c,signal);
      return validateRecipe(data.recipe,{...settings,recipeVersion:2});
    }});
    if(complete)$('scene-status').textContent='Scene assembled. Review the preview, then use this environment.';
  }));
  $('scene-apply').addEventListener('click',async()=>{if(controller||!plan||generated.size!==plan.assets.length)return;try{await install(sceneFromPlan(plan,generated),new Map([...generated.values()].map(g=>[g.asset.id,g.image])));dialog.close();toast('Generated environment loaded. Select the player and press Play.');}catch(e){error(e.message);}});
}
