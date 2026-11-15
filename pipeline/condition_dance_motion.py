"""Stabilize monocular dance tracks offline before shipping them to the browser."""
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.spatial.transform import Rotation as R, Slerp


def aligned(quaternions):
    values = np.asarray(quaternions).copy()
    for i in range(1, len(values)):
        if np.dot(values[i-1], values[i]) < 0:
            values[i] *= -1
    return values


def smooth_rotations(values, sigma=1.6, speed=3.5):
    values = gaussian_filter1d(aligned(values), sigma, axis=0, mode='nearest')
    values /= np.linalg.norm(values, axis=1, keepdims=True)
    rotations = R.from_quat(values)
    # Forward/backward limits avoid a persistent causal lag and bound every
    # interval, including the start and end of a tracking repair.
    for _ in range(3):
        for indices in [range(1, len(values)), range(len(values)-2, -1, -1)]:
            previous_offset = -1 if indices.step > 0 else 1
            for i in indices:
                previous = rotations[i+previous_offset]
                delta = (previous.inv()*rotations[i]).as_rotvec()
                length = np.linalg.norm(delta)
                if length > speed/24:
                    rotations[i] = previous*R.from_rotvec(delta*(speed/24/length))
    return aligned(rotations.as_quat())


def condition(character, rotations, positions, rig):
    count = len(positions)
    values = {bone: np.array(track) for bone, track in rotations.items()}
    # The original single-view tracker swaps hidden limbs during these spins.
    # Bridge the reliable poses and give the whole body one modest turn instead.
    interval = (6.25, 7.8) if character == 'seraphina' else (7.45, 8.85)
    start, end = [round(t*24) for t in interval]
    for bone, track in values.items():
        interpolator = Slerp([0, 1], R.from_quat(track[[start, end]]))
        for frame in range(start, end+1):
            u = (frame-start)/(end-start)
            eased = u*u*(3-2*u)
            rotation = interpolator(eased)
            if bone == 'hips':
                rotation = R.from_euler('y', -.32*np.sin(np.pi*u))*rotation
            track[frame] = rotation.as_quat()
    limits = {
        'hips': ('YXZ', [.48, .10, .09]),
        'spine': ('YXZ', [.18, .09, .08]),
        'chest': ('YXZ', [.22, .10, .09]),
        'neck': ('XYZ', [.08, .13, .06]),
        'head': ('XYZ', [.12, .28, .12]),
    }
    for bone, (order, bounds) in limits.items():
        angles = R.from_quat(values[bone]).as_euler(order)
        values[bone] = R.from_euler(order, np.clip(angles, -np.array(bounds), bounds)).as_quat()
    for side, sign in [('left', 1), ('right', -1)]:
        # Enforce hinge-like elbows/knees rather than the arbitrary axial twist
        # returned by a shortest-arc direction fit.
        upper_tracks, elbow_tracks = [], []
        rest_axis = np.array([sign, 0, 0])
        for upper_q, lower_q in zip(values[side+'UpperArm'], values[side+'LowerArm']):
            upper, lower = R.from_quat(upper_q), R.from_quat(lower_q)
            direction = upper.apply(rest_axis)
            forearm = (upper*lower).apply(rest_axis)
            bend = np.arccos(np.clip(np.dot(direction, forearm), -1, 1))
            normal = np.cross(direction, forearm)
            if np.linalg.norm(normal) > .02:
                x = direction*sign
                z = normal/np.linalg.norm(normal)*sign
                y = np.cross(z, x)
                hinge_frame = R.from_matrix(np.column_stack([x, y, z]))
                # Move elbow-plane twist into the shoulder, where it belongs,
                # while keeping humeral rotation within a comfortable range.
                twist = np.clip((upper.inv()*hinge_frame).as_rotvec()[0], -1.25, 1.25)
                upper = upper*R.from_euler('x', twist)
            upper_tracks.append(upper.as_quat())
            elbow_tracks.append(R.from_euler('z', sign*np.clip(bend, .18, 2.20)).as_quat())
        values[side+'UpperArm'] = np.array(upper_tracks)
        values[side+'LowerArm'] = np.array(elbow_tracks)
        thigh = R.from_quat(values[side+'UpperLeg']).as_euler('XYZ')
        thigh[:, 0] = np.clip(thigh[:, 0], -.32, .20)
        thigh[:, 1] = np.clip(thigh[:, 1], -.04, .04)
        thigh[:, 2] = np.clip(thigh[:, 2], -.09, .09)
        values[side+'UpperLeg'] = R.from_euler('XYZ', thigh).as_quat()
        knee = np.clip(R.from_quat(values[side+'LowerLeg']).magnitude(), .04, .68)
        values[side+'LowerLeg'] = R.from_euler('x', knee[:, None]).as_quat()
        wrist = R.from_quat(values[side+'Hand']).as_euler('XYZ')
        values[side+'Hand'] = R.from_euler('XYZ', np.clip(wrist, [-.20, -.35, -.30], [.20, .35, .30])).as_quat()
    rates = {}
    for bone, track in values.items():
        speed = 2.4 if bone in limits else 3.5
        if 'Hand' in bone or 'Leg' in bone:
            speed = 2.8
        if any(finger in bone for finger in ['Index', 'Middle', 'Ring', 'Little', 'Thumb']):
            speed = 3.2
        values[bone] = smooth_rotations(track, speed=speed)
        rates[bone] = speed
    # Rebuild ankle counter-rotation and floor height after leg conditioning.
    # This preserves level soles and support contact instead of smoothing a
    # previously correct ankle independently of its parent joints.
    positions = gaussian_filter1d(np.array(positions), 2.0, axis=0, mode='nearest')
    positions[:, 0] = np.clip(positions[:, 0], -.12, .12)
    positions[:, 2] = 0
    for indices in [range(1, count), range(count-2, -1, -1)]:
        previous_offset = -1 if indices.step > 0 else 1
        for i in indices:
            previous = positions[i+previous_offset, 0]
            positions[i, 0] = previous+np.clip(positions[i, 0]-previous, -.4/24, .4/24)
    for frame in range(count):
        hips = R.from_quat(values['hips'][frame])
        forward = hips.apply([0, 0, 1])
        heading = np.arctan2(forward[0], forward[2])
        floor = []
        for side, sign in [('left', 1), ('right', -1)]:
            thigh = hips*R.from_quat(values[side+'UpperLeg'][frame])
            calf = thigh*R.from_quat(values[side+'LowerLeg'][frame])
            foot_world = R.from_euler('y', heading+sign*.04)
            values[side+'Foot'][frame] = (calf.inv()*foot_world).as_quat()
            floor.append((hips.apply(rig[side+'UpperLeg'])+thigh.apply(rig[side+'LowerLeg']-rig[side+'UpperLeg'])+calf.apply(rig[side+'Foot']-rig[side+'LowerLeg']))[1])
        positions[frame, 1] = -1-min(floor)
    for bone in values:
        values[bone] = aligned(values[bone]).tolist()
    return values, positions.tolist(), {
        'method': 'offline tracking repair, anatomical limits and angular-rate conditioning',
        'repairedInterval': interval, 'maxLocalRadiansPerSecond': rates,
        'rotationKeyToleranceDegrees': .12, 'rootKeyToleranceLegLengths': .0003,
    }


def rotation_keys(times, quaternions, tolerance=.12):
    """Keep only keys needed to stay within a measured angular error."""
    times, rotations = np.asarray(times), R.from_quat(quaternions)
    kept = {0, len(times)-1}
    def split(first, last):
        if last-first < 2:
            return
        indices = np.arange(first+1, last)
        predicted = Slerp(times[[first, last]], rotations[[first, last]])(times[indices])
        errors = (predicted.inv()*rotations[indices]).magnitude()
        largest = int(errors.argmax())
        if errors[largest] > np.radians(tolerance):
            pivot = int(indices[largest]);kept.add(pivot)
            split(first, pivot);split(pivot, last)
    split(0, len(times)-1)
    return sorted(kept)


def position_keys(times, positions, tolerance=.0003):
    times, positions = np.asarray(times), np.asarray(positions)
    kept = {0, len(times)-1}
    def split(first, last):
        if last-first < 2:
            return
        indices = np.arange(first+1, last)
        u = ((times[indices]-times[first])/(times[last]-times[first]))[:, None]
        predicted = positions[first]*(1-u)+positions[last]*u
        errors = np.linalg.norm(positions[indices]-predicted, axis=1)
        largest = int(errors.argmax())
        if errors[largest] > tolerance:
            pivot = int(indices[largest]);kept.add(pivot)
            split(first, pivot);split(pivot, last)
    split(0, len(times)-1)
    return sorted(kept)
