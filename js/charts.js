// Minimal canvas line chart (no library). Draws once; call again to redraw.
// series: [{ name, color, points: [[x, y], ...], dashed?, dots? }]

function niceStep(range, target = 5) {
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}
const tickLabel = (v, step) => {
  const d = (String(+step.toPrecision(3)).split('.')[1] || '').length; // decimals needed by the step
  return Math.abs(v) >= 10000 ? v.toExponential(1) : (+v.toFixed(Math.min(d, 4))).toString();
};

export function lineChart(canvas, { series, xLabel = '', yLabel = '', yZero = true, emptyText = 'No data' }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const pts = series.flatMap((s) => s.points).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  ctx.font = '11px system-ui, sans-serif';
  if (!pts.length) {
    ctx.fillStyle = '#5d6a7e';
    ctx.textAlign = 'center';
    ctx.fillText(emptyText, w / 2, h / 2);
    return;
  }
  let xMin = Math.min(...pts.map((p) => p[0])), xMax = Math.max(...pts.map((p) => p[0]));
  let yMin = Math.min(...pts.map((p) => p[1])), yMax = Math.max(...pts.map((p) => p[1]));
  if (yZero) { yMin = Math.min(0, yMin); yMax = Math.max(0, yMax); }
  if (xMax === xMin) { xMax += 1; xMin -= 1; }
  if (yMax === yMin) { yMax += 1; yMin -= yMin === 0 ? 0 : 1; }
  const yPad = (yMax - yMin) * 0.08;
  yMax += yPad;
  if (yMin < 0) yMin -= yPad;

  const pad = { l: 52, r: 12, t: 22, b: 34 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const X = (x) => pad.l + ((x - xMin) / (xMax - xMin)) * pw;
  const Y = (y) => pad.t + ph - ((y - yMin) / (yMax - yMin)) * ph;

  // grid
  ctx.strokeStyle = '#e6eaf0';
  ctx.fillStyle = '#5d6a7e';
  ctx.lineWidth = 1;
  const xs = niceStep(xMax - xMin), ys = niceStep(yMax - yMin);
  ctx.textAlign = 'center';
  for (let x = Math.ceil(xMin / xs) * xs; x <= xMax + 1e-9; x += xs) {
    ctx.beginPath(); ctx.moveTo(X(x), pad.t); ctx.lineTo(X(x), pad.t + ph); ctx.stroke();
    ctx.fillText(tickLabel(x, xs), X(x), pad.t + ph + 14);
  }
  ctx.textAlign = 'right';
  for (let y = Math.ceil(yMin / ys) * ys; y <= yMax + 1e-9; y += ys) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(y)); ctx.lineTo(pad.l + pw, Y(y)); ctx.stroke();
    ctx.fillText(tickLabel(y, ys), pad.l - 6, Y(y) + 4);
  }
  if (yMin < 0 && yMax > 0) {
    ctx.strokeStyle = '#9aa5b5';
    ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(pad.l + pw, Y(0)); ctx.stroke();
  }
  ctx.fillStyle = '#1c2433';
  ctx.textAlign = 'center';
  ctx.fillText(xLabel, pad.l + pw / 2, h - 4);
  ctx.save();
  ctx.translate(11, pad.t + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // series
  for (const s of series) {
    const p = s.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width || 2;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    if (!s.dotsOnly) {
      ctx.beginPath();
      p.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (s.dots || s.dotsOnly) for (const [x, y] of p) { ctx.beginPath(); ctx.arc(X(x), Y(y), s.dotSize || 3, 0, Math.PI * 2); ctx.fill(); }
  }

  // legend
  if (series.length > 1 || series[0]?.name) {
    ctx.textAlign = 'left';
    let lx = pad.l + 6;
    for (const s of series) {
      if (!s.name) continue;
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, 7, 12, 3);
      ctx.fillStyle = '#1c2433';
      ctx.fillText(s.name, lx + 16, 12);
      lx += ctx.measureText(s.name).width + 32;
    }
  }
}
