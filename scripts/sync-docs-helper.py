#!/usr/bin/env python3
"""
sync-docs-helper.py — qa-lead.md 케이스 수 자동 갱신 헬퍼 (범용화 버전)

Usage:
    python3 scripts/sync-docs-helper.py <root> <proj1> <count1> [<proj2> <count2> ...]

예:
    python3 scripts/sync-docs-helper.py /path/to/root backend 42 frontend 15 workers 8

각 프로젝트의 .claude/agents/qa-lead.md 에서 숫자 패턴을 찾아 업데이트한다.
harness-kit.conf에 CASE_COUNT_PATTERN_<proj> 를 정의하면 커스텀 패턴 사용 가능.
"""
import re
import sys
import os


def replace_count(path: str, pattern: str, new_count: int, label: str) -> int:
    """패턴 내 숫자를 new_count로 교체. 변경 있으면 1, 없으면 0 반환."""
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        print(f"  ⚠️  파일 없음: {path}", flush=True)
        return 0

    new_content = re.sub(
        pattern,
        lambda m: m.group(0).replace(m.group(1), str(new_count)),
        content,
    )
    if new_content == content:
        return 0

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"  ✅  {label}", flush=True)
    return 1


def load_conf(root: str) -> dict:
    """harness-kit.conf에서 CASE_COUNT_PATTERN_<proj> 변수를 파싱."""
    conf_path = os.path.join(root, "harness-kit.conf")
    patterns = {}
    if not os.path.exists(conf_path):
        return patterns
    with open(conf_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("CASE_COUNT_PATTERN_"):
                key, _, val = line.partition("=")
                proj = key[len("CASE_COUNT_PATTERN_"):].lower().replace("_", "-")
                # bash 형식 값에서 따옴표 제거
                val = val.strip().strip('"').strip("'")
                patterns[proj] = val
    return patterns


# 기본 패턴: 케이스 수를 나타내는 일반적인 한국어 패턴
DEFAULT_PATTERN = r"(\d+)케이스"


def main() -> int:
    if len(sys.argv) < 4 or (len(sys.argv) - 2) % 2 != 0:
        print("Usage: sync-docs-helper.py <root> <proj1> <count1> [<proj2> <count2> ...]")
        return 1

    root = sys.argv[1]
    args = sys.argv[2:]

    # 커스텀 패턴 로드
    custom_patterns = load_conf(root)

    changed = 0

    # 프로젝트별 qa-lead.md 케이스 수 업데이트
    for i in range(0, len(args), 2):
        proj = args[i]
        try:
            count = int(args[i + 1])
        except ValueError:
            print(f"  ⚠️  {proj} 카운트 파싱 실패: {args[i+1]}", flush=True)
            continue

        qa_path = os.path.join(root, proj, ".claude", "agents", "qa-lead.md")

        # 커스텀 패턴 우선, 없으면 기본 패턴
        pattern = custom_patterns.get(proj, DEFAULT_PATTERN)

        changed += replace_count(
            qa_path, pattern, count, f"{proj} qa-lead: {count}케이스"
        )

    # 루트 qa-lead.md도 업데이트 (전체 합계 또는 각 프로젝트별)
    root_qa = os.path.join(root, ".claude", "agents", "qa-lead.md")
    root_pattern = custom_patterns.get("root", DEFAULT_PATTERN)

    # 루트는 전체 합계로 업데이트 (선택적)
    # 현재: 각 프로젝트 합계를 루트 qa-lead.md 에 반영 (패턴이 있을 때만)
    if os.path.exists(root_qa) and "root" in custom_patterns:
        total = sum(int(args[i + 1]) for i in range(0, len(args), 2) if args[i + 1].isdigit())
        changed += replace_count(root_qa, root_pattern, total, f"루트 qa-lead: 전체 {total}케이스")

    print(f"SYNC_CHANGED={changed}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
