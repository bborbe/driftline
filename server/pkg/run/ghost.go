// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package run

import (
	"bytes"
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/bborbe/errors"
)

// MaxGhostTicks is the longest ghost the game decodes (MAX_GHOST_TICKS in src/challenge/link.ts).
const MaxGhostTicks = 60_000

const (
	stateLen = 17 // CarState numbers (STATE_LEN)
	runLen   = 6  // numbers per numeric input run (RUN_LEN)
	symbols  = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv"
	negZero  = `"-0"` // JSON cannot write -0, so the game sends it as a string
)

var keysPattern = regexp.MustCompile(`^(?:[0-9]*[A-Za-v])*$`)

var keyRunPattern = regexp.MustCompile(`([0-9]*)([A-Za-v])`)

// ghost is the game's ghost object (ghostPayload in src/challenge/link.ts): the start state, then
// either packed `keys` (+ `scale`) or numeric runs `r`, and the lap time.
type ghost struct {
	S     []json.RawMessage `json:"s"`
	Keys  *string           `json:"keys"`
	Scale json.RawMessage   `json:"scale"`
	R     []json.RawMessage `json:"r"`
	Ms    json.RawMessage   `json:"ms"`
}

// GhostTicks decodes a ghost far enough to count its ticks and read its lap time (ms), rejecting
// anything the game could not replay.
func GhostTicks(ctx context.Context, raw json.RawMessage) (int, float64, error) {
	var g ghost
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&g); err != nil {
		return 0, 0, errors.Wrap(ctx, err, "ghost is not a ghost object")
	}
	if len(g.S) != stateLen || !allNumbers(g.S) {
		return 0, 0, errors.Errorf(ctx, "ghost start state must be %d numbers", stateLen)
	}
	ms, ok := number(g.Ms)
	if !ok {
		return 0, 0, errors.Errorf(ctx, "ghost lap time must be a number")
	}
	switch {
	case g.Keys != nil && g.R == nil:
		ticks, err := keyTicks(ctx, *g.Keys, g.Scale)
		return ticks, ms, err
	case g.Keys == nil && g.R != nil && g.Scale == nil:
		ticks, err := runTicks(ctx, g.R)
		return ticks, ms, err
	default:
		return 0, 0, errors.Errorf(ctx, "ghost needs exactly one of keys or r")
	}
}

func keyTicks(ctx context.Context, keys string, scale json.RawMessage) (int, error) {
	if !keysPattern.MatchString(keys) {
		return 0, errors.Errorf(ctx, "ghost keys are not a valid packing")
	}
	hasScale := scale != nil
	if hasScale {
		if _, ok := number(scale); !ok {
			return 0, errors.Errorf(ctx, "ghost scale must be a number")
		}
	}
	ticks := 0
	for _, m := range keyRunPattern.FindAllStringSubmatch(keys, -1) {
		count := 1
		if m[1] != "" {
			var err error
			if count, err = strconv.Atoi(m[1]); err != nil || count < 1 {
				return 0, errors.Errorf(ctx, "ghost keys carry an invalid run count %q", m[1])
			}
		}
		if strings.IndexByte(symbols, m[2][0])%2 == 1 && !hasScale {
			return 0, errors.Errorf(ctx, "ghost keys use slow motion without a scale")
		}
		if ticks += count; ticks > MaxGhostTicks {
			return 0, errors.Errorf(ctx, "ghost is longer than %d ticks", MaxGhostTicks)
		}
	}
	return ticks, nil
}

func runTicks(ctx context.Context, runs []json.RawMessage) (int, error) {
	if len(runs)%runLen != 0 || !allNumbers(runs) {
		return 0, errors.Errorf(ctx, "ghost runs must be groups of %d numbers", runLen)
	}
	ticks := 0
	for i := 0; i < len(runs); i += runLen {
		count, err := strconv.Atoi(string(runs[i]))
		if err != nil || count < 1 {
			return 0, errors.Errorf(ctx, "ghost run count %s is not a positive integer", runs[i])
		}
		if ticks += count; ticks > MaxGhostTicks {
			return 0, errors.Errorf(ctx, "ghost is longer than %d ticks", MaxGhostTicks)
		}
	}
	return ticks, nil
}

// number reads a JSON number, or the game's "-0" string, as a float.
func number(raw json.RawMessage) (float64, bool) {
	if string(raw) == negZero {
		return 0, true
	}
	if len(raw) == 0 || raw[0] == '"' || string(raw) == "null" {
		return 0, false
	}
	var f float64
	return f, json.Unmarshal(raw, &f) == nil
}

func allNumbers(values []json.RawMessage) bool {
	for _, v := range values {
		if _, ok := number(v); !ok {
			return false
		}
	}
	return true
}
