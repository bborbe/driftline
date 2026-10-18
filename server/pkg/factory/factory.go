// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package factory

import (
	"net/http"

	"github.com/bborbe/driftline/server/pkg/handler"
)

// CreateHealthzHandler creates the `/healthz` liveness handler.
func CreateHealthzHandler() http.Handler {
	return handler.NewHealthzHandler()
}

// CreateReadinessHandler creates the `/readiness` handler, ready while the database answers.
func CreateReadinessHandler(pinger handler.Pinger) http.Handler {
	return handler.NewReadinessHandler(pinger)
}
