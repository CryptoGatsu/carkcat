/* cark, in three dimensions
 *
 * The logo is a white line around a black shape. In 3D that is an inverted hull:
 * every part is drawn twice, once as flat black, once slightly larger with the
 * faces flipped so only the rim shows. A third transparent shell fakes the chalk
 * bloom without needing a post processing pass.
 *
 * three r128. no OrbitControls, no CapsuleGeometry, both unavailable at this
 * version, so rotation is hand rolled and every part is built from primitives.
 */
window.CarkCat = (function () {
  "use strict";

  var CHALK = 0xf2f0ec, BLUSH = 0xf2a7c3;

  var mat = {
    fill:    new THREE.MeshBasicMaterial({ color: 0x000000 }),
    outline: new THREE.MeshBasicMaterial({ color: CHALK, side: THREE.BackSide }),
    halo:    new THREE.MeshBasicMaterial({
               color: CHALK, side: THREE.BackSide, transparent: true,
               opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false }),
    solid:   new THREE.MeshBasicMaterial({ color: CHALK }),
    blush:   new THREE.MeshBasicMaterial({
               color: BLUSH, transparent: true, opacity: 0.55,
               blending: THREE.AdditiveBlending, depthWrite: false })
  };

  /* one part = black fill + flipped outline + soft halo */
  function part(geo, rim, halo) {
    var g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat.fill));
    var line = new THREE.Mesh(geo, mat.outline);
    line.scale.setScalar(rim || 1.055);
    g.add(line);
    if (halo !== false) {
      var h = new THREE.Mesh(geo, mat.halo);
      h.scale.setScalar((rim || 1.055) + 0.09);
      g.add(h);
    }
    return g;
  }

  var scene, camera, renderer, cat, head, tailBones = [], cheeks = [],
      toy, bowl, container, raf = null, clock, visible = true;

  var state = "idle", stateUntil = 0, spin = 0, spinTarget = 0,
      dragging = false, lastX = 0, dragged = false;

  function buildCat() {
    cat = new THREE.Group();

    /* ---- body: sitting, so a squashed sphere with haunches ---- */
    var body = part(new THREE.SphereGeometry(0.62, 14, 11), 1.05);
    body.scale.set(1, 0.92, 0.88);
    body.position.y = -0.62;
    cat.add(body);

    var haunch = part(new THREE.SphereGeometry(0.3, 10, 8), 1.07);
    haunch.position.set(0, -0.95, -0.18);
    haunch.scale.set(1.25, 0.8, 1);
    cat.add(haunch);

    /* ---- front legs ---- */
    [-0.27, 0.27].forEach(function (x) {
      var leg = part(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 8), 1.1);
      leg.position.set(x, -1.03, 0.34);
      cat.add(leg);
      var paw = part(new THREE.SphereGeometry(0.13, 8, 6), 1.09, false);
      paw.position.set(x, -1.26, 0.42);
      paw.scale.set(1, 0.7, 1.3);
      cat.add(paw);
    });

    /* ---- head ---- */
    head = new THREE.Group();
    head.position.y = 0.22;
    cat.add(head);

    var skull = part(new THREE.SphereGeometry(0.6, 16, 12), 1.05);
    skull.scale.set(1, 0.94, 0.9);
    head.add(skull);

    /* ears, tilted out like the logo */
    [-1, 1].forEach(function (s) {
      var ear = part(new THREE.ConeGeometry(0.24, 0.44, 5), 1.09);
      ear.position.set(s * 0.34, 0.5, -0.04);
      ear.rotation.z = s * -0.32;
      ear.rotation.x = -0.12;
      head.add(ear);
    });

    /* nose: filled white in the logo, so it stays solid here */
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.1, 4), mat.solid);
    nose.position.set(0, -0.08, 0.55);
    nose.rotation.x = Math.PI / 2;
    head.add(nose);

    /* the cheeks are the only color anywhere */
    [-1, 1].forEach(function (s) {
      var c = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat.blush);
      c.position.set(s * 0.29, 0.02, 0.44);
      c.scale.set(1, 0.9, 0.35);
      head.add(c);
      cheeks.push(c);
    });

    /* whiskers, three a side, thin solid cylinders */
    [-1, 1].forEach(function (s) {
      [0.06, -0.04, -0.14].forEach(function (y, i) {
        var w = new THREE.Mesh(
          new THREE.CylinderGeometry(0.011, 0.006, 0.62, 4), mat.solid);
        w.position.set(s * 0.62, y, 0.3);
        w.rotation.z = Math.PI / 2;
        w.rotation.y = s * (0.25 - i * 0.16);
        head.add(w);
      });
    });

    /* ---- tail: a chain of parented segments so it sways naturally ---- */
    var parent = cat, seg;
    for (var i = 0; i < 5; i++) {
      var r = 0.11 - i * 0.014;
      seg = new THREE.Group();
      seg.position.y = i === 0 ? -0.85 : 0.3;
      if (i === 0) seg.position.z = -0.55;
      var piece = part(new THREE.CylinderGeometry(r, r * 0.92, 0.32, 7), 1.13, false);
      piece.position.y = 0.16;
      seg.add(piece);
      parent.add(seg);
      tailBones.push(seg);
      parent = seg;
    }
    tailBones[0].rotation.x = 0.9;

    scene.add(cat);
  }

  function buildProps() {
    /* the toy: a bare glowing dot, same chalk white */
    toy = new THREE.Group();
    var core = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mat.solid);
    var aura = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({
      color: CHALK, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.scale.setScalar(2.4);
    toy.add(core, aura);
    toy.visible = false;
    scene.add(toy);

    /* the bowl: an open ring, drawn not filled */
    bowl = new THREE.Group();
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.028, 6, 22), mat.solid);
    rim.rotation.x = Math.PI / 2;
    var basin = part(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48), 1.06, false);
    bowl.add(rim, basin);
    bowl.position.set(0, -1.34, 0.72);
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
    if (stateUntil && t > stateUntil && state !== "sleep") {
      state = "idle";
      stateUntil = 0;
    }

    /* breathing, always running underneath everything else */
    var breath = Math.sin(t * 1.5) * 0.012;
    cat.scale.set(1 + breath, 1 - breath, 1 + breath);

    /* tail sway, each segment lagging the one before it */
    for (var i = 0; i < tailBones.length; i++) {
      var speed = state === "play" ? 5.2 : state === "sleep" ? 0.7 : 1.7;
      var amp = state === "play" ? 0.2 : state === "sleep" ? 0.04 : 0.1;
      tailBones[i].rotation.z = Math.sin(t * speed - i * 0.55) * amp;
      if (i === 0) tailBones[i].rotation.x = 0.9 + Math.sin(t * speed * 0.5) * 0.08;
    }

    /* cheeks brighten when cark is enjoying itself */
    var want = (state === "purr" || state === "eat") ? 0.95 : 0.5;
    cheeks.forEach(function (c) {
      c.material.opacity += (want - c.material.opacity) * 0.08;
    });

    head.rotation.x *= 0.9;
    head.rotation.y *= 0.9;
    head.position.y += (0.22 - head.position.y) * 0.12;
    cat.position.y += (0 - cat.position.y) * 0.12;

    if (state === "purr") {
      cat.position.x = Math.sin(t * 42) * 0.012;
      head.rotation.z = Math.sin(t * 42) * 0.02;
    } else {
      cat.position.x *= 0.85;
      head.rotation.z *= 0.85;
    }

    if (state === "eat") {
      head.rotation.x = 0.55 + Math.sin(t * 7) * 0.12;
      head.position.y = 0.22 - 0.22;
      bowl.scale.setScalar(Math.min(1, bowl.scale.x + 0.09));
    } else if (bowl.visible) {
      bowl.scale.setScalar(bowl.scale.x * 0.86);
      if (bowl.scale.x < 0.02) bowl.visible = false;
    }

    if (state === "play") {
      /* toy circles, cark tracks it with its head */
      var a = t * 2.1;
      toy.position.set(Math.cos(a) * 1.35, 0.35 + Math.sin(a * 1.7) * 0.5, 0.9 + Math.sin(a) * 0.35);
      var dx = toy.position.x - cat.position.x;
      var dy = toy.position.y - (cat.position.y + 0.22);
      head.rotation.y = Math.atan2(dx, 1.6) * 0.8;
      head.rotation.x = -Math.atan2(dy, 1.6) * 0.6;
    }

    if (state === "pounce") {
      var p = 1 - Math.max(0, (stateUntil - t) / 0.6);
      var hop = Math.sin(p * Math.PI);
      cat.position.y = hop * 0.55;
      cat.rotation.x = -hop * 0.22;
    } else {
      cat.rotation.x *= 0.88;
    }

    if (state === "sleep") {
      cat.rotation.z += (0.22 - cat.rotation.z) * 0.05;
      cat.position.y += (-0.3 - cat.position.y) * 0.05;
      head.rotation.x += (0.3 - head.rotation.x) * 0.05;
    } else {
      cat.rotation.z *= 0.9;
    }

    /* drift back to facing forward once you stop dragging */
    if (!dragging) spinTarget *= 0.97;
    spin += (spinTarget - spin) * 0.1;
    cat.rotation.y = spin;

    renderer.render(scene, camera);
  }

  function bindDrag(el) {
    function down(e) {
      dragging = true; dragged = false;
      lastX = (e.touches ? e.touches[0] : e).clientX;
    }
    function move(e) {
      if (!dragging) return;
      var x = (e.touches ? e.touches[0] : e).clientX;
      var d = x - lastX;
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
    /* returns false if webgl is unavailable so the caller can fall back */
    init: function (el) {
      if (!window.THREE) return false;
      container = el;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch (e) { return false; }
      if (!renderer.getContext()) return false;

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:pan-y";
      el.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      camera.position.set(0, -0.15, 4.4);
      camera.lookAt(0, -0.2, 0);
      clock = new THREE.Clock();

      buildCat();
      buildProps();
      resize();
      bindDrag(renderer.domElement);
      window.addEventListener("resize", resize);

      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (rows) {
          visible = rows[0].isIntersecting;
        }, { threshold: 0.05 }).observe(el);
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
