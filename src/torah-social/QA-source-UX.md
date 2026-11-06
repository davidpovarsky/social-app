# Torah Social - source composer regression checklist

## State
- Isolated branch: codex/torah-social-source-ux-fixes-20261105
- Sources use app.bsky.embed.external with canonical Sefaria URI.
- Old published posts remain unchanged, including any duplicate links.

## iPhone/iPad manual acceptance (pending device QA)
1. iPad portrait, landscape, split view: source picker input, suggestions, and buttons fit inside modal (no clipped RTL/right edge).
2. Composer with source and keyboard visible: caret and editable text remain reachable; compact source attachment instead of full-size preview; automatic suggestions are scrollable, not fixed above media toolbar.
3. Enter a source ref: no duplicate suggestion cards; attach exactly one Sefaria card.
4. Add quote twice via detection/picker: no second identical insertion; plain Hebrew text without raw Sefaria URL.
5. Publish: Sefaria source card above post text on feed, main thread, reply and compact tree; internal reader opens.
6. Legacy posts with Sefaria quote URLs still display and open.
7. Onboarding isolated network: local suggested accounts loaded; self/fixtures filtered; no generic Bluesky topic tabs; error/empty state is Hebrew with Continue.
8. Confirm non-Torah builds retain previous onboarding behavior.
9. Run isolation build patch twice and verify independent AppView/PDS endpoints.

## Automated checks performed
- Source quote/duplicate/legacy/RTL smoke checks using tsx on Windows.
- Prettier parsed modified TypeScript, JSX and JS.
- node --check and git diff --check.
- Isolation build patch executed twice with independent network endpoints.

## Pending
- Full TypeScript/Jest (project requires Node 24; workstation Node 22).
- Native IPA on Xcode runner, on-device iPad screenshots and QA.
