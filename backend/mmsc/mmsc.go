// Package mmsc reads and writes .mmsc files, the self-contained project
// format: a ZIP archive holding document.json and the original image bytes
// under images/<id>.<ext>. It is the only code that knows the archive layout.
package mmsc

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
)

// Version is the highest document version this package understands.
const Version = 1

const (
	documentName = "document.json"
	imageDir     = "images/"

	// maxDocumentSize bounds document.json when unpacking so a corrupt or
	// hostile archive cannot inflate without limit. Images are stored
	// uncompressed, so they need no such bound beyond the archive size.
	maxDocumentSize = 64 << 20
)

// document is the subset of document.json needed to validate an archive.
// Everything else in the document is opaque to the backend.
type document struct {
	Version int `json:"version"`
	Images  []struct {
		ID  string `json:"id"`
		Ext string `json:"ext"`
	} `json:"images"`
	Sprites []struct {
		Image string `json:"image"`
	} `json:"sprites"`
}

// Pack builds a .mmsc archive from a document and its images. The images map
// is keyed by file name ("<id>.<ext>") and must contain exactly the images the
// document declares.
func Pack(doc []byte, images map[string][]byte) ([]byte, error) {
	if err := validate(doc, images); err != nil {
		return nil, fmt.Errorf("pack: %w", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	w, err := zw.CreateHeader(&zip.FileHeader{Name: documentName, Method: zip.Deflate})
	if err != nil {
		return nil, fmt.Errorf("pack: create %s: %w", documentName, err)
	}
	if _, err := w.Write(doc); err != nil {
		return nil, fmt.Errorf("pack: write %s: %w", documentName, err)
	}

	// Deterministic order makes archives reproducible and tests stable.
	names := make([]string, 0, len(images))
	for name := range images {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		// Images are already compressed formats; storing them avoids wasted work.
		w, err := zw.CreateHeader(&zip.FileHeader{Name: imageDir + name, Method: zip.Store})
		if err != nil {
			return nil, fmt.Errorf("pack: create image %s: %w", name, err)
		}
		if _, err := w.Write(images[name]); err != nil {
			return nil, fmt.Errorf("pack: write image %s: %w", name, err)
		}
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("pack: close archive: %w", err)
	}
	return buf.Bytes(), nil
}

// Unpack reads a .mmsc archive and returns document.json and the images keyed
// by file name ("<id>.<ext>"). It rejects archives whose document and images
// disagree.
func Unpack(data []byte) (doc []byte, images map[string][]byte, err error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, fmt.Errorf("unpack: not a zip archive: %w", err)
	}

	images = make(map[string][]byte)
	for _, f := range zr.File {
		switch {
		case f.Name == documentName:
			doc, err = readEntry(f, maxDocumentSize)
			if err != nil {
				return nil, nil, fmt.Errorf("unpack: %w", err)
			}
		case strings.HasPrefix(f.Name, imageDir):
			name := strings.TrimPrefix(f.Name, imageDir)
			if name == "" || name != path.Base(name) {
				return nil, nil, fmt.Errorf("unpack: unexpected entry %q", f.Name)
			}
			b, err := readEntry(f, int64(len(data)))
			if err != nil {
				return nil, nil, fmt.Errorf("unpack: %w", err)
			}
			images[name] = b
		default:
			return nil, nil, fmt.Errorf("unpack: unexpected entry %q", f.Name)
		}
	}
	if doc == nil {
		return nil, nil, fmt.Errorf("unpack: archive has no %s", documentName)
	}
	if err := validate(doc, images); err != nil {
		return nil, nil, fmt.Errorf("unpack: %w", err)
	}
	return doc, images, nil
}

func readEntry(f *zip.File, limit int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", f.Name, err)
	}
	defer rc.Close()
	b, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", f.Name, err)
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("read %s: exceeds %d bytes", f.Name, limit)
	}
	return b, nil
}

// validate checks that the document parses, is a known version, and that its
// declared images match the supplied files and cover every sprite.
func validate(doc []byte, images map[string][]byte) error {
	var d document
	if err := json.Unmarshal(doc, &d); err != nil {
		return fmt.Errorf("parse document: %w", err)
	}
	if d.Version < 1 || d.Version > Version {
		return fmt.Errorf("unsupported document version %d (this build reads up to %d)", d.Version, Version)
	}

	declared := make(map[string]string, len(d.Images)) // id -> file name
	for _, im := range d.Images {
		if im.ID == "" || im.Ext == "" || strings.ContainsAny(im.ID+im.Ext, "/\\") {
			return fmt.Errorf("invalid image entry id=%q ext=%q", im.ID, im.Ext)
		}
		if _, dup := declared[im.ID]; dup {
			return fmt.Errorf("duplicate image id %q", im.ID)
		}
		name := im.ID + "." + im.Ext
		if _, ok := images[name]; !ok {
			return fmt.Errorf("image %s declared but missing", name)
		}
		declared[im.ID] = name
	}
	if len(images) != len(declared) {
		var extra []string
		for name := range images {
			found := false
			for _, n := range declared {
				if n == name {
					found = true
					break
				}
			}
			if !found {
				extra = append(extra, name)
			}
		}
		sort.Strings(extra)
		return fmt.Errorf("images not declared in document: %s", strings.Join(extra, ", "))
	}
	for i, s := range d.Sprites {
		if _, ok := declared[s.Image]; !ok {
			return fmt.Errorf("sprite %d references unknown image %q", i, s.Image)
		}
	}
	return nil
}
