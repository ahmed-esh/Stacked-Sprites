// Hand-authored examples for inspecting the contour slicer without a model call.
const box=(z,x,y,width,height)=>({z,points:[{x,y},{x:x+width,y:y+height}]});
export const SAMPLE_RECIPES={
  vase:{version:2,name:'Rounded vase',notes:'Hand-authored contour example, not AI output. Narrow base, rounded body, tapered neck, and an open rim.',size:32,layers:28,parts:[
    {name:'Body',shape:'ellipse',operation:'paint',color:'#B98C57',sections:[box(0,11,11,10,10),box(3,7,7,18,18),box(9,3,3,26,26),box(14,4,4,24,24),box(20,11,11,10,10),box(25,11,11,10,10),box(27,9,9,14,14)]},
    {name:'Open neck',shape:'ellipse',operation:'erase',color:'#000000',sections:[box(20,13,13,6,6),box(25,13,13,6,6),box(27,11,11,10,10)]}
  ]},
  arch:{version:2,name:'Curved arch',notes:'Hand-authored contour example, not AI output. Nested elliptical masks and an opening form a curved wall with a sloped top.',size:32,layers:14,parts:[
    {name:'Outer wall',shape:'ellipse',operation:'paint',color:'#B99561',sections:[box(0,2,2,28,28),box(8,2,2,28,28),box(13,5,5,22,22)]},
    {name:'Inner opening',shape:'ellipse',operation:'erase',color:'#000000',sections:[box(0,9,9,14,14),box(13,9,9,14,14)]},
    {name:'Front opening',shape:'polygon',operation:'erase',color:'#000000',sections:[0,13].map(z=>({z,points:[{x:0,y:17},{x:32,y:17},{x:32,y:32},{x:0,y:32}]}))}
  ]}
};
