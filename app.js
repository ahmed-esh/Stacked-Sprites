import {getFrameRects, projectedBounds, drawStack, suggestSheet} from './stack.js';
import {initGeneration} from './generation-ui.js';
import {rasterizeRecipe} from './generation.js';
import {SAMPLE_RECIPES} from './sample-recipes.js';
import {initEnvironment} from './environment.js';
import {beginSpriteDrag,endSpriteDrag,bindSpriteDropTab} from './sprite-transfer.js';

const $ = (id) => document.getElementById(id);
const canvas = $('preview');
const ctx = canvas.getContext('2d');
const state = {source: null, frames: [], rotation: -35, spacing: 1, elevation: 90, zoom: 1, reverse: false, playing: false, visible: Infinity, name: 'wooden-chair', dirty: true};
let toastTimer, uploadVersion = 0;
const generator = initGeneration({onApply:({sheet,recipe})=>{
  uploadVersion++;state.source=sheet;state.name=recipe.name.replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'') || 'generated-sprite';
  $('source-mode').value='sheet';$('sheet-layout').value='horizontal';$('frame-size').value=recipe.size;
  $('reverse').checked=false;state.reverse=false;$('file-name').textContent=`${recipe.name} · generated`;
  $('file-info').textContent=`${sheet.width} × ${sheet.height} px · ${recipe.layers} AI slices`;
  updateMode();resetView();toast('Generated slices loaded into the 2D stack.');
}});
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4000); }
function createCanvas(width, height) { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; }
function makeDemo() {
  const sheet = createCanvas(32 * 43, 32), c = sheet.getContext('2d');
  for (let i = 0; i < 43; i++) {
    const ox = i * 32;
    const rect = (x, y, w, h, color) => { c.fillStyle = color; c.fillRect(ox + x, y, w, h); };
    const wood = ['#ba8155', '#c78c5e', '#ad744e', '#bd8357'][Math.floor(i / 3) % 4];
    if (i < 18) {
      for (const [x, y] of [[4,4],[24,4],[4,24],[24,24]]) { rect(x,y,4,4,wood); rect(x,y,1,4,'#8f5d3f'); rect(x,y,4,1,'#d39a68'); }
      if (i >= 7 && i <= 9) { rect(5,5,2,22,wood); rect(25,5,2,22,wood); rect(5,24,22,2,wood); }
    } else if (i < 22) {
      rect(2,2,28,28,wood); rect(2,2,1,28,'#8f6041'); rect(2,2,28,1,'#dda976');
      for (let y = 8; y < 28; y += 7) rect(3,y,26,1,'#9e6949');
      rect(7,5,7,1,'#d99c69'); rect(16,12,9,1,'#ce9361'); rect(5,25,9,1,'#cf9461');
    } else {
      rect(4,4,4,4,wood); rect(24,4,4,4,wood);
      if (i >= 26 && (i < 32 || i >= 35)) { rect(4,3,24,4,wood); rect(4,3,24,1,'#dda272'); rect(4,6,24,1,'#935c3d'); }
      rect(4,4,1,4,'#8f5d3f'); rect(24,4,1,4,'#9b6543');
    }
  }
  return sheet;
}

function rebuild() {
  if (!state.source) return;
  if ($('source-mode').value === 'generate') {
    state.frames=[];state.visible=Infinity;$('filmstrip').replaceChildren();updateSelection();
    $('slice-warning').hidden=true;$('layer-badge').textContent='Awaiting slices';$('strip-count').textContent='Reference';$('dimensions').textContent='Generate slices to build your stack';
    $('preview-mode').textContent='REFERENCE PHOTO';$('export-button').disabled=true;$('sheet-export').disabled=true;state.dirty=true;return;
  }
  try {
    let frames;
    if ($('source-mode').value === 'extrude') {
      frames = Array.from({length: Number($('depth').value)}, () => ({x:0,y:0,width:state.source.width,height:state.source.height}));
    } else frames = getFrameRects(state.source.width, state.source.height, Number($('frame-size').value), $('sheet-layout').value);
    state.frames = frames; state.visible = Infinity;
    $('slice-warning').hidden = true;
    if ($('source-mode').value === 'sheet') {
      const extent = $('sheet-layout').value === 'horizontal' ? state.source.width : state.source.height;
      const remainder = extent % Number($('frame-size').value);
      if (remainder) { $('slice-warning').textContent = `${remainder} trailing pixel${remainder === 1 ? '' : 's'} will be left out. Choose a size that divides your image evenly.`; $('slice-warning').hidden = false; }
    }
    $('layer-badge').textContent = `${frames.length} layers`;
    $('strip-count').textContent = `${frames.length} slices`;
    $('dimensions').textContent = `${frames[0].width} × ${frames[0].height} px / slice`;
    $('preview-mode').textContent = $('source-mode').value === 'sheet' ? 'STACKED VIEW' : 'EXTRUDED VIEW';
    buildFilmstrip(); state.dirty = true;
    $('export-button').disabled = false; $('sheet-export').disabled = false;
  } catch (error) {
    $('slice-warning').textContent = error.message; $('slice-warning').hidden = false;
    state.frames = []; state.visible = Infinity; $('filmstrip').replaceChildren(); updateSelection(); $('layer-badge').textContent = '0 layers'; $('strip-count').textContent = '0 slices'; $('dimensions').textContent = 'Adjust the slice size to continue'; state.dirty = true;
    $('export-button').disabled = true; $('sheet-export').disabled = true;
  }
}

function updateMode() {
  const single = $('source-mode').value === 'extrude';
  const generate = $('source-mode').value === 'generate';
  $('sheet-fields').hidden = single || generate; $('depth-field').hidden = !single;$('generate-source').hidden=!generate;
  $('frame-size').previousElementSibling.firstChild.textContent = $('sheet-layout').value === 'horizontal' ? 'Slice width ' : 'Slice height ';
  $('mode-hint').textContent = generate ? 'Use your API key to design pixel slices from this reference, then stack them on canvas.' : single ? 'Repeats the same flat drawing. This extrusion mode does not infer the object’s volume.' : 'Each frame is a horizontal slice, from bottom to top.';
  rebuild();
}
function orderedFrames() { return state.reverse ? [...state.frames].reverse() : state.frames; }
function buildFilmstrip() {
  $('filmstrip').replaceChildren();
  orderedFrames().forEach((frame, i) => {
    const button = document.createElement('button'); button.className = 'slice-card'; button.title = `Show layers 1–${i+1}`; button.setAttribute('aria-label', `Inspect through layer ${i+1}`); button.setAttribute('aria-pressed','false');
    const thumb = createCanvas(64,64), tc = thumb.getContext('2d'); tc.imageSmoothingEnabled = false;
    const scale = Math.min(52/frame.width,52/frame.height);
    tc.drawImage(state.source,frame.x,frame.y,frame.width,frame.height,(64-frame.width*scale)/2,(64-frame.height*scale)/2,frame.width*scale,frame.height*scale);
    button.append(thumb,document.createTextNode(String(i+1).padStart(2,'0')));
    button.addEventListener('click', () => { state.visible = state.visible === i+1 ? Infinity : i+1; updateSelection(); state.dirty = true; });
    $('filmstrip').append(button);
  });
  updateSelection();
}
function updateSelection() {
  [...$('filmstrip').children].forEach((button,i) => { button.classList.toggle('active',i+1 === state.visible); button.classList.toggle('dimmed',i >= state.visible); button.setAttribute('aria-pressed',String(i+1 === state.visible)); });
  $('selection-info').textContent = state.visible === Infinity ? 'All layers visible' : `Layers 1–${state.visible} visible`;
  $('show-all').hidden = state.visible === Infinity;
}

function paintStack(context, cx, cy, scale, count) {
  drawStack(context,state.source,orderedFrames(),{...state,x:cx,y:cy,scale,count,pixelated:$('pixelated').checked});
}
function draw() {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) { canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr); }
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
  if (!state.frames.length) {
    if($('source-mode').value==='generate' && state.source){const s=Math.min(w*.75/state.source.width,h*.6/state.source.height);ctx.drawImage(state.source,(w-state.source.width*s)/2,(h-state.source.height*s)/2-20,state.source.width*s,state.source.height*s);}
    return;
  }
  const f = state.frames[0], count = Math.min(state.frames.length,state.visible);
  // Fit the entire rotation envelope, keeping scale steady during animation.
  const diagonal = Math.hypot(f.width,f.height), pitch = Math.sin(state.elevation*Math.PI/180);
  const fullHeight = diagonal*pitch + (state.frames.length-1)*state.spacing;
  const scale = Math.min(w*.56/diagonal,h*.64/Math.max(1,fullHeight))*state.zoom;
  const cx = w/2, cy = h*.46+(state.frames.length-1)*state.spacing*scale/2;
  if ($('grid').checked) drawGrid(w,h,cx,cy,scale,f);
  if ($('shadow').checked && state.elevation > 0) {
    ctx.save(); ctx.translate(cx,cy+3*scale); ctx.scale(1,Math.max(.18,pitch));
    const radius = diagonal*scale*.65, grad = ctx.createRadialGradient(0,0,0,0,0,radius);
    grad.addColorStop(0,'#00000055'); grad.addColorStop(.55,'#00000025'); grad.addColorStop(1,'#00000000');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0,0,radius,0,Math.PI*2); ctx.fill(); ctx.restore();
  }
  paintStack(ctx,cx,cy,scale,count);
}
function drawGrid(w,h,cx,cy,scale,f) {
  ctx.save(); ctx.beginPath(); ctx.rect(0,h*.2,w,h*.8); ctx.clip();
  const unit = Math.max(17, Math.min(f.width,f.height)*scale/4), angle = Math.PI/6;
  const ax = Math.cos(angle)*unit, ay = Math.sin(angle)*unit;
  const n = Math.min(90,Math.ceil((w+h)/unit));
  ctx.lineWidth=.6;
  for(let i=-n;i<=n;i++) {
    const alpha = .13*Math.max(0,1-Math.abs(i)/(n*.65)); ctx.strokeStyle=`rgba(128,151,103,${alpha})`;
    ctx.beginPath();ctx.moveTo(cx+i*ax-n*ax,cy+i*ay+n*ay);ctx.lineTo(cx+i*ax+n*ax,cy+i*ay-n*ay);ctx.stroke();
    ctx.beginPath();ctx.moveTo(cx+i*ax-n*ax,cy-i*ay-n*ay);ctx.lineTo(cx+i*ax+n*ax,cy-i*ay+n*ay);ctx.stroke();
  }
  ctx.restore();
}

function syncRanges() {
  $('rotation').value = state.rotation; $('spacing').value = state.spacing; $('elevation').value = state.elevation;
  $('rotation-value').textContent = `${Math.round(state.rotation)}°`; $('spacing-value').textContent = `${state.spacing.toFixed(1)} px`; $('elevation-value').textContent = state.elevation===90?'Classic':`${state.elevation}°`;
  $('depth-value').textContent = `${$('depth').value} layers`;
  document.querySelectorAll('input[type=range]').forEach(input => { const percent = (Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100; input.style.background = `linear-gradient(to right, var(--mint) ${percent}%, #394234 ${percent}%)`; });
  $('zoom-reset').textContent = `${Math.round(state.zoom*100)}%`;
}
function setPlaying(value) { state.playing = value; $('play-button').setAttribute('aria-pressed',String(value)); $('play-icon').textContent = value ? 'Ⅱ' : '▷'; $('play-label').textContent = value ? 'Pause rotation' : 'Auto-rotate'; }
function resetView() { Object.assign(state,{rotation:-35,spacing:1,elevation:90,zoom:1,visible:Infinity}); setPlaying(false); syncRanges(); updateSelection(); state.dirty=true; }
function setZoom(value) { state.zoom = Math.max(.25,Math.min(4,value)); syncRanges(); state.dirty = true; }
function loadDemo() {
  uploadVersion++;
  const recipe=SAMPLE_RECIPES[$('demo-choice').value];
  if(recipe){
    const raster=rasterizeRecipe(recipe);state.source=createCanvas(raster.width,raster.height);
    state.source.getContext('2d').putImageData(new ImageData(raster.pixels,raster.width,raster.height),0,0);
    state.name=recipe.name.toLowerCase().replaceAll(' ','-');
  }else{state.source=makeDemo();state.name='wooden-chair';}
  $('source-mode').value='sheet';$('frame-size').value=recipe?.size||32;$('sheet-layout').value='horizontal';
  $('reverse').checked=false;state.reverse=false;
  $('file-name').textContent=`${state.name}.png`;
  $('file-info').textContent=`${state.source.width.toLocaleString()} × ${state.source.height} px · hand-authored example`;
  updateMode();resetView();
}

async function loadFile(file) {
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { toast('Please choose a PNG, JPG or WebP image.'); return; }
  if (file.size > 20*1024*1024) { toast('Choose an image smaller than 20 MB.'); return; }
  const version = ++uploadVersion;
  const url=URL.createObjectURL(file);
  try {
    const img=new Image(); img.src=url; await img.decode();
    if (version !== uploadVersion) return;
    if(img.width>16384 || img.height>16384 || img.width*img.height>32*1024*1024) throw new Error('Image is too large. Use at most 16,384 px per side and 32 megapixels.');
    state.source=img; state.name=file.name.replace(/\.[^.]+$/,'');
    $('file-name').textContent=file.name; $('file-info').textContent=`${img.width.toLocaleString()} × ${img.height.toLocaleString()} px · ${(file.size/1024).toFixed(0)} KB`;
    const suggested=suggestSheet(img.width,img.height);
    $('source-mode').value=suggested?'sheet':'generate'; $('sheet-layout').value=suggested?.layout||'horizontal'; $('frame-size').value=Math.min(img.width,img.height);
    generator.setReference(img,file.name);
    state.reverse=false; $('reverse').checked=false; updateMode(); resetView(); toast(suggested?'Looks like a sprite sheet. Check the slice width and order; change Image type if this is a photo.':'Reference loaded. Choose Generate slices to create your stack.');
  } catch(error) { if (version === uploadVersion) toast(error.message.startsWith('Image is too') ? error.message : 'This image could not be read. Try another PNG, JPG or WebP.'); }
  finally { URL.revokeObjectURL(url); $('file-input').value=''; }
}

function download(c,filename) { c.toBlob(blob => { if(!blob) { toast('Export failed. Try a smaller image.'); return; } const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('Your PNG is ready.'); },'image/png'); }
function exportView() {
  if(!state.frames.length) return;
  const f=state.frames[0], count=Math.min(state.frames.length,state.visible), bounds=projectedBounds(f.width,f.height,count,state.rotation,state.elevation,state.spacing);
  const scale=Math.min(8,Math.max(1,1024/Math.max(bounds.width,bounds.height)),4096/(Math.max(bounds.width,bounds.height)+8));
  const pad=4*scale, c=createCanvas(Math.max(1,Math.ceil(bounds.width*scale+pad*2)),Math.max(1,Math.ceil(bounds.height*scale+pad*2)));
  paintStack(c.getContext('2d'),c.width/2,pad+bounds.planeHeight*scale/2+(count-1)*state.spacing*scale,scale,count);
  download(c,`${state.name}-stacked.png`);
}
function exportSheet() {
  if(!state.frames.length) return;
  const frames=orderedFrames(), f=frames[0], width=f.width*frames.length;
  if(width>16384 || width*f.height>32*1024*1024) { toast('Sheet is too large to export. Reduce the image size or layer count.'); return; }
  const c=createCanvas(width,f.height), context=c.getContext('2d');
  frames.forEach((frame,i)=>context.drawImage(state.source,frame.x,frame.y,frame.width,frame.height,i*f.width,0,f.width,f.height));
  download(c,`${state.name}-sheet-${f.width}px.png`);
}

for(const key of ['rotation','spacing','elevation']) $(key).addEventListener('input',()=>{state[key]=Number($(key).value); if(key==='rotation') setPlaying(false);syncRanges();state.dirty=true;});
$('depth').addEventListener('input',()=>{syncRanges();rebuild();});
$('source-mode').addEventListener('change',()=>{if($('source-mode').value==='generate'&&state.source)generator.setReference(state.source,$('file-name').textContent);updateMode();});
$('frame-size').addEventListener('input',rebuild);
$('sheet-layout').addEventListener('change',updateMode);
$('reverse').addEventListener('change',()=>{state.reverse=$('reverse').checked;state.visible=Infinity;buildFilmstrip();state.dirty=true;});
for(const id of ['grid','shadow','pixelated']) $(id).addEventListener('change',()=>state.dirty=true);
$('play-button').addEventListener('click',()=>setPlaying(!state.playing));
$('reset-button').addEventListener('click',resetView);
$('zoom-in').addEventListener('click',()=>setZoom(state.zoom+.1)); $('zoom-out').addEventListener('click',()=>setZoom(state.zoom-.1)); $('zoom-reset').addEventListener('click',()=>setZoom(1));
$('show-all').addEventListener('click',()=>{state.visible=Infinity;updateSelection();state.dirty=true;});
$('demo-button').addEventListener('click',loadDemo);
$('file-input').addEventListener('change',event=>loadFile(event.target.files[0]));
$('drop-zone').tabIndex = 0;
$('drop-zone').setAttribute('role','button');
$('drop-zone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.code==='Space'){e.preventDefault();e.stopPropagation();$('file-input').click();}});
for(const event of ['dragenter','dragover']) $('drop-zone').addEventListener(event,e=>{e.preventDefault();$('drop-zone').classList.add('dragover');});
for(const event of ['dragleave','drop']) $('drop-zone').addEventListener(event,e=>{e.preventDefault();$('drop-zone').classList.remove('dragover');});
$('drop-zone').addEventListener('drop',e=>loadFile(e.dataTransfer.files[0]));
window.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')) e.preventDefault();});
window.addEventListener('drop',e=>{if(e.dataTransfer.types.includes('Files')) e.preventDefault();});
$('export-button').addEventListener('click',exportView); $('sheet-export').addEventListener('click',exportSheet);
$('help-button').addEventListener('click',()=>$('help-dialog').showModal());
for(const id of ['close-help','help-done']) $(id).addEventListener('click',()=>$('help-dialog').close());
$('help-dialog').addEventListener('click',e=>{if(e.target===$('help-dialog')) {const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
let drag=null;
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,rotation:state.rotation};canvas.setPointerCapture(e.pointerId);setPlaying(false);});
canvas.addEventListener('pointermove',e=>{if(!drag)return;state.rotation=((drag.rotation+(e.clientX-drag.x)*.6+180)%360+360)%360-180;syncRanges();state.dirty=true;});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>drag=null);
canvas.addEventListener('wheel',e=>{e.preventDefault();setZoom(state.zoom*Math.exp(-e.deltaY*.001));},{passive:false});
document.addEventListener('keydown',e=>{if($('studio-panel').hidden||e.target.closest('input,select,button,textarea')||document.querySelector('dialog[open]'))return;if(e.code==='Space'){e.preventDefault();setPlaying(!state.playing);}if(e.key.toLowerCase()==='r')resetView();if(e.key==='+'||e.key==='=')setZoom(state.zoom+.1);if(e.key==='-')setZoom(state.zoom-.1);if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setPlaying(false);state.rotation=((state.rotation+(e.key==='ArrowLeft'?-5:5)+180+360)%360)-180;syncRanges();state.dirty=true;}});
new ResizeObserver(()=>state.dirty=true).observe($('stage'));
document.addEventListener('visibilitychange',()=>{lastTime=0;});
let lastTime=0;
function tick(time) { if(!$('studio-panel').hidden){if(state.playing&&!document.hidden){const delta=lastTime?Math.min((time-lastTime)/1000,.1):0;state.rotation=((state.rotation+delta*22+180)%360)-180;syncRanges();state.dirty=true;}if(state.dirty){draw();state.dirty=false;}}lastTime=time;requestAnimationFrame(tick); }
loadDemo();requestAnimationFrame(tick);
function getStudioSprite(){
  if(!state.frames.length)return null;
  const frames=orderedFrames(),f=frames[0],width=f.width*frames.length;
  if(width>16384||width*f.height>8_388_608)throw new Error('Use a smaller sprite sheet for the environment (up to 8 megapixels).');
  const image=createCanvas(width,f.height),context=image.getContext('2d');
  frames.forEach((frame,i)=>context.drawImage(state.source,frame.x,frame.y,frame.width,frame.height,i*f.width,0,f.width,f.height));
  return {image,asset:{name:state.name,width:f.width,height:f.height,frames:frames.length,spacing:state.spacing,radius:Math.min(f.width,f.height)*.3,src:image.toDataURL('image/png')}};
}
const environment=initEnvironment({generator,toast,getStudioSprite,openStudioSprite({asset,image}){
  const copy=createCanvas(asset.width*asset.frames,asset.height);copy.getContext('2d').drawImage(image,0,0);
  uploadVersion++;state.source=copy;state.name=asset.name;
  $('source-mode').value='sheet';$('sheet-layout').value='horizontal';$('frame-size').value=asset.width;
  $('reverse').checked=false;state.reverse=false;$('file-name').textContent=asset.name;
  $('file-info').textContent=`${copy.width} × ${copy.height} px · from environment library`;
  updateMode();resetView();state.spacing=asset.spacing;syncRanges();state.dirty=true;switchTab('studio');
  toast('Sprite opened in Studio. Add or drag it back to create a new version.');
}});
function switchTab(name){
  const isEnvironment=name==='environment';$('studio-panel').hidden=isEnvironment;$('environment-panel').hidden=!isEnvironment;$('studio-actions').hidden=isEnvironment;
  for(const tab of ['studio','environment']){const active=tab===name;$(`tab-${tab}`).setAttribute('aria-selected',String(active));$(`tab-${tab}`).tabIndex=active?0:-1;}
  environment.setActive(isEnvironment);state.dirty=true;
}
for(const name of ['studio','environment']){
  $(`tab-${name}`).addEventListener('click',()=>switchTab(name));
  $(`tab-${name}`).addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'studio':event.key==='End'?'environment':name==='studio'?'environment':'studio';switchTab(next);$(`tab-${next}`).focus();}});
}
$('add-to-environment').addEventListener('click',()=>{environment.addStudio();switchTab('environment');});
$('add-to-environment').draggable=true;
$('add-to-environment').addEventListener('dragstart',event=>{
  try{const sprite=getStudioSprite();if(!sprite)throw new Error('Load or generate a stacked sprite first.');beginSpriteDrag(event,{kind:'studio',sprite});}
  catch(error){event.preventDefault();toast(error.message);}
});
const cancelTabDrag=bindSpriteDropTab($('tab-environment'),()=>switchTab('environment'),payload=>{
  if(payload.kind==='studio')environment.addStudio(payload.sprite);
});
for(const event of ['dragend','drop'])window.addEventListener(event,()=>{cancelTabDrag();endSpriteDrag();$('env-canvas').classList.remove('sprite-drop-target');});
