# Stacked — Sprite Studio

A JavaScript harness for customizing tested sprite templates or generating freeform pixel-art slices from a reference photo, then stacking them on Canvas 2D to fake depth. No mesh, WebGL, or 3D reconstruction pipeline is used.

## Publishing

See [DEPLOYMENT.md](DEPLOYMENT.md) for Docker and Node hosting, HTTPS/domain settings, request limits, privacy, and launch checks. Run `npm test` and `npm run build`; deploy the runtime-only `dist/` output or the Docker image. Tests stay separate by feature for easier maintenance and are excluded from the deployment build.

## Run

Requires **Node.js 22 or newer**. No dependencies or installation step.

```sh
npm start
```

Open http://localhost:5173. Stop any old Python/static server on that port first. To choose another port: `PORT=5174 npm start`.

The Node server is required for generation. Static hosting alone supports the editor but cannot service `/api/generate`.

## Generate from a photo

The generation dialog now starts in **Tested template** mode. Choose **Chair**, **Table**, **Car**, or **Tree** to constrain the object's structure. For anything else, explicitly select **Freeform**. The existing studio and road demos remain hand-authored examples, not model-generated quality benchmarks.

1. Upload a PNG, JPG, or WebP in the sidebar, or open **Generate slices** and choose a reference there.
2. Choose a **provider**, enter **that provider’s API key into the website**, and choose a model. Use **Load available models** where offered, or type the exact model ID. Model IDs and account access change over time; presets are starting points, not quality benchmarks. Local Ollama and LM Studio connections allow an empty key.
3. Choose a 16, 32, or 64 px square slice canvas. **Auto · infer proportions** lets the model choose height in pixel layers (2 to twice the resolution, capped at 96). Fixed 16, 24, 32, or 48 layer counts remain available as an override. Add art direction, such as “Keep the table wide, four separate legs, and a thin light-oak tabletop.”
4. Select an output format and token limit, then generate. The reference is resized to at most 1,024 px per side and sent with the instructions to the selected provider via the app server. Provider charges apply per request. No generation request is sent just by uploading an image or typing a key. Loading the model catalog is a separate metadata request.
5. Review four stacked angles, individual transparent slices, and the model's assumptions. Local geometry checks flag disconnected pixel groups, empty height bands, identical silhouettes, and pixels touching frame edges; these are advisory, not proof of bad or good art. **Use this stack** loads the sheet into the editor. Revise art direction and regenerate for a different interpretation. Failed/cancelled regeneration preserves the previous result.
6. Rotate, change spacing and viewing angle, inspect layers, and export a transparent preview PNG or a horizontal sprite sheet. You can also download the generated slice recipe as JSON.

This produces a stylized pixel-art interpretation of the photograph. In freeform mode the model designs cross-sections and infers hidden parts; it does not preserve every original photo pixel or guarantee a structurally accurate object. Frame dimensions, contour bounds, vertex counts, and height ranges are validated. Local continuity checks can catch some structural mistakes, but resemblance, correct proportions, and artistic quality still need review. A plain background and a single recognizable object are best.

## Tested templates

In template mode the model returns a compact settings object, not arbitrary contours. `sprite-templates.js` owns the parameter schema, validation, and deterministic construction of all cross-sections. Values outside the selected template's ranges, unknown parameters, a different template ID, or raw contour responses are rejected. There is no automatic retry or fallback to freeform.

| Template | Fixed structure | Bounded customization |
| --- | --- | --- |
| Chair | Four legs, seat, connected backrest | Width/depth/height, leg thickness, solid/slatted back, arms, cushion, colors |
| Table | Four legs joined to the top | Width/depth/height, leg/top thickness, rectangular/beveled top, braces, colors |
| Car | Four wheels, body, cabin, windows; front toward negative y | Width/length/height, wheel size, compact/long roof, stripe, headlights, colors |
| Tree | Trunk joined to a crown | Crown width/depth, height, trunk width/height proportion, round/conifer crown, colors |

**Preview template · free** builds the default shape without a reference, key, or model call. The review's **Adjust template · no API calls** controls rebuild proportions, colors, and details locally, both before and after model customization. **Use this stack** sends the resulting sheet to Sprite Studio; **Add to environment** places that same sheet in your world. Recipe downloads retain the bounded settings alongside the compiled contour recipe. Auto height scales the nominal 32px dimensions to the selected resolution and obeys the existing layer cap; fixed height overrides the height parameter.

For model customization, select the matching template, supply a reference or description, and click **Generate slices**. One existing provider request chooses the settings; the server compiles them into the same version 2 contour recipe used by the renderer and exports. The template response itself uses a separate version 1 settings contract. All provider connectors use their existing image/text transport, format options, credential handling, explicit token caps, and no-retry rules. Template settings are compact; 2,000–4,000 output tokens is a starting cap to try, not a guaranteed requirement. Thinking can consume part of that cap. Free preview and adjustment use zero model tokens.

Templates deliberately cover a limited family of shapes. They cannot turn a cat into a faithful result using a chair structure, and colors/proportions chosen by a model still need review. Freeform remains available for unsupported objects. No live-model quality benchmark has been performed for this feature.

`node scripts/render-template-previews.mjs` regenerates `template-preview.png` with the shared stack drawing transforms. Rows are chair/table/car/tree and columns are 0°, 45°, 135°, and 225°. These show local default settings, not AI output. Tests exercise boundary and mixed parameters across all resolutions and height choices, checking connected geometry, occupied layers, clear borders, and leg gaps.

For a useful reference, show the entire object with even lighting from a slightly elevated front or side angle. A top-down view hides height; severe perspective, cropped parts, and clutter make reconstruction harder. Add structural art direction: name separate legs or paws, the body above them, openings, proportions, and facing direction. The generation dialog includes photo guidance and chair/cat/car examples. These tips do not guarantee likeness.

The freeform prompt includes two complete contrasting recipes: a rounded hollow vessel and an asymmetric polygon table with four separate legs. The exact table example is validated and rasterized in tests to check leg gaps, the empty corner, and connection to the tabletop. Organic-shape guidance calls for more contour sections where needed, separate paired parts, and preservation of asymmetric poses. This adds a small amount of input prompt text per sprite request, with no extra model calls.

Model presets reviewed against provider documentation on September 27, 2026:

- Gemini defaults to `gemini-3.1-pro-preview`, a [documented Pro model with image input and structured output](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview). The UI labels it as a preview and offers `gemini-3.8-flash` as a manually entered alternative. We did not switch to 2.5 Pro because [Google restricts 2.5 access to prior users](https://ai.google.dev/gemini-api/docs/deprecations).
- Mistral defaults to `mistral-large-latest` ([Large 3 alias](https://docs.mistral.ai/studio/conversations/function-calling), [multimodal model capabilities](https://docs.mistral.ai/models/mistral-large-3-25-12)). The smaller model can still be entered manually.
- Groq retains `qwen/qwen3.8-27b`: its current documentation explicitly lists [vision input](https://console.groq.com/docs/vision) and [strict structured output](https://console.groq.com/docs/structured-outputs).
- DeepSeek retains `deepseek-flash`, the currently documented vision-capable option. The suggested legacy `deepseek-chat` is not in the [current model list](https://api-docs.deepseek.com/quick_start/pricing/). The connector now exposes optional thinking using the [documented request field](https://api-docs.deepseek.com/api/create-chat-completion/).

These presets are candidates for better results, not measured sprite-quality rankings. Review model availability, price, and generated geometry before committing to a larger batch.

## Environment editor

Open the **Environment** tab beside **Sprite Studio**. The default world is **960 × 504 px**, adjustable from 256 to 2,048 px per dimension. Everything uses Canvas 2D: rotate flat sprite frames in their planes and offset each frame upward. There is no mesh, WebGL, or 3D engine.

Scene generation defaults to **Templates where supported · freeform for other objects**. The existing layout request assigns each asset a template or `freeform`; the review labels that choice before any sprite requests. **Templates only** limits the plan to chairs, tables, cars, and trees; **Freeform for every sprite** preserves the prior behavior. Template sprites use one bounded-settings request per unique asset, while unsupported objects use one contour request. Repeated placements still reuse one asset. There is no extra classification request, automatic freeform fallback, or additional repair call. API callers omitting the new `assetMode` retain legacy freeform behavior.

- In Sprite Studio, click **Add / drag to Environment**, or use **Add current studio sprite** in the environment. This snapshots all current frames in their selected order, preserving transparent margins and layer spacing. To position it directly, drag the Studio button over the **Environment** tab, hover briefly to reveal the scene, then drop onto the ground. Dropping on the tab itself adds it at the center. The main Studio preview still uses dragging to rotate.
- Drag a library sprite onto the scene at the desired position, or click its separate **Place** button to add a centered instance. Single-click selects the library card without placing. Double-click a library card or an object in the scene to open its sprite in Sprite Studio; Enter/Space opens a focused library card. Opening preserves all frames, rectangular slice dimensions, and spacing, and makes a Studio copy without changing existing placements. Add or drag the edited sprite back to create a new version.
- Drag placed sprites to move them, or edit X/Y, rotation, scale, and **Solid obstacle**. Drops account for camera rotation and CSS canvas scaling and clamp positions to world bounds; stop Play mode before dropping onto the scene. Select **Make player** to control one object; duplicate or remove instances without changing the shared sprite asset.
- Adjust ground color, world dimensions, and environment rotation. **Add a road** paints a simple ground strip locally. The free **Load road example** includes a hand-authored car, reusable trees, and a marked road, with no API request.
- Press **Play**, then focus the canvas. WASD or arrow keys move relative to the screen; **Q/E rotate the entire world around the player**. The camera follows the player at a fixed zoom while ground, props, and every sprite plane rotate together. Layer offsets stay vertical on screen. Player facing smoothly follows movement, using the shortest angle across ±180°, with eased acceleration. Walking mode adds a gentle bob; Vehicle mode disables bob and uses the same camera-relative controls. Camera rotation speed is adjustable (default 114.6°/s, approximately the supplied Godot speed of 2 radians/s). Stop restores the original placements and camera angle. Leaving the tab stops play; losing focus clears held keys. This is a simple controller, not vehicle physics.
- Solid props use circular collision footprints and movement stays within world bounds. Rendering sorts whole sprites by their rotated ground position; very large interpenetrating objects can have overlap artifacts. This is a lightweight 2D scene system.
- **Save editable project** downloads JSON with embedded PNGs; **Open project** restores it. Keys and API connection settings are excluded. Projects are not automatically persisted when you close the browser. A scene supports 64 unique assets, 300 instances, and 64 ground rectangles, with an embedded-image size cap.

### Describe a world with AI

1. Choose **Describe a world**, then **Configure model connection**. It shares the provider, model ID, key, and output mode with Sprite Studio. Scene generation sends text only and works through every existing provider connector, including text-only models.
2. Describe the playable world, for example: “Let me control a red car on a road, with rows of trees and a few houses beside it.” Set a maximum of 1–8 unique sprites and 1–120 placements. World dimensions come from the environment sidebar.
3. **Generate layout plan** makes one request capped at 8,000 output tokens. Review the asset descriptions, layout notes, instance count, and next request count. The plan is validated against your world size and asset/placement limits before anything else runs. Ground rectangles render locally and require no sprite-generation request.
4. **Generate missing sprites** makes one sequential request per unique asset using the contour slicer. Each request defaults to a 4,000-output-token limit, adjustable from 2,000 to 14,000. Shared placements reuse the generated PNG; they do not call the model again. This is a stylized interpretation, not a guarantee that each model will make a good scene or sprite.
5. A failure or cancellation stops the queue and retains completed sprites in memory. Clicking Generate missing sprites again explicitly retries only missing assets. You can change the connection or sprite token limit before retrying. There are no automatic retries. Cancellation may not stop upstream billing.
6. Review the assembled scene and geometry warnings, then **Use this environment**. This replaces the current layout; **Restore previous environment** brings it back. Editing and playing are local and use no tokens.

The review shows request counts, per-request output caps, and reported session token usage. Output limits are not dollar budgets; input and provider reasoning accounting can add cost. For example, a plan with four unique assets uses five requests in total, regardless of whether those assets appear 4 or 60 times. Scene generation does not export or execute model-generated JavaScript: it accepts validated data only.

### Export a playable folder

**Export code + sprites** downloads `stacked-scene.zip`. Unzip it and open `stacked-scene/index.html` directly in a modern browser, or publish the extracted folder on a static host. It contains:

- `index.html`: playable canvas and basic controls.
- `game.js`: the same 2D renderer and controller used in the editor, bundled as a classic script so local files work without a build step.
- `scene-data.js`: world settings, object placements, player selection, and asset metadata.
- `assets/sprite-*.png`: one sheet per unique sprite, reused by instances.
- `README.txt`: controls and customization instructions.

The exported game has no dependencies, API connection, API key, or generation calls. `scene.js` is the shared scene runtime; `scene-export.js` packages an uncompressed ZIP locally; `scene-generation.js` validates model plans; `scene-ai.js` manages the explicitly started generation queue.

## Provider and model coverage

| Connector | API format | Notes |
| --- | --- | --- |
| OpenAI | Responses | Image input with schema, JSON, or prompt output |
| Anthropic Claude | Messages | Native image blocks; schema or prompt output |
| Google Gemini | Generate Content | Native inline images and JSON Schema |
| xAI Grok | Chat Completions | Choose a model with image understanding |
| Mistral | Chat Completions | Supports Mistral's image format |
| DeepSeek | Chat Completions | JSON/prompt output; thinking disabled to preserve the output budget |
| Cohere Command / Aya | Native v2 Chat | Image input and Cohere's schema format; enter model ID manually |
| Groq | Compatible Chat Completions | Select a vision model; uses `max_completion_tokens` |
| Together AI | Compatible Chat Completions | Model availability and modalities depend on deployment |
| Fireworks AI | Compatible Chat Completions | Model availability and modalities depend on deployment |
| OpenRouter | Compatible Chat Completions | Routes to model families such as Claude, Gemini, Llama, Qwen, and Kimi as available; automatic provider fallback disabled |
| Ollama | Local compatible endpoint | `http://127.0.0.1:11434/v1/chat/completions`; runtime/model must already be running |
| LM Studio | Local compatible endpoint | `http://127.0.0.1:1234/v1/chat/completions`; start its local API server and load a model |
| Custom | Compatible Chat Completions | Full public HTTPS endpoint ending in `/chat/completions`; Bearer or `api-key` authentication |

These are **provider connectors**, not a promise that every model supports photo input or produces a good sprite. Model catalogs label vision/text-only capabilities where the provider supplies them; otherwise they explicitly say capabilities are unlisted. Catalog loading does not benchmark the model. Some catalogs are paginated; the UI reports when only the first page is returned, and any valid model ID can still be entered manually.

**Description only** mode supports text-only models: supply the object's shape, parts, proportions, and colors in the text field. In this mode the photo is not included in the request, even if a reference is visible in the dialog. No automatic second model describes the image and there is no extra hidden API call. Models that only produce images, audio, embeddings, or video do not fit this JSON slice-generation contract.

Start with **Strict schema** when the chosen model supports it. For older or incompatible models, explicitly choose **JSON mode** or **Prompt only**. Every mode still runs the same semantic slice validator. The app never changes output mode and retries automatically. Specialized cloud authentication such as AWS SigV4, Vertex OAuth, and Azure deployment URLs with query parameters is not implemented; use a supported direct provider or a trusted compatible gateway.

## Token controls

- The default output limit is **8,000 tokens**, adjustable from 2,000 to 14,000. This is passed through the provider's corresponding parameter. Provider/model accounting determines whether reasoning is included in that limit.
- Complex animals or furniture may benefit from 12,000–14,000 tokens for additional parts and sections. This is guidance only: the app never raises a limit automatically. Scene sprites retain their separate default of 4,000 tokens each, with guidance that higher per-sprite limits multiply across unique assets.
- **DeepSeek thinking** is off by default and can be explicitly enabled in the model connection. It applies to standalone sprites, scene plans, and scene sprites; switching providers resets it to off. Thinking shares the request's output cap with the final recipe, so it can use more tokens and leave less room for JSON. The app keeps all explicit caps, request counts, and no-retry behavior. Other connectors do not receive DeepSeek's thinking field. Reported reasoning-token usage is included without counting it twice.
- One request designs the whole stack. The model describes reusable parts with a few contour sections; JavaScript fills in all intermediate slices without additional tokens. The prompt includes two worked cross-section examples (additional input tokens), while four-angle previews and geometry checks run locally without additional model calls. No automatic retries or paid repair calls occur.
- A concurrent generation for the same provider/key/endpoint is blocked server-side, including across browser tabs. This is an in-flight guard, not a daily spending quota.
- Returned usage is normalized across providers and shown for successful results and invalid generated recipes where usage was supplied. Reasoning/cache tokens are included when reported. The session total counts only usage received in this tab; canceled/disconnected requests and requests elsewhere may still be billed.
- Dollar prices are not guessed. Check your provider's billing dashboard. There is no cumulative dollar budget or persistent usage ledger yet.
- A low output limit can truncate a result; simplify art direction or raise the limit intentionally. Rotating, inspecting, and exporting the resulting stack consume no API tokens.

## How the harness works

- `generation.js` defines the version 2 output schema, prompt, validation, and response parsing. `contours.js` interpolates and rasterizes deterministic 2D masks.
- Requests are validated once at the server boundary; explicitly named internal builders accept that normalized result. Public raw-input builders still validate their inputs. Sprite and scene JSON parsers share LF/CRLF Markdown-fence handling.
- The scene exporter supports multiline named imports between its fixed runtime modules. Unsupported dependencies, aliases, or export forms fail with an explicit error; extending the runtime's module syntax requires updating the converter and exported-game bootstrap tests.
- The model returns **named parts with contours at selected heights**. Each part uses an ellipse (two bounding corners) or a polygon (matching perimeter vertices), a color, a paint/erase operation, and ordered `sections` containing `z` and `points`. JavaScript linearly interpolates the points between sections, rasterizing one aligned horizontal cross-section per height. An individual part exists only over its specified height range; a single section exists for one layer.
- For example, a rounded body has a narrow lower ellipse, wide middle ellipses, and a narrow upper ellipse. A hollow arch paints an outer contour and erases its inner opening. Legs are separate parts below a tabletop, rather than a whole side-view table painted into every slice.
- Rasterization samples pixel centers with hard alpha edges. Parts paint/erase in array order, and transparent holes remain transparent. Optional **Subtle height shading** darkens lower slices with a gentle ramp; this is local stylization, not physical lighting. It can be disabled in the generation review without another API request.
- New freeform responses must use version 2; template settings use their own version 1 contract and are compiled locally into version 2 contours. The validator and rasterizer still accept legacy rectangle-band recipes when called without a new-generation version requirement. Existing PNG sheets retain their original pixels.
- For a table, lower slices contain separate leg footprints; upper slices contain rails and the tabletop. Every frame is an aligned top-down horizontal cross-section, not a side-view drawing or a rotation frame.
- The browser rasterizes the recipe into an exact horizontal PNG sheet, then uses the existing 2D rotation and upward layer offsets to create the illusion.
- `providers.js` translates requests, authentication, schema formats, responses, model catalogs, and token accounting. `provider-catalog.js` contains public connection metadata. `server.js` handles forwarding, errors, cancellation, timeouts, concurrency, and semantic validation. It never evaluates model-generated code and does not automatically retry billed requests.
- `generation-ui.js` manages the reference, in-memory key, settings, review, regeneration, and applying results. A failed generation never replaces the current stack.

To extend a native protocol, add a connector in `providers.js` and a public entry in `provider-catalog.js`, with contract tests for authentication, image transport, schema, finish reasons, and usage. Compatible endpoints can use the existing custom connector. Endpoint compatibility alone does not guarantee support for vision, JSON Schema, or all token-control parameters.

Official API references used: [image inputs](https://developers.openai.com/api/docs/guides/images-vision), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [GPT-4.1 capabilities](https://developers.openai.com/api/docs/models/gpt-4.1).

Additional provider references: [Claude](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [Grok](https://docs.x.ai/developers/model-capabilities/text/structured-outputs), [Mistral](https://docs.mistral.ai/studio/conversations/vision), [DeepSeek](https://api-docs.deepseek.com/api/create-chat-completion/), [Cohere](https://docs.cohere.com/docs/image-inputs), [Groq](https://console.groq.com/docs/vision), [Together](https://docs.together.ai/docs/inference/chat/structured-outputs), [Fireworks](https://docs.fireworks.ai/structured-responses/structured-response-formatting), [OpenRouter](https://openrouter.ai/docs/guides/features/structured-outputs), [Ollama](https://docs.ollama.com/api/openai-compatibility), and [LM Studio](https://lmstudio.ai/docs/developer/openai-compat).

## Key and data handling

- Keys stay in tab memory and request memory only. The app does not use local/session storage, save keys to disk, or log keys, photos, or prompts. Use **Clear key** to remove the key from the input; closing/reloading the page also clears it. Clearing cannot retract a request already sent.
- The key travels to the app server as an Authorization header, then to the chosen provider using that provider's authentication header. Switching provider or custom destination clears the key; it is never automatically reused across providers. OpenAI uses `store: false`; each provider's data policies still apply.
- Generation sends the reference and prompt to the selected provider shown before submitting. Description-only mode omits the image. Existing sprite-sheet editing and simple extrusion run locally.
- Built-in providers have fixed destinations. Custom endpoints require HTTPS, prohibit embedded credentials, query strings, and redirects, and check and pin DNS resolution to public addresses. Local inference is explicitly limited to the Ollama and LM Studio presets. Only use custom endpoints you trust with your key and reference.
- Cancel aborts the client request and requests cancellation upstream. It cannot guarantee a provider stops processing or billing a request already accepted.
- Development binds to `127.0.0.1`. Production requires `NODE_ENV=production` and an HTTPS `PUBLIC_ORIGIN`, binds to `0.0.0.0`, checks the public Host and API Origin, and disables local model providers. Both modes expose only an explicit frontend allowlist. Deploy behind HTTPS ingress following [DEPLOYMENT.md](DEPLOYMENT.md).
- Model reference images are limited to **4,000,000 decoded bytes** after resizing. The HTTP body cap is derived from that limit with base64 expansion, the data URL prefix, and 64 KiB of JSON/settings headroom. Oversized images and oversized request bodies receive distinct errors.
- The CSP's style-only `unsafe-inline` allowance is retained for inline app styling, including dynamic slider fills. Fonts use local system fallbacks; there are no external font requests. A stricter style policy should review those fills and use hashes/nonces for any inline style blocks; scripts remain restricted to this app's origin.
- Anthropic's `anthropic-version: 2023-06-01` is an API contract version, not a model date, and remains the latest documented version in the [official versioning reference](https://platform.claude.com/docs/en/api/versioning). Model upgrades do not imply changing it.

## Free examples

Choose **Chair**, **Vase**, or **Arch** under **Free examples**, then click **Load example**. The vase and arch use the same contour slicer as generated results; these are hand-authored fixtures, not proof of any model's output quality. Rotate them, inspect individual layers, and export their sheets without a key or API charge. `sample-recipes.js` contains the examples.

## Existing sheet editing

Exact strips of 4–256 square cells are suggested as **Existing sprite sheet** on upload. This is only a size-based guess: check the image type, horizontal/vertical layout, and slice width/height. Other prepared sheets can be selected manually; rectangular frames and trailing pixels are supported. The first frame is the bottom layer. Incomplete trailing frames are excluded with a warning. **Single image · simple extrusion** repeats the same artwork without an API call.

Drag to rotate, scroll to zoom, and click a slice to inspect up to that layer. Space toggles rotation, R resets view, arrows rotate, and + / − zoom. Shortcuts are ignored in controls and dialogs.

PNG export includes visible layers with a transparent background, excluding grid and shadow. It fits the object independently of preview zoom, up to 4,096 px. Sprite-sheet export includes all layers in the selected order. **Classic** projection is now the default: frames stay uncompressed, rotate around their full-frame centers, and shift upward by one pixel per layer. This follows the transform in [Stacked-Sprite-Viewer’s StackedSprite.gd](https://github.com/jontopielski/Stacked-Sprite-Viewer/blob/master/src/StackedSprite.gd). The shared `drawStack` function drives the editor, generation review, and exported view. Transparent margins and blank frames retain their original positions. Lowering the Slice projection slider adds optional vertical compression; at 0°, planes are edge-on and disappear. Reset returns to Classic and 1 px spacing. The earlier default was 30°, compressing each plane to half its height.

The reference viewer loads pre-authored slices; it does not reconstruct slices from a photo. Our generator still asks the selected model to infer cross-sections. The current generator replaces independently authored rectangle bands with interpolated 2D contours. Its prompt distinguishes photo image height from footprint depth, requires parts at their actual heights, and includes a complete rounded-vessel example plus a leg/tabletop construction example. Automatic height removes the previous forced layer count, but is still a model estimate. These changes have not been benchmarked against live model outputs.

Input limits: 20 MB, 32 megapixels, 16,384 px per side; existing sheets support up to 256 layers. Generated slices have tighter limits for predictable model output. The app uses local system font fallbacks without external font requests.

## Tests

```sh
npm test
```

Tests cover all provider request/response contracts, scene-plan contracts and budgets, coordinate conversion, camera orbit, constant play zoom, camera-relative movement, smooth facing across angle wrap, upright layer offsets, controller reset, collisions, interrupted asset queues, ZIP integrity and exported script bootstrap, authentication, model catalogs, token usage, text-only image omission, token limits, crop coordinates, projection bounds and classic drawing transforms, automatic height limits, interpolated contours, curved profiles, hollow openings, leg-to-top joins, height shading, connected versus floating geometry, malformed model output, transparent pixel rasterization, exact layer ordering, local API behavior, credential forwarding, sanitized errors, origin restrictions, cancellation, and timeout handling. Integration tests use localhost ports and **mock every external provider call**; no key or API spending is required.

Live provider/account compatibility and model quality have not been verified with real API keys. The included chair is a handcrafted local demo, not an AI-generated result.
