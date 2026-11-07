# Bygga renderer reuse

Upstream: https://github.com/Nutlope/bygga
Pinned commit: a02629a7d6454e2e28412ca7c11c69fa838304ff
License: MIT; original LICENSE and NOTICE retained here.

Copied: engine/{stage,drawable,materials}.ts, lib/types.ts, lib/plan/math.ts.
Changes: local import paths and Vite development flag; bounded sphere and arc
and tapered-cylinder primitives, arc angle and a plastic material palette for
photo-driven schematics. The application derives rod transforms from endpoints.
The application adapter retains the renderer's +y upright convention by default.
No catalog, branding,
Next app, generated assembly instructions or IKEA media copied.

Wujian adapts its bounded schematic/1 JSON into the renderer Plan interface.
Geometry is an inferred schematic, not dimensionally accurate CAD or an official
assembly manual. Teaching evidence and real user progress stay in TaskRecord.

The AS2 adapter adds validated per-part colors and focus-only labels (labelIds).
Per-part animation positions stay in the application scene adapter; the upstream
renderer remains an exterior schematic viewer, not a machine simulator.
