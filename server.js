import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {validateRequest, GenerationError, MAX_REQUEST_BODY_BYTES} from './generation.js';
import {buildValidatedProviderRequest,parseProviderResponse,tokenUsage,connection,parseModels} from './providers.js';
import {fetchCustom} from './endpoint-fetch.js';
import {validatePlanRequest,planContract,parsePlan} from './scene-generation.js';
import {getProvider} from './provider-catalog.js';
import {PUBLIC_FILES} from './public-files.js';
import {readConfig,requestOrigin,clientAddress,createAdmission,readProviderJSON} from './runtime-security.js';

const publicFiles = new Map(PUBLIC_FILES.map(name => [`/${name}`,name]));
const mime = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8'};
const json = (res,status,value) => { if(!res.destroyed) {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));} };

async function readJSON(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new GenerationError('Expected JSON.',415);
  let bytes=0;const chunks=[];
  for await (const chunk of req) {bytes+=chunk.length;if(bytes>MAX_REQUEST_BODY_BYTES)throw new GenerationError('Generation request is too large.',413);chunks.push(chunk);}
  let data;try { data=JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new GenerationError('Malformed request JSON.'); }
  if(!data||typeof data!=='object'||Array.isArray(data))throw new GenerationError('Expected a JSON settings object.');
  return data;
}

export function createApp({fetchImpl=fetch,customFetchImpl=fetchCustom,timeoutMs=180000,config=readConfig()}={}) {
  const activeKeys=new Set(),controllers=new Set(),admit=createAdmission(config);let draining=false;
  const server=http.createServer({requestTimeout:15000,headersTimeout:10000,keepAliveTimeout:5000,maxHeaderSize:16384,connectionsCheckingInterval:1000},async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    // Inline styles support the dynamic slider fills in app.js.
    // Review slider styling before removing this style-only allowance.
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if(config.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    let path;try{path=new URL(req.url,'http://localhost').pathname;}catch{return json(res,400,{error:'Invalid request URL.'});}
    // Liveness/readiness contains no application data and works for ingress probes.
    if(path==='/healthz'&&['GET','HEAD'].includes(req.method))return json(res,draining?503:200,{status:draining?'draining':'ok'});
    let origin;try{origin=requestOrigin(req,config);}catch(error){return json(res,error.status,{error:error.message});}
    if(path==='/api/generate'||path==='/api/models'||path==='/api/scene-plan') {
      if(req.method!=='POST')return json(res,405,{error:'Use POST for provider requests.'});
      if((config.production||req.headers.origin)&&req.headers.origin!==origin)return json(res,403,{error:'Cross-origin generation requests are not allowed.'});
      if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Cross-origin generation requests are not allowed.'});
      if(draining)return json(res,503,{error:'Server is restarting. Try again shortly.'});
      let release;try{release=admit(clientAddress(req,config.trustProxyHops));}catch(error){res.setHeader('Retry-After','60');return json(res,error.status,{error:error.message});}
      const controller=new AbortController();
      controllers.add(controller);
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      res.on('close',()=>controller.abort());
      let lock,usage;
      try {
        const authorization=req.headers.authorization || '';
        if(authorization&&!/^Bearer [\x21-\x7e]{1,4096}$/.test(authorization))throw new GenerationError('Invalid API key.',401);
        const key=authorization.slice(7), raw=await readJSON(req);
        const provider=getProvider(raw.provider||'openai');
        if(!provider)throw new GenerationError('Choose a supported provider.');
        if(provider.local&&!config.allowLocalProviders)throw new GenerationError('Local model providers are disabled on this hosted deployment. Run the app locally to use them.',403);
        if(provider.id==='custom'&&!config.allowCustomEndpoints)throw new GenerationError('Custom endpoints are disabled on this deployment.',403);
        let input,request;
        if(path==='/api/models'){
          input={provider:raw.provider||'openai'};const c=connection(input,key,true);
          request={url:c.url,headers:c.headers};
        }else{
          input=path==='/api/scene-plan'?validatePlanRequest(raw):validateRequest(raw);request=buildValidatedProviderRequest(input,key,path==='/api/scene-plan'?planContract(input):null);
          const identity=createHash('sha256').update(`${input.provider}\0${key}\0${input.endpoint}`).digest('hex');
          if(activeKeys.has(identity))throw new GenerationError('A generation is already running with this key. Wait or cancel it before starting another.',429);
          lock=identity;activeKeys.add(lock);
        }
        const upstream=await (input.provider==='custom'?customFetchImpl:fetchImpl)(request.url,{
          method:path==='/api/models'?'GET':'POST',headers:request.headers,
          ...(request.body?{body:JSON.stringify(request.body)}:{}),signal:controller.signal,redirect:'error'
        });
        if(!upstream.ok) {
          // Do not reflect upstream text: error bodies may contain credentials or input.
          const messages={400:'The provider rejected these settings. Check image support, output mode, and token limit for this model. No automatic retry was made.',401:'The API key was rejected. Check the key for this provider.',403:'This key does not have access to the selected model.',404:'The model or endpoint was not found. Load available models or check the model ID.',429:'The provider reports a rate or billing limit. Check your API account before retrying.'};
          await upstream.body?.cancel();
          throw new GenerationError(messages[upstream.status] || 'The generation provider is unavailable. Please try again later.',upstream.status>=500?502:upstream.status);
        }
        const response=await readProviderJSON(upstream);
        if(path==='/api/models'){json(res,200,{models:parseModels(response,input.provider),hasMore:Boolean(response.has_more||response.nextPageToken)});return;}
        usage=tokenUsage(response,input.provider);
        const result=parseProviderResponse(response,input,path==='/api/scene-plan'?parsePlan:undefined);
        json(res,200,{[path==='/api/scene-plan'?'plan':'recipe']:result,provider:input.provider,model:input.model,usage});
      } catch(error) {
        const status=error instanceof GenerationError?error.status:controller.signal.aborted?504:502;
        const message=error instanceof GenerationError?error.message:controller.signal.aborted?'Generation timed out. Try fewer layers.':'Could not reach the generation provider. Check your connection and try again.';
        json(res,status,{error:message,...(usage?{usage}:{})});
      } finally {clearTimeout(timer);controllers.delete(controller);release();if(lock)activeKeys.delete(lock);}
      return;
    }
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
    const name=publicFiles.get(path==='/'?'/index.html':path);
    if(!name)return json(res,404,{error:'Not found.'});
    try {
      let content=await readFile(new URL(name,import.meta.url));
      if(name==='index.html')content=Buffer.from(content.toString().replace(/(<script id="deployment-config" type="application\/json">)[\s\S]*?(<\/script>)/,(_,start,end)=>start+JSON.stringify({allowLocalProviders:config.allowLocalProviders,allowCustomEndpoints:config.allowCustomEndpoints})+end));
      res.writeHead(200,{'Content-Type':mime[name.split('.').at(-1)],'Cache-Control':'no-store'});
      res.end(req.method==='HEAD'?undefined:content);
    }catch{json(res,500,{error:'Could not load the application.'});}
  });
  server.maxHeadersCount=40;server.maxConnections=512;server.maxRequestsPerSocket=100;
  server.setTimeout(timeoutMs+15000,socket=>socket.destroy());
  server.shutdown=({graceMs=10000}={})=>new Promise(resolve=>{
    draining=true;
    const timer=setTimeout(()=>{for(const controller of controllers)controller.abort();server.closeAllConnections();},graceMs);timer.unref();
    server.close(()=>{clearTimeout(timer);resolve();});
  });
  return server;
}

if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  try{
    const config=readConfig(),server=createApp({config});
    server.listen(config.port,config.host,()=>console.log(`Stacked Studio: ${config.origin||`http://localhost:${config.port}`}`));
    server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${config.port} is in use.`:'Could not start the server.');process.exitCode=1;});
    let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(stopping)return;stopping=true;server.shutdown().then(()=>process.exit(0));});
  }catch(error){console.error(error.message);process.exitCode=1;}
}
