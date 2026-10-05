// Definitions of every design input.
// level: 'basic' | 'more' | 'advanced'  (progressive disclosure)
// tab:   which screen the field is edited on
// assume: an explicitly-labelled typical assumption the user can opt into (never applied silently)

export const LEVELS = ['basic', 'more', 'advanced'];
export const LEVEL_LABEL = { basic: 'Basic', more: 'More details', advanced: 'Advanced engineering' };

export const GROUPS = [
  { id: 'wing', tab: 'inputs', label: 'Wing & size' },
  { id: 'mass', tab: 'inputs', label: 'Mass' },
  { id: 'launch', tab: 'inputs', label: 'Launch' },
  { id: 'env', tab: 'inputs', label: 'Wind & air' },
  { id: 'aero', tab: 'inputs', label: 'Aerodynamics',
    intro: 'These numbers describe how the wing turns speed into lift and drag. Don’t know them yet? That’s normal — click "Use typical value" (they will be marked Estimated).' },
  { id: 'rules', tab: 'inputs', label: 'Event rules (from your rulebook)' },
  { id: 'balance', tab: 'stability', label: 'Positions for balance' },
  { id: 'tail', tab: 'stability', label: 'Tail' },
  { id: 'load', tab: 'structure', label: 'Loads' },
  { id: 'spar', tab: 'structure', label: 'Main wing spar' },
  { id: 'material', tab: 'structure', label: 'Spar material (from a datasheet or your own test)' },
  { id: 'impact', tab: 'structure', label: 'Water impact' },
];

export const FIELDS = [
  // ---- Wing & size
  { id: 'span', group: 'wing', level: 'basic', label: 'Wingspan', unit: 'm', min: 0.1, max: 60, step: 0.1, example: '8',
    what: 'Distance from one wing tip to the other.' },
  { id: 'chord', group: 'wing', level: 'basic', label: 'Average wing chord', unit: 'm', min: 0.05, max: 20, step: 0.05, example: '1.5',
    what: 'Front-to-back width of the wing. For a tapered wing, use the average.' },
  { id: 'wingArea', group: 'wing', level: 'basic', label: 'Wing area', unit: 'm²', min: 0.01, max: 400, step: 0.1, example: '12',
    what: 'Area of the wing seen from above. Leave blank to calculate it from span × chord.' },
  { id: 'aspectRatio', group: 'wing', level: 'more', label: 'Aspect ratio', unit: '', min: 0.2, max: 40, step: 0.1, example: '5',
    what: 'How long and slender the wing is (span² ÷ area). Only needed if you know it but not the chord.' },
  { id: 'length', group: 'wing', level: 'more', label: 'Overall length', unit: 'm', min: 0.1, max: 60, step: 0.1, example: '4',
    what: 'Nose to tail.' },
  { id: 'width', group: 'wing', level: 'more', label: 'Overall width', unit: 'm', min: 0.1, max: 60, step: 0.1, example: '8',
    what: 'Widest point seen from the front (usually the wingspan).' },
  { id: 'height', group: 'wing', level: 'more', label: 'Overall height', unit: 'm', min: 0.1, max: 30, step: 0.1, example: '1.8',
    what: 'Lowest to highest point.' },

  // ---- Mass
  { id: 'pilotMass', group: 'mass', level: 'basic', label: 'Pilot mass', unit: 'kg', min: 1, max: 250, step: 1, example: '75',
    what: 'Pilot including helmet and gear.' },
  { id: 'craftMass', group: 'mass', level: 'basic', label: 'Craft mass (without pilot)', unit: 'kg', min: 0.1, max: 2000, step: 0.5, example: '60',
    what: 'Leave blank to add up the parts in the Parts & balance tab automatically.' },

  // ---- Launch
  { id: 'launchSpeed', group: 'launch', level: 'basic', label: 'Speed leaving the deck', unit: 'm/s', min: 0, max: 60, step: 0.1, example: '6',
    what: 'How fast the craft is moving at the deck edge. Measure it: time a practice push over a known distance.' },
  { id: 'deckHeight', group: 'launch', level: 'basic', label: 'Deck height above water', unit: 'm', min: 0.5, max: 50, step: 0.1, example: '9',
    what: 'Height of the launch deck edge above the water surface. Get it from the event organisers.' },
  { id: 'launchAngle', group: 'launch', level: 'more', label: 'Launch angle', unit: '°', min: -60, max: 60, step: 1, example: '0',
    what: 'Direction of travel when leaving the deck. 0 = level, positive = upward.',
    assume: { value: 0, note: 'Level launch assumed (flat deck edge).' } },

  // ---- Wind & air
  { id: 'windSpeed', group: 'env', level: 'basic', label: 'Wind speed', unit: 'm/s', min: 0, max: 30, step: 0.5, example: '3',
    what: 'Measure with a handheld anemometer on the day, or use a local weather report.',
    assume: { value: 0, note: 'Calm air assumed.' } },
  { id: 'windDir', group: 'env', level: 'more', label: 'Wind direction', unit: '°', min: 0, max: 360, step: 5, example: '0',
    what: 'Where the wind comes FROM, relative to your flight: 0° = in your face (headwind), 90° = from the side, 180° = from behind (tailwind).' },
  { id: 'temperature', group: 'env', level: 'more', label: 'Air temperature', unit: '°C', min: -40, max: 60, step: 0.5, example: '25',
    what: 'Used to calculate air density and Reynolds number.' },
  { id: 'pressure', group: 'env', level: 'advanced', label: 'Air pressure', unit: 'hPa', min: 500, max: 1100, step: 1, example: '1013',
    what: 'Station pressure from a weather app (hPa = mbar). Used with temperature to calculate air density.' },
  { id: 'elevation', group: 'env', level: 'advanced', label: 'Site elevation', unit: 'm', min: -400, max: 5000, step: 10, example: '180',
    what: 'Height of the site above sea level. Used to estimate pressure if you do not know it.' },
  { id: 'airDensity', group: 'env', level: 'advanced', label: 'Air density', unit: 'kg/m³', min: 0.5, max: 1.5, step: 0.005, example: '1.2',
    what: 'Mass of one cubic metre of air. Calculated from temperature and pressure if you leave it blank.',
    assume: { value: 1.225, note: 'Standard sea-level air (15 °C, 1013 hPa).' } },

  // ---- Aerodynamics
  { id: 'aoa', group: 'aero', level: 'basic', label: 'Angle of attack in flight', unit: '°', min: -15, max: 40, step: 0.5, example: '6',
    what: 'Angle between the wing and the oncoming air while flying. Bigger angle = more lift, until the wing stalls.',
    assume: { value: 6, note: 'A moderate angle commonly used for gliding flight; your real angle depends on how the craft is balanced and built.' } },
  { id: 'clMax', group: 'aero', level: 'basic', label: 'Maximum lift coefficient (CLmax)', unit: '', min: 0.2, max: 3, step: 0.05, example: '1.2',
    what: 'The most lift the wing can make before it stalls (airflow separates and lift suddenly drops).',
    help: 'CL (lift coefficient) is a number that says how good a wing shape is at making lift, independent of its size and speed. CLmax is the highest CL before stall. It depends on the airfoil shape and surface finish.',
    assume: { value: 1.2, note: 'Typical order of magnitude for simple home-built wings; not measured for your wing.' } },
  { id: 'cd0', group: 'aero', level: 'basic', label: 'Parasite drag coefficient (CD0)', unit: '', min: 0.005, max: 2, step: 0.005, example: '0.08',
    what: 'How much the craft resists moving through the air, not counting drag caused by lift. Includes body, pilot, struts, decorations.',
    help: 'CD (drag coefficient) is a number describing how much the aircraft resists moving through the air. CD0 is the part that exists even when the wing makes no lift. Here it is based on wing area. Boxy bodies, exposed pilots and decorations raise it.',
    assume: { value: 0.08, note: 'Rough guess for a draggy home-built craft with an exposed pilot. Replace with a value from a glide test.' } },
  { id: 'oswald', group: 'aero', level: 'more', label: 'Span efficiency (e)', unit: '', min: 0.3, max: 1, step: 0.05, example: '0.7',
    what: 'How close the wing is to the ideal lift distribution. Affects drag caused by lift. 1 = ideal.',
    assume: { value: 0.7, note: 'Common textbook first guess for a straight wing.' } },
  { id: 'knownCL', group: 'aero', level: 'advanced', label: 'Known flight lift coefficient (CL)', unit: '', min: -1, max: 3, step: 0.01, example: '0.5',
    what: 'Only if you have measured it (e.g. wind tunnel or glide test). Replaces the angle-of-attack calculation.' },
  { id: 'knownCD', group: 'aero', level: 'advanced', label: 'Known total drag coefficient (CD)', unit: '', min: 0.005, max: 3, step: 0.005, example: '0.12',
    what: 'Only if you have measured it. Replaces the CD0 + induced drag calculation.' },
  { id: 'stallSpeed', group: 'aero', level: 'advanced', label: 'Known stall speed', unit: 'm/s', min: 1, max: 60, step: 0.1, example: '12',
    what: 'Only if measured. Used to calculate CLmax when CLmax is blank.' },
  { id: 'alphaL0', group: 'aero', level: 'advanced', label: 'Airfoil zero-lift angle', unit: '°', min: -15, max: 5, step: 0.1, example: '-4',
    what: 'Cambered (curved) airfoils still make lift at 0°. If you fill this in, the angle of attack above is measured from the wing’s chord line. Load your airfoil file below to calculate it.' },

  // ---- Event rules
  { id: 'ruleMaxSpan', group: 'rules', level: 'more', label: 'Maximum wingspan allowed', unit: 'm', min: 0.1, max: 60, step: 0.01, example: '8.5',
    what: 'Copy from your event rulebook. Used only to check your design.' },
  { id: 'ruleMaxMass', group: 'rules', level: 'more', label: 'Maximum craft mass allowed (without pilot)', unit: 'kg', min: 0.1, max: 2000, step: 0.5, example: '200',
    what: 'Copy from your event rulebook. Used only to check your design.' },

  // ---- Stability tab
  { id: 'pilotX', group: 'balance', level: 'basic', label: 'Pilot position (from nose)', unit: 'm', min: 0, max: 60, step: 0.05, example: '1.8',
    what: 'Distance from the nose to the pilot\'s centre of mass (roughly the belly button when seated).' },
  { id: 'pilotY', group: 'balance', level: 'more', label: 'Pilot height (above lowest point)', unit: 'm', min: 0, max: 30, step: 0.05, example: '0.6',
    what: 'Height of the pilot\'s centre of mass above the bottom of the craft. Optional.' },
  { id: 'wingLEx', group: 'balance', level: 'basic', label: 'Wing leading edge position (from nose)', unit: 'm', min: 0, max: 60, step: 0.05, example: '1.2',
    what: 'Distance from the nose to the front edge of the main wing. For a swept or tapered wing, use the front edge of the mean aerodynamic chord (MAC).' },
  { id: 'macLength', group: 'balance', level: 'more', label: 'Mean aerodynamic chord (MAC) length', unit: 'm', min: 0.05, max: 20, step: 0.01, example: '2.17',
    what: 'The "average" chord used for balance calculations. Leave blank to use the average chord. For a swept or tapered wing, take it from your CAD or design report.' },
  { id: 'tailType', group: 'tail', level: 'basic', label: 'Type of craft', type: 'select',
    options: [['', '— choose —'], ['conventional', 'Has a horizontal tail at the back'], ['none', 'No horizontal tail (flying wing / swept wing)']],
    what: 'Flying wings balance differently: without a tail, the balance point must be ahead of the wing’s own aerodynamic centre.' },
  { id: 'tailArea', group: 'tail', level: 'basic', label: 'Horizontal tail area', unit: 'm²', min: 0.01, max: 100, step: 0.05, example: '1.5',
    what: 'Top-view area of the horizontal tail (the small wing at the back).' },
  { id: 'tailSpan', group: 'tail', level: 'basic', label: 'Horizontal tail span', unit: 'm', min: 0.05, max: 30, step: 0.05, example: '2.4',
    what: 'Tip-to-tip width of the horizontal tail.' },
  { id: 'tailLEx', group: 'tail', level: 'basic', label: 'Horizontal tail leading edge (from nose)', unit: 'm', min: 0, max: 60, step: 0.05, example: '3.4',
    what: 'Distance from the nose to the front edge of the horizontal tail.' },
  { id: 'vtailArea', group: 'tail', level: 'more', label: 'Vertical tail (fin) area', unit: 'm²', min: 0.01, max: 50, step: 0.05, example: '0.5',
    what: 'Side-view area of the fin.' },
  { id: 'vtailLEx', group: 'tail', level: 'more', label: 'Fin leading edge (from nose)', unit: 'm', min: 0, max: 60, step: 0.05, example: '3.4',
    what: 'Distance from the nose to the front edge of the fin.' },
  { id: 'tailEff', group: 'tail', level: 'advanced', label: 'Tail efficiency (η)', unit: '', min: 0.3, max: 1.2, step: 0.05, example: '0.9',
    what: 'How much of the free-stream airflow the tail feels (the wing slows and deflects air in front of it).',
    assume: { value: 0.9, note: 'Common textbook first estimate.' } },

  // ---- Strength tab
  { id: 'loadFactor', group: 'load', level: 'basic', label: 'Design load factor', unit: 'g', min: 0.1, max: 20, step: 0.1, example: '2',
    what: 'How many times the craft\'s weight the wings must carry. 1 g = steady flight. You can copy the peak value from the simulation, but add your own margin.' },
  { id: 'sparCount', group: 'spar', level: 'basic', label: 'Number of main spars', unit: '', min: 1, max: 10, step: 1, example: '1',
    what: 'Spars sharing the bending load (assumed to share it equally).' },
  { id: 'braceStation', group: 'spar', level: 'basic', label: 'Bracing point (stays/struts) from centreline', unit: 'm', min: 0.05, max: 30, step: 0.05, example: '1.98',
    what: 'If wires, stays or struts hold the wing, enter how far out from the centre they attach. The check then looks at the wing outside that point. Leave blank for an unbraced (cantilever) wing.' },
  { id: 'liftDist', group: 'load', level: 'more', label: 'How lift is spread along the wing', type: 'select',
    options: [['', 'Elliptical (default, typical smooth wing)'], ['uniform', 'Uniform (simpler and more conservative)']],
    what: 'Uniform puts more load near the tips, so it gives higher (safer-side) bending numbers.' },
  { id: 'sparShape', group: 'spar', level: 'basic', label: 'Spar cross-section', type: 'select',
    options: [['', '— choose —'], ['roundTube', 'Round tube'], ['rectTube', 'Rectangular / square tube'], ['roundSolid', 'Solid round rod'], ['rectSolid', 'Solid rectangle (e.g. timber)']],
    what: 'Shape of the spar cut across.' },
  { id: 'sparH', group: 'spar', level: 'basic', label: 'Spar height / outer diameter', unit: 'mm', min: 1, max: 1000, step: 1, example: '50',
    what: 'Vertical size of the spar (outer diameter for round).' },
  { id: 'sparW', group: 'spar', level: 'basic', label: 'Spar width', unit: 'mm', min: 1, max: 1000, step: 1, example: '25',
    what: 'Horizontal size (rectangular sections only).' },
  { id: 'sparWall', group: 'spar', level: 'basic', label: 'Wall thickness', unit: 'mm', min: 0.1, max: 200, step: 0.1, example: '2',
    what: 'Tube wall thickness (tubes only).' },
  { id: 'materialName', group: 'material', level: 'basic', label: 'Material name', type: 'text', example: '6061-T6 aluminium',
    what: 'What the spar is made of. For your records only.' },
  { id: 'yieldStrength', group: 'material', level: 'basic', label: 'Yield / failure strength', unit: 'MPa', min: 0.1, max: 5000, step: 1, example: '',
    what: 'Stress at which the material permanently bends or breaks. Take it from the supplier datasheet. This tool will NOT guess it.' },
  { id: 'youngsModulus', group: 'material', level: 'basic', label: 'Stiffness (Young\'s modulus)', unit: 'GPa', min: 0.01, max: 1000, step: 0.1, example: '',
    what: 'How stiff the material is. From the datasheet. Needed for strain and deflection.' },
  { id: 'stopDistance', group: 'impact', level: 'basic', label: 'Stopping distance in water', unit: 'm', min: 0.01, max: 20, step: 0.05, example: '0.5',
    what: 'How far the craft travels while being stopped by the water. Very uncertain; try a few values.' },
];

export const FIELD = Object.fromEntries(FIELDS.map((f) => [f.id, f]));
export const groupFields = (groupId) => FIELDS.filter((f) => f.group === groupId);
