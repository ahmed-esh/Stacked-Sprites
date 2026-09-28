// One allowlist drives HTTP exposure and the deployment build.
export const PUBLIC_FILES=['index.html','style.css','app.js','stack.js','generation.js','generation-ui.js','generation.css','provider-catalog.js','contours.js','sample-recipes.js','sprite-templates.js','sprite-transfer.js','environment.js','environment.css','scene.js','scene-ai.js','scene-generation.js','scene-export.js'];
export const RUNTIME_FILES=[...PUBLIC_FILES,'server.js','providers.js','endpoint-fetch.js','runtime-security.js','public-files.js','package.json'];
