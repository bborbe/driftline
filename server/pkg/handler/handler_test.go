// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package handler_test

import (
	"errors"
	"net/http"
	"net/http/httptest"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/bborbe/driftline/server/mocks"
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

var _ = Describe("Readiness", func() {
	var pinger *mocks.Pinger
	var recorder *httptest.ResponseRecorder

	BeforeEach(func() {
		pinger = &mocks.Pinger{}
		recorder = httptest.NewRecorder()
	})

	JustBeforeEach(func() {
		handler.NewReadinessHandler(pinger).
			ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/readiness", nil))
	})

	Context("when the db answers", func() {
		It("answers 200", func() {
			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Body.String()).To(Equal("OK"))
			Expect(pinger.PingContextCallCount()).To(Equal(1))
		})
	})

	Context("when the db does not answer", func() {
		BeforeEach(func() {
			pinger.PingContextReturns(errors.New("banana"))
		})

		It("answers 503", func() {
			Expect(recorder.Code).To(Equal(http.StatusServiceUnavailable))
		})
	})
})
