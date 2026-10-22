#!/usr/bin/env python3
"""Builds "Chladni Modal.amxd" — a Max for Live instrument — from
chladni_voice.genexpr (embedded as the mc.gen~ voice) and chladni.js
(the v8ui, referenced by name; keep it next to the device or freeze it in).

    python3 build_amxd.py
"""
import json
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'Chladni Modal.amxd')

boxes, lines = [], []
_n = [0]


def obj(text, ins, outs, rect, outtype=None, **extra):
    _n[0] += 1
    oid = 'obj-%d' % _n[0]
    b = {'id': oid, 'maxclass': 'newobj', 'text': text, 'numinlets': ins,
         'numoutlets': outs, 'patching_rect': rect}
    if outs:
        b['outlettype'] = outtype or [''] * outs
    b.update(extra)
    boxes.append({'box': b})
    return oid


def box(maxclass, ins, outs, rect, outtype=None, **extra):
    _n[0] += 1
    oid = 'obj-%d' % _n[0]
    b = {'id': oid, 'maxclass': maxclass, 'numinlets': ins, 'numoutlets': outs,
         'patching_rect': rect}
    if outs:
        b['outlettype'] = outtype or [''] * outs
    b.update(extra)
    boxes.append({'box': b})
    return oid


def msg(text, rect):
    return box('message', 2, 1, rect, text=text)


def wire(src, so, dst, di):
    lines.append({'patchline': {'source': [src, so], 'destination': [dst, di]}})


def comment(text, prect):
    return box('live.comment', 1, 0, [prect[0], 900, prect[2], prect[3]], text=text,
               presentation=1, presentation_rect=prect, fontsize=9.5, textjustification=0)


# ---------------------------------------------------------------- parameters
def param_attrs(longname, short, ptype, lo=0.0, hi=1.0, init=0.0, unit=1, exp=1.0, enum=None):
    v = {'parameter_longname': longname, 'parameter_shortname': short,
         'parameter_type': ptype, 'parameter_initial_enable': 1,
         'parameter_initial': [init]}
    if enum is not None:
        v['parameter_enum'] = enum
        v['parameter_mmax'] = len(enum) - 1
    else:
        v['parameter_mmin'] = lo
        v['parameter_mmax'] = hi
        v['parameter_unitstyle'] = unit
        if exp != 1.0:
            v['parameter_exponent'] = exp
    return {'valueof': v}


def dial(name, short, prect, lo, hi, init, unit=1, exp=1.0, ptype=0):
    return box('live.dial', 2, 2, [prect[0], 600, 44, 48], ['', 'float'],
               parameter_enable=1, varname=name, presentation=1, presentation_rect=prect,
               showname=1, shownumber=1,
               saved_attribute_attributes=param_attrs(name, short, ptype, lo, hi, init, unit, exp))


def tab(name, items, prect, init):
    return box('live.tab', 1, 3, [prect[0], 700, prect[2], prect[3]], ['', '', 'float'],
               parameter_enable=1, varname=name, presentation=1, presentation_rect=prect,
               num_lines_patching=1, num_lines_presentation=1, fontsize=8.5,
               saved_attribute_attributes=param_attrs(name, name, 2, init=init, enum=items))


def menu(name, items, prect, init):
    return box('live.menu', 1, 3, [prect[0], 750, prect[2], prect[3]], ['', '', 'float'],
               parameter_enable=1, varname=name, presentation=1, presentation_rect=prect,
               saved_attribute_attributes=param_attrs(name, name, 2, init=init, enum=items))


# ---------------------------------------------------------------- core objects
ui = box('v8ui', 1, 1, [40, 300, 160, 160], filename='chladni.js', presentation=1,
         presentation_rect=[4, 4, 160, 160], parameter_enable=0)

with open(os.path.join(HERE, 'chladni_voice.genexpr')) as f:
    gencode = f.read()
gen_patcher = {
    'fileversion': 1,
    'appversion': {'major': 9, 'minor': 0, 'revision': 0, 'architecture': 'x64', 'modernui': 1},
    'classnamespace': 'dsp.gen',
    'rect': [100, 100, 700, 600],
    'boxes': [
        {'box': {'id': 'obj-1', 'maxclass': 'newobj', 'text': 'in 1', 'numinlets': 0,
                 'numoutlets': 1, 'outlettype': [''], 'patching_rect': [20, 20, 30, 22]}},
        {'box': {'id': 'obj-2', 'maxclass': 'codebox', 'code': gencode, 'fontface': 0,
                 'fontname': '<Monospaced>', 'fontsize': 12, 'numinlets': 1, 'numoutlets': 1,
                 'outlettype': [''], 'patching_rect': [20, 60, 640, 460]}},
        {'box': {'id': 'obj-3', 'maxclass': 'newobj', 'text': 'out 1', 'numinlets': 1,
                 'numoutlets': 0, 'patching_rect': [20, 540, 37, 22]}},
    ],
    'lines': [
        {'patchline': {'source': ['obj-1', 0], 'destination': ['obj-2', 0]}},
        {'patchline': {'source': ['obj-2', 0], 'destination': ['obj-3', 0]}},
    ],
}
gen = obj('mc.gen~ @chans 8', 1, 1, [400, 420, 200, 22], ['multichannelsignal'],
          patcher=gen_patcher)

# tables: the --- prefix is made unique per device instance by Live
BUFS = ['mratio', 'mgain', 'ladder', 'partials']
for i, b in enumerate(BUFS):
    obj('buffer~ ---%s' % b, 1, 2, [620 + i * 120, 300, 110, 22], ['float', 'bang'])

# on load: bind the gen~ buffers, hand the names to the v8ui, then build the plate
thisdev = obj('live.thisdevice', 1, 3, [400, 40, 100, 22], ['bang', 'int', 'int'])
tbb = obj('t b b', 1, 2, [400, 70, 40, 22], ['bang', 'bang'])
bind = msg(', '.join('%s ---%s' % (b, b) for b in BUFS), [560, 100, 360, 22])
uinit = msg('bufs ' + ' '.join('---' + b for b in BUFS) + ', init', [400, 130, 340, 22])
wire(thisdev, 0, tbb, 0)
wire(tbb, 1, bind, 0)
wire(bind, 0, gen, 0)
wire(tbb, 0, uinit, 0)
wire(uinit, 0, ui, 0)

# v8ui → dials (dragging the drive point) and → gen~ (table sizes)
route = obj('route dx dy', 1, 3, [40, 480, 90, 22])
wire(ui, 0, route, 0)
wire(route, 2, gen, 0)

# ---------------------------------------------------------------- notes
notein = obj('notein', 1, 3, [40, 40, 50, 22], ['int', 'int', 'int'])
pk2 = obj('pack 0 0', 2, 1, [40, 70, 60, 22])
gate = obj('gate 2', 2, 2, [40, 100, 50, 22])
poly1 = obj('poly 1 1', 2, 3, [40, 130, 60, 22])
poly8 = obj('poly 8 1', 2, 3, [120, 130, 60, 22])
pk3 = obj('pack 0 0 0', 3, 1, [40, 160, 80, 22])
wire(notein, 0, pk2, 0)
wire(notein, 1, pk2, 1)
wire(pk2, 0, gate, 1)
wire(gate, 0, poly1, 0)
wire(gate, 1, poly8, 0)
for p in (poly1, poly8):
    for k in range(3):
        wire(p, k, pk3, k)

# each event goes to its voice as one atomic number: counter·65536 + pitch·256 + velocity
tlb = obj('t l b', 1, 2, [40, 190, 40, 22])
counter = obj('counter 0 255', 5, 4, [100, 220, 90, 22], ['int', '', '', 'int'])
join = obj('zl.join', 2, 2, [40, 250, 60, 22])
tll = obj('t l l', 1, 2, [40, 280, 40, 22])
expr = obj('expr $f4*65536. + $f2*256. + $f3', 4, 1, [140, 310, 220, 22])
unpack = obj('unpack 0 0 0 0', 1, 4, [40, 310, 90, 22], ['int', 'int', 'int', 'int'])
pkev = obj('pack 0 0.', 2, 1, [40, 340, 70, 22])
setv = msg('setvalue $1 ev $2', [40, 370, 110, 22])
wire(pk3, 0, tlb, 0)
wire(tlb, 1, counter, 0)
wire(counter, 0, join, 1)
wire(tlb, 0, join, 0)
wire(join, 0, tll, 0)
wire(tll, 1, expr, 0)
wire(expr, 0, pkev, 1)
wire(tll, 0, unpack, 0)
wire(unpack, 0, pkev, 0)
wire(pkev, 0, setv, 0)
wire(setv, 0, gen, 0)
# the picture follows the same events
pvoice = obj('prepend voice', 1, 1, [200, 190, 90, 22])
wire(pk3, 0, pvoice, 0)
wire(pvoice, 0, ui, 0)

# ---------------------------------------------------------------- output
unpk = obj('mc.unpack~ 8', 1, 8, [400, 450, 200, 22], ['signal'] * 8)
summ = obj('expr~ $v1+$v2+$v3+$v4+$v5+$v6+$v7+$v8', 8, 1, [400, 480, 260, 22], ['signal'])
wire(gen, 0, unpk, 0)
for k in range(8):
    wire(unpk, k, summ, k)
gain = box('live.gain~', 2, 5, [400, 520, 48, 136], ['signal', 'signal', '', 'float', 'list'],
           parameter_enable=1, varname='Output', presentation=1,
           presentation_rect=[702, 16, 40, 148], showname=0, channels=2, orientation=1,
           saved_attribute_attributes=param_attrs('Output', 'Output', 0, -70.0, 6.0, -6.0, 4))
plugout = obj('plugout~', 2, 0, [400, 670, 60, 22])
wire(summ, 0, gain, 0)
wire(summ, 0, gain, 1)
wire(gain, 0, plugout, 0)
wire(gain, 1, plugout, 1)

# ---------------------------------------------------------------- controls
# (name, to gen~ as well as the v8ui)
_px = [0]


def route_param(oid, name, to_gen):
    _px[0] += 1
    pre = obj('prepend %s' % name, 1, 1, [900 + (_px[0] % 6) * 110, 600 + (_px[0] // 6) * 30, 100, 22])
    wire(oid, 0, pre, 0)
    wire(pre, 0, ui, 0)
    if to_gen:
        wire(pre, 0, gen, 0)


R = [16, 66, 116]          # dial rows
C = [172, 268, 364, 460, 556, 652]  # column origins (two 44-px cells each)
for x, label in zip(C, ['PLATE', 'PITCH', 'EXCITE', 'DRIVE TONE', 'SAND', '']):
    if label:
        comment(label, [x, 1, 90, 14])

# plate
route_param(tab('Geometry', ['rect', 'disc'], [C[0], 18, 90, 15], 1), 'geom', False)
route_param(tab('Edge', ['free', 'supp', 'clamp', 'mixed'], [C[0], 34, 90, 15], 1), 'edge', False)
route_param(tab('Dispersion', ['plate', 'membrane'], [C[0], 50, 90, 15], 0), 'disp', False)
route_param(dial('Aspect', 'Aspect', [C[0], R[1], 44, 48], 0.25, 4.0, 1.0, 1, 2.0), 'aspect', False)
route_param(dial('Q', 'Q', [C[0] + 46, R[1], 44, 48], 1.0, 2000.0, 300.0, 1, 3.0), 'q', True)
dxd = dial('Drive X', 'X', [C[0], R[2], 44, 48], 0.0, 1.0, 0.62)
dyd = dial('Drive Y', 'Y', [C[0] + 46, R[2], 44, 48], 0.0, 1.0, 0.38)
route_param(dxd, 'dx', False)
route_param(dyd, 'dy', False)
wire(route, 0, dxd, 0)
wire(route, 1, dyd, 0)

# pitch
route_param(tab('Mapping', ['chromatic', 'ladder'], [C[1], 18, 90, 15], 0), 'mapmode', True)
voices = tab('Voices', ['mono', 'poly'], [C[1], 36, 90, 15], 1)
tib = obj('t i b', 1, 2, [200, 40, 40, 22], ['int', 'bang'])
plus = obj('+ 1', 2, 1, [200, 70, 30, 22], ['int'])
flush = msg('flush', [250, 100, 40, 22])
wire(voices, 0, tib, 0)
wire(tib, 0, plus, 0)
wire(plus, 0, gate, 0)
wire(tib, 1, flush, 0)
wire(flush, 0, poly1, 0)
wire(flush, 0, poly8, 0)
route_param(dial('Plate Tune', 'Plate', [C[1], R[1], 44, 48], 0, 127, 36, 8, ptype=1), 'platetune', True)
route_param(dial('Key Track', 'Track', [C[1] + 46, R[1], 44, 48], 0.0, 100.0, 100.0, 5), 'keytrack', True)
route_param(dial('Glide', 'Glide', [C[1], R[2], 44, 48], 0.0, 2000.0, 0.0, 2, 3.0), 'glide', True)
route_param(dial('Release Damp', 'Damp', [C[1] + 46, R[2], 44, 48], 0.0, 100.0, 50.0, 5), 'damp', True)

# excitation
route_param(dial('Strike', 'Strike', [C[2], R[0], 44, 48], 0.0, 100.0, 80.0, 5), 'strike', True)
route_param(dial('Hardness', 'Hard', [C[2] + 46, R[0], 44, 48], 0.0, 100.0, 50.0, 5), 'hardness', True)
route_param(dial('Drive', 'Drive', [C[2], R[1], 44, 48], 0.0, 100.0, 0.0, 5), 'drive', True)
route_param(dial('Partials', 'Partials', [C[2] + 46, R[1], 44, 48], 1, 8, 5, 0, ptype=1), 'partials', False)
route_param(dial('Drive Attack', 'Attack', [C[2], R[2], 44, 48], 1.0, 5000.0, 20.0, 2, 3.0), 'dattack', True)
route_param(dial('Drive Release', 'Release', [C[2] + 46, R[2], 44, 48], 1.0, 5000.0, 300.0, 2, 3.0), 'drelease', True)

# drive tone
route_param(tab('Waveform', ['sine', 'square', 'saw'], [C[3], 18, 90, 15], 0), 'wave', False)
route_param(dial('Tilt', 'Tilt', [C[3], R[1], 44, 48], -1.5, 1.5, 0.0), 'tilt', False)
route_param(dial('Focus', 'Focus', [C[3] + 46, R[1], 44, 48], 0.0, 8.0, 0.0), 'focus', False)
route_param(dial('Focus Width', 'Width', [C[3], R[2], 44, 48], 0.1, 4.0, 0.6), 'focusq', False)

# sand
route_param(tab('Field', ['off', 'motion', 'rms'], [C[4], 18, 90, 15], 0), 'field', False)
route_param(menu('Palette', ['brass', 'ice', 'ember', 'mono'], [C[4], 36, 90, 15], 0), 'palette', False)
route_param(dial('Grains', 'Grains', [C[4], R[1], 44, 48], 0, 8000, 3000, 0, ptype=1), 'grains', False)
route_param(dial('Trails', 'Trails', [C[4] + 46, R[1], 44, 48], 0.0, 0.97, 0.0), 'trails', False)
route_param(dial('Crawl', 'Crawl', [C[4], R[2], 44, 48], 0.0, 0.4, 0.2), 'crawl', False)
route_param(dial('Hop', 'Hop', [C[4] + 46, R[2], 44, 48], 0.0, 0.25, 0.05), 'hop', False)
route_param(dial('Jitter', 'Jitter', [C[5], R[0], 44, 48], 0.0, 1.0, 0.15), 'jitter', False)
route_param(dial('Feed', 'Feed', [C[5], R[1], 44, 48], 0.0, 1.0, 1.0), 'feed', False)
route_param(dial('Sand Hue', 'Hue', [C[5], R[2], 44, 48], 0, 360, 42, 0, ptype=1), 'hue', False)

# ---------------------------------------------------------------- patcher
patcher = {
    'patcher': {
        'fileversion': 1,
        'appversion': {'major': 9, 'minor': 0, 'revision': 0, 'architecture': 'x64', 'modernui': 1},
        'classnamespace': 'box',
        'rect': [60, 80, 1500, 900],
        'openrect': [0.0, 0.0, 0.0, 169.0],
        'openinpresentation': 1,
        'default_fontsize': 10.0,
        'default_fontface': 0,
        'default_fontname': 'Arial Bold',
        'gridonopen': 1,
        'gridsize': [8.0, 8.0],
        'gridsnaponopen': 1,
        'objectsnaponopen': 1,
        'statusbarvisible': 2,
        'toolbarvisible': 1,
        'boxanimatetime': 500,
        'enablehscroll': 1,
        'enablevscroll': 1,
        'devicewidth': 0.0,
        'description': 'Chladni plate modal synthesizer',
        'digest': '',
        'tags': '',
        'style': '',
        'subpatcher_template': '',
        'assistshowspatchername': 0,
        'boxes': boxes,
        'lines': lines,
        'latency': 0,
        'is_mpe': 0,
        'external_mpe_tuning_enabled': 0,
        'minimum_live_version': '',
        'minimum_max_version': '',
        'platform_compatibility': 0,
        'autosave': 0,
    }
}

data = json.dumps(patcher, indent=1).encode('utf-8') + b'\n\x00'
# container: 'ampf' header with the device type ('iiii' = instrument), an empty
# meta chunk, then the patcher json
blob = (b'ampf' + struct.pack('<I', 4) + b'iiii' +
        b'meta' + struct.pack('<I', 4) + b'\x00\x00\x00\x00' +
        b'ptch' + struct.pack('<I', len(data)) + data)
with open(OUT, 'wb') as f:
    f.write(blob)
print('wrote %s (%d bytes, %d boxes, %d lines)' % (OUT, len(blob), len(boxes), len(lines)))
