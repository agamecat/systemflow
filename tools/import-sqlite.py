#!/usr/bin/env python3
"""把旧后端 SQLite 里的信号图导出成新版 sysflow.html 可直接「导入」的 JSON。

旧库结构（sf-app/app/model/db.py，表 graphs）：
    id TEXT, name TEXT, graph_json TEXT, layout_json TEXT, created_at, updated_at

用法：
    python tools/import-sqlite.py <sf_db.sqlite> [输出目录]
    # 例：python tools/import-sqlite.py D:/backup/sf_db.sqlite ./old-graphs

输出：
    每张图一个 <输出目录>/<图名>.json，内容形如 {"name":..,"graph":{...},"layout":{...}}
    <输出目录>/_all.json            所有图组成的数组（一次导入全部，新程序会整批进图库）
    <输出目录>/templates.json       设备模板（在新程序的「设备模板」里点「导入模板」）
    在新版 sysflow.html 顶栏点「导入」选中即可（会自动补齐缺省字段、丢弃坏引用）。

只用标准库，不改动源库（以只读方式打开）。
"""
import argparse
import json
import os
import re
import sqlite3
import sys


def safe_name(text, fallback):
    name = re.sub(r'[\\/:*?"<>|\r\n\t]+', '_', (text or '').strip()) or fallback
    return name[:60]


def load_graph(raw):
    """graph_json 可能是完整 SignalGraph，也可能被包了一层 {graph:...}。"""
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError('graph_json 不是对象')
    if isinstance(data.get('graph'), dict):
        return data['graph'], data.get('layout') or None, data.get('name')
    return data, None, None


def main():
    ap = argparse.ArgumentParser(description='导出旧 sysflow 信号图为新单文件版可导入的 JSON')
    ap.add_argument('db', help='旧数据库文件（sf_db.sqlite）')
    ap.add_argument('out', nargs='?', default='old-graphs', help='输出目录（默认 old-graphs）')
    args = ap.parse_args()

    if not os.path.isfile(args.db):
        sys.exit('找不到数据库：' + args.db)

    conn = sqlite3.connect('file:%s?mode=ro' % args.db.replace('\\', '/'), uri=True)
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if 'graphs' not in tables:
        sys.exit('这个库里没有 graphs 表（当前表：%s）' % (', '.join(sorted(tables)) or '空'))

    os.makedirs(args.out, exist_ok=True)
    rows = conn.execute('SELECT id, name, graph_json, layout_json FROM graphs').fetchall()
    if not rows:
        sys.exit('graphs 表是空的，没有可导出的图')

    ok, bad = 0, 0
    exported = []
    for graph_id, name, graph_json, layout_json in rows:
        label = name or graph_id
        try:
            graph, wrapped_layout, wrapped_name = load_graph(graph_json or '{}')
            layout = wrapped_layout
            if layout is None and layout_json:
                layout = json.loads(layout_json)
            payload = {
                'app': 'sysflow',
                'schemaVersion': graph.get('version', 2),
                'name': wrapped_name or label,
                'graph': graph,
                'layout': layout or {},
                'source': {'id': graph_id},
            }
            filename = safe_name(label, graph_id) + '.json'
            path = os.path.join(args.out, filename)
            n = 1
            while os.path.exists(path):                      # 同名图不覆盖
                n += 1
                path = os.path.join(args.out, '%s (%d).json' % (safe_name(label, graph_id), n))
            with open(path, 'w', encoding='utf-8') as fh:
                json.dump(payload, fh, ensure_ascii=False, indent=2)
            devices = len(graph.get('devices') or [])
            links = len(graph.get('links') or [])
            exported.append(payload)
            print('OK   %-28s 设备 %3d / 连线 %3d  → %s' % (label, devices, links, path))
            ok += 1
        except Exception as exc:                             # 单张图坏掉不影响其它图
            print('SKIP %-28s %s' % (label, exc))
            bad += 1

    if exported:
        all_path = os.path.join(args.out, '_all.json')
        with open(all_path, 'w', encoding='utf-8') as fh:
            json.dump(exported, fh, ensure_ascii=False, indent=2)
        print('OK   %-28s %d 张 → %s' % ('（合并文件）', len(exported), all_path))

    # 设备模板（旧库 device_templates 表；没有就跳过）
    if 'device_templates' in tables:
        tpls = []
        for _id, typ, nm, desc, pj, ij in conn.execute(
                'SELECT id, type, name, description, ports_json, inner_links_json FROM device_templates'):
            try:
                tpls.append({
                    'id': _id,
                    'type': typ,
                    'name': nm,
                    'description': desc or '',
                    'ports': json.loads(pj or '[]'),
                    'inner_links': json.loads(ij or '[]'),
                })
            except Exception as exc:
                print('SKIP 模板 %-24s %s' % (typ, exc))
        if tpls:
            tpl_path = os.path.join(args.out, 'templates.json')
            with open(tpl_path, 'w', encoding='utf-8') as fh:
                json.dump(tpls, fh, ensure_ascii=False, indent=2)
            print('OK   %-28s %d 个 → %s' % ('（设备模板）', len(tpls), tpl_path))

    conn.close()
    print('\n完成：导出 %d 张，跳过 %d 张。' % (ok, bad))
    if ok:
        print('下一步：打开 sysflow.html → 顶栏「导入」→ 选 _all.json（一次全部进图库）；')
        print('        设备模板在「设备模板」弹窗里点「导入模板」选 templates.json。')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
