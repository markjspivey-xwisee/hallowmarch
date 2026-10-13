/* ================================================================== */
/* [anim2] Cinderwing's scales (version 19), loaded before the dragon's  */
/* material is made from them                                           */
/* ================================================================== */
// The owner saw the dragon dead in daylight with its back and flanks "a coarse checker of scale-blocks": the scale branch
// laid two square lattices of discs over each other (each cell one or the other: a checker), 15 round the body (a scale
// 0.44 m wide), its bump the screen derivative of a value that steps at every scale's edge (2x2-pixel blocks all along
// them), its colour plates a value noise 4 blocks round, and the way round each tube jumped from 0.95 back to 0 across
// one strip of quads (the tubes share their seam's vertices), squeezing a whole turn of scales into it.
// Now: rows of round-ended scales lapping toward the tail and down the legs (each row over the one behind it), 36 round
// a tube and 7 a unit of its length (on the body about 18 by 16 cm, smaller up the neck and down the tail and legs),
// each its own shade, rounded and lifted at its free edge with the shadow it casts on the scale it laps, bumped through
// the surface's own frame (worked out from the screen derivatives of the world position and of the scales' coordinates,
// which are smooth over a triangle); the way round a tube read from a direction (cos, sin of the turn) so it has no
// seam; the scales fade to their mean colour before they are under about two pixels.
const A2_SCALES_GLSL = /* glsl */`
const float A2_NX = 36.0, A2_NY = 7.0, A2_R = 0.72;
float a2Hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// the turn round a tube (0..1, any whole number of turns) and its screen derivatives, from its direction
float a2Turn(vec2 cs, out vec2 dU) {
  float l2 = max(dot(cs, cs), 1e-6);
  dU = vec2(cs.x * dFdx(cs.y) - cs.y * dFdx(cs.x), cs.x * dFdy(cs.y) - cs.y * dFdy(cs.x)) / (6.2831853 * l2);
  return atan(cs.y, cs.x + 1e-7) / 6.2831853;
}
// colour plates large enough to read from afar, with no seam
float a2Blot(vec2 uv, vec2 cs) {
  return 0.55 * vnoise(vec2(uv.y * 1.2, 3.0) + cs * 0.64) + 0.45 * vnoise(vec2(uv.y * 2.1 + 9.0, 1.0) + cs.yx * 1.1);
}
// the scale a point of the hide lies on: its place in it (q, from its root; the free edge toward lower v), its
// distance from the root in the scale's own measure (1 at the edge) and which scale (id); and how far the point is
// into the scale of the row ahead (shadow: that scale's free edge lies over it)
float a2ScaleAt(vec2 g, out vec2 q, out vec2 id, out float up) {
  float r = floor(g.y) + 1.0, ox = 0.5 * mod(r, 2.0);
  vec2 c = vec2(floor(g.x - ox + 0.5) + ox, r);
  vec2 qq = g - c;
  float d = length(qq * vec2(1.0, 0.8)) / A2_R;
  up = d;
  if (d < 1.0) { q = qq; id = c; return d; }
  r -= 1.0; ox = 0.5 * mod(r, 2.0);
  c = vec2(floor(g.x - ox + 0.5) + ox, r);
  q = g - c; id = c;
  return min(length(q * vec2(1.0, 0.8)) / A2_R, 1.0);
}
// sc: the scale's lightness (0..1), rim: its edge and the shadow of the one over it, sh: its own shade (-0.5..0.5);
// n2: the normal bumped by the scales
float a2Scales(vec2 uv, vec2 cs, vec3 wp, vec3 n, out vec3 n2, out float rim, out float sh) {
  vec2 dU;
  float u = a2Turn(cs, dU);
  vec2 g = vec2(u * A2_NX, uv.y * A2_NY);
  vec2 dgx = vec2(dU.x * A2_NX, dFdx(uv.y) * A2_NY), dgy = vec2(dU.y * A2_NX, dFdy(uv.y) * A2_NY);
  float px = max(length(vec2(dgx.x, dgy.x)), length(vec2(dgx.y, dgy.y)));
  vec3 dpx = dFdx(wp), dpy = dFdy(wp);
  // a part with no way round (the wings' arms, the toes) has no scales of its own
  float detail = (1.0 - smoothstep(0.22, 0.55, px)) * step(1e-6, length(dU));
  n2 = n; rim = 0.12; sh = 0.0;
  if (detail < 0.01) return 0.6;
  vec2 q, id; float up;
  float d = a2ScaleAt(g, q, id, up);
  sh = (a2Hash(id) - 0.5) * detail;
  // the edge's dark line, and the shadow the scale over this one casts just below its edge
  float edge = smoothstep(0.8, 1.0, d);
  float shade = (1.0 - smoothstep(1.0, 1.35, up)) * step(1.0, up);
  rim = mix(0.12, max(edge, 0.7 * shade), detail);
  float sc = mix(0.6, 0.35 + 0.6 * (1.0 - d * d) - 0.25 * edge, detail);
  // its height: domed, and lifted toward its free edge (q.y < 0); its slope in the scale's measure
  vec2 dh = vec2(-1.2 * q.x, -1.2 * 0.64 * q.y - 0.4 * A2_R) / (A2_R * A2_R);
  float det = dgx.x * dgy.y - dgx.y * dgy.x;
  if (abs(det) > 1e-12) {
    vec3 T = (dpx * dgy.y - dpy * dgx.y) / det, B = (dpy * dgx.x - dpx * dgy.x) / det;
    T -= n * dot(T, n); B -= n * dot(B, n);
    float tt = dot(T, T), bb = dot(B, B);
    if (tt > 1e-8 && bb > 1e-8) {
      vec3 grad = dh.x * T / tt + dh.y * B / bb;
      // 3 cm of relief at most; the step down at the free edge dims the light there rather than bending it
      grad *= 0.03 * detail * (1.0 - edge);
      n2 = normalize(n - grad);
    }
  }
  return sc;
}
`;
