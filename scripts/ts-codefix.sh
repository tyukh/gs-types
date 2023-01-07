#! /bin/bash

fixes=( 
"annotateWithTypeFromJSDoc"
"addMissingMember"
"inferFromUsage"
)
cd ./src
for f in "${fixes[@]}"
do
yarn ts-codefix -f $f
done
cd ..