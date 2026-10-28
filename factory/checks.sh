#!/bin/sh
# The repo's deterministic checks. factory/bin/gate runs the main checkout's copy of
# this file inside a job's worktree; exit 0 means the gate passes.
#
# This repo has no lint or typecheck step. `npm run build:game` is skipped on purpose:
# it rewrites the committed public/game.js bundle and needs `npm install` in the
# worktree, so it is not a pure check.
set -e
npm test
