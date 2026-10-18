// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package handler_test

import (
	"context"
	stderrors "errors"
	"net/http"
	"net/http/httptest"

	libhttp "github.com/bborbe/http"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/bborbe/driftline/server/mocks"
	"github.com/bborbe/driftline/server/pkg/handler"
)

var _ = Describe("Readiness", func() {
	var pinger *mocks.Pinger
	var recorder *httptest.ResponseRecorder
	var err error

	BeforeEach(func() {
		pinger = &mocks.Pinger{}
		recorder = httptest.NewRecorder()
	})

	JustBeforeEach(func() {
		err = handler.NewReadinessHandler(pinger).ServeHTTP(
			context.Background(),
			recorder,
			httptest.NewRequest(http.MethodGet, "/readiness", nil),
		)
	})

	Context("when the db answers", func() {
		It("answers 200 OK", func() {
			Expect(err).NotTo(HaveOccurred())
			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Body.String()).To(Equal("OK"))
			Expect(pinger.PingContextCallCount()).To(Equal(1))
		})
	})

	Context("when the db does not answer", func() {
		BeforeEach(func() {
			pinger.PingContextReturns(stderrors.New("banana"))
		})

		It("returns a 503 unavailable error", func() {
			Expect(err).To(HaveOccurred())
			var withStatus libhttp.ErrorWithStatusCode
			Expect(stderrors.As(err, &withStatus)).To(BeTrue())
			Expect(withStatus.StatusCode()).To(Equal(http.StatusServiceUnavailable))
			var withCode libhttp.ErrorWithCode
			Expect(stderrors.As(err, &withCode)).To(BeTrue())
			Expect(withCode.Code()).To(Equal(handler.ErrorCodeUnavailable))
		})
	})
})
