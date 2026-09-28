import {sceneData,validateScene} from './scene.js';
const encoder=new TextEncoder();
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^table[(crc^byte)&255];return(crc^0xffffffff)>>>0;}
export function zipFiles(files){
  const local=[],central=[];let offset=0,centralSize=0;
  for(const file of files){
    if(!/^[a-zA-Z0-9_./-]+$/.test(file.name)||file.name.startsWith('/')||file.name.split('/').includes('..'))throw new Error('Unsafe export filename.');
    const name=encoder.encode(file.name),bytes=typeof file.data==='string'?encoder.encode(file.data):file.data,crc=crc32(bytes);
    const header=new Uint8Array(30),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);
    const record=new Uint8Array(46),r=new DataView(record.buffer);r.setUint32(0,0x02014b50,true);r.setUint16(4,20,true);r.setUint16(6,20,true);r.setUint16(14,33,true);r.setUint32(16,crc,true);r.setUint32(20,bytes.length,true);r.setUint32(24,bytes.length,true);r.setUint16(28,name.length,true);r.setUint32(42,offset,true);
    local.push(header,name,bytes);central.push(record,name);offset+=header.length+name.length+bytes.length;centralSize+=record.length+name.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new Blob([...local,...central,end],{type:'application/zip'});
}
const boot=`
const scene=validateScene(window.STACKED_SCENE,{allowFiles:true});
const initial=sceneData(scene),canvas=document.getElementById('game'),ctx=canvas.getContext('2d');
canvas.width=scene.width;canvas.height=scene.height;
const images=new Map(),keys=new Set();
Promise.all(scene.assets.map(a=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images.set(a.id,image);resolve();};image.onerror=reject;image.src=a.src;}))).then(()=>{
  let previous=0;
  function frame(now){movePlayer(scene,keys,previous?(now-previous)/1000:0);previous=now;drawScene(ctx,scene,images,{followPlayer:true});requestAnimationFrame(frame);}
  requestAnimationFrame(frame);canvas.focus();
}).catch(()=>document.getElementById('status').textContent='A sprite could not load. Keep the assets folder beside index.html.');
canvas.addEventListener('keydown',event=>{if(sceneKeys.has(event.code)){event.preventDefault();keys.add(event.code);}});
window.addEventListener('keyup',event=>keys.delete(event.code));
canvas.addEventListener('blur',()=>keys.clear());window.addEventListener('blur',()=>keys.clear());
document.addEventListener('visibilitychange',()=>keys.clear());
document.getElementById('reset').onclick=()=>{scene.objects=structuredClone(initial.objects);scene.cameraRotation=initial.cameraRotation;resetController(scene);keys.clear();canvas.focus();};
for(const [id,delta] of [['left',-45],['right',45]])document.getElementById(id).onclick=()=>{scene.cameraRotation=((scene.cameraRotation+delta+540)%360)-180;canvas.focus();};
document.getElementById('name').textContent=scene.name;
document.getElementById('status').textContent=scene.playerId?'Click the scene. WASD / arrows move relative to the screen; Q / E rotate the whole world. The camera follows the player, who turns toward movement.':'No player assigned. This is a scene preview.';
`;
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stacked scene</title><style>body{margin:0;padding:24px;background:#111915;color:#e0ebdd;font:15px system-ui;text-align:center}canvas{display:block;width:min(100%,1200px);height:auto;margin:20px auto;image-rendering:pixelated;outline:1px solid #50614e}button{background:#263b2d;color:inherit;border:1px solid #6b8767;border-radius:5px;padding:10px;margin:4px;cursor:pointer}canvas:focus-visible,button:focus-visible{outline:3px solid #bce993}</style><h1 id="name">Stacked scene</h1><p id="status">Loading sprites…</p><canvas id="game" tabindex="0" aria-label="Playable 2D sprite environment"></canvas><button id="left">Rotate view ↶</button><button id="right">Rotate view ↷</button><button id="reset">Reset scene</button><script src="scene-data.js"></script><script src="game.js"></script></html>`;

// Restricted converter for our two fixed local modules, never model output.
// Supports multiline named imports without aliases and declaration exports.
// New module syntax/dependencies need deliberate support here and an export test.
function classic(source,dependencies={}) {
  const unsupported=()=>{throw new Error('Unsupported export runtime module syntax. Update the scene exporter before exporting this runtime.');};
  const result=source.replace(/^[ \t]*import\s*\{([^}]*)\}\s*from\s*(['"])([^'"\r\n]+)\2\s*;[ \t]*/gm,(_,bindings,quote,path)=>{
    const names=bindings.trim().replace(/,$/,'').split(',').map(name=>name.trim());
    if(!Object.hasOwn(dependencies,path)||names.some(name=>!dependencies[path].has(name)))unsupported();
    return '';
  }).replace(/^[ \t]*export\s+(?=(?:const|let|function|class)\s)/gm,'');
  if(/^\s*(?:import|export)\b/m.test(result))unsupported();
  return result;
}

export async function exportScene(scene,fetchText=async path=>{const r=await fetch(path);if(!r.ok)throw new Error('Could not load the export runtime.');return r.text();}){
  validateScene(scene);
  const data=sceneData(scene),files=[],root='stacked-scene/';
  data.assets.forEach((asset,i)=>{const bytes=Uint8Array.from(atob(asset.src.split(',')[1]),c=>c.charCodeAt(0));asset.src=`assets/sprite-${i}.png`;files.push({name:root+asset.src,data:bytes});});
  const [stack,runtime]=await Promise.all([fetchText('/stack.js'),fetchText('/scene.js')]);
  const stackExports=new Set(Array.from(stack.matchAll(/^[ \t]*export\s+(?:const|let|function|class)\s+([a-zA-Z_$][\w$]*)/gm),match=>match[1]));
  files.push({name:root+'index.html',data:html},{name:root+'scene-data.js',data:`window.STACKED_SCENE=${JSON.stringify(data,null,2)};\n`},{name:root+'game.js',data:`(()=>{\n'use strict';\n${classic(stack)}\n${classic(runtime,{'./stack.js':stackExports})}\n${boot}\n})();`},
    {name:root+'README.txt',data:'Open index.html directly in a modern browser, or serve this folder as a static website. No build, dependencies, API key, or model calls are needed.\n\nWASD / arrow keys move relative to the screen. Q / E rotate the whole world around the player at fixed zoom. The player turns smoothly toward movement. The camera follows the player and stacked layers stay screen-up. Walking mode adds a gentle bob; Vehicle mode disables bob. View buttons also rotate the environment. Reset restores positions and camera angle. Circular collisions apply to solid objects.\n\nEdit scene-data.js to change world dimensions, placements, playerId, controls, and colors. PNG sheets are in assets/. Each sheet is ordered bottom-to-top with equal-width frames. game.js contains the Canvas 2D renderer and controller shared with the editor. No 3D engine is used.\n'});
  return zipFiles(files);
}
