// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package handler

import (
	"context"
	"net/http"

	"github.com/golang/glog"
)

//counterfeiter:generate -o ../../mocks/pinger.go --fake-name Pinger . Pinger

// Pinger checks that a dependency answers; *sql.DB satisfies it.
type Pinger interface {
	PingContext(ctx context.Context) error
}

// NewReadinessHandler answers 200 OK while the database answers a ping, else 503.
func NewReadinessHandler(pinger Pinger) http.Handler {
	return http.HandlerFunc(func(resp http.ResponseWriter, req *http.Request) {
		if err := pinger.PingContext(req.Context()); err != nil {
			glog.Warningf("readiness: ping db failed: %v", err)
			http.Error(resp, "db not ready", http.StatusServiceUnavailable)
			return
		}
		_, _ = resp.Write([]byte("OK"))
	})
}
