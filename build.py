#!/usr/bin/env python3
"""Builds two outputs from src/:
   dist/artifact.html           demo build (payment not checked, engine inlined)
   server/public/index.html     live build (payment checked by server.js)
   server/engine.js             file-making code, only sent after payment is confirmed
"""
import json, re, pathlib, shutil

root = pathlib.Path(__file__).parent
app = (root / "src/app.html").read_text()
engine = (root / "src/engine.js").read_text()

def config(mode):
    cfg = {"momoNumber": "0978 076 668", "momoName": "Joseph Banda", "network": "Airtel Money", "price": 5, "mode": mode}
    return "var CONFIG = " + json.dumps(cfg) + ";"

def js_string(s):
    return json.dumps(s).replace("</", "<\\/")

# demo / artifact build
demo = app.replace("/*CONFIG*/", config("demo")).replace("/*ENGINE_INLINE*/", "var ENGINE_SRC = " + js_string(engine) + ";")
(root / "dist").mkdir(exist_ok=True)
(root / "dist/artifact.html").write_text(demo)

# server build: wrapped as a full page, no engine inside
live = app.replace("/*CONFIG*/", config("server")).replace("/*ENGINE_INLINE*/", "")
head = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>')
(root / "server/public/index.html").write_text(head + live + "</body></html>")
shutil.copy(root / "src/engine.js", root / "server/engine.js")
print("built")
