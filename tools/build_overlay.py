"""Builds overlay.html from index.html: same overlay code, but without the control room.
Run after every change to index.html:  python3 tools/build_overlay.py
"""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
s = (root / 'index.html').read_text()
start = s.index('/* =========================================================\n   CONTROL ROOM')
end = s.rindex('</script>')
s = s[:start] + s[end:]
s = s.replace("const IS_OVERLAY = P.has('overlay');", "const IS_OVERLAY = true;   // overlay-only page")
# drop control-room / editor styles: the overlay doesn't need them
a = s.index('  /* ================= CONTROL ROOM ================= */')
b = s.index('  /* ================= OVERLAY ================= */')
s = s[:a] + s[b:]
a = s.index('  /* ================= OVERLAY EDITOR ================= */')
b = s.index('</style>')
s = s[:a] + s[b:]
s = re.sub(r'<link[^>]*fonts\.(googleapis|gstatic)[^>]*>\n?', '', s)
s = s.replace('<title>akaoutlaw · Card Prices</title>', '<title>akaoutlaw · Card Overlay</title>')
(root / 'overlay.html').write_text(s)
print('overlay.html written,', len(s), 'bytes')
