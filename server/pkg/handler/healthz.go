// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package handler

import (
	"net/http"

	libhttp "github.com/bborbe/http"
)

// NewHealthzHandler serves the liveness response: HTTP 200, body `{"status":"ok"}`,
// Content-Type: application/json. It touches no dependency, so it only fails when
// the process is down.
func NewHealthzHandler() http.Handler {
	return http.HandlerFunc(func(resp http.ResponseWriter, req *http.Request) {
		resp.Header().Add(libhttp.ContentTypeHeaderName, libhttp.ApplicationJSONContentType)
		_, _ = resp.Write([]byte(`{"status":"ok"}`))
	})
}
