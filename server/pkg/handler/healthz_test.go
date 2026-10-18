// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package handler_test

import (
	"net/http"
	"net/http/httptest"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/bborbe/driftline/server/pkg/handler"
)

var _ = Describe("Healthz", func() {
	It("answers 200 with a JSON status", func() {
		recorder := httptest.NewRecorder()
		handler.NewHealthzHandler().
			ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
		Expect(recorder.Code).To(Equal(http.StatusOK))
		Expect(recorder.Header().Get("Content-Type")).To(Equal("application/json"))
		Expect(recorder.Body.String()).To(Equal(`{"status":"ok"}`))
	})
})
