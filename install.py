"""Preview or install the World State guide into an existing Wiki or an Agent's skills folder."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

PACKAGE = Path(__file__).resolve().parent
PLUGIN = "mixing-entropy.world-state"
VERSION = "0.1.0"
SKILL = "letsgal-plugin-world-state"


def safe(path):
    path = Path(os.path.abspath(path))
    for part in (*reversed(path.parents), path):
        if part.is_symlink() or (part.exists() and getattr(part.lstat(), "st_file_attributes", 0) & 0x400):
            raise ValueError(f"请选择真实目录，路径中含链接 {part}")
    return path


def hashes(root):
    entries = {}
    for folder, dirs, files in os.walk(safe(root)):
        for name in dirs:
            safe(Path(folder) / name)
        for name in files:
            path = safe(Path(folder) / name)
            entries[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return entries


def install(area, skills, apply):
    home_area = Path.home() / ".letsgal-authoring"
    if area is None and skills is None:
        area = home_area
    if skills and (safe(skills) / "letsgal-authoring" / "SKILL.md").is_file():
        area = home_area
    main = area is not None
    base = safe(area if main else skills)
    source = safe(PACKAGE / "guide")
    declaration = safe(PACKAGE / "guide-package" / "registration.json")
    record = json.loads(declaration.read_text(encoding="utf8"))
    rel = f"plugins/{PLUGIN}/{VERSION}"
    if record.get("id") != PLUGIN or set(record["versions"]) != {VERSION}:
        raise ValueError("扩展编号或指南版本不匹配")
    version = record["versions"][VERSION]
    if version["root"] != rel or version["entry"] != "SKILL.md" or hashes(source) != version["files"]:
        raise ValueError("指南目录或内容与登记清单不符")
    target = safe(base / (rel if main else SKILL))
    if source.is_relative_to(target) or target.is_relative_to(source):
        raise ValueError("安装目标与资料源重叠")
    exists = target.exists()
    if exists and (not target.is_dir() or hashes(target) != version["files"]):
        raise ValueError(f"安装目录已有其他内容，请先备份并比较 {target}")
    manager = safe(base / "workbench" / "workbench_packages.py") if main else None
    if main and not manager.is_file():
        raise ValueError("此目录没有主 Wiki 管理器。可用 --user-area 指定已有用户区，或用 --skills-root 指定独立 Agent 技能目录。")
    print(f"{'主 Wiki' if main else '独立 Skill'} → {target}", flush=True)
    if not apply:
        print("预览完成。再次运行并加 --apply 即可安装。")
        return
    if not exists:
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=target.parent) as temp:
            stage = Path(temp) / SKILL
            shutil.copytree(source, stage)
            if hashes(stage) != version["files"]:
                raise ValueError("复制后校验失败")
            try:
                stage.rename(target)
            except OSError:
                if not target.is_dir() or hashes(target) != version["files"]:
                    raise
    if main:
        subprocess.run([sys.executable, "-B", "-X", "utf8", str(manager), "register", "--user-area",
                        str(base), "--manifest", str(declaration), "--apply"], check=True)
    print("安装及内容核验完成。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--user-area", type=Path)
    mode.add_argument("--skills-root", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        install(args.user_area, args.skills_root, args.apply)
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"{exc}\n")
