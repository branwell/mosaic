// Package api exposes the local HTTP API used by the frontend: packing and
// unpacking .mmsc files. It translates between HTTP and the mmsc package and
// does nothing else.
package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"path"

	"mosaic/mmsc"
)

const (
	// maxBody bounds a single request so a runaway upload cannot exhaust
	// memory. Compositions are in-memory on both sides anyway.
	maxBody = 1 << 30 // 1 GiB

	// multipartMemory is how much of a multipart body stays in memory before
	// Go spills parts to temporary files.
	multipartMemory = 64 << 20
)

// Register mounts the API handlers on mux.
func Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/pack", handlePack)
	mux.HandleFunc("POST /api/unpack", handleUnpack)
}

// handlePack accepts multipart/form-data with a "document" field (JSON text)
// and any number of "image" file parts named "<id>.<ext>", and responds with
// the .mmsc bytes.
func handlePack(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	if err := r.ParseMultipartForm(multipartMemory); err != nil {
		httpError(w, http.StatusBadRequest, fmt.Errorf("parse form: %w", err))
		return
	}
	defer r.MultipartForm.RemoveAll()

	doc := r.FormValue("document")
	if doc == "" {
		httpError(w, http.StatusBadRequest, fmt.Errorf("missing document field"))
		return
	}

	images := make(map[string][]byte)
	for _, fh := range r.MultipartForm.File["image"] {
		name := path.Base(fh.Filename)
		b, err := readPart(fh)
		if err != nil {
			httpError(w, http.StatusBadRequest, fmt.Errorf("read image %s: %w", name, err))
			return
		}
		images[name] = b
	}

	packed, err := mmsc.Pack([]byte(doc), images)
	if err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", fmt.Sprint(len(packed)))
	if _, err := w.Write(packed); err != nil {
		log.Printf("pack: write response: %v", err)
	}
}

// handleUnpack accepts raw .mmsc bytes and responds with JSON:
// {"document": <document.json>, "images": {"<id>.<ext>": "<base64>"}}.
func handleUnpack(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		httpError(w, http.StatusBadRequest, fmt.Errorf("read body: %w", err))
		return
	}
	doc, images, err := mmsc.Unpack(data)
	if err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	// encoding/json base64-encodes []byte values, which is the wire format
	// the frontend expects.
	resp := struct {
		Document json.RawMessage   `json:"document"`
		Images   map[string][]byte `json:"images"`
	}{Document: doc, Images: images}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("unpack: write response: %v", err)
	}
}

func readPart(fh *multipart.FileHeader) ([]byte, error) {
	f, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}

func httpError(w http.ResponseWriter, status int, err error) {
	if status >= 500 {
		log.Printf("api: %v", err)
	}
	http.Error(w, err.Error(), status)
}
