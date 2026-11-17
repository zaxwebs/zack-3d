import * as THREE from 'three';

/** Move only the painted smile endpoints onto the existing mesh corners. */
export function alignSmileCornerUVs(geometry, topology) {
  const uv = geometry.attributes.uv;
  const cornerVertices = [topology.upper[0], topology.upper.at(-1)];
  const paintedTipVertices = [800, 2909];
  // Capture source coordinates before moving any UVs. The raised source tip
  // itself then samples unpainted skin, so it cannot leave a second smile end.
  const anchors = cornerVertices.map((vertex, i) => ({
    vertex, paintedTip: paintedTipVertices[i], point: topology.facePoints[vertex],
    source: new THREE.Vector2().fromBufferAttribute(uv, vertex),
    target: new THREE.Vector2().fromBufferAttribute(uv, paintedTipVertices[i]),
  }));
  const changedVertices = [];
  let maxShift = 0;
  for (let vertex = 0; vertex < uv.count; vertex++) {
    const p = topology.facePoints[vertex], u = uv.getX(vertex), v = uv.getY(vertex);
    if (p.z < 0.09 || u < 0.36 || u > 0.43 || v < 0.66 || v > 0.70) continue;
    let du = 0, dv = 0;
    for (const anchor of anchors) {
      const weight = 1 - THREE.MathUtils.smoothstep(p.distanceTo(anchor.point), 0.002, 0.0095);
      du += (anchor.target.x - anchor.source.x) * weight;
      dv += (anchor.target.y - anchor.source.y) * weight;
    }
    if (Math.abs(du) + Math.abs(dv) < 1e-9) continue;
    uv.setXY(vertex, u + du, v + dv); changedVertices.push(vertex);
    maxShift = Math.max(maxShift, Math.hypot(du, dv));
  }
  uv.needsUpdate = true;
  const report = { coreRadius: 0.002, radius: 0.0095, changedVertices, maxShift,
    anchors: anchors.map(({ vertex, paintedTip, source, target }) => ({ vertex, paintedTip, source: source.toArray(), target: target.toArray() })) };
  topology.report.cornerUVAlignment = report;
  return report;
}
