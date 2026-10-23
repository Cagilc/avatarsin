// Vex 3D · modelo procedural por capas con rig jerárquico.
// Unidades: 1 = 100 px de la hoja 2D. Origen = centro de masa (raíz).
// Nombres de nodos = ids del rig 2D (guiones bajos para glTF).

export function createVex(THREE) {
  const D = THREE.MathUtils.degToRad;

  // ---------- Materiales ----------
  const M = {
    white: new THREE.MeshPhysicalMaterial({ name: 'vx_white', color: 0xF4F8FD, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.18 }),
    trim: new THREE.MeshPhysicalMaterial({ name: 'vx_trim', color: 0xC9D6E8, roughness: 0.45 }),
    blue: new THREE.MeshPhysicalMaterial({ name: 'vx_blue', color: 0x2E7BFF, roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0x0B2A80, emissiveIntensity: 0.35 }),
    fin: new THREE.MeshPhysicalMaterial({ name: 'vx_fin', color: 0x4C95FF, roughness: 0.15, clearcoat: 1, transmission: 0.25, thickness: 0.1, emissive: 0x1C55D8, emissiveIntensity: 0.45 }),
    visor: new THREE.MeshPhysicalMaterial({ name: 'vx_visor', color: 0x060B1F, roughness: 0.06, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 }),
    ring: new THREE.MeshPhysicalMaterial({ name: 'vx_ring_inner', color: 0xDCE8F7, roughness: 0.3, clearcoat: 0.5 }),
    hand: new THREE.MeshPhysicalMaterial({ name: 'vx_hand', color: 0x3B4250, roughness: 0.5, clearcoat: 0.3 }),
    metal: new THREE.MeshPhysicalMaterial({ name: 'vx_metal', color: 0x9FB3CF, roughness: 0.3, metalness: 0.7 }),
    glow: new THREE.MeshBasicMaterial({ name: 'vx_glow', color: new THREE.Color(0x5CE1FF).multiplyScalar(1.6), toneMapped: false }),
    glowWhite: new THREE.MeshBasicMaterial({ name: 'vx_glow_white', color: new THREE.Color(0xE9FBFF).multiplyScalar(1.8), toneMapped: false }),
    pivot: new THREE.MeshBasicMaterial({ name: 'vx_pivot', color: 0xE25CFF, depthTest: false, toneMapped: false })
  };


  // ---------- Texturas procedurales (sustituibles por imágenes: map / roughnessMap / bumpMap) ----------
  function shellTextures(kind) {
    const S = 1024;
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')]; };
    const [cm, m] = mk(), [cr, r] = mk(), [cb, b] = mk();
    // base
    m.fillStyle = '#F4F8FD'; m.fillRect(0, 0, S, S);
    r.fillStyle = '#5A5A5A'; r.fillRect(0, 0, S, S);
    b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
    // grano fino (micro-rayado del plástico)
    let seed = kind === 'head' ? 7 : 13;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 14000; i++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * 0.05;
      m.fillStyle = `rgba(90,120,170,${a})`; m.fillRect(x, y, 2, 2);
      r.fillStyle = `rgba(255,255,255,${rnd() * 0.12})`; r.fillRect(x, y, 3, 3);
    }
    const seam = (y, w, dark) => {
      m.strokeStyle = `rgba(150,170,200,${dark})`; m.lineWidth = w; m.beginPath(); m.moveTo(0, y); m.lineTo(S, y); m.stroke();
      b.strokeStyle = '#3A3A3A'; b.lineWidth = w; b.beginPath(); b.moveTo(0, y); b.lineTo(S, y); b.stroke();
      r.strokeStyle = '#8A8A8A'; r.lineWidth = w + 3; r.beginPath(); r.moveTo(0, y); r.lineTo(S, y); r.stroke();
    };
    const vseam = (x, y0, y1, w) => {
      m.strokeStyle = 'rgba(150,170,200,0.55)'; m.lineWidth = w; m.beginPath(); m.moveTo(x, y0); m.lineTo(x, y1); m.stroke();
      b.strokeStyle = '#3A3A3A'; b.lineWidth = w; b.beginPath(); b.moveTo(x, y0); b.lineTo(x, y1); b.stroke();
    };
    const rivet = (x, y) => { b.fillStyle = '#B0B0B0'; b.beginPath(); b.arc(x, y, 5, 0, 7); b.fill(); b.fillStyle = '#505050'; b.beginPath(); b.arc(x, y, 2.5, 0, 7); b.fill(); m.fillStyle = 'rgba(130,150,185,0.5)'; m.beginPath(); m.arc(x, y, 4, 0, 7); m.fill(); };
    const stripe = (y, h, color) => { m.fillStyle = color; m.fillRect(0, y, S, h); r.fillStyle = '#3C3C3C'; r.fillRect(0, y, S, h); };
    if (kind === 'head') {
      // casco: costura ecuatorial trasera, panel superior, tira azul en la nuca y respiraderos laterales
      seam(S * 0.46, 3, 0.5); seam(S * 0.52, 2, 0.35);
      for (let i = 0; i < 8; i++) vseam(S * (0.52 + i * 0.012), S * 0.30, S * 0.42, 2);
      for (let i = 0; i < 8; i++) vseam(S * (0.40 - i * 0.012), S * 0.30, S * 0.42, 2);
      stripe(S * 0.235, 12, 'rgba(46,123,255,0.85)');
      stripe(S * 0.258, 4, 'rgba(92,225,255,0.9)');
      for (let i = 0; i < 12; i++) rivet(S * (0.05 + i * 0.083), S * 0.49);
      // panel frontal superior (sobre el visor)
      m.strokeStyle = 'rgba(150,170,200,0.35)'; m.lineWidth = 3; m.beginPath(); m.roundRect(S * 0.80, S * 0.12, S * 0.40, S * 0.14, 30); m.stroke();
    } else {
      // torso: cinturón, costuras verticales, placa trasera con tira y remaches, logotipo frontal ligero
      seam(S * 0.57, 4, 0.55); seam(S * 0.60, 2, 0.3);
      vseam(S * 0.25, S * 0.10, S * 0.56, 3); vseam(S * 0.75, S * 0.10, S * 0.56, 3);
      m.strokeStyle = 'rgba(150,170,200,0.45)'; m.lineWidth = 3; m.beginPath(); m.roundRect(S * 0.30, S * 0.16, S * 0.40, S * 0.26, 24); m.stroke();
      b.strokeStyle = '#3A3A3A'; b.lineWidth = 3; b.beginPath(); b.roundRect(S * 0.30, S * 0.16, S * 0.40, S * 0.26, 24); b.stroke();
      stripe(S * 0.30, 10, 'rgba(46,123,255,0.8)'); stripe(S * 0.315, 4, 'rgba(92,225,255,0.85)');
      for (let i = 0; i < 6; i++) { rivet(S * (0.33 + i * 0.068), S * 0.19); rivet(S * (0.33 + i * 0.068), S * 0.40); }
      // sombreado de volumen hacia la base
      const g = m.createLinearGradient(0, S * 0.6, 0, S); g.addColorStop(0, 'rgba(180,200,225,0)'); g.addColorStop(1, 'rgba(180,200,225,0.35)'); m.fillStyle = g; m.fillRect(0, S * 0.6, S, S * 0.4);
    }
    const T = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    return { map: T(cm, true), roughnessMap: T(cr), bumpMap: T(cb) };
  }
  function armTexture() {
    const S = 512; const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    x.fillStyle = '#F4F8FD'; x.fillRect(0, 0, S, S);
    x.strokeStyle = 'rgba(150,170,200,0.5)'; x.lineWidth = 4;
    [0.28, 0.72].forEach((y) => { x.beginPath(); x.moveTo(0, S * y); x.lineTo(S, S * y); x.stroke(); });
    x.fillStyle = 'rgba(46,123,255,0.85)'; x.fillRect(0, S * 0.30, S, 8);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  const headTex = shellTextures('head'), bodyTex = shellTextures('body'), armTex = armTexture();
  M.headShell = new THREE.MeshPhysicalMaterial({ name: 'vx_head_shell', map: headTex.map, roughnessMap: headTex.roughnessMap, bumpMap: headTex.bumpMap, bumpScale: 0.012, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  M.bodyShell = new THREE.MeshPhysicalMaterial({ name: 'vx_body_shell', map: bodyTex.map, roughnessMap: bodyTex.roughnessMap, bumpMap: bodyTex.bumpMap, bumpScale: 0.012, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  M.limb = new THREE.MeshPhysicalMaterial({ name: 'vx_limb', map: armTex, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  // Material del azul con micro-rugosidad metalizada
  M.blue.roughness = 0.3; M.blue.metalness = 0.35;

  // ---------- Utilidades de geometría ----------
  function superSphere(rx, ry, rz, p, seg = 64, opts) {
    const g = opts ? new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75), ...opts) : new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const f = (a) => Math.sign(a) * Math.pow(Math.abs(a), p);
      pos.setXYZ(i, f(v.x) * rx, f(v.y) * ry, f(v.z) * rz);
    }
    g.computeVertexNormals();
    return g;
  }
  function mesh(geo, mat, name) { const m = new THREE.Mesh(geo, mat); if (name) m.name = name; m.castShadow = true; return m; }
  function group(name, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); return g; }
  function capsule(r, len, mat, name) { return mesh(new THREE.CapsuleGeometry(r, len, 12, 32), mat, name); }

  const pivots = [];
  function markPivot(g) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), M.pivot); s.name = g.name + '_pivot'; s.renderOrder = 999; s.visible = false; s.userData.isPivot = true; g.add(s); pivots.push(s); }

  // ---------- Jerarquía ----------
  const root = group('vx_root');
  const hover = group('vx_hover');
  root.add(hover);
  markPivot(root);

  // Propulsor y llama
  const thruster = group('vx_thruster', 0, -0.86, 0);
  hover.add(thruster); markPivot(thruster);
  thruster.add(mesh(new THREE.CylinderGeometry(0.27, 0.17, 0.32, 48), M.metal, 'vx_thruster_body')).position.y = -0.16;
  const tRing = mesh(new THREE.TorusGeometry(0.155, 0.035, 16, 48), M.glow, 'vx_thruster_ring');
  tRing.rotation.x = Math.PI / 2; tRing.position.y = -0.33; thruster.add(tRing);
  const flame = group('vx_flame', 0, -0.34, 0);
  thruster.add(flame); markPivot(flame);
  const flameTex = (() => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 128;
    const x = c.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(233,251,255,1)'); gr.addColorStop(0.3, 'rgba(92,225,255,0.95)'); gr.addColorStop(1, 'rgba(46,123,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 8, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const flameMat = new THREE.MeshBasicMaterial({ name: 'vx_flame', map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, color: new THREE.Color(1.4, 1.4, 1.4) });
  const outer = mesh(new THREE.ConeGeometry(0.15, 0.8, 32, 1, true), flameMat, 'vx_flame_outer');
  outer.rotation.x = Math.PI; outer.position.y = -0.4; outer.castShadow = false; flame.add(outer);
  const inner = mesh(new THREE.ConeGeometry(0.08, 0.45, 24, 1, true), flameMat, 'vx_flame_inner');
  inner.rotation.x = Math.PI; inner.position.y = -0.22; inner.castShadow = false; flame.add(inner);

  // Torso (torno con perfil de huevo)
  const torso = group('vx_torso', 0, -0.84, 0);
  hover.add(torso); markPivot(torso);
  const prof = [[0, -0.11], [0.18, -0.09], [0.36, -0.02], [0.5, 0.1], [0.6, 0.29], [0.63, 0.54], [0.6, 0.79], [0.54, 1.0], [0.44, 1.11], [0.28, 1.17], [0, 1.19]].map((p) => new THREE.Vector2(p[0], p[1]));
  const torsoGeo = new THREE.LatheGeometry(prof, 72); torsoGeo.scale(1, 1, 0.82);
  torso.add(mesh(torsoGeo, M.bodyShell, 'vx_torso_shell'));
  const belt = mesh(new THREE.TorusGeometry(0.49, 0.014, 8, 72), M.trim, 'vx_torso_belt');
  belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.82, 1); belt.position.y = 0.12; torso.add(belt);
  const core = group('vx_core', 0, 0.66, 0.505);
  torso.add(core); markPivot(core);
  core.add(mesh(new THREE.TorusGeometry(0.19, 0.05, 20, 48), M.blue, 'vx_core_ring'));
  core.add(mesh(new THREE.CircleGeometry(0.19, 48), M.ring, 'vx_core_back')).position.z = -0.01;
  const coreLight = mesh(new THREE.SphereGeometry(0.11, 32, 16), M.glow.clone(), 'vx_core_light');
  coreLight.scale.z = 0.45; core.add(coreLight);

  // Brazos
  function makeArm(side) {
    const s = side === 'L' ? -1 : 1;
    const arm = group('vx_arm_' + side, 0.6 * s, 0.1, 0);
    hover.add(arm); markPivot(arm);
    arm.add(mesh(new THREE.SphereGeometry(0.15, 32, 24), M.blue, 'vx_shoulder_' + side));
    const upper = capsule(0.115, 0.3, M.limb, 'vx_upper_' + side); upper.position.y = -0.3; arm.add(upper);
    const elbow = group('vx_elbow_' + side, 0, -0.58, 0);
    arm.add(elbow); markPivot(elbow);
    elbow.add(mesh(new THREE.SphereGeometry(0.105, 32, 24), M.blue, 'vx_elbow_ball_' + side));
    const fore = capsule(0.105, 0.24, M.limb, 'vx_fore_' + side); fore.position.y = -0.24; elbow.add(fore);
    const hand = group('vx_hand_' + side, 0, -0.5, 0);
    elbow.add(hand); markPivot(hand);
    const palm = mesh(new THREE.SphereGeometry(1, 32, 24), M.hand, 'vx_palm_' + side);
    palm.scale.set(0.15, 0.12, 0.13); palm.position.y = -0.06; hand.add(palm);
    [-0.065, 0, 0.065].forEach((fx, i) => { const f = capsule(0.034, 0.07, M.hand, 'vx_finger_' + side + i); f.position.set(fx, -0.17, 0.03); hand.add(f); });
    const thumb = capsule(0.036, 0.06, M.hand, 'vx_thumb_' + side); thumb.position.set(-0.13 * s * -1, -0.08, 0.06); thumb.rotation.z = D(35) * s; hand.add(thumb);
    return { arm, elbow, hand };
  }
  const L = makeArm('L');
  const R = makeArm('R');

  // Lápiz vectorial (mano derecha)
  const pen = group('vx_pen', 0, -0.12, 0.05);
  R.hand.add(pen);
  const penBody = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 24), M.blue, 'vx_pen_body'); penBody.position.y = -0.2; pen.add(penBody);
  const nib = mesh(new THREE.ConeGeometry(0.05, 0.14, 24), M.glowWhite, 'vx_pen_nib'); nib.rotation.x = Math.PI; nib.position.y = -0.58; pen.add(nib);
  pen.rotation.x = D(-60);
  pen.scale.setScalar(0);

  // Panel holográfico (estado trabajando)
  const tabletTex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 320; const x = c.getContext('2d');
    x.fillStyle = 'rgba(92,225,255,0.14)'; x.strokeStyle = 'rgba(92,225,255,0.95)'; x.lineWidth = 6;
    x.beginPath(); x.roundRect(6, 6, 500, 308, 28); x.fill(); x.stroke();
    x.lineCap = 'round'; x.lineWidth = 14;
    [[60, 80, 200], [60, 130, 300], [60, 180, 140]].forEach((l) => { x.beginPath(); x.moveTo(l[0], l[1]); x.lineTo(l[0] + l[2], l[1]); x.stroke(); });
    x.strokeStyle = 'rgba(226,92,255,1)'; x.lineWidth = 10; x.beginPath(); x.moveTo(300, 260); x.lineTo(340, 210); x.lineTo(380, 235); x.lineTo(440, 160); x.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const tablet = mesh(new THREE.PlaneGeometry(0.95, 0.6), new THREE.MeshBasicMaterial({ name: 'vx_tablet', map: tabletTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.6, 1.6) }), 'vx_tablet');
  tablet.castShadow = false; tablet.position.set(0, -0.42, 0.98); tablet.rotation.x = D(-28); tablet.scale.setScalar(0);
  hover.add(tablet);

  // Cabeza
  const head = group('vx_head', 0, 0.38, 0);
  hover.add(head); markPivot(head);
  head.add(mesh(new THREE.SphereGeometry(0.17, 32, 24), M.blue, 'vx_neck'));
  const skull = group('vx_skull', 0, 1.08, 0);
  head.add(skull);
  const helmetGeo = superSphere(1.14, 0.98, 0.96, 0.82); const helmet = mesh(helmetGeo, M.headShell, 'vx_helmet'); helmet.rotation.y = Math.PI; skull.add(helmet);
  // Visor: lámina que sigue la curva del casco, con contorno de rectángulo redondeado (squircle)
  const HR = [1.14, 0.98, 0.96], HP = 0.82, VW = 0.8, VH = 0.55, VC = -0.04;
  function visorPatch(k, ew = 0, eh = 0, rings = 28, segs = 120) {
    const pos = [], uv = [], idx = [];
    const f = (a) => Math.sign(a) * Math.pow(Math.abs(a), HP);
    const push = (u, v) => {
      const ah = u * (VW + ew), av = VC + v * (VH + eh);
      const th = Math.PI / 2 - av;
      const d = [Math.sin(th) * Math.sin(ah), Math.cos(th), Math.sin(th) * Math.cos(ah)];
      pos.push(f(d[0]) * HR[0] * k, f(d[1]) * HR[1] * k, f(d[2]) * HR[2] * k);
      uv.push((u + 1) / 2, (v + 1) / 2);
    };
    push(0, 0);
    for (let r = 1; r <= rings; r++) {
      for (let s2 = 0; s2 < segs; s2++) {
        const a = (s2 / segs) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        const n = 5;
        push((r / rings) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), (r / rings) * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n));
      }
    }
    for (let s2 = 0; s2 < segs; s2++) idx.push(0, 1 + s2, 1 + ((s2 + 1) % segs));
    for (let r = 1; r < rings; r++) {
      const a0 = 1 + (r - 1) * segs, a1 = 1 + r * segs;
      for (let s2 = 0; s2 < segs; s2++) { const s3 = (s2 + 1) % segs; idx.push(a0 + s2, a1 + s2, a1 + s3, a0 + s2, a1 + s3, a0 + s3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const rim = mesh(visorPatch(1.006, 0.045, 0.05), M.trim, 'vx_visor_rim'); skull.add(rim);
  const visor = mesh(visorPatch(1.014), M.visor, 'vx_visor'); skull.add(visor);

  // Orejeras
  ['L', 'R'].forEach((side) => {
    const s = side === 'L' ? -1 : 1;
    const ear = group('vx_ear_' + side, 1.08 * s, -0.03, -0.02);
    skull.add(ear);
    const pod = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 48), M.limb, 'vx_ear_pod_' + side); pod.rotation.z = Math.PI / 2; ear.add(pod);
    const ring = mesh(new THREE.TorusGeometry(0.19, 0.06, 20, 48), M.blue, 'vx_ear_ring_' + side); ring.rotation.y = Math.PI / 2; ring.position.x = 0.14 * s; ear.add(ring);
    const cap = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 48), M.ring, 'vx_ear_cap_' + side); cap.rotation.z = Math.PI / 2; cap.position.x = 0.135 * s; ear.add(cap);
  });

  // Aletas (forma de la hoja 2D extruida)
  const finShape = new THREE.Shape();
  finShape.moveTo(-0.06, -0.08);
  finShape.bezierCurveTo(-0.24, 0.2, -0.38, 0.6, -0.34, 0.96);
  finShape.bezierCurveTo(-0.14, 0.76, 0.08, 0.34, 0.18, 0.02);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 6, curveSegments: 32 });
  finGeo.translate(0, 0, -0.03);
  const finL = group('vx_fin_L', -0.92, 0.36, -0.08); const finR = group('vx_fin_R', 0.92, 0.36, -0.08);
  skull.add(finL); skull.add(finR); markPivot(finL); markPivot(finR);
  finL.add(mesh(finGeo, M.fin, 'vx_fin_mesh_L'));
  // Aleta derecha = espejo; se reordena cada triángulo para que las caras sigan mirando hacia fuera
  const finGeoR = finGeo.clone(); finGeoR.scale(-1, 1, 1);
  (() => { const p = finGeoR.attributes.position; const n = finGeoR.attributes.normal; for (let i = 0; i < p.count; i += 3) { for (const a of [p, n]) { const t = [a.getX(i), a.getY(i), a.getZ(i)]; a.setXYZ(i, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, t[0], t[1], t[2]); } } finGeoR.computeVertexNormals(); })();
  finR.add(mesh(finGeoR, M.fin, 'vx_fin_mesh_R'));

  // ---------- Cara en pantalla: capas de ojos y boca ----------
  const FACE = group('vx_face', 0, 0, 0);
  skull.add(FACE); markPivot(FACE);
  const eyesGeo = visorPatch(1.02), mouthGeo = visorPatch(1.024);
  const CW = 512, CH = 316, EYE_Y = 132, EYE_DX = 92, MX = 256, MY = 222;
  function glowCtx() {
    const c = document.createElement('canvas'); c.width = CW; c.height = CH;
    const x = c.getContext('2d'); x.fillStyle = '#7FF0FF'; x.strokeStyle = '#7FF0FF'; x.shadowColor = '#5CE1FF'; x.shadowBlur = 22; x.lineCap = 'round'; x.lineJoin = 'round';
    return { c, x };
  }
  function arc(x, a, b, c, w) { x.lineWidth = w; x.beginPath(); x.moveTo(a[0], a[1]); x.quadraticCurveTo(b[0], b[1], c[0], c[1]); x.stroke(); }
  function ell(x, cx, cy, rx, ry) { x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); x.fill(); }
  function heart(x, cx, cy, s) { x.beginPath(); x.moveTo(cx, cy + s * 0.9); x.bezierCurveTo(cx - s * 1.4, cy, cx - s * 0.9, cy - s * 1.1, cx, cy - s * 0.45); x.bezierCurveTo(cx + s * 0.9, cy - s * 1.1, cx + s * 1.4, cy, cx, cy + s * 0.9); x.fill(); }
  const EYES = {
    neutral: (x) => { [MX - EYE_DX, MX + EYE_DX].forEach((cx) => ell(x, cx, EYE_Y, 26, 36)); },
    happy: (x) => { [MX - EYE_DX, MX + EYE_DX].forEach((cx) => arc(x, [cx - 30, EYE_Y + 12], [cx, EYE_Y - 30], [cx + 30, EYE_Y + 12], 16)); },
    thinking: (x) => { const l = MX - EYE_DX, r = MX + EYE_DX; arc(x, [l - 28, EYE_Y + 4], [l, EYE_Y - 10], [l + 28, EYE_Y + 4], 15); arc(x, [r - 28, EYE_Y], [r, EYE_Y + 12], [r + 28, EYE_Y], 15); },
    wow: (x) => { [MX - EYE_DX, MX + EYE_DX].forEach((cx) => { ell(x, cx, EYE_Y - 4, 42, 42); }); x.fillStyle = '#F2FEFF'; [MX - EYE_DX, MX + EYE_DX].forEach((cx) => ell(x, cx + 13, EYE_Y - 18, 13, 13)); },
    success: (x) => { const l = MX - EYE_DX; arc(x, [l - 30, EYE_Y + 10], [l, EYE_Y - 26], [l + 30, EYE_Y + 10], 16); heart(x, MX + EYE_DX, EYE_Y, 34); },
    closed: (x) => { [MX - EYE_DX, MX + EYE_DX].forEach((cx) => arc(x, [cx - 28, EYE_Y + 6], [cx, EYE_Y + 12], [cx + 28, EYE_Y + 6], 13)); }
  };
  const MOUTHS = {
    neutral: (x) => arc(x, [MX - 30, MY - 6], [MX, MY + 18], [MX + 30, MY - 6], 12),
    happy: (x) => arc(x, [MX - 42, MY - 14], [MX, MY + 38], [MX + 42, MY - 14], 13),
    thinking: (x) => { x.lineWidth = 11; x.beginPath(); x.moveTo(MX - 34, MY + 4); x.quadraticCurveTo(MX - 17, MY - 10, MX, MY + 4); x.quadraticCurveTo(MX + 17, MY + 18, MX + 34, MY + 4); x.stroke(); },
    wow: (x) => ell(x, MX, MY + 8, 20, 25),
    success: (x) => arc(x, [MX - 38, MY - 10], [MX, MY + 30], [MX + 38, MY - 10], 13),
    X: (x) => arc(x, [MX - 26, MY], [MX, MY + 12], [MX + 26, MY], 10),
    A: (x) => { x.lineWidth = 12; x.beginPath(); x.moveTo(MX - 30, MY + 4); x.lineTo(MX + 30, MY + 4); x.stroke(); },
    B: (x) => { x.beginPath(); x.roundRect(MX - 32, MY - 4, 64, 16, 8); x.fill(); },
    C: (x) => ell(x, MX, MY + 4, 32, 16),
    D: (x) => ell(x, MX, MY + 8, 34, 25),
    E: (x) => ell(x, MX, MY + 8, 23, 23),
    F: (x) => ell(x, MX, MY + 8, 13, 16),
    G: (x) => { x.lineWidth = 12; x.beginPath(); x.moveTo(MX - 30, MY); x.lineTo(MX + 30, MY); x.stroke(); arc(x, [MX - 20, MY + 14], [MX, MY + 24], [MX + 20, MY + 14], 8); },
    H: (x) => { ell(x, MX, MY + 4, 28, 18); x.shadowBlur = 0; x.fillStyle = '#2E7BFF'; x.beginPath(); x.roundRect(MX - 12, MY + 4, 24, 11, 5); x.fill(); }
  };
  function layer(kind, name, draw, geo) {
    const { c, x } = glowCtx(); draw(x);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ name: 'vx_' + kind + '_' + name, map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(1.9, 1.9, 1.9) });
    const m = new THREE.Mesh(geo, mat); m.name = 'vx_' + kind + '_' + name; m.renderOrder = 2; m.scale.setScalar(0);
    FACE.add(m); return m;
  }
  const eyes = {}; Object.keys(EYES).forEach((k) => { eyes[k] = layer('eyes', k, EYES[k], eyesGeo); });
  const mouths = {}; Object.keys(MOUTHS).forEach((k) => { mouths[k] = layer(k.length === 1 ? 'vis' : 'mouth', k, MOUTHS[k], mouthGeo); });
  function setEyes(k) { Object.keys(eyes).forEach((n) => eyes[n].scale.setScalar(n === k ? 1 : 0)); }
  function setMouth(k) { Object.keys(mouths).forEach((n) => mouths[n].scale.setScalar(n === k ? 1 : 0)); }
  setEyes('neutral'); setMouth('neutral');

  // ---------- Poses (grados; z = −ángulo 2D, x negativo = hacia delante) ----------
  const POSES = {
    idle:      { aL: [0, -12], eL: [0, 8], aR: [0, 12], eR: [0, -8], hd: [0, 0], fL: 0, fR: 0, eyes: 'neutral', mouth: 'neutral' },
    listening: { aL: [0, -10], eL: [0, 6], aR: [0, 10], eR: [0, -6], hd: [-5, 6], fL: -12, fR: 12, eyes: 'neutral', mouth: 'neutral' },
    thinking:  { aL: [0, -12], eL: [0, 8], aR: [-45, -12], eR: [-118, 0], hd: [4, -8], fL: 6, fR: -6, eyes: 'thinking', mouth: 'thinking' },
    talking:   { aL: [-18, -16], eL: [-28, 0], aR: [-12, 14], eR: [-22, 0], hd: [0, 3], fL: 0, fR: 0, eyes: 'happy', mouth: 'X' },
    working:   { aL: [-58, 14], eL: [-42, 0], aR: [-58, -14], eR: [-42, 0], hd: [12, 0], fL: 0, fR: 0, eyes: 'neutral', mouth: 'neutral', tablet: 1 },
    greeting:  { aL: [0, -12], eL: [0, 8], aR: [-10, 128], eR: [0, 18], hd: [0, 5], fL: -4, fR: 4, eyes: 'happy', mouth: 'happy' },
    creative:  { aL: [0, -14], eL: [0, 10], aR: [-20, 96], eR: [0, 30], hd: [0, 4], fL: 0, fR: 0, eyes: 'happy', mouth: 'happy', pen: 1 },
    success:   { aL: [0, -122], eL: [0, -14], aR: [0, 122], eR: [0, 14], hd: [-6, 0], fL: -8, fR: 8, eyes: 'success', mouth: 'success' }
  };
  const J = { aL: L.arm, eL: L.elbow, aR: R.arm, eR: R.elbow, hd: head };
  const cur = {}; Object.keys(J).forEach((k) => { cur[k] = [0, 0]; }); cur.fL = 0; cur.fR = 0; cur.tablet = 0; cur.pen = 0;
  let target = POSES.idle; let poseName = 'idle';
  function setPose(name, instant) {
    target = POSES[name] || POSES.idle; poseName = name;
    if (instant) { Object.keys(J).forEach((k) => { cur[k] = target[k].slice(); }); cur.fL = target.fL; cur.fR = target.fR; cur.tablet = target.tablet || 0; cur.pen = target.pen || 0; }
  }
  function applyJoints(extra) {
    Object.keys(J).forEach((k) => { const v = cur[k]; const e = (extra && extra[k]) || [0, 0]; J[k].rotation.set(D(v[0] + e[0]), 0, D(v[1] + e[1])); });
  }

  // ---------- Animación en tiempo real ----------
  const TAU = Math.PI * 2;
  function update(dt, t, extra) {
    const k = 1 - Math.exp(-dt * 10);
    Object.keys(J).forEach((n) => { cur[n][0] += (target[n][0] - cur[n][0]) * k; cur[n][1] += (target[n][1] - cur[n][1]) * k; });
    cur.fL += (target.fL - cur.fL) * k; cur.fR += (target.fR - cur.fR) * k;
    cur.tablet += ((target.tablet || 0) - cur.tablet) * k; cur.pen += ((target.pen || 0) - cur.pen) * k;
    const ex = {};
    if (poseName === 'greeting') ex.eR = [0, Math.sin(t * 9) * 22];
    if (poseName === 'talking') { ex.aL = [Math.sin(t * 3) * 6, 0]; ex.aR = [Math.sin(t * 3 + 1) * 5, 0]; ex.hd = [Math.sin(t * 4) * 2, 0]; }
    if (poseName === 'thinking') ex.hd = [0, Math.sin(t * 1.5) * 2];
    applyJoints(Object.assign(ex, extra || {}));
    hover.position.y = Math.sin(t * TAU / 2.4) * 0.06;
    const sway = Math.sin(t * TAU / 3) * 5;
    finL.rotation.z = D(cur.fL + sway); finR.rotation.z = D(cur.fR - sway);
    flame.scale.set(0.96 + Math.sin(t * 31) * 0.04, 1 + Math.sin(t * 17) * 0.12 + Math.sin(t * 29) * 0.06, 0.96 + Math.sin(t * 27) * 0.04);
    const pulse = 0.75 + 0.25 * Math.sin(t * TAU / 1.8);
    coreLight.material.color.setRGB(0.36 * 1.7 * pulse, 0.88 * 1.7 * pulse, 1.7 * pulse);
    tablet.scale.setScalar(Math.max(0, cur.tablet)); pen.scale.setScalar(Math.max(0, cur.pen));
    if (cur.tablet > 0.01) tablet.position.y = -0.42 + Math.sin(t * 2) * 0.015;
  }

  // ---------- Clips de animación para glTF ----------
  function buildClips() {
    const clips = [];
    const q = (x, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(D(x), 0, D(z))).toArray();
    const qTrack = (node, times, eulers) => new THREE.QuaternionKeyframeTrack(node.name + '.quaternion', times, eulers.flatMap((e) => q(e[0], e[1])));
    const sTrack = (node, times, vals) => new THREE.VectorKeyframeTrack(node.name + '.scale', times, vals.flatMap((v) => [v, v, v]), THREE.InterpolateDiscrete);
    const faceTracks = (times, eyeSeq, mouthSeq) => {
      const out = [];
      Object.keys(eyes).forEach((n) => out.push(sTrack(eyes[n], times, eyeSeq.map((e) => (e === n ? 1 : 0)))));
      Object.keys(mouths).forEach((n) => out.push(sTrack(mouths[n], times, mouthSeq.map((m) => (m === n ? 1 : 0)))));
      return out;
    };
    const poseTracks = (p, T, extraFn) => {
      const times = []; const N = 24; for (let i = 0; i <= N; i++) times.push((T * i) / N);
      const tr = [];
      Object.keys(J).forEach((n) => tr.push(qTrack(J[n], times, times.map((t) => { const e = extraFn ? (extraFn(n, t) || [0, 0]) : [0, 0]; return [p[n][0] + e[0], p[n][1] + e[1]]; }))));
      tr.push(qTrack(finL, times, times.map((t) => [0, p.fL + Math.sin((t * TAU) / T) * 5])));
      tr.push(qTrack(finR, times, times.map((t) => [0, p.fR - Math.sin((t * TAU) / T) * 5])));
      tr.push(new THREE.VectorKeyframeTrack(hover.name + '.position', times, times.flatMap((t) => [0, Math.sin((t * TAU) / T) * 0.06, 0])));
      tr.push(sTrack(tablet, [0], [p.tablet || 0])); tr.push(sTrack(pen, [0], [p.pen || 0]));
      return tr;
    };
    // Idle con parpadeo
    const idleT = 2.4;
    clips.push(new THREE.AnimationClip('Idle', idleT, [...poseTracks(POSES.idle, idleT), ...faceTracks([0, 1.9, 2.02], ['neutral', 'closed', 'neutral'], ['neutral', 'neutral', 'neutral'])]));
    // Estados que se mantienen
    [['Listening', 'listening'], ['Thinking', 'thinking'], ['Working', 'working'], ['Creative', 'creative'], ['Success', 'success']].forEach(([clipName, p]) => {
      const T = 2.4; const P = POSES[p];
      clips.push(new THREE.AnimationClip(clipName, T, [...poseTracks(P, T), ...faceTracks([0], [P.eyes], [P.mouth])]));
    });
    // Saludo: codo derecho oscilando
    clips.push(new THREE.AnimationClip('Greeting', 2.4, [...poseTracks(POSES.greeting, 2.4, (n, t) => (n === 'eR' ? [0, Math.sin(t * 9) * 22] : null)), ...faceTracks([0], ['happy'], ['happy'])]));
    // Hablar: secuencia de visemas cada 100 ms
    const seq = ['X', 'B', 'E', 'H', 'D', 'X', 'B', 'C', 'A', 'G', 'C', 'B', 'D', 'F', 'X'];
    const times = seq.map((_, i) => i * 0.1);
    clips.push(new THREE.AnimationClip('Talking', seq.length * 0.1, [...poseTracks(POSES.talking, seq.length * 0.1), ...faceTracks(times, seq.map(() => 'happy'), seq)]));
    return clips;
  }

  setPose('idle', true); applyJoints();
  return { root, hover, head, eyes, mouths, materials: M, setEyes, setMouth, setPose, update, buildClips, pivots, POSES, getPose: () => poseName };
}
