# Torah Social extensions

This directory contains product behavior that belongs to Torah Social rather than upstream `bluesky-social/social-app`.

## Upstream merge rule

Prefer adding code here over editing upstream files. The first Sefaria vertical slice intentionally has only two upstream hooks:

1. `src/view/com/composer/text-input/TextInput.tsx`
   - imports and renders `TorahComposerExtensions`
2. `src/components/Post/Embed/ExternalEmbed/index.tsx`
   - detects Sefaria URLs and delegates rendering to `TorahSourceCard`

Do not move Torah/Sefaria business logic into those upstream files.

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
