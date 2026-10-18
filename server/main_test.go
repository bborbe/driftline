// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

//go:generate go run github.com/maxbrunsfeld/counterfeiter/v6@v6.12.2 -generate

package main_test

import (
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/onsi/gomega/format"
	"github.com/onsi/gomega/gexec"
)

var binary string

var _ = BeforeSuite(func() {
	var err error
	binary, err = gexec.Build("github.com/bborbe/driftline/server", "-mod=mod", "-buildvcs=false")
	Expect(err).NotTo(HaveOccurred())
})

var _ = AfterSuite(func() {
	gexec.CleanupBuildArtifacts()
})

func freePort() int {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	Expect(err).NotTo(HaveOccurred())
	defer listener.Close()
	addr, ok := listener.Addr().(*net.TCPAddr)
	Expect(ok).To(BeTrue())
	return addr.Port
}

var _ = Describe("Main", func() {
	It("Compiles", func() {
		_, err := gexec.Build("github.com/bborbe/driftline/server", "-mod=mod", "-buildvcs=false")
		Expect(err).NotTo(HaveOccurred())
	})

	var dbPath string

	BeforeEach(func() {
		dbPath = filepath.Join(GinkgoT().TempDir(), "leaderboard.db")
	})

	It("refuses to start without its config", func() {
		command := exec.Command(binary)
		command.Env = []string{"DB_PATH=" + dbPath}
		session, err := gexec.Start(command, GinkgoWriter, GinkgoWriter)
		Expect(err).NotTo(HaveOccurred())
		Eventually(session, 10*time.Second).Should(gexec.Exit(4))
		Expect(dbPath).NotTo(BeAnExistingFile())
	})

	It("creates the db and answers /healthz and /readiness", func() {
		port := freePort()
		command := exec.Command(binary)
		command.Env = []string{
			"DB_PATH=" + dbPath,
			fmt.Sprintf("LISTEN=127.0.0.1:%d", port),
			"TOKEN=local-test-value",
			"ALLOWED_ORIGIN=http://localhost:5173",
		}
		session, err := gexec.Start(command, GinkgoWriter, GinkgoWriter)
		Expect(err).NotTo(HaveOccurred())
		DeferCleanup(func() { session.Terminate().Wait(10 * time.Second) })

		for _, path := range []string{"/healthz", "/readiness"} {
			url := fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
			Eventually(func() (int, error) {
				resp, err := http.Get(url) // #nosec G107 -- local test server
				if err != nil {
					return 0, err
				}
				defer resp.Body.Close()
				return resp.StatusCode, nil
			}, 10*time.Second, 100*time.Millisecond).Should(Equal(http.StatusOK), path)
		}
		Expect(dbPath).To(BeAnExistingFile())
	})
})

func TestSuite(t *testing.T) {
	time.Local = time.UTC
	format.TruncatedDiff = false
	RegisterFailHandler(Fail)
	suiteConfig, reporterConfig := GinkgoConfiguration()
	suiteConfig.Timeout = 60 * time.Second
	RunSpecs(t, "Main Suite", suiteConfig, reporterConfig)
}
