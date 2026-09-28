import test from 'node:test';
import assert from 'node:assert/strict';
import {PROVIDERS,availableFormats} from './provider-catalog.js';
import {buildProviderRequest,buildValidatedProviderRequest,parseProviderResponse,parseModels,tokenUsage,connection} from './providers.js';
import {validateRequest} from './generation.js';
import {isPublicAddress} from './endpoint-fetch.js';
import {templateDefaults,compileTemplate,TEMPLATE_IDS} from './sprite-templates.js';

const recipe={version:2,name:'Tapered column',notes:'Test fixture; no provider called.',size:16,layers:16,parts:[{name:'Column',shape:'ellipse',operation:'paint',color:'#BC9876',sections:[{z:0,points:[{x:4,y:4},{x:12,y:12}]},{z:15,points:[{x:1,y:1},{x:15,y:15}]}]}]};
const input={image:'data:image/png;base64,YWJj',size:16,layers:16,maxOutputTokens:4000};
const raw=provider=>({...input,provider:provider.id,model:provider.model||'vendor/vision-model',endpoint:provider.id==='custom'?'https://models.example.com/v1/chat/completions':''});
const completion={choices:[{finish_reason:'stop',message:{content:JSON.stringify(recipe)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}};

test('every connector carries bounded template contracts and compiles returned parameters locally',()=>{
  for(const provider of PROVIDERS)for(const id of TEMPLATE_IDS)for(const outputFormat of availableFormats(provider)){
    const request=buildProviderRequest({...raw(provider),generationMode:'template',templateId:id,outputFormat},'test-key');
    const body=JSON.stringify(request.body);assert.ok(body.includes('parameters'));assert.ok(body.includes('YWJj'));assert.doesNotMatch(body,/Rounded vessel|L-shaped table|"sections"/);
    const design={version:1,template:id,name:`Custom ${id}`,notes:'Mock response.',parameters:templateDefaults(id)},text=JSON.stringify(design);
    const responses={responses:{status:'completed',output:[{content:[{type:'output_text',text}]}]},anthropic:{stop_reason:'end_turn',content:[{type:'text',text}]},gemini:{candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]},cohere:{finish_reason:'COMPLETE',message:{content:[{type:'text',text}]}},chat:{choices:[{finish_reason:'stop',message:{content:text}}]}};
    assert.deepEqual(parseProviderResponse(responses[provider.protocol],request.input),compileTemplate(design,{size:16,layers:16}));
  }
});

test('DeepSeek thinking is opt-in, retains the token cap, and never reaches other connectors',()=>{
  const settings={...input,provider:'deepseek'};
  assert.deepEqual(buildProviderRequest(settings,'key').body.thinking,{type:'disabled'});
  for(const cap of [2000,8000,14000])for(const format of ['json','prompt']){
    const request=buildProviderRequest({...settings,thinking:'enabled',maxOutputTokens:cap,outputFormat:format},'key');
    assert.deepEqual(request.body.thinking,{type:'enabled'});assert.equal(request.body.max_tokens,cap);
    const response={...completion,choices:[{finish_reason:'stop',message:{content:JSON.stringify(recipe),reasoning_content:'Private reasoning is not a slice recipe.'}}]};
    assert.deepEqual(parseProviderResponse(response,request.input),recipe);
    assert.throws(()=>parseProviderResponse({...response,choices:[{finish_reason:'length'}]},request.input),/No retry/);
  }
  for(const thinking of [true,null,'auto','unlimited'])assert.throws(()=>validateRequest({...settings,thinking}),/Optional thinking/);
  for(const provider of PROVIDERS.filter(p=>p.id!=='deepseek')){
    assert.throws(()=>buildProviderRequest({...raw(provider),thinking:'enabled'},'key'),/Optional thinking/);
    assert.ok(!('thinking' in buildProviderRequest(raw(provider),'key').body));
  }
  assert.deepEqual(tokenUsage({usage:{prompt_tokens:100,completion_tokens:300,completion_tokens_details:{reasoning_tokens:200}}},'deepseek'),{inputTokens:100,outputTokens:300,totalTokens:400,cachedInputTokens:0,reasoningTokens:200});
});

test('validated internal requests preserve the public builder contract across providers',()=>{
  for(const provider of PROVIDERS){
    const request=raw(provider),normalized=validateRequest(request),before=structuredClone(normalized);
    assert.deepEqual(buildValidatedProviderRequest(normalized,'test-key'),buildProviderRequest(request,'test-key'));
    assert.deepEqual(normalized,before);
    assert.throws(()=>buildProviderRequest({...request,size:999},'test-key'),/slice size/);
  }
});

for(const provider of PROVIDERS)test(`${provider.name}: routes correctly and creates a parseable contract`,()=>{
  const request=buildProviderRequest(raw(provider),provider.local?'':'provider-test-key');
  assert.equal(request.input.provider,provider.id);
  assert.equal(request.headers['Content-Type'],'application/json');
  assert.ok(!JSON.stringify(request.body).includes('provider-test-key'));
  assert.ok(JSON.stringify(request.body).includes('YWJj'));
  if(provider.id==='anthropic'){
    assert.equal(request.headers['x-api-key'],'provider-test-key');assert.equal(request.headers.Authorization,undefined);assert.equal(request.headers['anthropic-version'],'2023-06-01');
    assert.equal(request.body.messages[0].content[0].source.media_type,'image/png');assert.equal(request.body.max_tokens,4000);assert.equal(request.body.output_config.format.type,'json_schema');
    assert.deepEqual(parseProviderResponse({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(recipe)}]},request.input),recipe);
  }else if(provider.id==='gemini'){
    assert.equal(request.headers['x-goog-api-key'],'provider-test-key');assert.ok(request.url.endsWith(':generateContent'));assert.equal(request.body.generationConfig.maxOutputTokens,4000);
    assert.equal(request.body.contents[0].parts[1].inlineData.mimeType,'image/png');
    assert.deepEqual(parseProviderResponse({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private reasoning'},{text:JSON.stringify(recipe)}]}}]},request.input),recipe);
  }else if(provider.id==='openai'){
    assert.equal(request.body.max_output_tokens,4000);assert.equal(request.body.store,false);
    assert.deepEqual(parseProviderResponse({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(recipe)}]}]},request.input),recipe);
  }else if(provider.id==='cohere'){
    assert.equal(request.body.response_format.type,'json_object');assert.ok(request.body.response_format.schema);
    assert.deepEqual(parseProviderResponse({finish_reason:'COMPLETE',message:{content:[{type:'text',text:JSON.stringify(recipe)}]}},request.input),recipe);
  }else{
    assert.equal(request.body[provider.id==='groq'?'max_completion_tokens':'max_tokens'],4000);
    assert.deepEqual(parseProviderResponse(completion,request.input),recipe);
  }
  if(provider.local)assert.equal(request.headers.Authorization,undefined);
  if(provider.id==='openrouter')assert.deepEqual(request.body.provider,{allow_fallbacks:false,require_parameters:true});
});

test('all connectors support explicit description-only input without leaking an attached photo',()=>{
  for(const p of PROVIDERS){
    const request=buildProviderRequest({...raw(p),inputMode:'text',instructions:'An oak table with four legs.'},'test-key');
    assert.ok(!JSON.stringify(request.body).includes('YWJj'),p.id);
    assert.ok(!JSON.stringify(request.body).includes('input_image'),p.id);
  }
});
test('custom requests support api-key auth without a second Authorization credential',()=>{
  const {headers}=buildProviderRequest({...raw(PROVIDERS.at(-1)),authType:'api-key'},'test-key');
  assert.equal(headers['api-key'],'test-key');assert.equal(headers.Authorization,undefined);
});
test('custom endpoint cannot override a built-in provider or use nonpublic URL syntax',()=>{
  assert.equal(buildProviderRequest({...input,endpoint:'https://evil.example/v1/chat/completions'},'test-key').url,'https://api.openai.com/v1/responses');
  for(const endpoint of ['http://models.example/v1/chat/completions','https://user:pass@models.example/v1/chat/completions','https://models.example/v1/chat/completions?key=secret','https://127.0.0.1/v1/chat/completions','https://localhost/v1/chat/completions','https://[::1]/v1/chat/completions','https://models.example/wrong'])assert.throws(()=>connection({provider:'custom',endpoint},'test-key'));
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.1.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1'])assert.equal(isPublicAddress(address),false,address);
  for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(isPublicAddress(address),true,address);
});
test('token budgets and provider/output selections are enforced before billing',()=>{
  for(const change of [{maxOutputTokens:1999},{maxOutputTokens:14001},{maxOutputTokens:4000.5},{provider:'unknown'},{outputFormat:'invalid'},{inputMode:'text',instructions:''}])assert.throws(()=>validateRequest({...input,...change}));
  assert.equal(validateRequest({...input,model:'accounts/fireworks/models/vision-v1'}).model,'accounts/fireworks/models/vision-v1');
});
test('JSON and prompt modes include schema instructions without unsupported schema parameters',()=>{
  for(const p of PROVIDERS){
    const request=buildProviderRequest({...raw(p),outputFormat:'prompt'},'test-key');
    assert.equal(request.body.response_format,undefined);assert.equal(request.body.output_config,undefined);assert.equal(request.body.text,undefined);
    assert.ok(JSON.stringify(request.body).includes('additionalProperties'));
  }
  assert.equal(buildProviderRequest({...input,provider:'deepseek',model:'deepseek-flash',outputFormat:'json'},'test-key').body.response_format.type,'json_object');
});
test('refusals and truncated JSON are not treated as success for any protocol',()=>{
  const cases=[['anthropic',{stop_reason:'max_tokens'}],['anthropic',{stop_reason:'refusal'}],['gemini',{candidates:[{finishReason:'MAX_TOKENS'}]}],['gemini',{promptFeedback:{blockReason:'SAFETY'}}],['cohere',{finish_reason:'MAX_TOKENS'}],['mistral',{choices:[{finish_reason:'length'}]}],['xai',{choices:[{finish_reason:'stop',message:{refusal:'no'}}]}]];
  for(const [provider,data] of cases)assert.throws(()=>parseProviderResponse(data,{...input,provider}));
});
test('usage includes reasoning and cache tokens without double-counting output',()=>{
  assert.deepEqual(tokenUsage({usage:{input_tokens:100,output_tokens:80,output_tokens_details:{reasoning_tokens:30}}},'openai'),{inputTokens:100,outputTokens:80,totalTokens:180,cachedInputTokens:0,reasoningTokens:30});
  assert.equal(tokenUsage({usageMetadata:{promptTokenCount:100,candidatesTokenCount:40,thoughtsTokenCount:30,cachedContentTokenCount:20}},'gemini').totalTokens,170);
  assert.equal(tokenUsage({usage:{input_tokens:10,cache_read_input_tokens:100,cache_creation_input_tokens:20,output_tokens:40}},'anthropic').totalTokens,170);
  assert.equal(tokenUsage({usage:{billed_units:{input_tokens:50,output_tokens:20}}},'cohere').totalTokens,70);
  assert.equal(tokenUsage({},'openai'),null);
});
test('catalog supports unknown capabilities and explicitly distinguishes text and vision models',()=>{
  const list=parseModels({data:[{id:'vendor/vision',architecture:{input_modalities:['text','image']}},{id:'vendor/text',architecture:{input_modalities:['text']}},{id:'unspecified'}]},'openrouter');
  assert.equal(list.find(m=>m.id==='vendor/vision').vision,true);assert.equal(list.find(m=>m.id==='vendor/text').vision,false);assert.equal(list.find(m=>m.id==='unspecified').vision,null);
  assert.deepEqual(parseModels({models:[{name:'models/gemini-example',supportedGenerationMethods:['generateContent']},{name:'models/embed-example',supportedGenerationMethods:['embedContent']}]},'gemini').map(m=>m.id),['gemini-example']);
});
