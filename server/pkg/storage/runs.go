// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	stderrors "errors"

	"github.com/bborbe/errors"
)

// ErrNotFound is returned for a run id that is not stored.
var ErrNotFound = stderrors.New("not found")

// NewRun is a validated run to store.
type NewRun struct {
	Player          string
	Track           string
	TotalTicks      int
	CheckpointTicks []int
	Ghost           []byte
}

// Run is a stored run as the board lists it.
type Run struct {
	ID              int64  `json:"id"`
	Name            string `json:"name"`
	TotalTicks      int    `json:"totalTicks"`
	CheckpointTicks []int  `json:"checkpointTicks"`
	CreatedAt       string `json:"createdAt"`
}

//counterfeiter:generate -o ../../mocks/run-store.go --fake-name RunStore . RunStore

// RunStore keeps the best run per player per track.
type RunStore interface {
	// SaveBest stores run unless the player already holds an equal or faster one on the track;
	// it returns the id of the player's stored run and whether run became it.
	SaveBest(ctx context.Context, run NewRun) (int64, bool, error)
	// Top lists a track's runs, fastest first (ties: earlier first), at most limit of them.
	Top(ctx context.Context, track string, limit int) ([]Run, error)
	// Ghost returns a stored run's ghost, or ErrNotFound.
	Ghost(ctx context.Context, id int64) ([]byte, error)
}

// NewRunStore returns the SQLite RunStore over db.
func NewRunStore(db *sql.DB) RunStore {
	return &runStore{db: db}
}

type runStore struct {
	db *sql.DB
}

func (r *runStore) SaveBest(ctx context.Context, run NewRun) (int64, bool, error) {
	splits, err := json.Marshal(run.CheckpointTicks)
	if err != nil {
		return 0, false, errors.Wrap(ctx, err, "marshal checkpoint ticks failed")
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, false, errors.Wrap(ctx, err, "begin tx failed")
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(
		ctx,
		`INSERT INTO runs (player, track, total_ticks, checkpoint_ticks, ghost)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (player, track) DO UPDATE SET
			total_ticks = excluded.total_ticks,
			checkpoint_ticks = excluded.checkpoint_ticks,
			ghost = excluded.ghost,
			created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		WHERE excluded.total_ticks < runs.total_ticks`,
		run.Player,
		run.Track,
		run.TotalTicks,
		string(splits),
		run.Ghost,
	)
	if err != nil {
		return 0, false, errors.Wrap(ctx, err, "upsert run failed")
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return 0, false, errors.Wrap(ctx, err, "rows affected failed")
	}
	var id int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM runs WHERE player = ? AND track = ?`, run.Player, run.Track).
		Scan(&id); err != nil {
		return 0, false, errors.Wrap(ctx, err, "read run id failed")
	}
	if err := tx.Commit(); err != nil {
		return 0, false, errors.Wrap(ctx, err, "commit failed")
	}
	return id, changed > 0, nil
}

func (r *runStore) Top(ctx context.Context, track string, limit int) ([]Run, error) {
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT id, player, total_ticks, checkpoint_ticks, created_at
		FROM runs WHERE track = ? ORDER BY total_ticks, created_at, id LIMIT ?`,
		track,
		limit,
	)
	if err != nil {
		return nil, errors.Wrap(ctx, err, "query runs failed")
	}
	defer rows.Close()
	result := []Run{}
	for rows.Next() {
		var run Run
		var splits string
		if err := rows.Scan(&run.ID, &run.Name, &run.TotalTicks, &splits, &run.CreatedAt); err != nil {
			return nil, errors.Wrap(ctx, err, "scan run failed")
		}
		if err := json.Unmarshal([]byte(splits), &run.CheckpointTicks); err != nil {
			return nil, errors.Wrapf(ctx, err, "parse checkpoint ticks of run %d failed", run.ID)
		}
		result = append(result, run)
	}
	if err := rows.Err(); err != nil {
		return nil, errors.Wrap(ctx, err, "iterate runs failed")
	}
	return result, nil
}

func (r *runStore) Ghost(ctx context.Context, id int64) ([]byte, error) {
	var ghost []byte
	err := r.db.QueryRowContext(ctx, `SELECT ghost FROM runs WHERE id = ?`, id).Scan(&ghost)
	if stderrors.Is(err, sql.ErrNoRows) {
		return nil, errors.Wrapf(ctx, ErrNotFound, "run %d", id)
	}
	if err != nil {
		return nil, errors.Wrapf(ctx, err, "read ghost of run %d failed", id)
	}
	return ghost, nil
}
