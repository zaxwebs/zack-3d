import * as THREE from 'three';

const { smoothstep, clamp } = THREE.MathUtils;
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
const linear = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const srgb = value => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

// CPU equivalent of the surface-mouth shader, used only for portable exports.
// Live speech only changes uniforms; it never uploads a full texture per frame.
export function bakeSpeechTexture(map, geometry, points, pose) {
  const canvas = document.createElement('canvas');
  canvas.width = map.image.width; canvas.height = map.image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(map.image, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const source = image.data.slice(), pixels = image.data, width = canvas.width, height = canvas.height;
  const uv = geometry.attributes.uv, indices = geometry.index.array;
  const presence = smoothstep(pose.open, 0, 0.10);
  const sample = (x, y) => {
    const offset = (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4;
    return [0, 1, 2].map(i => linear(source[offset + i] / 255));
  };
  for (let i = 0; i < indices.length; i += 3) {
    const vertices = [indices[i], indices[i + 1], indices[i + 2]], face = vertices.map(j => points[j]);
    if (face.every(p => p.z < 0.085) || face.every(p => p.y < 0.705) || face.every(p => p.y > 0.754)
      || face.every(p => p.x < -0.049) || face.every(p => p.x > 0.049)) continue;
    const [a, b, c] = vertices.map(j => [uv.getX(j) * width, uv.getY(j) * height]);
    const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(determinant) < 1e-8) continue;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const u = ((b[1] - c[1]) * (x + 0.5 - c[0]) + (c[0] - b[0]) * (y + 0.5 - c[1])) / determinant;
      const v = ((c[1] - a[1]) * (x + 0.5 - c[0]) + (a[0] - c[0]) * (y + 0.5 - c[1])) / determinant;
      const w = 1 - u - v;
      if (Math.min(u, v, w) < -0.00001) continue;
      const sx = face[0].x * u + face[1].x * v + face[2].x * w;
      const sy = face[0].y * u + face[1].y * v + face[2].y * w;
      const sz = face[0].z * u + face[1].z * v + face[2].z * w;
      if (sz <= 0.085) continue;
      const skin = sample(x, Math.round(y - 0.013 * height));
      const erase = (1 - smoothstep(Math.abs(sx), 0.038, 0.045))
        * (1 - smoothstep(Math.abs(sy - 0.7325 - 5.2 * sx * sx), 0.003, 0.007));
      let color = mix(sample(x, y), skin, erase * presence);
      const mouthWidth = (0.036 + 0.007 * pose.spread) * (1 - pose.round) + 0.021 * pose.round;
      const mx = sx / mouthWidth;
      const my = (sy - 0.7325 - 0.004 * mx * mx + 0.004 * pose.open) / (0.001 + 0.016 * pose.open);
      const distance = Math.abs(mx) ** 2.6 + my * my;
      const inside = 1 - smoothstep(distance, 0.955, 1.045);
      const rim = (1 - smoothstep(distance, 1.05, 1.40)) * presence;
      color = mix(color, skin.map((value, j) => value * [0.76, 0.50, 0.38][j]), rim * 0.36);
      let cavity = mix([0.025, 0.005, 0.004], [0.10, 0.018, 0.014], clamp(-my * 0.45 + 0.3, 0, 1));
      const teeth = smoothstep(my, 0.34, 0.42) * (1 - smoothstep(my, 0.76, 0.90))
        * (1 - smoothstep(Math.abs(mx), 0.72, 0.90)) * (1 - pose.round * 0.8);
      cavity = mix(cavity, [0.89, 0.81, 0.65], teeth);
      const tongue = (1 - smoothstep(Math.abs(mx), 0.60, 0.77)) * (1 - smoothstep(my, -0.50, -0.28)) * smoothstep(my, -0.95, -0.75);
      cavity = mix(cavity, [0.38, 0.075, 0.065], tongue * pose.open * 0.85);
      color = mix(color, cavity, inside * presence);
      const offset = (y * width + x) * 4;
      color.forEach((value, j) => { pixels[offset + j] = Math.round(clamp(srgb(value), 0, 1) * 255); });
    }
  }
  context.putImageData(image, 0, 0);
  const texture = map.clone();
  texture.source = new THREE.Source(canvas); texture.needsUpdate = true;
  return texture;
}
