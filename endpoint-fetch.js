import https from 'node:https';
import {lookup} from 'node:dns';
import {isIP} from 'node:net';
import {GenerationError} from './generation.js';

export function isPublicAddress(address) {
  if(isIP(address)===4){
    const [a,b]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===198&&(b===18||b===19)));
  }
  if(isIP(address)===6){
    const lower=address.toLowerCase(),first=parseInt(lower.split(':')[0],16);
    return first>=0x2000&&first<=0x3fff&&!lower.startsWith('2001:db8:')&&!lower.startsWith('2001:0:')&&!lower.startsWith('2002:');
  }
  return false;
}
// Pin the socket lookup to checked public addresses, preventing DNS rebinding.
export function publicLookup(host,options,callback) {
  lookup(host,{all:true,verbatim:true},(error,addresses)=>{
    if(error)return callback(error);
    if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))return callback(new GenerationError('Custom endpoints must resolve only to public addresses. Use a local provider preset for local inference.'));
    if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);
  });
}
export function fetchCustom(url,{headers,body,signal,method='POST'}) {
  return new Promise((resolve,reject)=>{
    const request=https.request(url,{method,headers,signal,lookup:publicLookup},response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>4_000_000){response.destroy();reject(new GenerationError('Provider response is too large.',502));}else chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>{try{resolve(new Response([204,205,304].includes(response.statusCode)?null:Buffer.concat(chunks),{status:response.statusCode,headers:{'Content-Type':'application/json'}}));}catch(error){reject(error);}});
    });
    request.on('error',reject);request.end(body);
  });
}
