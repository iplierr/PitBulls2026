// Help: quick start, what each step does, glossary, FAQ. Plain language for teammates who aren't engineers.
import { badge } from '../ui.js';

const GLOSSARY = [
  ['Wingspan', 'Distance from one wing tip to the other. Miami 2026 limit: 28 ft (8.53 m).'],
  ['Chord', 'How wide the wing is from its front edge to its back edge.'],
  ['Wing area', 'How much wing there is, seen from above. Roughly wingspan × chord.'],
  ['Aspect ratio', 'How long and skinny the wing is (span² ÷ area). Long, skinny wings waste less energy.'],
  ['Angle of attack', 'The angle between the wing and the air flowing at it. More angle = more lift, until the wing stalls.'],
  ['Stall', 'When the wing is tilted too far, the air stops flowing smoothly over it and lift suddenly drops. The craft then falls.'],
  ['Stall speed', 'The slowest speed at which the wing can hold the craft up.'],
  ['Lift', 'The upward push the wing makes from moving through the air.'],
  ['Drag', 'The air pushing back against the craft, slowing it down.'],
  ['CL (lift coefficient)', 'A number for how good the wing shape is at making lift, regardless of size or speed.'],
  ['CD (drag coefficient)', 'A number for how much the craft resists moving through the air. Boxy shapes and exposed pilots have a high CD.'],
  ['Glide ratio (L/D)', 'How many metres forward the craft goes for each metre it drops, once it is gliding steadily.'],
  ['Wing loading', 'Weight divided by wing area. Lower means the craft can fly slower.'],
  ['Headwind / tailwind', 'Wind blowing at the craft (headwind) adds airspeed over the wing; wind from behind (tailwind) takes it away.'],
  ['Airspeed', 'How fast the air flows over the wing. This is what makes lift — not ground speed.'],
  ['Centre of mass (balance point)', 'The point where the whole craft, including the pilot, would balance.'],
  ['Neutral point / static margin', 'A rough measure of whether the craft tends to correct itself in pitch. The balance point should be ahead of the neutral point.'],
  ['Spar', 'The main beam running along the inside of the wing that carries the load.'],
  ['Factor of safety', 'How many times stronger a part is than the load it is expected to carry. 1.0 means it would just reach its limit.'],
  ['Pocketing', 'Cutting cavities or holes into a part to remove material that isn\'t carrying much load, making it lighter.'],
  ['Load factor (g)', 'How many times the craft\'s weight the wings must carry. 1 g = steady flight.'],
  ['CAD / STL / GLB', 'CAD is the 3D design software (e.g. SolidWorks, Fusion). STL and GLB are 3D file types you can export from it.'],
];

const FAQ = [
  ['Why does a box say "Not provided"?', 'The app never fills in numbers you didn\'t give it. Type the value in, or — for things like drag you can\'t measure yet — click "Use typical value". Those are then marked Estimated.'],
  ['Why is a result marked "Estimated"?', 'Because at least one number it depends on is a guess or a typical value. Replace guesses with real measurements and the label changes.'],
  ['Can I type feet and pounds?', 'Yes. Type "28 ft", "8\' 6"", "400 lb", "15 mph" or "77 F" into any matching box and it is converted to metric for you. The other unit is shown under each box.'],
  ['Is the flight distance a prediction?', 'No. It is a simplified estimate, useful for comparing your own design options. Real craft often pitch up, stall or break. Record real tests and compare.'],
  ['I made a mistake — how do I fix it?', 'Use Undo (top of every design, or Ctrl+Z). "More ▾ → Start over" clears a design. Deleted designs, tests and notes go to Dashboard → Recently deleted for 30 days.'],
  ['I uploaded the wrong CAD file.', 'Just drop the right file on the 3D model step — the old one is kept in Model history. Or click "Remove model…". Undo also works.'],
  ['How do I try a change without losing my design?', 'Click "Save as new version" first (1 → 1.1). Change the copy, then compare them in Compare.'],
  ['Where is my data saved? Can teammates see it?', 'In this browser on this computer only. To share, use Dashboard → Export backup, send the file, and the teammate uses Import backup.'],
  ["Where do the Miami rules come from?", "From Red Bull’s official Miami 2026 rules page and FAQ (read on 29 Sept and 5 Oct 2026). The two pages disagree on width (FAQ: less than 22 ft wide; rules page: 28 ft wing-tip to wing-tip), so the app checks the stricter 22 ft. The deck height isn’t confirmed either (22 ft vs 30 ft). Ask the organisers, and re-check before the event."],
  ["How do I load our team’s design?", "Download the team design file (.json) from the team Drive, then Dashboard → Import backup… and choose it. To see the 3D model, download the STL from the Drive and drop it on the 3D model step (units: millimetres, Z is up, then Flip nose direction so the red cone is at the pilot end)."],
  ["Our craft has no tail — does the balance check still work?", "Yes. In Parts & balance, set “Type of craft” to “No horizontal tail (flying wing)”. The neutral point is then taken as 25% of the mean aerodynamic chord (a standard first estimate)."],
  ["Our wing is held by wires or struts.", "In Strength, enter the bracing point (how far from the centre the stays attach). The check then looks at the wing outside that point. The stays, their fittings and the centre joint still need their own checks."],
  ["Can I import a parts spreadsheet?", "Yes: Parts & balance → Import from CSV…. Columns like part, mass_lb, x_ft, z_ft are recognised. If positions are measured from somewhere other than the nose, tell the app how far that point is behind the nose."],
  ["We designed it in SolidWorks.", "The browser can’t open .SLDPRT/.SLDASM files. In SolidWorks use File → Save As → STL (choose millimetres), then upload the STL on the 3D model step."],
  ['Where does the weather come from?', 'From NASA\'s POWER service: real past weather for the area. It\'s an average over about 50 km, so measure the wind at the deck on the day too.'],
];

export function show(el) {
  el.innerHTML = `
    <h1>How to use Flugtag Lab</h1>
    <p class="lead left">A quick guide for the whole team — no engineering background needed.</p>

    <div class="panel section">
      <h2>Quick start (5 minutes)</h2>
      <ol class="help-steps">
        <li><strong>Start a design.</strong> On the Dashboard, click <em>Enter Design Manually</em> (or <em>Upload CAD Model</em> if you have a 3D file). Not ready yet? Click <em>Try an example design</em>.</li>
        <li><strong>Step 1 – Design numbers.</strong> Fill in wingspan, chord, pilot and craft weight, launch speed and deck height. Feet and pounds are fine. The box on the right tells you what's still missing.</li>
        <li><strong>Don't know the aerodynamics numbers?</strong> Click <em>Use typical values</em>. They'll be marked Estimated — that's fine to start.</li>
        <li><strong>Step 3 – Parts &amp; balance.</strong> List the parts with weights and where they sit (distance from the nose). This finds the balance point.</li>
        <li><strong>Step 4 – Fly it.</strong> Watch the estimated flight and read <em>What does this mean?</em></li>
        <li><strong>Summary.</strong> Check the Miami rules and <em>What could we fix?</em> — it suggests specific changes with numbers.</li>
        <li><strong>Test for real.</strong> Record practice tests under <em>Physical tests</em> and compare with the simulation.</li>
      </ol>
    </div>

    <div class="two-col">
      <div class="panel section">
        <h2>What the coloured labels mean</h2>
        <ul class="plain-list help-badges">
          <li>${badge('measured')} measured from your CAD model (or a part you weighed)</li>
          <li>${badge('entered')} typed in by your team</li>
          <li>${badge('calculated')} worked out from other numbers</li>
          <li>${badge('estimated')} a guess or typical value — or worked out from one</li>
          <li>${badge('missing')} not filled in yet</li>
        </ul>
        <h2 style="margin-top:16px">Where things are</h2>
        <ul class="plain-list">
          <li><strong>Dashboard</strong> — all designs, versions, backups, recently deleted.</li>
          <li><strong>Summary</strong> — results, rules check, next step, what to fix.</li>
          <li><strong>What if?</strong> — change one thing and see the effect.</li>
          <li><strong>The math</strong> — every equation, if you want to check the working.</li>
          <li><strong>Strength</strong> — rough spar strength check (needs material data from a datasheet).</li>
          <li><strong>Physical tests</strong> — real test log and simulation vs reality.</li>
          <li><strong>Compare</strong> — designs side by side.</li>
          <li><strong>Notebook</strong> — decisions, ideas and meeting notes.</li>
          <li><strong>⇄ Units</strong> (top bar) — unit converter.</li>
        </ul>
      </div>
      <div class="panel section">
        <h2>Questions</h2>
        ${FAQ.map(([q, a]) => `<details class="faq"><summary>${q}</summary><p>${a}</p></details>`).join('')}
      </div>
    </div>

    <div class="panel section">
      <h2>Words you'll see</h2>
      <dl class="glossary">${GLOSSARY.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>
    </div>`;
}
