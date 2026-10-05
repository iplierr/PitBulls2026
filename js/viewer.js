// Lightweight Three.js viewer. Renders only when something changes (no constant loop),
// which keeps older laptops cool and responsive.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/';

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        for (const key in m) if (m[key] && m[key].isTexture) m[key].dispose();
        m.dispose();
      });
    }
  });
}

export class Viewer {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.setQuality('normal');

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeaeff6);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    this.camera.position.set(7, 5, 9);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.render());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a8, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);

    // 1 m grid squares: a quick visual check that units are right.
    this.grid = new THREE.GridHelper(30, 30, 0x8d99ab, 0xc9d1dd);
    this.scene.add(this.grid);

    this.cad = new THREE.Group();
    this.placeholder = new THREE.Group();
    this.markers = new THREE.Group();
    this.scene.add(this.cad, this.placeholder, this.markers);
    this.inner = null;
    this.loadedKey = null; // which stored CAD file is currently loaded
    this.cadLength = 0;

    this.host = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  // 'low' helps older laptops: fewer pixels to draw.
  setQuality(q) {
    const ratio = { low: 0.6, normal: 1, high: Math.min(window.devicePixelRatio || 1, 2) }[q] || 1;
    this.renderer.setPixelRatio(ratio);
    if (this.host) this.resize();
  }

  mount(host) {
    this.host = host;
    host.appendChild(this.renderer.domElement);
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(host);
    this.resize();
  }

  resize() {
    if (!this.host) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  get hasCad() {
    return this.inner !== null;
  }

  showCad(show) {
    this.cad.visible = show;
    this.placeholder.visible = !show;
    this.fitCamera(show ? this.cad : this.placeholder);
  }

  hideAll() {
    this.cad.visible = false;
    this.placeholder.visible = false;
    this.markers.clear();
    this.render();
  }

  async loadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'stl' && ext !== 'glb') throw new Error('Unsupported file type. Please choose a .stl or .glb file.');
    const buffer = await file.arrayBuffer();

    let object;
    let triangles = 0;
    if (ext === 'stl') {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      triangles = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
      object = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x4f86e8, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide })
      );
    } else {
      const loader = new GLTFLoader();
      const draco = new DRACOLoader();
      draco.setDecoderPath(DRACO_PATH);
      loader.setDRACOLoader(draco);
      const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
      draco.dispose();
      object = gltf.scene;
      object.traverse((o) => {
        if (o.isMesh && o.geometry) {
          const g = o.geometry;
          triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        }
      });
    }
    if (triangles === 0) throw new Error('The file loaded but contains no triangles.');

    if (this.inner) {
      disposeTree(this.inner);
      this.cad.remove(this.inner);
    }
    this.inner = new THREE.Group();
    this.inner.add(object);
    this.cad.add(this.inner);
    this.loadedKey = null;
    return { triangles: Math.round(triangles) };
  }

  // Applies units + orientation so that X = span, Y = up, Z = length with the nose towards -Z.
  // The model rests on the grid and is centred. Returns its size in metres.
  setCadTransform(unitScale, upAxis, swapped = false, noseFlip = false) {
    if (!this.inner) return null;
    const upRot = upAxis === 'z' ? -Math.PI / 2 : 0;
    this.inner.position.set(0, 0, 0);
    this.inner.scale.setScalar(unitScale);
    this.inner.rotation.set(upRot, 0, 0, 'YXZ');
    this.inner.updateMatrixWorld(true);
    const pre = new THREE.Box3().setFromObject(this.inner).getSize(new THREE.Vector3());
    const spanIsX = (pre.x >= pre.z) !== swapped;
    this.inner.rotation.set(upRot, (spanIsX ? 0 : Math.PI / 2) + (noseFlip ? Math.PI : 0), 0, 'YXZ');
    this.inner.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(this.inner);
    const center = box.getCenter(new THREE.Vector3());
    this.inner.position.set(-center.x, -box.min.y, -center.z);
    this.inner.updateMatrixWorld(true);

    const size = box.getSize(new THREE.Vector3());
    this.cadLength = size.z;
    this.fitCamera(this.cad);
    return { x: size.x, y: size.y, z: size.z };
  }

  // Simple stand-in craft built from the design inputs (used when there is no CAD model).
  buildPlaceholder(v) {
    disposeTree(this.placeholder);
    this.placeholder.clear();

    const span = Math.max(v.span, 0.1);
    const chord = Math.max(v.chord, 0.05);
    const length = Math.max(v.length, 0.2);
    const height = Math.max(v.height, 0.2);

    const body = new THREE.MeshStandardMaterial({ color: 0xd9dee7, roughness: 0.7 });
    const wing = new THREE.MeshStandardMaterial({ color: 0xe8792b, roughness: 0.6 });
    const add = (w, h, d, mat, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      this.placeholder.add(mesh);
    };

    // Nose is at z = -length/2. Use real positions when the design has them.
    const nose = -length / 2;
    const fin = (x, fallback) => (Number.isFinite(x) ? x : fallback);
    const wingLE = fin(v.wingLEx, chord * 0.4);
    const tailChord = Number.isFinite(v.tailArea) && Number.isFinite(v.tailSpan) ? v.tailArea / v.tailSpan : chord * 0.45;
    const tailSpan = fin(v.tailSpan, Math.max(span * 0.3, 0.4));
    const tailLE = fin(v.tailLEx, length - tailChord);
    const bodyH = Math.min(0.7, height * 0.45);
    add(0.5, bodyH, length, body, 0, bodyH / 2, 0);                                            // fuselage
    add(span, 0.06, chord, wing, 0, height * 0.85, nose + wingLE + chord / 2);                  // main wing
    add(tailSpan, 0.04, tailChord, wing, 0, bodyH, nose + tailLE + tailChord / 2);              // tailplane
    add(0.04, height * 0.5, tailChord, wing, 0, bodyH + height * 0.25, nose + tailLE + tailChord / 2); // fin
    add(0.06, height * 0.85 - bodyH, 0.06, body, 0, (height * 0.85 + bodyH) / 2, nose + wingLE + chord / 2); // mast
    this.placeholderLength = length;

    if (this.placeholder.visible) this.render();
  }

  // Centre-of-mass and part-mass markers. Positions are measured from the nose (x) and bottom (y).
  // points: [{ x, y, m, kind: 'com' | 'part' }]
  setMarkers(points) {
    disposeTree(this.markers);
    this.markers.clear();
    const length = this.cad.visible && this.inner ? this.cadLength : this.placeholderLength;
    if (!length) return this.render();
    const nose = -length / 2;
    const maxM = Math.max(1, ...points.filter((p) => p.kind === 'part').map((p) => p.m));
    for (const p of points) {
      if (p.kind === 'nose') {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(length * 0.03, length * 0.08, 16), new THREE.MeshBasicMaterial({ color: 0xd61f1f }));
        cone.rotation.x = -Math.PI / 2; // point towards -Z (forward)
        cone.position.set(0, p.y, nose - length * 0.06);
        this.markers.add(cone);
        continue;
      }
      const isCom = p.kind === 'com';
      const r = isCom ? Math.max(0.12, length * 0.035) : 0.05 + 0.12 * Math.sqrt(p.m / maxM);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 16, 12),
        new THREE.MeshBasicMaterial({ color: isCom ? 0xd61f1f : 0x17803d, depthTest: !isCom, transparent: true, opacity: isCom ? 0.95 : 0.8 })
      );
      mesh.position.set(0, Number.isFinite(p.y) ? p.y : 0.5, nose + p.x);
      mesh.renderOrder = isCom ? 10 : 5;
      this.markers.add(mesh);
    }
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Flight view: water, the launch deck, and the craft moved along the simulated path.
  // Flight x (forward) maps to world −Z (the model's nose points to −Z); height maps to world Y.
  // ---------------------------------------------------------------------------
  enterFlight(deckHeight) {
    if (!this.flight) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x3b86c9, roughness: 0.35 }));
      water.rotation.x = -Math.PI / 2;
      water.position.z = -150;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x8b6b4a, roughness: 0.8 }));
      const edge = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.6 }));
      const group = new THREE.Group();
      group.add(water, deck, edge);
      this.scene.add(group);
      this.flight = { group, deck, edge };
    }
    const h = Math.max(deckHeight, 0.5);
    this.flight.deck.scale.set(9, h, 16);
    this.flight.deck.position.set(0, h / 2, 8);
    this.flight.edge.scale.set(9, 0.06, 0.25);
    this.flight.edge.position.set(0, h + 0.03, 0.12);
    this.flight.group.visible = true;
    this.grid.visible = false;
    this.scene.background = new THREE.Color(0xcfe3ff);
    this.flightOn = true;
  }

  // x, y in metres (flight), theta = body pitch in radians (nose up positive)
  setFlightPose(x, y, theta) {
    if (!this.flightOn) return;
    for (const g of [this.cad, this.placeholder, this.markers]) {
      g.position.set(0, Math.max(0, y), -x);
      g.rotation.set(theta, 0, 0);
    }
    const length = this.cad.visible && this.inner ? this.cadLength : (this.placeholderLength || 4);
    const dist = Math.max(9, length * 2.6);
    const target = new THREE.Vector3(0, Math.max(0, y) + 0.6, -x - 1);
    this.camera.position.set(dist * 0.95, target.y + dist * 0.28, target.z + dist * 0.45);
    this.camera.near = 0.1;
    this.camera.far = 2000;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.update();
    this.render();
  }

  exitFlight() {
    if (!this.flightOn) return;
    this.flightOn = false;
    for (const g of [this.cad, this.placeholder, this.markers]) { g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); }
    if (this.flight) this.flight.group.visible = false;
    this.grid.visible = true;
    this.scene.background = new THREE.Color(0xeaeff6);
    this.fitCamera(this.cad.visible ? this.cad : this.placeholder);
  }

  fitCamera(target) {
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return this.render();
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.5);
    const dir = new THREE.Vector3(0.9, 0.55, 1.1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, r * 2.6);
    this.camera.near = r / 100;
    this.camera.far = r * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.update();
    this.render();
  }
}
