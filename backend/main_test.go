package main

import (
	"net"
	"net/http"
	"strconv"
	"testing"
)

// occupy binds a free loopback port and serves h on it (or nothing, if h is
// nil). It returns the port.
func occupy(t *testing.T, h http.Handler) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })
	if h != nil {
		srv := &http.Server{Handler: h}
		go srv.Serve(ln)
		t.Cleanup(func() { srv.Close() })
	}
	return ln.Addr().(*net.TCPAddr).Port
}

func addrFor(port int) string {
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
}

func TestListenFallsBackWhenPortIsTakenByOther(t *testing.T) {
	port := occupy(t, http.NotFoundHandler())

	ln, running, err := listen(addrFor(port), portAttempts)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	if running != "" {
		t.Fatalf("running = %q, want empty", running)
	}
	got := ln.Addr().(*net.TCPAddr).Port
	if got <= port || got >= port+portAttempts {
		t.Fatalf("bound port %d, want in (%d, %d)", got, port, port+portAttempts)
	}
}

func TestListenDetectsRunningMosaic(t *testing.T) {
	port := occupy(t, identify(http.NotFoundHandler()))

	ln, running, err := listen(addrFor(port), portAttempts)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	if ln != nil {
		ln.Close()
		t.Fatal("got a listener, want none")
	}
	if running != addrFor(port) {
		t.Fatalf("running = %q, want %q", running, addrFor(port))
	}
}

func TestListenExplicitAddressDoesNotFallBack(t *testing.T) {
	port := occupy(t, nil)

	ln, _, err := listen(addrFor(port), 1)
	if err == nil {
		ln.Close()
		t.Fatal("listen succeeded, want error")
	}
}
