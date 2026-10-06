import * as THREE from "three";
import {
  FEATURED_PLACES,
  latLngToUnit,
  type KineticEvent,
  type KineticStatus,
} from "../data/kinetic";

export type Pick = { kind: "place" | "event"; id: string };

export type GlobeHandle = {
  focus: (lat: number, lng: number, onDone?: () => void) => void;
  setHover: (id: string | null) => void;
  sync: (events: KineticEvent[], flashIds: ReadonlySet<string>) => void;
  dispose: () => void;
};

const AMBER = 0xe8a317;
const ALERT = 0xff4b3e;
const SKY = 0x9ecbff;
const FOCUS_MS = 1200;
const SIX_HOURS = 6 * 60 * 60 * 1000;
const MIN_DIST = 1.55;
const MAX_DIST = 5.4;

type Visual = {
  id: string;
  mesh: THREE.Mesh;
  glow: THREE.Sprite | null;
  kind: "dot" | "disc";
  firstSeen: number;
  status: KineticStatus;
  location: string;
};

type Burst = {
  obj: THREE.Object3D;
  mat: THREE.SpriteMaterial | THREE.MeshBasicMaterial;
  age: number;
  life: number;
  peak: number;
  base: number;
};

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function makeGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.18, "rgba(255,255,255,0.85)");
  glow.addColorStop(0.42, "rgba(255,210,140,0.35)");
  glow.addColorStop(1, "rgba(255,80,40,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function graticuleGeometry() {
  const positions: number[] = [];
  const r = 1.003;
  const pushLat = (lat: number) => {
    const phi = ((90 - lat) * Math.PI) / 180;
    let prev: [number, number, number] | null = null;
    for (let i = 0; i <= 72; i += 1) {
      const lng = -180 + (360 * i) / 72;
      const theta = ((lng + 180) * Math.PI) / 180;
      const p: [number, number, number] = [
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      ];
      if (prev) positions.push(...prev, ...p);
      prev = p;
    }
  };
  const pushLng = (lng: number) => {
    const theta = ((lng + 180) * Math.PI) / 180;
    let prev: [number, number, number] | null = null;
    for (let i = 0; i <= 36; i += 1) {
      const lat = -90 + (180 * i) / 36;
      const phi = ((90 - lat) * Math.PI) / 180;
      const p: [number, number, number] = [
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      ];
      if (prev) positions.push(...prev, ...p);
      prev = p;
    }
  };
  for (let lat = -60; lat <= 60; lat += 30) pushLat(lat);
  for (let lng = -150; lng <= 180; lng += 30) pushLng(lng);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

export function mountGlobe(
  parent: HTMLElement,
  arrowLayer: HTMLElement,
  hooks: {
    onPick: (pick: Pick) => void;
    onHover: (pick: Pick | null) => void;
  },
): GlobeHandle {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x07090c, 1);
  renderer.domElement.className = "block h-full w-full";
  parent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  let distance = 2.85;
  let targetDistance = 2.85;
  camera.position.set(0, 0, distance);

  scene.add(new THREE.AmbientLight(0x9eb4c8, 0.55));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.45);
  sun.position.set(5, 2.2, 3.4);
  scene.add(sun);

  const starPositions: number[] = [];
  const starColors: number[] = [];
  for (let i = 0; i < 1400; i += 1) {
    const r = 28 + Math.random() * 50;
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    starPositions.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    );
    const shade = 0.55 + Math.random() * 0.45;
    starColors.push(shade, shade, shade * 0.95 + 0.05);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
  starGeo.setAttribute("color", new THREE.Float32BufferAttribute(starColors, 3));
  scene.add(
    new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        size: 1.35,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    ),
  );

  const globe = new THREE.Group();
  scene.add(globe);

  const earthGeo = new THREE.SphereGeometry(1, 64, 48);
  const earthMat = new THREE.MeshPhongMaterial({
    color: 0x16324a,
    specular: 0x1c3344,
    shininess: 10,
  });
  const earth = new THREE.Mesh(earthGeo, earthMat);
  earth.userData.kind = "earth";
  globe.add(earth);

  const loader = new THREE.TextureLoader();
  loader.load(
    "/textures/earth-day.jpg",
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      earthMat.map = texture;
      earthMat.color.set(0xffffff);
      earthMat.needsUpdate = true;
    },
    undefined,
    () => {
      earthMat.color.set(0x1a4a6e);
    },
  );

  globe.add(new THREE.LineSegments(
    graticuleGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x7eb6ff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  ));

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.065, 64, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float ndv = abs(dot(normalize(vNormal), viewDir));
          float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), 2.35);
          gl_FragColor = vec4(0.45, 0.68, 1.0, rim * 1.05);
        }
      `,
    }),
  );
  globe.add(atmosphere);

  const glowTex = makeGlowTexture();
  const placeGlowMat = new THREE.SpriteMaterial({
    map: glowTex,
    color: SKY,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const coreGeo = new THREE.SphereGeometry(0.012, 12, 10);
  const placeMarkers: {
    id: string;
    core: THREE.Mesh;
    glow: THREE.Sprite;
    phase: number;
  }[] = [];

  for (const place of FEATURED_PLACES) {
    const [x, y, z] = latLngToUnit(place.lat, place.lng);
    const core = new THREE.Mesh(
      coreGeo,
      new THREE.MeshBasicMaterial({ color: SKY }),
    );
    core.position.set(x, y, z).multiplyScalar(1.014);
    core.userData.kind = "place";
    core.userData.id = place.id;
    const glow = new THREE.Sprite(placeGlowMat);
    glow.position.copy(core.position);
    glow.scale.setScalar(0.07);
    glow.raycast = () => undefined;
    globe.add(core, glow);
    placeMarkers.push({ id: place.id, core, glow, phase: Math.random() * Math.PI * 2 });
  }

  const dotGeo = new THREE.SphereGeometry(0.014, 12, 10);
  const discGeo = new THREE.CircleGeometry(1, 40);
  const ringGeo = new THREE.RingGeometry(0.72, 1, 48);
  const dots: THREE.Mesh[] = [];
  const dotGlows: THREE.Sprite[] = [];
  const discs: THREE.Mesh[] = [];
  const flashes: THREE.Sprite[] = [];
  const rings: THREE.Mesh[] = [];
  const freeDots: number[] = [];
  const freeDiscs: number[] = [];
  const freeFlashes: number[] = [];
  const freeRings: number[] = [];

  const makeBasic = (color: number, opacity: number) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

  for (let i = 0; i < 200; i += 1) {
    const mesh = new THREE.Mesh(dotGeo, makeBasic(AMBER, 1));
    mesh.visible = false;
    mesh.userData.kind = "event";
    globe.add(mesh);
    dots.push(mesh);
    freeDots.push(i);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: AMBER,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.visible = false;
    glow.raycast = () => undefined;
    glow.scale.setScalar(0.05);
    globe.add(glow);
    dotGlows.push(glow);
    const disc = new THREE.Mesh(discGeo, makeBasic(AMBER, 0.28));
    disc.visible = false;
    disc.userData.kind = "event";
    globe.add(disc);
    discs.push(disc);
    freeDiscs.push(i);
  }
  for (let i = 0; i < 32; i += 1) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: ALERT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    sprite.visible = false;
    sprite.raycast = () => undefined;
    globe.add(sprite);
    flashes.push(sprite);
    freeFlashes.push(i);
    const ring = new THREE.Mesh(ringGeo, makeBasic(ALERT, 0));
    ring.visible = false;
    ring.raycast = () => undefined;
    globe.add(ring);
    rings.push(ring);
    freeRings.push(i);
  }

  const visuals = new Map<string, Visual>();
  const bursts: Burst[] = [];
  const arrowNodes: HTMLDivElement[] = [];
  for (let i = 0; i < 8; i += 1) {
    const node = document.createElement("div");
    node.className = "edge-arrow";
    node.innerHTML = "<i></i>";
    node.hidden = true;
    arrowLayer.appendChild(node);
    arrowNodes.push(node);
  }

  const pickables: THREE.Object3D[] = [earth, ...placeMarkers.map((m) => m.core)];

  const rebuildPickables = () => {
    pickables.length = 0;
    pickables.push(earth);
    for (const marker of placeMarkers) pickables.push(marker.core);
    for (const visual of visuals.values()) pickables.push(visual.mesh);
  };

  const colorFor = (status: KineticStatus) => (status === "corroborated" ? ALERT : AMBER);

  const placeOnSurface = (mesh: THREE.Object3D, lat: number, lng: number, radius: number) => {
    const [x, y, z] = latLngToUnit(lat, lng);
    mesh.position.set(x * radius, y * radius, z * radius);
  };

  const orientFlat = (mesh: THREE.Object3D, lat: number, lng: number) => {
    const [x, y, z] = latLngToUnit(lat, lng);
    _normal.set(x, y, z);
    mesh.quaternion.setFromUnitVectors(_zAxis, _normal);
  };

  const _normal = new THREE.Vector3();
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _world = new THREE.Vector3();
  const _qYaw = new THREE.Quaternion();
  const _qPitch = new THREE.Quaternion();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _xAxis = new THREE.Vector3(1, 0, 0);
  const _startQ = new THREE.Quaternion();
  const _endQ = new THREE.Quaternion();
  const _from = new THREE.Vector3();

  function acquire(pool: THREE.Mesh[], free: number[]): THREE.Mesh | null {
    const index = free.pop();
    if (index === undefined) return null;
    const mesh = pool[index];
    if (!mesh) return null;
    mesh.visible = true;
    mesh.userData.poolIndex = index;
    return mesh;
  }

  function releaseMesh(mesh: THREE.Mesh, free: number[]) {
    mesh.visible = false;
    const index = mesh.userData.poolIndex as number;
    if (!free.includes(index)) free.push(index);
  }

  function spawnBurst(lat: number, lng: number, status: KineticStatus) {
    const flashIndex = freeFlashes.pop();
    const ringIndex = freeRings.pop();
    const color = colorFor(status);
    if (flashIndex !== undefined) {
      const sprite = flashes[flashIndex];
      const mat = sprite?.material as THREE.SpriteMaterial | undefined;
      if (sprite && mat) {
        sprite.visible = true;
        sprite.userData.poolIndex = flashIndex;
        mat.color.set(color);
        mat.opacity = 1;
        placeOnSurface(sprite, lat, lng, 1.02);
        bursts.push({ obj: sprite, mat, age: 0, life: 1.2, peak: 0.72, base: 0 });
      }
    }
    if (ringIndex !== undefined) {
      const ring = rings[ringIndex];
      const mat = ring?.material as THREE.MeshBasicMaterial | undefined;
      if (ring && mat) {
        ring.visible = true;
        ring.userData.poolIndex = ringIndex;
        mat.color.set(color);
        mat.opacity = 0.9;
        placeOnSurface(ring, lat, lng, 1.012);
        orientFlat(ring, lat, lng);
        bursts.push({ obj: ring, mat, age: 0, life: 2, peak: 0.22, base: 0.025 });
      }
    }
  }

  function upsertVisual(event: KineticEvent) {
    const useDisc = event.precision === "region" || event.precision === "country";
    let visual = visuals.get(event.id);
    if (visual && ((useDisc && visual.kind !== "disc") || (!useDisc && visual.kind !== "dot"))) {
      releaseVisual(event.id);
      visual = undefined;
    }
    if (!visual) {
      const mesh = useDisc ? acquire(discs, freeDiscs) : acquire(dots, freeDots);
      if (!mesh) return;
      mesh.userData.id = event.id;
      mesh.userData.kind = "event";
      const glow = useDisc ? null : (dotGlows[mesh.userData.poolIndex as number] ?? null);
      if (glow) glow.visible = true;
      visual = {
        id: event.id,
        mesh,
        glow,
        kind: useDisc ? "disc" : "dot",
        firstSeen: Date.parse(event.first_seen),
        status: event.status,
        location: event.location_name,
      };
      visuals.set(event.id, visual);
    }
    visual.firstSeen = Date.parse(event.first_seen);
    visual.status = event.status;
    visual.location = event.location_name;
    const mat = visual.mesh.material as THREE.MeshBasicMaterial;
    const tint = colorFor(event.status);
    mat.color.set(tint);
    if (visual.glow) {
      (visual.glow.material as THREE.SpriteMaterial).color.set(tint);
      placeOnSurface(visual.glow, event.lat, event.lng, 1.02);
      visual.glow.visible = true;
    }
    if (visual.kind === "disc") {
      placeOnSurface(visual.mesh, event.lat, event.lng, 1.008);
      orientFlat(visual.mesh, event.lat, event.lng);
      const ang = Math.sin(event.radius_km / 6371);
      visual.mesh.scale.setScalar(Math.max(0.02, ang * 1.65));
      mat.opacity = 0.42;
    } else {
      placeOnSurface(visual.mesh, event.lat, event.lng, 1.014);
      visual.mesh.scale.setScalar(1);
      mat.opacity = 1;
    }
  }

  function releaseVisual(id: string) {
    const visual = visuals.get(id);
    if (!visual) return;
    if (visual.glow) visual.glow.visible = false;
    if (visual.kind === "disc") releaseMesh(visual.mesh, freeDiscs);
    else releaseMesh(visual.mesh, freeDots);
    visuals.delete(id);
  }

  let hoverId: string | null = null;
  let yawVel = 0;
  let pitchVel = 0;
  let lastInteraction = performance.now();
  let pointerDown = false;
  let dragging = false;
  let activePointer = -1;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  let focusUntil = 0;
  let focusStart = 0;
  let focusCb: (() => void) | null = null;
  let hoverSent: string | null = null;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function resize() {
    const w = parent.clientWidth || 1;
    const h = parent.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const observer = new ResizeObserver(() => resize());
  observer.observe(parent);

  function pickAt(clientX: number, clientY: number): Pick | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    const hit = hits[0];
    if (!hit) return null;
    const kind = hit.object.userData.kind as string | undefined;
    const id = hit.object.userData.id as string | undefined;
    if ((kind !== "place" && kind !== "event") || !id) return null;
    return { kind, id };
  }

  function rotateBy(yaw: number, pitch: number) {
    _qYaw.setFromAxisAngle(_yAxis, yaw);
    _qPitch.setFromAxisAngle(_xAxis, pitch);
    globe.quaternion.premultiply(_qPitch).premultiply(_qYaw).normalize();
  }

  function onPointerDown(event: PointerEvent) {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointerDown = true;
    dragging = false;
    activePointer = event.pointerId;
    lastInteraction = performance.now();
    yawVel = 0;
    pitchVel = 0;
    if (focusCb) {
      focusCb = null;
      focusUntil = 0;
    }
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const a = pts[0];
      const b = pts[1];
      if (a && b) pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    renderer.domElement.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    const prev = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2 && prev) {
      const pts = [...pointers.values()];
      const a = pts[0];
      const b = pts[1];
      if (a && b && pinchDist > 0) {
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const ratio = pinchDist / Math.max(1, dist);
        targetDistance = THREE.MathUtils.clamp(targetDistance * ratio, MIN_DIST, MAX_DIST);
        pinchDist = dist;
      }
      lastInteraction = performance.now();
      return;
    }
    if (!pointerDown || event.pointerId !== activePointer || !prev) {
      if (!pointerDown) {
        const found = pickAt(event.clientX, event.clientY);
        const key = found ? `${found.kind}:${found.id}` : null;
        if (key !== hoverSent) {
          hoverSent = key;
          hooks.onHover(found);
        }
      }
      return;
    }
    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    if (!dragging && Math.hypot(dx, dy) > 4) dragging = true;
    if (!dragging) return;
    const height = Math.max(1, parent.clientHeight);
    const yaw = (dx / height) * Math.PI;
    const pitch = (dy / height) * Math.PI;
    rotateBy(yaw, pitch);
    const dt = 1 / 60;
    yawVel = yaw / dt;
    pitchVel = pitch / dt;
    lastInteraction = performance.now();
  }

  function onPointerUp(event: PointerEvent) {
    const wasDrag = dragging;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (event.pointerId === activePointer) {
      pointerDown = false;
      dragging = false;
      activePointer = -1;
      lastInteraction = performance.now();
      if (!wasDrag) {
        const found = pickAt(event.clientX, event.clientY);
        if (found) hooks.onPick(found);
      }
    }
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0011);
    targetDistance = THREE.MathUtils.clamp(targetDistance * factor, MIN_DIST, MAX_DIST);
    lastInteraction = performance.now();
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

  let raf = 0;
  let last = performance.now();

  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const focusing = focusUntil > now;
    if (focusing) {
      const t = easeInOutCubic(Math.min(1, (now - focusStart) / Math.max(1, focusUntil - focusStart)));
      globe.quaternion.copy(_startQ).slerp(_endQ, t);
    } else if (focusUntil !== 0 && now >= focusUntil) {
      globe.quaternion.copy(_endQ);
      focusUntil = 0;
      const cb = focusCb;
      focusCb = null;
      cb?.();
    }

    if (!pointerDown && !focusing) {
      const damp = Math.exp(-3.1 * dt);
      yawVel *= damp;
      pitchVel *= damp;
      if (Math.abs(yawVel) < 0.0008) yawVel = 0;
      if (Math.abs(pitchVel) < 0.0008) pitchVel = 0;
      if (yawVel || pitchVel) rotateBy(yawVel * dt, pitchVel * dt);
      const idle = now - lastInteraction > 3000 && Math.abs(yawVel) < 0.02 && Math.abs(pitchVel) < 0.02;
      if (idle && !reduce) rotateBy(0.07 * dt, 0);
    }

    distance += (targetDistance - distance) * (1 - Math.exp(-8 * dt));
    camera.position.z = distance;

    const pulse = reduce ? 0.7 : 0.55 + 0.45 * Math.sin(now * 0.003);
    placeGlowMat.opacity = 0.28 + pulse * 0.4;
    for (const marker of placeMarkers) {
      const hot = hoverId === marker.id;
      const s = (hot ? 1.55 : 1) * (0.85 + pulse * 0.35);
      marker.core.scale.setScalar(s);
      marker.glow.scale.setScalar(hot ? 0.11 : 0.055 + pulse * 0.03);
    }

    const fading: string[] = [];
    for (const visual of visuals.values()) {
      const age = now - visual.firstSeen;
      const fade = 1 - age / SIX_HOURS;
      const mat = visual.mesh.material as THREE.MeshBasicMaterial;
      if (fade <= 0) {
        fading.push(visual.id);
        continue;
      }
      const hot = hoverId === visual.id ? 1.45 : 1;
      if (visual.kind === "dot") {
        mat.opacity = fade;
        visual.mesh.scale.setScalar(hot);
        if (visual.glow) {
          const gmat = visual.glow.material as THREE.SpriteMaterial;
          gmat.opacity = 0.5 * fade * (hot > 1 ? 1.35 : 1);
          visual.glow.scale.setScalar(hot > 1 ? 0.09 : 0.048 + pulse * 0.014);
        }
      } else {
        mat.opacity = 0.42 * fade * (hot > 1 ? 1.35 : 1);
      }
    }
    for (const id of fading) releaseVisual(id);

    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      const burst = bursts[i];
      if (!burst) continue;
      burst.age += dt;
      const u = Math.min(1, burst.age / burst.life);
      const scale = burst.base + (burst.peak - burst.base) * u;
      burst.obj.scale.setScalar(scale);
      burst.mat.opacity = 1 - u;
      if (u >= 1) {
        burst.obj.visible = false;
        const index = burst.obj.userData.poolIndex as number;
        if (burst.obj instanceof THREE.Sprite) freeFlashes.push(index);
        else freeRings.push(index);
        bursts.splice(i, 1);
      }
    }

    updateArrows();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function updateArrows() {
    const behind: { elig: number; sx: number; sy: number; status: KineticStatus; label: string }[] = [];
    for (const visual of visuals.values()) {
      visual.mesh.getWorldPosition(_world);
      // The camera stays on +Z, so the near hemisphere is world +Z.
      // Far-side points are still in front of the camera plane — test the globe, not the frustum.
      if (_world.z > -0.04) continue;
      behind.push({
        elig: visual.firstSeen,
        sx: _world.x,
        sy: _world.y,
        status: visual.status,
        label: visual.location,
      });
    }
    behind.sort((a, b) => b.elig - a.elig);
    const w = arrowLayer.clientWidth || 1;
    const h = arrowLayer.clientHeight || 1;
    const pad = 18;
    for (let i = 0; i < arrowNodes.length; i += 1) {
      const node = arrowNodes[i];
      const item = behind[i];
      if (!node) continue;
      if (!item) {
        node.hidden = true;
        continue;
      }
      const ax = Math.abs(item.sx);
      const ay = Math.abs(item.sy);
      const max = Math.max(ax, ay, 0.0001);
      const nx = item.sx / max;
      const ny = item.sy / max;
      const px = (nx * 0.5 + 0.5) * (w - pad * 2) + pad;
      const py = (-ny * 0.5 + 0.5) * (h - pad * 2) + pad;
      node.hidden = false;
      node.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%) rotate(${Math.atan2(-ny, nx)}rad)`;
      node.classList.toggle("is-alert", item.status === "corroborated");
      node.title = item.label;
    }
  }

  return {
    focus(lat, lng, onDone) {
      const [x, y, z] = latLngToUnit(lat, lng);
      _from.set(x, y, z).normalize();
      _startQ.copy(globe.quaternion);
      _endQ.setFromUnitVectors(_from, _zAxis);
      focusStart = performance.now();
      const duration = reduce ? 180 : FOCUS_MS;
      focusUntil = focusStart + duration;
      focusCb = onDone ?? null;
      yawVel = 0;
      pitchVel = 0;
      lastInteraction = performance.now();
    },
    setHover(id) {
      hoverId = id;
    },
    sync(events, flashIds) {
      const keep = new Set(events.map((event) => event.id));
      for (const id of [...visuals.keys()]) {
        if (!keep.has(id)) releaseVisual(id);
      }
      for (const event of events) {
        const existed = visuals.has(event.id);
        const prev = visuals.get(event.id)?.status;
        upsertVisual(event);
        const became = prev !== undefined && prev !== "corroborated" && event.status === "corroborated";
        if (flashIds.has(event.id) && (!existed || became)) {
          spawnBurst(event.lat, event.lng, event.status);
        }
      }
      rebuildPickables();
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.dispose();
      earthGeo.dispose();
      earthMat.map?.dispose();
      earthMat.dispose();
      glowTex.dispose();
      starGeo.dispose();
      if (renderer.domElement.parentElement === parent) parent.removeChild(renderer.domElement);
      arrowLayer.replaceChildren();
    },
  };
}
