"""Apply source-frame arm annotations with optical-flow timing between anchors."""
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from scipy.signal import savgol_filter

ROOT = Path(__file__).resolve().parents[1]


def refine(character, arrays):
    specification = json.loads((ROOT/'pipeline/motion/source-arm-corrections.json').read_text())
    anchors = specification['characters'][character]
    joint_count = len(specification['joints'])
    images = []
    for page in range(10):
        with Image.open(ROOT/'assets/animations'/character/f'dance-{page:02}.webp') as atlas:
            for slot in range(24):
                rgba = atlas.crop((slot%6*320, slot//6*420, slot%6*320+320, slot//6*420+420)).convert('RGBA')
                base = Image.new('RGBA', rgba.size, '#dddddd')
                base.alpha_composite(rgba)
                images.append(cv2.cvtColor(np.array(base.convert('RGB')), cv2.COLOR_RGB2GRAY))
    def follow(start, end, points):
        result = [np.array(points, dtype=np.float32).reshape(-1, 1, 2)]
        direction = 1 if end > start else -1
        for frame in range(start, end, direction):
            p, status, error = cv2.calcOpticalFlowPyrLK(images[frame], images[frame+direction], result[-1], None,
                winSize=(21, 21), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT, 25, .01))
            if p is None:
                p = result[-1].copy()
            else:
                good = (status[:, 0] > 0) & (error[:, 0] < 25)
                p[~good] = result[-1][~good]
            result.append(p)
        return np.array(result)[:, :, 0, :]
    last = np.array(anchors[-1][1:]).reshape(joint_count, 2)
    final = follow(anchors[-1][0], 239, last)[-1]
    anchors = anchors + [[239] + final.ravel().tolist()]
    traced = np.zeros((240, joint_count, 2))
    for a, b in zip(anchors, anchors[1:]):
        begin, end = a[0], b[0]
        forward = follow(begin, end, np.array(a[1:]).reshape(joint_count, 2))
        backward = follow(end, begin, np.array(b[1:]).reshape(joint_count, 2))[::-1]
        u = np.linspace(0, 1, end-begin+1)[:, None, None]
        traced[begin:end+1] = forward*(1-u)+backward*u
    # Recover the exact source-to-atlas registration from the original cutouts.
    bounds = [Image.open(path).getbbox() for path in sorted((ROOT/'work/dance-frames'/character).glob('*.png'))]
    union = [min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds)]
    scale = min(296/(union[2]-union[0]), 396/(union[3]-union[1]))
    rw, rh = round((union[2]-union[0])*scale), round((union[3]-union[1])*scale)
    offset = [(320-rw)//2-union[0]*scale, 412-rh-union[1]*scale]
    normalized = (traced-offset)/scale/[1080, 1920]
    normalized = savgol_filter(normalized, 5, 2, axis=0)
    for slot, joint in enumerate(specification['joints']):
        for frame in range(240):
            # Hidden arms during a turn retain the 3D track; screen-space manual
            # points cannot determine which obscured limb is in front.
            if character == 'seraphina' and 157 <= frame <= 179:
                continue
            if character == 'gothic_red' and 187 <= frame <= 201:
                continue
            arrays['image'][frame, joint, :2] = normalized[frame, slot]
    return arrays
