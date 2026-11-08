"""Extract the reference with compact joint, weight, and index storage."""
import json
import struct
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
raw = (ROOT / 'Zack 3D V2.glb').read_bytes()
json_length, _ = struct.unpack_from('<II', raw, 12)
gltf = json.loads(raw[20:20 + json_length])
binary = raw[28 + json_length:]
out = ROOT / 'public' / 'model'
out.mkdir(parents=True, exist_ok=True)
types = {5126: '<f4', 5125: '<u4', 5123: '<u2'}
sizes = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def accessor(index):
    a = gltf['accessors'][index]
    v = gltf['bufferViews'][a['bufferView']]
    assert 'sparse' not in a and 'byteStride' not in v
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(binary, dtype=types[a['componentType']],
                         count=a['count'] * sizes[a['type']], offset=start).reshape(a['count'], -1)

primitive = gltf['meshes'][0]['primitives'][0]
names = {'POSITION': 'position', 'NORMAL': 'normal', 'TEXCOORD_0': 'uv',
         'JOINTS_0': 'skinIndex', 'WEIGHTS_0': 'skinWeight'}
arrays = {names[k]: accessor(v) for k, v in primitive['attributes'].items()}
arrays['index'] = accessor(primitive['indices'])
skin = gltf['skins'][0]
arrays['inverseBindMatrices'] = accessor(skin['inverseBindMatrices'])

if arrays['index'].max() > np.iinfo(np.uint16).max:
    raise ValueError('Mesh needs 32-bit indices')
if arrays['skinIndex'].max() > np.iinfo(np.uint8).max:
    raise ValueError('Skeleton needs 16-bit joint indices')

weights = arrays['skinWeight'].astype(np.float64)
weight_sums = weights.sum(axis=1, keepdims=True)
if np.any(weight_sums <= 0) or np.any(weights < 0):
    raise ValueError('Skin weights must be nonnegative and have a positive sum')
normalized_weights = weights / weight_sums
scaled_weights = normalized_weights * 255
quantized_weights = np.floor(scaled_weights).astype(np.uint16)
remainders = scaled_weights - quantized_weights
units_left = 255 - quantized_weights.sum(axis=1)
remainder_order = np.argsort(-remainders, axis=1)
rows = np.arange(len(quantized_weights))
for rank in range(4):
    rows_to_increment = units_left > rank
    quantized_weights[rows[rows_to_increment], remainder_order[rows_to_increment, rank]] += 1
packed_weights = quantized_weights.astype(np.uint8)

packed_arrays = dict(arrays)
packed_arrays['skinIndex'] = arrays['skinIndex'].astype('<u1')
packed_arrays['skinWeight'] = packed_weights
packed_arrays['index'] = arrays['index'].astype('<u2')
max_weight_quantization_error = float(np.max(np.abs(packed_weights.astype(np.float64) / 255 - normalized_weights)))
payload = bytearray()
layout = {}
type_names = {('f', 4): 'Float32Array', ('u', 4): 'Uint32Array',
              ('u', 2): 'Uint16Array', ('u', 1): 'Uint8Array'}
for name, array in packed_arrays.items():
    while len(payload) % 4:
        payload.append(0)
    array_type = type_names[(array.dtype.kind, array.dtype.itemsize)]
    layout[name] = {'byteOffset': len(payload), 'count': len(array),
                    'itemSize': array.shape[1], 'type': array_type}
    if name == 'skinWeight':
        layout[name]['normalized'] = True
    payload.extend(array.tobytes())
(out / 'geometry.bin').write_bytes(payload)
view = gltf['bufferViews'][gltf['images'][0]['bufferView']]
(out / 'basecolor.jpg').write_bytes(binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']])
manifest = {'format': 'zack-three-geometry-v2', 'arrays': layout,
            'nodes': gltf['nodes'], 'roots': gltf['scenes'][gltf['scene']]['nodes'],
            'joints': skin['joints'], 'material': {'roughness': 0.8999999761581421, 'metalness': 0}}
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2), newline='\r\n')
p = arrays['position']
idx = arrays['index'].reshape(-1, 3)
area = np.linalg.norm(np.cross(p[idx[:, 1]] - p[idx[:, 0]], p[idx[:, 2]] - p[idx[:, 0]]), axis=1) / 2
report = {'source': 'Zack 3D V2.glb', 'generator': gltf['asset']['generator'],
          'meshCount': len(gltf['meshes']), 'vertices': len(p), 'triangles': len(idx),
          'bones': len(skin['joints']), 'animationClips': len(gltf.get('animations', [])),
          'localBounds': {'min': p.min(axis=0).tolist(), 'max': p.max(axis=0).tolist()},
          'textureSize': list(Image.open(out / 'basecolor.jpg').size),
          'degenerateTriangles': int(np.count_nonzero(area < 1e-12)),
          'maxSkinWeightSumError': float(np.max(np.abs(arrays['skinWeight'].sum(axis=1) - 1))),
          'maxSkinWeightQuantizationError': max_weight_quantization_error,
          'packedGeometryBytes': len(payload),
          'notes': ['Position, normal, UV, and topology data are preserved.',
                    'Joint indices use 8-bit storage, skin weights use normalized 8-bit storage, and triangle indices use 16-bit storage.',
                    'Skin weights are rounded with a largest-remainder pass so each vertex retains a total weight of 255.',
                    'One continuous mesh, not separate anatomical objects.',
                    'Geometry is extracted without remeshing or topology simplification.']}
(ROOT / 'geometry-report.json').write_text(json.dumps(report, indent=2), newline='\r\n')
print(json.dumps(report, indent=2))
