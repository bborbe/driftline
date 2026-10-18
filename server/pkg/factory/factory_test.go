// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package factory_test

import (
	"encoding/json"
	stderrors "errors"
	"net/http"
	"net/http/httptest"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/bborbe/driftline/server/mocks"
	"github.com/bborbe/driftline/server/pkg/factory"
)

var _ = Describe("CreateReadinessHandler", func() {
	It("answers a failed ping with a 503 JSON error", func() {
		pinger := &mocks.Pinger{}
		pinger.PingContextReturns(stderrors.New("banana"))
		recorder := httptest.NewRecorder()
		factory.CreateReadinessHandler(pinger).
			ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/readiness", nil))

		Expect(recorder.Code).To(Equal(http.StatusServiceUnavailable))
		var body struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		Expect(json.Unmarshal(recorder.Body.Bytes(), &body)).To(Succeed())
		Expect(body.Error.Code).To(Equal("UNAVAILABLE"))
		Expect(body.Error.Message).To(ContainSubstring("ping db failed"))
	})
})
