// Geometry analysis of a loaded CAD model (already scaled to metres and oriented:
// X = span direction, Y = up, Z = length with the nose at the minimum Z).
// Only reports what the geometry actually supports. Anything else is "Not available from CAD".

const HEAVY_LIMIT = 300000;   // above this many triangles, skip part splitting / closed-mesh checks
const MAX_PARTS_DETAILED = 30;
const RASTER_N = 320;         // projected-area grid resolution along the longer side

// Collects world-space triangles into one Float32Array (9 floats per triangle).
function collectTriangles(root) {
  root.updateMatrixWorld(true);
  const meshes = [];
  let total = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    meshes.push({ o, n: Math.floor(n) });
    total += Math.floor(n);
  });
  const T = new Float32Array(total * 9);
  const meshOf = new Int32Array(total);
  const names = [];
  let t = 0;
  meshes.forEach(({ o, n }, mi) => {
    names.push(o.name || '');
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const e = o.matrixWorld.elements;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(i * 3 + k) : i * 3 + k;
        const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
        const o9 = t * 9 + k * 3;
        T[o9] = e[0] * x + e[4] * y + e[8] * z + e[12];
        T[o9 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        T[o9 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      meshOf[t++] = mi;
    }
  });
  return { T, meshOf, names, count: total };
}

function boundsOf(T, list) {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const visit = (t) => {
    for (let k = 0; k < 9; k++) {
      const a = k % 3, v = T[t * 9 + k];
      if (v < b.min[a]) b.min[a] = v;
      if (v > b.max[a]) b.max[a] = v;
    }
  };
  if (list) for (const t of list) visit(t); else for (let t = 0; t < T.length / 9; t++) visit(t);
  return b;
}

// Area of the silhouette seen along one axis, by rasterising triangles onto a grid.
// Returns { value, pm } where pm is a rough ± from the edge cells.
export function projectedArea(T, list, ax, bx) {
  const b = boundsOf(T, list);
  const rA = b.max[ax] - b.min[ax], rB = b.max[bx] - b.min[bx];
  const cell = Math.max(rA, rB) / RASTER_N;
  if (!(cell > 0)) return { value: 0, pm: 0 };
  const w = Math.ceil(rA / cell) + 1, h = Math.ceil(rB / cell) + 1;
  const grid = new Uint8Array(w * h);
  const a0 = b.min[ax], b0 = b.min[bx];
  const tri = (t) => {
    const o = t * 9;
    const x1 = (T[o + ax] - a0) / cell, y1 = (T[o + bx] - b0) / cell;
    const x2 = (T[o + 3 + ax] - a0) / cell, y2 = (T[o + 3 + bx] - b0) / cell;
    const x3 = (T[o + 6 + ax] - a0) / cell, y3 = (T[o + 6 + bx] - b0) / cell;
    const den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (Math.abs(den) < 1e-9) return; // edge-on in this view
    const i0 = Math.max(0, Math.floor(Math.min(x1, x2, x3))), i1 = Math.min(w - 1, Math.ceil(Math.max(x1, x2, x3)));
    const j0 = Math.max(0, Math.floor(Math.min(y1, y2, y3))), j1 = Math.min(h - 1, Math.ceil(Math.max(y1, y2, y3)));
    for (let j = j0; j <= j1; j++) {
      const py = j + 0.5;
      for (let i = i0; i <= i1; i++) {
        const px = i + 0.5;
        const l1 = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / den;
        const l2 = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / den;
        if (l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6) grid[j * w + i] = 1;
      }
    }
  };
  if (list) for (const t of list) tri(t); else for (let t = 0; t < T.length / 9; t++) tri(t);
  let filled = 0, edge = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!grid[j * w + i]) continue;
      filled++;
      if (i === 0 || j === 0 || i === w - 1 || j === h - 1 || !grid[j * w + i - 1] || !grid[j * w + i + 1] || !grid[(j - 1) * w + i] || !grid[(j + 1) * w + i]) edge++;
    }
  }
  return { value: filled * cell * cell, pm: (edge * cell * cell) / 2 };
}

// Surface area, signed volume and centroids for a set of triangles
function integrals(T, list) {
  let area = 0, vol = 0, cax = 0, cay = 0, caz = 0, cvx = 0, cvy = 0, cvz = 0;
  const visit = (t) => {
    const o = t * 9;
    const ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const a = Math.hypot(nx, ny, nz) / 2;
    area += a;
    cax += a * (ax + bx + cx) / 3; cay += a * (ay + by + cy) / 3; caz += a * (az + bz + cz) / 3;
    const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    vol += v;
    cvx += v * (ax + bx + cx) / 4; cvy += v * (ay + by + cy) / 4; cvz += v * (az + bz + cz) / 4;
  };
  if (list) for (const t of list) visit(t); else for (let t = 0; t < T.length / 9; t++) visit(t);
  return {
    area, vol,
    surfCentroid: area > 0 ? [cax / area, cay / area, caz / area] : null,
    volCentroid: Math.abs(vol) > 1e-12 ? [cvx / vol, cvy / vol, cvz / vol] : null,
  };
}

// Welds coincident vertices, splits disconnected parts, checks whether each part is closed.
// GLB meshes are never merged with each other (separate meshes = separate parts).
function splitParts(T, meshOf, count, diag) {
  const tol = Math.max(diag * 1e-6, 1e-9);
  const ids = new Map();
  const vert = new Int32Array(count * 3);
  let nV = 0;
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const key = `${meshOf[t]}|${Math.round(T[o] / tol)}|${Math.round(T[o + 1] / tol)}|${Math.round(T[o + 2] / tol)}`;
      let id = ids.get(key);
      if (id === undefined) { id = nV++; ids.set(key, id); }
      vert[t * 3 + k] = id;
    }
  }
  const parent = new Int32Array(nV).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let t = 0; t < count; t++) {
    const a = find(vert[t * 3]), b = find(vert[t * 3 + 1]), c = find(vert[t * 3 + 2]);
    parent[b] = a; parent[find(c)] = a;
  }
  const edges = new Map();
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const a = vert[t * 3 + k], b = vert[t * 3 + ((k + 1) % 3)];
      const key = a < b ? a * nV + b : b * nV + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const groups = new Map();
  for (let t = 0; t < count; t++) {
    const root = find(vert[t * 3]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }
  const openRoots = new Set();
  for (const [key, n] of edges) {
    if (n !== 2) openRoots.add(find(Math.floor(key / nV)));
  }
  return [...groups.entries()].map(([root, list]) => ({ list, closed: !openRoots.has(root) }));
}

export function analyzeCad(root) {
  const { T, meshOf, names, count } = collectTriangles(root);
  const b = boundsOf(T);
  const size = { x: b.max[0] - b.min[0], y: b.max[1] - b.min[1], z: b.max[2] - b.min[2] };
  const noseZ = b.min[2], bottomY = b.min[1];
  const diag = Math.hypot(size.x, size.y, size.z);
  const whole = integrals(T);

  const res = {
    triangles: count,
    size,
    surfaceArea: whole.area,
    closed: null,
    volume: null,
    centroid: null,
    topArea: projectedArea(T, null, 0, 2),
    sideArea: projectedArea(T, null, 2, 1),
    parts: [],
    partCount: null,
    partsNote: '',
  };
  const place = (c) => (c ? { fromNose: c[2] - noseZ, height: c[1] - bottomY, lateral: c[0] } : null);

  if (count > HEAVY_LIMIT) {
    res.partsNote = `Model has ${count.toLocaleString()} triangles. Part splitting and the closed-mesh check were skipped to keep this laptop responsive (limit ${HEAVY_LIMIT.toLocaleString()}). Export a lower-detail mesh to enable them.`;
    res.centroid = { ...place(whole.surfCentroid), kind: 'surface' };
    return res;
  }

  const parts = splitParts(T, meshOf, count, diag);
  const allClosed = parts.every((p) => p.closed);
  res.closed = allClosed;
  res.partCount = parts.length;
  if (allClosed && Math.abs(whole.vol) > 0) {
    res.volume = Math.abs(whole.vol);
    res.centroid = { ...place(whole.volCentroid), kind: 'volume' };
  } else {
    res.centroid = { ...place(whole.surfCentroid), kind: 'surface' };
  }

  const described = parts.map((p) => {
    const pb = boundsOf(T, p.list);
    return { p, pb, diag: Math.hypot(pb.max[0] - pb.min[0], pb.max[1] - pb.min[1], pb.max[2] - pb.min[2]) };
  }).sort((a, c) => c.diag - a.diag);

  res.parts = described.slice(0, MAX_PARTS_DETAILED).map(({ p, pb }, i) => {
    const meshNames = new Set(p.list.map((t) => names[meshOf[t]]));
    const nm = meshNames.size === 1 ? [...meshNames][0] : '';
    const integ = integrals(T, p.list);
    return {
      i,
      name: nm || `Part ${i + 1}`,
      triangles: p.list.length,
      closed: p.closed,
      volume: p.closed ? Math.abs(integ.vol) : null,
      surfaceArea: integ.area,
      size: { x: pb.max[0] - pb.min[0], y: pb.max[1] - pb.min[1], z: pb.max[2] - pb.min[2] },
      fromNose: [pb.min[2] - noseZ, pb.max[2] - noseZ],
      height: [pb.min[1] - bottomY, pb.max[1] - bottomY],
      lateral: [pb.min[0], pb.max[0]],
      topArea: projectedArea(T, p.list, 0, 2),
      sideArea: projectedArea(T, p.list, 2, 1),
    };
  });
  if (parts.length > MAX_PARTS_DETAILED) res.partsNote = `${parts.length} separate parts found; the ${MAX_PARTS_DETAILED} largest are listed.`;
  else if (parts.length === 1) res.partsNote = 'The model is one connected piece, so individual parts (wing, tail, body) cannot be separated. Export parts as separate bodies/meshes to measure them individually.';

  // Auto-guess the main wing: a part spanning at least 80% of the overall width, largest top-view area.
  if (parts.length > 1) {
    const cands = res.parts.filter((p) => p.size.x >= 0.8 * size.x);
    if (cands.length) {
      const wing = cands.reduce((a, c) => (c.topArea.value > a.topArea.value ? c : a));
      res.wingGuess = wing.i;
    }
  }
  return res;
}

// Measurements that can be applied to a design, given the assigned part roles.
export function cadMeasurements(an, roles = {}) {
  const out = [];
  const partFor = (role) => an.parts.find((p) => roles[p.i] === role);
  const wing = partFor('wing'), htail = partFor('htail'), vtail = partFor('vtail');
  const f2 = (v) => v.toFixed(2);

  out.push(wing
    ? { id: 'span', value: wing.size.x, how: `Width of the part "${wing.name}" (assigned as main wing).` }
    : { id: 'span', value: an.size.x, how: 'Overall width of the model. Assumes the wings are the widest part.' });
  out.push({ id: 'width', value: an.size.x, how: 'Overall bounding-box width.' });
  out.push({ id: 'length', value: an.size.z, how: 'Overall bounding-box length.' });
  out.push({ id: 'height', value: an.size.y, how: 'Overall bounding-box height.' });
  if (wing) {
    out.push({ id: 'wingArea', value: wing.topArea.value, how: `Top-view area of "${wing.name}" (±${f2(wing.topArea.pm)} m² from grid resolution). Includes any part of the wing hidden inside the body.` });
    out.push({ id: 'wingLEx', value: wing.fromNose[0], how: `Front-most point of "${wing.name}" measured from the nose. For swept or tapered wings, check this.` });
  }
  if (htail) {
    out.push({ id: 'tailArea', value: htail.topArea.value, how: `Top-view area of "${htail.name}" (±${f2(htail.topArea.pm)} m²).` });
    out.push({ id: 'tailSpan', value: htail.size.x, how: `Width of "${htail.name}".` });
    out.push({ id: 'tailLEx', value: htail.fromNose[0], how: `Front-most point of "${htail.name}" from the nose.` });
  }
  if (vtail) {
    out.push({ id: 'vtailArea', value: vtail.sideArea.value, how: `Side-view area of "${vtail.name}" (±${f2(vtail.sideArea.pm)} m²).` });
    out.push({ id: 'vtailLEx', value: vtail.fromNose[0], how: `Front-most point of "${vtail.name}" from the nose.` });
  }
  return out;
}
