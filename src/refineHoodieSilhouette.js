import * as THREE from 'three';

/** Taper the hoodie around the pocket in character space. */
export function refineHoodieSilhouette({ root, geometry, skeleton, bones, centerX }) {
  const { position, normal } = geometry.attributes;
  const waist = skeleton.bones.indexOf(bones.Waist);
  const toCharacter = root.matrixWorld.clone().invert()
    .multiply(bones.Waist.matrixWorld).multiply(skeleton.boneInverses[waist]);
  const toGeometry = toCharacter.clone().invert();
  const normalToCharacter = new THREE.Matrix3().getNormalMatrix(toCharacter);
  const normalToGeometry = new THREE.Matrix3().getNormalMatrix(toGeometry);
  const point = new THREE.Vector3(), direction = new THREE.Vector3();
  const smoothstep = THREE.MathUtils.smoothstep;
  const fittedX = (x, y) => {
    const distance = x - centerX;
    const height = smoothstep(y, 0.39, 0.443) * (1 - smoothstep(y, 0.475, 0.56));
    const torso = 1 - smoothstep(Math.abs(distance), 0.115, 0.165);
    return x - distance * 0.075 * height * torso;
  };
  const step = 0.00001;
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(toCharacter);
    const { x, y } = point;
    const fitted = fittedX(x, y);
    if (fitted === x) continue;

    // Apply the inverse transpose of the local taper to preserve seam shading.
    const dx = (fittedX(x + step, y) - fittedX(x - step, y)) / (2 * step);
    const dy = (fittedX(x, y + step) - fittedX(x, y - step)) / (2 * step);
    direction.fromBufferAttribute(normal, i).applyMatrix3(normalToCharacter);
    direction.x /= dx;
    direction.y -= dy * direction.x;
    direction.applyNormalMatrix(normalToGeometry);
    normal.setXYZ(i, direction.x, direction.y, direction.z);

    point.x = fitted;
    point.applyMatrix4(toGeometry);
    position.setXYZ(i, point.x, point.y, point.z);
  }
  position.needsUpdate = normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
