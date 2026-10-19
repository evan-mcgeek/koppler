# Patch bay: two questions left after the fixes

All 11 fixes in `Koppler Patch Bay Fixes.dc.html` are now built into the canvas.
Two things in them are still open.

1. The `live` colour is given only for Mono (#4ADE80). Fix 1 says it is added to every scheme, but no value is set for Lime, Signal, Scope or Sodium. In Lime and Scope the local colour is already green (#C8F03C, #52F29A), so a green `live` would clash with local cables. Please give `live` for each scheme. Until then the canvas uses #4ADE80 in all five.
2. `Koppler Design System.dc.html` still says "mono caps for every label" on its cover and uses mono-caps labels throughout. Fix 2 changed that rule. Please bring the system file in line with fix 2, so the two files agree.
