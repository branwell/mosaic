// Mosaic serves the editor frontend on loopback and provides the local API
// that packs and unpacks .mmsc files. It makes no outbound connections.
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"mosaic/api"
)

const (
	// defaultAddr uses an uncommon port below the macOS ephemeral range
	// (49152+) so it rarely collides with other local servers.
	defaultAddr = "127.0.0.1:47615"

	// portAttempts is how many consecutive ports are tried when the default
	// address is taken. Trying them in order keeps the fallback port, and the
	// browser's per-origin Open Recent list, stable from run to run.
	portAttempts = 10

	// identityHeader marks every response so a second instance can tell that
	// a busy port belongs to Mosaic.
	identityHeader = "X-Mosaic"
)

func main() {
	addr := flag.String("addr", defaultAddr, "address to listen on (keep it on loopback)")
	frontend := flag.String("frontend", "../frontend", "path to the frontend folder")
	flag.Parse()

	dir, err := filepath.Abs(*frontend)
	if err != nil {
		log.Fatalf("resolve frontend path: %v", err)
	}
	if st, err := os.Stat(filepath.Join(dir, "index.html")); err != nil || st.IsDir() {
		log.Fatalf("frontend folder %s has no index.html", dir)
	}

	// An address given on the command line is used exactly; only the default
	// falls back to neighbouring ports.
	attempts := portAttempts
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "addr" {
			attempts = 1
		}
	})

	ln, running, err := listen(*addr, attempts)
	if err != nil {
		log.Fatalf("%v (choose another address with -addr)", err)
	}
	if running != "" {
		fmt.Printf("Mosaic is already running on http://%s\n", running)
		return
	}

	mux := http.NewServeMux()
	api.Register(mux)
	mux.Handle("/", noCache(http.FileServer(http.Dir(dir))))

	bound := ln.Addr().String()
	if bound != *addr {
		fmt.Printf("Mosaic: %s is in use; using %s instead. Open Recent is kept separately for each port.\n", *addr, bound)
	}
	fmt.Printf("Mosaic: serving %s on http://%s\n", dir, bound)
	if err := http.Serve(ln, identify(mux)); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

// listen binds the first free port among attempts consecutive ports starting
// at addr. If a busy port turns out to be served by another Mosaic, it returns
// that address as running and no listener.
func listen(addr string, attempts int) (ln net.Listener, running string, err error) {
	host, portText, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, "", fmt.Errorf("parse address %q: %w", addr, err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		return nil, "", fmt.Errorf("parse port in %q: %w", addr, err)
	}

	var lastErr error
	for i := range attempts {
		candidate := net.JoinHostPort(host, strconv.Itoa(port+i))
		ln, err := net.Listen("tcp", candidate)
		if err == nil {
			return ln, "", nil
		}
		lastErr = err
		if isMosaic(host, port+i) {
			return nil, candidate, nil
		}
	}
	if attempts == 1 {
		return nil, "", fmt.Errorf("listen on %s: %w", addr, lastErr)
	}
	return nil, "", fmt.Errorf("listen on %s ports %d-%d: %w", host, port, port+attempts-1, lastErr)
}

// isMosaic reports whether the server on host:port identifies itself as
// Mosaic. The probe stays on the given (loopback) address.
func isMosaic(host string, port int) bool {
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	client := http.Client{
		Timeout: 500 * time.Millisecond,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Head("http://" + net.JoinHostPort(host, strconv.Itoa(port)) + "/")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.Header.Get(identityHeader) != ""
}

// identify marks every response as coming from Mosaic.
func identify(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(identityHeader, "1")
		next.ServeHTTP(w, r)
	})
}

// noCache keeps the browser from holding on to stale editor files between
// edits; there is no build step and no versioned asset names.
func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
