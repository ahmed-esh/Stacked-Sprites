import {GenerationError,validateRequest,unwrapJSONFence} from './generation.js';
import {TEMPLATE_IDS,isTemplate} from './sprite-templates.js';
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const num={type:'number'},str={type:'string'};
export const scenePlanSchema=object({
  name:str,notes:str,width:{type:'integer'},height:{type:'integer'},background:str,
  controller:{type:'string',enum:['free','drive']},
  assets:{type:'array',items:object({id:str,name:str,description:str})},
  objects:{type:'array',items:object({assetId:str,x:num,y:num,rotation:num,scale:num,solid:{type:'boolean'},player:{type:'boolean'}})},
  ground:{type:'array',items:object({x:num,y:num,width:num,height:num,color:str})}
});
export function validatePlanRequest(raw){
  const input=validateRequest({...raw,generationMode:'freeform',templateId:'',inputMode:'text',size:32,layers:'auto',instructions:raw.description,maxOutputTokens:8000});
  const assetMode=raw.assetMode??'freeform';
  if(!['mixed','templates','freeform'].includes(assetMode))throw new GenerationError('Choose templates, mixed, or freeform scene assets.');
  const {width=960,height=504,maxAssets=4,maxObjects=80}=raw;
  if(![width,height].every(n=>Number.isInteger(n)&&n>=256&&n<=2048)||!Number.isInteger(maxAssets)||maxAssets<1||maxAssets>8||!Number.isInteger(maxObjects)||maxObjects<1||maxObjects>120)throw new GenerationError('Choose world dimensions of 256–2048 px, 1–8 unique sprites, and 1–120 placements.');
  return {...input,width,height,maxAssets,maxObjects,assetMode};
}
export function planContract(input){
  const mode=input.assetMode??'freeform',schema=structuredClone(scenePlanSchema);
  if(mode!=='freeform')schema.properties.assets.items=object({id:str,name:str,description:str,template:{type:'string',enum:[...TEMPLATE_IDS,...(mode==='mixed'?['freeform']:[])]}});
  return {name:'scene_plan',schema,instructions:`Design a playable 2D stacked-sprite environment from the user's description. Return only a JSON scene plan, never code. The world is exactly ${input.width} by ${input.height} pixels. Positions are ground-plane coordinates, x right and y down. Sprites are horizontal cross-sections stacked upward on Canvas 2D. This is not a 3D engine.
${mode==='freeform'?'All sprites use freeform contour generation.':`Each asset must declare template as chair, table, car, or tree${mode==='mixed'?', or freeform':''}. Templates construct stable parts locally; a separate model request customizes their bounded dimensions, colors, and details. Choose a template only when its structure fits: chair (four legs, seat, backrest, optional arms), table (four legs and top), car (four wheels and cabin), tree (trunk and round/conical crown). ${mode==='mixed'?'Use freeform for all other objects, such as animals or buildings. Never force them into an unrelated template.':'Use only these four template families. Omit unsupported objects and explain omissions in notes; do not silently relabel them as a template.'}`}
Use at most ${input.maxAssets} unique assets and ${input.maxObjects} object placements. Reuse an asset ID for repeated trees, houses, props, and obstacles: each unique asset requires a separate billed generation request; each reused placement is free. Return between 1 and ${input.maxAssets} assets, each with a simple lowercase id, short name, and 40–700 character description specifying its upright orientation, color, footprint width/depth, height, and structural parts. Assets will be drawn on a 32px square footprint; object scale can be .5 to 4. For a vehicle, front points toward negative y when rotation=0. Prioritize a recognizable controllable player, room to move, and coherent surroundings over intricate detail.
Place exactly one object with player=true. Set controller=drive for a vehicle (no bob), free for a walking character (gentle bob). Both move relative to the screen and face their movement direction. Q/E rotate the entire world around the player, not just the player sprite. Every other object has player=false. Solid props use approximate circular collision footprints: space them apart, and keep the player's spawn and intended paths clear. Keep objects well inside world bounds; leave at least 32px margin. Angles are degrees, -180 to 180. Do not overlap the player with obstacles.
Use up to 32 simple ground rectangles for roads, lanes, grass patches, paths, or sidewalks. These are locally painted Canvas 2D shapes and need no asset request. All ground rectangles must fit entirely within the world. Colors are opaque #RRGGBB. The background is also #RRGGBB. For roads use a broad dark rectangle and small contrasting lane markings; put scenery beside it. Keep the scene's density appropriate to the available world area.
The JSON must match the supplied schema. Set width=${input.width}, height=${input.height}, name to a brief label, and notes to a concise explanation of layout and controls. Asset descriptions must be standalone; each will be sent separately to the slice generator. Every asset must be placed at least once. Never invent asset IDs not in the assets array. Stay within 8,000 output tokens.`};}
export function validatePlan(plan,expected){
  const bad=m=>{throw new GenerationError(`Invalid scene plan: ${m}`,502);};
  const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
  if(!plan||typeof plan.name!=='string'||!plan.name.trim()||plan.name.length>120||typeof plan.notes!=='string'||plan.notes.length>2000)bad('missing name or notes.');
  if(plan.width!==expected.width||plan.height!==expected.height||!/^#[0-9a-fA-F]{6}$/.test(plan.background)||!['free','drive'].includes(plan.controller))bad('world settings do not match the request.');
  if(!Array.isArray(plan.assets)||!plan.assets.length||plan.assets.length>expected.maxAssets||!Array.isArray(plan.objects)||!plan.objects.length||plan.objects.length>expected.maxObjects||!Array.isArray(plan.ground)||plan.ground.length>32)bad('asset or placement budget exceeded.');
  const ids=new Set();for(const a of plan.assets){if(!a||typeof a.id!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(a.id)||ids.has(a.id)||typeof a.name!=='string'||!a.name.trim()||a.name.length>100||typeof a.description!=='string'||a.description.length<40||a.description.length>700)bad('invalid asset description or duplicate ID.');ids.add(a.id);}
  for(const a of plan.assets){
    const mode=expected.assetMode??'freeform';
    if(mode==='templates'&&!isTemplate(a.template)||mode==='mixed'&&!(isTemplate(a.template)||a.template==='freeform')||mode==='freeform'&&a.template!==undefined&&a.template!=='freeform')bad('asset construction does not match the selected mode.');
  }
  let players=0;const used=new Set();
  for(const o of plan.objects){if(!o||!ids.has(o.assetId)||!finite(o.x,0,plan.width)||!finite(o.y,0,plan.height)||!finite(o.rotation,-180,180)||!finite(o.scale,.5,4)||typeof o.solid!=='boolean'||typeof o.player!=='boolean')bad('invalid object placement.');used.add(o.assetId);if(o.player)players++;}
  if(players!==1||used.size!==ids.size)bad('choose one player and use every asset.');
  for(const g of plan.ground)if(!g||!finite(g.x,0,plan.width)||!finite(g.y,0,plan.height)||!finite(g.width,1,plan.width)||!finite(g.height,1,plan.height)||g.x+g.width>plan.width||g.y+g.height>plan.height||!/^#[0-9a-fA-F]{6}$/.test(g.color))bad('ground rectangles exceed world bounds.');
  return plan;
}
export function parsePlan(text,expected){if(typeof text!=='string'||text.length>2_000_000)throw new GenerationError('The model returned an unreadable scene plan.',502);let data;try{data=JSON.parse(unwrapJSONFence(text));}catch{throw new GenerationError('The model returned an unreadable scene plan.',502);}return validatePlan(data,expected);}
