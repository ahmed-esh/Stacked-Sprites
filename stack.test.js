import test from 'node:test';
import assert from 'node:assert/strict';
import {getFrameRects, projectedBounds, drawStack, suggestSheet} from './stack.js';

test('horizontal sheet produces ordered, non-overlapping bottom-to-top source crops', () => {
  const frames=getFrameRects(1376,32,32);
  assert.equal(frames.length,43);
  assert.deepEqual(frames[0],{x:0,y:0,width:32,height:32});
  assert.deepEqual(frames[42],{x:1344,y:0,width:32,height:32});
});
test('vertical rectangular frames and trailing pixels are handled', () => {
  assert.deepEqual(getFrameRects(20,65,16,'vertical').at(-1),{x:0,y:48,width:20,height:16});
  assert.equal(getFrameRects(65,20,16).length,4);
});
test('invalid and excessively large slice counts are rejected', () => {
  for(const size of [0,-1,1.5,NaN,33]) assert.throws(()=>getFrameRects(32,32,size));
  assert.throws(()=>getFrameRects(1024,32,1));
});
test('export bounds include rotated planes and full stack height', () => {
  assert.deepEqual(projectedBounds(16,32,10,0,90,2),{width:16,height:50,planeHeight:32});
  const rotated=projectedBounds(16,32,10,90,30,2);
  assert.ok(Math.abs(rotated.width-32)<1e-10);
  assert.ok(Math.abs(rotated.height-26)<1e-10);
  assert.equal(projectedBounds(16,32,10,0,0,2).height,18);
});

test('classic drawing preserves full planes and rotates around a shared anchor with screen-up offsets',()=>{
  let matrix=[1,0,0,1,0,0];const saved=[],draws=[];
  const context={
    save(){saved.push([...matrix]);},restore(){matrix=saved.pop();},
    translate(x,y){matrix[4]+=matrix[0]*x+matrix[2]*y;matrix[5]+=matrix[1]*x+matrix[3]*y;},
    scale(x,y){matrix[0]*=x;matrix[1]*=x;matrix[2]*=y;matrix[3]*=y;},
    rotate(r){const [a,b,c,d,e,f]=matrix,co=Math.cos(r),si=Math.sin(r);matrix=[a*co+c*si,b*co+d*si,-a*si+c*co,-b*si+d*co,e,f];},
    drawImage(...args){draws.push({matrix:[...matrix],args});}
  };
  const frames=getFrameRects(48,16,16),source={};
  drawStack(context,source,frames,{x:100,y:80,scale:3,rotation:90});
  assert.equal(draws.length,3);
  for(let i=0;i<3;i++){
    const {matrix:m,args}=draws[i];
    assert.ok(Math.abs(m[0])<1e-10);assert.ok(Math.abs(m[3])<1e-10);
    assert.equal(m[1],3);assert.equal(m[2],-3);
    assert.deepEqual(m.slice(4),[100,80-i*3]);
    assert.deepEqual(args,[source,i*16,0,16,16,-8,-8,16,16]);
  }
  assert.deepEqual(matrix,[1,0,0,1,0,0]);assert.equal(saved.length,0);
});

test('sheet suggestions use exact square cells, while photos and partial frames remain manual',()=>{
  assert.deepEqual(suggestSheet(1376,32),{size:32,layout:'horizontal'});
  assert.deepEqual(suggestSheet(16,256),{size:16,layout:'vertical'});
  for(const [w,h] of [[600,330],[512,512],[65,16],[8192,16]])assert.equal(suggestSheet(w,h),null);
});
