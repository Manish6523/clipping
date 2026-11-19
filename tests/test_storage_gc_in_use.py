"""The 15-minute temp sweep must not delete files of a job still running, nor kept audio pieces."""
import os
import time

from src.monitor import storage_gc as gc


def _old(path, content=b"x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    past = time.time() - 3600
    os.utime(path, (past, past))
    return path


def test_sweep_skips_running_jobs_and_audio_pieces(tmp_path):
    busy = _old(tmp_path / "vods" / "manual_1" / "audio_extract.webm.part")
    done = _old(tmp_path / "vods" / "manual_0" / "audio_extract.webm")
    piece = _old(tmp_path / "audio_pieces" / "VQTEruMn7zA" / "audio_chunk_000.webm")
    with gc.in_use(tmp_path / "vods" / "manual_1"):
        assert gc.clean_directory_by_age(tmp_path, 900) == 1
        assert gc.enforce_directory_quota(tmp_path, 0) == 0
    assert busy.exists() and piece.exists() and not done.exists()
    assert gc.clean_directory_by_age(tmp_path, 900) == 1          # job finished: swept normally
    assert not busy.exists() and piece.exists()
