package mmsc

import (
	"bytes"
	"strings"
	"testing"
)

const testDoc = `{
  "version": 1,
  "view": {"zoom": 1, "panX": 0, "panY": 0},
  "images": [
    {"id": "a", "ext": "png", "width": 2, "height": 2},
    {"id": "b", "ext": "jpg", "width": 3, "height": 1}
  ],
  "sprites": [
    {"id": "s1", "image": "a", "x": 0, "y": 0, "w": 2, "h": 2},
    {"id": "s2", "image": "b", "x": 10, "y": 0, "w": 3, "h": 1, "crop": {"x": 0, "y": 0, "w": 2, "h": 1}, "group": "g"}
  ]
}`

func testImages() map[string][]byte {
	return map[string][]byte{
		"a.png": {0x89, 'P', 'N', 'G', 1, 2, 3, 4},
		"b.jpg": {0xFF, 0xD8, 0xFF, 9, 8, 7},
	}
}

func TestRoundTrip(t *testing.T) {
	packed, err := Pack([]byte(testDoc), testImages())
	if err != nil {
		t.Fatalf("Pack: %v", err)
	}
	doc, images, err := Unpack(packed)
	if err != nil {
		t.Fatalf("Unpack: %v", err)
	}
	if string(doc) != testDoc {
		t.Errorf("document changed in round trip:\n%s", doc)
	}
	want := testImages()
	if len(images) != len(want) {
		t.Fatalf("got %d images, want %d", len(images), len(want))
	}
	for name, b := range want {
		if !bytes.Equal(images[name], b) {
			t.Errorf("image %s not byte-identical: got %v want %v", name, images[name], b)
		}
	}
}

func TestPackIsDeterministic(t *testing.T) {
	a, err := Pack([]byte(testDoc), testImages())
	if err != nil {
		t.Fatal(err)
	}
	b, err := Pack([]byte(testDoc), testImages())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Error("two packs of the same input differ")
	}
}

func TestPackRejectsMismatch(t *testing.T) {
	cases := map[string]struct {
		doc    string
		images map[string][]byte
		want   string
	}{
		"missing image file": {
			doc:    testDoc,
			images: map[string][]byte{"a.png": {1}},
			want:   "declared but missing",
		},
		"undeclared image file": {
			doc:    testDoc,
			images: func() map[string][]byte { m := testImages(); m["c.png"] = []byte{1}; return m }(),
			want:   "not declared",
		},
		"sprite with unknown image": {
			doc:    strings.Replace(testDoc, `"image": "b"`, `"image": "zz"`, 1),
			images: testImages(),
			want:   "unknown image",
		},
		"future version": {
			doc:    strings.Replace(testDoc, `"version": 1`, `"version": 99`, 1),
			images: testImages(),
			want:   "unsupported document version",
		},
		"not json": {
			doc:    "{nope",
			images: testImages(),
			want:   "parse document",
		},
		"path in image id": {
			doc:    strings.Replace(testDoc, `"id": "a"`, `"id": "../a"`, 1),
			images: testImages(),
			want:   "invalid image entry",
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := Pack([]byte(c.doc), c.images)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Errorf("got err %v, want containing %q", err, c.want)
			}
		})
	}
}

func TestUnpackRejectsGarbage(t *testing.T) {
	if _, _, err := Unpack([]byte("this is not a zip")); err == nil {
		t.Error("expected error for non-zip input")
	}
}
