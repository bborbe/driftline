// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package storage

import (
	"context"
	"database/sql"
	"net/url"

	"github.com/bborbe/errors"
	"github.com/golang/glog"
	_ "modernc.org/sqlite"
)

// migrations are applied in order, each exactly once; index + 1 is the schema version.
// Append new migrations, never edit a shipped one.
var migrations = []string{
	`CREATE TABLE runs (
		id               INTEGER PRIMARY KEY AUTOINCREMENT,
		player           TEXT    NOT NULL,
		track            TEXT    NOT NULL,
		total_ticks      INTEGER NOT NULL,
		checkpoint_ticks TEXT    NOT NULL,
		ghost            BLOB    NOT NULL,
		created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	);
	CREATE INDEX runs_track_total_ticks ON runs (track, total_ticks);`,
}

// Open opens the SQLite database at path, creating the file if missing, and applies
// every pending migration before returning.
func Open(ctx context.Context, path string) (*sql.DB, error) {
	dsn := "file:" + (&url.URL{Path: path}).EscapedPath() +
		"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, errors.Wrapf(ctx, err, "open sqlite %s failed", path)
	}
	// SQLite allows one writer; a single connection avoids SQLITE_BUSY between our own goroutines.
	db.SetMaxOpenConns(1)
	if err := migrate(ctx, db); err != nil {
		_ = db.Close()
		return nil, errors.Wrapf(ctx, err, "migrate sqlite %s failed", path)
	}
	return db, nil
}

// SchemaVersion returns the number of migrations applied to db.
func SchemaVersion(ctx context.Context, db *sql.DB) (int, error) {
	var version int
	err := db.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).
		Scan(&version)
	if err != nil {
		return 0, errors.Wrap(ctx, err, "read schema version failed")
	}
	return version, nil
}

func migrate(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    INTEGER PRIMARY KEY,
		applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
	)`); err != nil {
		return errors.Wrap(ctx, err, "create schema_migrations failed")
	}
	current, err := SchemaVersion(ctx, db)
	if err != nil {
		return errors.Wrap(ctx, err, "get schema version failed")
	}
	for i := current; i < len(migrations); i++ {
		if err := apply(ctx, db, i+1, migrations[i]); err != nil {
			return errors.Wrapf(ctx, err, "apply migration %d failed", i+1)
		}
		glog.V(2).Infof("applied migration %d", i+1)
	}
	return nil
}

func apply(ctx context.Context, db *sql.DB, version int, stmt string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return errors.Wrap(ctx, err, "begin tx failed")
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, stmt); err != nil {
		return errors.Wrap(ctx, err, "exec migration failed")
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
		return errors.Wrap(ctx, err, "record migration failed")
	}
	if err := tx.Commit(); err != nil {
		return errors.Wrap(ctx, err, "commit failed")
	}
	return nil
}
