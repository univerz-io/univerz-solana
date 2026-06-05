#!/bin/bash
NODE_OPTIONS='--experimental-specifier-resolution=node --loader ts-node/esm' yarn mocha --timeout 1000000 tests/univerz-arena.ts