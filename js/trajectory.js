// Side-view trajectory drawing and animation on a plain 2D canvas.
// Uses the same scale on both axes so the flight path shape is honest.

const DECK_LENGTH = 5; // metres of deck drawn behind the launch edge (visual only)

function niceStep(range) {
  const raw = range / 8;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}

export class TrajectoryView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.result = null;
    this.params = null;
    this.raf = null;
    this.currentT = Infinity;
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.draw(this.currentT);
  }

  setData(analysis, params) {
    this.stop();
    this.result = analysis;
    this.params = params;
    this.currentT = Infinity;
    this.draw(Infinity);
  }

  clear(message) {
    this.stop();
    this.result = null;
    this.message = message;
    this.draw(Infinity);
  }

  // Plays from the start, or resumes if paused part-way.
  play(speed = 1, fromStart = false) {
    if (!this.result) return;
    const total = this.result.flight.time;
    const startT = !fromStart && Number.isFinite(this.currentT) && this.currentT < total ? this.currentT : 0;
    this.stop();
    this.speed = speed;
    let last = performance.now();
    let t = startT;
    const frame = (now) => {
      t += ((now - last) / 1000) * this.speed;
      last = now;
      this.currentT = Math.min(t, total);
      this.draw(this.currentT);
      if (t < total) this.raf = requestAnimationFrame(frame);
      else { this.raf = null; this.currentT = Infinity; this.onState?.('ended'); }
    };
    this.raf = requestAnimationFrame(frame);
    this.onState?.('playing');
  }

  get playing() { return !!this.raf; }

  pause() {
    this.stop();
    this.onState?.('paused');
  }

  setSpeed(speed) { this.speed = speed; }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  draw(tNow) {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#cfe3ff');
    sky.addColorStop(1, '#eef6ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    if (!this.result) {
      ctx.fillStyle = '#5d6a7e';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.message || 'Enter valid inputs to see the flight.', w / 2, h / 2);
      return;
    }

    const { flight, noLift } = this.result;
    const p = this.params;

    // World bounds (metres) -> pixels, equal scale on x and y.
    const pad = { l: 44, r: 16, t: 14, b: 30 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const xMin = -DECK_LENGTH;
    const xMaxNeeded = Math.max(flight.distance, noLift.distance, 10) * 1.1;
    const yMin = -1.5;
    const yMaxNeeded = Math.max(flight.maxHeight, p.deckHeight) * 1.2 + 1;
    const scale = Math.min(plotW / (xMaxNeeded - xMin), plotH / (yMaxNeeded - yMin));
    const X = (x) => pad.l + (x - xMin) * scale;
    const Y = (y) => pad.t + plotH - (y - yMin) * scale;
    const xMax = xMin + plotW / scale;
    const yMax = yMin + plotH / scale;

    // Grid + axis labels
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    const step = niceStep(Math.max(xMax - xMin, yMax - yMin));
    ctx.strokeStyle = 'rgba(40, 70, 120, 0.12)';
    ctx.fillStyle = '#5d6a7e';
    ctx.textAlign = 'center';
    for (let x = 0; x <= xMax; x += step) {
      ctx.beginPath(); ctx.moveTo(X(x), pad.t); ctx.lineTo(X(x), Y(0)); ctx.stroke();
      ctx.fillText(`${+x.toFixed(2)} m`, X(x), h - 10);
    }
    ctx.textAlign = 'right';
    for (let y = 0; y <= yMax; y += step) {
      ctx.beginPath(); ctx.moveTo(pad.l, Y(y)); ctx.lineTo(w - pad.r, Y(y)); ctx.stroke();
      ctx.fillText(`${+y.toFixed(2)} m`, pad.l - 6, Y(y) + 4);
    }

    // Water
    ctx.fillStyle = '#4f9bd9';
    ctx.fillRect(pad.l, Y(0), plotW, Y(yMin) - Y(0) + pad.b);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'left';
    ctx.fillText('water', X(xMax) - 44, Y(0) + 14);

    // Deck
    ctx.fillStyle = '#8b6b4a';
    ctx.fillRect(X(xMin), Y(p.deckHeight), X(0) - X(xMin), Y(0) - Y(p.deckHeight));
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('deck', (X(xMin) + X(0)) / 2, Y(p.deckHeight / 2) + 4);

    // No-lift comparison path
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#6b7686';
    ctx.lineWidth = 2;
    this.path(noLift.points, Infinity, X, Y);
    ctx.setLineDash([]);

    // Craft path up to tNow
    ctx.strokeStyle = '#0b5cd6';
    ctx.lineWidth = 3;
    const last = this.path(flight.points, tNow, X, Y);

    // Craft marker, rotated to the direction of travel
    if (last) {
      ctx.save();
      ctx.translate(X(last.x), Y(last.y));
      ctx.rotate(-Math.atan2(last.vy, last.vx));
      ctx.fillStyle = '#e8792b';
      ctx.strokeStyle = '#7a3a0c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(-8, -7); ctx.lineTo(-4, 0); ctx.lineTo(-8, 7);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // Landing labels once the flight is complete
    if (tNow >= flight.time) {
      this.splash(X(flight.distance), Y(0), `${flight.distance.toFixed(1)} m`, '#0b5cd6');
      if (Math.abs(noLift.distance - flight.distance) > 0.5) {
        this.splash(X(noLift.distance), Y(0), `${noLift.distance.toFixed(1)} m`, '#6b7686', true);
      }
    }

    // Wind arrow (head/tail component only — that is all the 2D model uses)
    const hw = p.headwind || 0;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1c2433';
    const wx = pad.l + 10, wy = pad.t + 14;
    if (Math.abs(hw) < 0.05) {
      ctx.fillText('Wind: calm (along flight path)', wx, wy + 4);
    } else {
      const len = Math.min(70, 18 + Math.abs(hw) * 6);
      const dir = hw > 0 ? -1 : 1; // headwind blows toward the deck (−x)
      const x0 = dir < 0 ? wx + len : wx, x1 = dir < 0 ? wx : wx + len;
      ctx.strokeStyle = '#1c2433'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, wy); ctx.lineTo(x1, wy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, wy); ctx.lineTo(x1 - dir * 7, wy - 5); ctx.lineTo(x1 - dir * 7, wy + 5); ctx.closePath(); ctx.fill();
      ctx.fillText(`${Math.abs(hw).toFixed(1)} m/s ${hw > 0 ? 'headwind' : 'tailwind'}`, wx + len + 8, wy + 4);
    }

    // Timer
    const shownT = Math.min(tNow, flight.time);
    ctx.fillStyle = '#1c2433';
    ctx.textAlign = 'right';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`t = ${shownT.toFixed(2)} s`, w - pad.r - 4, pad.t + 12);
  }

  // Draws points with t <= tMax; returns the last drawn point.
  path(points, tMax, X, Y) {
    const ctx = this.ctx;
    ctx.beginPath();
    let last = null;
    for (const pt of points) {
      if (pt.t > tMax) break;
      if (!last) ctx.moveTo(X(pt.x), Y(pt.y));
      else ctx.lineTo(X(pt.x), Y(pt.y));
      last = pt;
    }
    ctx.stroke();
    return last;
  }

  splash(px, py, label, color, below = false) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = below ? '#fff' : color;
    ctx.fillText(label, px, below ? py + 16 : py - 18);
  }
}
