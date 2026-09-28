import {buildValidatedRequest,parseResponse,parseRecipeText,recipeSchema,GenerationError,validateRequest} from './generation.js';
import {getProvider} from './provider-catalog.js';
import {templateContract} from './sprite-templates.js';

export function connection(input,key='',models=false) {
  const config=getProvider(input.provider);
  if(!config)throw new GenerationError('Unknown provider.');
  if(!config.local && (!key || !/^[\x21-\x7e]{1,4096}$/.test(key)))throw new GenerationError(`Enter your ${config.name} API key.`,401);
  if(key && !/^[\x21-\x7e]{1,4096}$/.test(key))throw new GenerationError('Invalid API key characters.',401);
  let url=models?config.modelsURL:config.endpoint;
  if(config.id==='custom') {
    if(models)throw new GenerationError('Enter a model ID from your endpoint’s documentation.');
    let parsed;try{parsed=new URL(input.endpoint);}catch{throw new GenerationError('Enter the full HTTPS chat/completions endpoint URL.');}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash||parsed.search||!parsed.pathname.endsWith('/chat/completions'))throw new GenerationError('Use an HTTPS URL ending in /chat/completions, without credentials, query parameters, or fragments.');
    if(parsed.hostname==='localhost'||parsed.hostname.endsWith('.localhost')||parsed.hostname.endsWith('.local')||!parsed.hostname.includes('.')||/^[\d.]+$/.test(parsed.hostname)||parsed.hostname.includes(':'))throw new GenerationError('Use a public hostname for a custom endpoint. Choose Ollama or LM Studio for local inference.');
    url=parsed.href;
  }
  if(!url)throw new GenerationError('This connector has no model-list endpoint. Enter the model ID manually.');
  const headers={'Content-Type':'application/json'};
  // API version, not a model release date. Latest documented version:
  // https://platform.claude.com/docs/en/api/versioning
  if(config.protocol==='anthropic'){headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';}
  else if(config.protocol==='gemini')headers['x-goog-api-key']=key;
  else if(key)headers[config.id==='custom'&&input.authType==='api-key'?'api-key':'Authorization']=config.id==='custom'&&input.authType==='api-key'?key:`Bearer ${key}`;
  if(!models && config.protocol==='gemini')url+=`${encodeURIComponent(input.model.replace(/^models\//,''))}:generateContent`;
  return {url,headers,config};
}

export function buildProviderRequest(raw,key,contract=null) {
  return buildValidatedProviderRequest(validateRequest(raw),key,contract);
}

// Internal path for the server, after validateRequest or validatePlanRequest.
// Keep the raw-input wrapper above for other callers; never accept a client trust flag.
export function buildValidatedProviderRequest(input,key,contract=null) {
  const {url,headers,config}=connection(input,key);
  contract??=input.generationMode==='template'?templateContract(input):null;
  const base=buildValidatedRequest(input), text=base.input[0].content[0].text;
  const schema=contract?.schema||recipeSchema,name=contract?.name||'sprite_slices';
  if(contract){base.instructions=contract.instructions;if(base.text?.format?.type==='json_schema')base.text.format={type:'json_schema',name,strict:true,schema};}
  // In unconstrained modes the schema must be visible in the prompt itself.
  const instructions=base.instructions+((input.outputFormat!=='schema'||['together','fireworks','ollama','lmstudio'].includes(config.id))?`\nReturn JSON matching this schema: ${JSON.stringify(schema)}`:'');
  let body;
  const image=input.image?.match(/^data:([^;]+);base64,(.+)$/);
  if(config.protocol==='responses')body={...base,instructions};
  else if(config.protocol==='anthropic')body={
    model:input.model,max_tokens:input.maxOutputTokens,system:instructions,
    messages:[{role:'user',content:[...(image?[{type:'image',source:{type:'base64',media_type:image[1],data:image[2]}}]:[]),{type:'text',text}]}],
    ...(input.outputFormat==='schema'?{output_config:{format:{type:'json_schema',schema}}}:{})
  };
  else if(config.protocol==='gemini')body={
    systemInstruction:{parts:[{text:instructions}]},contents:[{role:'user',parts:[{text},...(image?[{inlineData:{mimeType:image[1],data:image[2]}}]:[])]}],
    generationConfig:{maxOutputTokens:input.maxOutputTokens,...(input.outputFormat!=='prompt'?{responseMimeType:'application/json'}:{}),...(input.outputFormat==='schema'?{responseJsonSchema:schema}:{})}
  };
  else {
    const content=[{type:'text',text},...(image?[{type:'image_url',image_url:config.id==='mistral'?input.image:{url:input.image}}]:[])];
    body={model:input.model,messages:[{role:'system',content:instructions},{role:'user',content:input.inputMode==='text'?text:content}],stream:false};
    body[config.id==='groq'?'max_completion_tokens':'max_tokens']=input.maxOutputTokens;
    // Opt-in only; keep the explicit output cap even when thinking is enabled.
    if(config.id==='deepseek')body.thinking={type:input.thinking};
    if(input.outputFormat==='schema')body.response_format=config.protocol==='cohere'?{type:'json_object',schema}:{type:'json_schema',json_schema:{name,schema,...(!['together','fireworks'].includes(config.id)?{strict:true}:{})}};
    else if(input.outputFormat==='json')body.response_format={type:'json_object'};
    // Prevent a gateway from silently retrying the request with another provider.
    if(config.id==='openrouter')body.provider={allow_fallbacks:false,require_parameters:true};
  }
  return {url,headers,body,input};
}

export function tokenUsage(data,provider) {
  const kind=getProvider(provider)?.protocol, u=data.usage || {}, safe=value=>Number.isFinite(value)&&value>=0?value:0;
  let input,output,cached=0,reasoning=0;
  if(kind==='gemini'){const m=data.usageMetadata;if(!m)return null;input=safe(m.promptTokenCount);reasoning=safe(m.thoughtsTokenCount);output=safe(m.candidatesTokenCount)+reasoning;cached=safe(m.cachedContentTokenCount);}
  else if(kind==='anthropic'){if(!data.usage)return null;cached=safe(u.cache_read_input_tokens);input=safe(u.input_tokens)+cached+safe(u.cache_creation_input_tokens);output=safe(u.output_tokens);}
  else if(kind==='cohere'){const b=u.billed_units || u.tokens;if(!b)return null;input=safe(b.input_tokens);output=safe(b.output_tokens);}
  else{if(!data.usage)return null;input=safe(u.input_tokens??u.prompt_tokens);output=safe(u.output_tokens??u.completion_tokens);cached=safe(u.input_tokens_details?.cached_tokens??u.prompt_tokens_details?.cached_tokens);reasoning=safe(u.output_tokens_details?.reasoning_tokens??u.completion_tokens_details?.reasoning_tokens);}
  return {inputTokens:input,outputTokens:output,totalTokens:input+output,cachedInputTokens:cached,reasoningTokens:reasoning};
}

export function parseProviderResponse(data,input,parseText=parseRecipeText) {
  const kind=getProvider(input.provider).protocol;
  const unfinished=()=>{throw new GenerationError('The model did not finish the slices. Simplify the object or raise the output limit. No retry was made.',502);};
  const refused=()=>{throw new GenerationError('The provider declined or blocked this request. Try a different reference or description.',422);};
  if(kind==='responses'&&parseText===parseRecipeText)return parseResponse(data,input);
  let text;
  if(kind==='responses'){
    if(data.status!=='completed')unfinished();
    const content=(data.output||[]).flatMap(item=>item.content||[]);
    if(content.some(item=>item.type==='refusal'))refused();
    text=content.filter(item=>item.type==='output_text').map(item=>item.text).join('');
  }else if(kind==='anthropic'){
    if(data.stop_reason==='refusal')refused();
    if(!['end_turn','stop_sequence'].includes(data.stop_reason))unfinished();
    text=(data.content || []).filter(c=>c.type==='text').map(c=>c.text).join('');
  } else if(kind==='gemini'){
    if(data.promptFeedback?.blockReason)refused();
    const c=data.candidates?.[0];
    if(['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT'].includes(c?.finishReason))refused();
    if(c?.finishReason!=='STOP')unfinished();
    text=(c.content?.parts || []).filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('');
  } else if(kind==='cohere'){
    if(data.finish_reason!=='COMPLETE' && data.finish_reason!=='stop')unfinished();
    text=(data.message?.content || []).filter(c=>c.type==='text').map(c=>c.text).join('');
  } else {
    const c=data.choices?.[0];
    if(c?.message?.refusal||c?.finish_reason==='content_filter')refused();
    if(c?.finish_reason!=='stop')unfinished();
    text=typeof c.message?.content==='string'?c.message.content:(c.message?.content || []).filter(c=>c.type==='text').map(c=>c.text).join('');
  }
  return parseText(text,input);
}

export function parseModels(data,provider) {
  const kind=getProvider(provider)?.protocol;
  const list=Array.isArray(data)?data:(data.data || data.models || []);
  if(!Array.isArray(list))throw new GenerationError('The provider returned an unreadable model list.',502);
  return list.filter(m=>kind!=='gemini'||m.supportedGenerationMethods?.includes('generateContent')).map(m=>{
    const id=m.id || m.name;
    const modalities=m.architecture?.input_modalities || m.input_modalities;
    let vision=Array.isArray(modalities)?modalities.includes('image'):null;
    if(typeof m.capabilities?.vision==='boolean')vision=m.capabilities.vision;
    if(kind==='gemini')vision=null; // A generation method alone does not prove image support.
    return {id:typeof id==='string'?id.replace(/^models\//,''):'',name:m.display_name || m.displayName || m.name || id,vision};
  }).filter(m=>m.id&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(m.id)).slice(0,1000).sort((a,b)=>a.id.localeCompare(b.id));
}
