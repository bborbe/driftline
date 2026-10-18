// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package run_test

import (
	"context"
	"encoding/json"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/bborbe/driftline/server/pkg/run"
)

const start = `"s":[0,"-0",0,0,0,0,0,0,0,1,0,0,0,0,0,0,0]`

var _ = DescribeTable("GhostTicks",
	func(ghost string, ticks int, ok bool) {
		got, _, err := run.GhostTicks(context.Background(), json.RawMessage(ghost))
		if !ok {
			Expect(err).To(HaveOccurred())
			return
		}
		Expect(err).NotTo(HaveOccurred())
		Expect(got).To(Equal(ticks))
	},
	Entry("packed runs", `{`+start+`,"keys":"12AcC","ms":140}`, 14, true),
	Entry("slow motion with its scale", `{`+start+`,"keys":"3B","scale":0.5,"ms":30}`, 3, true),
	Entry("slow motion without a scale", `{`+start+`,"keys":"3B","ms":30}`, 0, false),
	Entry("zero run count", `{`+start+`,"keys":"0A","ms":0}`, 0, false),
	Entry("letter outside the alphabet", `{`+start+`,"keys":"3w","ms":30}`, 0, false),
	Entry("numeric runs", `{`+start+`,"r":[5,1,0,"-0",0,0,2,0,1,0.5,1,0],"ms":70}`, 7, true),
	Entry("fractional run count", `{`+start+`,"r":[1.5,1,0,0,0,0],"ms":15}`, 0, false),
	Entry("both keys and runs", `{`+start+`,"keys":"A","r":[1,0,0,0,0,0],"ms":10}`, 0, false),
	Entry("short start state", `{"s":[0],"keys":"A","ms":10}`, 0, false),
	Entry("over the tick cap", `{`+start+`,"keys":"60001A","ms":600010}`, 0, false),
)
