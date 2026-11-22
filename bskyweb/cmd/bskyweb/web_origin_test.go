package main

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	appbsky "github.com/bluesky-social/indigo/api/bsky"
	"github.com/bluesky-social/indigo/xrpc"
	"github.com/bluesky-social/social-app/bskyweb"
	"github.com/labstack/echo/v4"
)

func TestNormalizeWebOrigin(t *testing.T) {
	for _, test := range []struct {
		input string
		want  string
	}{
		{"", defaultWebOrigin},
		{"https://bsky.app", defaultWebOrigin},
		{"https://torah.example/", "https://torah.example"},
		{"http://127.0.0.1:8100", "http://127.0.0.1:8100"},
		{"http://[::1]:8100/", "http://[::1]:8100"},
	} {
		t.Run(test.input, func(t *testing.T) {
			got, err := normalizeWebOrigin(test.input)
			if err != nil || got != test.want {
				t.Fatalf("normalizeWebOrigin(%q) = (%q, %v), want %q", test.input, got, err, test.want)
			}
		})
	}
	for _, input := range []string{
		"torah.example", "//torah.example", "ftp://torah.example",
		"https://", "https://user:secret@torah.example",
		"https://torah.example/app", "https://torah.example//",
		"https://torah.example/%2f", "https://torah.example?key=value",
		"https://torah.example?", "https://torah.example#fragment",
		"https://torah.example#", " https://torah.example",
		"https://torah.example\n", "https://torah.example:",
		"https://torah.example:0", "https://torah.example:65536",
		"https://torah.example:abc", "https://[not-an-ip]",
	} {
		t.Run("reject/"+input, func(t *testing.T) {
			if got, err := normalizeWebOrigin(input); err == nil {
				t.Fatalf("accepted invalid origin %q as %q", input, got)
			}
		})
	}
}

// Exercise the actual templates even before a JS build. Only the generated JS
// and font include fragments get empty stand-ins when they are absent.
func metadataTestRenderer(t *testing.T) *Renderer {
	t.Helper()
	files := fstest.MapFS{}
	err := fs.WalkDir(bskyweb.TemplateFS, "templates", func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		data, err := bskyweb.TemplateFS.ReadFile(path)
		if err != nil {
			return err
		}
		files[path] = &fstest.MapFile{Data: data}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"templates/scripts.html", "templates/fonts.html"} {
		if _, ok := files[path]; !ok {
			files[path] = &fstest.MapFile{}
		}
	}
	return NewRenderer("templates/", files, false)
}

func TestWebMetadataUsesConfiguredOrigin(t *testing.T) {
	post := postViewJSON(
		"at://did:plc:alice/app.bsky.feed.post/abc123",
		"did:plc:alice", "alice.torah.test",
		map[string]any{"$type": "app.bsky.feed.post", "text": "Source discussion", "createdAt": "2026-10-01T00:00:00.000Z"},
		0,
	)
	post["embed"] = map[string]any{
		"$type": "app.bsky.embed.images#view",
		"images": []any{map[string]any{
			"thumb":    "https://media.torah.test/post.jpg",
			"fullsize": "https://media.torah.test/post-full.jpg",
			"alt":      "Actual post image",
		}},
	}
	profile := map[string]any{
		"did": "did:plc:alice", "handle": "alice.torah.test",
		"displayName": "Alice", "description": "Source discussion",
		"banner": "https://media.torah.test/banner.jpg",
	}
	appview := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var data any
		switch r.URL.Path {
		case "/xrpc/app.bsky.feed.getPostThread":
			data = map[string]any{"thread": map[string]any{"$type": "app.bsky.feed.defs#threadViewPost", "post": post}}
		case "/xrpc/app.bsky.actor.getProfile":
			data = profile
		case "/xrpc/app.bsky.feed.getAuthorFeed":
			data = map[string]any{"feed": []any{map[string]any{"post": post}}}
		default:
			t.Errorf("unexpected AppView request %s", r.URL.String())
			http.Error(w, "unexpected", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(data); err != nil {
			t.Errorf("encode AppView response: %v", err)
		}
	}))
	defer appview.Close()

	for _, test := range []struct {
		name       string
		configured string
		wantOrigin string
	}{
		{"public-default", "", defaultWebOrigin},
		{"independent", "https://torah.example:8443", "https://torah.example:8443"},
	} {
		t.Run(test.name, func(t *testing.T) {
			e := echo.New()
			e.Renderer = metadataTestRenderer(t)
			srv := &Server{
				echo: e, cfg: &Config{webOrigin: test.configured},
				xrpcc: &xrpc.Client{Client: appview.Client(), Host: appview.URL},
			}
			e.GET("/", srv.WebHome)
			e.GET("/profile/:handleOrDID/post/:rkey", srv.WebPost)
			e.GET("/profile/:handleOrDID", srv.WebProfile)

			for _, page := range []struct {
				path     string
				wantPath string
				image    string
			}{
				{"/", "", test.wantOrigin + "/static/social-card-default-gradient.png"},
				{"/profile/alice.torah.test/post/abc123", "/profile/alice.torah.test/post/abc123", "https://media.torah.test/post.jpg"},
				{"/profile/alice.torah.test?tab=replies", "/profile/alice.torah.test?tab=replies", "https://media.torah.test/banner.jpg"},
			} {
				t.Run(page.path, func(t *testing.T) {
					rec := httptest.NewRecorder()
					req := httptest.NewRequest(http.MethodGet, "http://untrusted-request.test"+page.path, nil)
					e.ServeHTTP(rec, req)
					if rec.Code != http.StatusOK {
						t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
					}
					body := rec.Body.String()
					canonical := test.wantOrigin + page.wantPath
					for _, expected := range []string{
						"<meta property=\"og:url\" content=\"" + canonical + "\"",
						"<link rel=\"canonical\" href=\"" + canonical + "\" />",
						"<meta property=\"og:image\" content=\"" + page.image + "\"",
					} {
						if !strings.Contains(body, expected) {
							t.Errorf("missing metadata %s", expected)
						}
					}
					if page.path == "/" {
						return
					}
					ld := extractJSONLD(t, body)
					wantPostURL := test.wantOrigin + "/profile/alice.torah.test/post/abc123"
					if !strings.Contains(ld, "\"url\":\""+wantPostURL+"\"") {
						t.Errorf("JSON-LD does not use configured origin: %s", ld)
					}
					if test.configured != "" && strings.Contains(ld, "https://bsky.app/profile/") {
						t.Errorf("JSON-LD leaks public profile/post URLs: %s", ld)
					}
					if strings.Contains(page.path, "/post/") {
						hasOEmbed := strings.Contains(body, "https://embed.bsky.app/oembed")
						if hasOEmbed != (test.wantOrigin == defaultWebOrigin) {
							t.Errorf("public oEmbed discovery = %t for %s", hasOEmbed, test.wantOrigin)
						}
					}
				})
			}
		})
	}
}

func TestJSONLDUsesOriginForNestedNetworkLinks(t *testing.T) {
	const origin = "https://torah.example"
	verifications := makeVerificationState(
		verifierSpec{issuer: "did:plc:verifier", handle: "verifier.torah.test", isValid: true},
		verifierSpec{issuer: "did:plc:fallback", handle: "handle.invalid", isValid: true},
	)
	quote := quoteOpts{handle: "quoted.torah.test", did: "did:plc:quoted", rkey: "quoted", text: "Quoted source"}
	post := makePostView("alice.torah.test", "did:plc:alice", "abc123", "Source discussion",
		withQuoteAndExternal(quote, "https://www.sefaria.org/Genesis.1.1"),
		withVerifications(verifications),
	)
	reply := makePostView("reply.torah.test", "did:plc:reply", "reply", "Reply", withVideoFull(videoEmbedOpts{thumbnail: "https://media.torah.test/reply.jpg", playlist: "https://media.torah.test/reply.m3u8"}))
	parent := makePostView("parent.torah.test", "did:plc:parent", "parent", "Parent")
	thread := buildChain(post, parent)
	thread.Replies = buildReplies(reply)
	canonical := origin + "/profile/alice.torah.test/post/abc123"
	rootURL := origin + "/profile/parent.torah.test/post/parent"
	out, err := buildPostJSONLD(origin, post, thread, canonical, rootURL, hideEmbedLabels, hideReplyLabels)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		canonical, rootURL,
		origin + "/profile/alice.torah.test",
		origin + "/profile/reply.torah.test/post/reply",
		origin + "/profile/quoted.torah.test/post/quoted",
		origin + "/profile/quoted.torah.test",
		origin + "/profile/verifier.torah.test",
		origin + "/profile/did:plc:fallback",
		"https://www.sefaria.org/Genesis.1.1",
		"https://media.torah.test/reply.jpg",
	} {
		if !strings.Contains(out, "\""+want+"\"") {
			t.Errorf("JSON-LD missing expected URL %s", want)
		}
	}
	if strings.Contains(out, "https://bsky.app/profile/") {
		t.Errorf("nested network URL escaped to public origin: %s", out)
	}
	main := mainEntity(t, out)
	replyNode := main["comment"].([]any)[0].(map[string]any)
	video := replyNode["video"].(map[string]any)
	if video["embedUrl"] != origin+"/profile/reply.torah.test/post/reply" {
		t.Errorf("video embedUrl = %v", video["embedUrl"])
	}

	profile := newProfileViewDetailed()
	profile.Verification = verifications
	profileJSON, err := buildProfileJSONLD(origin, profile, []*appbsky.FeedDefs_PostView{post}, hideEmbedLabels, hideReplyLabels)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(profileJSON, "\"url\":\""+canonical+"\"") ||
		!strings.Contains(profileJSON, "\"url\":\""+origin+"/profile/did:plc:fallback\"") ||
		strings.Contains(profileJSON, "https://bsky.app/profile/") {
		t.Errorf("profile JSON-LD does not consistently use origin: %s", profileJSON)
	}
	if got := bskyPostURLFromATURIWithDIDFallback(origin, "handle.invalid", post.Uri); got != origin+"/profile/did:plc:alice/post/abc123" {
		t.Errorf("DID fallback URL = %s", got)
	}
}
