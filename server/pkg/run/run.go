// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package run

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"regexp"

	"github.com/bborbe/errors"

	"github.com/bborbe/driftline/server/pkg/track"
)

// TicksPerSecond is the game's fixed physics rate; a lap time in ms is ticks * 1000 / TicksPerSecond.
const TicksPerSecond = 100

const nameRule = "1-12 characters of A-Z 0-9 space _ . - without outer spaces"

var namePattern = regexp.MustCompile(`^[A-Z0-9_.-](?:[A-Z0-9 _.-]{0,10}[A-Z0-9_.-])?$`)

// Submission is one finished lap as the game submits it. Pointers tell a missing field from a zero.
type Submission struct {
	Name            *string         `json:"name"`
	Track           *string         `json:"track"`
	TotalTicks      *int            `json:"totalTicks"`
	CheckpointTicks []int           `json:"checkpointTicks"`
	Ghost           json.RawMessage `json:"ghost"`
}

// Decode reads exactly one JSON submission with no unknown fields.
func Decode(ctx context.Context, body io.Reader) (*Submission, error) {
	var s Submission
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&s); err != nil {
		return nil, errors.Wrap(ctx, err, "body is not a run")
	}
	if decoder.More() {
		return nil, errors.Errorf(ctx, "body carries more than one run")
	}
	if s.Name == nil || s.Track == nil || s.TotalTicks == nil || s.CheckpointTicks == nil ||
		len(s.Ghost) == 0 {
		return nil, errors.Errorf(ctx, "body needs name, track, totalTicks, checkpointTicks, ghost")
	}
	return &s, nil
}

// Validate checks the submission against its track: name, track, tick floor, checkpoint splits
// and the ghost. Every error names the reason. The checks are cross-field and read the track
// table, so they stay a plain sequence rather than bborbe/validation's per-field All.
func (s *Submission) Validate(ctx context.Context, tracks track.Table) error {
	if !namePattern.MatchString(*s.Name) {
		return errors.Errorf(ctx, "name %q must be %s", *s.Name, nameRule)
	}
	t, ok := tracks[*s.Track]
	if !ok {
		return errors.Errorf(ctx, "unknown track %q", *s.Track)
	}
	total := *s.TotalTicks
	if total < t.FloorTicks {
		return errors.Errorf(
			ctx,
			"%d ticks is below the %s floor of %d",
			total,
			t.Name,
			t.FloorTicks,
		)
	}
	if total > MaxGhostTicks {
		return errors.Errorf(ctx, "totalTicks %d is above %d", total, MaxGhostTicks)
	}
	if n := len(s.CheckpointTicks); n != t.Checkpoints {
		return errors.Errorf(ctx, "%s has %d checkpoints, got %d", t.Name, t.Checkpoints, n)
	}
	previous := 0
	for i, tick := range s.CheckpointTicks {
		if tick <= previous || tick >= total {
			return errors.Errorf(ctx, "split %d at %d out of order or outside the lap", i+1, tick)
		}
		previous = tick
	}
	ticks, ms, err := GhostTicks(ctx, s.Ghost)
	if err != nil {
		return errors.Wrap(ctx, err, "ghost invalid")
	}
	if ticks != total {
		return errors.Errorf(ctx, "ghost has %d ticks, totalTicks is %d", ticks, total)
	}
	if want := float64(total * 1000 / TicksPerSecond); ms != want {
		return errors.Errorf(ctx, "ghost lap time %v ms does not match %v ms", ms, want)
	}
	return nil
}

// GhostJSON is the ghost as stored and served: the submitted bytes, compacted.
func (s *Submission) GhostJSON(ctx context.Context) ([]byte, error) {
	var buf bytes.Buffer
	if err := json.Compact(&buf, s.Ghost); err != nil {
		return nil, errors.Wrap(ctx, err, "compact ghost failed")
	}
	return buf.Bytes(), nil
}
