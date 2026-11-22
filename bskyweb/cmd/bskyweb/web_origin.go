package main

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

const defaultWebOrigin = "https://bsky.app"

// normalizeWebOrigin accepts an HTTP(S) origin, never a URL containing user
// information or a path. It is validated at startup instead of trusting the
// request Host header when producing canonical links.
func normalizeWebOrigin(raw string) (string, error) {
	if raw == "" {
		return defaultWebOrigin, nil
	}
	u, err := url.Parse(raw)
	if err != nil || u == nil ||
		(u.Scheme != "https" && u.Scheme != "http") ||
		u.Opaque != "" || u.Hostname() == "" || u.User != nil ||
		(u.Path != "" && u.Path != "/") || u.RawPath != "" ||
		u.RawQuery != "" || u.ForceQuery || strings.Contains(raw, "#") ||
		strings.ContainsAny(raw, " \t\r\n") {
		return "", fmt.Errorf("web-origin must be an HTTP(S) origin without credentials, path, query, or fragment")
	}
	if strings.HasSuffix(u.Host, ":") {
		return "", fmt.Errorf("web-origin must not contain an empty port")
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", fmt.Errorf("web-origin port must be between 1 and 65535")
		}
	}
	if (strings.HasPrefix(u.Host, "[") || strings.Contains(u.Hostname(), ":")) && net.ParseIP(u.Hostname()) == nil {
		return "", fmt.Errorf("web-origin contains an invalid IP address")
	}
	u.Path = ""
	return u.String(), nil
}

func (srv *Server) webOrigin() string {
	if srv.cfg.webOrigin == "" {
		return defaultWebOrigin
	}
	return srv.cfg.webOrigin
}
