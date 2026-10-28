#!/usr/bin/env python3
"""Regenerate scripts/lib/memory-import-0770-renderer-patch.mjs (verbatim official 0.77.0
memory-import dialog port) from the rea-grokbot-0770 evidence tree.

Pipeline: anchored segment extraction (fn/var with call-chain tails) → acorn scope
analysis for exact free identifiers (node freeids helper embedded below) → free-id
rename to O77_* namespace (string/destructure-key/member aware) → topological
ordering → styleq module fixups → wiring layer + shared contract constants → emit
the .mjs with per-segment sha256 provenance + the CSS rules to append.

Run from the repo root: python3 scripts/tools/gen-o77-import.py
Evidence path is pinned to ~/Documents/grokbot/rea-grokbot-0770 (keep in sync).
"""

#!/usr/bin/env python3
"""FINAL: explicit bounded closure — official dialog verbatim, section on 0.18 primitives."""
import hashlib, json, re, subprocess
#!/usr/bin/env python3
"""Generator v4: acorn-exact free ids → deterministic O77 resolution."""
import hashlib, json, pathlib, re, subprocess

A77 = pathlib.Path('/Users/Apple/Documents/grokbot/rea-grokbot-0770/app/dist/renderer/assets/')
FILES = {
    'pane': 'chunk-general-pane-C0zKNc5s.js',
    'dialog': 'chunk-card-dialog-D-JbmIrI.js',
    'field': 'chunk-card-field-DvUulqsh.js',
    'row': 'chunk-settings-row-WPdxDYnE.js',
    'heading': 'chunk-heading-link-DkkKf_ZD.js',
    'eager': 'index.eager-app-pljxi3Ue.js',
    'vendor': 'index.eager-vendor-Be1S4G-q.js',
    'platform': 'index.eager-platform-BCmdOJdH.js',
    'common': 'index.eager-common-B2THygQN.js',
    'target': 'chunk-personal-bot-target-DH9sLLMg.js',
    'runtime': 'chunk-rolldown-runtime-BCiCTKAo.js',
}
SRC = {k: (A77 / v).read_text(encoding='utf-8') for k, v in FILES.items()}
REVFILE = {v: k for k, v in FILES.items()}

IMAP = {}
for k, s in SRC.items():
    m = {}
    for im in re.finditer(r'import\{([^}]+)\}from"\./([^"]+)";', s):
        for part in im.group(1).split(','):
            part = part.strip()
            if not part: continue
            if ' as ' in part: exp, local = part.split(' as ')
            else: exp = local = part
            m[local.strip()] = (exp.strip(), REVFILE.get(im.group(2), im.group(2)))
    IMAP[k] = m

EXPLOCAL = {}
for k, s in SRC.items():
    m = {}
    for em in re.finditer(r'export\{([^}]+)\}', s):
        for part in em.group(1).split(','):
            part = part.strip()
            if ' as ' in part:
                local, exp = part.split(' as ')
                m[exp.strip()] = local.strip()
            else:
                m[part] = part
    EXPLOCAL[k] = m

def fn_seg(chunk, name):
    src = SRC[chunk]
    m = re.search(r'function ' + re.escape(name) + r'\(', src)
    assert m, f'{chunk}:{name} fn anchor missing'
    d = 0; k = m.end() - 1
    while k < len(src):
        if src[k] == '(': d += 1
        elif src[k] == ')':
            d -= 1
            if d == 0: break
        k += 1
    i = src.index('{', k); d = 0
    for j in range(i, len(src)):
        if src[j] == '{': d += 1
        elif src[j] == '}':
            d -= 1
            if d == 0: return src[m.start():j+1]
    raise AssertionError(name)

def var_seg(chunk, name):
    src = SRC[chunk]
    for m in re.finditer(r'(?<![\w$])' + re.escape(name) + r'=(?!=)', src):
        k = m.end()
        if k >= len(src): continue
        if src[k] not in '{[(\'"`' and not (src[k].isalnum() or src[k] in '_$-'):
            continue
        j = m.start()
        while j > 0 and (src[j-1].isalnum() or src[j-1] in '_$'):
            j -= 1
        d = 0; e = None; k = m.end()
        while k < len(src):
            c = src[k]
            if c in '{([': d += 1
            elif c in '})]':
                d -= 1
                if d == 0: e = k + 1; break
            elif c in ',;' and d == 0: e = k; break
            k += 1
        if e: return src[j:e]
    raise AssertionError(f'var {chunk}:{name}')

def sha(s): return hashlib.sha256(s.encode()).hexdigest()[:16]



def var_seg(chunk, name):
    src = SRC[chunk]
    for m in re.finditer(r'(?<![\w$])' + re.escape(name) + r'=(?!=)', src):
        k = m.end()
        if k >= len(src): continue
        if src[k] not in '{[(\'\"`' and not (src[k].isalnum() or src[k] in '_$-'):
            continue
        j = m.start()
        while j > 0 and (src[j-1].isalnum() or src[j-1] in '_$'):
            j -= 1
        d = 0; e = None; k = m.end()
        while k < len(src):
            c = src[k]
            if c in '{([': d += 1
            elif c in '})]':
                d -= 1
                if d == 0: e = k + 1; break
            elif c in ',;' and d == 0: e = k; break
            k += 1
        if e:
            while e < len(src) and (src[e] == '.' or src[e] == '('):
                if src[e] == '(':
                    d2 = 0; k3 = e
                    while k3 < len(src):
                        if src[k3] == '(': d2 += 1
                        elif src[k3] == ')':
                            d2 -= 1
                            if d2 == 0: break
                        k3 += 1
                    e = k3 + 1
                else:
                    k2 = e + 1
                    while k2 < len(src) and (src[k2].isalnum() or src[k2] in '_$'):
                        k2 += 1
                    if k2 < len(src) and src[k2] == '(':
                        d2 = 0; k3 = k2
                        while k3 < len(src):
                            if src[k3] == '(': d2 += 1
                            elif src[k3] == ')':
                                d2 -= 1
                                if d2 == 0: break
                            k3 += 1
                        e = k3 + 1
                    else:
                        break
            return src[j:e]
    raise AssertionError(f'var {chunk}:{name}')

S = []
def add(chunk, kind, name, o77, manual=None):
    S.append(dict(chunk=chunk, kind=kind, name=name, o77=o77, manual=manual or {}))

# ── layer 1: vendor runtime utils ──
add('vendor','var','__STYLEQ_MODULE__','O77styleqModule')  # special: ae={},oe;function se(){...} block
add('vendor','var','ce','O77styleqLib', {'se':'O77styleqFactory','ae':'O77sqMod','oe':'O77sqLoaded'})
add('vendor','fn','le','O77styleq')
add('eager','fn','$','O77cls')
# ── layer 2: contracts ──
add('eager','var','nhe','O77ExportPrompt'); add('eager','fn','she','O77BuildMessage', {'ahe':'O77PortInstructions'})
add('eager','fn','ohe','O77RichText')
add('eager','var','rhe','O77MaxChars'); add('eager','fn','sm','O77FormatTarget', {'di':'O77i18nInstance'})
add('eager','var','sme','O77MsgSme'); add('eager','var','ame','O77MsgAme'); add('eager','var','ome','O77MsgOme')
add('eager','var','j$','O77AnchorIds'); add('eager','var','M$','O77AnchorRegistry'); add('eager','fn','P$','O77AnchorTitle')
add('eager','var','N$','O77N$'); add('eager','fn','bYt','O77bYt')
# ── layer 3: css registries / tokens ──
add('eager','var','_x','O77FontWeights'); add('eager','var','gx','O77Tokens')
add('eager','var','tC','O77DialogCss'); add('eager','var','XUe','O77DialogSizes')
add('eager','var','fS','O77ScrollCss'); add('eager','var','vS','O77ElevCtx')
add('eager','fn','bS','O77useElevationFn', {'Y':'O77react'})
add('pane','var','Cr','O77StepCss'); add('dialog','var','_','O77ShellCss')
add('field','var','d','O77FieldControlCss'); add('field','var','f','O77FieldRootCss')
add('eager','var','lS','O77IconCssRoot'); add('eager','var','ZHe','O77IconSizes')
add('eager','var','QHe','O77IconColors'); add('eager','var','XHe','O77IconSizeTokens')
add('eager','var','pS','O77BtnCss'); add('eager','var','mS','O77BtnSizes')
add('eager','var','$He','O77BtnSentiments'); add('eager','var','xS','O77IconBtnFill')
add('eager','var','nUe','O77MarkerCss')
add('eager','var','_S','O77CloseSmSize'); add('eager','var','gS','O77CloseSizeG')
add('eager','var','iUe','O77CloseMdSize'); add('eager','var','rUe','O77CloseMdSizeR')
add('eager','var','tUe','O77MarkerCss2')
# button cluster sub-deps (verified small eager locals)
add('eager','var','eUe','O77IconSizeMap')
add('eager','var','_Ue','O77BtnIconGapClass'); add('eager','var','vUe','O77BtnPendingCss')
add('eager','var','fUe','O77BtnSentimentCss'); add('eager','var','pUe','O77BtnHeldCss')
add('eager','var','mUe','O77BtnSizeCss'); add('eager','var','hUe','O77BtnIconSize'); add('eager','var','gUe','O77BtnIconScale')
add('eager','fn','bUe','O77ButtonIcon'); add('eager','fn','yUe','O77PendingInk')
add('eager','var','FS','O77BtnDepFS'); add('eager','fn','PS','O77Spinner')
# card cluster
add('eager','fn','SS','O77SurfaceBase'); add('eager','var','sUe','O77SurfaceVariants')
add('eager','fn','cUe','O77SurfaceClass')
add('eager','var','Zx','O77NullCtx')
# subtitle cluster
add('eager','fn','Qx','O77CtxConsumer'); add('eager','var','yS','O77DensityCtx'); add('eager','var','aUe','O77CtxA')
# ── layer 4: components ──
add('eager','fn','vx','O77Heading')
add('eager','fn','uS','O77Icon', {'pe':'O77IconGlyph'})
add('eager','fn','hS','O77ButtonBase', {'pe':'O77IconGlyph'})
add('eager','fn','ES','O77CloseSm'); add('eager','fn','DS','O77CloseMd')
add('eager','fn','CS','O77CardSurface'); add('eager','fn','IS','O77Button')
add('eager','fn','AS','O77Footer'); add('eager','fn','OS','O77Subtitle')
add('eager','fn','wS','O77IconTitlebar')
add('field','fn','p','O77Field', {'l':'O77rtObj','u':'O77jsx'}); add('field','fn','_','O77Stack', {'l':'O77rtObj','u':'O77jsx'})
add('eager','fn','nC','O77DialogRoot', {'XS':'O77BaseDialog','QS':'O77QS','ZS':'O77ZS','eC':'O77eC'})
add('dialog','fn','v','O77Shell', {'h':'O77rtObj','g':'O77jsx'})
add('dialog','fn','y','O77ShellInner', {'h':'O77rtObj','g':'O77jsx'})
add('pane','fn','wr','O77Step')
add('target','fn','i','O77pickTarget', {'e':'O77isTargetOk','t':'O77isPersonalBot','n':'O77lastActivity','r':'O77mostRecent'})
add('eager','fn','X1e','O77isTargetOk', {'Ul':'O77VisibilityEnum'})
add('eager','var','Ul','O77VisibilityEnum')
add('target','fn','t','O77isPersonalBot', {'e':'O77isTargetOk'})
add('target','fn','n','O77lastActivity')
add('target','fn','r','O77mostRecent', {'t':'O77isPersonalBot','n':'O77lastActivity'})
add('pane','fn','Tr','O77ImportDialog')
# section: official Er structure on 0.18 section/card primitives (documented deviation: 0.18 General panel kit)

LOCAL2O77 = {(s['chunk'], s['name']): s['o77'] for s in S}
EXP2O77 = {
    ('vendor','S'): 'O77rtObj', ('vendor','yi'): 'O77styleq', ('vendor','nt'): 'O77i18n', ('vendor','tt'): 'O77Trans',
    ('common','Gt'): 'O77jsx', ('common','Q'): 'O77react', ('common','an'): 'O77i18nInstance',
    ('platform','Ur'): 'O77Text', ('platform','Ir'): 'O77useDialogIds', ('platform','Pa'): 'O77IconGlyph',
    ('platform','an'): 'O77i18nMsg', ('platform','ha'): 'O77jsx2', ('platform','ho'): 'O77CssTokens',
    ('platform','kr'): 'O77Gate', ('platform','Nr'): 'O77rollout',
    ('eager','Wv'): 'O77DialogRoot', ('eager','Ey'): 'O77NullCtx', ('eager','Gy'): 'O77FontWeights',
    ('eager','Wy'): 'O77Tokens', ('eager','Uy'): 'O77Heading', ('eager','my'): 'O77useElevationFn',
    ('eager','vy'): 'O77Icon', ('eager','gy'): 'O77ScrollCss', ('eager','ey'): 'O77Button',
    ('eager','ay'): 'O77Footer', ('eager','bO'): 'O77FormatTarget', ('eager','io'): 'O77AnchorTitle',
    ('eager','to'): 'O77AnchorRegistry', ('eager','tO'): 'O77BuildMessage', ('eager','$D'): 'O77ExportPrompt',
    ('eager','eO'): 'O77MaxChars', ('eager','sk'): 'O77telemetry', ('eager','fO'): 'O77useNavSelect',
    ('eager','nA'): 'O77useMainAgent', ('eager','mO'): 'O77useSelAgent', ('eager','Ka'): 'O77useSettings',
    ('eager','AE'): 'O77useSendPrompt', ('eager','kv'): 'O77useClipboard', ('eager','dO'): 'O77useRoster',
    ('eager','Ga'): 'O77afterSend', ('eager','hy'): 'O77ButtonBase', ('eager','iy'): 'O77CardSurface',
    ('eager','fy'): 'O77CloseSm', ('eager','ly'): 'O77CloseMd', ('eager','dy'): 'O77IconTitlebar',
    ('eager','cy'): 'O77Subtitle',
}
EAGER_LOCAL = {'X':'O77jsx','Y':'O77react','Z':'O77rtObj','$':'O77cls','di':'O77i18nInstance'}
PANE_LOCAL = {'Z':'O77rtObj','Q':'O77react','$':'O77jsx'}
GLOBALS = {'Symbol','Object','String','Array','WeakMap','console','arguments','undefined','Math','JSON','Promise','Set','Map','Date','RegExp','Error','window','document','navigator','parseInt','parseFloat','isNaN','Boolean','Number','Event','CSS','Element','Node','Reflect','queueMicrotask','requestAnimationFrame','cancelAnimationFrame','IntersectionObserver','setTimeout','clearTimeout','performance','AbortController','getComputedStyle','WeakSet','TypeError','MutationObserver','ResizeObserver','Intl','Float64Array'}

def raw_of(s):
    if s['name'] == '__STYLEQ_MODULE__':
        v = SRC['vendor']
        i = v.index('var ae={},oe;function se(){')
        j = v.index('function ', i + len('var ae={},oe;'))
        # brace match se body from its first {
        end = v.index('var ce=se();', i)
        return v[i:end]
    return fn_seg(s['chunk'], s['name']) if s['kind']=='fn' else var_seg(s['chunk'], s['name'])

def seg_replace(seg, mapping):
    out = []; i = 0; n = len(seg)
    ident = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')
    while i < n:
        c = seg[i]
        if c in '`"\'':
            q = c; out.append(c); i += 1
            while i < n:
                if seg[i] == '\\': out.append(seg[i:i+2]); i += 2; continue
                out.append(seg[i])
                if seg[i] == q: i += 1; break
                i += 1
            continue
        m = ident.match(seg, i)
        if m:
            tok = m.group(0)
            prev = seg[i-1] if i > 0 else ''
            spread = i >= 3 and seg[i-3:i] == '...'
            nxt = seg[i+1:i+2] if i+1 < n else ''
            if (prev == '.' and not spread) or (nxt == ':'):
                out.append(tok)
            else:
                out.append(mapping.get(tok, tok))
            i = m.end()
        else:
            out.append(c); i += 1
    return ''.join(out)

raw = {s['o77']: raw_of(s) for s in S}
json.dump(raw, open('segs_raw.json','w'))
subprocess.run(['node','freeids_lib.mjs','segs_raw.json','segs_free.json'], check=True, capture_output=True)
FREE = json.load(open('segs_free.json'))

manifest, body, unres_total = [], [], 0
for s in S:
    chunk, kind, name, o77, manual = s['chunk'], s['kind'], s['name'], s['o77'], s['manual']
    seg = raw[o77]
    mapping = dict(manual)
    if chunk == 'eager':
        for k, v in EAGER_LOCAL.items():
            mapping.setdefault(k, v)
    if chunk == 'pane':
        for k, v in PANE_LOCAL.items():
            mapping.setdefault(k, v)
    unres = []
    for fid in FREE[o77]:
        if isinstance(fid, dict) or fid in GLOBALS or fid in mapping: continue
        info = IMAP[chunk].get(fid)
        target = None; exp = '-'; fromfile = ''
        if info:
            exp, fromfile = info
            target = EXP2O77.get((fromfile, exp))
            if target is None:
                src_local = EXPLOCAL.get(fromfile, {}).get(exp)
                if src_local and (fromfile, src_local) in LOCAL2O77:
                    target = LOCAL2O77[(fromfile, src_local)]
        if target is None:
            target = LOCAL2O77.get((chunk, fid))
        if target is None and chunk == 'eager' and fid in EAGER_LOCAL:
            target = EAGER_LOCAL[fid]
        if target is None and chunk == 'pane' and fid in PANE_LOCAL:
            target = PANE_LOCAL[fid]
        if target is None:
            unres.append((fid, exp, fromfile or 'local'))
        else:
            mapping[fid] = target
    seg2 = seg_replace(seg, mapping)
    if name == '__STYLEQ_MODULE__':
        seg2 = seg2.replace('var ae={},oe;', 'var O77sqMod={},O77sqLoaded;')
        seg2 = seg2.replace('ae,', 'O77sqMod,').replace('ae)', 'O77sqMod)').replace('ae.', 'O77sqMod.')
        seg2 = seg2.replace('oe=', 'O77sqLoaded=').replace('(oe', '(O77sqLoaded').replace('oe)', 'O77sqLoaded)')
        seg2 = seg2.replace('if(oe', 'if(O77sqLoaded')
        seg2 = seg2.replace('function se()', 'function O77styleqFactory()')
    seg2 = re.sub(r'function ' + re.escape(name) + r'\(', 'function ' + o77 + '(', seg2, count=1)
    seg2 = re.sub(r'(?<![\w$])' + re.escape(name) + r'=(?!=)', o77 + '=', seg2, count=1)
    seg2 = re.sub(r'(?<![\w$])' + re.escape(name) + r'\.d=', o77 + '.d=', seg2, count=1)
    body.append(f'/* {o77} <- {FILES.get(chunk, chunk)} :: {name} sha256:{sha(seg2)} */\n' + seg2 + '\n')
    manifest.append(dict(src=FILES.get(chunk, chunk), official=name, o77=o77, sha=sha(seg2), bytes=len(seg2), unres=[list(u) for u in unres]))
    if unres:
        unres_total += len(unres)
        print(f'UNRES {o77}: {unres}')

WIRING_CONSTS = '''/* official 0.77 one-line contexts, transcribed verbatim from index.eager-app (nC closure) */
const O77ZS=O77react.createContext(`simple`),O77QS=O77react.createContext(!1),O77eC=O77react.createContext(null);
/* port instruction set (documented deviation, IMPORT-0770.md §6) wired into official she() builder */
const O77PortInstructions=RImportInstructions;'''
body.insert(0, WIRING_CONSTS)
json.dump(manifest, open('o77_manifest.json','w'), indent=1)
open('o77_body.js','w').write('\n'.join(body))
total = sum(m['bytes'] for m in manifest)
print(f'\n{len(S)} segments, {total} bytes, unresolved: {unres_total}')
