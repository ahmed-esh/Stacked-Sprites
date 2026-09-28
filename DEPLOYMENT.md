# Publishing Stacked Studio

This is a Node application, not a static-only website: the backend forwards
users' model requests. Users supply their own provider keys. Do not configure
a shared or personal model key on the server. No external services are called
by the automated tests.

## Portable Docker deployment

1. Build with `docker build -t stacked-studio .`. The build runs the tests and
   copies only the runtime allowlist into the final non-root image.
2. Deploy the image to a container host with HTTPS ingress. Set:

   ```text
   NODE_ENV=production
   PUBLIC_ORIGIN=https://your-real-domain.example
   PORT=5173
   ```

3. Route that domain to port 5173, preserving the public `Host` header. Keep the
   Node port private behind the HTTPS proxy. The application itself serves HTTP;
   your platform must terminate TLS and redirect public HTTP to HTTPS.
4. Use `/healthz` for readiness/liveness checks. Allow at least 15 seconds for
   shutdown and at least 195 seconds for the proxy response timeout. Limit
   incoming request bodies to 7 MB or less (the app also enforces its own limit).
5. Start with **one replica**. Limits and in-flight generation locks are held in
   process memory. Multiple replicas need shared limits or an API gateway.

Example container invocation behind an existing HTTPS proxy on the same host:

```sh
docker run --name stacked-studio --restart unless-stopped \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --memory=512m --cpus=1 \
  -p 127.0.0.1:5173:5173 \
  -e PUBLIC_ORIGIN=https://your-real-domain.example \
  stacked-studio
```

512 MB / one CPU is a starting allocation, not a measured capacity guarantee.
Monitor memory, latency, restarts, and rate-limit responses under your traffic.
Rebuild regularly to receive Node/base-image security updates. The included
GitHub workflow tests Node 22 and 24 and builds the container; it does not deploy.

## Without Docker

Use Node 22 or newer, run `npm test && npm run build && npm run test:build`, then deploy the contents
of `dist/`. Start with `node server.js` from that directory and the same production
environment variables above. There are no npm dependencies to install. The
source checkout keeps its tests; the runtime build excludes them.

`.env.example` documents the settings; it is not automatically loaded. Set
variables in your host's configuration, or explicitly use Node's `--env-file`
option with a private configuration file. Never commit real secrets.

## Request limits and trusted proxies

Defaults are 30 API requests per minute per client IP, two simultaneous requests
per client, and eight total simultaneous requests. All provider endpoints,
including model discovery, use these limits. Failed requests count toward the
rate limit. Configure `API_REQUESTS_PER_MINUTE`, `MAX_ACTIVE_PER_CLIENT`, and
`MAX_ACTIVE_REQUESTS` if necessary. Upstream JSON is limited to 4 MB; generation
has a 180-second timeout. Limits are not authentication or a billing guarantee;
non-browser clients can forge Origin headers and distributed traffic can evade
per-IP limits. Use your host's edge abuse protection for a public launch.

`TRUST_PROXY_HOPS=0` ignores forwarded IP headers. Behind a proxy this means all
users share the proxy IP's limits until you configure it correctly. Set it to
the exact number of trusted proxies that append `X-Forwarded-For`: for one
trusted ingress, use `1`. The app selects from the right end of that header.
Verify the hosting platform's header behavior and block direct access to Node
before enabling this option; otherwise clients can forge their rate-limit IP.
Do not use a guessed hop count or an ingress chain with variable lengths.

## Hosted provider behavior and privacy

Production always disables Ollama and LM Studio, on both the UI and backend.
These would reach the hosting machine, not the user's computer. Run locally
with `npm start` to use them. Custom endpoints default off in production;
`ALLOW_CUSTOM_ENDPOINTS=true` opts into the existing public-HTTPS DNS-pinned
endpoint checks. Fixed cloud providers remain available with user-supplied keys.

Keys, prompts and reference images pass through your server to the selected
provider. The app does not persist them or log request bodies. Configure your
hosting, proxy, tracing and error-monitoring systems to avoid capturing
Authorization headers or request/response bodies. The provider's own retention
and billing rules still apply. Publish accurate operator/contact and privacy
information for your deployment. Local fonts avoid a third-party font request.

## Before sharing the URL

- Confirm HTTPS, canonical domain, `/healthz`, and the provider menu.
- Try photo import, template preview, stack rotation, library double-click,
  drag/drop into Environment, WASD/Q/E, and exported scene files in your target
  browsers. Test first without paid generation, then make a small request using
  your own key and check the provider's usage page.
- Verify ingress timeouts, body limits, IP attribution and log redaction.
- Keep the last working image for rollback. Scene/project data is browser-side;
  users should download their work before clearing browser storage.

Deployment guidance follows the [Node security recommendations](https://nodejs.org/en/learn/getting-started/security-best-practices)
and [Docker build practices](https://docs.docker.com/build/building/best-practices/).
