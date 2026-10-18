// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package main

import (
	"context"
	"database/sql"
	"net/url"
	"os"

	"github.com/bborbe/errors"
	libhttp "github.com/bborbe/http"
	libmetrics "github.com/bborbe/metrics"
	"github.com/bborbe/run"
	libsentry "github.com/bborbe/sentry"
	"github.com/bborbe/service"
	libtime "github.com/bborbe/time"
	"github.com/golang/glog"
	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/bborbe/driftline/server/pkg/factory"
	"github.com/bborbe/driftline/server/pkg/storage"
)

func main() {
	app := &application{}
	os.Exit(service.Main(context.Background(), app, &app.SentryDSN, &app.SentryProxy))
}

type application struct {
	SentryDSN       string            `required:"false" arg:"sentry-dsn"        env:"SENTRY_DSN"        usage:"SentryDSN"                                                     display:"length"`
	SentryProxy     string            `required:"false" arg:"sentry-proxy"      env:"SENTRY_PROXY"      usage:"Sentry Proxy"`
	Listen          string            `required:"true"  arg:"listen"            env:"LISTEN"            usage:"address to listen to"                                                           default:":8080"`
	DBPath          string            `required:"true"  arg:"db-path"           env:"DB_PATH"           usage:"path of the SQLite database file (created if missing)"`
	Token           string            `required:"true"  arg:"token"             env:"TOKEN"             usage:"shared token the game sends with a submitted run"              display:"length"`
	AllowedOrigin   string            `required:"true"  arg:"allowed-origin"    env:"ALLOWED_ORIGIN"    usage:"origin allowed to call the API, e.g. https://bborbe.github.io"`
	BuildGitVersion string            `required:"false" arg:"build-git-version" env:"BUILD_GIT_VERSION" usage:"Build Git version"                                                              default:"dev"`
	BuildGitCommit  string            `required:"false" arg:"build-git-commit"  env:"BUILD_GIT_COMMIT"  usage:"Build Git commit hash"                                                          default:"none"`
	BuildDate       *libtime.DateTime `required:"false" arg:"build-date"        env:"BUILD_DATE"        usage:"Build timestamp (RFC3339)"`
}

// Validate is called by the argument parser after the required check. The allowed
// origin must be a bare origin (scheme and host, no path), because that is exactly
// what a browser sends in the Origin header.
func (a *application) Validate(ctx context.Context) error {
	return validateOrigin(ctx, a.AllowedOrigin)
}

func validateOrigin(ctx context.Context, value string) error {
	origin, err := url.Parse(value)
	if err != nil {
		return errors.Wrapf(ctx, err, "parse allowed origin %q failed", value)
	}
	if origin.Scheme != "http" && origin.Scheme != "https" {
		return errors.Errorf(ctx, "allowed origin %q must use http or https", value)
	}
	if origin.Host == "" || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" ||
		origin.User != nil {
		return errors.Errorf(ctx, "allowed origin %q must be scheme://host[:port] only", value)
	}
	return nil
}

func (a *application) Run(ctx context.Context, sentryClient libsentry.Client) error {
	libmetrics.NewBuildInfoMetrics().SetBuildInfo(a.BuildGitVersion, a.BuildGitCommit, a.BuildDate)

	db, err := storage.Open(ctx, a.DBPath)
	if err != nil {
		return errors.Wrap(ctx, err, "open db failed")
	}
	defer db.Close()

	return service.Run(
		ctx,
		a.createHTTPServer(db),
	)
}

func (a *application) createHTTPServer(db *sql.DB) run.Func {
	return func(ctx context.Context) error {
		router := mux.NewRouter()
		router.Path("/healthz").Handler(factory.CreateHealthzHandler())
		router.Path("/readiness").Handler(factory.CreateReadinessHandler(db))
		router.Path("/metrics").Handler(promhttp.Handler())

		glog.V(2).Infof("starting http server listen on %s", a.Listen)
		return libhttp.NewServer(
			a.Listen,
			router,
		).Run(ctx)
	}
}
