"""Repaint cord roots and circular eyelets from mesh geometry; no generated art."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'public/model/manifest.json').read_text())
binary = (ROOT / 'public/model/geometry.bin').read_bytes()
types = {'Float32Array': '<f4', 'Uint32Array': '<u4', 'Uint16Array': '<u2'}
arrays = {name: np.frombuffer(binary, dtype=types[a['type']], offset=a['byteOffset'], count=a['count'] * a['itemSize']).reshape(-1, a['itemSize']) for name, a in manifest['arrays'].items()}
nodes = manifest['nodes']
parents = {child: index for index, node in enumerate(nodes) for child in node.get('children', [])}
mesh_node = next(i for i, node in enumerate(nodes) if 'mesh' in node)
matrix = np.eye(4)
index = mesh_node
while True:
    matrix = np.array(nodes[index].get('matrix', np.eye(4).T.flatten())).reshape(4, 4).T @ matrix
    if index not in parents:
        break
    index = parents[index]
positions = np.c_[arrays['position'], np.ones(len(arrays['position']))] @ matrix.T
positions = positions[:, :3]
triangles = arrays['index'].reshape(-1, 3)
source = np.array(Image.open(ROOT / 'public/model/basecolor.jpg').convert('RGB'))
result = source.copy()
height, width = source.shape[:2]
uvs = arrays['uv'] * [width, height]
allowed = np.zeros((height, width), bool)

def smooth(a, b, value):
    t = np.clip((value - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def raster(bounds, predicate):
    """UV texels plus their interpolated rest-pose surface positions."""
    left, top, right, bottom = bounds
    records = {}
    for tri in triangles:
        uv = uvs[tri]
        if not (left <= uv[:, 0].mean() < right and top <= uv[:, 1].mean() < bottom):
            continue
        p = positions[tri]
        if not predicate(p.mean(axis=0)):
            continue
        lo = np.maximum(np.floor(uv.min(axis=0)).astype(int), [left, top])
        hi = np.minimum(np.ceil(uv.max(axis=0)).astype(int), [right - 1, bottom - 1])
        if np.any(lo > hi):
            continue
        x, y = np.meshgrid(np.arange(lo[0], hi[0] + 1), np.arange(lo[1], hi[1] + 1))
        points = np.c_[x.ravel() + .5, y.ravel() + .5]
        basis = np.c_[uv[1] - uv[0], uv[2] - uv[0]]
        if abs(np.linalg.det(basis)) < 1e-8:
            continue
        ab = (points - uv[0]) @ np.linalg.inv(basis).T
        bary = np.c_[1 - ab.sum(axis=1), ab]
        valid = np.all(bary >= -1e-5, axis=1)
        for xy, position in zip(np.c_[x.ravel(), y.ravel()][valid], bary[valid] @ p):
            records[tuple(xy)] = position
    xy = np.array(list(records), dtype=int)
    return xy, np.array(list(records.values()))

def sample_lower_cord(targets, candidates):
    """Nearest surface samples at the same circumference, lower on the cord."""
    best_distance = np.full(len(targets), np.inf)
    samples = np.zeros((len(targets), 2))
    for tri in candidates:
        p = positions[tri]
        u, v = p[1] - p[0], p[2] - p[0]
        gram = np.array([[u @ u, u @ v], [u @ v, v @ v]])
        if abs(np.linalg.det(gram)) < 1e-16:
            continue
        ab = np.c_[(targets - p[0]) @ u, (targets - p[0]) @ v] @ np.linalg.inv(gram).T
        bary = np.maximum(np.c_[1 - ab.sum(axis=1), ab], 0)
        bary /= bary.sum(axis=1, keepdims=True)
        distance = np.sum((bary @ p - targets) ** 2, axis=1)
        better = distance < best_distance
        samples[better] = (bary @ uvs[tri])[better]
        best_distance[better] = distance[better]
    pixels = np.clip(samples, [0, 0], [width - 1.001, height - 1.001])
    base = np.floor(pixels).astype(int)
    t = pixels - base
    a = source[base[:, 1], base[:, 0]] * (1 - t[:, :1]) + source[base[:, 1], base[:, 0] + 1] * t[:, :1]
    b = source[base[:, 1] + 1, base[:, 0]] * (1 - t[:, :1]) + source[base[:, 1] + 1, base[:, 0] + 1] * t[:, :1]
    return a * (1 - t[:, 1:]) + b * t[:, 1:]

reports = []
for name, sign, cord_bounds, eyelet_bounds in [
    ('right', -1, (560, 1000, 740, 1450), (3912, 2940, 4040, 3068)),
    ('left', 1, (3200, 3050, 3800, 3350), (2128, 2784, 2256, 2912)),
]:
    # Both cord islands are distinct from the hoodie/eyelet islands.
    cord_filter = lambda p: .008 < p[0] * sign < .045 and .53 < p[1] < .657 and p[2] > .075
    cord_xy, cord_p = raster(cord_bounds, cord_filter)
    cord_triangles = []
    for tri in triangles:
        uv = uvs[tri].mean(axis=0)
        if cord_bounds[0] < uv[0] < cord_bounds[2] and cord_bounds[1] < uv[1] < cord_bounds[3] and cord_filter(positions[tri].mean(axis=0)):
            cord_triangles.append(tri)
    def cross_section(y):
        points = []
        for tri in cord_triangles:
            p = positions[tri]
            for a, b in [(0, 1), (1, 2), (2, 0)]:
                if (p[a, 1] - y) * (p[b, 1] - y) < 0:
                    points.append(p[a] + (p[b] - p[a]) * (y - p[a, 1]) / (p[b, 1] - p[a, 1]))
        points = np.unique(np.round(points, 8), axis=0)
        if len(points) < 3:
            raise RuntimeError(f'Incomplete {name} cord cross-section at {y}')
        planar = points[:, [0, 2]]
        middle = planar.mean(axis=0)
        planar = planar[np.argsort(np.arctan2(planar[:, 1] - middle[1], planar[:, 0] - middle[0]))]
        following = np.roll(planar, -1, axis=0)
        cross = planar[:, 0] * following[:, 1] - following[:, 0] * planar[:, 1]
        middle = ((planar + following) * cross[:, None]).sum(axis=0) / (3 * cross.sum())
        return np.array([middle[0], y, middle[1]])
    # Use cross-section centers at two heights instead of the surface PCA's
    # radial direction on this coarse, asymmetric mesh.
    centers = [cross_section(y) for y in [.608, .624]]
    axis = centers[1] - centers[0]
    axis /= np.linalg.norm(axis)
    center = centers[1]
    tip_centers = [cross_section(y) for y in [.638, .646]]
    root_axis = tip_centers[1] - tip_centers[0]
    root_axis /= np.linalg.norm(root_axis)
    root_band = cord_p[:, 1] > .627
    xy, p = cord_xy[root_band], cord_p[root_band]
    # Preserve the circumferential shading instead of sampling the center of
    # the shaft when the root cap tapers toward its tip.
    root_line = tip_centers[0] + ((p[:, 1] - tip_centers[0][1]) / root_axis[1])[:, None] * root_axis
    radial = p - root_line
    radial -= (radial @ axis)[:, None] * axis
    radial /= np.maximum(np.linalg.norm(radial, axis=1, keepdims=True), 1e-9)
    sample_center = center + axis * ((.617 - center[1]) / axis[1])
    lower = np.abs(cord_p[:, 1] - .617) < .004
    lower_line = center + ((cord_p[lower, 1] - center[1]) / axis[1])[:, None] * axis
    shaft_radius = np.median(np.linalg.norm(cord_p[lower] - lower_line, axis=1))
    targets = sample_center + radial * shaft_radius
    candidates = [tri for tri in cord_triangles if .602 < positions[tri, 1].mean() < .629]
    colors = sample_lower_cord(targets, candidates)
    blend = smooth(.627, .637, p[:, 1])[:, None]
    result[xy[:, 1], xy[:, 0]] = np.rint(source[xy[:, 1], xy[:, 0]] * (1 - blend) + colors * blend).astype(np.uint8)
    allowed[xy[:, 1], xy[:, 0]] = True

    hoodie_xy, hoodie_p = raster(eyelet_bounds, lambda q: .005 < q[0] * sign < .05 and .625 < q[1] < .67 and q[2] > .06)
    colors = source[hoodie_xy[:, 1], hoodie_xy[:, 0]]
    white = colors.mean(axis=1) > 150
    eye_points = hoodie_p[white]
    origin = eye_points.mean(axis=0)
    _, _, plane = np.linalg.svd(eye_points - origin, full_matrices=False)
    normal = plane[2]
    if normal[2] < 0:
        normal = -normal
    basis = plane[:2]
    projected = (eye_points - origin) @ basis.T
    circle, *_ = np.linalg.lstsq(np.c_[2 * projected, np.ones(len(projected))], (projected ** 2).sum(axis=1), rcond=None)
    fitted_center = origin + circle[:2] @ basis
    # Use the local root centerline at the attachment height. Project along
    # the hoodie surface normal: the hanging shaft does not run straight
    # through the cloth, so extrapolating its lower axis gives a false hit.
    root_center = tip_centers[0] + root_axis * ((fitted_center[1] - tip_centers[0][1]) / root_axis[1])
    intersection = root_center + normal * ((origin - root_center) @ normal)
    ring_center = intersection
    radius = np.linalg.norm((hoodie_p - ring_center) @ basis.T, axis=1)
    inner_radius, outer_radius = .0056, .0074
    repair = radius < .014
    dark = (colors.mean(axis=1) > 20) & (colors.mean(axis=1) < 70) & (radius > .012) & (radius < .025)
    donors = hoodie_p[dark]
    donor_colors = colors[dark]
    if not len(donors):
        raise RuntimeError(f'No hoodie fabric samples found for {name}')
    selected_xy, selected_p = hoodie_xy[repair], hoodie_p[repair]
    nearest = np.argmin(((selected_p[:, None] - donors[None]) ** 2).sum(axis=2), axis=1)
    background = donor_colors[nearest].astype(float)
    r = radius[repair]
    opening = 1 - smooth(inner_radius - .0003, inner_radius + .0003, r)
    background = background * (1 - opening[:, None]) + np.array([17, 18, 19]) * opening[:, None]
    ring = smooth(inner_radius - .00025, inner_radius + .00025, r) * (1 - smooth(outer_radius - .00025, outer_radius + .00025, r))
    paint = background * (1 - ring[:, None]) + np.array([224, 227, 228]) * ring[:, None]
    # Soften only the far edge of the repair into the untouched hoodie.
    alpha = (1 - smooth(.0125, .014, r))[:, None]
    result[selected_xy[:, 1], selected_xy[:, 0]] = np.rint(colors[repair] * (1 - alpha) + paint * alpha).astype(np.uint8)
    allowed[selected_xy[:, 1], selected_xy[:, 0]] = True
    reports.append({'side': name, 'cordAxis': axis.tolist(), 'cordHoodieIntersection': intersection.tolist(), 'ringCenter': ring_center.tolist(), 'ringNormal': normal.tolist(), 'innerRadius': inner_radius, 'outerRadius': outer_radius, 'cordRootTexels': len(xy), 'eyeletTexels': len(selected_xy)})

# Extend edge texels one pixel into the atlas gutter to prevent bilinear white
# bleed. Neighbouring UV islands are otherwise left untouched.
changed = np.any(result != source, axis=2)
for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
    shift = np.roll(changed, (dy, dx), (0, 1)) & ~allowed
    shifted_colors = np.roll(result, (dy, dx), (0, 1))
    result[shift] = shifted_colors[shift]
    allowed[shift] = True
output = ROOT / 'public/model/basecolor-drawstrings.webp'
Image.fromarray(result).save(output, 'WEBP', lossless=True, quality=100, method=4)
decoded = np.array(Image.open(output).convert('RGB'))
assert np.array_equal(decoded, result), 'Lossless output must preserve the composited pixels'
changed = np.any(decoded != source, axis=2)
assert not np.any(changed & ~allowed), 'Texture changed outside the geometry masks'
report = {'method': 'geometry-projected circles and original-cord texture extension', 'changedPixels': int(changed.sum()), 'outsideChanges': 0, 'drawstrings': reports}
(ROOT / 'artifacts/drawstrings').mkdir(parents=True, exist_ok=True)
(ROOT / 'artifacts/drawstrings/verification.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
