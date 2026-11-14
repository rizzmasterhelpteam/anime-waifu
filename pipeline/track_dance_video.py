"""Extract the exact 24 Hz source poses offline; never runs in the extension.

Requires mediapipe, Pillow and numpy. Input is the registered transparent source
frames produced by process_dance_videos.py, before atlas resizing. The Google
Pose Landmarker heavy model stays under ignored work/, not in the extension.
"""
import argparse
import json
from pathlib import Path

import mediapipe as mp
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
EDGES = [(11, 13), (13, 15), (12, 14), (14, 16), (11, 12),
         (23, 24), (11, 23), (12, 24), (23, 25), (25, 27), (24, 26), (26, 28)]


def extract(character, model):
    frames = sorted((ROOT / 'work/dance-frames' / character).glob('*.png'))
    if len(frames) != 240:
        raise ValueError('Expected the 240 original cutout frames, not a resampled video')
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        min_pose_detection_confidence=.25, min_pose_presence_confidence=.25,
        min_tracking_confidence=.35)
    records = []
    sheet = Image.new('RGB', (1440, 1920), '#dddddd')
    with mp.tasks.vision.PoseLandmarker.create_from_options(options) as tracker:
        for index, path in enumerate(frames):
            source = Image.open(path).convert('RGBA')
            image = Image.new('RGBA', source.size, '#dddddd')
            image.alpha_composite(source)
            image = image.convert('RGB').resize((432, 768), Image.Resampling.LANCZOS)
            # The detector misses Crimson's very large head. Humanize proportions
            # only in the inference image, then map landmarks back to the original.
            # Shipped video frames and the 3D avatar proportions are untouched.
            neck = round(768 * .41)
            if character == 'gothic_red':
                top = image.crop((0, 0, 432, neck)).resize((432, round(neck * .6)))
                body = image.crop((0, neck, 432, 768)).resize((432, round((768-neck) * 1.65)))
                inference = Image.new('RGB', (432, top.height + body.height), '#dddddd')
                inference.paste(top, (0, 0))
                inference.paste(body, (0, top.height))
            else:
                inference = image
            result = tracker.detect_for_video(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=np.array(inference)),
                round(index / 24 * 1000))
            record = {'frame': index}
            if result.pose_landmarks:
                record['image'] = [[p.x, p.y, p.z, p.visibility, p.presence]
                                   for p in result.pose_landmarks[0]]
                record['world'] = [[p.x, p.y, p.z, p.visibility, p.presence]
                                   for p in result.pose_world_landmarks[0]]
                if character == 'gothic_red':
                    for point in record['image']:
                        y = point[1] * inference.height
                        point[1] = (y / .6 if y < top.height else neck + (y-top.height) / 1.65) / 768
            records.append(record)
            if index % 10 == 0:
                image = image.resize((240, 480))
                draw = ImageDraw.Draw(image)
                if 'image' in record:
                    p = record['image']
                    for a, b in EDGES:
                        draw.line((p[a][0]*240, p[a][1]*480, p[b][0]*240,
                                   p[b][1]*480), fill='cyan', width=2)
                    for point in p:
                        x, y = point[0]*240, point[1]*480
                        draw.ellipse((x-2, y-2, x+2, y+2), fill='red')
                draw.text((5, 5), f'{index / 24:.2f} s', fill='black')
                cell = index // 10
                sheet.paste(image, (cell % 6 * 240, cell // 6 * 480))
            if index % 48 == 0:
                print(character, index, flush=True)
    destination = ROOT / 'work/pose-tracking'
    destination.mkdir(parents=True, exist_ok=True)
    (destination / f'{character}-raw.json').write_text(json.dumps({
        'fps': 24, 'frameCount': len(records), 'records': records,
        'extractor': f'MediaPipe Pose Landmarker heavy / {mp.__version__}'
    }), encoding='utf-8')
    sheet.save(destination / f'{character}-tracked.jpg')
    print(character, 'detected', sum('image' in r for r in records), '/', len(records), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, default=ROOT / 'work/pose-tracking/pose_landmarker_heavy.task')
    parser.add_argument('--character', choices=['seraphina', 'gothic_red'])
    args = parser.parse_args()
    for character in ([args.character] if args.character else ['seraphina', 'gothic_red']):
        extract(character, args.model)
