#! /bin/bash

for f in `find ./src -iname '*.js' -type f -print`;do mv "$f" ${f%.js}.ts; done