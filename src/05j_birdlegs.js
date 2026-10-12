/* ================================================================== */
/* [motion5] birds' legs that walk: the hen, the pheasant and the      */
/* mallard plant each foot where it comes down and stand on it         */
/* ================================================================== */
// Version 11's birds swung each leg as one stiff stick about the hip and folded the shank as the foot lifted: the foot
// rocked heel to toe through the stance (its toes 1 to 3 cm into the ground and up off it), the fold carried it back over
// the ground as it lifted (1.5 to 3.5 cm of sliding at a run), a mallard's web tipped 2.5 cm into the ground, and the head
// jumped forward in one frame and drew back over a quarter of a step. Now each leg is two bones in its own plane (the
// drumstick from the hip down to the hock, the joint bent back as a bird's is, and the scaly shank from the hock down to
// the foot), reached by IK (blLegPose) to where the gait puts the foot (blFoot): planted on the ground while it bears the
// bird, rising its first centimetres still standing where it stood and coming down its last onto the place it lands
// (as the beasts' bbFoot does), the toes curling as the foot lifts and spreading before it lands, the foot level on the
// ground through the stance. The body comes down as far as its planted legs need to reach their feet (the vault: the
// bird rides up over each planted leg as a walker does, no fixed bob), the waddle rolls the body and not the legs, and
// a hen's or a pheasant's head holds still in the air while the body walks on under it, then thrusts forward, once a
// step (a mallard does not bob). Birds and hens have no foot lock (13s_footlock.js): their planted feet keep pace by the
// gait alone (beastStride, 05c_beasts.js, gives the phase the same stride as blGait).
// The legs' rest joints in each bird's own frame, (z, y): the hip, the hock (behind the line: the joint bends back) and
// the ankle (where the toes meet the shank). The geometry is built to them (buildHen, birdBuild).
const BIRD_LEGS = {
  hen: { H: [0.0, 0.2], K: [-0.014, 0.148], A: [0.012, 0.014], x: 0.045 },
  pheasant: { H: [0.0, 0.2], K: [-0.013, 0.13], A: [0.01, 0.012], x: 0.04 },
  duck: { H: [-0.03, 0.15], K: [-0.016, 0.092], A: [0.01, 0.012], x: 0.05 },
};
// the shank as a tube through the hock (for the kits: buildHen, birdBuild): points from under the thigh down to the ankle
function birdLegTubePts(L, x, top, rTop, rLow) {
  const [Hz, Hy] = L.H, [Kz, Ky] = L.K, [Az, Ay] = L.A, pts = [];
  // from just under the thigh's feathers down the drumstick to the hock, then the shank to the ankle (rings close
  // together at the hock, so it bends cleanly)
  const up = [[Hz + (Kz - Hz) * 0.25, top], [Kz + (Hz - Kz) * 0.18, Ky + (Hy - Ky) * 0.18], [Kz, Ky + 0.006], [Kz, Ky - 0.006], [Kz + (Az - Kz) * 0.2, Ky + (Ay - Ky) * 0.2], [Kz + (Az - Kz) * 0.62, Ky + (Ay - Ky) * 0.62], [Az, Ay + 0.006]];
  for (let i = 0; i < up.length; i++) {
    const t = i / (up.length - 1), r = rTop + (rLow - rTop) * t + (i === 2 || i === 3 ? 0.0018 : 0);
    pts.push({ c: [x, up[i][1], up[i][0]], rx: r, rz: r });
  }
  return pts;
}
const blV2 = (p) => `vec2(${p[0].toFixed(4)}, ${p[1].toFixed(4)})`;
const BIRD_LEG_GLSL = /* glsl */`
  // [motion5] (05j_birdlegs.js) a bird's legs: the gait, the foot's path, the vault and the two-bone IK
  vec2 bl2r(vec2 v, vec2 cs){ return vec2(v.x * cs.x - v.y * cs.y, v.x * cs.y + v.y * cs.x); }
  vec2 blRot(vec2 a, vec2 b){ return vec2(dot(a, b), a.x * b.y - a.y * b.x); } // (cos, sin) turning unit a onto unit b, in (z, y)
  // the gait at this amount and scale (G: walk and run strides, leg length): the share of the cycle a foot is down, how far
  // it reaches either side of its rest place, how high it rises in place (lc) and over the swing (lh), the stride, how
  // much of a run it is, and whether the bird walks at all
  void blGait(float amtS, float bsc, vec4 G, out float duty, out float reach, out float lc, out float lh, out float strideM, out float runK, out float gk){
    float vSpd = amtS * 4.3, fC = sqrt(1.06 / max(G.z * bsc, 0.05));
    strideM = clamp(mix(G.x, G.y, smoothstep(0.7, 1.4, amtS)), vSpd / (4.0 * fC * bsc), max(vSpd / (1.6 * fC * bsc), 0.02));
    runK = smoothstep(0.8, 1.6, vSpd / sqrt(9.8 * max(G.z * bsc, 0.05))); // (by the Froude number: a hen runs from about 2 m/s)
    gk = smoothstep(0.0, 0.03, amtS);
    duty = min(mix(0.62, 0.45, runK), 0.4 * G.z / max(strideM, 1e-3)); // a long stride: down only as long as the leg reaches
    reach = duty * strideM;
    lc = 0.11 * G.z * gk; lh = mix(0.17, 0.24, runK) * G.z * gk;
  }
  // a foot at u of its cycle (0: it comes down): how far ahead of its rest place (x), how high over the ground (y), how far
  // its toes are curled (z). Planted through the stance; its first lc metres it rises still standing where it stood, in the
  // last of the stance, and its last it comes down onto its place in the first of the next; in the swing it leaves and meets
  // that height still going back under the body at the stance's own pace (bbFoot's retraction)
  vec3 blFoot(float u, float duty, float reach, float lc, float lh){
    float ad = 0.18 * duty;
    if (u < duty) return vec3(reach * (1.0 - 2.0 * u / duty), lc * max(1.0 - smoothstep(0.0, ad, u), smoothstep(duty - ad, duty, u)), 0.0);
    float wv = (u - duty) / (1.0 - duty), q = 1.0 - wv;
    float e = wv * wv * (3.0 - 2.0 * wv) - (1.0 - duty) / max(duty, 0.05) * (wv * pow(q, 4.0) - q * pow(wv, 4.0));
    return vec3(reach * (2.0 * e - 1.0), lc + lh * pow(sin(3.14159 * wv), 0.6), smoothstep(0.0, 0.3, wv) * (1.0 - smoothstep(0.6, 0.9, wv)));
  }
  // how far the hip must come down for an ankle fx ahead of its rest place to stand on the ground (L: the leg's length)
  float blNeed(vec2 H0, vec2 A0, float L, float fx){ return max(0.0, length(A0 + vec2(fx, 0.0) - H0) - L * 0.996); }
  // the toes' pitch (down, rad) for a foot curled c at height fy over the ground: their tips (tl long) rise at least 60% as
  // fast as the ankle, so the toes leave the ground and never hang along it
  float blToes(float c, float fy, float tl){ float s = 1.0 - 0.32 * c; return min(0.95 * c, asin(clamp(0.4 * fy / (tl * s), 0.0, 1.0))); }
  // a leg's vertex (P, Nn: in the bird's frame) posed: the hip at Hn, the ankle reaching for A, the foot pitched pf (toes
  // down) and curled c; w < 1 for the thigh's feathers, which go part of the way; lx the leg's own x (the toes draw in)
  void blLegPose(vec2 H0, vec2 K0, vec2 A0, vec2 Hn, vec2 A, float pf, float c, float w, float lx){
    float l1 = length(K0 - H0), l2 = length(A0 - K0);
    vec2 d = A - Hn; float L = length(d), Lc = clamp(L, abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
    vec2 u = d / max(L, 1e-5);
    float ca = clamp((l1 * l1 + Lc * Lc - l2 * l2) / (2.0 * l1 * Lc), -1.0, 1.0), sa = sqrt(max(1.0 - ca * ca, 0.0));
    vec2 Kn = Hn + l1 * vec2(u.x * ca + u.y * sa, u.y * ca - u.x * sa); // (the joint behind the line, as a bird's hock)
    vec2 An = Hn + u * Lc;
    vec2 R1 = blRot((K0 - H0) / l1, (Kn - Hn) / l1), R2 = blRot((A0 - K0) / l2, (An - Kn) / l2), Rf = vec2(cos(pf), -sin(pf));
    vec2 p = P.zy, n = Nn.zy;
    float kb = smoothstep(K0.y - 0.005, K0.y + 0.005, p.y), fb = smoothstep(A0.y + 0.001, A0.y + 0.007, p.y), sc = 1.0 - 0.32 * c;
    vec2 q = mix(An + bl2r((p - A0) * sc, Rf), mix(Kn + bl2r(p - K0, R2), Hn + bl2r(p - H0, R1), kb), fb);
    vec2 qn = mix(bl2r(n, Rf), mix(bl2r(n, R2), bl2r(n, R1), kb), fb);
    q = mix(p + (Hn - H0), q, w); qn = mix(n, qn, w);
    P.zy = q; Nn.zy = qn;
    P.x = mix(lx + (P.x - lx) * sc, P.x, fb);
  }
`;
