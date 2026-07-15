//go:build js && wasm

// The conversion core of the RMB → USD extension, compiled to WebAssembly.
//
// WASM cannot touch the DOM or chrome.* APIs, so the split is:
//   - Go (this file): find RMB prices in a text string, parse values,
//     format USD amounts. Pure computation, no browser types.
//   - JS shell (content.js): walk the DOM, feed text nodes to Go, build the
//     annotation spans from the segments Go returns, watch mutations,
//     talk to chrome.storage.
//
// The exported API (registered on the content script's global as __r2uGo):
//   segment(text string) -> JSON [{s: "plain"}, {s: "¥30.00", cny: 30}, ...]
//   formatUsd(value float64, decimals string) -> "$4.2857"
//
// segment() returns the whole input split into ordered pieces, so the JS
// side rebuilds the text node from strings alone — no byte/UTF-16 offset
// mapping across the language boundary.
package main

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"syscall/js"

	"regexp"
)

// Same pattern as the JS branch; RE2 supports everything it uses.
//   symbol/code first:  ¥30.00  ￥1,299.5  CNY 88  RMB6  ¥3.5万  ¥2亿
//   unit last:          99元  1,000 元  3.5万元  88.8 CNY  6 RMB
var priceRE = regexp.MustCompile(
	`(?:¥|￥|\b(?:RMB|CNY))\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*([万亿]))?` +
		`|\b([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*([万亿]))?\s*(?:元|(?:RMB|CNY)\b)`)

type segment struct {
	S   string   `json:"s"`
	Cny *float64 `json:"cny,omitempty"`
}

func multiplier(s string) float64 {
	switch s {
	case "万":
		return 1e4
	case "亿":
		return 1e8
	}
	return 1
}

// segmentText splits text into plain and price segments, in document order.
// Returns an empty slice when the text contains no prices.
func segmentText(text string) []segment {
	locs := priceRE.FindAllStringSubmatchIndex(text, -1)
	segs := make([]segment, 0, len(locs)*2+1)
	last := 0
	for _, m := range locs {
		numLo, numHi := m[2], m[3]
		multLo, multHi := m[4], m[5]
		if numLo < 0 {
			numLo, numHi = m[6], m[7]
			multLo, multHi = m[8], m[9]
		}
		if numLo < 0 {
			continue
		}
		raw := strings.ReplaceAll(text[numLo:numHi], ",", "")
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil || math.IsInf(v, 0) || math.IsNaN(v) {
			continue
		}
		if multLo >= 0 {
			v *= multiplier(text[multLo:multHi])
		}
		if m[0] > last {
			segs = append(segs, segment{S: text[last:m[0]]})
		}
		val := v
		segs = append(segs, segment{S: text[m[0]:m[1]], Cny: &val})
		last = m[1]
	}
	if len(segs) == 0 {
		return segs
	}
	if last < len(text) {
		segs = append(segs, segment{S: text[last:]})
	}
	return segs
}

// formatUsd mirrors the JS branch exactly: at least 4 fraction digits,
// rounded; "auto" extends up to 8 digits for sub-dollar values (~3
// significant digits); "4"/"5"/"6" pin the width. Thousands separators in
// the integer part.
func formatUsd(value float64, decimals string) string {
	minD, maxD := 4, 4
	if decimals == "auto" {
		if value > 0 && value < 1 {
			d := 2 - int(math.Floor(math.Log10(value)))
			if d < 4 {
				d = 4
			}
			if d > 8 {
				d = 8
			}
			maxD = d
		}
	} else if d, err := strconv.Atoi(decimals); err == nil {
		if d < 4 {
			d = 4
		}
		if d > 8 {
			d = 8
		}
		minD, maxD = d, d
	}

	s := strconv.FormatFloat(value, 'f', maxD, 64)
	sign := ""
	if strings.HasPrefix(s, "-") {
		sign = "-"
		s = s[1:]
	}
	intPart, fracPart, _ := strings.Cut(s, ".")
	for len(fracPart) > minD && strings.HasSuffix(fracPart, "0") {
		fracPart = fracPart[:len(fracPart)-1]
	}

	var b strings.Builder
	for i, ch := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(ch)
	}
	out := "$" + sign + b.String()
	if fracPart != "" {
		out += "." + fracPart
	}
	return out
}

func main() {
	api := js.Global().Get("Object").New()
	api.Set("segment", js.FuncOf(func(_ js.Value, args []js.Value) any {
		segs := segmentText(args[0].String())
		b, err := json.Marshal(segs)
		if err != nil {
			return "[]"
		}
		return string(b)
	}))
	api.Set("formatUsd", js.FuncOf(func(_ js.Value, args []js.Value) any {
		return formatUsd(args[0].Float(), args[1].String())
	}))
	api.Set("ready", true)
	js.Global().Set("__r2uGo", api)

	// Keep the Go runtime alive; the exported funcs are the program.
	select {}
}
