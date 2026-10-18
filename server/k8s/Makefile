# Renders every manifest here (ns.yaml first, so a fresh cluster gets the namespace
# before anything in it) through `teamvault-cli config parse` (resolves the
# {{ "KEY" | env | teamvault* }} expressions from k8s.env) and applies it to the
# nuke-prod cluster. Same shape as bborbe/hue's k8s/Makefile: kubectlnuke* are zsh
# functions, undefined in this bash subshell, so the real kubectl gets an explicit
# KUBECONFIG instead.
#
# prod only: the game on bborbe.github.io reaches the server through hetzner-1's
# nginx, which proxies to the nuke-prod traefik. nuke-dev has no public path.
.PHONY: apply
apply:
	@if [ "$${BRANCH}" != "master" ]; then \
		echo 'apply only allowed on master (BRANCH=master make apply)!' >&2; \
		exit 1; \
	fi
	bash -c 'source k8s.env && for file in ns.yaml $$(ls *.yaml | grep -v "^ns.yaml$$"); do cat $${file} | teamvault-cli config parse | KUBECONFIG=$$HOME/.kube/nuke-prod kubectl apply -f -; done'

# Render only, no apply. Prints the Secret too, so pipe it, never read it raw:
#   make applytest | grep -v -E '^\s+token:'
.PHONY: applytest
applytest:
	bash -c 'source k8s.env && for file in ns.yaml $$(ls *.yaml | grep -v "^ns.yaml$$"); do echo "---"; cat $${file} | teamvault-cli config parse; done'
