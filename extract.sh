#! /bin/bash

# Extracts contents of libgnome-shell.so

gs=/usr/lib64/gnome-shell/libgnome-shell.so

## mkdir ./src
cd ./src

echo "Making directories ..."
mkdir -p \
./gdm \
./misc \
./perf \
./ui \
./ui/components \
./ui/status

echo "Processing $gs ..."
for r in `gresource list $gs`; do
    echo "Extracting ${r#\/org\/gnome\/shell/} ..."
    gresource extract $gs $r > ${r#\/org\/gnome\/shell/}
done