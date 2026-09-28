import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {once} from 'node:events';
import http from 'node:http';
import {RUNTIME_FILES,PUBLIC_FILES} from '../public-files.js';
import {createApp} from '../dist/server.js';
import {readConfig} from '../dist/runtime-security.js';

assert.deepEqual((await readdir(new URL('../dist/',import.meta.url))).sort(),[...RUNTIME_FILES].sort());
// Verify every static relative module dependency ships in the runtime package.
for(const file of RUNTIME_FILES.filter(f=>f.endsWith('.js'))){
  const source=await readFile(new URL(`../dist/${file}`,import.meta.url),'utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*)['"]\.\/([^'"]+)['"]/g))assert.ok(RUNTIME_FILES.includes(match[1]),`${file} needs ${match[1]}`);
}
const server=createApp({config:readConfig({NODE_ENV:'production',PUBLIC_ORIGIN:'https://sprites.example.com'}),fetchImpl:()=>{throw new Error('Smoke check must not call providers');}});
server.listen(0,'127.0.0.1');await once(server,'listening');
try{
  for(const path of ['/healthz','/',...PUBLIC_FILES.map(f=>'/'+f),'/server.js','/.env']){
    const response=await new Promise((resolve,reject)=>{
      http.get({host:'127.0.0.1',port:server.address().port,path,headers:{Host:'sprites.example.com'}},res=>{res.resume();res.on('end',()=>resolve(res));}).on('error',reject);
    });
    assert.equal(response.statusCode,['/server.js','/.env'].includes(path)?404:200,path);
  }
}finally{await server.shutdown();}
console.log('Production build smoke check passed; no external API calls.');
