// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package track

import (
	"context"
	_ "embed"
	"encoding/json"

	"github.com/bborbe/errors"
)

// tracksJSON is generated from the game's tracks by src/leaderboard/server-tables.test.ts
// (UPDATE_SERVER_TRACKS=1); never edit it by hand.
//
//go:embed tracks.json
var tracksJSON []byte

// Track is one track the leaderboard accepts runs for.
type Track struct {
	Name string `json:"name"`
	// Checkpoints is the number of checkpoint gates a lap passes, in order, before the finish.
	Checkpoints int `json:"checkpoints"`
	// FloorTicks is the fewest 100 Hz ticks a lap may take: half the track's author medal.
	FloorTicks int `json:"floorTicks"`
}

// Table holds the accepted tracks by name.
type Table map[string]Track

// Load parses the embedded, generated track table.
func Load(ctx context.Context) (Table, error) {
	var tracks []Track
	if err := json.Unmarshal(tracksJSON, &tracks); err != nil {
		return nil, errors.Wrap(ctx, err, "parse tracks.json failed")
	}
	table := make(Table, len(tracks))
	for _, t := range tracks {
		table[t.Name] = t
	}
	return table, nil
}
