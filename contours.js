// A recipe for 2D masks at selected heights, never a mesh or executable code.
// The same pure pixel sampler is used by the server validator and the browser.
export function validateParts(parts,size,layers,invalid) {
  if(!Array.isArray(parts)||!parts.length||parts.length>48)invalid('use 1–48 contour parts.');
  for(const part of parts) {
    if(!part||typeof part.name!=='string'||!part.name.trim()||part.name.length>120)invalid('each part needs a short name.');
    if(!['polygon','ellipse'].includes(part.shape)||!['paint','erase'].includes(part.operation))invalid('unknown contour shape or operation.');
    if(typeof part.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(part.color))invalid('a color is not #RRGGBB.');
    if(!Array.isArray(part.sections)||!part.sections.length||part.sections.length>16)invalid('use 1–16 height sections per part.');
    let previous=-1,pointCount;
    for(const section of part.sections) {
      if(!section||!Number.isInteger(section.z)||section.z<=previous||section.z>=layers)invalid('section heights must increase and stay within the stack.');
      const points=section.points;
      if(!Array.isArray(points)||(part.shape==='ellipse'?points.length!==2:points.length<3||points.length>24))invalid('an ellipse needs two bounding corners; a polygon needs 3–24 vertices.');
      if(pointCount!==undefined&&points.length!==pointCount)invalid('a part must keep the same vertex count across heights.');
      for(const p of points)if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>size||p.y>size)invalid('contour points must stay inside the slice canvas.');
      if(part.shape==='ellipse'&&(points[0].x>=points[1].x||points[0].y>=points[1].y))invalid('ellipse corners must define a positive width and depth.');
      previous=section.z;pointCount=points.length;
    }
  }
}

export function contourAt(part,z) {
  const sections=part.sections;
  if(z<sections[0].z||z>sections.at(-1).z)return null;
  const upper=sections.findIndex(section=>section.z>=z),b=sections[upper];
  if(b.z===z)return b.points;
  const a=sections[upper-1],t=(z-a.z)/(b.z-a.z);
  return a.points.map((p,i)=>({x:p.x+(b.points[i].x-p.x)*t,y:p.y+(b.points[i].y-p.y)*t}));
}

function contains(shape,points,x,y) {
  if(shape==='ellipse'){
    const [a,b]=points,rx=(b.x-a.x)/2,ry=(b.y-a.y)/2;
    return ((x-(a.x+b.x)/2)/rx)**2+((y-(a.y+b.y)/2)/ry)**2<=1;
  }
  // Even-odd fill sampled at pixel centers. No anti-aliasing or alpha fringes.
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}

export function rasterizeParts({size,layers,parts}) {
  const width=size*layers,pixels=new Uint8ClampedArray(width*size*4);
  const occupiedLayers=new Uint32Array(layers);
  for(let z=0;z<layers;z++){
    for(const part of parts){
      const points=contourAt(part,z);if(!points)continue;
      const rgb=part.operation==='erase'?[0,0,0]:[1,3,5].map(i=>parseInt(part.color.slice(i,i+2),16));
      const alpha=part.operation==='erase'?0:255;
      const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))));
      const right=Math.min(size,Math.ceil(Math.max(...points.map(p=>p.x))));
      const top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))));
      const bottom=Math.min(size,Math.ceil(Math.max(...points.map(p=>p.y))));
      for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
        if(!contains(part.shape,points,x+.5,y+.5))continue;
        const i=(y*width+z*size+x)*4;
        pixels[i]=rgb[0];pixels[i+1]=rgb[1];pixels[i+2]=rgb[2];pixels[i+3]=alpha;
      }
    }
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(pixels[(y*width+z*size+x)*4+3])occupiedLayers[z]++;
  }
  return {width,height:size,pixels,occupiedLayers};
}

// A gentle height ramp gives lower layers depth without alternating bright
// terrace pixels and dark side pixels, which produces noisy stripes on curves.
// It is stylized shading, not physical lighting; the top keeps its source color.
export function shadeLayers(raster) {
  const {width,height:size,pixels}=raster,layers=width/size;
  for(let z=0;z<layers-1;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*width+z*size+x)*4;
    if(!pixels[i+3])continue;
    const brightness=0.68+0.32*z/(layers-1);
    for(let channel=0;channel<3;channel++)pixels[i+channel]=Math.round(pixels[i+channel]*brightness);
  }
  return raster;
}
