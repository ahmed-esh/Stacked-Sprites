import {drawStack,getFrameRects,projectedBounds} from './stack.js';

export const sceneKeys=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE']);
export function createScene(){return {version:1,name:'My environment',width:960,height:504,background:'#66785A',cameraRotation:0,controller:{mode:'free',speed:120,turnSpeed:114.6},assets:[],objects:[],ground:[],playerId:null};}
const controllerStates=new WeakMap();
const wrapAngle=degrees=>((degrees+180)%360+360)%360-180;
export function resetController(scene){controllerStates.delete(scene);}
export function validateScene(scene,{allowFiles=false}={}) {
  const bad=message=>{throw new Error(`Invalid scene: ${message}`);};
  const number=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const id=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(s);
  const color=s=>typeof s==='string'&&/^#[0-9a-fA-F]{6}$/.test(s);
  if(!scene||scene.version!==1||typeof scene.name!=='string'||scene.name.length>120)bad('missing name or unsupported version.');
  if(![scene.width,scene.height].every(n=>Number.isInteger(n)&&number(n,256,2048))||!number(scene.cameraRotation,-360,360)||!color(scene.background))bad('world dimensions or appearance.');
  if(!scene.controller||!['free','drive'].includes(scene.controller.mode)||!number(scene.controller.speed,10,500)||!number(scene.controller.turnSpeed,10,360))bad('controller settings.');
  if(!Array.isArray(scene.assets)||scene.assets.length>64||!Array.isArray(scene.objects)||scene.objects.length>300||!Array.isArray(scene.ground)||scene.ground.length>64)bad('too many assets, objects, or ground shapes.');
  const assets=new Map();let bytes=0;
  for(const a of scene.assets){
    if(!a||!id(a.id)||assets.has(a.id)||typeof a.name!=='string'||a.name.length>120)bad('asset identifier or name.');
    if(![a.width,a.height,a.frames].every(Number.isInteger)||!number(a.width,1,4096)||!number(a.height,1,4096)||!number(a.frames,1,256)||a.width*a.frames>16384||a.width*a.height*a.frames>8_388_608||!number(a.spacing,0,4)||!number(a.radius,0,2048))bad('asset dimensions.');
    if(typeof a.src!=='string'||!(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(a.src)||(allowFiles&&/^assets\/sprite-\d+\.png$/.test(a.src))))bad('asset must be an embedded PNG.');
    bytes+=a.src.length;if(bytes>32_000_000)bad('embedded images exceed 32 MB.');
    assets.set(a.id,a);
  }
  const ids=new Set();
  for(const o of scene.objects){
    if(!o||!id(o.id)||ids.has(o.id)||!assets.has(o.assetId)||!number(o.x,0,scene.width)||!number(o.y,0,scene.height)||!number(o.rotation,-360,360)||!number(o.scale,.25,8)||typeof o.solid!=='boolean')bad('object placement or asset reference.');
    ids.add(o.id);
  }
  if(scene.playerId!==null&&!ids.has(scene.playerId))bad('player is missing.');
  for(const g of scene.ground)if(!g||!number(g.x,0,scene.width)||!number(g.y,0,scene.height)||!number(g.width,1,scene.width)||!number(g.height,1,scene.height)||g.x+g.width>scene.width||g.y+g.height>scene.height||!color(g.color))bad('ground shape bounds.');
  return scene;
}

// Explicit serialization prevents connection settings or incidental editor state
// from being included in projects and exported games.
export function sceneData(s){return {
  version:1,name:s.name,width:s.width,height:s.height,background:s.background,cameraRotation:s.cameraRotation,
  controller:{mode:s.controller.mode,speed:s.controller.speed,turnSpeed:s.controller.turnSpeed},playerId:s.playerId,
  assets:s.assets.map(a=>({id:a.id,name:a.name,width:a.width,height:a.height,frames:a.frames,spacing:a.spacing,radius:a.radius,src:a.src})),
  objects:s.objects.map(o=>({id:o.id,assetId:o.assetId,x:o.x,y:o.y,rotation:o.rotation,scale:o.scale,solid:o.solid})),
  ground:s.ground.map(g=>({x:g.x,y:g.y,width:g.width,height:g.height,color:g.color}))
};}

export function sceneTransform(scene,width,height,{followPlayer=false}={}){
  const radians=scene.cameraRotation*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  const assets=new Map(scene.assets.map(a=>[a.id,a]));
  const top=Math.max(0,...scene.objects.map(o=>{const a=assets.get(o.assetId);return a?(a.frames-1)*a.spacing*o.scale:0;}));
  const pad=Math.max(24,...scene.objects.map(o=>{const a=assets.get(o.assetId);return a?Math.hypot(a.width,a.height)*o.scale/2:0;}));
  const player=followPlayer?scene.objects.find(o=>o.id===scene.playerId):null;
  // During play, use a fixed zoom and a player-centered camera. Fitting the
  // rotated world every frame would make it shrink and grow while Q/E is held.
  const w=(followPlayer?scene.width:Math.abs(scene.width*c)+Math.abs(scene.height*s))+pad*2;
  const h=(followPlayer?scene.height:Math.abs(scene.width*s)+Math.abs(scene.height*c))+pad*2+top;
  const scale=Math.min(width/w,height/h);
  return {c,s,scale,cx:width/2,cy:height/2+(followPlayer?0:top*scale/2),focusX:player?.x??scene.width/2,focusY:player?.y??scene.height/2};
}
export function worldToScreen(scene,t,x,y){x-=t.focusX;y-=t.focusY;return {x:t.cx+(x*t.c-y*t.s)*t.scale,y:t.cy+(x*t.s+y*t.c)*t.scale};}
export function screenToWorld(scene,t,x,y){x=(x-t.cx)/t.scale;y=(y-t.cy)/t.scale;return {x:x*t.c+y*t.s+t.focusX,y:-x*t.s+y*t.c+t.focusY};}
export function sortedObjects(scene){const r=scene.cameraRotation*Math.PI/180;return [...scene.objects].sort((a,b)=>(a.x-b.x)*Math.sin(r)+(a.y-b.y)*Math.cos(r));}
export function objectBounds(scene,t,o){const a=scene.assets.find(a=>a.id===o.assetId),p=worldToScreen(scene,t,o.x,o.y),s=o.scale*t.scale,b=projectedBounds(a.width,a.height,a.frames,o.rotation+scene.cameraRotation,90,a.spacing);return {x:p.x-b.width*s/2,y:p.y-b.planeHeight*s/2-(a.frames-1)*a.spacing*s,width:b.width*s,height:b.height*s};}
export function pickObject(scene,t,x,y){return sortedObjects(scene).reverse().find(o=>{const b=objectBounds(scene,t,o);return x>=b.x&&x<=b.x+b.width&&y>=b.y&&y<=b.y+b.height;})||null;}

export function drawScene(ctx,scene,images,{width=ctx.canvas.width,height=ctx.canvas.height,selected=null,grid=false,followPlayer=false}={}){
  ctx.clearRect(0,0,width,height);ctx.fillStyle='#151C19';ctx.fillRect(0,0,width,height);
  const t=sceneTransform(scene,width,height,{followPlayer});
  ctx.save();ctx.translate(t.cx,t.cy);ctx.scale(t.scale,t.scale);ctx.rotate(scene.cameraRotation*Math.PI/180);ctx.translate(-t.focusX,-t.focusY);
  ctx.fillStyle=scene.background;ctx.fillRect(0,0,scene.width,scene.height);
  for(const g of scene.ground){ctx.fillStyle=g.color;ctx.fillRect(g.x,g.y,g.width,g.height);}
  if(grid){ctx.strokeStyle='#FFFFFF15';ctx.lineWidth=1/t.scale;ctx.beginPath();for(let x=0;x<=scene.width;x+=32){ctx.moveTo(x,0);ctx.lineTo(x,scene.height);}for(let y=0;y<=scene.height;y+=32){ctx.moveTo(0,y);ctx.lineTo(scene.width,y);}ctx.stroke();}
  ctx.restore();
  const assets=new Map(scene.assets.map(a=>[a.id,a]));
  for(const o of sortedObjects(scene)){
    const a=assets.get(o.assetId),image=images.get(o.assetId);if(!a||!image)continue;
    const p=worldToScreen(scene,t,o.x,o.y);
    const bob=followPlayer&&o.id===scene.playerId?(controllerStates.get(scene)?.bob||0):0;
    drawStack(ctx,image,getFrameRects(a.width*a.frames,a.height,a.width),{x:p.x,y:p.y-bob*o.scale*t.scale,rotation:o.rotation+scene.cameraRotation,scale:o.scale*t.scale,spacing:a.spacing});
    if(o.id===selected){const b=objectBounds(scene,t,o);ctx.strokeStyle='#D3F99E';ctx.lineWidth=2;ctx.strokeRect(b.x-3,b.y-3,b.width+6,b.height+6);}
  }
  return t;
}

export function movePlayer(scene,keys,dt){
  dt=Math.max(0,Math.min(dt,.05));
  // cameraRotation is the screen's world rotation, i.e. -Globals.Rotation
  // in the supplied Godot controller. Q increases the Godot camera angle;
  // E decreases it. Object world angles stay separate.
  const turn=Number(keys.has('KeyE'))-Number(keys.has('KeyQ'));
  scene.cameraRotation=wrapAngle(scene.cameraRotation+turn*scene.controller.turnSpeed*dt);
  const p=scene.objects.find(o=>o.id===scene.playerId);if(!p)return;
  let motion=controllerStates.get(scene);
  if(!motion||motion.playerId!==p.id){motion={playerId:p.id,speed:0,time:0,targetAngle:p.rotation,bob:0};controllerStates.set(scene,motion);}
  motion.time+=dt;
  let x=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
  let y=Number(keys.has('KeyS')||keys.has('ArrowDown'))-Number(keys.has('KeyW')||keys.has('ArrowUp'));
  const length=Math.hypot(x,y),blend=1-Math.exp(-10*dt);
  motion.speed+=((length?scene.controller.speed:0)-motion.speed)*blend;
  let vx=0,vy=0;
  if(length){
    x/=length;y/=length;
    // Inverse camera transform: pressing Up always moves toward screen-up,
    // including while Q/E is held, exactly as input.rotated(Globals.Rotation).
    const r=-scene.cameraRotation*Math.PI/180;
    vx=x*Math.cos(r)-y*Math.sin(r);vy=x*Math.sin(r)+y*Math.cos(r);
    motion.targetAngle=Math.atan2(vy,vx)*180/Math.PI+90;
    motion.bob=scene.controller.mode==='free'?Math.sin(motion.time*15)*1.5:0;
  }else motion.bob*=1-blend;
  p.rotation=wrapAngle(p.rotation+wrapAngle(motion.targetAngle-p.rotation)*blend);
  if(!length)return;
  const dx=vx*motion.speed*dt,dy=vy*motion.speed*dt;
  const assets=new Map(scene.assets.map(a=>[a.id,a])),radius=Math.min(assets.get(p.assetId).radius*p.scale,scene.width/2,scene.height/2);
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const blocked=(x,y)=>scene.objects.some(o=>{
    if(!o.solid||o.id===p.id)return false;
    const sum=radius+assets.get(o.assetId).radius*o.scale;
    const next=Math.hypot(x-o.x,y-o.y),previous=Math.hypot(p.x-o.x,p.y-o.y);
    return next<sum&&next<previous; // Allow escape from an overlapping spawn.
  });
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/2));
  for(let i=0;i<steps;i++){
    const nx=clamp(p.x+dx/steps,radius,scene.width-radius);if(!blocked(nx,p.y))p.x=nx;
    const ny=clamp(p.y+dy/steps,radius,scene.height-radius);if(!blocked(p.x,ny))p.y=ny;
  }
}
