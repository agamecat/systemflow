#!/usr/bin/env python3
"""生成**脱敏的示例数据**，供仓库自带的演示使用。

输出：
    data/sample-system-diagram.json   7 台设备 / 6 条光纤 / 3 路组播（全部虚构）
    data/device-templates.json        3 个虚构设备模板

说明：这里所有设备名、地址、坐标都是编造的（Node01…、239.0.0.x），与任何真实机房无关。
想换成自己的图：不要改这个脚本，直接把导出的 JSON 放进 data/ 并更新 data/README.md 即可。
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, '..', 'data'))


def mc(mid, address, name):
    return {'id': mid, 'address': address, 'name': name}


def port(pid, number, direction, bidi, mc_in=None, mc_out=None):
    return {
        'id': pid,
        'number': number,
        'type': 'ip_port',
        'direction': direction,
        'bidirectional': bidi,
        'program': '',
        'multicast_in': mc_in or [],
        'multicast_out': mc_out or [],
    }


def device(did, name, dtype, ports, x, y):
    return {
        'id': did,
        'name': name,
        'type': dtype,
        'ports': ports,
        'inner_links': [],
        'sparse_ports': False,
        '_pos': {'x': x, 'y': y},   # 仅生成用，写出前删除
    }


def link(lid, frm, fport, to, tport):
    return {
        'id': lid,
        'signal_type': 'ip',
        'from': {'device': frm, 'port': fport},
        'to': {'device': to, 'port': tport},
    }


STREAMS = [
    ('s1', 'udp://239.0.0.11:5000', 'Stream 01'),
    ('s2', 'udp://239.0.0.12:5000', 'Stream 02'),
    ('s3', 'udp://239.0.0.13:5000', 'Stream 03'),
]

devices = []

# 三台「源」：各发一路组播
for i, (sid, addr, name) in enumerate(STREAMS, start=1):
    devices.append(device(
        'n%d' % i, 'Node0%d' % i, 'Encoder',
        [port('n%d_p1' % i, '1', 'out', True, mc_out=[mc('mc_%s_out' % sid, addr, name)])],
        80, 120 + (i - 1) * 190,
    ))

# 一台交换机：1-4 口在左收流，5-8 口在右转发
sw_ports = []
for n in range(1, 9):
    direction = 'in' if n <= 4 else 'out'
    pin, pout = [], []
    if n <= 3:
        sid, addr, name = STREAMS[n - 1]
        pin = [mc('mc_%s_swin' % sid, addr, name)]
    if 5 <= n <= 7:
        sid, addr, name = STREAMS[n - 5]
        pout = [mc('mc_%s_swout' % sid, addr, name)]
    sw_ports.append(port('n4_p%d' % n, str(n), direction, True, mc_in=pin, mc_out=pout))
devices.append(device('n4', 'Node04', 'Net-Switch', sw_ports, 430, 230))

# 一台监视器 + 一台录像机 + 一台监视器（终端）
devices.append(device('n5', 'Node05', 'Monitor',
                      [port('n5_p1', '1', 'in', True, mc_in=[mc('mc_' + STREAMS[0][0] + '_m1', STREAMS[0][1], STREAMS[0][2])])],
                      840, 120))
devices.append(device('n6', 'Node06', 'Monitor',
                      [port('n6_p1', '1', 'in', True, mc_in=[mc('mc_' + STREAMS[1][0] + '_m2', STREAMS[1][1], STREAMS[1][2])])],
                      840, 320))
devices.append(device('n7', 'Node07', 'Recorder',
                      [port('n7_p1', '1', 'in', True, mc_in=[mc('mc_' + STREAMS[2][0] + '_r1', STREAMS[2][1], STREAMS[2][2])])],
                      840, 520))

links = [
    link('l1', 'n1', 'n1_p1', 'n4', 'n4_p1'),
    link('l2', 'n2', 'n2_p1', 'n4', 'n4_p2'),
    link('l3', 'n3', 'n3_p1', 'n4', 'n4_p3'),
    link('l4', 'n4', 'n4_p5', 'n5', 'n5_p1'),
    link('l5', 'n4', 'n4_p6', 'n6', 'n6_p1'),
    link('l6', 'n4', 'n4_p7', 'n7', 'n7_p1'),
]

layout = {'version': 1, 'nodes': {}, 'viewport': {'x': 0, 'y': 0, 'zoom': 1}}
for d in devices:
    layout['nodes'][d['id']] = d.pop('_pos')

graph = {'version': 2, 'name': 'Sample System', 'devices': devices, 'links': links}
payload = {
    'app': 'sysflow',
    'schemaVersion': 2,
    'name': 'Sample System',
    'graph': graph,
    'layout': layout,
}

templates = [
    {
        'id': 'tpl_encoder',
        'type': 'Encoder',
        'name': '编码器',
        'description': 'Mock 模板：单路 IP 组播输出',
        'ports': [{'number': '1', 'type': 'ip_port', 'direction': 'out', 'bidirectional': True, 'program': ''}],
        'inner_links': [],
    },
    {
        'id': 'tpl_router',
        'type': 'Router',
        'name': '路由器',
        'description': 'Mock 模板：4 口双向 IP 路由',
        'ports': [
            {'number': str(n), 'type': 'ip_port', 'direction': 'in' if n <= 2 else 'out',
             'bidirectional': True, 'program': ''}
            for n in range(1, 5)
        ],
        'inner_links': [],
    },
    {
        'id': 'tpl_recorder',
        'type': 'Recorder',
        'name': '录制器',
        'description': 'Mock 模板：单路 IP 组播录制',
        'ports': [{'number': '1', 'type': 'ip_port', 'direction': 'in', 'bidirectional': True, 'program': ''}],
        'inner_links': [],
    },
]


def main():
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, 'sample-system-diagram.json'), 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    with open(os.path.join(DATA, 'device-templates.json'), 'w', encoding='utf-8') as fh:
        json.dump(templates, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print('生成完成：%d 台设备 / %d 条连线 / %d 个模板' % (len(devices), len(links), len(templates)))


if __name__ == '__main__':
    main()
