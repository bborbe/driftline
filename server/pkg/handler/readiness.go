// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package handler

import (
	"context"
	"net/http"

	"github.com/bborbe/errors"
	libhttp "github.com/bborbe/http"
)

// ErrorCodeUnavailable is the JSON error code of a dependency that does not answer (503).
const ErrorCodeUnavailable = "UNAVAILABLE"

//counterfeiter:generate -o ../../mocks/pinger.go --fake-name Pinger . Pinger

// Pinger checks that a dependency answers; *sql.DB satisfies it.
type Pinger interface {
	PingContext(ctx context.Context) error
}

// NewReadinessHandler answers 200 OK while the database answers a ping, and returns a
// 503 error otherwise.
func NewReadinessHandler(pinger Pinger) libhttp.WithError {
	return libhttp.WithErrorFunc(
		func(ctx context.Context, resp http.ResponseWriter, req *http.Request) error {
			if err := pinger.PingContext(ctx); err != nil {
				return libhttp.WrapWithCode(
					errors.Wrap(ctx, err, "ping db failed"),
					ErrorCodeUnavailable,
					http.StatusServiceUnavailable,
				)
			}
			_, _ = resp.Write([]byte("OK"))
			return nil
		},
	)
}
