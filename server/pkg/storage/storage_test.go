// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package storage_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/bborbe/driftline/server/pkg/storage"
)

func columns(ctx context.Context, db *sql.DB, table string) []string {
	rows, err := db.QueryContext(ctx, `SELECT name FROM pragma_table_info(?) ORDER BY cid`, table)
	Expect(err).NotTo(HaveOccurred())
	defer rows.Close()
	var result []string
	for rows.Next() {
		var name string
		Expect(rows.Scan(&name)).To(Succeed())
		result = append(result, name)
	}
	Expect(rows.Err()).NotTo(HaveOccurred())
	return result
}

var _ = Describe("Open", func() {
	var ctx context.Context
	var path string
	var db *sql.DB

	BeforeEach(func() {
		ctx = context.Background()
		path = filepath.Join(GinkgoT().TempDir(), "sub dir", "leaderboard.db")
		Expect(os.MkdirAll(filepath.Dir(path), 0o750)).To(Succeed())
	})

	AfterEach(func() {
		if db != nil {
			Expect(db.Close()).To(Succeed())
		}
	})

	Context("on a fresh file", func() {
		BeforeEach(func() {
			_, err := os.Stat(path)
			Expect(os.IsNotExist(err)).To(BeTrue())

			db, err = storage.Open(ctx, path)
			Expect(err).NotTo(HaveOccurred())
		})

		It("creates the database file", func() {
			Expect(path).To(BeAnExistingFile())
		})

		It("creates the runs table", func() {
			Expect(columns(ctx, db, "runs")).To(Equal([]string{
				"id",
				"player",
				"track",
				"total_ticks",
				"checkpoint_ticks",
				"ghost",
				"created_at",
			}))
		})

		It("records the schema version", func() {
			Expect(storage.SchemaVersion(ctx, db)).To(Equal(1))
		})

		It("stores a run and stamps created_at", func() {
			_, err := db.ExecContext(
				ctx,
				`INSERT INTO runs (player, track, total_ticks, checkpoint_ticks, ghost) VALUES (?, ?, ?, ?, ?)`,
				"ben",
				"a01",
				4321,
				"[1000,2500]",
				[]byte{1, 2, 3},
			)
			Expect(err).NotTo(HaveOccurred())
			var createdAt string
			Expect(
				db.QueryRowContext(ctx, `SELECT created_at FROM runs`).Scan(&createdAt),
			).To(Succeed())
			Expect(createdAt).To(MatchRegexp(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`))
		})

		It("rejects a run without a ghost", func() {
			_, err := db.ExecContext(
				ctx,
				`INSERT INTO runs (player, track, total_ticks, checkpoint_ticks) VALUES (?, ?, ?, ?)`,
				"ben",
				"a01",
				4321,
				"[]",
			)
			Expect(err).To(HaveOccurred())
		})
	})

	Context("on an existing file", func() {
		BeforeEach(func() {
			first, err := storage.Open(ctx, path)
			Expect(err).NotTo(HaveOccurred())
			_, err = first.ExecContext(
				ctx,
				`INSERT INTO runs (player, track, total_ticks, checkpoint_ticks, ghost) VALUES (?, ?, ?, ?, ?)`,
				"ben",
				"a01",
				4321,
				"[]",
				[]byte{1},
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(first.Close()).To(Succeed())

			db, err = storage.Open(ctx, path)
			Expect(err).NotTo(HaveOccurred())
		})

		It("applies no migration twice", func() {
			Expect(storage.SchemaVersion(ctx, db)).To(Equal(1))
			var count int
			Expect(db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations`).Scan(&count)).
				To(Succeed())
			Expect(count).To(Equal(1))
		})

		It("keeps the stored runs", func() {
			var count int
			Expect(db.QueryRowContext(ctx, `SELECT COUNT(*) FROM runs`).Scan(&count)).To(Succeed())
			Expect(count).To(Equal(1))
		})
	})

	It("fails when the directory does not exist", func() {
		_, err := storage.Open(ctx, filepath.Join(GinkgoT().TempDir(), "missing", "x.db"))
		Expect(err).To(HaveOccurred())
	})
})
