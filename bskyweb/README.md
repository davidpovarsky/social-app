## Build / Develop

### SPA Bundle (monolithic static javascript file)

To build the SPA bundle (`bundle.web.js`), first get a JavaScript development
environment set up. Either follow the top-level README, or something quick
like:

```bash
# install nodejs
nvm install
nvm use
npm install --global pnpm

# setup tools and deps (in top level of this repo)
pnpm install --frozen-lockfile

# run pnpm web dev server, if you wanted
pnpm web
```

Then build and copy over the big 'ol `bundle.web.js` file:

```bash
# in the top level of this repo
pnpm build-web
```

### Golang Daemon

Install golang. We generally develop against the current stable release of the language, as declared in `go.mod`.

In this directory (`bskyweb/`):

```bash
# re-build and run daemon
go run ./cmd/bskyweb serve

# build and output a binary
go build -o bskyweb ./cmd/bskyweb/
```

The easiest way to configure the daemon is to copy `example.env` to `.env` and
fill in auth values there.

## Public web origin

Set `BSKY_WEB_ORIGIN` (or `--web-origin`) to the externally reachable web app
origin. It defaults to `https://bsky.app` for the public upstream deployment.
The server uses this value for canonical and OpenGraph URLs, the home page's
existing static social-card asset, and generated post/profile links throughout
JSON-LD. It does not infer the origin from an incoming Host header.

For the independent Torah deployment:

```bash
BSKY_WEB_ORIGIN=https://torah-130-110-238-163.nip.io
```

Use the web origin, not the PDS or AppView origin. The value must be an HTTP(S)
origin with an optional port and trailing slash; credentials, subpaths, query
parameters, and fragments are rejected at startup. HTTPS is appropriate for
production; HTTP supports local development.

Post images, avatars, profile banners, and external link targets continue to
use the actual AppView data. An independent origin omits public Bluesky oEmbed
discovery because this server does not implement an independent oEmbed service.
Setting this value does not configure the client bundle or a PDS/AppView; those
endpoints must still be configured separately.

## Web app statics: embedded and remote modes

`bskyweb` serves the web app's build output (`static/_expo/`, `static/assets/`)
and the template fragments that load it (`templates/scripts.html`,
`templates/fonts.html`) in one of two modes:

- **Embedded mode** (default, `BSKY_APP_VERSION` unset): serves the build
  embedded in the binary at compile time, produced by `pnpm build-web`. Local
  development and Render use this mode.
- **Remote mode** (`BSKY_APP_VERSION` set to a social-app commit SHA): serves
  that build from S3 (`BSKY_APP_STATICS_BUCKET` and `BSKY_APP_STATICS_REGION`,
  which default to production). The `publish-web-statics` GitHub workflow
  publishes builds there under `<commit SHA>/`. This lets the web app be
  deployed without a new `bskyweb` image.

In remote mode nothing is downloaded at startup. Each file is fetched the first
time it's needed and kept in memory for the life of the process, and concurrent
requests for the same file share one download. Until the fragments can be
loaded, `/` returns a 500, so the pod doesn't become ready. Everything else
(page templates, favicons, `robots.txt`, etc.) always comes from the binary.
Debug mode ignores `BSKY_APP_VERSION`.

## Feature-gate fallback

By default, `bskyweb` fetches the public GrowthBook configuration on startup and
every minute, with a five-second request timeout and a 1 MiB response limit.
The last valid payload is embedded as inert JSON in each app document. Requests
never wait for GrowthBook; an empty cache or an upstream outage cannot prevent
the page from loading. A snapshot that has not been successfully refreshed for
four hours is omitted. The worker's failures are logged by `bskyweb`.

`GROWTHBOOK_API_HOST` (default `https://events.bsky.app/gb`) and
`GROWTHBOOK_CLIENT_KEY` (default `sdk-7gkUkGy9wguUjyFe`) must match the web bundle's
`EXPO_PUBLIC_GROWTHBOOK_API_HOST` and `EXPO_PUBLIC_GROWTHBOOK_CLIENT_KEY` settings.
The corresponding `EXPO_PUBLIC_*` variables are also accepted by the server.
Set `FEATURE_GATE_BOOTSTRAP=false` to disable the server fetch and HTML payload.

In public-network mode, the browser still uses the normal GrowthBook endpoint.
Independent Torah builds (`EXPO_PUBLIC_TORAH_ISOLATED_NETWORK=true`) use explicit
local capability defaults and skip remote GrowthBook initialization, cached
public rollouts, and refreshes. Set `FEATURE_GATE_BOOTSTRAP=false` on that server
as well, so it does not fetch public configuration for unused HTML payloads.

In public-network mode, if the browser request fails or times out,
the embedded configuration supplies the rules and saved targeting groups. Newer
HTML rules also take precedence over an older SDK cache; later network updates
can replace them. The app document uses `Cache-Control: no-cache` so new document
loads revalidate. An already-open tab does not receive a new HTML snapshot during
SPA navigation. Native apps and static development pages use the existing SDK
behavior, and metrics continue to use their existing endpoint.

To verify that the SDK applied the embedded configuration, open the System log
under Settings > About (`/sys/log` on web) and look for
`GrowthBook HTML fallback applied`.
The entry includes the applied revision, feature count, and saved-group count.
`GrowthBook SDK configuration applied` records a configuration supplied by the
SDK instead, including recovery to a newer revision. These diagnostics are
available in production whenever a matching HTML snapshot is present. Repeated
refreshes of the same source and revision do not add duplicate entries.
