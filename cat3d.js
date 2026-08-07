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

    var breath = Math.sin(t * 1.4) * 0.011;
    cat.scale.set(1 + breath, 1 - breath, 1 + breath);

    /* tail: slower and wider at the base, the curl holds its shape */
    for (var i = 0; i < tailBones.length; i++) {
      var speed = state === "play" ? 4.6 : state === "sleep" ? 0.6 : 1.4;
      var amp = state === "play" ? 0.13 : state === "sleep" ? 0.02 : 0.055;
      var base = i === 0 ? 0 : 0.3;
      tailBones[i].rotation.z = base + Math.sin(t * speed - i * 0.5) * amp;
      tailBones[i].rotation.x = Math.sin(t * speed * 0.7 - i * 0.4) * amp * 0.6;
    }

    /* ears twitch on their own, which is most of what sells it as alive */
    ears.forEach(function (e, i) {
      var s = i === 0 ? -1 : 1;
      var tw = Math.max(0, Math.sin(t * 0.7 + i * 2.3) - 0.97) * 12;
      e.rotation.z = s * -0.3 - s * tw * 0.25;
      e.rotation.x = state === "sleep" ? 0.4 : -tw * 0.1;
    });

    var want = (state === "purr" || state === "eat") ? 1 : 0.92;
    cheeks.forEach(function (c) { c.material.opacity += (want - c.material.opacity) * 0.08; });

    if (state === "idle") {
      /* occasional glance so it is never perfectly still */
      if (t > nextGlance) { glance = (Math.random() - 0.5) * 0.7; nextGlance = t + 3 + Math.random() * 5; }
      head.rotation.y += (glance - head.rotation.y) * 0.03;
      head.rotation.x += (Math.sin(t * 0.6) * 0.04 - head.rotation.x) * 0.05;
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
      resize();
      bindDrag(renderer.domElement);
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
