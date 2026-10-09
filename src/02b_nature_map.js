/* ================================================================== */
/* nature map: one texel per metre over the whole land, read by the     */
/* terrain, grass and flower shaders (the rest lives in 05h_nature.js)  */
/*   R cut grass   G burnt ground   B fire burning now   A thrown earth */
/* ================================================================== */
const NAT = { res: 1024, data: new Uint8Array(1024 * 1024 * 4), tex: null, dirty: null };
NAT.tex = new THREE.DataTexture(NAT.data, NAT.res, NAT.res, THREE.RGBAFormat, THREE.UnsignedByteType);
NAT.tex.minFilter = THREE.LinearFilter; NAT.tex.magFilter = THREE.LinearFilter; NAT.tex.generateMipmaps = false;
NAT.tex.needsUpdate = true;
U.uNature = { value: NAT.tex };
const GLSL_NATURE = /* glsl */`
uniform sampler2D uNature;
vec4 natureAt(vec2 xz){
  vec2 uv = (xz + 512.0) / 1024.0;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(0.0);
  return texture(uNature, uv);
}
`;
// grow the rectangle of texels to send to the GPU this frame
function natMark(i0, j0, i1, j1) {
  const d = NAT.dirty;
  if (!d) { NAT.dirty = [i0, j0, i1, j1]; return; }
  if (i0 < d[0]) d[0] = i0; if (j0 < d[1]) d[1] = j0;
  if (i1 > d[2]) d[2] = i1; if (j1 > d[3]) d[3] = j1;
}
// send part of a data texture without re-uploading all of it (three.js 0.160 has no update ranges)
function texSubUpload(tex, x0, y0, w, h, rowLen, format, type, data, align) {
  const props = renderer.properties.get(tex);
  if (!props.__webglTexture || tex.version === 0 || props.__version !== tex.version) { tex.needsUpdate = true; return; }
  renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, align);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, rowLen);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, format, type, data);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
}
function natFlush() {
  const d = NAT.dirty;
  if (!d) return;
  NAT.dirty = null;
  texSubUpload(NAT.tex, d[0], d[1], d[2] - d[0] + 1, d[3] - d[1] + 1, NAT.res, gl.RGBA, gl.UNSIGNED_BYTE, NAT.data, 4);
}
