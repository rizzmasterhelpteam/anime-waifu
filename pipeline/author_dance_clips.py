"""Compatibility entry point for the source-frame dance retargeting pipeline."""
import runpy
from pathlib import Path

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('retarget_dance_clips.py')), run_name='__main__')
