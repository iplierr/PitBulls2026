# Flugtag Lab — Design & Flight Lab

A lightweight browser workspace for the IEEE Red Bull Flugtag team, covering the whole cycle:

**design → CAD or manual input → geometry analysis → engineering calculations → flight simulation → problem checks → physical tests → simulation vs reality → next version**

The app uses plain HTML, CSS and JavaScript, with Three.js for 3D. There's no framework and no build step, and it's designed to run on older laptops.

## Run it

You need [Node.js](https://nodejs.org). There's nothing to install.

1. Double-click **`start-site.bat`**, or run `npm start` in a VS Code terminal.
2. The preview opens at **http://localhost:8080**. It refreshes by itself whenever you save a file.
3. To publish to the permanent website, run `npm run deploy`. See [PUBLISHING.md](PUBLISHING.md).

Double-clicking `index.html` won't work, because browsers block JavaScript modules on `file://` pages. The first load needs internet access for Three.js.

## Easy to use

- **New here?** On the Dashboard, click **Try an example design** to see everything working with clearly-labelled made-up numbers, or open **? Help** (quick guide, glossary, FAQ).
- Each design follows numbered steps — **1 Design numbers → 2 3D model (optional) → 3 Parts & balance → 4 Fly it** — with ✓ / ! marks showing what's done. The **Summary** page always shows **Your next step**.
- **Type in the units you know:** "28 ft", "8' 6\"", "400 lb", "15 mph", "77 F", "120 sqft", "35000 psi". Values are converted to metric automatically, and the other unit is shown under each box.
- Rarely used buttons (Duplicate, Start over, Delete) are under **More ▾**.

## Where things are

| Screen | What it's for |
|---|---|
| **Dashboard** | Start a design (Upload CAD / Enter manually), open, **New version** (1 → 1.1 → 1.2), **Duplicate** (→ Design 2), delete, backup/import |
| Design → **Overview** | Flight estimate, **Red Bull Flugtag Miami 2026 rules check** (28 ft span, 20 ft length, 400 lb with pilot, 10 ft crouched height) with suggested fixes, "What could we fix?" engineering suggestions, problem checks, "What information do we have?" checklist |
| Design → **Inputs** | All design inputs, shown as Basic / More details / Advanced, with "What is this?" help and a live estimate. **Get weather from NASA**: pick the event location and date to pull real wind, temperature and pressure (NASA POWER) |
| Design → **CAD model** | STL/GLB upload, units and orientation, geometry analysis, part roles (wing, tail, fin), apply measurements |
| Design → **Mass & balance** | Parts list with masses and positions, **pocketing / lightweighting** (by hand, or mass from CAD volume × density) with a with-vs-without flight comparison, mass distribution, centre of mass, side-view diagram, preliminary static-margin check |
| Design → **Simulate** | 3D view, animated flight (play, pause, restart, speed), graphs, results, "What does this mean?" |
| Design → **What if?** | Sweep one input and see how the outputs change, compare one change, sensitivity chart |
| Design → **Calculations** | Every equation with its inputs, sources, result and units ("How did you get this?") |
| Design → **Structure** | Preliminary spar bending stress, strain, tip deflection, factor of safety, water impact loads |
| **Physical tests** | Record tests; compare each with a simulation under the same measured conditions; CSV export |
| **Compare** | Designs side by side, with differences from the first selected design (no scores) |
| **Notebook** | Dated engineering log linked to design versions |
| **Report / export** | Printable report (Print → Save as PDF), simulation time series (CSV), inputs and results (CSV), design (JSON) |
| **⇄ Units** | Converter for ft, in, lb, mph, knots, psi, °F … |

## Tools for real design data

- **Flying wings:** set "Type of craft" to *No horizontal tail* in Parts & balance. The neutral point is taken at 25% of the mean aerodynamic chord (MAC), and an MAC length field is available.
- **Braced wings:** enter the stay/strut attachment point in Strength. The wing outside it is checked as a cantilever, with elliptical or uniform lift.
- **Airfoil files:** load a coordinate file (Selig/Lednicer .dat/.txt, any chord length) in Design numbers. You get thickness, camber, zero-lift angle and Cm from thin-airfoil theory, and can use the zero-lift angle in the simulation.
- **Parts from CSV:** Parts & balance → Import from CSV… reads mass ledgers (`part, mass_lb, x_ft, z_ft` …) and converts units and reference points.
- **Rules scan:** the parts list is checked for a pilot restraint/harness or polystyrene and flagged against the Miami rules.
- **Weather:** NASA weather has a "Miami — Bayfront Park (Flugtag 2026)" location.
- **Team design file:** a team's design can be shared as a backup file (Dashboard → Import backup). Team data files are kept out of this public repository (`team-data/` is git-ignored).

## Fixing mistakes

- **Undo / Redo** (top of every design, or Ctrl+Z / Ctrl+Y outside text boxes). This covers every change: inputs, parts, pocketing, CAD measurements, removing a model. The history is kept while the page stays open.
- **Start over…** clears a design's inputs, parts, CAD model or NASA weather (you choose which). The name, version and tests are kept, and it can be undone.
- **Delete** moves a design, test or notebook entry to **Dashboard → Recently deleted**, where it can be restored for 30 days.
- **Wrong CAD file?** Drop the right one, or use **Remove model…**. Replaced and removed models stay in **Model history** on the CAD tab, where you can switch back, see what changed between versions, or delete old ones.

## Event rules

The Overview tab checks the design against the **official Red Bull Flugtag Miami 2026 rules**, read from redbull.com on 2026-09-29: width **less than 22 ft** (Miami FAQ; the rules page says 28 ft — the stricter value is used), nose-to-tail ≤ 20 ft, craft + pilot ≤ 400 lb, and height with the pilot crouched ≤ 10 ft. It also gives a checklist for the rules you confirm yourselves (human power only, floats, no toxic materials, and so on).

The deck height is **not confirmed**: the rules page says 22 ft, but some Miami event listings say 30 ft. Ask the organisers. Rules can change, so re-check the page before the event.

## Source labels

Every value shows where it came from:

| Label | Meaning |
|---|---|
| **Measured** | Measured from CAD geometry (or a part marked "Weighed") |
| **Entered** | Typed in by a teammate |
| **Calculated** | Worked out from other values using a stated equation |
| **Estimated** | An explicit assumption, or calculated from one |
| **Not provided** | Unknown. Nothing is filled in silently |

A new design starts **empty**. If the simulation can't run, it says what's missing and why. Aerodynamic values that beginners can't know (CD0, CLmax, e, angle of attack) are only filled in if someone clicks **"Use typical assumptions"**. They're then labelled Estimated, and so is every result that uses them.

## Quick test

1. **Dashboard → Enter Design Manually.** Type wingspan 8, chord 1.5, pilot 75, craft 60, launch speed 6, deck height 9. The side panel lists what is still missing. Click **Use typical assumptions**, and the estimate appears (about 9.5 m).
2. **CAD model tab.** Drop in `samples/test-glider-mm-zup.stl` and choose **Millimetres** and **Z is up**. The model measures 8.00 × 4.00 × 1.56 m, and 5 parts are found with the wing auto-guessed. The sample's nose points backwards, so the app warns you; click **Flip nose direction**. Set the 2.40 m part as the horizontal tail, then **Apply selected measurements**.
3. Try **Mass & balance → Add typical part list**, then enter masses and positions to get the centre of mass.
4. Record a test in **Physical tests** and look at **Simulation vs reality**.

## Project layout

```
index.html              page shell, nav, unit converter
css/style.css           all styling (+ print styles for the report)
js/main.js              routing, settings, unit converter
js/store.js             designs/versions, tests, notes; localStorage; backup import/export
js/idb.js               stores CAD files in the browser (IndexedDB) so models survive a refresh
js/fields.js            every input: label, unit, level, plain-English help, optional labelled assumption
js/model.js             resolves a design into values + sources, missing-info list, sanity checks, completeness, centre of mass
js/physics.js           2D point-mass flight model (RK4)
js/calcs.js             calculation cards, stability (static margin), structure estimates
js/explain.js           plain-English explanation, what-if variables, sensitivity
js/cad-analysis.js      surface area, volume, centroids, part splitting, projected areas
js/viewer.js            Three.js viewer (render-on-demand, quality setting, markers)
js/trajectory.js        animated side-view trajectory
js/charts.js            tiny canvas chart helper (no library)
js/ui.js                shared UI helpers (badges, field forms, calc cards, downloads)
js/views/*.js           one file per screen/tab
samples/                test STL model
server.js               tiny static file server with no dependencies
```

## Data and sharing

Data is stored **in this browser on this computer only**. To share with teammates or move computers, use **Dashboard → Export backup** and **Import backup**. CAD files aren't in the backup, so re-upload them; their measurements are kept.

## Model limitations (also shown in the app)

- **Flight:** a 2D point mass holding a constant angle of attack. There's no pitching or pilot input, and only the head/tail part of the wind is used. Lift slope is `2π·AR/(AR+2)`, drag is `CD0 + CL²/(π·e·AR)`, and there's a crude post-stall model.
- **Stability:** a classical neutral-point and static-margin estimate that ignores the fuselage and pilot body. A positive static margin does **not** prove the craft is stable.
- **Structure:** an elliptical lift distribution on a cantilever wing, with equal load sharing between spars. It doesn't cover joints, buckling, fatigue or glue lines. Material strength is never guessed.
- **CAD:** bounding boxes, areas, volumes and centroids come from the geometry. Mass, CL and CD can't come from STL or GLB files. Wing and tail areas are only measured when they're separate parts.

Results are for comparing design options and planning tests. They aren't predictions, certification or a safety approval.
