.PHONY: install run test build shots thumbs

node_modules: package.json package-lock.json
	npm install
	touch node_modules

install: node_modules

run: node_modules
	npm run dev

test: node_modules
	npm test

build: node_modules
	npm run build

shots: node_modules
	npm run shots

thumbs: node_modules
	npm run thumbs
