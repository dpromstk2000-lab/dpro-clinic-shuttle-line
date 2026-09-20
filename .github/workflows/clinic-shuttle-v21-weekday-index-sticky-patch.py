from pathlib import Path
import base64

def dec(value):
    return base64.b64decode(value).decode('utf-8')

def replace_once(path, old64, new64, label):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    old = dec(old64)
    new = dec(new64)
    if new in s:
        return
    if old not in s:
        raise SystemExit(f'{label}: anchor not found')
    p.write_text(s.replace(old, new, 1), encoding='utf-8', newline='\n')

replace_once('shuttle.js', 'ICAgICAgICA8ZGl2IGNsYXNzPSJwYW5lbCI+CiAgICAgICAgICA8aGVhZGVyIGNsYXNzPSJwYW5lbC1oZWFkZXIiPgogICAgICAgICAgICA8ZGl2PgogICAgICAgICAgICAgIDxoMiBjbGFzcz0icGFuZWwtdGl0bGUiPuabnOaXpeWIpeS6iOWumjwvaDI+', 'ICAgICAgICA8ZGl2IGNsYXNzPSJwYW5lbCBzY2hlZHVsZS1saXN0LXBhbmVsIj4KICAgICAgICAgIDxoZWFkZXIgY2xhc3M9InBhbmVsLWhlYWRlciI+CiAgICAgICAgICAgIDxkaXY+CiAgICAgICAgICAgICAgPGgyIGNsYXNzPSJwYW5lbC10aXRsZSI+5puc5pel5Yil5LqI5a6aPC9oMj4=', 'schedule panel sticky class')
replace_once('shuttle.css', 'LndlZWtkYXktaW5kZXggewogIHBvc2l0aW9uOiBzdGlja3k7CiAgdG9wOiAwOwogIHotaW5kZXg6IDg7', 'LnNjaGVkdWxlLWxpc3QtcGFuZWwgewogIG92ZXJmbG93OiB2aXNpYmxlOwp9Cgouc2NoZWR1bGUtbGlzdC1wYW5lbCA+IC5wYW5lbC1oZWFkZXIgewogIGJvcmRlci1yYWRpdXM6IHZhcigtLXJhZGl1cykgdmFyKC0tcmFkaXVzKSAwIDA7CiAgYmFja2dyb3VuZDogdmFyKC0tc3VyZmFjZSk7Cn0KCi5zY2hlZHVsZS1saXN0LXBhbmVsID4gLmRhdGEtdGFibGUtd3JhcCB7CiAgb3ZlcmZsb3c6IGhpZGRlbjsKICBib3JkZXItcmFkaXVzOiAwIDAgdmFyKC0tcmFkaXVzKSB2YXIoLS1yYWRpdXMpOwp9Cgoud2Vla2RheS1pbmRleCB7CiAgcG9zaXRpb246IHN0aWNreTsKICB0b3A6IDc4cHg7CiAgei1pbmRleDogMzA7', 'weekday sticky base fix')
replace_once('shuttle.css', 'ICAud2Vla2RheS1pbmRleCB7CiAgICBwb3NpdGlvbjogc3RpY2t5OwogICAgdG9wOiAwOwogICAgZGlzcGxheTogZmxleDs=', 'ICAud2Vla2RheS1pbmRleCB7CiAgICBwb3NpdGlvbjogc3RpY2t5OwogICAgdG9wOiA3MHB4OwogICAgZGlzcGxheTogZmxleDs=', 'weekday sticky mobile top')
