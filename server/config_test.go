// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package main

import (
	"context"

	"github.com/bborbe/argument/v2"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// parseEnv runs the steps service.Main runs on the application (defaults, env,
// required check, Validate), minus the command-line flags, which register on the
// global flag set and can be parsed once per process.
func parseEnv(ctx context.Context, environ []string) (*application, error) {
	app := &application{}
	defaults, err := argument.DefaultValues(ctx, app)
	if err != nil {
		return nil, err
	}
	if err := argument.Fill(ctx, app, defaults); err != nil {
		return nil, err
	}
	if err := argument.ParseEnv(ctx, app, environ); err != nil {
		return nil, err
	}
	if err := argument.ValidateRequired(ctx, app); err != nil {
		return nil, err
	}
	if err := argument.ValidateHasValidation(ctx, app); err != nil {
		return nil, err
	}
	return app, nil
}

var _ = Describe("Config", func() {
	var ctx context.Context
	var environ []string

	BeforeEach(func() {
		ctx = context.Background()
		environ = []string{
			"DB_PATH=/data/leaderboard.db",
			"TOKEN=local-test-value",
			"ALLOWED_ORIGIN=https://bborbe.github.io",
		}
	})

	It("reads the env and applies the defaults", func() {
		app, err := parseEnv(ctx, environ)
		Expect(err).NotTo(HaveOccurred())
		Expect(app.DBPath).To(Equal("/data/leaderboard.db"))
		Expect(app.Token).To(Equal("local-test-value"))
		Expect(app.AllowedOrigin).To(Equal("https://bborbe.github.io"))
		Expect(app.Listen).To(Equal(":9090"))
		Expect(app.SentryDSN).To(BeEmpty())
	})

	It("lets LISTEN override the default", func() {
		app, err := parseEnv(ctx, append(environ, "LISTEN=:8080"))
		Expect(err).NotTo(HaveOccurred())
		Expect(app.Listen).To(Equal(":8080"))
	})

	DescribeTable("rejects a missing required value",
		func(key string) {
			var filtered []string
			for _, kv := range environ {
				if len(kv) <= len(key) || kv[:len(key)+1] != key+"=" {
					filtered = append(filtered, kv)
				}
			}
			_, err := parseEnv(ctx, filtered)
			Expect(err).To(HaveOccurred())
		},
		Entry("DB_PATH", "DB_PATH"),
		Entry("TOKEN", "TOKEN"),
		Entry("ALLOWED_ORIGIN", "ALLOWED_ORIGIN"),
	)

	It("rejects an allowed origin with a path", func() {
		environ[2] = "ALLOWED_ORIGIN=https://bborbe.github.io/driftline"
		_, err := parseEnv(ctx, environ)
		Expect(err).To(HaveOccurred())
	})
})
