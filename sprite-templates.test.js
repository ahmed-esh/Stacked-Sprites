import test from 'node:test';
import assert from 'node:assert/strict';
import {TEMPLATES,TEMPLATE_IDS,templateDefaults,compileTemplate,validateTemplateDesign} from './sprite-templates.js';
import {validateRecipe,rasterizeRecipe,inspectRecipe} from './generation.js';
const design=(id,parameters=templateDefaults(id))=>({version:1,template:id,name:`Test ${id}`,notes:'Local test.',parameters});
function check(id,p,size,layers){
  const recipe=compileTemplate(design(id,p),{size,layers});validateRecipe(recipe,{size,layers});
  const raster=rasterizeRecipe(recipe,{shadeHeight:false});
  assert.ok(raster.occupiedLayers.every(n=>n>0),`${id}: no empty layers`);
  assert.deepEqual(inspectRecipe(recipe,raster),{components:1,warnings:[]},`${id} ${size} ${layers} ${JSON.stringify(p)}`);
  return {recipe,raster};
}
for(const id of TEMPLATE_IDS)test(`${id} template remains connected and within margins across bounds, styles, sizes, and fixed heights`,()=>{
  const spec=TEMPLATES[id].parameters,defaults=templateDefaults(id),variants=[defaults];
  for(const bound of ['minimum','maximum'])variants.push(Object.fromEntries(Object.entries(spec).map(([k,v])=>[k,v.type==='integer'?v[bound]:v.default])));
  for(const [key,p] of Object.entries(spec))for(const value of p.enum??(p.type==='boolean'?[true,false]:p.type==='integer'?[p.minimum,p.maximum]:[]))variants.push({...defaults,[key]:value});
  // Deterministic mixed settings find interactions that one-field checks miss.
  let seed=17;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let n=0;n<12;n++)variants.push(Object.fromEntries(Object.entries(spec).map(([k,p])=>[k,p.type==='integer'?p.minimum+Math.floor(next()*(p.maximum-p.minimum+1)):p.enum?p.enum[Math.floor(next()*p.enum.length)]:p.type==='boolean'?next()>.5:p.default])));
  for(const p of variants)for(const size of [16,32,64])for(const layers of ['auto',16,24,32,48])check(id,p,size,layers);
});
test('templates reject missing, extra, out-of-range, non-finite and wrong-type parameters',()=>{
  for(const id of TEMPLATE_IDS){
    for(const mutate of [d=>delete d.parameters.width,d=>d.parameters.width=999,d=>d.parameters.width=NaN,d=>d.parameters.width='24',d=>d.parameters.extra=1,d=>d.parameters.bodyColor='url(x)',d=>d.parts=[],d=>d.version=2,d=>d.template='other']){
      const d=design(id);mutate(d);assert.throws(()=>validateTemplateDesign(d,id),/Invalid template design/);
    }
  }
});
test('table and chair keep four distinct leg footprints and a gap below the seat/top',()=>{
  for(const id of ['chair','table']){
    const {recipe,raster}=check(id,templateDefaults(id),32,'auto');
    const alpha=(z,x,y)=>raster.pixels[(y*raster.width+z*32+x)*4+3];
    assert.equal(alpha(0,16,16),0);
    const legs=recipe.parts.filter(p=>p.name.startsWith('Leg '));assert.equal(legs.length,4);
    for(const leg of legs){const p=leg.sections[0].points[0];assert.equal(alpha(0,p.x,p.y),255);}
    const surface=recipe.parts.find(p=>['Seat','Tabletop'].includes(p.name));assert.equal(alpha(surface.sections[0].z,16,16),255);
  }
});
