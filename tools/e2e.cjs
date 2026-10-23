#!/usr/bin/env node
/**
 * sysflow 端到端自检（零依赖，Node 22+ 自带 WebSocket）
 *
 * 用法：
 *   1) 起一个带调试端口的 Chrome（页面指向 sysflow.html）：
 *      chrome --headless=new --disable-gpu --remote-debugging-port=9224 \
 *             --user-data-dir=./.tmp/profile --window-size=1440,900 \
 *             "file:///<绝对路径>/sysflow.html"
 *   2) node tools/e2e.cjs 9224 .tmp
 *
 * 覆盖：启动无报错 / 示例建图 / 流追踪 / 双视图 / 撤销重做 / 连线校验与 1口1线顶替 /
 *      组播派生与孤儿清理 / schema 字段 / 设备编辑与组播弹窗 / 图库保存与刷新恢复 /
 *      真实鼠标拖拽·拖线·双击·滚轮·平移·点线删除。
 * 退出码：全部通过 0，有失败 1，驱动异常 2。截图与 report.json 落在输出目录。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = process.argv[2] || '9224';
const OUT = process.argv[3] || '.tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await httpJson('http://127.0.0.1:' + PORT + '/json/list'); if (targets && targets.length) break; } catch (e) { /* retry */ }
    await sleep(250);
  }
  if (!targets) throw new Error('连不上 Chrome 调试端口 ' + PORT + '（确认 Chrome 已用 --remote-debugging-port 启动）');

  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  const consoleErrors = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('SHOT ' + name + '.png');
  };

  const checks = [];
  const check = (name, cond, extra) => {
    checks.push({ name, pass: !!cond, extra: extra === undefined ? null : extra });
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''));
  };

  // ---------- 鼠标事件 ----------
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', buttons: 1, clickCount: 1 }, extra));
  const drag = async (from, to, steps = 8) => {
    await mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { buttons: 1 });
      await sleep(10);
    }
    await mouse('mouseReleased', to.x, to.y, { buttons: 0 });
    await sleep(120);
  };
  const click = async (pt, count = 1) => {
    await mouse('mousePressed', pt.x, pt.y, { clickCount: count });
    await mouse('mouseReleased', pt.x, pt.y, { buttons: 0, clickCount: count });
    await sleep(80);
  };
  const center = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};})()`);

  // ==========================================================================
  // 第一阶段：模型 / 派生 / 视图 / 存储
  // ==========================================================================
  await sleep(300);
  await ev('localStorage.clear(); location.reload();');
  await sleep(1200);

  check('boot: 无脚本错误', await ev('document.getElementById("bootError").classList.contains("hidden")'));
  check('boot: 种子模板 3 个', (await ev('window.__SF__.templates().length')) === 3);

  await ev('__SF__.openDemo()');
  await sleep(300);
  const st = await ev('({d:__SF__.devices().length,l:__SF__.links().length,f:__SF__.flows().length})');
  check('demo: 4 设备 / 4 连线 / 2 路流', st.d === 4 && st.l === 4 && st.f === 2, st);

  const paths = await ev('__SF__.flows().map(f=>({n:f.name,br:f.paths.map(p=>p.broken),links:f.paths.map(p=>p.linkIds.length)}))');
  check('trace: 两路流路径完整且各 2 段', paths.every((f) => f.br.every((b) => !b) && f.links[0] === 2), paths);

  await ev('__SF__.fitView(true); __SF__.render();');
  await sleep(250);
  await shot('01-physical');

  await ev('document.querySelector("#viewSeg button[data-mode=routing]").click()');
  await sleep(300);
  const rout = await ev('({mode:__SF__.S.view.mode,segs:document.querySelectorAll("#svg path.edge.flow").length,items:document.querySelectorAll(".flow-item").length})');
  check('routing: 4 段流线 + 面板 2 路', rout.mode === 'routing' && rout.segs === 4 && rout.items === 2, rout);
  await shot('02-routing');

  await ev('document.querySelectorAll(".flow-item")[0].click()');
  await sleep(250);
  const sel = await ev('({segs:document.querySelectorAll("#svg path.edge.flow").length,sel:__SF__.S.view.selectedFlow})');
  check('routing: 选流后只剩该流 2 段', sel.segs === 2, sel);
  await ev('document.querySelector("#viewSeg button[data-mode=physical]").click()');
  await sleep(200);

  // 撤销 / 重做
  const n0 = await ev('__SF__.devices().length');
  await ev('__SF__.addDevice(__SF__.templates()[0], {x:900,y:600})');
  const n1 = await ev('__SF__.devices().length');
  await ev('__SF__.undo()');
  const n2 = await ev('__SF__.devices().length');
  await ev('__SF__.redo()');
  const n3 = await ev('__SF__.devices().length');
  check('undo/redo: 4 → 5 → 4 → 5', n0 === 4 && n1 === 5 && n2 === 4 && n3 === 5, { n0, n1, n2, n3 });
  await ev('__SF__.undo()');

  // 连线校验
  check('connect: 自连被拒', (await ev("__SF__.connect({device:'demo_enc',port:'demo_enc_p1'},{device:'demo_enc',port:'demo_enc_p2'})")) === false);
  const lc0 = await ev('__SF__.links().length');
  await ev("__SF__.connect({device:'demo_sw',port:'demo_sw_p7'},{device:'demo_mon2',port:'demo_mon2_p1'})");
  const lc1 = await ev('__SF__.links().length');
  check('connect: 1 口 1 线顶替（连线数不变）', lc0 === lc1, { lc0, lc1 });
  await ev('__SF__.undo()');

  // 派生：全部发送端停发 → 孤儿接收清理
  const cleanup = await ev(`(function(){
    var d=__SF__.S.doc;
    var enc=d.graph.devices.filter(function(x){return x.id==='demo_enc';})[0];
    var clone=JSON.parse(JSON.stringify(enc));
    clone.ports=clone.ports.filter(function(p){return p.id!=='demo_enc_p1';});
    __SF__.updateDevice('demo_enc', clone);
    var sw=d.graph.devices.filter(function(x){return x.id==='demo_sw';})[0];
    var swClone=JSON.parse(JSON.stringify(sw));
    swClone.ports.forEach(function(p){p.multicast_out=[];});
    __SF__.updateDevice('demo_sw', swClone);
    var mon=d.graph.devices.filter(function(x){return x.id==='demo_mon1';})[0];
    var dangling=d.graph.links.filter(function(l){return l.from.device==='demo_enc'&&l.from.port==='demo_enc_p1';}).length;
    return {monIn:mon.ports[0].multicast_in.length,dangling:dangling};
  })()`);
  check('data: 停发后孤儿接收条目被清理', cleanup.monIn === 0 && cleanup.dangling === 0, cleanup);
  await ev('__SF__.undo(); __SF__.undo();');

  const shape = await ev('(function(){var d=__SF__.doc();return {v:d.graph.version,dk:Object.keys(d.graph.devices[0]).sort(),lk:Object.keys(d.graph.links[0]).sort()};})()');
  check('schema: version=2 且字段齐全', shape.v === 2 && shape.dk.indexOf('ports') >= 0 && shape.lk.indexOf('from') >= 0, shape);

  // 导入归一化往返
  const rt = await ev(`(function(){
    var d=__SF__.doc();
    var copy=__SF__.normalizeDoc(JSON.parse(JSON.stringify({name:d.name,graph:d.graph,layout:d.layout})));
    var bad=false; try{__SF__.normalizeDoc({foo:1});}catch(e){bad=true;}
    return {d:copy.graph.devices.length,l:copy.graph.links.length,curD:d.graph.devices.length,bad:bad,
            portsOk:copy.graph.devices.every(function(x){return x.ports.every(function(p){return Array.isArray(p.multicast_in)&&Array.isArray(p.multicast_out);});})};
  })()`);
  check('import: 归一化往返一致且拒绝坏 JSON', rt.d === rt.curD && rt.portsOk && rt.bad, rt);

  // 弹窗
  await ev('__SF__.S.view.selectedDevice="demo_enc"; __SF__.render();');
  const menu = await ev(`(function(){
    document.querySelector('[data-dev="demo_enc"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300,cancelable:true}));
    var items=document.querySelectorAll('#menu [data-mi]');
    if(items.length) items[0].click();
    var m=document.querySelector('.mask .modal');
    return {items:items.length,modal:!!m,title:m?m.querySelector('.mhead b').textContent:''};
  })()`);
  check('ui: 右键菜单 → 编辑设备弹窗', menu.modal && menu.items >= 2, menu);
  await sleep(200);
  await shot('03-device-editor');

  const mc = await ev(`(function(){
    var b=document.querySelector('.mask .mbody [data-mc-port]');
    if(!b) return {found:false};
    b.click();
    var ms=document.querySelectorAll('.mask'); var top=ms[ms.length-1];
    return {found:true,masks:ms.length,title:top.querySelector('.mhead b').textContent,rows:top.querySelectorAll('[data-mc]').length};
  })()`);
  check('ui: 设备编辑内可叠层打开组播配置', mc.found && mc.masks === 2, mc);
  await ev('(function(){var ms=document.querySelectorAll(".mask .x");ms[ms.length-1].click();ms[0].click();})()');

  const lib = await ev(`(function(){__SF__.saveToLibrary();var a=JSON.parse(localStorage.getItem('sf.library.v1')||'[]');return {n:a.length,name:a[0]&&a[0].name};})()`);
  check('storage: 保存到图库', lib.n === 1 && lib.name === '示例：两路信号', lib);

  await send('Page.reload');
  await sleep(1200);
  const restored = await ev('({d:__SF__.devices().length,name:document.getElementById("graphName").value})');
  check('storage: 刷新后恢复画布', restored.d === 4 && restored.name === '示例：两路信号', restored);
  await shot('04-after-reload');

  // ---------- 关系图视图（自动布局、只读） ----------
  const layoutBefore = await ev('JSON.stringify(__SF__.doc().layout.nodes)');
  await ev('document.querySelector("#viewSeg button[data-mode=relation]").click()');
  await sleep(300);
  const rel = await ev(`(function(){
    var ns=[].slice.call(document.querySelectorAll('#svg .rel-node'));
    var rects=ns.map(function(n){var r=n.querySelector('rect.rel-body');return {x:+r.getAttribute('x'),y:+r.getAttribute('y'),w:+r.getAttribute('width'),h:+r.getAttribute('height')};});
    var overlap=0;
    for(var i=0;i<rects.length;i++)for(var j=i+1;j<rects.length;j++){
      var a=rects[i],b=rects[j];
      if(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h) overlap++;
    }
    var expectEdges=__SF__.links().length;
    return {nodes:ns.length,devices:__SF__.devices().length,edges:document.querySelectorAll('#svg .rel-edge').length,
            expectEdges:expectEdges,overlap:overlap,mode:__SF__.S.view.mode,
            panel:!document.getElementById('flowPanel').classList.contains('hidden'),
            legend:document.querySelectorAll('#flowPanel .rel-lg').length};
  })()`);
  check('relation: 节点=设备数且卡片不重叠', rel.nodes === rel.devices && rel.overlap === 0, rel);
  check('relation: 连线=物理+信号连线', rel.edges === rel.expectEdges, { edges: rel.edges, expect: rel.expectEdges });
  check('relation: 图例面板可见', rel.mode === 'relation' && rel.panel && rel.legend >= 3, rel);
  const layoutAfter = await ev('JSON.stringify(__SF__.doc().layout.nodes)');
  check('relation: 不改动手动画布坐标', layoutBefore === layoutAfter);
  await shot('05-relation');
  await ev('document.querySelector("#viewSeg button[data-mode=physical]").click()');
  await sleep(200);

  // ==========================================================================
  // 第二阶段：真实鼠标交互
  // ==========================================================================
  await ev('__SF__.openDemo(); __SF__.fitView(true); __SF__.render();');
  await sleep(400);

  const before = await ev('__SF__.doc().layout.nodes.demo_enc');
  const box = await center('[data-dev="demo_enc"] rect.body');
  check('canvas: 设备已渲染', !!box, box);
  await drag({ x: box.x, y: box.y }, { x: box.x + 140, y: box.y + 60 });
  const after = await ev('__SF__.doc().layout.nodes.demo_enc');
  const zoom = await ev('__SF__.S.view.cam.zoom');
  check('drag: 设备坐标按缩放换算', Math.abs((after.x - before.x) - 140 / zoom) < 6 && Math.abs((after.y - before.y) - 60 / zoom) < 6,
    { dx: after.x - before.x, dy: after.y - before.y, zoom });

  // 拖线建连：新增 SDI 源 + 监视器
  await ev(`(function(){
    var t=__SF__.templates();
    __SF__.addDevice(t.filter(function(x){return x.type==='SDI-Source';})[0],{x:120,y:520});
    __SF__.addDevice(t.filter(function(x){return x.type==='Monitor';})[0],{x:520,y:520});
    __SF__.fitView(true); __SF__.render();
  })()`);
  await sleep(400);
  const ids = await ev(`(function(){var ds=__SF__.devices(),a=ds[ds.length-2],b=ds[ds.length-1];return {a:a.id,b:b.id,pa:a.ports[0].id,pb:b.ports[0].id};})()`);
  const pSrc = await center(`[data-port="${ids.a}|${ids.pa}"] .hit`);
  const pDst = await center(`[data-port="${ids.b}|${ids.pb}"] .hit`);
  const beforeLinks = await ev('__SF__.links().length');
  await drag(pSrc, pDst);
  const afterLinks = await ev('__SF__.links().length');
  const newLink = await ev('(function(){var l=__SF__.links();return l[l.length-1];})()');
  check('wire: SDI 源 → 监视器建线成功', afterLinks === beforeLinks + 1 && newLink.signal_type === 'sdi', { beforeLinks, afterLinks, type: newLink.signal_type });

  const lcSelf = await ev('__SF__.links().length');
  await drag(pSrc, pSrc);
  check('wire: 同端口自连不建线', (await ev('__SF__.links().length')) === lcSelf);

  // 双击 IP 端口 → 组播配置
  const ipPort = await center('[data-port="demo_enc|demo_enc_p1"] .hit');
  await click(ipPort);
  await sleep(60);
  await click(ipPort);
  await sleep(300);
  const mcTitle = await ev('(function(){var m=document.querySelectorAll(".mask");return m.length?m[m.length-1].querySelector(".mhead b").textContent:null;})()');
  check('dblclick: 打开端口组播配置', !!mcTitle && mcTitle.indexOf('组播配置') >= 0, mcTitle);
  await ev('(function(){var x=document.querySelectorAll(".mask .x");x[x.length-1].click();})()');

  // 滚轮缩放 / 空白平移
  const z0 = await ev('__SF__.S.view.cam.zoom');
  const vb0 = await ev('document.getElementById("svg").getAttribute("viewBox")');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: -240, button: 'none', buttons: 0 });
  await sleep(250);
  const z1 = await ev('__SF__.S.view.cam.zoom');
  const vb1 = await ev('document.getElementById("svg").getAttribute("viewBox")');
  check('wheel: 滚轮缩放', z1 > z0, { z0, z1 });
  // 回归：相机必须真的落到 viewBox 上（否则只是数字变了、画面不动，拖拽还会跟手不一致）
  check('wheel: 缩放写进了 viewBox', !!vb0 && !!vb1 && parseFloat(vb1.split(' ')[2]) < parseFloat(vb0.split(' ')[2]),
    { vb0, vb1 });

  // 找一块真正空白的画布区域（窗口尺寸变化时固定坐标可能落在设备上）
  const bgPt = await ev(`(function(){
    var cands=[[innerWidth-60,innerHeight-60],[80,innerHeight-60],[innerWidth-60,120],[80,120],[innerWidth/2,innerHeight-80]];
    for(var i=0;i<cands.length;i++){
      var el=document.elementFromPoint(cands[i][0],cands[i][1]);
      if(!el) continue;
      if(el.closest('[data-dev]')||el.closest('#flowPanel')||el.closest('#topbar')||el.closest('#statusbar')||el.closest('#connectBar')) continue;
      return {x:cands[i][0],y:cands[i][1]};
    }
    return null;
  })()`);
  check('pan: 找到空白点', !!bgPt, bgPt);
  const cam0 = await ev('__SF__.S.view.cam');
  await drag({ x: bgPt.x, y: bgPt.y }, { x: bgPt.x - 90, y: bgPt.y - 50 });
  const cam1 = await ev('__SF__.S.view.cam');
  check('pan: 空白拖拽平移', Math.abs(cam1.x - cam0.x) > 1 || Math.abs(cam1.y - cam0.y) > 1, { from: cam0.x, to: cam1.x });

  // 点线删除
  await ev('__SF__.fitView(true); __SF__.render();');
  await sleep(300);
  const edgePt = await ev(`(function(){
    var ps=document.querySelectorAll('#svg path.edge.phys');
    for (var i=0;i<ps.length;i++){
      var p=ps[i], len=p.getTotalLength();
      for (var t=0.2;t<=0.85;t+=0.05){
        var pt=p.getPointAtLength(len*t), m=p.getScreenCTM();
        var x=m.a*pt.x+m.c*pt.y+m.e, y=m.b*pt.x+m.d*pt.y+m.f;
        var el=document.elementFromPoint(x,y);
        if(el&&el.closest&&el.closest('[data-link]')) return {x:x,y:y};
      }
    }
    return null;
  })()`);
  check('edge: 找到可命中点', !!edgePt, edgePt);
  if (edgePt) {
    const cnt0 = await ev('__SF__.links().length');
    await click(edgePt);
    const dlg = await ev('(function(){var m=document.querySelectorAll(".mask");return m.length?m[m.length-1].querySelector(".mhead b").textContent:null;})()');
    check('edge: 点击弹出删除确认', dlg === '删除连线', dlg);
    if (dlg) {
      await ev('(function(){var b=document.querySelectorAll(".mask [data-mbtn]");b[b.length-1].click();})()');
      await sleep(200);
    }
    check('edge: 确认后连线删除', (await ev('__SF__.links().length')) === cnt0 - 1);
  }

  await shot('06-interaction');

  // 批量导入（旧接口 /api/graph/all 的数组格式；多张进图库并打开第一张）
  const bulk = await ev(`(function(){
    var d=__SF__.doc();
    var before=JSON.parse(localStorage.getItem('sf.library.v1')||'[]').length;
    var a=__SF__.normalizeDoc({name:'图A',graph:d.graph,layout:d.layout});
    var b=__SF__.normalizeDoc({name:'图B',graph:d.graph,layout:d.layout});
    __SF__.importDocs([a,b]);
    var lib=JSON.parse(localStorage.getItem('sf.library.v1')||'[]');
    return {before:before,after:lib.length,name:__SF__.doc().name,devices:__SF__.devices().length,devBefore:d.graph.devices.length};
  })()`);
  check('import: 数组批量导入（进图库并打开第一张）',
    bulk.after === bulk.before + 2 && bulk.name === '图A' && bulk.devices === bulk.devBefore, bulk);

  // ==========================================================================
  const failed = checks.filter((c) => !c.pass);
  console.log('\n==== 结果 ====');
  console.log('通过 ' + (checks.length - failed.length) + '/' + checks.length);
  if (errors.length) console.log('EXCEPTIONS: ' + JSON.stringify(errors, null, 2));
  if (consoleErrors.length) console.log('CONSOLE ERRORS: ' + JSON.stringify(consoleErrors, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ checks, errors, consoleErrors }, null, 2));
  ws.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
