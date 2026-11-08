"""Extract the reference into editable arrays; no geometry simplification."""
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
payload = bytearray()
layout = {}
for name, array in arrays.items():
    while len(payload) % 4:
        payload.append(0)
    layout[name] = {'byteOffset': len(payload), 'count': len(array),
                    'itemSize': array.shape[1], 'type': {'f': 'Float32Array', 'u': 'Uint32Array' if array.itemsize == 4 else 'Uint16Array'}[array.dtype.kind]}
    payload.extend(array.tobytes())
(out / 'geometry.bin').write_bytes(payload)
view = gltf['bufferViews'][gltf['images'][0]['bufferView']]
(out / 'basecolor.jpg').write_bytes(binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']])
manifest = {'format': 'zack-three-geometry-v1', 'arrays': layout,
            'nodes': gltf['nodes'], 'roots': gltf['scenes'][gltf['scene']]['nodes'],
            'joints': skin['joints'], 'material': {'roughness': 0.8999999761581421, 'metalness': 0}}
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
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
          'notes': ['UV seams and original normals preserved.', 'One continuous mesh, not separate anatomical objects.',
                    'Geometry is extracted exactly, not remeshed or parametrically reconstructed.']}
(ROOT / 'geometry-report.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
