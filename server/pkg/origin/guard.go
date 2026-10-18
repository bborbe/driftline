// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package origin

import (
	"crypto/subtle"
	"net/http"

	libhttp "github.com/bborbe/http"
	"github.com/golang/glog"
)

// TokenHeader carries the shared token on every API request.
const TokenHeader = "X-Driftline-Token" //nolint:gosec // a header name, not a credential

// NewGuard lets a request through to next only from allowedOrigin and with the shared token: a
// foreign or missing Origin is 403, a missing or wrong token 401. A CORS preflight (OPTIONS) from
// allowedOrigin is answered 204 here, since browsers send it without the token. This deters, it does
// not secure: the token ships in the game's JavaScript (goal decision 2026-10-18).
func NewGuard(token string, allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(resp http.ResponseWriter, req *http.Request) {
		if req.Header.Get("Origin") != allowedOrigin {
			reject(
				resp,
				req,
				http.StatusForbidden,
				libhttp.ErrorCodeForbidden,
				"origin not allowed",
			)
			return
		}
		header := resp.Header()
		header.Set("Access-Control-Allow-Origin", allowedOrigin)
		header.Add("Vary", "Origin")
		if req.Method == http.MethodOptions {
			header.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			header.Set("Access-Control-Allow-Headers", "Content-Type, "+TokenHeader)
			header.Set("Access-Control-Max-Age", "600")
			resp.WriteHeader(http.StatusNoContent)
			return
		}
		if subtle.ConstantTimeCompare([]byte(req.Header.Get(TokenHeader)), []byte(token)) != 1 {
			reject(
				resp,
				req,
				http.StatusUnauthorized,
				libhttp.ErrorCodeUnauthorized,
				"missing or wrong "+TokenHeader,
			)
			return
		}
		next.ServeHTTP(resp, req)
	})
}

func reject(resp http.ResponseWriter, req *http.Request, status int, code string, message string) {
	body := libhttp.ErrorResponse{Error: libhttp.ErrorDetails{Code: code, Message: message}}
	if err := libhttp.SendJSONResponse(req.Context(), resp, body, status); err != nil {
		glog.Warningf("send %d response failed: %v", status, err)
	}
}
