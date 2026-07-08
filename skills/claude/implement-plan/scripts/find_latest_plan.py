#!/usr/bin/env python3
"""現在のプロジェクトのセッションログから、直近に扱われたプランファイルのパスを特定する。"""

import json
import os
import sys


def encode_project_dir(cwd):
    return cwd.replace("/", "-").replace(".", "-")


def find_latest_plan_path(cwd):
    projects_root = os.path.expanduser("~/.claude/projects")
    project_dir = os.path.join(projects_root, encode_project_dir(cwd))

    if not os.path.isdir(project_dir):
        return None

    log_files = [
        os.path.join(project_dir, name)
        for name in os.listdir(project_dir)
        if name.endswith(".jsonl")
    ]
    log_files.sort(key=lambda path: os.path.getmtime(path), reverse=True)

    for log_file in log_files:
        plan_path = _latest_plan_path_in_log(log_file)
        if plan_path and os.path.exists(plan_path):
            return plan_path

    return None


def _latest_plan_path_in_log(log_file):
    latest = None
    try:
        with open(log_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue

                plan_path = _extract_plan_path(entry)
                if plan_path:
                    latest = plan_path
    except OSError:
        return None

    return latest


def _extract_plan_path(entry):
    attachment = entry.get("attachment")
    if not isinstance(attachment, dict):
        return None
    return attachment.get("planFilePath")


def main():
    cwd = os.getcwd()
    plan_path = find_latest_plan_path(cwd)
    if not plan_path:
        return 1
    print(plan_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
