// Only transfer sprites originating in this tab. Drag payloads contain a token,
// never image data, credentials, or instructions from another page.
export const SPRITE_DRAG_TYPE='application/x-stacked-studio-sprite';
let current=null;
export function beginSpriteDrag(event,payload){
  if(!event.dataTransfer||!payload)return false;
  const token=crypto.randomUUID();current={token,payload};
  event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData(SPRITE_DRAG_TYPE,token);
  return true;
}
export function hasSpriteDrag(event){return Boolean(current&&Array.from(event.dataTransfer?.types||[]).includes(SPRITE_DRAG_TYPE));}
export function takeSpriteDrop(event){
  if(!hasSpriteDrag(event)||event.dataTransfer.getData(SPRITE_DRAG_TYPE)!==current.token)return null;
  const payload=current.payload;current=null;return payload;
}
export function endSpriteDrag(){current=null;}

// Hovering reveals the scene while the browser keeps the drag in progress.
// Dropping directly on the tab remains a convenient centered-placement option.
export function bindSpriteDropTab(tab,activate,onDrop){
  let timer=null;
  const cancel=()=>{if(timer!==null)clearTimeout(timer);timer=null;tab.classList.remove('sprite-drop-target');};
  tab.addEventListener('dragover',event=>{
    if(!hasSpriteDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';tab.classList.add('sprite-drop-target');
    if(timer===null)timer=setTimeout(()=>{activate();},350);
  });
  tab.addEventListener('dragleave',cancel);
  tab.addEventListener('drop',event=>{cancel();const payload=takeSpriteDrop(event);if(!payload)return;event.preventDefault();activate();onDrop(payload);});
  return cancel;
}
