// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package handler

import (
	"context"
	stderrors "errors"
	"net/http"
	"strconv"

	"github.com/bborbe/errors"
	libhttp "github.com/bborbe/http"
	"github.com/gorilla/mux"

	"github.com/bborbe/driftline/server/pkg/run"
	"github.com/bborbe/driftline/server/pkg/storage"
	"github.com/bborbe/driftline/server/pkg/track"
)

const (
	// MaxBodyBytes caps a submitted run; a keyboard lap's ghost is a few KiB, an analogue one tens.
	MaxBodyBytes = 256 << 10
	// DefaultLimit and MaxLimit bound the `limit` of a board query.
	DefaultLimit = 10
	MaxLimit     = 100
	// ErrorCodeTooLarge is the JSON error code of a body over MaxBodyBytes (413).
	ErrorCodeTooLarge = "TOO_LARGE"
)

// SubmitResponse answers a submitted run: the id of the player's stored run on the track, and
// whether the submitted run became it.
type SubmitResponse struct {
	ID   int64 `json:"id"`
	Best bool  `json:"best"`
}

// NewSubmitRunHandler validates a run and keeps it if it is the player's best on the track:
// 201 when stored, 200 when an equal or faster run is already stored.
func NewSubmitRunHandler(tracks track.Table, store storage.RunStore) libhttp.WithError {
	return libhttp.WithErrorFunc(
		func(ctx context.Context, resp http.ResponseWriter, req *http.Request) error {
			submission, err := run.Decode(ctx, http.MaxBytesReader(resp, req.Body, MaxBodyBytes))
			if _, ok := stderrors.AsType[*http.MaxBytesError](err); ok {
				return libhttp.WrapWithCode(
					errors.Errorf(ctx, "body is larger than %d bytes", MaxBodyBytes),
					ErrorCodeTooLarge,
					http.StatusRequestEntityTooLarge,
				)
			}
			if err != nil {
				return invalid(err)
			}
			if err := submission.Validate(ctx, tracks); err != nil {
				return invalid(err)
			}
			ghost, err := submission.GhostJSON(ctx)
			if err != nil {
				return errors.Wrap(ctx, err, "ghost json failed")
			}
			id, best, err := store.SaveBest(ctx, storage.NewRun{
				Player:          *submission.Name,
				Track:           *submission.Track,
				TotalTicks:      *submission.TotalTicks,
				CheckpointTicks: submission.CheckpointTicks,
				Ghost:           ghost,
			})
			if err != nil {
				return errors.Wrap(ctx, err, "save run failed")
			}
			status := http.StatusOK
			if best {
				status = http.StatusCreated
			}
			return libhttp.SendJSONResponse(ctx, resp, SubmitResponse{ID: id, Best: best}, status)
		},
	)
}

// NewListRunsHandler lists a track's fastest runs; `limit` defaults to DefaultLimit, at most MaxLimit.
func NewListRunsHandler(tracks track.Table, store storage.RunStore) libhttp.WithError {
	return libhttp.WithErrorFunc(
		func(ctx context.Context, resp http.ResponseWriter, req *http.Request) error {
			name := mux.Vars(req)["track"]
			if _, ok := tracks[name]; !ok {
				return libhttp.WrapWithCode(
					errors.Errorf(ctx, "unknown track %q", name),
					libhttp.ErrorCodeNotFound,
					http.StatusNotFound,
				)
			}
			limit := DefaultLimit
			if value := req.URL.Query().Get("limit"); value != "" {
				var err error
				if limit, err = strconv.Atoi(value); err != nil || limit < 1 || limit > MaxLimit {
					return invalid(errors.Errorf(ctx, "limit %q must be 1-%d", value, MaxLimit))
				}
			}
			runs, err := store.Top(ctx, name, limit)
			if err != nil {
				return errors.Wrap(ctx, err, "list runs failed")
			}
			return libhttp.SendJSONResponse(ctx, resp, runs, http.StatusOK)
		},
	)
}

// NewGhostHandler serves a stored run's ghost as JSON (the game's ghost object).
func NewGhostHandler(store storage.RunStore) libhttp.WithError {
	return libhttp.WithErrorFunc(
		func(ctx context.Context, resp http.ResponseWriter, req *http.Request) error {
			id, err := strconv.ParseInt(mux.Vars(req)["id"], 10, 64)
			if err != nil {
				return libhttp.WrapWithCode(err, libhttp.ErrorCodeNotFound, http.StatusNotFound)
			}
			ghost, err := store.Ghost(ctx, id)
			if stderrors.Is(err, storage.ErrNotFound) {
				return libhttp.WrapWithCode(err, libhttp.ErrorCodeNotFound, http.StatusNotFound)
			}
			if err != nil {
				return errors.Wrap(ctx, err, "read ghost failed")
			}
			resp.Header().Set(libhttp.ContentTypeHeaderName, libhttp.ApplicationJSONContentType)
			if _, err := resp.Write(ghost); err != nil {
				return errors.Wrap(ctx, err, "write ghost failed")
			}
			return nil
		},
	)
}

func invalid(err error) error {
	return libhttp.WrapWithCode(err, libhttp.ErrorCodeValidation, http.StatusBadRequest)
}
