#!/bin/bash
#
# Pre-save hook for Home Assistant YAML validation (runs before Write/Edit).
#
# my115 (Michael C, 15 Nov 2026): this check never ran before. Claude Code sends the hook its input as JSON on
# stdin (not in $CLAUDE_TOOL_INPUT), and the file text is under tool_input.content, so the file path was always
# empty and the script always let everything through. Now it reads stdin. It checks a whole new YAML file that
# is being written (Write); an Edit only carries the changed part, so that is left to `ha-tools config-check`.
# Home Assistant's own tags (!include, !secret, !input ...) are accepted. Exit 2 = stop and tell Claude why.
#

INPUT="$(cat)"

RESULT=$(printf '%s' "$INPUT" | python3 -I -c '
import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
ti = data.get("tool_input") or {}
path = str(ti.get("file_path") or "")
if not path.endswith((".yaml", ".yml")) or data.get("tool_name") not in ("Write",):
    sys.exit(0)
content = ti.get("content")
if not isinstance(content, str) or not content.strip():
    sys.exit(0)
for n, line in enumerate(content.splitlines(), 1):
    if line.startswith("\t"):
        print(f"Tab character at the start of line {n}. Home Assistant needs spaces for indentation.")
        sys.exit(2)
try:
    import yaml
except Exception:
    sys.exit(0)
class Loader(yaml.SafeLoader):
    pass
def any_tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode): return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode): return loader.construct_sequence(node)
    return loader.construct_mapping(node)
Loader.add_multi_constructor("!", any_tag)
try:
    list(yaml.load_all(content, Loader=Loader))
except yaml.YAMLError as e:
    print(f"YAML error in {path}: {e}")
    sys.exit(2)
sys.exit(0)
' 2>&1)
CODE=$?

if [[ $CODE -eq 2 ]]; then
	echo "YAML check failed: $RESULT" >&2
	exit 2
fi
exit 0
