// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package factory

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	libhttp "github.com/bborbe/http"
	"github.com/bborbe/log"
	"github.com/bborbe/run"
	"github.com/golang/glog"
	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/bborbe/driftline/server/pkg/handler"
	"github.com/bborbe/driftline/server/pkg/origin"
	"github.com/bborbe/driftline/server/pkg/storage"
	"github.com/bborbe/driftline/server/pkg/track"
)

// CreateHTTPServer creates the HTTP server with the canonical admin endpoints, the
// readiness check pinging the database, and the leaderboard API under /api/1.0/.
func CreateHTTPServer(listen string, db handler.Pinger, api http.Handler) run.Func {
	return func(ctx context.Context) error {
		router := mux.NewRouter()
		router.PathPrefix("/api/1.0/").Handler(api)
		router.Path("/healthz").Handler(CreateHealthzHandler())
		router.Path("/readiness").Handler(CreateReadinessHandler(db))
		router.Path("/metrics").Handler(promhttp.Handler())
		router.Path("/setloglevel/{level}").
			Handler(log.NewSetLoglevelHandler(ctx, log.NewLogLevelSetter(2, 5*time.Minute)))
		router.Path("/gc").Handler(libhttp.NewGarbageCollectorHandler())

		glog.V(2).Infof("starting http server listen on %s", listen)
		return libhttp.NewServer(listen, router).Run(ctx)
	}
}

// CreateAPIHandler creates the leaderboard API behind the token and Origin guard.
func CreateAPIHandler(
	token string,
	allowedOrigin string,
	tracks track.Table,
	db *sql.DB,
) http.Handler {
	store := storage.NewRunStore(db)
	router := mux.NewRouter()
	router.Path("/api/1.0/runs").Methods(http.MethodPost).
		Handler(libhttp.NewJSONErrorHandler(handler.NewSubmitRunHandler(tracks, store)))
	router.Path("/api/1.0/tracks/{track}/runs").Methods(http.MethodGet).
		Handler(libhttp.NewJSONErrorHandler(handler.NewListRunsHandler(tracks, store)))
	router.Path("/api/1.0/runs/{id:[0-9]+}/ghost").Methods(http.MethodGet).
		Handler(libhttp.NewJSONErrorHandler(handler.NewGhostHandler(store)))
	return origin.NewGuard(token, allowedOrigin, router)
}

// CreateHealthzHandler creates the `/healthz` liveness handler.
func CreateHealthzHandler() http.Handler {
	return handler.NewHealthzHandler()
}

// CreateReadinessHandler creates the `/readiness` handler: 200 while the database
// answers, else a 503 JSON error.
func CreateReadinessHandler(pinger handler.Pinger) http.Handler {
	return libhttp.NewJSONErrorHandler(handler.NewReadinessHandler(pinger))
}
