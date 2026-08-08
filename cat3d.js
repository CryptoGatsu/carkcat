/* cark, in three dimensions
 *
 * The logo is a white line around a black shape. In 3D that is an inverted hull:
 * every part is drawn twice, once flat black, once slightly larger with the
 * faces flipped so only the rim shows. A third transparent shell fakes the chalk
 * bloom without needing a post processing pass.
 *
 * Outline weight is computed from each part's radius rather than a flat scale
 * multiplier, so a whisker and a torso get the same line thickness on screen.
 *
 * three r128. no OrbitControls, no CapsuleGeometry, both unavailable at this
 * version, so rotation is hand rolled and every part is built from primitives.
 */
window.CarkCat = (function () {
  "use strict";

  var CHALK = 0xf2f0ec, BLUSH = 0xf2a7c3;
  var LINE = 0.032;            // outline thickness in world units

  var mat = {
    fill:    new THREE.MeshBasicMaterial({ color: 0x000000 }),
    outline: new THREE.MeshBasicMaterial({ color: CHALK, side: THREE.BackSide }),
    halo:    new THREE.MeshBasicMaterial({
               color: CHALK, side: THREE.BackSide, transparent: true,
               opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }),
    solid:   new THREE.MeshBasicMaterial({ color: CHALK }),
    blush:   new THREE.MeshBasicMaterial({ color: BLUSH, transparent: true, opacity: 0.92 }),
    blushGlow: new THREE.MeshBasicMaterial({
               color: BLUSH, transparent: true, opacity: 0.22,
               blending: THREE.AdditiveBlending, depthWrite: false })
  };

  /* radius drives the rim scale so line weight stays even across every part.
     radial:true scales only x/z, for cylinders that would otherwise grow long. */
  function part(geo, radius, opt) {
    opt = opt || {};
    var g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat.fill));

    var k = 1 + LINE / radius;
    var line = new THREE.Mesh(geo, mat.outline);
    if (opt.radial) line.scale.set(k, 1 + LINE / (opt.half || radius), k);
    else line.scale.setScalar(k);
    g.add(line);

    if (opt.halo !== false) {
      var k2 = 1 + (LINE * 3.2) / radius;
      var h = new THREE.Mesh(geo, mat.halo);
      if (opt.radial) h.scale.set(k2, 1 + (LINE * 3.2) / (opt.half || radius), k2);
      else h.scale.setScalar(k2);
      g.add(h);
    }
    return g;
  }

  var scene, camera, renderer, cat, head, ears = [], tailBones = [], cheeks = [],
      toy, bowl, container, raf = null, clock, visible = true;

  var state = "idle", stateUntil = 0, spin = 0, spinTarget = 0,
      dragging = false, lastX = 0, dragged = false, nextGlance = 3, glance = 0;

  /* where the cursor is, relative to the middle of the canvas. clamped so a
     pointer way off across the page still only turns the head so far. */
  var look = { x: 0, y: 0, live: false, at: 0 };

  /* growth. a bigger cark is literally bigger, and a sad one is smaller than
     it should be, which is more legible than any colour change. */
  var grow = { target: 1, now: 1, feel: "fine", droop: 0, droopTarget: 0 };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* body language per place. at the window cark is settled, at the park it is
     wound up and scanning, in its own head it barely moves. */
  var TEMPER = {
    window: { breath: 1.4,  tail: 1.4, tailAmp: 0.055, glanceGap: 4.5, glanceArc: 0.7, ear: 0.97,
              track: 1,    ease: 0.09 },
    park:   { breath: 2.3,  tail: 3.1, tailAmp: 0.12,  glanceGap: 1.3, glanceArc: 1.15, ear: 0.9,
              track: 1.15, ease: 0.17 },   // snaps to movement, it is wound up
    mind:   { breath: 0.85, tail: 0.5, tailAmp: 0.03,  glanceGap: 7.5, glanceArc: 0.35, ear: 0.99,
              track: 0.35, ease: 0.025 }   // barely registers you
  };
  function temper() { return TEMPER[activeScene] || TEMPER.window; }

  function buildCat() {
    cat = new THREE.Group();

    /* ---- body. deliberately smaller than the head, the logo is head heavy --- */
    var body = part(new THREE.SphereGeometry(0.55, 18, 14), 0.55);
    body.scale.set(1, 0.98, 0.86);
    body.position.y = -0.5;
    cat.add(body);

    /* haunches give the sitting silhouette */
    [-1, 1].forEach(function (s) {
      var h = part(new THREE.SphereGeometry(0.26, 12, 10), 0.26, { halo: false });
      h.position.set(s * 0.4, -0.68, 0.02);
      h.scale.set(0.85, 0.95, 1.05);
      cat.add(h);
    });

    /* ---- front legs, short and close together ---- */
    [-0.19, 0.19].forEach(function (x) {
      var leg = part(new THREE.CylinderGeometry(0.105, 0.115, 0.4, 10), 0.11,
                     { radial: true, half: 0.2, halo: false });
      leg.position.set(x, -0.8, 0.31);
      cat.add(leg);
      var paw = part(new THREE.SphereGeometry(0.13, 10, 8), 0.13, { halo: false });
      paw.position.set(x, -0.99, 0.37);
      paw.scale.set(1, 0.72, 1.25);
      cat.add(paw);
    });

    /* ---- tail: rooted behind the hip and swept out to one side ----
       Rooted at center it hangs straight down the front of the body, which is
       both wrong for a cat and a shape nobody wants on a website. */
    var parent = cat, root = new THREE.Group();
    root.position.set(0.44, -0.72, -0.34);
    root.rotation.z = -1.05;
    root.rotation.x = 0.35;
    cat.add(root);
    parent = root;

    for (var i = 0; i < 6; i++) {
      var r = 0.105 - i * 0.012;
      var seg = new THREE.Group();
      seg.position.y = i === 0 ? 0 : 0.26;
      seg.rotation.z = i === 0 ? 0 : 0.3;      // the curl
      var piece = part(new THREE.CylinderGeometry(r, r * 1.05, 0.28, 8), r,
                       { radial: true, half: 0.14, halo: false });
      piece.position.y = 0.14;
      seg.add(piece);
      parent.add(seg);
      tailBones.push(seg);
      parent = seg;
    }
    var tip = part(new THREE.SphereGeometry(0.036, 8, 6), 0.036, { halo: false });
    tip.position.y = 0.28;
    parent.add(tip);

    /* ---- head ---- */
    head = new THREE.Group();
    head.position.y = 0.52;
    cat.add(head);

    var skull = part(new THREE.SphereGeometry(0.72, 22, 16), 0.72);
    skull.scale.set(1, 0.96, 0.82);
    head.add(skull);

    /* ears: flattened front to back so they read as the logo's triangles */
    [-1, 1].forEach(function (s) {
      var pivot = new THREE.Group();
      var ear = part(new THREE.ConeGeometry(0.29, 0.5, 6), 0.29);
      ear.scale.set(1, 1, 0.62);
      pivot.add(ear);
      pivot.position.set(s * 0.41, 0.56, -0.02);
      pivot.rotation.z = s * -0.3;
      head.add(pivot);
      ears.push(pivot);
    });

    /* nose: filled white in the logo, apex pointing down */
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.12, 3), mat.solid);
    nose.position.set(0, 0.0, 0.58);
    nose.rotation.x = Math.PI / 2;
    nose.rotation.y = Math.PI;
    nose.scale.set(1, 1, 0.55);
    head.add(nose);

    /* the w mouth. two arcs under the nose, the single biggest recognizability
       cue in the logo and the thing the first pass was missing entirely. */
    [-1, 1].forEach(function (s) {
      var arc = new THREE.Mesh(
        new THREE.TorusGeometry(0.115, 0.019, 6, 14, Math.PI), mat.solid);
      arc.position.set(s * 0.115, -0.19, 0.55);
      arc.rotation.z = Math.PI;
      arc.scale.set(1, 0.8, 1);
      head.add(arc);
    });
    var bridge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.11, 6), mat.solid);
    bridge.position.set(0, -0.11, 0.57);
    head.add(bridge);

    /* cheeks, the only color in the scene */
    [-1, 1].forEach(function (s) {
      var c = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 12), mat.blush);
      c.position.set(s * 0.36, 0.02, 0.5);
      c.scale.set(1, 0.95, 0.3);
      head.add(c);
      cheeks.push(c);

      var g = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 12), mat.blushGlow);
      g.position.copy(c.position);
      g.scale.set(1.7, 1.6, 0.3);
      head.add(g);
    });

    /* whiskers, three a side, fanned and crossing the outline like the logo */
    [-1, 1].forEach(function (s) {
      [0.1, -0.02, -0.14].forEach(function (y, i) {
        var w = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0125, 0.007, 0.8, 5), mat.solid);
        w.position.set(s * 0.68, y, 0.3);
        w.rotation.z = Math.PI / 2 + s * (0.2 - i * 0.19);
        w.rotation.y = s * 0.35;
        head.add(w);
      });
    });

    scene.add(cat);
  }

  /* ---------------------------------------------------------------- scenes
   * Backgrounds are drawn as flat white bars and arcs rather than outlined
   * solids. At this distance an inverted hull reads as a fat smudge, while a
   * solid thin bar reads as a chalk stroke, which is what these are.
   * Sparse on purpose. The page is mostly empty and the pen should be too.
   */
  var scenes = {}, sceneName = "window", drifters = [];

  function bar(w, h, d) {
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat.solid);
  }

  function bird(scale) {
    var g = new THREE.Group();
    [-1, 1].forEach(function (s) {
      var wing = new THREE.Mesh(
        new THREE.TorusGeometry(0.16, 0.016, 5, 10, Math.PI * 0.8), mat.solid);
      wing.position.x = s * 0.14;
      wing.rotation.z = Math.PI + s * 0.35;
      g.add(wing);
    });
    g.scale.setScalar(scale || 1);
    return g;
  }

  function drift(obj, fn) { drifters.push({ obj: obj, fn: fn }); }

  function buildScenes() {
    var T = 0.028;   // stroke thickness for all background linework

    /* ---- by the window ---- */
    var win = new THREE.Group();
    var fw = 3.2, fh = 2.5, fz = -2.6;
    win.add(Object.assign(bar(fw, T, T), { position: new THREE.Vector3(0, fh / 2, fz) }));
    win.add(Object.assign(bar(fw, T, T), { position: new THREE.Vector3(0, -fh / 2, fz) }));
    win.add(Object.assign(bar(T, fh, T), { position: new THREE.Vector3(-fw / 2, 0, fz) }));
    win.add(Object.assign(bar(T, fh, T), { position: new THREE.Vector3(fw / 2, 0, fz) }));
    win.add(Object.assign(bar(T, fh, T), { position: new THREE.Vector3(0, 0, fz) }));
    win.add(Object.assign(bar(fw, T, T), { position: new THREE.Vector3(0, 0.15, fz) }));
    /* sill, sitting nearer the camera so the cat reads as in front of the glass */
    win.add(Object.assign(bar(fw + 0.5, T * 1.6, 0.24),
            { position: new THREE.Vector3(0, -fh / 2 - 0.16, fz + 0.3) }));

    var b1 = bird(0.9);
    b1.position.set(-0.9, 0.85, fz - 0.5);
    win.add(b1);
    drift(b1, function (t) {
      b1.position.x = -0.9 + Math.sin(t * 0.28) * 0.55;
      b1.position.y = 0.85 + Math.sin(t * 0.45) * 0.13;
    });
    scenes.window = win;

    /* ---- in the mind: things cark thinks about, adrift and unresolved ---- */
    var mind = new THREE.Group();

    var boxThing = part(new THREE.BoxGeometry(0.62, 0.5, 0.62), 0.31, { halo: false });
    boxThing.position.set(-1.5, 0.75, -2.9);
    mind.add(boxThing);
    drift(boxThing, function (t) {
      boxThing.rotation.y = t * 0.22;
      boxThing.rotation.x = Math.sin(t * 0.31) * 0.3;
      boxThing.position.y = 0.75 + Math.sin(t * 0.4) * 0.18;
    });

    var fish = new THREE.Group();
    var fbody = part(new THREE.SphereGeometry(0.2, 10, 8), 0.2, { halo: false });
    fbody.scale.set(1.5, 0.85, 0.6);
    var ftail = part(new THREE.ConeGeometry(0.15, 0.24, 4), 0.15, { halo: false });
    ftail.position.x = -0.36;
    ftail.rotation.z = Math.PI / 2;
    fish.add(fbody, ftail);
    fish.position.set(1.5, -0.35, -2.6);
    mind.add(fish);
    drift(fish, function (t) {
      fish.position.x = 1.4 + Math.sin(t * 0.24) * 0.45;
      fish.position.y = -0.35 + Math.sin(t * 0.37) * 0.22;
      fish.rotation.z = Math.sin(t * 0.37) * 0.18;
      fish.rotation.y = Math.sin(t * 0.24) * 0.4;
    });

    /* the window turns up in here too, because of course it does */
    var ghost = new THREE.Group();
    var gw = 1.05, gh = 0.85;
    [[0, gh / 2, gw, T], [0, -gh / 2, gw, T], [-gw / 2, 0, T, gh], [gw / 2, 0, T, gh]]
      .forEach(function (v) {
        ghost.add(Object.assign(bar(v[2], v[3], T),
          { position: new THREE.Vector3(v[0], v[1], 0) }));
      });
    ghost.position.set(0.35, 1.0, -3.4);
    mind.add(ghost);
    drift(ghost, function (t) {
      ghost.rotation.y = Math.sin(t * 0.19) * 0.6;
      ghost.rotation.z = Math.sin(t * 0.13) * 0.12;
    });

    /* loose dust, the only thing in here with no shape at all */
    for (var i = 0; i < 22; i++) {
      var d = new THREE.Mesh(new THREE.SphereGeometry(0.022, 5, 4), mat.solid);
      d.material = new THREE.MeshBasicMaterial({
        color: CHALK, transparent: true, opacity: 0.18 + Math.random() * 0.3 });
      d.position.set((Math.random() - 0.5) * 5.5, (Math.random() - 0.5) * 3.4,
                     -1.8 - Math.random() * 2.4);
      mind.add(d);
      (function (dot, seed) {
        drift(dot, function (t) { dot.position.y += Math.sin(t * 0.5 + seed) * 0.0012; });
      })(d, i);
    }
    scenes.mind = mind;

    /* ---- at the park. cark has never been outside, so this is a guess ---- */
    var park = new THREE.Group();
    park.add(Object.assign(bar(9, T, T), { position: new THREE.Vector3(0, -1.32, -2.2) }));

    var trunk = part(new THREE.CylinderGeometry(0.1, 0.14, 1.5, 8), 0.12,
                     { radial: true, half: 0.75, halo: false });
    trunk.position.set(-2.05, -0.6, -3.1);
    park.add(trunk);
    var canopy = part(new THREE.SphereGeometry(0.78, 12, 9), 0.78, { halo: false });
    canopy.position.set(-2.05, 0.5, -3.1);
    canopy.scale.set(1, 0.82, 0.8);
    park.add(canopy);
    drift(canopy, function (t) { canopy.rotation.z = Math.sin(t * 0.5) * 0.022; });

    [[2.15, -3.0, 0.42], [2.85, -3.4, 0.3]].forEach(function (v) {
      var bush = part(new THREE.SphereGeometry(v[2], 10, 8), v[2], { halo: false });
      bush.position.set(v[0], -1.32 + v[2] * 0.55, v[1]);
      bush.scale.set(1.3, 0.8, 1);
      park.add(bush);
    });

    [[0.5, 1.25, -3.8, 0.62], [1.15, 1.5, -4.1, 0.45]].forEach(function (v, i) {
      var bb = bird(v[3]);
      bb.position.set(v[0], v[1], v[2]);
      park.add(bb);
      drift(bb, function (t) {
        bb.position.x = v[0] + Math.sin(t * 0.2 + i * 2) * 0.8;
        bb.position.y = v[1] + Math.sin(t * 0.35 + i) * 0.12;
      });
    });
    scenes.park = park;

    for (var k in scenes) {
      scenes[k].visible = (k === sceneName);
      scene.add(scenes[k]);
    }
  }

  function buildProps() {
    toy = new THREE.Group();
    var core = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat.solid);
    var aura = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshBasicMaterial({ color: CHALK, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.scale.setScalar(2.6);
    toy.add(core, aura);
    toy.visible = false;
    scene.add(toy);

    bowl = new THREE.Group();
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.026, 6, 22), mat.solid);
    rim.rotation.x = Math.PI / 2;
    var basin = part(new THREE.SphereGeometry(0.32, 16, 10, 0, Math.PI * 2,
                     Math.PI * 0.54, Math.PI * 0.46), 0.32, { halo: false });
    bowl.add(rim, basin);
    bowl.position.set(0, -1.12, 0.78);
    bowl.scale.setScalar(0.001);
    bowl.visible = false;
    scene.add(bowl);
  }


  /* ---------------------------------------------------------------- scenes
     Line work only, sitting behind the cat at low opacity so it reads as a
     backdrop rather than competing with it. Same chalk white, no new colors. */

  var scenes = {}, activeScene = "window";

  function strokeMat(op) {
    return new THREE.LineBasicMaterial({ color: CHALK, transparent: true, opacity: op });
  }

  function poly(pts, op, close) {
    var v = pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2] || 0); });
    if (close) v.push(v[0].clone());
    var g = new THREE.BufferGeometry().setFromPoints(v);
    return new THREE.Line(g, strokeMat(op));
  }

  function ring(r, op, seg) {
    var pts = [];
    seg = seg || 40;
    for (var i = 0; i <= seg; i++) {
      var a = (i / seg) * Math.PI * 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return poly(pts, op);
  }

  function buildScenes() {
    /* ---- inside, by the window ---- */
    var w = new THREE.Group();
    w.add(poly([[-1.45, 1.85], [1.45, 1.85], [1.45, -0.55], [-1.45, -0.55]], 0.3, true));
    w.add(poly([[0, 1.85], [0, -0.55]], 0.22));
    w.add(poly([[-1.45, 0.65], [1.45, 0.65]], 0.22));
    w.add(poly([[-1.75, -0.62], [1.75, -0.62]], 0.28));           // sill
    w.add(poly([[-2.6, -1.5], [2.6, -1.5]], 0.16));               // floor
    /* a bird out there, forever */
    var bird = new THREE.Group();
    bird.add(poly([[-0.12, 0], [0, 0.09], [0.12, 0]], 0.34));
    bird.position.set(0.82, 1.28, 0);
    w.add(bird);
    w.userData.bird = bird;
    w.position.z = -2.2;
    scenes.window = w;

    /* ---- outside, at the park ---- */
    var p = new THREE.Group();
    p.add(poly([[-3.2, -1.5], [3.2, -1.5]], 0.28));               // ground
    p.add(poly([[-3.2, -0.72], [-1.9, -0.34], [-0.5, -0.68], [0.9, -0.3], [2.3, -0.66], [3.2, -0.4]], 0.13));
    var tree = new THREE.Group();
    tree.add(poly([[-0.11, -1.5], [-0.08, -0.35], [0.08, -0.35], [0.11, -1.5]], 0.26));
    tree.add(poly([[-0.08, -0.5], [-0.42, -0.18]], 0.2));
    tree.add(poly([[0.08, -0.42], [0.4, -0.05]], 0.2));
    var canopy = ring(0.62, 0.26, 26);
    canopy.position.y = 0.35;
    canopy.scale.set(1.25, 0.85, 1);
    tree.add(canopy);
    tree.position.set(-2.1, 0, 0);
    p.add(tree);
    var sun = ring(0.34, 0.18, 30);
    sun.position.set(2.2, 1.5, 0);
    p.add(sun);
    for (var i = 0; i < 11; i++) {
      var x = -3 + i * 0.58 + Math.random() * 0.2;
      p.add(poly([[x, -1.5], [x + 0.05, -1.32], [x + 0.11, -1.5]], 0.13));
    }
    p.position.z = -2.4;
    scenes.park = p;

    /* ---- in the mind of cark ---- */
    var m = new THREE.Group();
    var drifters = [];
    for (var j = 0; j < 7; j++) {
      var r2 = 0.28 + Math.random() * 0.85;
      var o = ring(r2, 0.07 + Math.random() * 0.09, 24);
      o.position.set((Math.random() - 0.5) * 5.2, (Math.random() - 0.5) * 3.6,
                     -1.2 - Math.random() * 2.4);
      o.rotation.z = Math.random() * Math.PI;
      o.userData.spin = (Math.random() - 0.5) * 0.22;
      o.userData.bob = Math.random() * 6.28;
      m.add(o);
      drifters.push(o);
    }
    /* fragments of the other two rooms, half remembered */
    var ghostWindow = poly([[-0.7, 0.95], [0.7, 0.95], [0.7, -0.35], [-0.7, -0.35]], 0.09, true);
    ghostWindow.position.set(-1.9, 0.5, -2.6);
    ghostWindow.rotation.y = 0.5;
    m.add(ghostWindow); drifters.push(ghostWindow);
    ghostWindow.userData.spin = 0.05; ghostWindow.userData.bob = 2;

    for (var k = 0; k < 26; k++) {
      var d = poly([[0, 0], [0.001, 0.001]], 0.3);
      d.position.set((Math.random() - 0.5) * 6.4, (Math.random() - 0.5) * 4.4, -0.8 - Math.random() * 3);
      m.add(d);
    }
    var horizon = poly([[-3.4, -1.35], [3.4, -1.35]], 0.1);
    horizon.position.z = -2.8;
    m.add(horizon);
    m.userData.drifters = drifters;
    scenes.mind = m;

    for (var name in scenes) {
      scenes[name].visible = name === activeScene;
      scene.add(scenes[name]);
    }
  }

  function animateScene(t) {
    var w = scenes.window;
    if (w && w.visible && w.userData.bird) {
      var b = w.userData.bird;
      b.position.x = 0.6 + Math.sin(t * 0.35) * 0.75;
      b.position.y = 1.28 + Math.sin(t * 0.9) * 0.12;
    }
    var m = scenes.mind;
    if (m && m.visible) {
      m.userData.drifters.forEach(function (o, i) {
        o.rotation.z += o.userData.spin * 0.01;
        o.position.y += Math.sin(t * 0.4 + o.userData.bob) * 0.0012;
        o.material.opacity = 0.06 + Math.abs(Math.sin(t * 0.25 + i)) * 0.09;
      });
    }
  }

  function resize() {
    if (!container) return;
    var w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setState(name, seconds) {
    state = name;
    stateUntil = clock.getElapsedTime() + (seconds || 0);
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible) return;

    var t = clock.getElapsedTime();
    if (stateUntil && t > stateUntil && state !== "sleep") { state = "idle"; stateUntil = 0; }

    for (var d = 0; d < drifters.length; d++) {
      if (drifters[d].obj.parent && drifters[d].obj.parent.visible) drifters[d].fn(t);
    }

    animateScene(t);

    var tp = temper();
    var breath = Math.sin(t * tp.breath) * 0.011;

    grow.now += (grow.target - grow.now) * 0.04;
    grow.droop += (grow.droopTarget - grow.droop) * 0.05;
    var g = grow.now;
    cat.scale.set(g * (1 + breath), g * (1 - breath), g * (1 + breath));

    /* sad: ears down, head lowered, tail tucked, cheeks dim */
    if (grow.droop > 0.01) {
      head.position.y = 0.52 - grow.droop * 0.14;
      ears.forEach(function (e, i) {
        e.rotation.x = 0.55 * grow.droop;
        e.rotation.z = (i === 0 ? 1 : -1) * -0.3 * (1 - grow.droop * 0.45);
      });
    }

    /* tail: slower and wider at the base, the curl holds its shape */
    for (var i = 0; i < tailBones.length; i++) {
      var speed = state === "play" ? 4.6 : state === "sleep" ? 0.6 : tp.tail;
      var amp = state === "play" ? 0.13 : state === "sleep" ? 0.02 : tp.tailAmp;
      var base = i === 0 ? 0 : 0.3;
      tailBones[i].rotation.z = base + Math.sin(t * speed - i * 0.5) * amp;
      tailBones[i].rotation.x = Math.sin(t * speed * 0.7 - i * 0.4) * amp * 0.6;
    }

    /* ears twitch on their own, which is most of what sells it as alive */
    ears.forEach(function (e, i) {
      var s = i === 0 ? -1 : 1;
      var tw = Math.max(0, Math.sin(t * 0.7 + i * 2.3) - tp.ear) * 12;
      e.rotation.z = s * -0.3 - s * tw * 0.25;
      e.rotation.x = state === "sleep" ? 0.4 : -tw * 0.1;
    });

    var want = (state === "purr" || state === "eat") ? 1
             : grow.feel === "happy" ? 1
             : grow.feel === "sad" ? 0.45 : 0.92;
    cheeks.forEach(function (c) { c.material.opacity += (want - c.material.opacity) * 0.08; });

    if (state === "idle") {
      /* follow the cursor while it is moving, drift back to looking around
         on its own once you stop or leave */
      var watching = look.live && (performance.now() - look.at) < 3500;

      if (watching) {
        var yaw   = clamp(look.x * 0.62 * tp.track, -0.62, 0.62);
        var pitch = clamp(look.y * 0.3 * tp.track, -0.3, 0.3);
        head.rotation.y += (yaw - head.rotation.y) * tp.ease;
        head.rotation.x += (pitch - head.rotation.x) * tp.ease;
        nextGlance = t + tp.glanceGap;      // no need to invent something to look at
      } else {
        if (t > nextGlance) {
          glance = (Math.random() - 0.5) * tp.glanceArc;
          nextGlance = t + tp.glanceGap * (0.6 + Math.random() * 0.9);
        }
        head.rotation.y += (glance - head.rotation.y) * 0.03;
        head.rotation.x += (Math.sin(t * 0.6) * 0.04 - head.rotation.x) * 0.05;
      }
    } else {
      head.rotation.x *= 0.9;
      head.rotation.y *= 0.9;
    }
    cat.position.y += (0 - cat.position.y) * 0.12;

    if (state === "purr") {
      cat.position.x = Math.sin(t * 40) * 0.011;
      head.rotation.z = Math.sin(t * 40) * 0.018;
    } else {
      cat.position.x *= 0.85;
      head.rotation.z *= 0.85;
    }

    if (state === "eat") {
      head.rotation.x = 0.5 + Math.sin(t * 7) * 0.13;
      bowl.scale.setScalar(Math.min(1, bowl.scale.x + 0.09));
    } else if (bowl.visible) {
      bowl.scale.setScalar(bowl.scale.x * 0.86);
      if (bowl.scale.x < 0.02) bowl.visible = false;
    }

    if (state === "play") {
      var a = t * 2.0;
      toy.position.set(Math.cos(a) * 1.3, 0.5 + Math.sin(a * 1.7) * 0.45, 0.9 + Math.sin(a) * 0.3);
      head.rotation.y = Math.atan2(toy.position.x, 1.7) * 0.75;
      head.rotation.x = -Math.atan2(toy.position.y - 0.6, 1.7) * 0.55;
    }

    if (state === "levelup") {
      var lu = 1 - Math.max(0, (stateUntil - t) / 2.2);
      cat.position.y = Math.abs(Math.sin(lu * Math.PI * 3)) * 0.45 * (1 - lu);
      cat.rotation.y = spin + Math.sin(lu * Math.PI * 2) * 0.5;
      cheeks.forEach(function (c) { c.material.opacity = 1; });
    }

    if (state === "leveldown") {
      var ld = 1 - Math.max(0, (stateUntil - t) / 2.0);
      cat.position.y = -0.16 * Math.sin(ld * Math.PI);
      head.rotation.x = 0.4 * Math.sin(ld * Math.PI);
    }

    if (state === "nip") {
      var left = stateUntil - t;
      if (left > 2.0) {                       // the mania
        var f = 1 - (left - 2.0) / 3.2;
        cat.rotation.z = Math.sin(t * 11) * (0.9 + f * 0.5);
        cat.rotation.x = Math.sin(t * 7.3) * 0.35;
        cat.position.y = Math.abs(Math.sin(t * 9)) * 0.32;
        cat.position.x = Math.sin(t * 5.5) * 0.22;
        head.rotation.z = Math.sin(t * 13) * 0.5;
        head.rotation.x = Math.sin(t * 8) * 0.3;
        spinTarget += 0.045;
        cheeks.forEach(function (c) { c.material.opacity = 1; });
      } else {                                // the flop
        cat.rotation.z += (1.35 - cat.rotation.z) * 0.08;
        cat.rotation.x *= 0.9;
        cat.position.y += (-0.34 - cat.position.y) * 0.08;
        cat.position.x *= 0.9;
        head.rotation.z *= 0.9;
        head.rotation.x += (0.35 - head.rotation.x) * 0.08;
      }
      for (var q = 0; q < tailBones.length; q++) {
        tailBones[q].rotation.z = (q ? 0.3 : 0) + Math.sin(t * 14 - q) * 0.4;
      }
    }

    if (state === "pounce") {
      var p = 1 - Math.max(0, (stateUntil - t) / 0.6);
      var hop = Math.sin(p * Math.PI);
      cat.position.y = hop * 0.5;
      cat.rotation.x = -hop * 0.2;
    } else {
      cat.rotation.x *= 0.88;
    }

    if (state === "sleep") {
      cat.rotation.z += (0.3 - cat.rotation.z) * 0.04;
      cat.position.y += (-0.28 - cat.position.y) * 0.04;
      head.rotation.x += (0.28 - head.rotation.x) * 0.04;
    } else {
      cat.rotation.z *= 0.9;
    }

    if (!dragging) spinTarget *= 0.975;
    spin += (spinTarget - spin) * 0.1;
    cat.rotation.y = spin;

    renderer.render(scene, camera);
  }

  function bindLook(el) {
    function track(e) {
      var p = e.touches ? e.touches[0] : e;
      var r = el.getBoundingClientRect();
      if (!r.width) return;
      look.x = clamp((p.clientX - (r.left + r.width / 2)) / (r.width / 2), -1.6, 1.6);
      look.y = clamp((p.clientY - (r.top + r.height / 2)) / (r.height / 2), -1.6, 1.6);
      look.live = true;
      look.at = performance.now();
    }
    window.addEventListener("mousemove", track, { passive: true });
    /* a finger is a poke, not a gaze, so touch only tracks while it is down */
    el.addEventListener("touchmove", track, { passive: true });
    document.addEventListener("mouseleave", function () { look.live = false; });
    window.addEventListener("blur", function () { look.live = false; });
  }

  function bindDrag(el) {
    function down(e) { dragging = true; dragged = false; lastX = (e.touches ? e.touches[0] : e).clientX; }
    function move(e) {
      if (!dragging) return;
      var x = (e.touches ? e.touches[0] : e).clientX, d = x - lastX;
      if (Math.abs(d) > 2) dragged = true;
      spinTarget += d * 0.012;
      lastX = x;
      if (e.touches) e.preventDefault();
    }
    function up() { dragging = false; }
    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  }

  return {
    init: function (el) {
      if (!window.THREE) return false;
      container = el;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
      catch (e) { return false; }
      if (!renderer.getContext()) return false;

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:pan-y";
      el.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      camera.position.set(0, 0.05, 4.5);
      camera.lookAt(0, -0.1, 0);
      clock = new THREE.Clock();

      buildCat();
      buildProps();
      buildScenes();
      buildScenes();
      resize();
      bindDrag(renderer.domElement);
      bindLook(renderer.domElement);
      window.addEventListener("resize", resize);

      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (rows) { visible = rows[0].isIntersecting; },
          { threshold: 0.05 }).observe(el);
      }
      renderer.domElement.addEventListener("click", function () {
        if (!dragged && typeof window.__carkTap === "function") window.__carkTap();
      });

      frame();
      return true;
    },
    setScene: function (name) {
      if (!scenes[name]) return false;
      sceneName = name;
      for (var k in scenes) scenes[k].visible = (k === name);
      return true;
    },
    scene: function () { return sceneName; },

    setScene: function (name) {
      if (!scenes[name]) return;
      activeScene = name;
      for (var k in scenes) scenes[k].visible = (k === name);
      /* the mind has no floor, so cark floats a little there */
      cat.position.z = name === "mind" ? -0.1 : 0;
    },

    /* catnip: total loss of composure, then a hard stop. rolls onto its back,
       spins, cannot hold a pose, then flops and stays flopped. */
    nip: function () { setState("nip", 5.2); },

    /* level 0 is a kitten, growth flattens out so a huge cark still fits */
    setSize: function (level, feel) {
      grow.target = 1 + Math.min(Math.log10(1 + (level || 0)) * 0.42, 0.5);
      grow.feel = feel || "fine";
      grow.droopTarget = feel === "sad" ? 1 : 0;
    },
    levelUp:   function () { setState("levelup", 2.2); },
    levelDown: function () { setState("leveldown", 2.0); },
    buy:  function () { setState("purr", 1.2); },
    sell: function () { setState("leveldown", 1.2); },

    pet:  function () { setState("purr", 1.6); },
    feed: function () { bowl.visible = true; setState("eat", 2.4); },
    play: function () {
      toy.visible = true;
      setState("play", 1.9);
      setTimeout(function () {
        setState("pounce", 0.6);
        setTimeout(function () { toy.visible = false; }, 600);
      }, 1900);
    },
    sleep: function () { setState("sleep", 0); },
    wake:  function () { if (state === "sleep") setState("idle", 0); },
    destroy: function () { if (raf) cancelAnimationFrame(raf); }
  };
})();
