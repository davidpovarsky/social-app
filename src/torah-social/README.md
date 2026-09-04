# Torah Social extensions

This directory contains product behavior that belongs to Torah Social rather than upstream `bluesky-social/social-app`.

## Upstream merge rule

Prefer adding code here over editing upstream files. Torah/Sefaria business logic must not be moved into upstream components.

The first Sefaria vertical slice keeps the permanent upstream diff deliberately tiny:

1. `src/components/Post/Embed/ExternalEmbed/index.tsx`
   - detects Sefaria URLs and delegates rendering to `TorahSourceCard`

Composer integration is applied by `scripts/torah-isolate-client.mjs` during every isolated Torah build instead of being maintained as a permanent edit to the large upstream `Composer.tsx` file. The script injects two small hooks at checked anchors:

- `TorahComposerSourceButton` in the media toolbar, immediately after GIF and before the web emoji picker
- `TorahComposerExtensions` directly above the toolbar for automatic Sefaria reference suggestions

The patch uses required anchors and intentionally fails the build if an upstream merge moves either location. That makes upstream changes visible immediately instead of silently dropping Torah controls.

`src/view/com/composer/text-input/TextInput.tsx` is no longer used as a Torah UI hook; the earlier hidden control there was removed because the full-height text input could push it outside the visible composer.

## Sefaria API contract

Verified against the current Sefaria Developer Portal and current Sefaria-Project source in September 2026.

- `GET /api/name/{name}?type=ref&limit=10`
  - autocomplete refs
  - response uses `completion_objects`
- `GET /api/ref/{tref}`
  - validates and normalizes a ref
  - invalid refs can return HTTP 200 with `is_ref: false`
- `GET /api/v3/texts/{tref}?version=primary&return_format=text_only`
  - current text retrieval API
  - text is returned through `versions[]`; licensing is version-specific
- `POST /api/find-refs`
  - asynchronous citation detection
  - request body: `{ text: { title, body }, lang }`
  - returns HTTP 202 with `task_id`
- `GET /api/async/{task_id}`
  - HTTP 202 while pending
  - HTTP 200 with the linker output in `result` when complete

Sefaria does not require an API key for these documented endpoints.

## First vertical slice

- manual source picker with Sefaria ref autocomplete
- canonical ref validation before attachment
- automatic citation detection via the Sefaria Linker
- ambiguous linker matches are never auto-attached
- source is persisted as a standards-compatible `app.bsky.embed.external` URL
- Sefaria external embeds render as a Torah-specific source card
- source card opens an in-app reader
- text attribution/license metadata is preserved when Sefaria provides it

## Why external embeds first?

This keeps the first slice compatible with existing AT Protocol post records and avoids changing upstream Bluesky Lexicons. A Torah Social Lexicon can be introduced later, once a permanent Torah Social namespace/domain is chosen and multi-source attachments are implemented.
