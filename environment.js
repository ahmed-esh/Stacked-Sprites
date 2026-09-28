import {createScene,sceneData,validateScene,drawScene,sceneTransform,screenToWorld,pickObject,movePlayer,resetController,sceneKeys} from './scene.js';
import {rasterizeRecipe} from './generation.js';
import {drawStack,getFrameRects} from './stack.js';
import {exportScene} from './scene-export.js';
import {initSceneAI} from './scene-ai.js';
import {beginSpriteDrag,hasSpriteDrag,takeSpriteDrop,endSpriteDrag} from './sprite-transfer.js';

const $=id=>document.getElementById(id);
const uid=prefix=>`${prefix}-${crypto.randomUUID()}`;
export function recipeAsset(recipe,id=uid('asset')){
  const raster=rasterizeRecipe(recipe),image=document.createElement('canvas');image.width=raster.width;image.height=raster.height;
  image.getContext('2d').putImageData(new ImageData(raster.pixels,raster.width,raster.height),0,0);
  return {asset:{id,name:recipe.name,width:recipe.size,height:recipe.size,frames:recipe.layers,spacing:1,radius:recipe.size*.3,src:image.toDataURL('image/png')},image};
}
export function initEnvironment({getStudioSprite,openStudioSprite,generator,toast}){
  $('environment-panel').innerHTML=`
  <aside class="env-sidebar">
    <span class="eyebrow">BUILD WITH YOUR SPRITES</span><h1>Environment</h1><p class="field-hint">Place pixels. Build a world. Everything is Canvas 2D.</p>
    <div class="env-actions"><button id="env-add-studio" class="button primary">Add current studio sprite</button><button id="env-road-demo" class="button">Load road example</button></div>
    <section><h2>Sprite library <span id="env-asset-count"></span></h2><p class="field-hint">Drag a sprite into the scene, or use Place. Double-click a sprite to open it in Sprite Studio. Enter opens the focused sprite.</p><div id="env-library" class="env-library"></div></section>
    <section><h2>World</h2><label class="field-label" for="env-name">Name</label><input id="env-name" maxlength="120" value="My environment">
      <div class="field-row"><div><label class="field-label" for="env-width">Width</label><input id="env-width" type="number" min="256" max="2048" value="960"></div><div><label class="field-label" for="env-height">Height</label><input id="env-height" type="number" min="256" max="2048" value="504"></div></div>
      <label class="field-label" for="env-background">Ground color</label><input id="env-background" type="color" value="#66785a">
      <label class="field-label" for="env-camera">Rotate environment <output id="env-camera-value">0°</output></label><input id="env-camera" type="range" min="-180" max="180" value="0">
      <button id="env-road" class="button">Add a road across the center</button><button id="env-clear-ground" class="text-button">Clear ground shapes</button>
    </section>
    <section><h2>Selected object</h2><p id="env-empty-selection" class="field-hint">Place a sprite or click one in the world. Drag it to move.</p><fieldset id="env-inspector" hidden><legend id="env-selected-name"></legend>
      <div class="field-row"><div><label class="field-label" for="env-x">X</label><input id="env-x" type="number" step="1"></div><div><label class="field-label" for="env-y">Y</label><input id="env-y" type="number" step="1"></div></div>
      <div class="field-row"><div><label class="field-label" for="env-rotation">Rotation</label><input id="env-rotation" type="number" min="-180" max="180" step="1"></div><div><label class="field-label" for="env-scale">Scale</label><input id="env-scale" type="number" min=".25" max="8" step=".25"></div></div>
      <label class="toggle-row"><span>Solid obstacle</span><input id="env-solid" type="checkbox"><span class="switch"></span></label>
      <div class="env-actions"><button id="env-player" class="button primary">Make player</button><button id="env-duplicate" class="button">Duplicate</button><button id="env-delete" class="button">Remove</button></div>
    </fieldset></section>
    <section><h2>Controller</h2><p id="env-player-label" class="field-hint">Choose an object as the player.</p>
      <label class="field-label" for="env-control-mode">Player animation</label><select id="env-control-mode"><option value="free">Walking · gentle bob</option><option value="drive">Vehicle · no bob</option></select>
      <label class="field-label" for="env-speed">Speed · pixels / second</label><input id="env-speed" type="number" min="10" max="500" value="120">
      <label class="field-label" for="env-turn-speed">Camera rotation · degrees / second</label><input id="env-turn-speed" type="number" min="10" max="360" step="0.1" value="114.6">
      <p class="field-hint">WASD / arrows move relative to the screen. Q / E rotate the whole world around the player. The camera follows the player, who turns smoothly toward movement. Solid props use circular collisions.</p>
    </section>
  </aside>
  <section class="env-workspace"><div class="env-toolbar"><div><span class="eyebrow">960 × 504 · CANVAS 2D</span><h2 id="env-title">My environment</h2></div><div class="env-actions"><button id="env-ai" class="button primary">✳ Describe a world</button><button id="env-play" class="button">▶ Play</button><button id="env-export" class="button">Export code + sprites ↓</button></div></div>
    <canvas id="env-canvas" width="960" height="600" tabindex="0" aria-label="Environment editor. Drop a library or Studio sprite here. Click to select, drag to move, or double-click to open in Sprite Studio. In play mode WASD or arrows move, and Q or E rotate the world."></canvas>
    <div class="env-status"><span id="env-status">Edit mode · drag sprites to place them</span><span id="env-object-count">0 objects</span></div>
    <div class="env-actions env-project-actions"><button id="env-save" class="button">Save editable project</button><button id="env-load" class="button">Open project</button><input id="env-project-file" type="file" accept="application/json,.json" hidden><button id="env-restore" class="button" hidden>Restore previous environment</button></div>
    <p class="field-hint">Export downloads a ZIP containing an unpacked-ready folder: HTML, JavaScript, scene data, and PNG sprite sheets. It runs locally without an API key.</p>
  </section>`;
  let scene=createScene(),images=new Map(),selected=null,librarySelection=null,playing=false,playStart=null,active=false,drag=null,previousScene=null,dirty=true,previousTime=0;
  const keys=new Set(),canvas=$('env-canvas'),ctx=canvas.getContext('2d');
  const selection=()=>scene.objects.find(o=>o.id===selected);
  function stop(){if(playing){scene.objects=playStart.objects;scene.cameraRotation=playStart.cameraRotation;resetController(scene);playing=false;keys.clear();$('env-play').textContent='▶ Play';$('env-status').textContent='Edit mode · drag sprites to place them';refresh();}}
  function edited(){stop();dirty=true;}
  function setSelection(id){selected=id;refreshInspector();dirty=true;}
  function refreshInspector(){
    const o=selection();$('env-inspector').hidden=!o;$('env-empty-selection').hidden=Boolean(o);
    if(o){$('env-selected-name').textContent=scene.assets.find(a=>a.id===o.assetId)?.name;for(const k of ['x','y','rotation','scale'])$(`env-${k}`).value=Math.round(o[k]*100)/100;$('env-solid').checked=o.solid;$('env-player').textContent=scene.playerId===o.id?'Player ✓':'Make player';}
    const player=scene.objects.find(o=>o.id===scene.playerId);$('env-player-label').textContent=player?`Player: ${scene.assets.find(a=>a.id===player.assetId).name}`:'Choose an object as the player.';
  }
  function refresh(){
    $('env-name').value=scene.name;$('env-title').textContent=scene.name;$('env-width').value=scene.width;$('env-height').value=scene.height;
    $('env-title').previousElementSibling.textContent=`${scene.width} × ${scene.height} · CANVAS 2D`;
    $('env-background').value=scene.background;$('env-camera').value=scene.cameraRotation;$('env-camera-value').textContent=`${scene.cameraRotation}°`;
    $('env-control-mode').value=scene.controller.mode;$('env-speed').value=scene.controller.speed;$('env-turn-speed').value=scene.controller.turnSpeed;$('env-object-count').textContent=`${scene.objects.length} objects`;
    $('env-restore').hidden=!previousScene;refreshInspector();dirty=true;
  }
  function place(assetId,position={x:scene.width/2,y:scene.height/2}){
    if(!scene.assets.some(a=>a.id===assetId))return false;
    if(scene.objects.length>=300){toast('A scene can contain up to 300 objects.');return false;}
    edited();const o={id:uid('object'),assetId,x:Math.max(0,Math.min(scene.width,position.x)),y:Math.max(0,Math.min(scene.height,position.y)),rotation:0,scale:2,solid:false};scene.objects.push(o);if(!scene.playerId)scene.playerId=o.id;selected=o.id;refresh();return true;
  }
  function openAsset(id){
    const asset=scene.assets.find(a=>a.id===id),image=images.get(id);if(!asset||!image)return;
    try{openStudioSprite({asset:{...asset},image});}catch(error){toast(error.message);}
  }
  function selectLibrary(id){
    librarySelection=id;
    for(const card of $('env-library').querySelectorAll('.env-asset'))card.setAttribute('aria-pressed',String(card.dataset.assetId===id));
  }
  function library(){
    $('env-library').replaceChildren();$('env-asset-count').textContent=`(${scene.assets.length})`;
    for(const a of scene.assets){const entry=document.createElement('div');entry.className='env-library-entry';const card=document.createElement('button');card.className='env-asset';card.title=`Double-click to open ${a.name} in Sprite Studio, or drag into the scene`;card.draggable=true;card.dataset.assetId=a.id;card.setAttribute('aria-pressed',String(librarySelection===a.id));const c=document.createElement('canvas');c.width=100;c.height=100;
      const scale=Math.min(82/Math.hypot(a.width,a.height),82/(Math.hypot(a.width,a.height)+(a.frames-1)*a.spacing));
      drawStack(c.getContext('2d'),images.get(a.id),getFrameRects(a.width*a.frames,a.height,a.width),{x:50,y:50+(a.frames-1)*a.spacing*scale/2,scale,rotation:-35,spacing:a.spacing});
      const label=document.createElement('span');label.textContent=a.name;card.append(c,label);
      card.addEventListener('click',event=>{selectLibrary(a.id);if(event.detail===0)openAsset(a.id);});
      card.addEventListener('dblclick',()=>openAsset(a.id));
      card.addEventListener('dragstart',event=>{selectLibrary(a.id);beginSpriteDrag(event,{kind:'library',assetId:a.id});});
      card.addEventListener('dragend',()=>{endSpriteDrag();canvas.classList.remove('sprite-drop-target');});
      const placeButton=document.createElement('button');placeButton.className='button env-place';placeButton.textContent='Place';placeButton.setAttribute('aria-label',`Place ${a.name} in the scene`);placeButton.addEventListener('click',()=>place(a.id));
      entry.append(card,placeButton);$('env-library').append(entry);
    }
  }
  async function install(next,nextImages=null){
    validateScene(next);
    if(!nextImages){nextImages=new Map();await Promise.all(next.assets.map(a=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{if(image.naturalWidth!==a.width*a.frames||image.naturalHeight!==a.height){reject(new Error('Sprite dimensions do not match the project.'));return;}nextImages.set(a.id,image);resolve();};image.onerror=()=>reject(new Error('Could not decode a project sprite.'));image.src=a.src;})));}
    stop();previousScene={scene,images};scene=sceneData(next);images=nextImages;selected=scene.playerId;library();refresh();
  }
  function addStudio(sprite,position){
    try{sprite??=getStudioSprite();if(!sprite)throw new Error('Load or generate a stacked sprite in Sprite Studio first.');
      if(scene.objects.length>=300)throw new Error('A scene can contain up to 300 objects.');
      edited();let asset=scene.assets.find(a=>a.src===sprite.asset.src&&a.spacing===sprite.asset.spacing&&a.width===sprite.asset.width&&a.height===sprite.asset.height&&a.frames===sprite.asset.frames);
      if(!asset){if(scene.assets.length>=64)throw new Error('The library can contain up to 64 sprites.');asset={...sprite.asset,id:uid('asset')};validateScene({...scene,assets:[...scene.assets,asset]});scene.assets.push(asset);images.set(asset.id,sprite.image);library();}
      if(place(asset.id,position))toast('Sprite added to the environment.');
    }catch(error){toast(error.message);}
  }
  $('env-add-studio').addEventListener('click',()=>addStudio());
  for(const id of ['env-name','env-background','env-camera','env-control-mode','env-speed','env-turn-speed','env-width','env-height'])$(id).addEventListener('change',()=>{
    edited();const before=sceneData(scene);
    scene.name=$('env-name').value||'My environment';scene.background=$('env-background').value;scene.cameraRotation=Number($('env-camera').value);scene.controller.mode=$('env-control-mode').value;scene.controller.speed=Number($('env-speed').value);scene.controller.turnSpeed=Number($('env-turn-speed').value);
    scene.width=Number($('env-width').value);scene.height=Number($('env-height').value);
    scene.objects.forEach(o=>{o.x=Math.min(o.x,scene.width);o.y=Math.min(o.y,scene.height);});
    scene.ground=scene.ground.filter(g=>g.x<scene.width&&g.y<scene.height).map(g=>({...g,width:Math.min(g.width,scene.width-g.x),height:Math.min(g.height,scene.height-g.y)}));
    try{validateScene(scene);}catch(error){scene=before;toast(error.message);}refresh();
  });
  for(const key of ['x','y','rotation','scale'])$(`env-${key}`).addEventListener('change',()=>{
    edited();const o=selection();if(!o)return;const value=Number($(`env-${key}`).value),old=o[key];o[key]=value;try{validateScene(scene);}catch(error){o[key]=old;toast(error.message);}refreshInspector();dirty=true;
  });
  $('env-solid').addEventListener('change',()=>{edited();if(selection())selection().solid=$('env-solid').checked;});
  $('env-player').addEventListener('click',()=>{edited();if(selection()){scene.playerId=selected;refreshInspector();}});
  $('env-duplicate').addEventListener('click',()=>{edited();const o=selection();if(!o||scene.objects.length>=300)return;const copy={...o,id:uid('object'),x:Math.min(scene.width,o.x+24),y:Math.min(scene.height,o.y+24)};scene.objects.push(copy);selected=copy.id;refresh();});
  function remove(){edited();scene.objects=scene.objects.filter(o=>o.id!==selected);if(scene.playerId===selected)scene.playerId=null;selected=null;refresh();}
  $('env-delete').addEventListener('click',remove);
  $('env-road').addEventListener('click',()=>{edited();if(scene.ground.length>61){toast('Clear ground shapes before adding another road.');return;}scene.ground.push({x:0,y:scene.height/2-52,width:scene.width,height:104,color:'#42494B'},{x:0,y:scene.height/2-2,width:scene.width,height:4,color:'#D8C788'});dirty=true;});
  $('env-clear-ground').addEventListener('click',()=>{edited();scene.ground=[];});
  $('env-play').addEventListener('click',()=>{if(playing){stop();return;}if(!scene.playerId){toast('Select a sprite and choose Make player first.');return;}playing=true;playStart={objects:structuredClone(scene.objects),cameraRotation:scene.cameraRotation};resetController(scene);keys.clear();$('env-play').textContent='■ Stop';$('env-status').textContent='Play mode · WASD / arrows move · Q / E orbit world · Stop restores the scene';canvas.focus();});
  const point=event=>{const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height};};
  canvas.addEventListener('dragover',event=>{if(!hasSpriteDrag(event)||playing)return;event.preventDefault();event.dataTransfer.dropEffect='copy';canvas.classList.add('sprite-drop-target');});
  canvas.addEventListener('dragleave',()=>canvas.classList.remove('sprite-drop-target'));
  canvas.addEventListener('drop',event=>{
    canvas.classList.remove('sprite-drop-target');const payload=takeSpriteDrop(event);if(!payload)return;event.preventDefault();
    if(playing){toast('Stop play mode before dropping sprites into the scene.');return;}
    const p=point(event),position=screenToWorld(scene,sceneTransform(scene,canvas.width,canvas.height),p.x,p.y);
    if(payload.kind==='library')place(payload.assetId,position);else if(payload.kind==='studio')addStudio(payload.sprite,position);
  });
  canvas.addEventListener('dblclick',event=>{if(playing)return;const p=point(event),o=pickObject(scene,sceneTransform(scene,canvas.width,canvas.height),p.x,p.y);if(o)openAsset(o.assetId);});
  canvas.addEventListener('pointerdown',event=>{canvas.focus();if(playing)return;const p=point(event),t=sceneTransform(scene,canvas.width,canvas.height),o=pickObject(scene,t,p.x,p.y);setSelection(o?.id||null);if(o){const w=screenToWorld(scene,t,p.x,p.y);drag={id:o.id,offsetX:o.x-w.x,offsetY:o.y-w.y,t};canvas.setPointerCapture(event.pointerId);}});
  canvas.addEventListener('pointermove',event=>{if(!drag||playing)return;const p=point(event),w=screenToWorld(scene,drag.t,p.x,p.y),o=selection();if(!o)return;o.x=Math.max(0,Math.min(scene.width,w.x+drag.offsetX));o.y=Math.max(0,Math.min(scene.height,w.y+drag.offsetY));dirty=true;refreshInspector();});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>drag=null);
  canvas.addEventListener('keydown',event=>{if(playing&&sceneKeys.has(event.code)){event.preventDefault();keys.add(event.code);}else if(!playing&&(event.code==='Delete'||event.code==='Backspace')){event.preventDefault();remove();}});
  window.addEventListener('keyup',event=>keys.delete(event.code));for(const target of [canvas,window])target.addEventListener('blur',()=>keys.clear());document.addEventListener('visibilitychange',()=>keys.clear());
  const saveBlob=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
  $('env-save').addEventListener('click',()=>{stop();saveBlob(new Blob([JSON.stringify(sceneData(scene),null,2)],{type:'application/json'}),'environment.stacked.json');});
  $('env-load').addEventListener('click',()=>$('env-project-file').click());
  $('env-project-file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>34_000_000)throw new Error('Project exceeds 34 MB.');await install(JSON.parse(await file.text()));toast('Environment restored.');}catch(error){toast(error.message);}finally{event.target.value='';}});
  $('env-restore').addEventListener('click',()=>{if(!previousScene)return;stop();const previous=previousScene;previousScene={scene,images};({scene,images}=previous);selected=scene.playerId;library();refresh();});
  $('env-export').addEventListener('click',async()=>{stop();$('env-export').disabled=true;try{saveBlob(await exportScene(scene),'stacked-scene.zip');toast('Export ready. Unzip the folder and open index.html.');}catch(error){toast(error.message);}finally{$('env-export').disabled=false;}});
  $('env-road-demo').addEventListener('click',async()=>{try{
    const rectangle=(z,x,y,w,h)=>({z,points:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
    const part=(name,color,z1,z2,x,y,w,h)=>({name,shape:'polygon',operation:'paint',color,sections:[rectangle(z1,x,y,w,h),rectangle(z2,x,y,w,h)]});
    const car=recipeAsset({version:2,name:'Little red car',notes:'Hand-authored example.',size:32,layers:12,parts:[part('Wheels','#292D30',0,4,6,5,20,5),part('Rear wheels','#292D30',0,4,6,22,20,5),part('Body','#BA5147',3,7,7,3,18,26),part('Cabin','#C46A50',7,11,9,10,14,13),part('Windshield','#8CBBBF',8,10,9,10,14,3)]});
    const tree=recipeAsset({version:2,name:'Round tree',notes:'Hand-authored example.',size:32,layers:32,parts:[part('Trunk','#806340',0,13,13,13,6,6),{name:'Leaves',shape:'ellipse',operation:'paint',color:'#49744C',sections:[{z:10,points:[{x:9,y:9},{x:23,y:23}]},{z:19,points:[{x:2,y:2},{x:30,y:30}]},{z:26,points:[{x:6,y:6},{x:26,y:26}]},{z:31,points:[{x:13,y:13},{x:19,y:19}]}]}]});
    const demo=createScene();demo.name='Sunday drive';demo.controller.mode='drive';demo.assets=[car.asset,tree.asset];demo.ground=[{x:0,y:188,width:960,height:128,color:'#434C50'},...Array.from({length:15},(_,i)=>({x:i*64+8,y:250,width:32,height:4,color:'#E2D495'}))];
    demo.objects=[{id:uid('object'),assetId:car.asset.id,x:340,y:250,rotation:90,scale:2,solid:false},...Array.from({length:14},(_,i)=>({id:uid('object'),assetId:tree.asset.id,x:60+(i%7)*140,y:i<7?112:410,rotation:i*17,scale:1.4,solid:true}))];demo.playerId=demo.objects[0].id;
    await install(demo,new Map([[car.asset.id,car.image],[tree.asset.id,tree.image]]));toast('Free road example loaded. Press Play to drive.');
  }catch(error){toast(error.message);}});
  initSceneAI({generator,getScene:()=>scene,makeAsset:recipeAsset,install,toast});
  function tick(now){if(active&&!document.hidden){if(playing){movePlayer(scene,keys,previousTime?(now-previousTime)/1000:0);$('env-camera').value=scene.cameraRotation;$('env-camera-value').textContent=`${Math.round(scene.cameraRotation)}°`;dirty=true;}if(dirty){drawScene(ctx,scene,images,{selected:playing?null:selected,grid:!playing,followPlayer:playing});dirty=false;}}previousTime=now;requestAnimationFrame(tick);}
  requestAnimationFrame(tick);refresh();library();
  return {setActive(value){active=value;keys.clear();if(!value)stop();dirty=true;},addStudio};
}
