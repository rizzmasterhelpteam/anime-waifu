"""Retarget CC0 authored animation into complete normalized VRM pose clips.

This preserves the source's connected 3D joint rotations, including forearm
twist. It does not estimate poses from video or reconstruct limbs from Euler
angles. Source archives stay in ignored work/; only compact motion ships.
"""
import json
import struct
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation as R, Slerp
from condition_dance_motion import aligned, rotation_keys, position_keys
from retarget_dance_clips import rig_geometry

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT/'work/authored-motion'
PARENTS = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'upperChest': 'chest',
           'neck': 'upperChest', 'head': 'neck'}
for side in ['left', 'right']:
    for bone, parent in [('Shoulder', 'upperChest'), ('UpperArm', side+'Shoulder'),
                         ('LowerArm', side+'UpperArm'), ('Hand', side+'LowerArm'),
                         ('UpperLeg', 'hips'), ('LowerLeg', side+'UpperLeg'),
                         ('Foot', side+'LowerLeg'), ('Toes', side+'Foot')]:
        PARENTS[side+bone] = parent
    for finger in ['Index', 'Middle', 'Ring', 'Little', 'Thumb']:
        joints = ['Metacarpal', 'Proximal', 'Distal'] if finger == 'Thumb' else ['Proximal', 'Intermediate', 'Distal']
        for i, joint in enumerate(joints):
            PARENTS[side+finger+joint] = side+'Hand' if i == 0 else side+finger+joints[i-1]
BONES = list(PARENTS)


def mapping(kind):
    if kind == 'quaternius1':
        result = {'hips': 'DEF-hips', 'spine': 'DEF-spine.001', 'chest': 'DEF-spine.002',
                  'upperChest': 'DEF-spine.003', 'neck': 'DEF-neck', 'head': 'DEF-head'}
        names = ['shoulder', 'upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe']
    elif kind == 'quaternius2':
        result = {'hips': 'pelvis', 'spine': 'spine_01', 'chest': 'spine_02',
                  'upperChest': 'spine_03', 'neck': 'neck_01', 'head': 'Head'}
        names = ['clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball']
    else:
        result = {'hips': 'hips', 'spine': 'spine', 'chest': 'chest', 'head': 'head'}
        names = [None, 'upperarm', 'lowerarm', 'hand', 'upperleg', 'lowerleg', 'foot', 'toes']
    for side, suffix in [('left', 'L'), ('right', 'R')]:
        for bone, source in zip(['Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot', 'Toes'], names):
            if source:
                result[side+bone] = 'DEF-'+source+'.'+suffix if kind == 'quaternius1' else source+'_'+suffix.lower() if kind == 'quaternius2' else source+'.'+suffix.lower()
        if kind != 'kaykit':
            for finger, source in [('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Little', 'pinky'), ('Thumb', 'thumb')]:
                joints = ['Metacarpal', 'Proximal', 'Distal'] if finger == 'Thumb' else ['Proximal', 'Intermediate', 'Distal']
                for i, joint in enumerate(joints):
                    result[side+finger+joint] = ('DEF-'+('f_' if finger != 'Thumb' else '')+source+f'.0{i+1}.'+suffix) if kind == 'quaternius1' else source+f'_0{i+1}_'+suffix.lower()
    return result


class Source:
    def __init__(self, path, kind):
        raw = path.read_bytes()
        if path.suffix == '.glb':
            length = struct.unpack_from('<I', raw, 12)[0]
            self.doc = json.loads(raw[20:20+length])
            self.data = raw[28+length:]
        else:
            self.doc = json.loads(raw)
            self.data = (path.parent/self.doc['buffers'][0]['uri']).read_bytes()
        self.nodes = self.doc['nodes']
        self.parents = {c: i for i, n in enumerate(self.nodes) for c in n.get('children', [])}
        names = {n.get('name'): i for i, n in enumerate(self.nodes)}
        self.map = {bone: names[name] for bone, name in mapping(kind).items() if name in names}
        self.rest = self.world({})
        self.rest_rot = [v[0] for v in self.rest]
        self.leg = self.rest[self.map['hips']][1][1]-self.rest[self.map['leftFoot']][1][1]
        self.soles = {}
        for side in ['left', 'right']:
            foot = self.rest[self.map[side+'Foot']][1]
            toe = self.rest[self.map[side+'Toes']][1]
            self.soles[side] = [np.array([0, -foot[1], -.035*self.leg]), np.array([0, -foot[1], toe[2]-foot[2]])]

    def accessor(self, index):
        a = self.doc['accessors'][index]
        view = self.doc['bufferViews'][a['bufferView']]
        width = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
        return np.frombuffer(self.data, '<f4', a['count']*width, view.get('byteOffset', 0)+a.get('byteOffset', 0)).reshape(a['count'], width)

    def world(self, pose):
        cache = {}
        def visit(i):
            if i in cache:
                return cache[i]
            n = self.nodes[i]
            rot = R.from_quat(pose.get((i, 'rotation'), n.get('rotation', [0, 0, 0, 1])))
            pos = np.array(pose.get((i, 'translation'), n.get('translation', [0, 0, 0])))
            if i in self.parents:
                pr, pp = visit(self.parents[i]);pos = pp+pr.apply(pos);rot = pr*rot
            cache[i] = (rot, pos)
            return cache[i]
        return [visit(i) for i in range(len(self.nodes))]

    def sample(self, name):
        clip = next(a for a in self.doc['animations'] if a['name'] == name)
        tracks = []
        for c in clip['channels']:
            prop = c['target']['path']
            if prop not in ['rotation', 'translation']:
                continue
            sampler = clip['samplers'][c['sampler']]
            time = self.accessor(sampler['input'])[:, 0].astype(float)
            values = self.accessor(sampler['output'])
            tracks.append((c['target']['node'], prop, time, values, Slerp(time, R.from_quat(values)) if prop == 'rotation' else None))
        duration = max(t[-1] for _, _, t, _, _ in tracks)
        times = np.linspace(0, duration, round(duration*30)+1)
        rotations = {b: [] for b in BONES};positions = [];clearance = []
        for time in times:
            pose = {}
            for i, prop, keys, values, interpolator in tracks:
                t = np.clip(time, keys[0], keys[-1])
                pose[i, prop] = interpolator(t).as_quat() if interpolator else np.array([np.interp(t, keys, values[:, k]) for k in range(3)])
            world = self.world(pose)
            delta = {b: world[i][0]*self.rest_rot[i].inv() for b, i in self.map.items()}
            for bone in BONES:
                if bone not in delta:
                    rotations[bone].append([0, 0, 0, 1]);continue
                parent = PARENTS[bone]
                while parent and parent not in delta:
                    parent = PARENTS[parent]
                local = delta[parent].inv()*delta[bone] if parent else delta[bone]
                rotations[bone].append(local.as_quat())
            positions.append((world[self.map['hips']][1]-self.rest[self.map['hips']][1])/self.leg)
            clearance.append(min((world[self.map[side+'Foot']][1]+delta[side+'Foot'].apply(offset))[1] for side in ['left', 'right'] for offset in self.soles[side])/self.leg)
        clearance = np.array(clearance);clearance -= np.min(clearance)
        return times, {b: aligned(q) for b, q in rotations.items()}, np.array(positions), clearance


def fit_floor(rotations, positions, clearance, rig, soles, floor):
    """Fit floor height to target proportions, retaining authored airborne motion."""
    result = positions.copy()
    forward = {side: [] for side in ['left', 'right']}
    for i in range(len(result)):
        quats = {};points = {}
        for bone in BONES:
            parent = PARENTS[bone]
            local = R.from_quat(rotations[bone][i])
            quats[bone] = quats[parent]*local if parent else local
            if bone not in rig:
                points[bone] = points.get(parent, np.zeros(3));continue
            if parent:
                # Some avatars omit upperChest; its canonical rest point is chest.
                offset = rig[bone]-rig.get(parent, rig.get(PARENTS.get(parent), np.zeros(3)))
                points[bone] = points[parent]+quats[parent].apply(offset)
            else:
                points[bone] = np.zeros(3)
        result[i, 1] = floor-min((points[s+'Foot']+quats[s+'Foot'].apply(offset))[1] for s in ['left', 'right'] for offset in soles[s])+clearance[i]
        for side in forward:forward[side].append(points[side+'Foot'][2]+positions[i, 2])
    return result, max(float(np.ptp(v)) for v in forward.values())


def relaxed_idle(rotations, character):
    """Rebase the library's ready-to-fight stance to a relaxed character pose.

    Preserve the animator's relative 3D breathing/weight-shift motion, with a
    narrow stance and open hands suited to the avatars' fitted clothing.
    """
    result = {}
    arm = 1.20 if character == 'seraphina' else 1.30
    bases = {bone: R.identity() for bone in BONES}
    for side, sign in [('left', 1), ('right', -1)]:
        bases[side+'UpperLeg'] = R.from_euler('z', -sign*.012)
        bases[side+'LowerLeg'] = R.from_euler('x', .035)
        bases[side+'Foot'] = R.from_euler('x', -.035)
        bases[side+'Shoulder'] = R.from_euler('z', -sign*.02)
        bases[side+'UpperArm'] = R.from_euler('z', -sign*arm)
        bases[side+'LowerArm'] = R.from_euler('y', -sign*.15)
        for finger in ['Index', 'Middle', 'Ring', 'Little', 'Thumb']:
            joints = ['Metacarpal', 'Proximal', 'Distal'] if finger == 'Thumb' else ['Proximal', 'Intermediate', 'Distal']
            for joint in joints:bases[side+finger+joint] = R.from_euler('z', -sign*.10)
    for bone, values in rotations.items():
        source = R.from_quat(values)
        result[bone] = aligned((bases[bone]*source[0].inv()*source).as_quat())
    return result


def close_loop(times, rotations, positions, clearance, seconds=.18):
    """Close mismatched endpoints with a short, shared whole-pose easing.

    Already closed locomotion stays untouched. Do not extrapolate knee velocity
    across contact: a knee near extension must never bend backwards at a seam.
    """
    if max((R.from_quat(q[0]).inv()*R.from_quat(q[-1])).magnitude() for q in rotations.values()) < .001:
        return rotations, positions, clearance
    span = min(seconds, times[-1]*.2)
    indices = np.flatnonzero(times > times[-1]-span)
    result = {bone: values.copy() for bone, values in rotations.items()}
    positions = positions.copy();clearance = clearance.copy()
    for bone, values in result.items():
        source = R.from_quat(values)
        if (source[0].inv()*source[-1]).magnitude() < .001:continue
        for i in indices:
            u = (times[i]-(times[-1]-span))/span;weight = u*u*u*(10-15*u+6*u*u)
            delta = (source[i].inv()*source[0]).as_rotvec()
            values[i] = (source[i]*R.from_rotvec(delta*weight)).as_quat()
        for i in np.flatnonzero(times < span):
            u = times[i]/span;weight = u*u*u*(10-15*u+6*u*u)
            values[i] = (source[0]*R.from_rotvec((source[0].inv()*source[i]).as_rotvec()*weight)).as_quat()
        result[bone] = aligned(values)
    if np.linalg.norm(positions[0]-positions[-1]) > .001:
        for i in indices:
            u = (times[i]-(times[-1]-span))/span;weight = u*u*u*(10-15*u+6*u*u)
            positions[i] = positions[i]*(1-weight)+positions[0]*weight
            clearance[i] = max(0,clearance[i]*(1-weight)+clearance[0]*weight)
    return result, positions, clearance


def export(character, clips):
    rig = rig_geometry(character)
    name = 'companion_alt' if character == 'gothic_red' else 'seraphina'
    raw = (ROOT/'assets/models'/f'{name}.vrm').read_bytes();document = json.loads(raw[20:20+struct.unpack_from('<I', raw, 12)[0]])
    parents = {c: i for i, n in enumerate(document['nodes']) for c in n.get('children', [])}
    def matrix(i):
        n = document['nodes'][i];m = np.eye(4);m[:3, :3] = R.from_quat(n.get('rotation', [0, 0, 0, 1])).as_matrix()@np.diag(n.get('scale', [1, 1, 1]));m[:3, 3] = n.get('translation', [0, 0, 0]);return matrix(parents[i])@m if i in parents else m
    human = document['extensions']['VRMC_vrm']['humanoid']['humanBones']
    hips_y = matrix(human['hips']['node'])[1, 3];ankle_y = matrix(human['leftFoot']['node'])[1, 3];leg = hips_y-ankle_y
    soles = {side: [np.array([0, -ankle_y/leg, -.035]), np.array([0, -ankle_y/leg, rig[side+'Toes'][2]-rig[side+'Foot'][2]])] for side in ['left', 'right']}
    floor = -hips_y/leg
    binary = bytearray();views = [];accessors = [];animations = [];metadata = {};accessor_cache = {}
    def accessor(values, width):
        data = np.array(values, dtype='<f4');key = (width, data.tobytes())
        if key in accessor_cache:return accessor_cache[key]
        while len(binary) % 4:binary.append(0)
        offset = len(binary);binary.extend(key[1])
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': data.nbytes})
        a = {'bufferView': len(views)-1, 'componentType': 5126, 'count': len(values), 'type': {1: 'SCALAR', 3: 'VEC3', 4: 'VEC4'}[width]}
        if width == 1:a.update(min=[float(min(values))], max=[float(max(values))])
        accessors.append(a);accessor_cache[key] = len(accessors)-1;return len(accessors)-1
    for name, (times, rotations, positions, clearance, source_name) in clips.items():
        if name == 'idle':rotations = relaxed_idle(rotations, character)
        loop = name in ['idle', 'walk', 'dance', 'talk', 'foldArms', 'wave', 'celebrate']
        if loop:rotations, positions, clearance = close_loop(times, rotations, positions, clearance)
        positions, foot_travel = fit_floor(rotations, positions, clearance, rig, soles, floor)
        samplers = [];channels = []
        for bone, track in rotations.items():
            keys = rotation_keys(times, track, tolerance=.08)
            samplers.append({'input': accessor(times[keys], 1), 'output': accessor(track[keys], 4), 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers)-1, 'target': {'node': BONES.index(bone), 'path': 'rotation'}})
        keys = position_keys(times, positions, tolerance=.0002)
        samplers.append({'input': accessor(times[keys], 1), 'output': accessor(positions[keys], 3), 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers)-1, 'target': {'node': len(BONES), 'path': 'translation'}})
        animations.append({'name': name, 'channels': channels, 'samplers': samplers})
        metadata[name] = {'sourceClip': source_name, 'duration': float(times[-1]), 'sampleRate': 30, 'airborneHeightLegLengths': float(max(clearance)), 'loop': loop, 'seamBlendSeconds': .18 if loop else 0, 'footTravelLegLengths': foot_travel}
    doc = {'asset': {'version': '2.0', 'generator': 'Authored CC0 motion retarget'}, 'scene': 0,
           'scenes': [{'nodes': list(range(len(BONES)+1))}], 'nodes': [{'name': b} for b in BONES+['motionRoot']],
           'buffers': [{'byteLength': len(binary)}], 'bufferViews': views, 'accessors': accessors, 'animations': animations,
           'extras': {'method': 'complete source world/rest quaternion retarget; no Euler clamping or video inference', 'license': 'CC0-1.0', 'clips': metadata, 'soleOffsets': {s: [o.tolist() for o in offsets] for s, offsets in soles.items()}, 'floorHipRelative': floor}}
    encoded = json.dumps(doc, separators=(',', ':')).encode();encoded += b' '*((-len(encoded)) % 4)
    blob = struct.pack('<III', 0x46546c67, 2, 28+len(encoded)+len(binary))+struct.pack('<II', len(encoded), 0x4e4f534a)+encoded+struct.pack('<II', len(binary), 0x004e4942)+binary
    path = ROOT/'assets/animations'/character/'authored-actions.glb';path.write_bytes(blob)
    print(character, len(blob), metadata, flush=True)


if __name__ == '__main__':
    sources = {'q1': Source(WORK/'AnimationLibrary_Godot_Standard.gltf', 'quaternius1'),
               'q2': Source(WORK/'library2.glb', 'quaternius2'),
               'kay': Source(WORK/'kaykit/Rig_Medium_Simulation.glb', 'kaykit')}
    selected = {'idle': ('q1', 'Idle_Loop'), 'walk': ('q1', 'Walk_Loop'),
                'dance': ('q1', 'Dance_Loop'), 'talk': ('q1', 'Idle_Talking_Loop'),
                'water': ('q2', 'Farm_Watering'),
                'foldArms': ('q2', 'Idle_FoldArms_Loop'), 'consume': ('q2', 'Consume'),
                'wave': ('kay', 'Waving'), 'celebrate': ('kay', 'Cheering')}
    clips = {name: (*sources[source].sample(clip), clip) for name, (source, clip) in selected.items()}
    for character in ['seraphina', 'gothic_red']:
        export(character, clips)
