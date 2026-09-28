import test from 'node:test';
import assert from 'node:assert/strict';
import {contourAt} from './contours.js';
import {validateRecipe,rasterizeRecipe,inspectRecipe,buildRequest,validateRequest} from './generation.js';
import {SAMPLE_RECIPES} from './sample-recipes.js';

const polygon=(z,x,y,w,h)=>({z,points:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
const rgba=(raster,z,x,y)=>Array.from(raster.pixels.slice((y*raster.width+z*raster.height+x)*4,(y*raster.width+z*raster.height+x)*4+4));

test('interpolated sections grow and move in a shared coordinate system, only within their height range',()=>{
  const part={sections:[polygon(2,1,2,2,4),polygon(6,5,4,6,8)]};
  assert.equal(contourAt(part,1),null);assert.equal(contourAt(part,7),null);
  assert.deepEqual(contourAt(part,4),polygon(4,3,3,4,6).points);
  assert.deepEqual(contourAt(part,2),part.sections[0].points);
});

test('rounded vessel slices expand then narrow, with a hollow neck and solid base',()=>{
  const recipe=SAMPLE_RECIPES.vase,raster=rasterizeRecipe(recipe);
  assert.ok(raster.occupiedLayers[0]<raster.occupiedLayers[9]);
  assert.ok(raster.occupiedLayers[14]>raster.occupiedLayers[20]);
  assert.equal(rgba(raster,0,16,16)[3],255);
  assert.deepEqual(rgba(raster,27,16,16),[0,0,0,0]);
  assert.equal(rgba(raster,27,10,15)[3],255);
  assert.equal(inspectRecipe(recipe,raster).components,1);
  assert.deepEqual(inspectRecipe(recipe,raster).warnings,[]);
});

test('curved arch retains an open center and front across heights instead of filling an extruded silhouette',()=>{
  const recipe=SAMPLE_RECIPES.arch,raster=rasterizeRecipe(recipe);
  for(const z of [0,7,13]){
    assert.equal(rgba(raster,z,16,6)[3],255,'rear curved wall remains');
    assert.equal(rgba(raster,z,16,14)[3],0,'inner arch stays hollow');
    assert.equal(rgba(raster,z,16,26)[3],0,'front opening stays clear');
  }
  assert.ok(raster.occupiedLayers[13]<raster.occupiedLayers[0]);
  assert.equal(inspectRecipe(recipe,raster).components,1);
});

test('polygon leg footprints join the tabletop only at its height and retain empty space below',()=>{
  const recipe={version:2,name:'Table',notes:'Four legs and a top.',size:16,layers:16,parts:[
    ...[[2,2],[12,2],[2,12],[12,12]].map(([x,y],i)=>({name:`Leg ${i}`,shape:'polygon',operation:'paint',color:'#AD8050',sections:[polygon(0,x,y,2,2),polygon(13,x,y,2,2)]})),
    {name:'Top',shape:'polygon',operation:'paint',color:'#DBAD73',sections:[polygon(13,1,1,14,14),polygon(15,1,1,14,14)]}
  ]};
  const raster=rasterizeRecipe(recipe,{shadeHeight:false});
  assert.deepEqual(rgba(raster,12,8,8),[0,0,0,0]);
  assert.deepEqual(rgba(raster,12,2,2),[173,128,80,255]);
  assert.deepEqual(rgba(raster,13,8,8),[219,173,115,255]);
  assert.deepEqual(inspectRecipe(recipe,raster),{components:1,warnings:[]});
});

test('contour validation rejects malformed parts and output with no occupied base or top',()=>{
  const edits=[
    r=>r.parts[0].shape='script',r=>r.parts[0].operation='execute',r=>r.parts[0].color='red',
    r=>r.parts[0].sections[0].z=-1,r=>r.parts[0].sections[1].z=0,
    r=>r.parts[0].sections[1].points.pop(),r=>r.parts[0].sections[1].points[0].x=NaN,
    r=>r.parts[0].sections[1].points[1].y=500,
    r=>r.parts[0].sections[0].points.reverse(),
    r=>r.parts[0].sections[0].z=1,
    r=>r.parts[0].operation='erase',r=>r.version=3
  ];
  for(const edit of edits){const r=structuredClone(SAMPLE_RECIPES.vase);edit(r);assert.throws(()=>validateRecipe(r));}
  const polygonPart={name:'Bent post',shape:'polygon',operation:'paint',color:'#987654',sections:[polygon(0,4,4,4,4),polygon(27,4,4,4,4)]};
  polygonPart.sections[1].points.pop();
  assert.throws(()=>validateRecipe({...SAMPLE_RECIPES.vase,parts:[polygonPart]}),/same vertex count/);
});

test('new generation requests require contour version 2 while saved band recipes remain readable',()=>{
  const input={size:16,layers:16,inputMode:'text',instructions:'An upright wooden table with four legs.'};
  const request=buildRequest(input);
  assert.equal(request.text.format.schema.properties.parts.type,'array');
  assert.equal(request.text.format.schema.properties.bands,undefined);
  const legacy={name:'Old stack',notes:'Old version.',size:16,layers:16,bands:[{from:0,to:15,rectangles:[{x:2,y:2,width:4,height:4,color:'#AABBCC'}]}]};
  assert.equal(validateRecipe(legacy),legacy);
  assert.throws(()=>validateRecipe(legacy,validateRequest(input)),/version 2/);
});

test('height shading darkens lower layers, preserving top colors and transparent openings',()=>{
  const raw=rasterizeRecipe(SAMPLE_RECIPES.vase,{shadeHeight:false});
  const shaded=rasterizeRecipe(SAMPLE_RECIPES.vase);
  assert.deepEqual(rgba(shaded,0,16,16),[126,95,59,255]);
  assert.deepEqual(rgba(shaded,27,10,15),rgba(raw,27,10,15));
  assert.deepEqual(rgba(shaded,27,16,16),[0,0,0,0]);
  assert.deepEqual(shaded.occupiedLayers,raw.occupiedLayers);
});
