import test from 'node:test';
import assert from 'node:assert/strict';
import {createScene,validateScene,movePlayer,resetController,sceneTransform,worldToScreen,screenToWorld,drawScene,sceneData} from './scene.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(){
  const src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
  const scene=createScene();scene.assets=[{id:'sprite',name:'Test sprite',src,width:16,height:16,frames:3,spacing:1,radius:3}];
  scene.objects=[{id:'player',assetId:'sprite',x:300,y:200,rotation:0,scale:2,solid:false},{id:'tree',assetId:'sprite',x:500,y:230,rotation:30,scale:2,solid:true}];scene.playerId='player';return validateScene(scene);
}
test('Q/E orbit the world around the player at a fixed scale without mutating prop positions',()=>{
  const scene=fixture(),original=structuredClone(scene.objects),t0=sceneTransform(scene,960,504,{followPlayer:true});
  const tree0=worldToScreen(scene,t0,500,230);
  for(let i=0;i<20;i++)movePlayer(scene,new Set(['KeyQ']),.05);
  near(scene.cameraRotation,-114.6);assert.deepEqual(scene.objects,original);
  const t1=sceneTransform(scene,960,504,{followPlayer:true}),tree1=worldToScreen(scene,t1,500,230);
  near(t0.scale,t1.scale);near(Math.hypot(tree0.x-480,tree0.y-252),Math.hypot(tree1.x-480,tree1.y-252));assert.notEqual(tree0.x,tree1.x);
  const player=worldToScreen(scene,t1,300,200);near(player.x,480);near(player.y,252);
  for(let i=0;i<20;i++)movePlayer(scene,new Set(['KeyE']),.05);near(scene.cameraRotation,0);
});
test('holding Up during camera orbit still moves screen-up, and the camera follows the new position',()=>{
  const scene=fixture();
  for(let i=0;i<15;i++){
    const old={...scene.objects[0]};movePlayer(scene,new Set(['KeyW','KeyQ']),.016);
    const p=scene.objects[0],t=sceneTransform(scene,960,504,{followPlayer:true});
    const previous=worldToScreen(scene,t,old.x,old.y),current=worldToScreen(scene,t,p.x,p.y);
    near(previous.x,current.x);assert.ok(previous.y>current.y);near(current.x,480);near(current.y,252);
    const inverse=screenToWorld(scene,t,current.x,current.y);near(inverse.x,p.x);near(inverse.y,p.y);
  }
});
test('facing takes the short path across ±180°, and controller reset clears eased speed',()=>{
  const scene=fixture();scene.objects[0].rotation=179;scene.cameraRotation=179;
  movePlayer(scene,new Set(['KeyW']),.05);assert.ok(scene.objects[0].rotation>179&&scene.objects[0].rotation<180);
  const s=fixture(),start=s.objects[0].x;movePlayer(s,new Set(['KeyD']),.05);const first=s.objects[0].x-start;
  const before=s.objects[0].x;movePlayer(s,new Set(['KeyD']),.05);assert.ok(s.objects[0].x-before>first);
  resetController(s);s.objects[0].x=start;movePlayer(s,new Set(['KeyD']),.05);near(s.objects[0].x-start,first);
  assert.ok(!('bob' in sceneData(s)));assert.ok(!('speed' in sceneData(s)));
});
test('rendering rotates ground and every sprite plane while slice offsets remain screen-up',()=>{
  const scene=fixture();scene.cameraRotation=67;
  let matrix=[1,0,0,1,0,0];const saved=[],draws=[],fills=[];
  const ctx={canvas:{width:960,height:504},clearRect(){},fillRect(...args){fills.push({matrix:[...matrix],args});},
    save(){saved.push([...matrix]);},restore(){matrix=saved.pop();},
    translate(x,y){matrix[4]+=matrix[0]*x+matrix[2]*y;matrix[5]+=matrix[1]*x+matrix[3]*y;},
    scale(x,y){matrix[0]*=x;matrix[1]*=x;matrix[2]*=y;matrix[3]*=y;},
    rotate(r){const [a,b,c,d,e,f]=matrix,co=Math.cos(r),si=Math.sin(r);matrix=[a*co+c*si,b*co+d*si,-a*si+c*co,-b*si+d*co,e,f];},
    drawImage(...args){draws.push({matrix:[...matrix],args});}
  };
  const t=drawScene(ctx,scene,new Map([['sprite',{}]]),{followPlayer:true});
  const ground=fills[1].matrix;near(ground[0]/t.scale,Math.cos(67*Math.PI/180));near(ground[1]/t.scale,Math.sin(67*Math.PI/180));
  assert.equal(draws.length,6);
  for(const [j,o] of scene.objects.entries()){
    const p=worldToScreen(scene,t,o.x,o.y),scale=o.scale*t.scale,r=(o.rotation+67)*Math.PI/180;
    for(let layer=0;layer<3;layer++){
      const m=draws[j*3+layer].matrix;near(m[0],Math.cos(r)*scale);near(m[1],Math.sin(r)*scale);near(m[4],p.x);near(m[5],p.y-layer*scale);
    }
  }
  assert.equal(saved.length,0);
});
