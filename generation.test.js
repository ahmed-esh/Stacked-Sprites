import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest,validateRecipe,validateRequest,parseResponse,parseRecipeText,rasterizeRecipe,inspectRecipe,MAX_REFERENCE_BYTES,MAX_REQUEST_BODY_BYTES,POLYGON_TABLE_EXAMPLE} from './generation.js';

export const tableRecipe = () => ({name:'Oak table',notes:'Simplified light oak with four legs.',size:16,layers:16,bands:[
  {from:0,to:12,rectangles:[[2,2],[12,2],[2,12],[12,12]].map(([x,y])=>({x,y,width:2,height:2,color:'#AD8050'}))},
  {from:13,to:15,rectangles:[{x:1,y:1,width:14,height:14,color:'#DBAD73'},{x:2,y:2,width:12,height:1,color:'#F0D1A0'}]}
]});
const input={image:'data:image/png;base64,YWJj',size:16,layers:16,instructions:'Light oak table'};

test('the exact polygon prompt example has four separated legs, a connected top, and an empty corner',()=>{
  const prompt=buildRequest(input).instructions;
  assert.ok(prompt.includes(JSON.stringify(POLYGON_TABLE_EXAMPLE)));
  validateRecipe(POLYGON_TABLE_EXAMPLE,{recipeVersion:2,size:16,layers:12});
  const raster=rasterizeRecipe(POLYGON_TABLE_EXAMPLE,{shadeHeight:false});
  const alpha=(z,x,y)=>raster.pixels[(y*raster.width+z*16+x)*4+3];
  for(const [x,y] of [[2,4],[12,4],[2,10],[7,10]])for(const z of [0,8,9])assert.equal(alpha(z,x,y),255);
  assert.equal(alpha(8,8,7),0);assert.equal(alpha(9,8,7),255);
  assert.equal(alpha(11,12,11),0);assert.equal(alpha(11,8,11),255);
  assert.deepEqual(inspectRecipe(POLYGON_TABLE_EXAMPLE,raster),{components:1,warnings:[]});
});

test('sprite JSON accepts LF and CRLF fences but rejects surrounding prose and malformed JSON',()=>{
  const recipe=tableRecipe(),json=JSON.stringify(recipe,null,2);
  for(const newline of ['\n','\r\n'])for(const language of ['','json','JSON']) {
    const fenced=`\`\`\`${language}${newline}${json.replaceAll('\n',newline)}${newline}\`\`\``;
    assert.deepEqual(parseRecipeText(`  ${fenced}  `,input),recipe);
    for(const bad of [`Here is your recipe: ${fenced}`,`${fenced}\nExtra text`,fenced.replace('"name"','name')])assert.throws(()=>parseRecipeText(bad,input),/unreadable slices/);
  }
});
test('reference limits measure decoded bytes and reserve room for JSON and base64',()=>{
  for(const type of ['png','jpeg','webp']) {
    const image=`data:image/${type};base64,${Buffer.alloc(MAX_REFERENCE_BYTES).toString('base64')}`;
    const request={...input,image,instructions:'\u0000'.repeat(2000),endpoint:'x'.repeat(1000)};
    assert.equal(validateRequest(request).image,image);
    assert.ok(Buffer.byteLength(JSON.stringify(request))<MAX_REQUEST_BODY_BYTES);
  }
  const oversized=`data:image/png;base64,${Buffer.alloc(MAX_REFERENCE_BYTES+1).toString('base64')}`;
  assert.throws(()=>validateRequest({...input,image:oversized}),/up to 4 MB/);
  for(const base64 of ['Y','YWJj=','===','YWJj!!'])assert.throws(()=>validateRequest({...input,image:`data:image/png;base64,${base64}`}),/valid reference image/);
});

test('request includes vision reference and strict slice schema without retaining responses',()=>{
  const request=buildRequest(input);
  assert.equal(request.store,false);assert.equal(request.model,'gpt-4.1');
  assert.equal(request.input[0].content[1].image_url,input.image);
  assert.equal(request.text.format.strict,true);assert.equal(request.text.format.schema.additionalProperties,false);
});
test('request rejects remote image URLs, arbitrary sizes, excessive prompts, and invalid model IDs',()=>{
  for(const change of [{image:'http://localhost/private'},{size:4096},{layers:10000},{instructions:'x'.repeat(2001)},{model:'bad\nmodel'}])assert.throws(()=>validateRequest({...input,...change}));
});
test('recipe validation rejects gaps, overlaps, out-of-bounds rectangles, script colors, and mismatched dimensions',()=>{
  const mutations=[r=>r.bands[1].from=14,r=>r.bands[1].from=12,r=>r.bands[0].rectangles[0].width=100,r=>r.bands[0].rectangles[0].color='url(javascript:alert(1))',r=>r.bands[1].to=14,r=>r.bands[0].rectangles=[]];
  for(const mutate of mutations){const r=tableRecipe();mutate(r);assert.throws(()=>validateRecipe(r));}
  assert.throws(()=>validateRecipe(tableRecipe(),{size:32}));
});
test('rasterizer preserves transparent leg gaps, layer order, and later highlight overlays',()=>{
  const {pixels,width,height}=rasterizeRecipe(tableRecipe());
  assert.equal(width,256);assert.equal(height,16);
  const pixel=(layer,x,y)=>Array.from(pixels.slice((y*width+layer*16+x)*4,(y*width+layer*16+x)*4+4));
  assert.deepEqual(pixel(0,2,2),[173,128,80,255]);
  assert.deepEqual(pixel(12,8,8),[0,0,0,0]);
  assert.deepEqual(pixel(13,8,8),[219,173,115,255]);
  assert.deepEqual(pixel(15,2,2),[240,209,160,255]);
  assert.deepEqual(pixel(15,0,0),[0,0,0,0]);
});
test('provider refusal, incomplete output, and malformed output never become a stack',()=>{
  for(const response of [{status:'incomplete'},{status:'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]},{status:'completed',output:[{content:[{type:'output_text',text:'broken json'}]}]}])assert.throws(()=>parseResponse(response,input));
  assert.deepEqual(parseResponse({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(tableRecipe())}]}]},input),tableRecipe());
});

test('automatic height accepts natural proportions within a bounded layer budget; fixed height remains exact',()=>{
  const request={...input,layers:'auto'},recipe=tableRecipe();
  recipe.layers=9;recipe.bands[0].to=6;recipe.bands[1].from=7;recipe.bands[1].to=8;
  assert.equal(validateRequest(request).layers,'auto');
  assert.equal(validateRecipe(recipe,request).layers,9);
  assert.match(buildRequest(request).instructions,/between 2 and 32/);
  assert.throws(()=>validateRecipe(recipe,input));
  for(const layers of [1,33,97,8.5,'auto'])assert.throws(()=>validateRecipe({...recipe,layers,bands:[{...recipe.bands[0],from:0,to:layers-1}]},request));
});

test('geometry inspection treats four legs joined by a top as one object, preserving negative space',()=>{
  assert.deepEqual(inspectRecipe(tableRecipe()),{components:1,warnings:[]});
});

test('geometry inspection flags detached upper parts, empty gaps, and silhouette-only extrusion locally',()=>{
  const floating=tableRecipe();floating.bands[1].rectangles=[{x:6,y:6,width:2,height:2,color:'#DBAD73'}];
  assert.equal(inspectRecipe(floating).components,5);
  assert.match(inspectRecipe(floating).warnings.join(' '),/separate pixel groups/);
  const gap=tableRecipe();gap.bands[0].to=11;gap.bands.splice(1,0,{from:12,to:12,rectangles:[]});
  assert.match(inspectRecipe(gap).warnings.join(' '),/Empty layers \(13\)/);
  const extrusion=tableRecipe();extrusion.bands=[{from:0,to:15,rectangles:[{x:0,y:1,width:14,height:14,color:'#DBAD73'}]}];
  const warnings=inspectRecipe(extrusion).warnings.join(' ');
  assert.match(warnings,/same silhouette/);assert.match(warnings,/frame edge/);
});
