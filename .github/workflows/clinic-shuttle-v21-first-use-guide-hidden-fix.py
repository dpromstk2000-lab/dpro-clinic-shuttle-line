from pathlib import Path
import base64

path = Path("tutorial.css")
source = path.read_text(encoding="utf-8")
old = base64.b64decode('LmRwcm8tdHV0b3JpYWwtY2FyZFtoaWRkZW5dLAouZHByby10dXRvcmlhbC10YXJnZXRbaGlkZGVuXSB7IGRpc3BsYXk6IG5vbmUgIWltcG9ydGFudDsgfQ==').decode("utf-8")
new = base64.b64decode('LmRwcm8tdHV0b3JpYWwtbGF1bmNoZXJbaGlkZGVuXSwKLmRwcm8tdHV0b3JpYWwtY2FyZFtoaWRkZW5dLAouZHByby10dXRvcmlhbC10YXJnZXRbaGlkZGVuXSB7IGRpc3BsYXk6IG5vbmUgIWltcG9ydGFudDsgfQ==').decode("utf-8")

if new in source:
    raise SystemExit(0)
if old not in source:
    raise SystemExit("tutorial hidden CSS anchor not found")

path.write_text(source.replace(old, new, 1), encoding="utf-8", newline="\n")
