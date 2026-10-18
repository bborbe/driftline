// Copyright (c) 2026 Benjamin Borbe All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package origin

import (
	"context"
	"net/url"

	"github.com/bborbe/errors"
)

// Validate returns an error unless value is a bare origin: http or https, a host and
// an optional port, nothing else. That is exactly what a browser sends in the Origin
// header, so a value with a path, query or trailing slash could never match one.
func Validate(ctx context.Context, value string) error {
	parsed, err := url.Parse(value)
	if err != nil {
		return errors.Wrapf(ctx, err, "parse origin %q failed", value)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.Errorf(ctx, "origin %q must use http or https", value)
	}
	if parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" ||
		parsed.User != nil {
		return errors.Errorf(ctx, "origin %q must be scheme://host[:port] only", value)
	}
	return nil
}
