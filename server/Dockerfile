FROM golang:1.27.2 AS build
WORKDIR /workspace
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    --mount=type=bind,target=. \
    GOCACHE=/root/.cache/go-build \
    GOMODCACHE=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags "-s -w" \
    -o /main
RUN mkdir -p /data

FROM alpine:3.24 AS alpine
RUN apk --no-cache add ca-certificates

FROM scratch
ARG BUILD_GIT_VERSION=dev
ARG BUILD_GIT_COMMIT=none
# must parse as a date: the service reads BUILD_DATE at startup (`make build` stamps the real one)
ARG BUILD_DATE=1970-01-01T00:00:00Z

LABEL org.opencontainers.image.title="Driftline Leaderboard"
LABEL org.opencontainers.image.description="Online leaderboard server for driftline"
LABEL org.opencontainers.image.vendor="Benjamin Borbe"
LABEL org.opencontainers.image.licenses="BSD-2-Clause"
LABEL org.opencontainers.image.source="https://github.com/bborbe/driftline"
LABEL org.opencontainers.image.version="${BUILD_GIT_VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${BUILD_GIT_COMMIT}"

COPY --from=build /main /main
COPY --from=build /data /data
COPY --from=alpine /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /usr/local/go/lib/time/zoneinfo.zip /
ENV ZONEINFO=/zoneinfo.zip
ENV BUILD_GIT_VERSION=${BUILD_GIT_VERSION}
ENV BUILD_GIT_COMMIT=${BUILD_GIT_COMMIT}
ENV BUILD_DATE=${BUILD_DATE}
ENV DB_PATH=/data/leaderboard.db
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/main"]
