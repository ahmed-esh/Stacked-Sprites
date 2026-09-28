export function getFrameRects(width, height, size, layout = 'horizontal') {
  if (![width, height, size].every(Number.isInteger) || width < 1 || height < 1 || size < 1) throw new Error('Slice size must be a positive whole number.');
  const extent = layout === 'horizontal' ? width : height;
  if (size > extent) throw new Error('Slice size cannot exceed the image dimension.');
  const count = Math.floor(extent / size);
  if (count > 256) throw new Error('Use a larger slice size. A stack can contain up to 256 layers.');
  return Array.from({length: count}, (_, i) => layout === 'horizontal' ? {x: i * size, y: 0, width: size, height} : {x: 0, y: i * size, width, height: size});
}

export function projectedBounds(width, height, count, rotation, elevation, spacing) {
  const radians = rotation * Math.PI / 180;
  const pitch = Math.sin(elevation * Math.PI / 180);
  const w = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
  const h = (Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))) * pitch;
  return {width: w, height: h + (count - 1) * spacing, planeHeight: h};
}

// Match Sprite2D stacking: rotate around each full frame's center, then move
// upward in screen space. Never crop/recenter individual occupied silhouettes.
export function drawStack(context, source, frames, {
  x=0, y=0, scale=1, rotation=0, elevation=90, spacing=1,
  count=frames.length, pixelated=true
} = {}) {
  const radians=rotation*Math.PI/180, pitch=Math.sin(elevation*Math.PI/180);
  context.save();
  context.imageSmoothingEnabled=!pixelated;
  for(let i=0;i<Math.min(count,frames.length);i++) {
    const f=frames[i];
    context.save();
    context.translate(x,y-i*spacing*scale);
    context.scale(scale,scale*pitch);
    context.rotate(radians);
    context.drawImage(source,f.x,f.y,f.width,f.height,-f.width/2,-f.height/2,f.width,f.height);
    context.restore();
  }
  context.restore();
}

// A conservative suggestion only; rectangular or padded sheets need manual sizing.
export function suggestSheet(width,height) {
  const size=Math.min(width,height), extent=Math.max(width,height), count=extent/size;
  if(!Number.isInteger(count)||count<4||count>256)return null;
  return {size,layout:width>=height?'horizontal':'vertical'};
}
