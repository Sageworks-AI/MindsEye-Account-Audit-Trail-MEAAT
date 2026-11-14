"""Regenerate `conductor/out/` from current workflows and sources.

Steps, in order:
  1. Load workflows and levels.
  2. Select a backend (dual if native is present, else Node bridge).
  3. Compile each workflow into a choreography; write `out/choreography/Wn.json`.
  4. Assemble `out/storyboards.json`.
  5. Run the fuzz walk and write `out/fuzz-summary.json`.
  6. Write `out/manifest.json` LAST, hashing:
       - every workflow file (LF-normalised)
       - every attention/cpp source (LF-normalised)
       - attention/dist/levels.json
       - every file under out/ except manifest.json itself
  7. Call `node scripts/emit-attention-css.mjs --force` so the CSS is in
     lockstep with the levels table (the build-time-only relationship is
     spelled out in README #3).

Anything that fails aborts the build and leaves the previous `out/` intact
(we write to a temp dir and swap on success). All JSON is written with a
stable key order and `\\n` line endings so byte-for-byte comparison in
`verify` is meaningful on any platform.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from .abi import select_backend
from .choreo import compile_all
from .fuzz import run_all as run_fuzz
from .storyboard import to_storyboards
from .workflows import load_all


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = HERE / 'out'
CPP_DIR = ROOT / 'attention' / 'cpp'
LEVELS_PATH = ROOT / 'attention' / 'dist' / 'levels.json'
WORKFLOW_DIR = HERE / 'workflows'


def _canonical_json(obj):
    """Stable key order, compact separators, LF line endings, trailing newline."""
    return json.dumps(obj, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=False) + '\n'


def _hash_text_file(path):
    data = path.read_text(encoding='utf-8').replace('\r\n', '\n')
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def _hash_bytes(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _list_cpp_sources():
    out = []
    for dirpath, dirnames, filenames in os.walk(CPP_DIR):
        dirnames[:] = [d for d in dirnames if d not in ('test', 'build')]
        for fn in filenames:
            if fn.endswith('.hpp') or fn.endswith('.cpp'):
                out.append(Path(dirpath) / fn)
    return sorted(out)


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_canonical_json(obj), encoding='utf-8', newline='\n')


def _generate(out_dir, backend):
    workflows = load_all()
    levels = backend.levels()
    choreos = compile_all(workflows, backend, levels)

    for choreo in choreos:
        _write_json(out_dir / 'choreography' / f'{choreo["id"]}.json', choreo)

    storyboards = to_storyboards(choreos)
    _write_json(out_dir / 'storyboards.json', {'storyboards': storyboards})

    fuzz_summary = run_fuzz(backend)
    _write_json(out_dir / 'fuzz-summary.json', fuzz_summary)

    manifest = {
        'version': 1,
        'workflows': {
            p.name: _hash_text_file(p) for p in sorted(WORKFLOW_DIR.glob('W*.json'))
        },
        'cppSources': {
            str(p.relative_to(ROOT)).replace('\\', '/'): _hash_text_file(p)
            for p in _list_cpp_sources()
        },
        'levelsJson': _hash_text_file(LEVELS_PATH),
        'outputs': {},
    }
    # Outputs: everything under out_dir except the manifest itself.
    for p in sorted(out_dir.rglob('*')):
        if not p.is_file():
            continue
        if p.name == 'manifest.json':
            continue
        rel = str(p.relative_to(out_dir)).replace('\\', '/')
        manifest['outputs'][rel] = _hash_bytes(p)
    _write_json(out_dir / 'manifest.json', manifest)

    return len(choreos), sum(len(w['steps']) + len(w.get('cancelVariant', {}).get('steps', []))
                             for w in workflows)


def _run_emit_css():
    script = ROOT / 'scripts' / 'emit-attention-css.mjs'
    if not script.exists():
        print(f'conductor: warning: {script} not found; skipping CSS emit')
        return
    node = os.environ.get('NODE', 'node')
    r = subprocess.run([node, str(script), '--force'],
                       cwd=str(ROOT), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'emit-attention-css failed: {r.stderr or r.stdout}')
    print(r.stdout.strip())


def build_main(argv):
    OUT.mkdir(parents=True, exist_ok=True)
    # Build into a temp dir first so a failed build leaves the previous
    # outputs intact.
    with tempfile.TemporaryDirectory(dir=str(OUT)) as tmp:
        tmp_path = Path(tmp)
        backend, kind = select_backend()
        try:
            n_choreos, n_steps = _generate(tmp_path, backend)
        finally:
            if hasattr(backend, 'close'):
                backend.close()
        # Swap in the temp dir contents.
        for entry in OUT.iterdir():
            if entry.name.startswith('tmp'):
                continue
            if entry.is_file():
                entry.unlink()
            else:
                import shutil
                shutil.rmtree(entry)
        import shutil
        for entry in tmp_path.iterdir():
            dst = OUT / entry.name
            if entry.is_dir():
                shutil.copytree(entry, dst)
            else:
                shutil.copy2(entry, dst)
    _run_emit_css()
    print(f'conductor: built {n_choreos} choreographies ({n_steps} steps) via {kind}')
    return 0
