"""Verify restart takeover without binding or touching the real production port."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
source = Path(__file__).resolve().parents[1] / 'scripts/start-supervised.sh'
with tempfile.TemporaryDirectory(prefix='storyai-restart-test-') as directory:
    root=Path(directory)
    for folder in ['scripts','bin','node_modules/.bin']: (root/folder).mkdir(parents=True)
    shutil.copy2(source,root/'scripts/start-supervised.sh')
    def executable(path,text):
        path.write_text('#!/bin/bash\n'+text);path.chmod(0o755)
    executable(root/'bin/lsof', '''case "$*" in
      *-tiTCP*) [ -f "$TEST_ROOT/listener" ] && cat "$TEST_ROOT/listener" ;;
      *) echo "n${TEST_CWD:-$TEST_ROOT}" ;;
    esac
''')
    executable(root/'bin/npm', '''echo build >> "$TEST_ROOT/builds"
    touch "$TEST_ROOT/build-started"
    sleep "${TEST_BUILD_SLEEP:-0}"
    [ "${TEST_BUILD_FAIL:-0}" = 1 ] && exit 1
    mkdir -p .next; echo test-build > .next/BUILD_ID
''')
    executable(root/'node_modules/.bin/next', '''echo start >> "$TEST_ROOT/starts"
    echo $$ > "$TEST_ROOT/listener"
    trap '[ "$(cat "$TEST_ROOT/listener" 2>/dev/null)" = "$$" ] && rm -f "$TEST_ROOT/listener"; exit 0' TERM INT
    while true; do sleep 0.1; done
''')
    env={**os.environ,'PATH':str(root/'bin')+':'+os.environ['PATH'],'TEST_ROOT':str(root)}
    env.pop('STORYAI_SKIP_BUILD',None);env.pop('STORYAI_DATA_DIR',None)
    def start(**extra):return subprocess.Popen(['bash','scripts/start-supervised.sh'],cwd=root,env={**env,**extra},stdout=open(root/'debug.log','ab'),stderr=subprocess.STDOUT)
    def run(**extra):return subprocess.run(['bash','scripts/start-supervised.sh'],cwd=root,env={**env,**extra},capture_output=True,text=True,timeout=5)
    def until(predicate):
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            if predicate():return
            time.sleep(.03)
        raise AssertionError('Timed out waiting for test condition')
    first=start(TEST_BUILD_SLEEP='0.5')
    second=None
    try:
        until(lambda:(root/'build-started').exists())
        duplicate=run()
        assert duplicate.returncode==0 and 'already in progress' in duplicate.stdout
        until(lambda:(root/'listener').exists() and not (root/'.storyai-start.lock').exists())
        old_pid=(root/'listener').read_text()
        second=start()
        try: first.wait(timeout=8)
        except subprocess.TimeoutExpired:
            print((root/'debug.log').read_text()[-14000:]);raise
        until(lambda:(root/'listener').exists() and (root/'listener').read_text()!=old_pid)
        assert (root/'starts').read_text().splitlines()==['start','start']
        assert (root/'builds').read_text().splitlines()==['build','build']
    finally:
        for proc in [first,second]:
            if proc and proc.poll() is None:proc.send_signal(signal.SIGTERM)
        for proc in [first,second]:
            if proc:proc.wait(timeout=5)
    assert not (root/'listener').exists(), 'No orphaned listener'
    assert not (root/'.storyai-supervisor.lock').exists()
    assert not (root/'.storyai-start.lock').exists()
    (root/'listener').write_text('99999999')
    unrelated=run(TEST_CWD='/different/application')
    assert unrelated.returncode==1 and 'another application' in unrelated.stderr
    (root/'listener').unlink()
    failed=run(TEST_BUILD_FAIL='1')
    assert failed.returncode==1 and 'build failed' in failed.stderr
    assert not (root/'.storyai-start.lock').exists()
print('Passed: restart replaces old supervisor/server; startup/build serialized; graceful cleanup; unrelated port protected; build failure exits.')
