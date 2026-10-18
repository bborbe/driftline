include Makefile.precommit

ROOTDIR ?= $(shell git rev-parse --show-toplevel)
IMAGE ?= driftline-leaderboard:dev
PORT ?= 9090

# Local run: database under ./data, the Vite dev server as the allowed origin.
.PHONY: run
run:
	mkdir -p data
	DB_PATH=data/leaderboard.db \
	LISTEN=localhost:$(PORT) \
	TOKEN=local-dev-token \
	ALLOWED_ORIGIN=http://localhost:5173 \
	go run -mod=mod . -v=2

.PHONY: build
build:
	DOCKER_BUILDKIT=1 \
	docker build \
	--rm=true \
	--build-arg BUILD_GIT_VERSION=$$(git describe --tags --always --dirty) \
	--build-arg BUILD_GIT_COMMIT=$$(git rev-parse --short HEAD) \
	--build-arg BUILD_DATE=$$(date -u +%Y-%m-%dT%H:%M:%SZ) \
	-t $(IMAGE) \
	-f Dockerfile .
