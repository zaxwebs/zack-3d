import * as THREE from 'three';

/** A beveled crown arch seated in one closed gum/palate volume. Face space. */
export function createUpperDentalArch({ centerX, halfWidth, sampleSeam, addPoint, tint }) {
  const frontColumns = 9, sideColumns = 4, radius = halfWidth * 0.83;
  const frontZ = sampleSeam(centerX).z - 0.00765;
  const sideZ = (sampleSeam(centerX - radius).z + sampleSeam(centerX + radius).z) / 2 - 0.00905;
  const stations = [];
  for (let i = 0; i < frontColumns; i++) {
    const t = i / (frontColumns - 1) * 2 - 1, anchor = sampleSeam(centerX + radius * t);
    stations.push({ point: new THREE.Vector3(anchor.x, anchor.y, frontZ - (frontZ - sideZ) * t * t),
      anchor, follow: 1, bottom: -0.0056 + 0.0012 * Math.abs(t) ** 1.6 });
  }
  // Continue around the canines into the posterior teeth instead of capping
  // the visible smile strip. The small inward taper is at the back of the jaw.
  for (const side of [-1, 1]) {
    const end = stations[side < 0 ? 0 : stations.length - 1], continuation = [];
    for (let i = 0; i < sideColumns; i++) {
      const t = (i + 1) / sideColumns, width = [1.03, 1.035, 1, 0.94][i];
      continuation.push({ point: new THREE.Vector3(centerX + side * radius * width,
        end.point.y + 0.0004 * t, THREE.MathUtils.lerp(end.point.z, 0.078, t)),
      anchor: end.anchor, follow: 1 - THREE.MathUtils.smoothstep(t, 0, 1), bottom: -0.0044 });
    }
    if (side < 0) stations.unshift(...continuation.reverse()); else stations.push(...continuation);
  }
  const toothRows = [], gumRows = [[], [], [], []], toothIndices = [], gumIndices = [];
  const palateCenter = new THREE.Vector3(centerX, 0.7415, 0.092);
  const movement = (station, factor = 1) => ({ toothAnchor: station.anchor.clone(), toothFollow: station.follow * factor });
  for (const [i, station] of stations.entries()) {
    const previous = stations[Math.max(0, i - 1)].point, next = stations[Math.min(stations.length - 1, i + 1)].point;
    const outward = new THREE.Vector3(previous.z - next.z, 0, next.x - previous.x).normalize();
    const at = (height, offset) => station.point.clone().addScaledVector(outward, offset).add(new THREE.Vector3(0, height, 0));
    const halfThickness = 0.00185, bevel = 0.0007, bottom = station.bottom;
    // Rotate the section around the arch, so the side teeth have real cheek-
    // to-tongue thickness. The incisal/occlusal edge has two small chamfers.
    toothRows.push([[0.0017, halfThickness], [0.0017, -halfThickness],
      [bottom + bevel, -halfThickness], [bottom, -halfThickness + bevel],
      [bottom, halfThickness - bevel], [bottom + bevel, halfThickness]]
      .map(([height, offset]) => addPoint(at(height, offset), movement(station))));
    const inner = at(0.0007, -0.0021);
    const palate = inner.clone().lerp(palateCenter, 0.48); palate.y += 0.0015;
    for (const [layer, point] of [at(0.0035, 0.0031), at(0.0007, 0.0021), inner, palate].entries()) {
      const vertex = addPoint(point, movement(station, layer === 3 ? 0.35 : 1));
      gumRows[layer].push(vertex); tint(vertex, ['#75404b', '#a16068', '#94545e', '#683642'][layer]);
    }
  }
  const columns = stations.length, profileSize = toothRows[0].length;
  for (let i = 0; i < columns - 1; i++) for (let k = 0; k < profileSize; k++) {
    const j = (k + 1) % profileSize, a = toothRows[i][k], b = toothRows[i + 1][k], c = toothRows[i][j], d = toothRows[i + 1][j];
    toothIndices.push(a, b, c, b, d, c);
  }
  const first = toothRows[0], last = toothRows.at(-1);
  for (let k = 1; k < profileSize - 1; k++) toothIndices.push(first[0], first[k], first[k + 1], last[0], last[k + 1], last[k]);
  // Closed rings include the back chord. The roof rises behind the teeth;
  // it does not fill the horseshoe's open center with a white front plate.
  for (let layer = 0; layer < gumRows.length - 1; layer++) for (let i = 0; i < columns; i++) {
    const j = (i + 1) % columns, a = gumRows[layer][i], b = gumRows[layer][j], c = gumRows[layer + 1][i], d = gumRows[layer + 1][j];
    gumIndices.push(a, c, b, b, c, d);
  }
  const roofTop = addPoint(new THREE.Vector3(centerX, 0.748, 0.092)); tint(roofTop, '#572d3a');
  const roof = addPoint(palateCenter); tint(roof, '#62323e');
  for (let i = 0; i < columns; i++) {
    const j = (i + 1) % columns;
    gumIndices.push(roofTop, gumRows[0][i], gumRows[0][j], roof, gumRows[3][j], gumRows[3][i]);
  }
  return { toothIndices, gumIndices, report: { teethColumns: columns, toothProfileSize: profileSize,
    toothRows, frontToothColumns: frontColumns, posteriorToothColumns: sideColumns,
    gumRows, palateRoof: roof, gumPalateTriangles: gumIndices.length / 3 } };
}
