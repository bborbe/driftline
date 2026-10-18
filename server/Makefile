include Makefile.precommit

ROOTDIR ?= $(shell git rev-parse --show-toplevel)
DOCKER_REGISTRY ?= docker.prod.nuke.benjamin-borbe.de:443
IMAGE ?= driftline-leaderboard
# Docker tags reject '/', so a feature branch builds as e.g. feat-leaderboard-deploy.
BRANCH ?= $(shell git rev-parse --abbrev-ref HEAD | tr '/' '-')
PORT ?= 9090

# k8s/Makefile's bash subshell reads BRANCH for its master-only guard and the
# {{"BRANCH" | env}} image tag in driftline-leaderboard-sts.yaml.
export BRANCH

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
	--platform=linux/amd64 \
	--build-arg BUILD_GIT_VERSION=$$(git describe --tags --always --dirty) \
	--build-arg BUILD_GIT_COMMIT=$$(git rev-parse --short HEAD) \
	--build-arg BUILD_DATE=$$(date -u +%Y-%m-%dT%H:%M:%SZ) \
	-t $(DOCKER_REGISTRY)/$(IMAGE):$(BRANCH) \
	-f Dockerfile .

# Build, push, drop the local image, apply the manifests (nuke-prod, master only).
.PHONY: buca
buca: build upload clean apply

.PHONY: upload
upload:
	docker push $(DOCKER_REGISTRY)/$(IMAGE):$(BRANCH)

.PHONY: clean
clean:
	docker rmi $(DOCKER_REGISTRY)/$(IMAGE):$(BRANCH) || true

.PHONY: apply
apply:
	cd k8s && $(MAKE) apply
