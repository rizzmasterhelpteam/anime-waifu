"""Bake source-video landmarks into normalized humanoid GLB animation.

Source motion is sampled from the 240 frames used by SpriteDance. Single-view
tracking is then repaired, constrained and smoothed for the adult humanoid rigs.
Unreliable spins become modest turns; redundant keys are removed within measured
angular and positional error tolerances before export.
"""
import argparse
import json
import struct
from pathlib import Path

import numpy as np
from scipy.ndimage import median_filter
from scipy.signal import savgol_filter
from scipy.spatial.transform import Rotation as R
from refine_dance_arms import refine
from condition_dance_motion import condition, rotation_keys, position_keys

ROOT = Path(__file__).resolve().parents[1]
BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
         'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
         'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
         'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
         'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'root']
FINGERS = [side+finger+joint for side in ['left', 'right']
           for finger in ['Index', 'Middle', 'Ring', 'Little']
           for joint in ['Proximal', 'Intermediate', 'Distal']]
FINGERS += [side+'Thumb'+joint for side in ['left', 'right']
            for joint in ['Metacarpal', 'Proximal', 'Distal']]
BONES += FINGERS
IDENTITY = R.identity()


def rig_geometry(character):
    name = 'companion_alt' if character == 'gothic_red' else 'seraphina'
    binary = (ROOT/'assets/models'/f'{name}.vrm').read_bytes()
    document = json.loads(binary[20:20+struct.unpack_from('<I', binary, 12)[0]])
    nodes = document['nodes']
    parents = {child: i for i, node in enumerate(nodes) for child in node.get('children', [])}
    def matrix(i):
        node = nodes[i]
        m = np.eye(4)
        m[:3, :3] = R.from_quat(node.get('rotation', [0, 0, 0, 1])).as_matrix() @ np.diag(node.get('scale', [1, 1, 1]))
        m[:3, 3] = node.get('translation', [0, 0, 0])
        return matrix(parents[i]) @ m if i in parents else m
    points = {key: matrix(value['node'])[:3, 3] for key, value in document['extensions']['VRMC_vrm']['humanoid']['humanBones'].items()}
    length = points['hips'][1]-points['leftFoot'][1]
    origin = points['hips'].copy()
    return {key: (value-origin)/length for key, value in points.items()}


def unit(vector, fallback=(0, 1, 0)):
    length = np.linalg.norm(vector)
    return np.asarray(fallback) if length < 1e-7 else vector / length


def aim(rest, target):
    a, b = unit(rest), unit(target, rest)
    dot = np.dot(a, b)
    if dot < -.9999:
        axis = unit(np.cross(a, [0, 0, 1]), [0, 1, 0])
        return R.from_rotvec(axis * np.pi)
    q = np.r_[np.cross(a, b), 1 + dot]
    return R.from_quat(q / np.linalg.norm(q))


def basis(left, up):
    x = unit(left, (1, 0, 0))
    z = unit(np.cross(x, up), (0, 0, 1))
    y = unit(np.cross(z, x))
    return R.from_matrix(np.column_stack([x, y, z]))


def clean(raw):
    """Interpolate missing/occluded landmarks and remove sub-frame jitter."""
    count = len(raw['records'])
    arrays = {}
    for kind in ['image', 'world']:
        data = np.full((count, 33, 5), np.nan)
        for i, record in enumerate(raw['records']):
            if kind in record:
                data[i] = record[kind]
        for joint in range(33):
            confidence = data[:, joint, 3]
            good = np.isfinite(confidence) & (confidence > .22)
            if np.count_nonzero(good) < 2:
                raise ValueError(f'Insufficient tracking for {kind} joint {joint}')
            for axis in range(3):
                data[:, joint, axis] = np.interp(np.arange(count), np.flatnonzero(good), data[good, joint, axis])
        values = median_filter(data[:, :, :3], size=(3, 1, 1), mode='nearest')
        arrays[kind] = savgol_filter(values, 5, 2, axis=0, mode='interp')
    return arrays


def bake(character, reference):
    rig = rig_geometry(character)
    image = np.array(reference['image'], dtype=float)
    world = np.array(reference['world'], dtype=float)
    screen = image[:, :, :2].copy()
    screen[:, :, 0] *= 9 / 16
    screen[:, :, 1] *= -1
    pairs = [(11, 13), (12, 14), (23, 25), (24, 26), (25, 27), (26, 28)]
    scale = np.median([np.linalg.norm(screen[:, b]-screen[:, a], axis=1) /
                       np.maximum(.01, np.linalg.norm(world[:, b, :2]-world[:, a, :2], axis=1))
                       for a, b in pairs])
    points = np.dstack((screen, -world[:, :, 2] * scale))
    hip_centers = (screen[:, 23] + screen[:, 24]) * .5
    leg_pixels = np.median([
        np.linalg.norm(screen[:, 25]-screen[:, 23], axis=1) + np.linalg.norm(screen[:, 27]-screen[:, 25], axis=1),
        np.linalg.norm(screen[:, 26]-screen[:, 24], axis=1) + np.linalg.norm(screen[:, 28]-screen[:, 26], axis=1)])
    # Source ground is measured from ankle landmarks; depth/limb proportions are
    # subsequently adapted to the rig. Root units are fractions of leg length.
    rotations = {bone: [] for bone in BONES}
    positions = []
    annotations = json.loads((ROOT/'pipeline/motion/source-arm-corrections.json').read_text())
    def cue(t, begin, end):
        value = np.clip(min((t-begin)/.15, (end-t)/.15), 0, 1)
        return value*value*(3-2*value)
    facial = []
    metrics = {'sourceFrames': len(points), 'sourceFps': 24, 'screenDirectionErrorDegrees': []}
    for index, p in enumerate(points):
        q = {bone: IDENTITY for bone in BONES}
        t = index/24
        for side, sign in [('left', 1), ('right', -1)]:
            for finger in ['Index', 'Middle', 'Ring', 'Little']:
                curl = .08
                for begin, end, hand, gesture in annotations['handCues'][character]:
                    if hand in [side, 'both']:
                        target = .06 if gesture == 'point' and finger == 'Index' else .95
                        curl = max(curl, cue(t, begin, end)*target)
                for joint, strength in [('Proximal', .85), ('Intermediate', 1.25), ('Distal', .8)]:
                    q[side+finger+joint] = R.from_rotvec([0, 0, -sign*curl*strength])
            q[side+'ThumbMetacarpal'] = R.from_rotvec([0, sign*.15, -sign*.12])
            q[side+'ThumbProximal'] = R.from_rotvec([0, 0, -sign*.18])
            q[side+'ThumbDistal'] = R.from_rotvec([0, 0, -sign*.1])
        eyes = [0, 0]
        for begin, end, eye in annotations['faceCues'][character]:
            amount = cue(t, begin, end)
            if eye in ['left', 'both']:
                eyes[0] = max(eyes[0], amount)
            if eye in ['right', 'both']:
                eyes[1] = max(eyes[1], amount)
        facial.append(eyes)
        hip = (p[23] + p[24]) * .5
        shoulder = (p[11] + p[12]) * .5
        up = shoulder - hip
        # Chibi heads bias monocular depth toward a permanent forward hunch.
        # Keep the measured lateral lean, but bound that uncertain pitch.
        up[2] = np.clip(up[2], -.12*np.linalg.norm(up[:2]), .12*np.linalg.norm(up[:2]))
        hip_q = basis(p[23]-p[24], up)
        chest_q = basis(p[11]-p[12], up)
        q['hips'] = hip_q
        torso_delta = hip_q.inv() * chest_q
        q['spine'] = R.from_rotvec(torso_delta.as_rotvec() * .45)
        q['chest'] = R.from_rotvec(torso_delta.as_rotvec() * .55)
        # Face/ear axes carry the original head tilt and turn, separately from hips.
        chest_forward = chest_q.apply([0, 0, 1])
        chest_yaw = np.arctan2(chest_forward[0], chest_forward[2])
        ear_axis = p[7]-p[8]
        ear_yaw = np.arctan2(-ear_axis[2], ear_axis[0])
        head_turn = (ear_yaw-chest_yaw+np.pi) % (2*np.pi)-np.pi
        eye_axis = p[2]-p[5]
        roll = np.clip(np.arctan2(eye_axis[1], max(.01, eye_axis[0])), -.22, .22) if chest_forward[2] > .2 else 0
        head_q = R.from_euler('y', chest_yaw+np.clip(head_turn, -.4, .4))*R.from_euler('z', roll)
        neck_delta = chest_q.inv() * head_q
        q['neck'] = R.from_rotvec(neck_delta.as_rotvec() * .3)
        q['head'] = R.from_rotvec(neck_delta.as_rotvec() * .7)
        posed = {'hips': np.zeros(3)}
        orientations = {'hips': hip_q}
        for bone, parent in [('spine', 'hips'), ('chest', 'spine'), ('upperChest', 'chest'),
                             ('leftShoulder', 'upperChest'), ('leftUpperArm', 'leftShoulder'),
                             ('rightShoulder', 'upperChest'), ('rightUpperArm', 'rightShoulder')]:
            posed[bone] = posed[parent] + orientations[parent].apply(rig[bone]-rig[parent])
            orientations[bone] = orientations[parent] * q[bone]
        source_shoulder = (screen[index, 11]+screen[index, 12])*.5
        source_face = (screen[index, 7]+screen[index, 8])*.5
        torso_height = max(.02, source_shoulder[1]-hip_centers[index, 1])
        head_height = max(.02, source_face[1]-source_shoulder[1])
        width_scale = abs(rig['leftUpperArm'][0]-rig['rightUpperArm'][0])/max(.025, abs(screen[index, 11, 0]-screen[index, 12, 0]))
        shoulder_height = (posed['leftUpperArm'][1]+posed['rightUpperArm'][1])*.5
        def adapted(joint):
            point = screen[index, joint]-hip_centers[index]
            y = point[1]/torso_height*shoulder_height if point[1] <= torso_height else shoulder_height+(point[1]-torso_height)/head_height*.20
            return np.array([point[0]*width_scale, y, (p[joint, 2]-hip[2])/leg_pixels])
        feet = []
        for side, sign, s, e, w, h, k, a, toe, heel, finger in [
                ('left', 1, 11, 13, 15, 23, 25, 27, 31, 29, 19),
                ('right', -1, 12, 14, 16, 24, 26, 28, 32, 30, 20)]:
            arm_rest = np.array([sign, 0, 0])
            origin = posed[side+'UpperArm']
            elbow, wrist = adapted(e), adapted(w)
            forward = chest_q.apply([0, 0, 1])
            if forward[2] > .5:
                for target, clearance in [(elbow, .04), (wrist, .28)]:
                    depth = np.dot(target-origin, forward)
                    target[2] += max(0, clearance-depth)/forward[2]
            length1 = np.linalg.norm(rig[side+'LowerArm']-rig[side+'UpperArm'])
            length2 = np.linalg.norm(rig[side+'Hand']-rig[side+'LowerArm'])
            direction = unit(wrist-origin)
            distance = np.clip(np.linalg.norm(wrist-origin), abs(length1-length2)+.001, (length1+length2)*.98)
            wrist = origin + direction*distance
            along = (length1**2-length2**2+distance**2)/(2*distance)
            hint = elbow-origin
            hint = unit(hint-direction*np.dot(hint, direction), (sign, -1, 0))
            elbow = origin + direction*along + hint*np.sqrt(max(0, length1**2-along**2))
            upper = aim(arm_rest, chest_q.inv().apply(elbow-origin))
            upper_world = chest_q * upper
            lower = aim(arm_rest, upper_world.inv().apply(wrist-elbow))
            lower_world = upper_world * lower
            # The hand follows the measured wrist gesture; a bounded continuation
            # avoids the pose estimator's hallucinated fingers on a closed fist.
            hand = R.from_rotvec(lower.as_rotvec() * -.12)
            for begin, end, hand_side, gesture in annotations['handCues'][character]:
                if gesture == 'point' and hand_side in [side, 'both']:
                    direction = [-1, .12, .1] if begin < 4 else [0, 1, .1]
                    target_hand = aim(arm_rest, lower_world.inv().apply(direction))
                    delta = hand.inv()*target_hand
                    hand = hand*R.from_rotvec(delta.as_rotvec()*cue(t, begin, end))
            q[side+'UpperArm'], q[side+'LowerArm'], q[side+'Hand'] = upper, lower, hand
            # Quaternion hierarchy reconstructs each measured limb direction.
            for rest, target, orientation in [(arm_rest, elbow-origin, upper_world),
                                              (arm_rest, wrist-elbow, lower_world)]:
                error = np.arccos(np.clip(np.dot(unit(target), orientation.apply(rest)), -1, 1))
                metrics['screenDirectionErrorDegrees'].append(float(np.degrees(error)))
            rest_down = np.array([0, -1, 0])
            thigh = aim(rest_down, hip_q.inv().apply(p[k]-p[h]))
            thigh_world = hip_q * thigh
            calf = aim(rest_down, thigh_world.inv().apply(p[a]-p[k]))
            calf_world = thigh_world * calf
            # A single-view estimator confuses a high heel with a pointed toe.
            # Preserve tracked heading, but keep the sole level in world space.
            forward = hip_q.apply([0, 0, 1])
            hip_yaw = np.arctan2(forward[0], forward[2])
            toe_direction = p[toe]-p[heel]
            toe_yaw = np.arctan2(toe_direction[0], toe_direction[2])
            turn = (toe_yaw-hip_yaw+np.pi) % (2*np.pi)-np.pi
            foot_world = R.from_euler('y', hip_yaw+np.clip(turn, -.35, .35))
            foot = calf_world.inv()*foot_world
            q[side+'UpperLeg'], q[side+'LowerLeg'], q[side+'Foot'] = thigh, calf, foot
            feet.append(hip_q.apply(rig[side+'UpperLeg']) + thigh_world.apply(rig[side+'LowerLeg']-rig[side+'UpperLeg']) + calf_world.apply(rig[side+'Foot']-rig[side+'LowerLeg']))
        root_y = -1 - min(foot[1] for foot in feet)
        positions.append([(hip_centers[index, 0]-hip_centers[0, 0])/leg_pixels, root_y, 0])
        for bone in BONES:
            quat = q[bone].as_quat()
            if rotations[bone] and np.dot(rotations[bone][-1], quat) < 0:
                quat = -quat
            rotations[bone].append(quat.tolist())
    rotations, positions, conditioning = condition(character, rotations, positions, rig)
    # A final hold key preserves the 10 s contract without forcing an invented rest pose.
    times = (np.arange(len(points)) / 24).tolist() + [10.0]
    for bone in BONES:
        rotations[bone].append(rotations[bone][-1])
    positions.append(positions[-1])
    # This checks the raw direction fit only, before anatomical conditioning;
    # it is not a fidelity score for the shipped motion.
    metrics['rawFitDirectionErrorDegrees'] = max(metrics.pop('screenDirectionErrorDegrees'))
    export(character, times, rotations, positions, reference, facial, conditioning)
    print(character, metrics, flush=True)


def export(character, times, rotations, positions, reference, facial, conditioning):
    binary, views, accessors = bytearray(), [], []
    def accessor(values, size, kind):
        flat = [v for row in values for v in row] if size > 1 else values
        offset = len(binary)
        binary.extend(struct.pack('<'+'f'*len(flat), *flat))
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(flat)*4})
        result = {'bufferView': len(views)-1, 'componentType': 5126, 'count': len(values), 'type': kind}
        if size == 1:
            result.update(min=[min(values)], max=[max(values)])
        accessors.append(result)
        return len(accessors)-1
    samplers, channels = [], []
    for bone in BONES:
        keys = rotation_keys(times, rotations[bone])
        input_id = accessor([times[i] for i in keys], 1, 'SCALAR')
        output = accessor([rotations[bone][i] for i in keys], 4, 'VEC4')
        samplers.append({'input': input_id, 'output': output, 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers)-1, 'target': {'node': BONES.index(bone), 'path': 'rotation'}})
    keys = position_keys(times, positions)
    input_id = accessor([times[i] for i in keys], 1, 'SCALAR')
    output = accessor([positions[i] for i in keys], 3, 'VEC3')
    samplers.append({'input': input_id, 'output': output, 'interpolation': 'LINEAR'})
    channels.append({'sampler': len(samplers)-1, 'target': {'node': BONES.index('root'), 'path': 'translation'}})
    gltf = {'asset': {'version': '2.0', 'generator': 'Source-frame humanoid retarget'},
            'scene': 0, 'scenes': [{'nodes': list(range(len(BONES)))}],
            'nodes': [{'name': bone} for bone in BONES], 'buffers': [{'byteLength': len(binary)}],
            'bufferViews': views, 'accessors': accessors,
            'animations': [{'name': 'dance-reference', 'samplers': samplers, 'channels': channels}],
            'extras': {'coordinateConvention': 'normalized humanoid local rotations, +X left, +Y up, +Z forward',
                       'source': reference['source'], 'sourceFps': 24, 'sourceFrames': 240,
                       'method': 'conditioned source-frame retarget with repaired tracking turns',
                       'conditioning': conditioning,
                       'faceCues': facial,
                       'reference': f'pipeline/motion/{character}-dance-landmarks.json'}}
    encoded = json.dumps(gltf, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    blob = struct.pack('<III', 0x46546c67, 2, 28+len(encoded)+len(binary))
    blob += struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
    blob += struct.pack('<II', len(binary), 0x004e4942) + binary
    (ROOT / 'assets/animations' / character / 'dance-natural.glb').write_bytes(blob)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--import-tracking', action='store_true')
    args = parser.parse_args()
    destination = ROOT / 'pipeline/motion'
    destination.mkdir(exist_ok=True)
    for character in ['seraphina', 'gothic_red']:
        path = destination / f'{character}-dance-landmarks.json'
        if args.import_tracking:
            raw = json.loads((ROOT / 'work/pose-tracking' / f'{character}-raw.json').read_text())
            arrays = clean(raw)
            arrays = refine(character, arrays)
            metadata = json.loads((ROOT / 'assets/animations' / character / 'dance.json').read_text())
            reference = {'fps': 24, 'frameCount': 240, 'source': metadata['source'],
                         'extractor': raw['extractor'], 'detectedFrames': sum('image' in r for r in raw['records']),
                         'armRefinement': 'source-frame annotations with bidirectional optical-flow interpolation',
                         'image': np.round(arrays['image'], 6).tolist(), 'world': np.round(arrays['world'], 6).tolist()}
            path.write_text(json.dumps(reference, separators=(',', ':'))+'\n', encoding='utf-8')
        reference = json.loads(path.read_text(encoding='utf-8'))
        bake(character, reference)
