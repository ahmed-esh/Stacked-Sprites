import {isIP} from 'node:net';
import {GenerationError} from './generation.js';

const integer=(env,name,fallback,min,max)=>{
  const raw=env[name]??String(fallback),value=Number(raw);
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
};
export function readConfig(env=process.env){
  const production=env.NODE_ENV==='production';let origin=null;
  if(production){
    let parsed;try{parsed=new URL(env.PUBLIC_ORIGIN);}catch{throw new Error('Production requires PUBLIC_ORIGIN=https://your-domain.example.');}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error('PUBLIC_ORIGIN must be a single HTTPS origin without a path, credentials, query, or fragment.');
    origin=parsed.origin;
  }
  const custom=env.ALLOW_CUSTOM_ENDPOINTS;
  if(custom!==undefined&&!['true','false'].includes(custom))throw new Error('ALLOW_CUSTOM_ENDPOINTS must be true or false.');
  return {production,origin,port:integer(env,'PORT',5173,1,65535),host:production?'0.0.0.0':'127.0.0.1',
    allowLocalProviders:!production,allowCustomEndpoints:custom===undefined?!production:custom==='true',
    trustProxyHops:integer(env,'TRUST_PROXY_HOPS',0,0,5),rateLimit:integer(env,'API_REQUESTS_PER_MINUTE',30,1,1000),
    maxActive:integer(env,'MAX_ACTIVE_REQUESTS',8,1,64),maxPerClient:integer(env,'MAX_ACTIVE_PER_CLIENT',2,1,16)};
}
export function requestOrigin(req,config){
  const host=req.headers.host||'';
  if(config.production){if(host!==new URL(config.origin).host)throw new GenerationError('Unrecognized host.',403);return config.origin;}
  if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))throw new GenerationError('This server only accepts local requests.',403);
  return `http://${host}`;
}
export function clientAddress(req,hops=0){
  const remote=req.socket.remoteAddress||'unknown';
  if(!hops)return remote;
  const forwarded=req.headers['x-forwarded-for'];
  if(typeof forwarded!=='string')return remote;
  const addresses=forwarded.split(',').map(s=>s.trim());
  // Trust exactly the configured number of ingress hops, never the leftmost
  // user-supplied address. The operator must block direct public access to Node.
  if(addresses.length<hops||addresses.some(a=>!isIP(a)))return remote;
  return addresses[addresses.length-hops];
}
export function createAdmission(config,{now=Date.now,maxClients=10000}={}){
  const clients=new Map();let active=0;
  return address=>{
    const time=now();let client=clients.get(address);
    if(!client){
      if(clients.size>=maxClients)for(const [key,c] of clients)if(c.active===0&&time-c.start>=60000)clients.delete(key);
      if(clients.size>=maxClients)throw new GenerationError('Server is busy. Try again shortly.',503);
      client={start:time,count:0,active:0};clients.set(address,client);
    }
    if(time-client.start>=60000){client.start=time;client.count=0;}
    if(client.count>=config.rateLimit)throw new GenerationError('Too many API requests. Try again in a minute.',429);
    client.count++;
    if(client.active>=config.maxPerClient)throw new GenerationError('Too many simultaneous requests. Wait for your current requests to finish.',429);
    if(active>=config.maxActive)throw new GenerationError('Server is busy. Try again shortly.',503);
    active++;client.active++;let released=false;
    return ()=>{if(!released){released=true;active--;client.active--;}};
  };
}
export async function readProviderJSON(response,limit=4_000_000){
  const reader=response.body?.getReader();if(!reader)throw new GenerationError('The provider returned an empty response.',502);
  const chunks=[];let bytes=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw new GenerationError('Provider response is too large.',502);chunks.push(value);}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new GenerationError('The provider returned unreadable JSON.',502);}
    if(!data||typeof data!=='object')throw new GenerationError('The provider returned unreadable JSON.',502);
    return data;
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
