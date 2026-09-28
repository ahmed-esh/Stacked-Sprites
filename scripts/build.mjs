import {mkdir,readdir,copyFile} from 'node:fs/promises';
import {RUNTIME_FILES} from '../public-files.js';

// Refuse unexpected output files rather than accidentally shipping stale files
// or deleting a directory that the operator uses for something else.
const output=new URL('../dist/',import.meta.url);
await mkdir(output,{recursive:true});
for(const name of await readdir(output)){
  if(!RUNTIME_FILES.includes(name))throw new Error(`Unexpected dist/${name}; move it out before building.`);
}
for(const name of RUNTIME_FILES)await copyFile(new URL(`../${name}`,import.meta.url),new URL(name,output));
console.log(`Built ${RUNTIME_FILES.length} runtime files in dist/ (no tests or development assets).`);
