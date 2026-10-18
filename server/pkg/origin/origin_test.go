// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package origin_test

import (
	"context"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/bborbe/driftline/server/pkg/origin"
)

var _ = DescribeTable("Validate",
	func(value string, valid bool) {
		err := origin.Validate(context.Background(), value)
		if valid {
			Expect(err).NotTo(HaveOccurred())
		} else {
			Expect(err).To(HaveOccurred())
		}
	},
	Entry("https host", "https://bborbe.github.io", true),
	Entry("http host with port", "http://localhost:5173", true),
	Entry("trailing slash", "https://bborbe.github.io/", false),
	Entry("path", "https://bborbe.github.io/driftline", false),
	Entry("no scheme", "bborbe.github.io", false),
	Entry("other scheme", "ftp://bborbe.github.io", false),
	Entry("query", "https://bborbe.github.io?x=1", false),
	Entry("user info", "https://user@bborbe.github.io", false),
	Entry("wildcard", "*", false),
	Entry("empty", "", false),
)
