#
# Stage 1: build the web bundle with pnpm.
#
# Uses the official pnpm image. Node is auto-downloaded by pnpm using the
# `devEngines.runtime` field in package.json (onFail: "download").
#
FROM ghcr.io/pnpm/pnpm:11 AS web-build

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

#
# pnpm config
#
ENV CI=1
# use the pnpm version specified in package.json
ENV pnpm_config_pm_on_fail=download

# The latest git hash of the preview branch on render.com
# https://render.com/docs/docker-secrets#environment-variables-in-docker-builds
ARG RENDER_GIT_COMMIT

#
# Expo
#
ARG EXPO_PUBLIC_ENV
ENV EXPO_PUBLIC_ENV=${EXPO_PUBLIC_ENV:-development}
ARG EXPO_PUBLIC_RELEASE_VERSION
ENV EXPO_PUBLIC_RELEASE_VERSION=$EXPO_PUBLIC_RELEASE_VERSION
ARG EXPO_PUBLIC_BUNDLE_IDENTIFIER
# If not set by GitHub workflows, we're probably in Render
ENV EXPO_PUBLIC_BUNDLE_IDENTIFIER=${EXPO_PUBLIC_BUNDLE_IDENTIFIER:-$RENDER_GIT_COMMIT}
ARG EXPO_PUBLIC_TORAH_PDS_HOST
ENV EXPO_PUBLIC_TORAH_PDS_HOST=${EXPO_PUBLIC_TORAH_PDS_HOST:-https://bsky.social}
ARG EXPO_PUBLIC_TORAH_PDS_DID
ENV EXPO_PUBLIC_TORAH_PDS_DID=${EXPO_PUBLIC_TORAH_PDS_DID:-did:web:bsky.social}
ARG EXPO_PUBLIC_TORAH_APPVIEW_HOST
ENV EXPO_PUBLIC_TORAH_APPVIEW_HOST=${EXPO_PUBLIC_TORAH_APPVIEW_HOST:-https://api.bsky.app}
ARG EXPO_PUBLIC_BLUESKY_PROXY_DID
ENV EXPO_PUBLIC_BLUESKY_PROXY_DID=${EXPO_PUBLIC_BLUESKY_PROXY_DID:-did:web:api.bsky.app}
ARG EXPO_PUBLIC_TORAH_ISOLATED_NETWORK
ENV EXPO_PUBLIC_TORAH_ISOLATED_NETWORK=${EXPO_PUBLIC_TORAH_ISOLATED_NETWORK:-false}

#
# Sentry
#
ARG SENTRY_AUTH_TOKEN
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN:-unknown}
ARG EXPO_PUBLIC_SENTRY_DSN
ENV EXPO_PUBLIC_SENTRY_DSN=$EXPO_PUBLIC_SENTRY_DSN

COPY . .

RUN echo "Using bundle identifier: $EXPO_PUBLIC_BUNDLE_IDENTIFIER" && \
  echo "EXPO_PUBLIC_ENV=$EXPO_PUBLIC_ENV" >> .env && \
  echo "EXPO_PUBLIC_RELEASE_VERSION=$EXPO_PUBLIC_RELEASE_VERSION" >> .env && \
  echo "EXPO_PUBLIC_BUNDLE_IDENTIFIER=$EXPO_PUBLIC_BUNDLE_IDENTIFIER" >> .env && \
  echo "EXPO_PUBLIC_BUNDLE_DATE=$(date -u +"%y%m%d%H")" >> .env && \
  echo "EXPO_PUBLIC_TORAH_PDS_HOST=$EXPO_PUBLIC_TORAH_PDS_HOST" >> .env && \
  echo "EXPO_PUBLIC_TORAH_PDS_DID=$EXPO_PUBLIC_TORAH_PDS_DID" >> .env && \
  echo "EXPO_PUBLIC_TORAH_APPVIEW_HOST=$EXPO_PUBLIC_TORAH_APPVIEW_HOST" >> .env && \
  echo "EXPO_PUBLIC_BLUESKY_PROXY_DID=$EXPO_PUBLIC_BLUESKY_PROXY_DID" >> .env && \
  echo "EXPO_PUBLIC_TORAH_ISOLATED_NETWORK=$EXPO_PUBLIC_TORAH_ISOLATED_NETWORK" >> .env && \
  echo "EXPO_PUBLIC_SENTRY_DSN=$EXPO_PUBLIC_SENTRY_DSN" >> .env

# pnpm install must run before the isolation patch because this base image
# downloads the Node runtime through pnpm according to package.json.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# The upstream client contains public Bluesky AppView/Discover constants that
# are compile-time values. For an isolated Torah deployment they must be
# rewritten before Metro builds the static JS bundle; changing bskyweb's
# runtime ATP_APPVIEW_HOST alone is not enough.
RUN if [ "$EXPO_PUBLIC_TORAH_ISOLATED_NETWORK" = "true" ]; then \
      node ./scripts/torah-isolate-client.mjs; \
    fi

RUN pnpm intl:build 2>&1 | tee i18n.log && \
  if grep -q "invalid syntax" "i18n.log"; then echo "\n\nFound compilation errors!\n\n" && exit 1; else echo "\n\nNo compile errors!\n\n"; fi

RUN SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    SENTRY_RELEASE=$EXPO_PUBLIC_RELEASE_VERSION \
    SENTRY_DIST=$EXPO_PUBLIC_BUNDLE_IDENTIFIER \
    pnpm build-web

#
# Stage 2: build the bskyweb Go binary, embedding the assets from stage 1.
#
# post-web-build.js (run by `pnpm build-web`) writes the bundled JS/CSS/media
# into bskyweb/static/* and regenerates bskyweb/templates/scripts.html, so
# copying the bskyweb/ tree from stage 1 is enough for go:embed to find
# everything.
#
FROM golang:1.26-bookworm AS go-build

WORKDIR /usr/src/social-app

ENV GODEBUG="netdns=go"
ENV GOOS="linux"
# Intentionally do not force GOARCH. The build stage follows the Docker target
# architecture, so this image works on both amd64 VPSes and Oracle A1 arm64.
ENV CGO_ENABLED=1
ENV GOEXPERIMENT="loopvar"

COPY --from=web-build /app/bskyweb ./bskyweb

# DEBUG
RUN find ./bskyweb/static

RUN cd bskyweb/ && \
  go mod download && \
  go mod verify

RUN cd bskyweb/ && \
  go build \
    -v  \
    -trimpath \
    -tags timetzdata \
    -o /bskyweb \
    ./cmd/bskyweb

#
# Stage 3: runtime image.
#
FROM debian:bookworm-slim

ENV GODEBUG=netdns=go
ENV TZ=Etc/UTC
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install --yes \
  dumb-init \
  ca-certificates

ENTRYPOINT ["dumb-init", "--"]

WORKDIR /bskyweb
COPY --from=go-build /bskyweb /usr/bin/bskyweb

CMD ["/usr/bin/bskyweb", "serve"]

LABEL org.opencontainers.image.source=https://github.com/davidpovarsky/social-app
LABEL org.opencontainers.image.description="Torah Social Web App"
LABEL org.opencontainers.image.licenses=MIT

# NOOP
