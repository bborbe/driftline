// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package factory_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/bborbe/driftline/server/pkg/factory"
	"github.com/bborbe/driftline/server/pkg/storage"
	"github.com/bborbe/driftline/server/pkg/track"
)

const (
	token  = "test-token"
	origin = "https://game.test"
)

type (
	body = map[string]any
	hdr  = map[string]string
)

// keysGhost is a packed ghost of n ticks with no input (`<n>A`), lap time to match.
func keysGhost(n int) body {
	s := make([]any, 17)
	for i := range s {
		s[i] = 0
	}
	return body{"s": s, "keys": fmt.Sprintf("%dA", n), "ms": n * 10}
}

// lap is a valid test1 run of n ticks (floor 675) with two in-order splits.
func lap(name string, n int) body {
	return body{
		"name":            name,
		"track":           "test1",
		"totalTicks":      n,
		"checkpointTicks": []int{100, 200},
		"ghost":           keysGhost(n),
	}
}

var _ = Describe("API", func() {
	var ctx context.Context
	var db *sql.DB
	var api http.Handler
	var golden body
	var goldenRaw []byte

	BeforeEach(func() {
		ctx = context.Background()
		var err error
		db, err = storage.Open(ctx, filepath.Join(GinkgoT().TempDir(), "leaderboard.db"))
		Expect(err).NotTo(HaveOccurred())
		tracks, err := track.Load(ctx)
		Expect(err).NotTo(HaveOccurred())
		api = factory.CreateAPIHandler(token, origin, tracks, db)
		goldenRaw, err = os.ReadFile("../run/testdata/golden-run.json")
		Expect(err).NotTo(HaveOccurred())
		Expect(json.Unmarshal(goldenRaw, &golden)).To(Succeed())
	})

	AfterEach(func() {
		Expect(db.Close()).To(Succeed())
	})

	call := func(method, path string, payload []byte, headers map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewReader(payload))
		req.Header.Set("Origin", origin)
		req.Header.Set("X-Driftline-Token", token)
		for k, v := range headers {
			if v == "" {
				req.Header.Del(k)
			} else {
				req.Header.Set(k, v)
			}
		}
		recorder := httptest.NewRecorder()
		api.ServeHTTP(recorder, req)
		return recorder
	}
	post := func(run body) *httptest.ResponseRecorder {
		payload, err := json.Marshal(run)
		Expect(err).NotTo(HaveOccurred())
		return call(http.MethodPost, "/api/1.0/runs", payload, nil)
	}
	list := func(query string) []storage.Run {
		recorder := call(http.MethodGet, "/api/1.0/tracks/test1/runs"+query, nil, nil)
		Expect(recorder.Code).To(Equal(http.StatusOK), recorder.Body.String())
		var runs []storage.Run
		Expect(json.Unmarshal(recorder.Body.Bytes(), &runs)).To(Succeed())
		return runs
	}
	rowCount := func() int {
		var count int
		Expect(db.QueryRowContext(ctx, `SELECT COUNT(*) FROM runs`).Scan(&count)).To(Succeed())
		return count
	}
	reason := func(recorder *httptest.ResponseRecorder) string {
		var response struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		Expect(
			json.Unmarshal(recorder.Body.Bytes(), &response),
		).To(Succeed(), recorder.Body.String())
		return response.Error.Message
	}

	rejected := func(recorder *httptest.ResponseRecorder, status int, why string) {
		Expect(recorder.Code).To(Equal(status), recorder.Body.String())
		Expect(reason(recorder)).To(ContainSubstring(why))
		Expect(rowCount()).To(Equal(0))
	}

	DescribeTable("rejects a request without the token or the origin",
		func(headers hdr, status int, why string) {
			rejected(call(http.MethodPost, "/api/1.0/runs", goldenRaw, headers), status, why)
		},
		Entry("missing token", hdr{"X-Driftline-Token": ""}, 401, "X-Driftline-Token"),
		Entry("wrong token", hdr{"X-Driftline-Token": "nope"}, 401, "X-Driftline-Token"),
		Entry("missing origin", hdr{"Origin": ""}, 403, "origin not allowed"),
		Entry("foreign origin", hdr{"Origin": "https://evil.test"}, 403, "origin not allowed"),
	)

	DescribeTable("rejects a body that is not one run",
		func(payload string, status int, why string) {
			rejected(call(http.MethodPost, "/api/1.0/runs", []byte(payload), nil), status, why)
		},
		Entry("over 256 KiB", `{"name":"`+strings.Repeat("A", 300<<10)+`"}`, 413, "larger than"),
		Entry("malformed json", `{"name":`, 400, "not a run"),
		Entry("two runs", `{} {}`, 400, "more than one run"),
	)

	DescribeTable(
		"rejects an invalid run with a reason and stores nothing",
		func(mutate func(body), why string) {
			run := body{}
			Expect(json.Unmarshal(goldenRaw, &run)).To(Succeed())
			mutate(run)
			rejected(post(run), http.StatusBadRequest, why)
		},
		Entry("unknown field", func(r body) { r["cheat"] = true }, "not a run"),
		Entry("missing field", func(r body) { delete(r, "ghost") }, "needs name"),
		Entry("unknown track", func(r body) { r["track"] = "nowhere" }, "unknown track"),
		Entry("checkpoint missing", func(r body) { r["checkpointTicks"] = splits(r)[:1] }, "has 2"),
		Entry(
			"checkpoints swapped",
			func(r body) { r["checkpointTicks"] = swap(splits(r)) },
			"order",
		),
		Entry(
			"checkpoint at the finish",
			func(r body) { splits(r)[1] = r["totalTicks"] },
			"outside",
		),
		Entry("below the floor", func(r body) { maps.Copy(r, lap("BEN", 674)) }, "floor of 675"),
		Entry("above the ghost cap", func(r body) { r["totalTicks"] = 60_001 }, "above 60000"),
		Entry(
			"ghost too short",
			func(r body) { r["totalTicks"] = num(r, "totalTicks") + 1 },
			"ghost has",
		),
		Entry("ghost lap time", func(r body) { field[body](r, "ghost")["ms"] = 1 }, "lap time"),
		Entry("ghost not decodable", func(r body) { r["ghost"] = "x" }, "ghost invalid"),
		Entry("empty name", func(r body) { r["name"] = "" }, "name"),
		Entry("name too long", func(r body) { r["name"] = "ABCDEFGHIJKLM" }, "name"),
		Entry("lower-case name", func(r body) { r["name"] = "ben" }, "name"),
		Entry("name with outer space", func(r body) { r["name"] = " BEN" }, "name"),
	)

	It("accepts the golden run recorded by the game and serves its ghost", func() {
		recorder := call(http.MethodPost, "/api/1.0/runs", goldenRaw, nil)
		Expect(recorder.Code).To(Equal(http.StatusCreated), recorder.Body.String())
		var saved struct {
			ID   int64 `json:"id"`
			Best bool  `json:"best"`
		}
		Expect(json.Unmarshal(recorder.Body.Bytes(), &saved)).To(Succeed())
		Expect(saved.Best).To(BeTrue())
		runs := list("")
		Expect(runs).To(HaveLen(1))
		Expect(runs[0].Name).To(Equal("GOLDEN"))
		Expect(float64(runs[0].TotalTicks)).To(Equal(golden["totalTicks"]))
		Expect(runs[0].CheckpointTicks).To(HaveLen(2))

		var raw map[string]json.RawMessage
		Expect(json.Unmarshal(goldenRaw, &raw)).To(Succeed())
		ghost := call(http.MethodGet, fmt.Sprintf("/api/1.0/runs/%d/ghost", saved.ID), nil, nil)
		Expect(ghost.Code).To(Equal(http.StatusOK))
		Expect(ghost.Body.String()).To(Equal(string(raw["ghost"])))
	})

	It("accepts a run exactly at the floor", func() {
		Expect(post(lap("BEN", 675)).Code).To(Equal(http.StatusCreated))
	})

	It("keeps only the best run per player", func() {
		Expect(post(lap("BEN", 1000)).Code).To(Equal(http.StatusCreated))
		slower := post(lap("BEN", 1200))
		Expect(slower.Code).To(Equal(http.StatusOK))
		Expect(slower.Body.String()).To(ContainSubstring(`"best":false`))
		Expect(list("")[0].TotalTicks).To(Equal(1000))
		Expect(post(lap("BEN", 900)).Code).To(Equal(http.StatusCreated))
		Expect(list("")).To(HaveLen(1))
		Expect(list("")[0].TotalTicks).To(Equal(900))
	})

	It("lists the fastest first and honours the limit", func() {
		for name, ticks := range map[string]int{"ANNA": 900, "BEN": 800, "CARL": 1000} {
			Expect(post(lap(name, ticks)).Code).To(Equal(http.StatusCreated))
		}
		names := make([]string, 0, 3)
		for _, run := range list("") {
			names = append(names, run.Name)
		}
		Expect(names).To(Equal([]string{"BEN", "ANNA", "CARL"}))
		Expect(list("?limit=2")).To(HaveLen(2))
	})

	DescribeTable("rejects a bad query",
		func(path string, status int) {
			Expect(call(http.MethodGet, path, nil, nil).Code).To(Equal(status))
		},
		Entry("limit 0", "/api/1.0/tracks/test1/runs?limit=0", 400),
		Entry("limit over 100", "/api/1.0/tracks/test1/runs?limit=101", 400),
		Entry("unknown track", "/api/1.0/tracks/nowhere/runs", 404),
		Entry("unknown ghost", "/api/1.0/runs/42/ghost", 404),
	)

	It("guards the list too", func() {
		Expect(
			call(
				http.MethodGet,
				"/api/1.0/tracks/test1/runs",
				nil,
				map[string]string{"X-Driftline-Token": ""},
			).Code,
		).
			To(Equal(http.StatusUnauthorized))
	})

	It("answers a CORS preflight from the allowed origin only", func() {
		allowed := call(
			http.MethodOptions,
			"/api/1.0/runs",
			nil,
			map[string]string{"X-Driftline-Token": ""},
		)
		Expect(allowed.Code).To(Equal(http.StatusNoContent))
		Expect(allowed.Header().Get("Access-Control-Allow-Origin")).To(Equal(origin))
		Expect(
			allowed.Header().Get("Access-Control-Allow-Headers"),
		).To(ContainSubstring("X-Driftline-Token"))
		foreign := call(
			http.MethodOptions,
			"/api/1.0/runs",
			nil,
			map[string]string{"Origin": "https://evil.test"},
		)
		Expect(foreign.Code).To(Equal(http.StatusForbidden))
	})
})

// field reads run[key] as T, failing the spec when it has another type.
func field[T any](run body, key string) T {
	value, ok := run[key].(T)
	Expect(ok).To(BeTrue(), key)
	return value
}

func splits(run body) []any {
	return field[[]any](run, "checkpointTicks")
}

func num(run body, key string) float64 {
	return field[float64](run, key)
}

func swap(values []any) []any {
	return []any{values[1], values[0]}
}
