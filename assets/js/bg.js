/*
 * bg.js — rising dithered "steam" background, cursor-reactive.
 *
 * A single full-screen WebGL layer: turbulent fbm that scrolls upward so the
 * wisps appear to rise from the bottom edge and dissipate toward the top,
 * quantized through an 8x8 Bayer matrix for the risograph/CRT grain. The
 * pointer stirs nearby steam. Tuned subtle for the black & white theme.
 *
 * Self-contained (injects its own <canvas>), no dependencies, no HTML/CSS
 * edits needed. Load with:  <script src="assets/js/bg.js" defer></script>
 *
 * Honors prefers-reduced-motion (single static frame), pauses when hidden,
 * and silently no-ops if WebGL is unavailable (the SVG paper grain remains).
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  // the running <script> — used to read its data-steam preset
  var SELF = document.currentScript;

  /* ---- knobs ------------------------------------------------------------ */
  var CONFIG = {
    opacity: 0.24, // overall canvas opacity (subtlety vs. readability)
    ink: [0.0, 0.0, 0.0], // ink color (black). Warm: [0.13,0.10,0.08]
    invert: false, // true = light steam on a dark page
    density: 1.0, // steam strength / coverage
    rise: 0.4, // how fast the wisps climb
    sway: 0.3, // sideways drift of the columns
    scale: 1.0, // wispiness (higher = finer, more numerous wisps)
    glow: 0.12, // how much the cursor stirs nearby steam
    maxDPR: 1.5,
  };

  // per-page "personalities" — chosen via data-steam="<name>" on the script.
  var PRESETS = {
    home: { density: 1.0, rise: 0.4, sway: 0.3, scale: 1.0, opacity: 0.24 },
    research: { density: 0.9, rise: 0.55, sway: 0.22, scale: 1.45, opacity: 0.22 },
    projects: { density: 1.15, rise: 0.28, sway: 0.42, scale: 0.7, opacity: 0.24 },
    experience: { density: 1.0, rise: 0.22, sway: 0.52, scale: 1.0, opacity: 0.24 },
    oss: { density: 1.05, rise: 0.36, sway: 0.34, scale: 0.85, opacity: 0.23 },
    blog: { density: 0.7, rise: 0.46, sway: 0.3, scale: 1.25, opacity: 0.2 },
    post: { density: 0.65, rise: 0.3, sway: 0.26, scale: 1.1, opacity: 0.16 },
  };
  var name = (SELF && SELF.dataset && SELF.dataset.steam) || "home";
  var preset = PRESETS[name] || PRESETS.home;
  for (var k in preset) CONFIG[k] = preset[k];

  var reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- canvas ----------------------------------------------------------- */
  var canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  var s = canvas.style;
  s.position = "fixed";
  s.inset = "0";
  s.width = "100%";
  s.height = "100%";
  s.zIndex = "0"; // behind .page (z-index:1), above the white body bg
  s.pointerEvents = "none";
  s.display = "block";
  s.opacity = String(CONFIG.opacity);

  /* ---- shaders ---------------------------------------------------------- */
  var VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";

  var FRAG = [
    "precision highp float;",
    "uniform vec2 u_res;",
    "uniform float u_time;",
    "uniform vec2 u_mouse;", // pixels, y-up
    "uniform float u_act, u_density, u_rise, u_sway, u_scale, u_glow, u_invert;",
    "uniform vec3 u_ink;",

    // simplex noise (Ashima / Gustavson)
    "vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}",
    "vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}",
    "vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}",
    "vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}",
    "float snoise(vec3 v){",
    "  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);",
    "  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);",
    "  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;",
    "  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);",
    "  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;",
    "  i=mod289(i);",
    "  vec4 p=permute(permute(permute(",
    "    i.z+vec4(0.0,i1.z,i2.z,1.0))",
    "    +i.y+vec4(0.0,i1.y,i2.y,1.0))",
    "    +i.x+vec4(0.0,i1.x,i2.x,1.0));",
    "  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;",
    "  vec4 j=p-49.0*floor(p*ns.z*ns.z);",
    "  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);",
    "  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;",
    "  vec4 h=1.0-abs(x)-abs(y);",
    "  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);",
    "  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0;",
    "  vec4 sh=-step(h,vec4(0.0));",
    "  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;",
    "  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y);",
    "  vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);",
    "  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));",
    "  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;",
    "  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);",
    "  m=m*m;",
    "  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));",
    "}",
    "float fbm(vec3 p){float s=0.0,a=0.5;for(int i=0;i<5;i++){s+=a*snoise(p);p*=2.03;a*=0.5;}return s;}",

    // 8x8 Bayer ordered-dither threshold
    "float bayer2(vec2 a){a=floor(a);return fract(a.x*0.5+a.y*a.y*0.75);}",
    "float bayer4(vec2 a){return bayer2(0.5*a)*0.25+bayer2(a);}",
    "float bayer8(vec2 a){return bayer4(0.5*a)*0.25+bayer2(a);}",

    "void main(){",
    "  vec2 uv = gl_FragCoord.xy / u_res;", // y: 0 bottom .. 1 top
    "  vec2 asp = vec2(u_res.x / u_res.y, 1.0);",
    "  float t = u_time;",
    "  vec2 p = vec2(uv.x * asp.x, uv.y);",
    "  float sway = fbm(vec3(p * 1.8, t * 0.12));", // column sway
    "  p.x += (sway - 0.5) * u_sway;",
    "  float n = fbm(vec3(p.x * 2.6 * u_scale, p.y * 2.0 * u_scale - t * u_rise, t * 0.08));",
    "  n = pow(n * 0.5 + 0.5, 1.7);", // wispy contrast
    "  float vfade = smoothstep(1.1, 0.08, uv.y);", // dense low, gone near top
    "  float base = smoothstep(0.0, 0.10, uv.y);", // tuck in above the edge
    "  float density = n * vfade * base;",
    "  vec2 fp = vec2(uv.x * asp.x, uv.y);",
    "  vec2 m = (u_mouse / u_res) * asp;",
    "  float halo = exp(-dot(fp - m, fp - m) * 5.0) * u_act;",
    "  density += halo * u_glow * 3.0 * vfade;",
    "  float dd = bayer8(gl_FragCoord.xy);",
    "  float a = step(dd, density * u_density);", // dithered mask
    "  if (a < 0.5) discard;",
    "  vec3 col = u_invert > 0.5 ? (vec3(1.0) - u_ink) : u_ink;",
    "  gl_FragColor = vec4(col, 1.0);",
    "}",
  ].join("\n");

  /* ---- engine ----------------------------------------------------------- */
  var gl, prog, U, raf, dpr;
  var ptr = { x: 0, y: 0, tx: 0, ty: 0, act: 0, tact: 0 };

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn("bg.js shader:", gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  function init() {
    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("bg.js link:", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    var loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    U = {
      res: gl.getUniformLocation(prog, "u_res"),
      time: gl.getUniformLocation(prog, "u_time"),
      mouse: gl.getUniformLocation(prog, "u_mouse"),
      act: gl.getUniformLocation(prog, "u_act"),
      density: gl.getUniformLocation(prog, "u_density"),
      rise: gl.getUniformLocation(prog, "u_rise"),
      sway: gl.getUniformLocation(prog, "u_sway"),
      scale: gl.getUniformLocation(prog, "u_scale"),
      glow: gl.getUniformLocation(prog, "u_glow"),
      invert: gl.getUniformLocation(prog, "u_invert"),
      ink: gl.getUniformLocation(prog, "u_ink"),
    };
    gl.uniform1f(U.density, CONFIG.density);
    gl.uniform1f(U.rise, CONFIG.rise);
    gl.uniform1f(U.sway, CONFIG.sway);
    gl.uniform1f(U.scale, CONFIG.scale);
    gl.uniform1f(U.glow, CONFIG.glow);
    gl.uniform1f(U.invert, CONFIG.invert ? 1 : 0);
    gl.uniform3fv(U.ink, CONFIG.ink);

    resize();
    window.addEventListener("resize", resize, { passive: true });

    if (reduce) {
      render(0); // single static frame
      return;
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(loop);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDPR);
    var w = Math.floor(innerWidth * dpr);
    var h = Math.floor(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    if (reduce) render(0);
  }

  function onMove(e) {
    ptr.tx = e.clientX * dpr;
    ptr.ty = (innerHeight - e.clientY) * dpr; // flip to y-up
    ptr.tact = 1;
  }

  function onVis() {
    if (document.hidden) cancelAnimationFrame(raf);
    else raf = requestAnimationFrame(loop);
  }

  function render(ms) {
    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.time, ms * 0.001);
    gl.uniform2f(U.mouse, ptr.x, ptr.y);
    gl.uniform1f(U.act, ptr.act);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function loop(ms) {
    ptr.x += (ptr.tx - ptr.x) * 0.08;
    ptr.y += (ptr.ty - ptr.y) * 0.08;
    ptr.tact *= 0.96; // halo fades when the mouse stops
    ptr.act += (ptr.tact - ptr.act) * 0.1;
    render(ms);
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", start);
      return;
    }
    document.body.insertBefore(canvas, document.body.firstChild);
    gl =
      canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false }) ||
      canvas.getContext("experimental-webgl", { alpha: true });
    if (!gl) return; // graceful fallback: static SVG grain remains
    init();
  }

  start();
})();
