// Local inspection artifact using the same drawStack transforms as the app.
// No browser, model, external dependency, or API call is required.
import {writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {TEMPLATE_IDS,templateDefaults,compileTemplate} from '../sprite-templates.js';
import {rasterizeRecipe} from '../generation.js';
import {drawStack,getFrameRects} from '../stack.js';
import {crc32} from '../scene-export.js';
const cell=288,width=cell*4,height=cell*4,pixels=new Uint8Array(width*height*4);
for(let i=0;i<pixels.length;i+=4)pixels.set([30,37,32,255],i);
let matrix=[1,0,0,1,0,0];const saved=[];
const ctx={save(){saved.push([...matrix]);},restore(){matrix=saved.pop();},translate(x,y){matrix[4]+=matrix[0]*x+matrix[2]*y;matrix[5]+=matrix[1]*x+matrix[3]*y;},scale(x,y){matrix[0]*=x;matrix[1]*=x;matrix[2]*=y;matrix[3]*=y;},rotate(r){const [a,b,c,d,e,f]=matrix,co=Math.cos(r),si=Math.sin(r);matrix=[a*co+c*si,b*co+d*si,-a*si+c*co,-b*si+d*co,e,f];},drawImage(source,sx,sy,sw,sh,dx,dy,dw,dh){
  const [a,b,c,d,e,f]=matrix,det=a*d-b*c;
  const points=[[dx,dy],[dx+dw,dy],[dx,dy+dh],[dx+dw,dy+dh]].map(([x,y])=>[a*x+c*y+e,b*x+d*y+f]);
  const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))),right=Math.min(width,Math.ceil(Math.max(...points.map(p=>p[0]))));
  const top=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))),bottom=Math.min(height,Math.ceil(Math.max(...points.map(p=>p[1]))));
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
    const xx=x+.5-e,yy=y+.5-f,u=((d*xx-c*yy)/det-dx)/dw,v=((-b*xx+a*yy)/det-dy)/dh;
    if(u<0||u>=1||v<0||v>=1)continue;
    const sourceIndex=((sy+Math.floor(v*sh))*source.width+sx+Math.floor(u*sw))*4;
    if(source.pixels[sourceIndex+3])pixels.set(source.pixels.subarray(sourceIndex,sourceIndex+4),(y*width+x)*4);
  }
}};
for(const [row,id] of TEMPLATE_IDS.entries()){
  const recipe=compileTemplate({version:1,template:id,name:id,notes:'Local defaults; not AI output.',parameters:templateDefaults(id)}),source=rasterizeRecipe(recipe);
  for(const [col,rotation] of [0,45,135,225].entries())drawStack(ctx,source,getFrameRects(source.width,32,32),{x:col*cell+cell/2,y:row*cell+cell/2+(recipe.layers-1)*1.5,scale:3,rotation});
}
const chunk=(name,data)=>{const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const content=Buffer.concat([Buffer.from(name),data]),crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(content));return Buffer.concat([length,content,crc]);};
const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
const scanlines=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)scanlines.set(pixels.subarray(y*width*4,(y+1)*width*4),y*(width*4+1)+1);
await writeFile(new URL('../template-preview.png',import.meta.url),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scanlines)),chunk('IEND',Buffer.alloc(0))]));
console.log('template-preview.png: rows chair/table/car/tree; columns 0°, 45°, 135°, 225°. Local defaults, not AI output.');
