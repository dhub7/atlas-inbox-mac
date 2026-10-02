"""Regras do resume que não precisam de rede."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("mandar", ROOT / "b2-resume-upload.py")
mandar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mandar)


def test_wall_covers_slow_part():
    part = 32 * 1024 * 1024
    got = mandar.wall_seconds(part)
    assert got >= 29 * 60, got
    assert got == int(part / mandar.SLOW_BPS) + mandar.IDLE_S


def test_legacy_unfinished_does_not_match():
    assert mandar.unfinished_matches({"fileInfo": {}}, 10, 20) is False
    assert mandar.unfinished_matches({}, 10, 20) is False
    assert mandar.unfinished_matches({"fileInfo": {"src_size": "10"}}, 10, 20) is False


def test_resume_only_when_size_and_mtime_match():
    info = {"fileInfo": {"src_size": "10", "src_mtime_ms": "20"}}
    assert mandar.unfinished_matches(info, 10, 20) is True
    assert mandar.unfinished_matches(info, 11, 20) is False
    assert mandar.unfinished_matches(info, 10, 21) is False


def test_pick_cancels_legacy_without_listing_parts():
    cancelled = []
    mandar.cancel = lambda auth, fid: cancelled.append(fid)
    mandar.list_parts = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("listou"))
    fid, parts, _ps = mandar.pick_unfinished(
        {},
        [{"fileId": "old", "fileInfo": {}}],
        10,
        20,
        mandar.PART,
    )
    assert fid is None
    assert parts == {}
    assert cancelled == ["old"]


def test_pick_keeps_matching_unfinished():
    cancelled = []
    mandar.cancel = lambda auth, fid: cancelled.append(fid)
    mandar.list_parts = lambda auth, fid: {}
    fid, parts, ps = mandar.pick_unfinished(
        {},
        [{"fileId": "keep", "fileInfo": {"src_size": "10", "src_mtime_ms": "20"}}],
        10,
        20,
        mandar.PART,
    )
    assert fid == "keep"
    assert parts == {}
    assert ps == mandar.PART
    assert cancelled == []


if __name__ == "__main__":
    test_wall_covers_slow_part()
    test_legacy_unfinished_does_not_match()
    test_resume_only_when_size_and_mtime_match()
    test_pick_cancels_legacy_without_listing_parts()
    test_pick_keeps_matching_unfinished()
    print("ok")
