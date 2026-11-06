/* ================================================================== */
/* [late3] a veteran's device: the sign of the name it wears           */
/* ================================================================== */
// (version 17) Drawn on the standard of your name (the banners' shader, 04_props.js) and on the mantle you wear with a
// name (the people's shader, 05a_rig.js), in the realm's colours. Loaded before both: their shaders are built from it.
// The device follows the deed of the name worn (10n_veteran.js): crossed blades for the foes of the realms, an upright
// blade for champions and lords, a crowned skull for the dead's kings and the risen, a tower for keeps taken, a chalice
// for a hallow carried home, a wreath for a campaign won, a flame for Cinderwing and the Ash-Crowned, a hammer for a
// masterwork, a peak for veterancy, a star for the realm's own names.
const L3_DEVICE_OF = { foes: 0, champ: 1, lord: 1, keep: 2, hallow: 3, camp: 4, dragon: 5, deep: 5, king: 6, high: 6, mw: 7, vet: 8, rr: 9 };
const L3_DEVICE_NAMES = ['crossed blades', 'an upright blade', 'a tower', 'a chalice', 'a wreath', 'a flame', 'a crowned skull', 'a hammer', 'a peak', 'a star'];
// signed distances in the device's own square (about -0.75 to 0.75 each way, y up): below 0 inside
const L3_DEVICE_GLSL = /* glsl */`
    float l3Box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
    vec2 l3Rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
    float l3Blade(vec2 p){
      float d = max(l3Box(p - vec2(0.0, 0.12), vec2(0.065, 0.46)), abs(p.x) * 2.2 + (p.y - 0.66));
      d = min(d, l3Box(p - vec2(0.0, -0.36), vec2(0.25, 0.045)));
      d = min(d, l3Box(p - vec2(0.0, -0.5), vec2(0.04, 0.11)));
      return min(d, length(p - vec2(0.0, -0.66)) - 0.065);
    }
    float l3DeviceD(vec2 p, int k){
      // A single initialized return avoids ANGLE/FXC's uninitialized-return
      // fallback on older D3D11 drivers. Fixed motifs use float constants below
      // rather than signed integer loop indices in the generated shader.
      float d = 1.0;
      if (k == 0) d = min(l3Blade(l3Rot(p, 0.62)), l3Blade(l3Rot(p, -0.62)));
      else if (k == 1) d = l3Blade(p * 0.92) / 0.92;
      else if (k == 2) {
        d = l3Box(p - vec2(0.0, -0.14), vec2(0.32, 0.48));
        ${[-1, 0, 1].map(i => `d = min(d, l3Box(p - vec2(${i.toFixed(1)} * 0.23, 0.42), vec2(0.07, 0.1)));`).join('\n        ')}
        d = max(d, -l3Box(p - vec2(0.0, -0.5), vec2(0.1, 0.13)));
        d = max(d, -l3Box(p - vec2(0.0, 0.08), vec2(0.04, 0.09)));
      }
      else if (k == 3) {
        float cup = max(length(p - vec2(0.0, 0.3)) - 0.38, p.y - 0.3);
        cup = min(cup, l3Box(p - vec2(0.0, 0.31), vec2(0.4, 0.03)));
        d = min(cup, l3Box(p - vec2(0.0, -0.22), vec2(0.045, 0.24)));
        d = min(d, l3Box(p - vec2(0.0, -0.5), vec2(0.24, 0.05)));
      }
      else if (k == 4) {
        d = max(abs(length(p) - 0.5) - 0.045, -l3Box(p - vec2(0.0, -0.5), vec2(0.16, 0.14)));
        ${Array.from({ length: 10 }, (_, i) => `{ float side = ${i < 5 ? '-1.0' : '1.0'}, ang = side * (0.3 + ${(i % 5).toFixed(1)} * 0.46);
          vec2 q = l3Rot(p - 0.5 * vec2(sin(ang), cos(ang)), ang + side * 0.45);
          d = min(d, length(q * vec2(1.0, 2.2)) - 0.12); }`).join('\n        ')}
      }
      else if (k == 5) {
        d = length(p - vec2(0.0, -0.2)) - 0.32;
        d = min(d, max(abs(p.x) - 0.32 * clamp((0.66 - p.y) / 0.86, 0.0, 1.0), max(p.y - 0.66, -0.2 - p.y)));
        float inner = length(p - vec2(0.0, -0.26)) - 0.14;
        inner = min(inner, max(abs(p.x) - 0.14 * clamp((0.22 - p.y) / 0.48, 0.0, 1.0), max(p.y - 0.22, -0.26 - p.y)));
        d = max(d, -inner);
      }
      else if (k == 6) {
        d = length((p - vec2(0.0, -0.06)) * vec2(1.0, 0.92)) - 0.34;
        d = min(d, l3Box(p - vec2(0.0, -0.36), vec2(0.17, 0.1)));
        d = max(d, -(length(vec2(abs(p.x) - 0.13, p.y + 0.04)) - 0.08));
        d = max(d, -l3Box(vec2(abs(p.x) - 0.06, p.y + 0.38), vec2(0.018, 0.08)));
        float crown = l3Box(p - vec2(0.0, 0.36), vec2(0.27, 0.05));
        ${[-1, 0, 1].map(i => `crown = min(crown, max(abs(p.x - ${i.toFixed(1)} * 0.2) * 1.6 + (p.y - 0.62), 0.36 - p.y));`).join('\n        ')}
        d = min(d, crown);
      }
      else if (k == 7) d = min(l3Box(p - vec2(0.0, 0.32), vec2(0.34, 0.13)), l3Box(p - vec2(0.0, -0.16), vec2(0.05, 0.42)));
      else if (k == 8) d = max(abs(p.x) * 0.95 + (p.y - 0.5) * 0.7, -(p.y + 0.48));
      else {
        float a = atan(p.x, p.y), r = length(p);
        d = r - mix(0.22, 0.62, pow(0.5 + 0.5 * cos(5.0 * a), 3.0));
      }
      return d;
    }
    float l3DeviceMask(vec2 p, int k){ float d = l3DeviceD(p, k); float fw = fwidth(d) + 1e-4; return 1.0 - smoothstep(-fw, fw, d); }`;

