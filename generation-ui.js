import {rasterizeRecipe, validateRecipe, inspectRecipe} from './generation.js';
import {drawStack, getFrameRects} from './stack.js';
import {PROVIDERS,getProvider,availableFormats} from './provider-catalog.js';
import {TEMPLATES,templateDefaults,compileTemplate} from './sprite-templates.js';

const $ = id => document.getElementById(id);
export function initGeneration({onApply}) {
  let reference=null, result=null, sheet=null, controller=null, modelsController=null, referenceVersion=0;
  let knownModels=[],reportedSessionTokens=0,resultAttribution='';
  const dialog=$('generation-dialog');
  const showError=message=>{$('generation-error').textContent=message;$('generation-error').hidden=false;};
  const resetResult=()=>{result=null;sheet=null;$('generation-result').hidden=true;};
  const provider=()=>getProvider($('generation-provider').value);
  const clearKey=()=>{$('api-key').value='';$('api-key').type='password';$('toggle-key').textContent='Show';$('toggle-key').setAttribute('aria-label','Show API key');};
  const setBusy=busy=>{$('generation-settings').querySelectorAll('input:not(#api-key),select,textarea').forEach(input=>input.disabled=busy);$('generation-settings').setAttribute('aria-busy',String(busy));$('load-models').disabled=busy||!provider().modelsURL;$('preview-template').disabled=busy;$('template-adjustments').disabled=busy;};
  let deployment={};try{deployment=JSON.parse($('deployment-config').textContent);}catch{}
  const enabledProviders=PROVIDERS.filter(p=>(!p.local||deployment.allowLocalProviders===true)&&(p.id!=='custom'||deployment.allowCustomEndpoints===true));
  for(const p of enabledProviders){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;$('generation-provider').append(option);}
  const thinking=()=>provider().id==='deepseek'?$('generation-thinking').value:'disabled';
  function updateConstruction(){
    const template=$('generation-mode').value==='template',id=$('generation-template').value;
    $('template-choice').hidden=!template;$('preview-template').hidden=!template;
    $('generation-mode-hint').textContent=template?`${TEMPLATES[id].description} The model chooses bounded settings, not raw geometry. Preview and adjust the template free, or Generate slices to customize it from your input. Unsupported shapes need Freeform.`:'Freeform asks the model to invent all contours. It supports other objects but is less predictable. No automatic fallback or extra request is made.';
    $('generation-token-hint').textContent=template?'Template settings are compact: 2,000–4,000 output tokens is a starting cap to try. Thinking may consume part of it. Previewing and adjusting locally costs no tokens; the selected cap is never raised automatically.':'Complex freeform animals or furniture may benefit from 12,000–14,000 output tokens for more parts and sections. Higher limits can increase cost. The selected cap is never raised automatically.';
  }
  function updateQualityGuidance(){
    const p=provider(),format=$('generation-format').value,hint=$('generation-format-hint');
    hint.textContent=format==='schema'?'Strict Schema constrains the recipe format when supported by the selected model. Proportions and resemblance still need visual review.':availableFormats(p).includes('schema')?'This mode does not enforce the recipe schema. Prefer Strict Schema when your model supports it; otherwise keep this compatibility mode. Every result is still validated locally.':`${p.name} has no Strict Schema option in this connector. JSON mode constrains JSON syntax, while Prompt only relies on instructions. Every recipe is validated locally.`;
    hint.classList.toggle('quality-caution',format!=='schema');
    $('generation-thinking-options').hidden=p.id!=='deepseek';
    const note=$('generation-model').value.trim()===p.model?p.modelNote:'';
    $('provider-preset-hint').textContent=note||'';$('provider-preset-hint').hidden=!note;
  }
  function updateDisclosure(){
    const p=provider(),textOnly=$('generation-input-mode').value==='text';
    const destination=p.id==='custom'?($('generation-endpoint').value.trim()||'the endpoint you enter'):p.endpoint;
    $('generation-disclosure').textContent=`Generate sends ${textOnly?'your written description (no photo)':'the reference and your art direction'} to ${p.name} at ${destination} through this app’s server. ${$('generation-mode').value==='template'?`One request customizes the ${$('generation-template').value} template; the slices are built locally.`:'One request designs freeform contours.'} ${p.local?'Local compute is used; this app does not charge API fees.':'Your API account may be billed for each request.'}${thinking()==='enabled'?' DeepSeek thinking is enabled and shares the output-token limit with the recipe.':''} There are no automatic retries. Cancel requests an abort; processing or billing may continue after cancellation.`;
    $('input-mode-hint').textContent=textOnly?'No photo is sent. Describe the object, proportions, parts, and colors. This supports text-only models.':'The selected reference is sent to the model. It must support images.';
    $('instructions-label').textContent=textOnly?'Object description':'Art direction';$('instructions-required').textContent=textOnly?'required':'optional';
    $('generation-instructions').required=textOnly;$('generation-instructions').minLength=textOnly?10:0;
    $('reference-photo-guide').hidden=textOnly;updateQualityGuidance();
  }
  function changeProvider(){
    modelsController?.abort();knownModels=[];clearKey();$('generation-thinking').value='disabled';
    const p=provider();$('generation-model').value=p.model;$('provider-model-list').hidden=true;$('provider-model-list').replaceChildren();
    $('custom-endpoint-fields').hidden=p.id!=='custom';$('generation-endpoint').required=p.id==='custom';
    if(p.id!=='custom')$('generation-endpoint').value='';
    $('api-key-label').textContent=`${p.name} key${p.local?' (optional)':''}`;$('api-key').required=!p.local;
    $('key-hint').textContent=p.local?'Uses your local runtime. Leave the key blank unless your runtime requires one.':'Sent through this app’s server to your provider; kept in memory only. Switching providers or endpoints clears this key.';
    $('model-hint').textContent=p.local?'Start the local server and load an installed model. Photo input requires a vision model.':'Load your provider’s catalog or enter a model ID. Presets are starting points, not quality benchmarks.';
    $('provider-docs').href=p.docs;$('generation-format').replaceChildren();
    const names={schema:'Strict schema',json:'JSON mode',prompt:'Prompt only'};
    for(const format of availableFormats(p)){const option=document.createElement('option');option.value=format;option.textContent=names[format];$('generation-format').append(option);}
    $('generation-format').value=p.format;$('load-models').disabled=!p.modelsURL;
    $('generation-error').hidden=true;$('generation-status').textContent='Provider changed. Enter its key and choose a model.';updateDisclosure();
  }
  function recordUsage(usage){
    $('generation-usage').hidden=false;
    if(!usage){$('generation-usage').textContent='The provider did not report token usage. Check its billing dashboard for charges.';return;}
    reportedSessionTokens+=usage.totalTokens;
    $('generation-usage').textContent=`Last request: ${usage.inputTokens.toLocaleString()} input + ${usage.outputTokens.toLocaleString()} output tokens${usage.reasoningTokens?` (${usage.reasoningTokens.toLocaleString()} reasoning tokens included)`:''}. Reported this session: ${reportedSessionTokens.toLocaleString()} tokens. Canceled requests may incur additional unreported usage. Token limits are not dollar spending limits.`;
  }
  $('generation-provider').addEventListener('change',changeProvider);
  for(const id of ['generation-endpoint','endpoint-auth'])$(id).addEventListener('input',()=>{clearKey();updateDisclosure();});
  $('generation-input-mode').addEventListener('change',updateDisclosure);
  $('generation-format').addEventListener('change',updateQualityGuidance);
  $('generation-model').addEventListener('input',updateQualityGuidance);
  $('generation-thinking').addEventListener('change',updateDisclosure);
  for(const id of ['generation-mode','generation-template'])$(id).addEventListener('change',()=>{updateConstruction();updateDisclosure();});
  $('provider-model-list').addEventListener('change',()=>{
    const model=knownModels.find(m=>m.id===$('provider-model-list').value);if(!model)return;
    $('generation-model').value=model.id;
    if(model.vision===false){$('generation-input-mode').value='text';updateDisclosure();}
    $('model-hint').textContent=model.vision===true?'Provider metadata reports image input support. Slice quality still needs review.':model.vision===false?'Provider metadata reports no image support. Description-only mode selected.':'The catalog does not declare image support. Check provider documentation before using a photo.';
    updateQualityGuidance();
  });
  $('load-models').addEventListener('click',async()=>{
    if(modelsController||controller)return;
    const p=provider(),key=$('api-key').value.trim();
    if(!p.local&&!key){showError('Enter this provider’s API key to load its catalog.');return;}
    const active=new AbortController();modelsController=active;$('load-models').disabled=true;
    const timer=setTimeout(()=>active.abort(),20000);
    $('generation-status').textContent='Loading available model IDs…';$('generation-error').hidden=true;
    try{
      const response=await fetch('/api/models',{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({provider:p.id}),signal:active.signal});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load models.');if(active.signal.aborted||provider().id!==p.id)return;
      knownModels=data.models;$('provider-model-list').replaceChildren();
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose an available model…';$('provider-model-list').append(placeholder);
      for(const model of knownModels){const option=document.createElement('option');option.value=model.id;option.textContent=`${model.id} · ${model.vision===true?'vision':model.vision===false?'text only':'capabilities unlisted'}`;$('provider-model-list').append(option);}
      $('provider-model-list').hidden=false;$('generation-status').textContent=`Loaded ${knownModels.length} models${data.hasMore?' (first page; other IDs can be typed)':''}. No generation request was made.`;
    }catch(error){if(!active.signal.aborted){showError(error.message);$('generation-status').textContent='Catalog unavailable. You can enter a model ID manually.';}else if(provider().id===p.id&&!controller){$('generation-status').textContent='Model lookup stopped. Retry or enter a model ID manually.';}}
    finally{clearTimeout(timer);if(modelsController===active)modelsController=null;$('load-models').disabled=Boolean(controller)||Boolean(modelsController)||!provider().modelsURL;}
  });
  function setReference(image,name) {
    referenceVersion++;
    const scale=Math.min(1,1024/Math.max(image.width,image.height));
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*scale));c.height=Math.max(1,Math.round(image.height*scale));
    c.getContext('2d').drawImage(image,0,0,c.width,c.height);
    reference={image:c.toDataURL('image/png'),name};
    $('reference-preview').src=reference.image;$('reference-preview').hidden=false;$('reference-empty').hidden=true;$('reference-name').textContent=name;
    resetResult();$('generation-error').hidden=true;$('generation-status').textContent='Reference ready. Add your key to generate.';
  }
  function open(connectionOnly=false) {
    const settings=connectionOnly===true;
    dialog.classList.toggle('connection-only',settings);
    $('generation-title').textContent=settings?'Model connection':'Give your photo a new dimension.';
    $('connection-done').hidden=!settings;
    if(!dialog.open)dialog.showModal();
  }
  $('connection-done').addEventListener('click',()=>dialog.close());
  function cancel() {controller?.abort();modelsController?.abort();}
  for(const id of ['open-generation','generate-source'])$(id).addEventListener('click',open);
  $('close-generation').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',cancel);
  $('cancel-generation').addEventListener('click',cancel);
  $('clear-key').addEventListener('click',clearKey);
  $('toggle-key').addEventListener('click',()=>{const show=$('api-key').type==='password';$('api-key').type=show?'text':'password';$('toggle-key').textContent=show?'Hide':'Show';$('toggle-key').setAttribute('aria-label',`${show?'Hide':'Show'} API key`);});
  window.addEventListener('pagehide',()=>{$('api-key').value='';cancel();});
  $('reference-input').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    const version=++referenceVersion;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024){showError('Choose a PNG, JPG or WebP smaller than 20 MB.');event.target.value='';return;}
    const url=URL.createObjectURL(file);
    try{const image=new Image();image.src=url;await image.decode();if(version!==referenceVersion)return;if(image.width>16384||image.height>16384||image.width*image.height>32*1024*1024)throw new Error('Image exceeds 16,384 px per side or 32 megapixels.');setReference(image,file.name);}
    catch{showError('Could not load this reference. Use an image under 16,384 px per side and 32 megapixels.');}
    finally{URL.revokeObjectURL(url);event.target.value='';}
  });
  function renderReview(recipe) {
      const raster=rasterizeRecipe(recipe,{shadeHeight:$('shade-generated').checked});
      const nextSheet=document.createElement('canvas');nextSheet.width=raster.width;nextSheet.height=raster.height;nextSheet.getContext('2d').putImageData(new ImageData(raster.pixels,raster.width,raster.height),0,0);
      result=recipe;sheet=nextSheet;
      $('result-name').textContent=recipe.name;$('result-notes').textContent=`${recipe.notes}\n${resultAttribution}`;$('result-dimensions').textContent=`${recipe.layers} × ${recipe.size}px slices`;
      const inspection=inspectRecipe(recipe,raster);
      $('result-checks').replaceChildren();
      for(const warning of inspection.warnings){const item=document.createElement('li');item.textContent=warning;$('result-checks').append(item);}
      $('result-checks').hidden=!inspection.warnings.length;
      $('result-check-status').textContent=inspection.warnings.length?'Check these possible geometry issues before applying:':'No empty layers, disconnected pixel groups, identical silhouettes, or edge-touching pixels found. Resemblance still needs visual review.';
      $('result-views').replaceChildren();
      const frames=getFrameRects(sheet.width,sheet.height,recipe.size);
      const scale=Math.max(1,Math.floor(Math.min(224/Math.hypot(recipe.size,recipe.size),224/(Math.hypot(recipe.size,recipe.size)+recipe.layers-1))));
      for(const rotation of [0,45,135,225]){
        const figure=document.createElement('figure'),c=document.createElement('canvas'),caption=document.createElement('figcaption');
        c.width=256;c.height=256;c.className='checkerboard';c.setAttribute('role','img');c.setAttribute('aria-label',`Generated stack rotated ${rotation} degrees`);
        drawStack(c.getContext('2d'),sheet,frames,{x:128,y:128+(recipe.layers-1)*scale/2,scale,rotation});
        caption.textContent=`${rotation}°`;figure.append(c,caption);$('result-views').append(figure);
      }
      $('result-slices').replaceChildren();
      for(let i=0;i<recipe.layers;i++){
        const card=document.createElement('div');card.className='result-slice';const c=document.createElement('canvas');c.width=recipe.size;c.height=recipe.size;c.className='checkerboard';
        c.getContext('2d').drawImage(sheet,i*recipe.size,0,recipe.size,recipe.size,0,0,recipe.size,recipe.size);card.append(c,document.createTextNode(String(i+1).padStart(2,'0')));$('result-slices').append(card);
      }
  }
  function templateControls(recipe){
    const design=recipe.templateDesign,container=$('template-parameter-fields');container.replaceChildren();
    $('template-adjustments').hidden=!design;if(!design)return;
    for(const [key,spec] of Object.entries(TEMPLATES[design.template].parameters)){
      const label=document.createElement('label'),text=document.createElement('span'),input=document.createElement(spec.enum?'select':'input');
      text.textContent=spec.label;label.append(text,input);
      if(spec.enum)for(const value of spec.enum){const option=document.createElement('option');option.value=value;option.textContent=value;input.append(option);}
      else input.type=spec.type==='boolean'?'checkbox':spec.type==='integer'?'number':'color';
      if(spec.type==='integer'){input.min=spec.minimum;input.max=spec.maximum;input.step=1;}
      input.value=design.parameters[key];input.checked=design.parameters[key]===true;
      if(key==='height'&&recipe.templateSettings.layers!=='auto'){input.disabled=true;input.title='Fixed layer count overrides height. Choose Auto and generate or preview again to change it.';}
      input.addEventListener('change',()=>{
        if(controller)return;
        try{
          const next=structuredClone(result.templateDesign);next.parameters[key]=spec.type==='boolean'?input.checked:spec.type==='integer'?Number(input.value):input.value;
          const compiled=validateRecipe(compileTemplate(next,result.templateSettings));
          renderReview(compiled);$('generation-error').hidden=true;$('generation-status').textContent='Template adjusted locally. No API call or token charge.';
        }catch(error){showError(error.message);input.value=result.templateDesign.parameters[key];input.checked=result.templateDesign.parameters[key]===true;}
      });
      container.append(label);
    }
  }
  $('preview-template').addEventListener('click',()=>{
    if(controller)return;
    try{
      const id=$('generation-template').value,choice=$('generation-layers').value;
      const recipe=validateRecipe(compileTemplate({version:1,template:id,name:TEMPLATES[id].name,notes:'Local template defaults, not AI output.',parameters:templateDefaults(id)},{size:Number($('generation-size').value),layers:choice==='auto'?'auto':Number(choice)}));
      resultAttribution='Local template preview · no model call. Parameter changes stay local.';
      renderReview(recipe);templateControls(recipe);$('generation-result').hidden=false;$('generation-error').hidden=true;
      $('generation-status').textContent='Free template preview ready. Adjust below or use this stack.';
      $('generation-result').scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(error){showError(error.message);}
  });
  $('shade-generated').addEventListener('change',()=>{if(result)renderReview(result);});
  $('generation-form').addEventListener('submit',async event=>{
    event.preventDefault();if(controller||dialog.classList.contains('connection-only'))return;
    $('generation-error').hidden=true;
    const inputMode=$('generation-input-mode').value,p=provider();
    if(inputMode==='image'&&!reference){showError('Choose a reference photo first.');$('reference-input').focus();return;}
    const key=$('api-key').value.trim();if(!p.local&&!key){showError(`Enter your ${p.name} API key.`);$('api-key').focus();return;}
    const model=$('generation-model').value.trim();
    if(inputMode==='image'&&knownModels.find(m=>m.id===model)?.vision===false){showError('This model is text-only. Choose Description only or a vision model.');return;}
    modelsController?.abort();
    $('generation-usage').hidden=true;
    const layerChoice=$('generation-layers').value;
    const request={...(inputMode==='image'?{image:reference.image}:{}),provider:p.id,model,inputMode,generationMode:$('generation-mode').value,templateId:$('generation-mode').value==='template'?$('generation-template').value:'',thinking:thinking(),maxOutputTokens:Number($('generation-token-limit').value),outputFormat:$('generation-format').value,endpoint:p.id==='custom'?$('generation-endpoint').value.trim():'',authType:$('endpoint-auth').value,size:Number($('generation-size').value),layers:layerChoice==='auto'?'auto':Number(layerChoice),instructions:$('generation-instructions').value.trim()};
    controller=new AbortController();const active=controller;const version=referenceVersion;
    setBusy(true);$('generate-button').disabled=true;$('cancel-generation').hidden=false;$('apply-generation').disabled=true;
    const started=Date.now();
    const updateStatus=()=>{$('generation-status').textContent=`Designing slices… ${Math.floor((Date.now()-started)/1000)}s. Usually takes a minute or two.`;};
    updateStatus();const clock=setInterval(updateStatus,1000);
    const timeout=setTimeout(()=>active.abort('timeout'),190000);
    try {
      const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Authorization':`Bearer ${key}`}:{})},body:JSON.stringify(request),signal:active.signal,cache:'no-store'});
      let data;try{data=await response.json();}catch{throw new Error('The generation server is unavailable. Start this project with npm start (Node.js 22+).');}
      if(data.usage||response.ok)recordUsage(data.usage);
      if(!response.ok)throw new Error(data.error || 'Generation failed. Please try again.');
      if(version!==referenceVersion||active.signal.aborted)return;
      const recipe=validateRecipe(data.recipe,request);
      resultAttribution=`${request.generationMode==='template'?`Customized ${request.templateId} template`:'Freeform contours'} with ${p.name} / ${request.model}.`;
      renderReview(recipe);templateControls(recipe);
      $('generation-result').hidden=false;$('generation-status').textContent='Slices ready. Review them below.';$('generate-button').textContent='✳ Generate another version';
      $('generation-result').scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(error){
      if(active.signal.aborted){$('generation-status').textContent=active.signal.reason==='timeout'?'Request timed out. You can retry.':'Generation cancelled.';recordUsage(null);}
      else{showError(error.message || 'Generation failed.');$('generation-status').textContent=result?'Previous result kept. Adjust settings and retry.':'Adjust your settings and try again.';}
    }finally{clearInterval(clock);clearTimeout(timeout);controller=null;setBusy(false);$('generate-button').disabled=false;$('cancel-generation').hidden=true;$('apply-generation').disabled=false;}
  });
  $('apply-generation').addEventListener('click',()=>{if(!result||controller)return;onApply({sheet,recipe:result});dialog.close();});
  $('download-recipe').addEventListener('click',()=>{
    if(!result)return;const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='sprite-slices.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  });
  changeProvider();updateConstruction();
  return {setReference,open,connection(){const p=provider();return {provider:p.id,model:$('generation-model').value.trim(),key:$('api-key').value.trim(),outputFormat:$('generation-format').value,thinking:thinking(),endpoint:p.id==='custom'?$('generation-endpoint').value.trim():'',authType:$('endpoint-auth').value};}};
}
