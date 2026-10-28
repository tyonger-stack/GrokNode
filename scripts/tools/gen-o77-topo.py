import json, re, subprocess

body = open('o77_body.js').read()
segs = {}
order = []
for s in re.split(r'(?=/\* O77)', body):
    m = re.match(r'/\* (O77[\w$]+)', s)
    if m:
        segs[m.group(1)] = s
        order.append(m.group(1))
json.dump(segs, open('segtest.json','w'))
subprocess.run(['node','freeids_lib.mjs','segtest.json','segfree.json'], check=True, capture_output=True)
FREE = json.load(open('segfree.json'))

names = set(segs.keys())
# edge: A before B if B references A
deps = {n: set() for n in names}     # n depends on (references)
for n, frees in FREE.items():
    for f in frees:
        if f in names and f != n:
            deps[n].add(f)

# Kahn topo sort, keep original order as tiebreak for stability
result, remaining = [], set(names)
while remaining:
    ready = sorted([n for n in remaining if not (deps[n] & remaining)], key=order.index)
    if not ready:
        print('CYCLE among:', remaining); break
    for n in ready:
        result.append(n); remaining.discard(n)

out = ''.join(segs[n] for n in result)
open('o77_body.js','w').write(out)
print(f'reordered {len(result)} segments (was {len(order)})')
subprocess.run(['node','--check','o77_body.js'], check=True)
print('topo body parses OK,', len(out), 'bytes')
