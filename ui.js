/* 界面与渲染层 */
(function () {
  'use strict';

  const $ = function (s) { return document.querySelector(s); };

  const editor = $('#editor');
  const gutter = $('#gutter');
  const gutterInner = $('#gutterInner');
  const highlightEl = $('#highlight');
  const codewrap = $('#codewrap');
  const codeview = $('#codeview');
  const pgutterEl = $('#pgutter');
  const pgutterInner = $('#pgutterInner');
  const viz = $('#viz');
  const vizHint = $('#vizHint');
  const varsEl = $('#vars');
  const stackEl = $('#callstack');
  const outEl = $('#output');
  const msgEl = $('#msg');
  const stepInfo = $('#stepInfo');
  const seek = $('#seek');
  const btnPlay = $('#btnPlay');
  const fileNameEl = $('#fileName');
  const varsCountEl = $('#varsCount');
  const stackCountEl = $('#stackCount');
  const fileInput = $('#fileInput');
  const langSel = $('#langSel');
  const langBadge = $('#langBadge');
  const watchInput = $('#watchInput');
  const btnAddWatch = $('#btnAddWatch');
  const watchListEl = $('#watchList');
  const watchCountEl = $('#watchCount');
  const memListEl = $('#memList');
  const memCountEl = $('#memCount');
  const memInput = $('#memInput');
  const btnAddMem = $('#btnAddMem');
  const memExprsEl = $('#memExprs');
  const stdinEl = $('#stdin');
  const inputPanel = $('#inputPanel');
  const inputCountEl = $('#inputCount');
  const layoutEl = $('.layout');
  const sideEl = $('.side');
  const codePanelEl = $('.code-panel');

  let run = null;
  let cur = 0;
  let playing = false;
  let timer = null;
  let speed = 1;
  let editing = true;
  let graphSeq = 0;
  let savedScroll = 0;
  let errorLine = null;
  let runCode = '';
  let lastVizHTML = '';
  let lastVizHint = '';
  let lastVizStep = -1;
  let lastVizApplied = '';
  let lastVarsHTML = '';
  let lastStackHTML = '';
  let lastOutText = '';
  let lastMemHTML = '';
  let outCacheText = '';
  let outCacheCount = 0;
  let renderRaf = 0;
  let genSeq = 0;
  let lintIssues = [];
  const VIZ_PREFS_KEY = 'cv-viz-prefs';
  const vizPrefs = { array: 'cell', tree: 'vertical', graph: 'circle' };
  try {
    const savedPrefs = JSON.parse(localStorage.getItem(VIZ_PREFS_KEY) || '{}');
    if (savedPrefs.array === 'cell' || savedPrefs.array === 'bar' || savedPrefs.array === 'heat') vizPrefs.array = savedPrefs.array;
    if (savedPrefs.tree === 'vertical' || savedPrefs.tree === 'horizontal') vizPrefs.tree = savedPrefs.tree;
    if (savedPrefs.graph === 'circle' || savedPrefs.graph === 'grid') vizPrefs.graph = savedPrefs.graph;
  } catch (e) {}
  function saveVizPrefs() {
    try { localStorage.setItem(VIZ_PREFS_KEY, JSON.stringify(vizPrefs)); } catch (e) {}
  }
  const breakpoints = new Set();
  const cursorPosEl = $('#cursorPos');

  const CUSTOM_TEMPLATE = `/* 这是你自己写代码的地方：把下面整段替换成你的代码（C / C++ / Python / Java 都可以，语言会自动识别），
   然后点右上角「生成动画」。
   支持：int / char / 数组 / struct / 指针 / malloc / 递归 / for / while / switch / printf / scanf
   字符串函数：strlen / strcmp / strcpy / strcat；生成动画前会自动做一遍代码检查
   小提示：用到 scanf / cin / input 时，先在右侧「输入」面板按读取顺序填数据。
*/

#include <stdio.h>

int main() {
    int a[5] = {5, 3, 1, 4, 2};
    int i, j, t;

    for (i = 0; i < 4; i++) {
        for (j = 0; j < 4 - i; j++) {
            if (a[j] > a[j + 1]) {
                t = a[j];
                a[j] = a[j + 1];
                a[j + 1] = t;
            }
        }
    }

    for (i = 0; i < 5; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}`;

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtNum(v) {
    if (typeof v !== 'number') return String(v);
    if (Number.isInteger(v)) return String(v);
    return String(parseFloat(v.toFixed(3)));
  }
  function cellText(it) {
    if (!it) return '';
    if (it.k === 'num') return fmtNum(it.v);
    if (it.k === 'str') return it.v === '\0' ? '∅' : it.v;
    if (it.k === 'null') return 'NULL';
    if (it.k === 'obj') return '#' + it.id;
    if (it.k === 'ref') return it.label;
    if (it.k === 'arr') return '[…]';
    return '·';
  }
  function heapMapOf(st) {
    const m = {};
    st.heap.forEach(function (h) { m[h.id] = h; });
    return m;
  }
  function showMsg(text, kind) {
    msgEl.textContent = text || '';
    msgEl.className = 'msg' + (kind ? ' ' + kind : '');
  }
  // 比较两个变量视图是否等价（比 JSON.stringify 快很多，且在小对象上更稳）
  function sameValue(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
      if (!sameValue(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  }
  // 把同一帧内的多次渲染合并成一次，拖动进度条时不再逐步重排
  function renderSoon() {
    if (renderRaf) return;
    renderRaf = requestAnimationFrame(function () {
      renderRaf = 0;
      render();
    });
  }

  /* ---------- 报错信息与修改建议 ---------- */
  const SUGGESTIONS = [
    [/这里应该是 ";"/, '最常见的原因是上一行少了分号，或者 () / {} 没有配对。从报错行往上，逐行检查最近的一条语句和括号。'],
    [/这里应该是 "\)"|这里应该是 "\}"/, '括号没有配对。检查报错行附近的 ( ) 和 { } 是否成对，函数调用参数之间是否少了逗号。'],
    [/参数|参数名/, '函数参数要写成「类型 名字」，例如 int n、int a[]、SqList &L（引用参数已支持）。常见错误：漏写参数名、多写逗号、在参数里写默认值（如 int x = 0）。'],
    [/这里需要类型/, '声明的地方缺少类型名，例如 int、char、struct Node。也可能是把普通语句写成了声明开头。'],
    [/未定义的变量/, '这个名字没有声明，或拼写/大小写不一致。检查它是否声明在别的函数或别的作用域里。std::string、vector 等标准库类型不支持。'],
    [/未定义的函数/, '只支持你自己定义的函数，以及 printf / puts / scanf / gets / fgets / getchar / malloc / free / strlen 等常用函数。C++ 的 cin / cout 已支持；std::string、vector 等标准库容器不支持。'],
    [/无法解析的顶层语句/, '函数外面只能写 #include / #define、结构体、typedef、全局变量和函数定义。using namespace、class、模板等 C++ 写法不支持。'],
    [/访问了空指针|没有成员/, '指针是 NULL 时不能访问成员，先用 if (p != NULL) 判断；结构体变量用 p.data，结构体指针用 p->data。'],
    [/解引用空指针/, '指针当前是 NULL，不能 *p 取值，先判断 if (p != NULL)。'],
    [/除数为 0|取余的除数为 0/, '除数可能为 0，先判断再除。'],
    [/下标越界/, '数组下标超出了有效范围。检查循环边界：长度为 n 的数组，合法下标是 0 ~ n-1；循环条件通常是 i < n，而不是 i <= n。'],
    [/下标/, '下标越界或对非数组取下标。检查循环范围（如 i < n）是否超过数组长度。'],
    [/输入不够|需要更多输入|输入已用完/, '程序读取的数据比「输入」面板里提供的多。按 scanf / cin / input 的读取顺序补齐数据（空格或换行分隔），再重新生成动画。'],
    [/暂不支持.*(Python|append|f-string)/, 'Python / Java 走的是「常用语法子集」：循环、数组、函数、打印、输入都支持；动态列表（append）、类和字符串方法暂不支持，可以改用固定长度列表 + 下标。'],
    [/步骤太多|循环次数过多/, '可能是死循环：检查循环变量是否更新（如 i++）、终止条件是否会成立，或把数据规模调小。'],
    [/没有找到 main/, '程序需要入口函数：int main() { ... return 0; }。'],
    [/调用层数太深/, '递归可能缺少终止条件，检查是否写了 if (n <= 0) return ... 这样的边界。'],
    [/给未定义的变量|赋值/, '赋值号左边必须是已经声明过的变量，检查是否拼错，或变量声明在别的作用域。']
  ];

  function suggestionFor(msg) {
    for (let i = 0; i < SUGGESTIONS.length; i++) {
      if (SUGGESTIONS[i][0].test(msg)) return SUGGESTIONS[i][1];
    }
    return '';
  }

  function errorCard(kind, rawMsg, line) {
    const clean = String(rawMsg || '').replace(/（第 \d+ 行）\s*$/, '');
    let frame = '';
    if (line) {
      const lines = editor.value.split('\n');
      const from = Math.max(1, line - 2);
      const to = Math.min(lines.length, line + 2);
      const out = [];
      for (let n = from; n <= to; n++) {
        const txt = esc(lines[n - 1] || '');
        if (n === line) {
          out.push('<span class="bad"><span class="lnum">▶ ' + n + '</span> | ' + txt + '</span>');
        } else {
          out.push('<span>  ' + n + ' | ' + txt + '</span>');
        }
      }
      frame = '<pre class="err-frame">' + out.join('\n') + '</pre>';
    }
    const tip = suggestionFor(clean);
    const inc = editor.value.match(/#include\s*"([^"]+)"/);
    const incTip = inc
      ? '<div class="err-help"><b>文件提示：</b>检测到 #include "' + esc(inc[1]) +
        '"。本工具不会读取磁盘文件，请把该头文件里的 typedef / struct 一起粘贴进来，' +
        '或点「导入文件」同时选择 .h 和 .c（会自动合并）。</div>'
      : '';
    const needHeader = !!inc || /类型|没有定义/.test(clean);
    return '<div class="errbox">' +
      '<div class="err-head"><span class="err-tag">' + esc(kind) + '</span>' +
      (line ? '<span class="err-where">第 ' + line + ' 行</span>' : '') + '</div>' +
      '<div class="err-body">' +
        '<div class="err-msg">' + esc(clean) + '</div>' +
        frame +
        (tip ? '<div class="err-help"><b>怎么改：</b>' + esc(tip) + '</div>' : '') +
        incTip +
        '<div class="err-actions">' +
          (needHeader ? '<button class="btn tiny accent" data-import="1">导入 .h 文件</button>' : '') +
          (line ? '<button class="btn tiny" data-goto="' + line + '">跳到第 ' + line + ' 行</button>' : '') +
          '<button class="btn tiny" data-goto="edit">返回编辑</button>' +
        '</div>' +
      '</div></div>';
  }

  function vizLegend() {
    return '<div class="vizlegend">' +
      '<span class="vlg"><i class="vlg-chg"></i>本步变化</span>' +
      '<span class="vlg"><i class="vlg-ptr"></i>变量 / 指针指向</span>' +
      '<span class="vlg"><i class="vlg-vis"></i>已访问</span>' +
      '</div>';
  }

  function lintCard(issues) {
    if (!issues || !issues.length) return '';
    return '<div class="lintbox"><div class="lint-head">' +
      '<span class="lint-tag">代码检查</span>' +
      '<span class="lint-sub">发现 ' + issues.length + ' 处可能的问题（可先修复再运行）</span></div>' +
      '<div class="lint-list">' +
      issues.map(function (it) {
        return '<div class="lint-item">' +
          '<button class="lint-ln" data-goto="' + it.line + '">第 ' + it.line + ' 行</button>' +
          '<span class="lint-msg">' + esc(it.msg) + '</span>' +
          (it.hint ? '<span class="lint-hint">' + esc(it.hint) + '</span>' : '') +
          '</div>';
      }).join('') +
      '</div></div>';
  }

  function heroEmpty(text) {
    return '<div class="empty">' +
      '<div class="eicon">❀</div>' +
      '<h2>把你的代码，跑成动画</h2>' +
      '<p>' + esc(text || '粘贴 C / C++ / Python / Java 代码，或导入 .c / .h 文件。自动识别语言，逐行高亮执行，数组、链表、树、图同步变化，逻辑错误一眼看出。') + '</p>' +
      '<div class="esteps"><div><b>1</b> 粘贴 / 导入</div><div><b>2</b> 生成动画</div><div><b>3</b> 断点调试</div></div>' +
      '<button class="btn primary" data-empty="import">导入 .c / .h 文件</button>' +
      '</div>';
  }

  function getCursorLine() {
    const pos = editor.selectionStart || 0;
    return editor.value.slice(0, pos).split('\n').length;
  }

  function gotoLine(line) {
    const lines = editor.value.split('\n');
    line = Math.max(1, Math.min(line, lines.length));
    let pos = 0;
    for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;
    editor.focus();
    editor.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
    editor.scrollTop = Math.max(0, (line - 4) * 23);
    syncScroll();
    updateCursorPos();
  }

  function setErrorLine(line) {
    errorLine = line || null;
    if (editing) refreshGutter();
  }

  /* SVG 无法直接读 CSS 变量，按当前主题取色 */
  function svgColors() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark ? {
      line: '#38496a', edge: '#33425c', arrow: '#5b7098',
      hot: '#7c9cff', visited: '#fb923c',
      nodeFill: '#181c22', nodeText: '#f2eee5',
      weight: '#a8b0ba', halo: '#12151a'
    } : {
      line: '#cbd5e1', edge: '#aab8cc', arrow: '#94a3b8',
      hot: '#2e4fd1', visited: '#c2410c',
      nodeFill: '#fffdf9', nodeText: '#121417',
      weight: '#5e574c', halo: '#fdfbf6'
    };
  }

  /* ---------- 语法高亮 ---------- */
  const HL_TYPES = new Set(['int', 'char', 'float', 'double', 'void', 'long', 'short',
    'signed', 'unsigned', 'bool', '_Bool', 'size_t']);
  const HL_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'break', 'continue',
    'return', 'switch', 'case', 'default', 'sizeof', 'typedef', 'struct', 'union',
    'enum', 'const', 'static', 'extern', 'goto', 'NULL', 'true', 'false']);

  function span(cls, text) {
    return '<span class="tk-' + cls + '">' + esc(text) + '</span>';
  }

  function hl(code) {
    let out = '';
    let i = 0;
    const n = code.length;
    while (i < n) {
      const c = code[i];
      if (c === '/' && code[i + 1] === '/') {
        let j = code.indexOf('\n', i);
        if (j < 0) j = n;
        out += span('cm', code.slice(i, j));
        i = j;
        continue;
      }
      if (c === '/' && code[i + 1] === '*') {
        let j = code.indexOf('*/', i + 2);
        j = j < 0 ? n : j + 2;
        out += span('cm', code.slice(i, j));
        i = j;
        continue;
      }
      if (c === '#' && (i === 0 || code[i - 1] === '\n')) {
        let j = code.indexOf('\n', i);
        if (j < 0) j = n;
        out += span('pp', code.slice(i, j));
        i = j;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && code[j] !== c) {
          if (code[j] === '\\') j++;
          j++;
        }
        j = Math.min(n, j + 1);
        out += span('st', code.slice(i, j));
        i = j;
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] || ''))) {
        let j = i;
        while (j < n && /[0-9a-fA-FxX.]/.test(code[j])) j++;
        out += span('nu', code.slice(i, j));
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_]/.test(code[j])) j++;
        const w = code.slice(i, j);
        let k = j;
        while (k < n && (code[k] === ' ' || code[k] === '\t')) k++;
        let cls = '';
        if (HL_TYPES.has(w)) cls = 'ty';
        else if (HL_KEYWORDS.has(w)) cls = 'kw';
        else if (code[k] === '(') cls = 'fn';
        else if (/^[A-Z_][A-Z0-9_]{1,}$/.test(w)) cls = 'mc';
        out += cls ? span(cls, w) : esc(w);
        i = j;
        continue;
      }
      if (/[+\-*\/%<>=!&|^~?:]/.test(c)) {
        out += span('op', c);
        i++;
        continue;
      }
      out += esc(c);
      i++;
    }
    return out;
  }

  /* ---------- 编辑 / 播放视图 ---------- */
  function syncScroll() {
    highlightEl.scrollTop = editor.scrollTop;
    highlightEl.scrollLeft = editor.scrollLeft;
    gutterInner.style.transform = 'translateY(' + (-editor.scrollTop) + 'px)';
  }

  if (codeview) {
    codeview.addEventListener('scroll', function () {
      if (pgutterInner) {
        pgutterInner.style.transform = 'translateY(' + (-codeview.scrollTop) + 'px)';
      }
    });
  }
  if (pgutterEl) {
    pgutterEl.addEventListener('click', function (e) {
      const el = e.target.closest('.pgl');
      if (el) toggleBreakpoint(parseInt(el.getAttribute('data-line'), 10));
    });
  }

  function refreshHighlight() {
    highlightEl.innerHTML = hl(editor.value) + '\n';
    syncScroll();
  }

  function refreshGutter() {
    const lines = editor.value.split('\n');
    let html = '';
    for (let i = 0; i < lines.length; i++) {
      const n = i + 1;
      const bp = breakpoints.has(n);
      const er = errorLine === n;
      html += '<div class="gl' + (bp ? ' bp' : '') + (er ? ' err' : '') +
        '" data-line="' + n + '" title="第 ' + n + ' 行 · 单击设置/取消断点">' +
        '<span class="gdot"></span>' + n + '</div>';
    }
    gutterInner.innerHTML = html;
  }

  function updateCursorPos() {
    if (!cursorPosEl) return;
    const pos = editor.selectionStart || 0;
    const before = editor.value.slice(0, pos).split('\n');
    cursorPosEl.textContent = '行 ' + before.length + '，列 ' + (before[before.length - 1].length + 1);
  }

  function toggleBreakpoint(line) {
    if (!line) return;
    if (breakpoints.has(line)) breakpoints.delete(line);
    else breakpoints.add(line);
    const el = codeview.querySelector('.cl[data-line="' + line + '"]');
    if (el) el.classList.toggle('bp', breakpoints.has(line));
    if (pgutterEl) {
      const pel = pgutterEl.querySelector('.pgl[data-line="' + line + '"]');
      if (pel) pel.classList.toggle('bp', breakpoints.has(line));
    }
    if (editing) refreshGutter();
  }

  function buildCodeview(code) {
    const lines = code.split('\n');
    codeview.innerHTML = lines.map(function (ln, i) {
      const n = i + 1;
      return '<div class="cl' + (breakpoints.has(n) ? ' bp' : '') + '" data-line="' + n + '">' +
        '<span class="ln">' + n + '</span>' +
        '<span class="ct">' + (ln === '' ? ' ' : hl(ln)) + '</span></div>';
    }).join('');
    if (pgutterInner) {
      pgutterInner.innerHTML = lines.map(function (ln, i) {
        const n = i + 1;
        return '<div class="pgl' + (breakpoints.has(n) ? ' bp' : '') +
          (errorLine === n ? ' err' : '') + '" data-line="' + n + '">' + n + '</div>';
      }).join('');
      pgutterInner.style.transform = 'translateY(0px)';
    }
    codeview.scrollTop = 0;
  }

  function setActiveLine(n) {
    const olds = codeview.querySelectorAll('.cl.active');
    for (let i = 0; i < olds.length; i++) olds[i].classList.remove('active');
    if (pgutterEl) {
      const olds2 = pgutterEl.querySelectorAll('.pgl.active');
      for (let i = 0; i < olds2.length; i++) olds2[i].classList.remove('active');
      const pel = pgutterEl.querySelector('.pgl[data-line="' + n + '"]');
      if (pel) pel.classList.add('active');
    }
    const el = codeview.querySelector('.cl[data-line="' + n + '"]');
    if (!el) return;
    el.classList.add('active');
    codeview.scrollTop = Math.max(0, el.offsetTop - codeview.clientHeight / 2);
  }

  function setEditing(on) {
    if (!on) savedScroll = editor.scrollTop;
    editing = on;
    codewrap.classList.toggle('playing', !on);
    $('#btnEdit').style.display = on ? 'none' : '';
    $('#btnRun').textContent = on ? '生成动画' : '重新运行';
    if (on) {
      refreshGutter();
      refreshHighlight();
      editor.focus();
      // 聚焦时浏览器可能把光标滚到末尾，这里恢复原滚动位置
      editor.scrollTop = savedScroll;
      syncScroll();
      updateCursorPos();
    }
  }

  /* ---------- 链表 / 树 ---------- */
  function buildChain(rootId, heap, structs) {
    const nodes = [];
    const seen = new Set();
    let cycleId = null;
    let id = rootId;
    while (id != null && heap[id] && !seen.has(id)) {
      seen.add(id);
      const h = heap[id];
      nodes.push(h);
      const pf = (structs[h.struct] || []).filter(function (f) { return f.type.ptr > 0; })
        .map(function (f) { return f.name; });
      const nf = pf.indexOf('next') >= 0 ? 'next' : pf[0];
      const fv = nf ? h.fields[nf] : null;
      const nextId = fv && fv.k === 'obj' ? fv.id : null;
      if (nextId != null && seen.has(nextId)) {
        cycleId = nextId;
        id = null;
      } else {
        id = nextId;
      }
    }
    return { nodes: nodes, cycleId: cycleId };
  }

  function dataFieldOf(h) {
    const keys = Object.keys(h.fields);
    for (let i = 0; i < keys.length; i++) {
      const fv = h.fields[keys[i]];
      if (fv.k === 'num' || fv.k === 'str') return keys[i];
    }
    return null;
  }

  function listBlock(label, structName, chain, structs, ptrNames) {
    const fields = structs[structName] || [];
    const ptrFields = fields.filter(function (f) { return f.type.ptr > 0; })
      .map(function (f) { return f.name; });
    const isDouble = ptrFields.some(function (n) { return /prev|prior|before/i.test(n); });
    const nextName = ptrFields.filter(function (n) { return /^next|link$/i.test(n); })[0] ||
      ptrFields.filter(function (n) { return !/prev|prior|before/i.test(n); })[0];
    const prevName = ptrFields.filter(function (n) { return /prev|prior|before/i.test(n); })[0];
    const sep = isDouble ? '⇄' : '→';
    const head = '<div class="ds"><div class="ds-title"><b>' + esc(label) +
      '</b><span class="ty">' + esc(structName) + (isDouble ? ' 双向链表' : ' 链表') + '</span></div>';
    if (!chain.nodes.length) {
      return head + '<div class="empty-small">空链表（NULL）</div></div>';
    }
    const parts = chain.nodes.map(function (h) {
      const key = dataFieldOf(h);
      const names = (ptrNames && ptrNames[h.id]) || [];
      const badges = names.map(function (nm) { return '<span class="lptr">' + esc(nm) + '</span>'; }).join('');
      const nv = nextName ? h.fields[nextName] : null;
      const pv = prevName ? h.fields[prevName] : null;
      const nx = nv && nv.k === 'obj' ? '#' + nv.id : (nv && nv.k === 'null' ? 'NULL' : '');
      const pvt = pv && pv.k === 'obj' ? '#' + pv.id : (pv && pv.k === 'null' ? 'NULL' : '');
      return '<div class="lwrap">' +
        '<div class="lptrrow">' + badges + '</div>' +
        '<div class="lnode' + (badges ? ' hl' : '') + '" title="' +
        esc((nextName || 'next') + ' → ' + (nx || 'NULL') + (isDouble ? ' · ' + prevName + ' → ' + pvt : '')) + '">' +
        '<div class="ln-data">' + esc(key ? cellText(h.fields[key]) : '·') + '</div>' +
        '<div class="ln-dot">›</div></div>' +
        '<div class="lid">#' + h.id + '</div></div>';
    });
    const tail = chain.cycleId != null ? '↩ #' + chain.cycleId + ' 成环' : 'NULL';
    return head + '<div class="chain"><span class="cptr">' + esc(label) + '</span>' +
      '<span class="carrow">' + sep + '</span>' + parts.join('<span class="carrow">' + sep + '</span>') +
      '<span class="carrow">' + sep + '</span><span class="cnull">' + tail + '</span></div>' +
      '<div class="ds-foot">方框 = 一个结点，框内是数据；右侧 › 指向下一个结点，NULL 表示链表结束</div>' +
      (isDouble ? '<div class="empty-small">每个结点同时保存 prev 和 next，可以双向遍历</div>' : '') +
      (ptrNames && Object.keys(ptrNames).length ?
        '<div class="empty-small">结点上方标签表示当前指向它的指针变量</div>' : '') +
      '</div>';
  }

  function isLeftField(n) {
    return /^(left|leftchild|lchild|lc|firstchild|first_child)$/i.test(n);
  }
  function isRightField(n) {
    return /^(right|rightchild|rchild|rc|nextsibling|next_sibling)$/i.test(n);
  }

  function treeBlock(label, structName, rootId, heap, structs, ptrNames) {
    const pos = new Map();
    const edges = [];
    const seen = new Set();
    let nextX = 0;
    let maxDepth = 0;

    function walk(id, depth) {
      if (id == null || !heap[id] || seen.has(id)) return;
      seen.add(id);
      const h = heap[id];
      const pf = (structs[h.struct] || []).filter(function (f) { return f.type.ptr > 0; })
        .map(function (f) { return f.name; });
      let lf = null, rf = null;
      pf.forEach(function (nm) {
        if (isLeftField(nm)) lf = nm;
        if (isRightField(nm)) rf = nm;
      });
      function getId(nm) {
        if (!nm) return null;
        const fv = h.fields[nm];
        return fv && fv.k === 'obj' ? fv.id : null;
      }
      const lid = getId(lf);
      const rid = getId(rf);
      if (lid != null) edges.push([id, lid, 'L']);
      if (rid != null) edges.push([id, rid, 'R']);
      walk(lid, depth + 1);
      pos.set(id, { x: nextX++, depth: depth, h: h });
      maxDepth = Math.max(maxDepth, depth);
      walk(rid, depth + 1);
    }
    walk(rootId, 0);

    const W = 68, H = 82;
    const horiz = vizPrefs.tree === 'horizontal';
    const stepX = horiz ? 118 : W;
    const stepY = horiz ? 64 : H;
    const C = svgColors();
    const width = horiz ? (maxDepth + 1) * stepX + 24 : Math.max(1, nextX) * W + 10;
    const height = horiz ? Math.max(1, nextX) * stepY + 8 : (maxDepth + 1) * H + 6;
    const nx = function (p) { return horiz ? p.depth * stepX : p.x * W; };
    const ny = function (p) { return horiz ? p.x * stepY : p.depth * H; };
    let svg = '<svg class="tlines" width="' + width + '" height="' + height + '">';
    edges.forEach(function (e) {
      const p = pos.get(e[0]), c = pos.get(e[1]);
      if (!p || !c) return;
      const x1 = nx(p) + (horiz ? (W - 10) : (W / 2 - 3));
      const y1 = ny(p) + (horiz ? 23 : 47);
      const x2 = nx(c) + (horiz ? 0 : (W / 2 - 3));
      const y2 = ny(c) + (horiz ? 23 : 1);
      svg += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
        '" stroke="' + C.line + '" stroke-width="1.6" />';
      const lx = horiz ? (x1 + x2) / 2 : ((x1 + x2) / 2 + (e[2] === 'L' ? -8 : 8));
      const ly = horiz ? ((y1 + y2) / 2 - 6) : ((y1 + y2) / 2 + 3);
      svg += '<text x="' + lx + '" y="' + ly +
        '" text-anchor="middle" font-size="9" fill="' + C.weight +
        '" stroke="' + C.halo + '" stroke-width="3" paint-order="stroke" ' +
        'font-family="JetBrains Mono, monospace">' + e[2] + '</text>';
    });
    svg += '</svg>';

    let nodes = '';
    pos.forEach(function (p, id) {
      const key = dataFieldOf(p.h);
      const names = (ptrNames && ptrNames[id]) || [];
      nodes += '<div class="tnode' + (id === rootId ? ' troot' : '') + (names.length ? ' hl' : '') +
        '" style="left:' + (nx(p) + 3) + 'px;top:' + ny(p) + 'px;width:' + (W - 10) + 'px"' +
        (names.length ? ' title="当前指针：' + esc(names.join(', ')) + '"' : '') + '>' +
        '<div class="tn-data">' + esc(key ? cellText(p.h.fields[key]) : '·') + '</div>' +
        '<div class="tn-id">#' + id + (names.length ? ' · ' + esc(names.join(',')) : '') + '</div></div>';
    });

    return '<div class="ds"><div class="ds-title"><b>' + esc(label) +
      '</b><span class="ty">' + esc(structName) + ' 二叉树</span></div>' +
      '<div class="treebox" style="width:' + width + 'px;height:' + height + 'px">' +
      svg + nodes + '</div>' +
      '<div class="ds-foot">最上面是根结点；L = 左孩子，R = 右孩子；结点上方的标签表示当前指向它的指针</div></div>';
  }

  /* ---------- 图（邻接矩阵） ---------- */
  function isGraphMatrix(v) {
    const items = v.view.items || [];
    const n = items.length;
    if (n < 2 || n > 14) return false;
    let edgeCount = 0;
    for (let i = 0; i < n; i++) {
      const row = items[i].items;
      if (!row || row.length !== n) return false;
      for (let j = 0; j < n; j++) {
        if (row[j].k !== 'num') return false;
        if (i !== j && row[j].v > 0 && row[j].v < 1000) edgeCount++;
      }
      // 对角线允许是 0 或 INF 这类“无边”标记
      if (row[i].v !== 0 && row[i].v < 1000) return false;
    }
    return edgeCount > 0;
  }

  function graphBlock(v, marks, visited) {
    const mat = v.view.items.map(function (r) {
      return r.items.map(function (c) { return c.v; });
    });
    return drawGraph(v.name, mat, marks, visited, '邻接矩阵 · 图');
  }

  function drawGraph(label, mat, marks, visited, typeLabel) {
    const n = mat.length;
    function hasEdge(i, j) {
      const w = mat[i][j];
      return w > 0 && w < 1000;
    }
    let weighted = false;
    for (let i = 0; i < n && !weighted; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j && hasEdge(i, j) && mat[i][j] !== 1) { weighted = true; break; }
      }
    }

    let W, H;
    const P = [];
    if (vizPrefs.graph === 'grid') {
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      const cw = 130, ch = 112;
      const rows = Math.ceil(n / cols);
      for (let i = 0; i < n; i++) {
        P.push({ x: (i % cols) * cw + 72, y: Math.floor(i / cols) * ch + 60 });
      }
      W = cols * cw;
      H = rows * ch;
    } else {
      const R = Math.max(62, n * 13);
      const cx = R + 44;
      const cy = R + 34;
      W = cx * 2;
      H = cy * 2;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / n;
        P.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
      }
    }

    const hot = {};
    const hotNames = [];
    Object.keys(marks).forEach(function (nm) {
      if (!/^(u|v|k|start|source|cur|now|x|y)$/.test(nm)) return;
      const val = marks[nm];
      if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val < n) {
        hot[val] = 1;
        hotNames.push(nm + '=' + val);
      }
    });

    const gid = 'garrow' + (++graphSeq);
    const nr = 19;
    const C = svgColors();
    let lines = '<defs><marker id="' + gid + '" viewBox="0 0 10 10" refX="8" refY="5" ' +
      'markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="' + C.arrow + '"></path></marker></defs>';

    function weightLabel(x, y, w) {
      return '<text x="' + x + '" y="' + (y + 3) + '" text-anchor="middle" font-size="10" ' +
        'fill="' + C.weight + '" stroke="' + C.halo + '" stroke-width="3" paint-order="stroke" ' +
        'font-family="JetBrains Mono, monospace">' + esc(fmtNum(w)) + '</text>';
    }

    function withWeight(i, j, x, y) {
      return weighted && hasEdge(i, j) ? weightLabel(x, y, mat[i][j]) : '';
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a1 = hasEdge(i, j);
        const a2 = hasEdge(j, i);
        if (!a1 && !a2) continue;
        const isHot = !!(hot[i] && hot[j]);
        const col = isHot ? C.hot : C.edge;
        const wid = isHot ? 3.2 : 1.5;
        const p1 = P[i], p2 = P[j];
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;

        if (a1 && a2 && mat[i][j] === mat[j][i]) {
          lines += '<line x1="' + (p1.x + ux * nr) + '" y1="' + (p1.y + uy * nr) +
            '" x2="' + (p2.x - ux * nr) + '" y2="' + (p2.y - uy * nr) +
            '" stroke="' + col + '" stroke-width="' + wid + '" />';
          lines += withWeight(i, j, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        } else {
          if (a1) {
            lines += '<line x1="' + (p1.x + ux * nr) + '" y1="' + (p1.y + uy * nr) +
              '" x2="' + (p2.x - ux * (nr + 5)) + '" y2="' + (p2.y - uy * (nr + 5)) +
              '" stroke="' + col + '" stroke-width="' + wid +
              '" marker-end="url(#' + gid + ')" />';
            lines += withWeight(i, j, (p1.x + p2.x) / 2 + uy * 8, (p1.y + p2.y) / 2 - ux * 8);
          }
          if (a2) {
            lines += '<line x1="' + (p2.x - ux * nr) + '" y1="' + (p2.y - uy * nr) +
              '" x2="' + (p1.x + ux * (nr + 5)) + '" y2="' + (p1.y + uy * (nr + 5)) +
              '" stroke="' + col + '" stroke-width="' + wid +
              '" marker-end="url(#' + gid + ')" />';
            lines += withWeight(j, i, (p1.x + p2.x) / 2 - uy * 8, (p1.y + p2.y) / 2 + ux * 8);
          }
        }
      }
    }

    let nodes = '';
    P.forEach(function (p, i) {
      const isHot = !!hot[i];
      const vis = visited && visited.has(i);
      const ring = isHot ? C.hot : (vis ? C.visited : C.edge);
      const sw = (isHot || vis) ? 2.6 : 1.5;
      const fill = isHot ? C.hot : (vis ? C.visited : C.nodeFill);
      const fo = (isHot || vis) ? '0.18' : '1';
      nodes += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + nr +
        '" fill="' + fill + '" fill-opacity="' + fo + '" stroke="' + ring + '" stroke-width="' + sw + '" />' +
        '<text x="' + p.x + '" y="' + (p.y + 4) + '" text-anchor="middle" font-size="12" ' +
        'font-weight="' + ((isHot || vis) ? '700' : '400') + '" ' +
        'fill="' + C.nodeText + '" font-family="JetBrains Mono, monospace">' + i + '</text>';
    });

    let legend = '';
    if (hotNames.length || (visited && visited.size)) {
      legend = '<div class="graphlegend">' +
        hotNames.map(function (t) {
          return '<span class="gl-item"><i class="gl-hot"></i>' + esc(t) + '</span>';
        }).join('') +
        (visited && visited.size ? '<span class="gl-item"><i class="gl-vis"></i>已访问</span>' : '') +
        '</div>';
    }
    return '<div class="ds"><div class="ds-title"><b>' + esc(label) +
      '</b><span class="ty">' + esc(typeLabel) + '</span></div><div class="graphbox">' +
      '<svg class="graphsvg" width="' + W + '" height="' + H + '">' + lines + nodes + '</svg>' +
      '</div>' + legend +
      '<div class="ds-foot">圆点 = 顶点，连线 = 边' + (weighted ? '，边上的数字 = 权值' : '') +
      '；蓝色 = 当前正在处理的顶点，橙色 = 已访问</div></div>';
  }

  /* ---------- 图（邻接表） ---------- */
  function arcShape(structName, structs) {
    const fields = structs[structName] || [];
    const next = fields.find(function (f) { return f.type.ptr > 0 && /^(next|link)$/i.test(f.name); });
    const to = fields.find(function (f) {
      return f.type.ptr === 0 && !(f.type.dims && f.type.dims.length) &&
        /^(adjvex|adjv|to|v|vex|vertex|dest|target)$/i.test(f.name);
    });
    const weight = fields.find(function (f) {
      return f.type.ptr === 0 && !(f.type.dims && f.type.dims.length) &&
        /^(w|weight|cost)$/i.test(f.name);
    });
    return { next: next, to: to, weight: weight };
  }

  /* 顶点数组 + 每格一个边链表；兼容两种写法：
     1) 数组元素本身就是链头（List[5]，用 next 连接）
     2) 数组元素是 VNode，真正链表在 firstarc / firstedge 指向的另一种结构体里 */
  function adjInfo(v, heap, structs) {
    const items = v.view.items || [];
    if (items.length < 2 || items[0].k !== 'obj') return null;
    const first = heap[items[0].id];
    if (!first) return null;
    const vf = structs[first.struct] || [];
    const arcField = vf.find(function (f) {
      return f.type.ptr > 0 && /^(firstarc|firstedge|first|head|arc|edge|adj|next)$/i.test(f.name);
    });
    if (!arcField) return null;
    let arcName = arcField.type.base;
    if (!structs[arcName]) {
      for (let i = 0; i < items.length; i++) {
        const h = heap[items[i].id];
        if (!h) continue;
        const fv = h.fields[arcField.name];
        if (fv && fv.k === 'obj') {
          const ah = heap[fv.id];
          if (ah) { arcName = ah.struct; break; }
        }
      }
    }
    const shape = arcShape(structs[arcName] ? arcName : first.struct, structs);
    if (!shape.next || !shape.to) return null;
    return { items: items, arcField: arcField, shape: shape, arcStruct: arcName };
  }

  function isAdjListArray(v, heap, structs) {
    return !!adjInfo(v, heap, structs);
  }

  function firstArc(h, fieldName, heap) {
    if (!h) return null;
    const nv = h.fields[fieldName];
    return nv && nv.k === 'obj' ? heap[nv.id] : null;
  }

  function adjacencyMatrixFromList(v, heap, structs, info) {
    const my = info || adjInfo(v, heap, structs);
    if (!my) return null;
    const items = my.items;
    const n = items.length;
    const mat = [];
    for (let i = 0; i < n; i++) mat.push(new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      let h = firstArc(heap[items[i].id], my.arcField.name, heap);
      let guard = 0;
      while (h && guard++ < 200) {
        const fv = h.fields[my.shape.to.name];
        const to = fv && fv.k === 'num' ? Math.trunc(fv.v) : -1;
        if (to >= 0 && to < n) {
          let w = 1;
          if (my.shape.weight) {
            const wv = h.fields[my.shape.weight.name];
            if (wv && wv.k === 'num' && wv.v > 0) w = wv.v;
          }
          mat[i][to] = w;
        }
        h = firstArc(h, my.shape.next.name, heap);
      }
    }
    return mat;
  }

  function adjListChains(v, heap, structs, info) {
    const my = info || adjInfo(v, heap, structs);
    if (!my) return '';
    let html = '<div class="ds"><div class="ds-title"><b>' + esc(v.name) +
      '</b><span class="ty">邻接表</span></div><div class="adjrows">';
    my.items.forEach(function (it, i) {
      let h = firstArc(heap[it.id], my.arcField.name, heap);
      const cells = [];
      let guard = 0;
      while (h && guard++ < 60) {
        const fv = h.fields[my.shape.to.name];
        let label = fv ? cellText(fv) : '·';
        if (my.shape.weight) {
          const wv = h.fields[my.shape.weight.name];
          if (wv && wv.k === 'num') label += '(' + fmtNum(wv.v) + ')';
        }
        cells.push('<span class="alnode">' + esc(label) + '</span>');
        h = firstArc(h, my.shape.next.name, heap);
      }
      html += '<div class="alrow"><span class="alhead">' + i + '</span>' +
        '<span class="carrow">→</span>' +
        (cells.length ? cells.join('<span class="carrow">→</span>') : '') +
        (cells.length ? '<span class="carrow">→</span>' : '') +
        '<span class="cnull">NULL</span></div>';
    });
    return html + '</div></div>';
  }

  /* ---------- 结构体数组 / 结构体卡片 ---------- */
  function structArrayBlock(v, heap, prevItems) {
    const items = v.view.items || [];
    const first = items.length ? heap[items[0].id] : null;
    if (!first) return '';
    const keys = Object.keys(first.fields).filter(function (k) {
      return first.fields[k].k !== 'obj';
    });
    let html = '<div class="ds"><div class="ds-title"><b>' + esc(v.name) +
      '</b><span class="ty">' + esc(v.type) + ' 结构体数组</span></div>' +
      '<div class="tablewrap"><table class="stable"><thead><tr><th>#</th>';
    keys.forEach(function (k) { html += '<th>' + esc(k) + '</th>'; });
    html += '</tr></thead><tbody>';
    const max = Math.min(items.length, 24);
    for (let i = 0; i < max; i++) {
      const h = heap[items[i].id];
      if (!h) continue;
      const changed = prevItems && prevItems[i] && prevItems[i].id !== items[i].id;
      html += '<tr' + (changed ? ' class="chg"' : '') + '><td class="ri">' + i + '</td>';
      keys.forEach(function (k) { html += '<td>' + esc(cellText(h.fields[k])) + '</td>'; });
      html += '</tr>';
    }
    html += '</tbody></table>';
    if (items.length > max) html += '<div class="empty-small">… 共 ' + items.length + ' 行</div>';
    html += '</div></div>';
    return html;
  }

  function structCard(label, h, heap) {
    const keys = Object.keys(h.fields);
    let html = '<div class="ds"><div class="ds-title"><b>' + esc(label) +
      '</b><span class="ty">' + esc(h.struct) + '</span></div><div class="scard">';
    keys.forEach(function (k) {
      const f = h.fields[k];
      let val;
      if (f.k === 'arr') {
        const cells = (f.items || []).slice(0, 24).map(function (it) {
          return '<span class="scell">' + esc(cellText(it)) + '</span>';
        }).join('');
        val = '<span class="scells">' + cells + '</span>';
      } else if (f.k === 'obj') {
        const sub = heap[f.id];
        val = '<span class="sval">→ #' + f.id + (sub ? ' (' + esc(sub.struct) + ')' : '') + '</span>';
      } else {
        val = '<span class="sval">' + esc(cellText(f)) + '</span>';
      }
      html += '<div class="srow"><span class="sname">' + esc(k) + '</span>' + val + '</div>';
    });
    const hasObj = keys.some(function (k) { return h.fields[k].k === 'obj'; });
    return html + (hasObj ? '<div class="ds-foot">→ #编号 表示这个字段指向另一个结构体结点</div>' : '') +
      '</div></div>';
  }

  /* ---------- 栈 / 队列（数组 + top / front/rear） ---------- */
  function stackInfo(v, frameVars, items) {
    if (!items.length) return null;
    if (!/stack|^st$|^s$|^sk$/i.test(v.name)) return null;
    if (!items.every(function (it) { return it.k === 'num' || it.k === 'str'; })) return null;
    let topVar = null;
    frameVars.forEach(function (f) {
      if (/^top$/i.test(f.name) && f.view.k === 'num') topVar = f;
    });
    if (!topVar) return null;
    const top = Math.trunc(topVar.view.v);
    if (top < -1 || top >= items.length) return null;
    return { top: top };
  }

  function queueInfo(v, frameVars, items) {
    if (!/queue|^q$|^qu$|^que$|^sq$|circ/i.test(v.name)) return null;
    let front = null;
    let rear = null;
    frameVars.forEach(function (f) {
      if (f.view.k !== 'num') return;
      if (/^front$/i.test(f.name)) front = f;
      if (/^rear$/i.test(f.name)) rear = f;
    });
    if (!front || !rear) return null;
    const f = Math.trunc(front.view.v);
    const r = Math.trunc(rear.view.v);
    if (f < 0 || r < 0 || r > items.length || f > r) return null;
    return { front: f, rear: r };
  }

  function stackBlock(v, items, info) {
    const top = info.top;
    const showMax = Math.min(items.length - 1, Math.max(top + 2, 4));
    let rows = '';
    for (let i = showMax; i >= 0; i--) {
      const filled = i <= top;
      rows += '<div class="srowi' + (i === top ? ' top' : '') + '">' +
        '<span class="sidx">' + i + '</span>' +
        '<span class="sbox' + (filled ? ' filled' : ' ghost') + (i === top ? ' hot' : '') + '">' +
        (filled ? esc(cellText(items[i])) : '') + '</span>' +
        (i === top ? '<span class="stop-tag">← 栈顶 top</span>' : '') +
        (i === 0 ? '<span class="sbase-tag">栈底</span>' : '') +
        '</div>';
    }
    return '<div class="ds"><div class="ds-title"><b>' + esc(v.name) +
      '</b><span class="ty">栈 · 后进先出</span>' +
      '<span class="ty">top = ' + top + (top < 0 ? '（空栈）' : '') + '</span></div>' +
      '<div class="stackv">' + rows + '</div></div>';
  }

  function queueBlock(v, items, info) {
    const cells = items.map(function (it, i) {
      const active = i >= info.front && i < info.rear;
      const tags = [];
      if (i === info.front) tags.push('front');
      if (i === info.rear) tags.push('rear');
      return '<div class="cellcol">' +
        '<div class="mkrow">' + (tags.length ? '<span class="mk">' + tags.join(',') + '</span>' : '') + '</div>' +
        '<div class="cell qcell' + (active ? ' active' : '') + '">' + esc(cellText(it)) + '</div>' +
        '<div class="idx">' + i + '</div></div>';
    }).join('');
    return '<div class="ds"><div class="ds-title"><b>' + esc(v.name) +
      '</b><span class="ty">队列 · 先进先出</span>' +
      '<span class="ty">front = ' + info.front + ' · rear = ' + info.rear + '</span></div>' +
      '<div class="cells">' + cells + '</div>' +
      '<div class="ds-foot">高亮区间为队列中当前元素：front 出队，rear 入队</div></div>';
  }

  /* ---------- 一维 / 二维数组 ---------- */
  function arrayBlock(v, marks, prevItems) {
    const items = v.view.items || [];
    if (!items.length) {
      return '<div class="ds"><div class="ds-title"><b>' + esc(v.name) +
        '</b><span class="ty">' + esc(v.type) + '</span></div>' +
        '<div class="empty-small">空数组</div></div>';
    }
    if (items[0].k === 'arr') {
      const rows = items.map(function (r) { return r.items || []; });
      const hot = {};
      Object.keys(marks).forEach(function (nm) {
        if (!/^(i|j|k|u|v|start|source|cur|now|row|col)$/.test(nm)) return;
        const val = marks[nm];
        if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val < rows.length) hot[val] = 1;
      });
      let html = '<div class="ds"><div class="ds-title"><b>' + esc(v.name) +
        '</b><span class="ty">' + esc(v.type) + '</span></div><div class="matrix">';
      html += '<div class="mrow"><div class="mcell mhead"></div>' +
        rows[0].map(function (_, j) {
          return '<div class="mcell mhead' + (hot[j] ? ' mhot' : '') + '">' + j + '</div>';
        }).join('') + '</div>';
      rows.forEach(function (row, i) {
        html += '<div class="mrow"><div class="mcell mhead' + (hot[i] ? ' mhot' : '') + '">' + i + '</div>' +
          row.map(function (c, j) {
            const edge = c.k === 'num' && c.v > 0 && c.v < 1000;
            return '<div class="mcell' + (edge ? ' medge' : '') +
              (hot[i] || hot[j] ? ' mhot' : '') + '">' + esc(cellText(c)) + '</div>';
          }).join('') + '</div>';
      });
      return html + '</div><div class="ds-foot">行、列都从 0 开始；橙色 = 当前行/列，浅蓝格 = 有边（数字是权值）</div></div>';
    }

    const marksAt = {};
    Object.keys(marks).forEach(function (nm) {
      if (!/^(top|rear|front|low|high|mid|i|j|k|head|tail|cur|now|pos|p|q|start)$/.test(nm)) return;
      const val = marks[nm];
      if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val < items.length) {
        (marksAt[val] = marksAt[val] || []).push(nm);
      }
    });

    // 数值数组按视图样式渲染：格子 / 柱状 / 热力
    const allNum = items.every(function (it) { return it.k === 'num'; });
    const mode = allNum ? vizPrefs.array : 'cell';
    let ratios = null;
    if (allNum && items.length >= 2 && items.length <= 60) {
      let mn = Infinity;
      let mx = -Infinity;
      items.forEach(function (it) { if (it.v < mn) mn = it.v; if (it.v > mx) mx = it.v; });
      if (mn === mx) mn = Math.min(0, mn);
      ratios = items.map(function (it) {
        return mx === mn ? 0.5 : (it.v - mn) / (mx - mn);
      });
    }

    const markItems = [];
    Object.keys(marksAt).forEach(function (i) {
      marksAt[i].forEach(function (nm) {
        markItems.push(nm + ' → ' + v.name + '[' + i + ']');
      });
    });
    const footText = '下标从 0 开始，共 ' + items.length + ' 个元素' +
      (markItems.length ? ' · ' + markItems.join(' · ') : '') +
      (ratios ? ' · 橙色 = 本步变化' : '');

    if (mode === 'bar' && ratios) {
      const cols = items.map(function (it, i) {
        const txt = cellText(it);
        const changed = prevItems && prevItems[i] && cellText(prevItems[i]) !== txt;
        const names = marksAt[i] || [];
        const h = 14 + Math.round(ratios[i] * 86);
        return '<div class="bcol' + (names.length ? ' pointed' : '') + '">' +
          '<div class="bval">' + esc(txt) + '</div>' +
          '<div class="bwrap"><div class="bar' + (changed ? ' chg' : '') +
          (names.length ? ' pointed' : '') + '" style="height:' + h + 'px"></div></div>' +
          '<div class="bidx">' + i + '</div>' +
          (names.length ? '<div class="bmk">' + names.join(',') + '</div>' : '') + '</div>';
      }).join('');
      return '<div class="ds"><div class="ds-title"><b>' + esc(v.name) +
        '</b><span class="ty">' + esc(v.type) + '</span><span class="ty">柱状视图</span></div>' +
        '<div class="barchart">' + cols + '</div>' +
        '<div class="ds-foot">' + esc(footText) + '</div></div>';
    }

    const cells = items.map(function (it, i) {
      const txt = cellText(it);
      const changed = prevItems && prevItems[i] && cellText(prevItems[i]) !== txt;
      const names = marksAt[i] || [];
      const mk = names.length
        ? '<span class="mk" title="' + esc(names.join(', ') + ' → ' + v.name + '[' + i + ']') + '">' +
          names.join(',') + ' ↓</span>'
        : '';
      const heat = (mode === 'heat' && ratios)
        ? ' style="background:color-mix(in srgb, var(--acc) ' +
          Math.round(8 + ratios[i] * 52) + '%, var(--cell-bg))"'
        : '';
      const bar = (mode === 'cell' && ratios)
        ? '<div class="barcol"><div class="bar' + (changed ? ' chg' : '') +
          (names.length ? ' pointed' : '') + '" style="height:' +
          Math.max(4, Math.round(5 + ratios[i] * 41)) + 'px"></div></div>'
        : '';
      return '<div class="cellcol' + (names.length ? ' pointed' : '') + '">' +
        '<div class="mkrow">' + mk + '</div>' + bar +
        '<div class="cell' + (changed ? ' chg' : '') + (names.length ? ' pointed' : '') + '"' +
        heat + '>' + esc(txt) + '</div>' +
        '<div class="idx">' + i + '</div></div>';
    }).join('');

    return '<div class="ds"><div class="ds-title"><b>' + esc(v.name) +
      '</b><span class="ty">' + esc(v.type) + '</span>' +
      (mode === 'heat' ? '<span class="ty">颜色越深数值越大</span>' :
        (ratios ? '<span class="ty">柱高 = 数值大小</span>' : '')) + '</div>' +
      '<div class="cells">' + cells + '</div>' +
      '<div class="ds-foot">' + esc(footText) + '</div></div>';
  }

  /* ---------- 单步解说 ---------- */
  const NARR_WORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
    'return', 'break', 'continue', 'sizeof', 'typedef', 'struct', 'union', 'enum', 'const',
    'static', 'extern', 'int', 'char', 'float', 'double', 'void', 'long', 'short', 'signed',
    'unsigned', 'bool', 'NULL', 'true', 'false', 'printf', 'puts', 'malloc', 'free', 'cout',
    'endl', 'using', 'namespace', 'std', 'include', 'print', 'len', 'range', 'def', 'class',
    'public', 'private', 'static', 'new', 'null', 'System', 'out']);

  function frameEnv(st) {
    const env = {};
    if (!st) return env;
    if (st.frames.length) {
      st.frames[st.frames.length - 1].vars.forEach(function (v) { env[v.name] = v.view; });
    }
    (st.globals || []).forEach(function (v) { env[v.name] = v.view; });
    if (runCode) {
      const reDef = /^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)[ \t]+(\d+(?:\.\d+)?)[ \t]*$/gm;
      let mm;
      while ((mm = reDef.exec(runCode))) {
        if (!env[mm[1]]) env[mm[1]] = { k: 'num', v: parseFloat(mm[2]) };
      }
    }
    return env;
  }

  function actionOf(code) {
    const t = code.trim();
    if (!t) return { label: '空行', cls: 'mute' };
    if (/^\/[/*]/.test(t)) return { label: '注释', cls: 'mute' };
    if (/^(for|while|do)\b/.test(t)) return { label: '循环', cls: 'loop' };
    if (/^(if|else\s+if)\b/.test(t)) return { label: '判断', cls: 'cond' };
    if (/^else\b/.test(t)) return { label: '分支', cls: 'cond' };
    if (/^(switch|case|default)\b/.test(t)) return { label: '分支', cls: 'cond' };
    if (/^return\b/.test(t)) return { label: '返回', cls: 'ret' };
    if (/\b(printf|puts|__out|cout|print)\b/.test(t)) return { label: '输出', cls: 'out' };
    if (/\b(malloc|calloc|realloc)\b/.test(t) || /\bnew\s+[A-Za-z_]/.test(t)) return { label: '申请内存', cls: 'mem' };
    if (/\b(free)\s*\(/.test(t) || /\bdelete\b/.test(t)) return { label: '释放内存', cls: 'mem' };
    if (/^(break|continue)\b/.test(t)) return { label: '跳转', cls: 'loop' };
    if (/^}\s*$/.test(t)) return { label: '结束块', cls: 'mute' };
    if (/\+\+|--/.test(t) || /(^|[^=!<>+\-*/%])=(?!=)/.test(t)) return { label: '赋值', cls: 'assign' };
    if (/^[A-Za-z_]\w*\s*[.(]/.test(t)) return { label: '调用', cls: 'call' };
    return { label: '执行', cls: 'run' };
  }

  function refsInLine(code, env) {
    const seen = {};
    const out = [];
    const re = /\b([A-Za-z_]\w*)\b/g;
    let m;
    while ((m = re.exec(code)) && out.length < 6) {
      const name = m[1];
      if (seen[name] || NARR_WORDS.has(name)) continue;
      const view = env[name];
      if (!view) continue;
      let txt = null;
      if (view.k === 'num') txt = name + ' = ' + fmtNum(view.v);
      else if (view.k === 'str') txt = name + ' = ' + JSON.stringify(view.v);
      else if (view.k === 'obj') txt = name + ' → #' + view.id;
      if (!txt) continue;
      seen[name] = 1;
      out.push(txt);
    }
    return out;
  }

  /* 把条件里的变量替换成当前值：if (a[j] > a[j+1]) -> if (42 > 18) */
  function subVars(code, env) {
    let out = '';
    let i = 0;
    const n = code.length;
    while (i < n) {
      const c = code[i];
      if (c === '"' || c === "'") {
        const q = c;
        let j = i + 1;
        while (j < n && code[j] !== q) {
          if (code[j] === '\\') j++;
          j++;
        }
        j = Math.min(n, j + 1);
        out += code.slice(i, j);
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_]/.test(code[j])) j++;
        const word = code.slice(i, j);
        let k = j;
        while (k < n && (code[k] === ' ' || code[k] === '\t')) k++;
        const view = env[word];
        if (view && !NARR_WORDS.has(word)) {
          if (code[k] === '[') {
            let depth = 0;
            let end = -1;
            for (let q = k; q < n; q++) {
              if (code[q] === '[') depth++;
              else if (code[q] === ']') {
                depth--;
                if (depth === 0) { end = q; break; }
              }
            }
            if (end > k) {
              let idx = evalWatchExpr(code.slice(k + 1, end), env);
              if (idx && typeof idx === 'object' && idx.k === 'num') idx = idx.v;
              if (typeof idx === 'number' && isFinite(idx) && view.k === 'arr') {
                const cell = (view.items || [])[Math.trunc(idx)];
                if (cell && (cell.k === 'num' || cell.k === 'str')) {
                  out += (cell.k === 'num' ? fmtNum(cell.v) : JSON.stringify(cell.v));
                  i = end + 1;
                  continue;
                }
              }
            }
          } else if (view.k === 'num') {
            out += fmtNum(view.v);
            i = j;
            continue;
          } else if (view.k === 'str') {
            out += JSON.stringify(view.v);
            i = j;
            continue;
          }
        }
        out += word;
        i = j;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  function diffSummary(st, prev) {
    const out = [];
    if (!prev || !prev.frames.length || !st.frames.length) return out;
    const before = {};
    prev.frames[prev.frames.length - 1].vars.forEach(function (v) { before[v.name] = v.view; });
    const after = {};
    st.frames[st.frames.length - 1].vars.forEach(function (v) { after[v.name] = v.view; });
    Object.keys(after).forEach(function (name) {
      if (out.length >= 4) return;
      const a = before[name];
      const b = after[name];
      if (!a || !b) return;
      if (a.k === 'num' && b.k === 'num' && a.v !== b.v) {
        out.push(name + '：' + fmtNum(a.v) + ' → ' + fmtNum(b.v));
      } else if (a.k === 'arr' && b.k === 'arr') {
        const ai = a.items || [];
        const bi = b.items || [];
        if (ai.length !== bi.length) return;
        for (let i = 0; i < bi.length && out.length < 4; i++) {
          const x = cellText(ai[i]);
          const y = cellText(bi[i]);
          if (x !== y) out.push(name + '[' + i + ']：' + x + ' → ' + y);
        }
      }
    });
    return out;
  }

  function plainOf(act, changes) {
    switch (act.label) {
      case '赋值': return changes.length ? '执行赋值：橙色标签是变化前后的值，对应格子会一起高亮。' : '执行一次赋值，值的变化会用橙色标出。';
      case '判断': return '根据括号里的条件决定走哪条分支，注意数据结构随之变化。';
      case '分支': return '进入匹配的 case / 分支继续执行。';
      case '循环': return '重复执行循环体，直到条件不再成立。';
      case '输出': return '把结果打印到下方「输出」区域。';
      case '调用': return '进入函数内部，右侧调用栈会多一层。';
      case '返回': return '当前函数执行完，回到上一层继续。';
      case '申请内存': return '申请一块新内存，右侧内存面板会出现新结点。';
      case '释放内存': return '释放不再使用的内存结点。';
      case '跳转': return '提前结束这一轮或整个循环。';
      default: return '执行这一行代码。';
    }
  }

  function stepNote(st, prev) {
    if (!st) return '';
    const lines = (runCode || '').split('\n');
    const raw = lines[st.line - 1] || '';
    const code = raw.trim();
    if (!code) return '';
    const act = actionOf(code);
    const env = frameEnv(st);
    const isCond = /^(if|else\s+if|while|switch)\b/.test(code);
    let sub = '';
    if (isCond) {
      sub = subVars(code, env);
      if (sub === code) sub = '';
    }
    const refs = sub ? [] : refsInLine(code, env);
    const changes = diffSummary(st, prev);
    const frame = st.frames.length ? st.frames[st.frames.length - 1] : null;
    return '<div class="stepnote">' +
      '<div class="sn-top">' +
        '<span class="sn-act ' + act.cls + '">' + esc(act.label) + '</span>' +
        '<span class="sn-ln">第 ' + st.line + ' 行</span>' +
        (frame ? '<span class="sn-fn">' + esc(frame.fn) + '()</span>' : '') +
      '</div>' +
      '<div class="sn-code">' + esc(code) + '</div>' +
      '<div class="sn-plain">' + esc(plainOf(act, changes)) + '</div>' +
      (sub ? '<div class="sn-sub">代入当前值：<code>' + esc(sub) + '</code></div>' : '') +
      (refs.length ? '<div class="sn-sub">当前：<code>' + esc(refs.join('  ·  ')) + '</code></div>' : '') +
      (changes.length ? '<div class="sn-chg">' + changes.map(function (t) {
        return '<span>' + esc(t) + '</span>';
      }).join('') + '</div>' : '') +
      '</div>';
  }

  /* ---------- 可视化总入口 ---------- */
  function renderViz(st, prev) {
    const structs = (run && run.structs) || {};
    const heap = heapMapOf(st);
    const frame = st.frames[st.frames.length - 1];
    const frameVars = frame ? frame.vars : [];
    const allVars = frameVars.concat(st.globals);
    const blocks = [];
    const addBlock = function (pri, html) { blocks.push({ pri: pri, html: html }); };
    const used = new Set();
    const note = stepNote(st, prev);

    // 当前哪些变量指向哪个堆结点（用于链表/树上标注指针）
    const ptrNames = {};
    allVars.forEach(function (v) {
      if (v.view && v.view.k === 'obj') {
        (ptrNames[v.view.id] = ptrNames[v.view.id] || []).push(v.name);
      }
    });

    // 1. 指针结构：链表 / 二叉树
    allVars.forEach(function (v) {
      if (!v.view || v.view.k !== 'obj') return;
      const h = heap[v.view.id];
      if (!h || !structs[h.struct]) return;
      const ptrFields = structs[h.struct].filter(function (f) { return f.type.ptr > 0; })
        .map(function (f) { return f.name; });
      if (!ptrFields.length) return;
      const hasL = ptrFields.some(isLeftField);
      const hasR = ptrFields.some(isRightField);
      const isTree = hasL && hasR;
      const key = isTree ? ('t:' + v.view.id) : ('l:' + h.struct);
      if (used.has(key)) return;
      used.add(key);
      if (isTree) addBlock(1, treeBlock(v.name, h.struct, v.view.id, heap, structs, ptrNames));
      else addBlock(1, listBlock(v.name, h.struct, buildChain(v.view.id, heap, structs), structs, ptrNames));
    });

    // 2. 普通结构体（没有指针字段）：顺序表等
    allVars.forEach(function (v) {
      if (!v.view || v.view.k !== 'obj') return;
      const h = heap[v.view.id];
      if (!h || !structs[h.struct]) return;
      if (structs[h.struct].some(function (f) { return f.type.ptr > 0; })) return;
      const key = 's:' + v.view.id;
      if (used.has(key)) return;
      used.add(key);
      addBlock(4, structCard(v.name, h, heap));
    });

    const prevFrame = prev ? prev.frames[prev.frames.length - 1] : null;
    const prevVars = {};
    if (prevFrame) prevFrame.vars.forEach(function (v) { prevVars[v.name] = v; });

    const marks = {};
    const visitedSet = new Set();
    frameVars.forEach(function (v) {
      if (v.view.k === 'num' || v.view.k === 'str') marks[v.name] = v.view.v;
      if (v.view.k === 'arr' && /visit|used|book|mark/i.test(v.name)) {
        (v.view.items || []).forEach(function (it, i) {
          if (it.k === 'num' && it.v) visitedSet.add(i);
        });
      }
    });

    // 3. 数组：邻接矩阵图 / 矩阵 / 结构体数组 / 普通数组
    frameVars.forEach(function (v) {
      if (v.view.k !== 'arr') return;
      const items = v.view.items || [];
      const pv = prevVars[v.name];
      const prevItems = pv && pv.view.k === 'arr' ? pv.view.items : null;
      if (items.length && items[0].k === 'arr') {
        if (isGraphMatrix(v)) addBlock(3, graphBlock(v, marks, visitedSet));
        addBlock(4, arrayBlock(v, marks, null));
      } else if (items.length && items[0].k === 'obj') {
        const info = adjInfo(v, heap, structs);
        if (info) {
          const mat = adjacencyMatrixFromList(v, heap, structs, info);
          if (mat) addBlock(3, drawGraph(v.name, mat, marks, visitedSet, '邻接表 · 图'));
          addBlock(4, adjListChains(v, heap, structs, info));
        } else {
          addBlock(4, structArrayBlock(v, heap, prevItems));
        }
      } else {
        const si = stackInfo(v, frameVars, items);
        const qi = si ? null : queueInfo(v, frameVars, items);
        if (si) addBlock(2, stackBlock(v, items, si));
        else if (qi) addBlock(2, queueBlock(v, items, qi));
        else addBlock(2, arrayBlock(v, marks, prevItems));
      }
    });

    blocks.sort(function (a, b) { return a.pri - b.pri; });
    let structHTML = blocks.map(function (b) { return b.html; }).join('');
    let hint = frame ? ('当前函数：' + frame.fn + '()') : '';
    if (!structHTML) {
      if (lastVizHTML && cur >= lastVizStep) {
        structHTML = lastVizHTML;
        hint = lastVizHint + ' · 本步无数据结构';
      }
    } else {
      lastVizHTML = structHTML;
      lastVizHint = hint;
      lastVizStep = cur;
    }

    if (!structHTML && !note) {
      const emptyHTML = (cur === 0 && lintIssues.length ? lintCard(lintIssues) : '') +
        '<div class="empty"><div class="eicon">❀</div>' +
        '<h2 style="font-size:18px">这一步还没有数据结构</h2>' +
        '<p>拖动进度条到变量出现的步骤，或直接用「生成动画」从头播放。</p></div>';
      if (emptyHTML !== lastVizApplied) { viz.innerHTML = emptyHTML; lastVizApplied = emptyHTML; }
      vizHint.textContent = '';
      return;
    }
    const vizHTML = (cur === 0 && lintIssues.length ? lintCard(lintIssues) : '') +
      note + (structHTML ? vizLegend() + structHTML :
      '<div class="empty-small" style="padding:18px">这一步没有可视化数据结构</div>');
    if (vizHTML !== lastVizApplied) { viz.innerHTML = vizHTML; lastVizApplied = vizHTML; }
    vizHint.textContent = hint;
  }

  /* ---------- 变量 / 调用栈 ---------- */
  function renderVars(st, prev) {
    const frame = st.frames[st.frames.length - 1];
    if (!frame) {
      varsCountEl.textContent = '0';
      if (lastVarsHTML !== '') { varsEl.innerHTML = ''; lastVarsHTML = ''; }
      return;
    }
    varsCountEl.textContent = String(frame.vars.length);
    const prevFrame = prev ? prev.frames[prev.frames.length - 1] : null;
    const prevMap = {};
    if (prevFrame) prevFrame.vars.forEach(function (v) { prevMap[v.name] = v; });

    function chip(v, changed) {
      const view = v.view || {};
      let val;
      if (view.k === 'num') val = fmtNum(view.v);
      else if (view.k === 'str') val = view.v === '' ? "''" : "'" + view.v + "'";
      else if (view.k === 'null') val = 'NULL';
      else if (view.k === 'obj') val = '→ #' + view.id;
      else if (view.k === 'ref') val = view.label;
      else if (view.k === 'arr') val = '[' + (view.items || []).length + ']';
      else val = '·';
      return '<div class="vrow' + (changed ? ' chg' : '') + '">' +
        '<span class="vn">' + esc(v.name) + '</span>' +
        '<span class="vt">' + esc(v.type) + '</span>' +
        '<span class="vv">' + esc(val) + '</span></div>';
    }

    const rows = [];
    frame.vars.forEach(function (v) {
      const pv = prevMap[v.name];
      const changed = pv && !sameValue(pv.view, v.view);
      rows.push(chip(v, changed));
    });
    if (st.globals.length) {
      rows.push('<div class="vsep">全局变量</div>');
      st.globals.forEach(function (v) { rows.push(chip(v, false)); });
    }
    const html = rows.join('') || '<div class="empty-small">当前帧没有变量</div>';
    if (html !== lastVarsHTML) { varsEl.innerHTML = html; lastVarsHTML = html; }
  }

  function renderCallStack(st) {
    const frames = st.frames;
    stackCountEl.textContent = String(frames.length);
    if (!frames.length) {
      if (lastStackHTML !== '') { stackEl.innerHTML = ''; lastStackHTML = ''; }
      return;
    }
    const html = frames.slice().reverse().map(function (f, i) {
      const scal = f.vars.filter(function (v) { return v.view.k === 'num'; })
        .slice(0, 6)
        .map(function (v) { return v.name + '=' + fmtNum(v.view.v); }).join('  ');
      return '<div class="frame' + (i === 0 ? ' top' : '') + '">' +
        '<div class="fh"><span>' + esc(f.fn) + '()</span><span class="fline">行 ' + f.line + '</span></div>' +
        (scal ? '<div class="fv">' + esc(scal) + '</div>' : '') + '</div>';
    }).join('');
    if (html !== lastStackHTML) { stackEl.innerHTML = html; lastStackHTML = html; }
  }

  /* ---------- 主渲染 ---------- */
  function updateSeekFill() {
    const max = parseInt(seek.max, 10) || 0;
    const val = parseInt(seek.value, 10) || 0;
    const pct = max > 0 ? (val / max) * 100 : 0;
    seek.style.background = 'linear-gradient(90deg, var(--acc) 0%, var(--acc) ' + pct +
      '%, var(--track) ' + pct + '%, var(--track) 100%)';
  }

  function render() {
    if (!run || !run.steps.length) return;
    if (cur < 0) cur = 0;
    if (cur > run.steps.length - 1) cur = run.steps.length - 1;
    const st = run.steps[cur];
    const prev = cur > 0 ? run.steps[cur - 1] : null;

    const fnName = st.frames.length ? st.frames[st.frames.length - 1].fn : '';
    const infoHTML = '第 <b>' + (cur + 1) + '</b> / ' + run.steps.length + ' 步 · 行 ' + st.line +
      (fnName ? ' · ' + esc(fnName) + '()' : '');
    if (stepInfo.innerHTML !== infoHTML) stepInfo.innerHTML = infoHTML;
    seek.max = String(run.steps.length - 1);
    seek.value = String(cur);
    seek.disabled = false;
    updateSeekFill();

    setActiveLine(st.line);
    renderViz(st, prev);
    renderVars(st, prev);
    renderCallStack(st);
    renderWatch(st);
    renderMemory(st);

    let text = '';
    if (st.outCount < outCacheCount) { outCacheText = ''; outCacheCount = 0; }
    for (let i = outCacheCount; i < st.outCount && i < run.outputs.length; i++) outCacheText += run.outputs[i].text;
    outCacheCount = Math.min(st.outCount, run.outputs.length);
    text = outCacheText;
    if (text !== lastOutText) {
      outEl.textContent = text;
      lastOutText = text;
      outEl.scrollTop = outEl.scrollHeight;
    }
  }

  /* ---------- 播放控制 ---------- */
  function stop() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    btnPlay.textContent = '▶ 播放';
    btnPlay.classList.remove('on');
    document.body.classList.remove('is-playing');
  }
  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (!playing) return;
      if (!run || cur >= run.steps.length - 1) { stop(); return; }
      if (document.hidden) { cur++; return; }   // 后台标签页只推进、不渲染
      const next = run.steps[cur + 1];
      const curSt = run.steps[cur];
      if (next && breakpoints.has(next.line) && next.line !== curSt.line) {
        cur++;
        render();
        stop();
        showMsg('命中断点 · 第 ' + next.line + ' 行', 'warn');
        return;
      }
      cur++;
      renderSoon();
    }, Math.max(70, 880 / speed));
  }
  function play() {
    if (!run || !run.steps.length) return;
    if (cur >= run.steps.length - 1) { cur = 0; render(); }
    playing = true;
    btnPlay.textContent = '⏸ 暂停';
    btnPlay.classList.add('on');
    document.body.classList.add('is-playing');
    schedule();
  }
  function togglePlay() {
    if (playing) stop();
    else play();
  }
  function stepBy(d) {
    if (!run || !run.steps.length) return;
    stop();
    cur += d;
    render();
  }

  function stepOut() {
    if (!run || !run.steps.length) return;
    stop();
    const depth = run.steps[cur].frames.length;
    for (let i = cur + 1; i < run.steps.length; i++) {
      if (run.steps[i].frames.length < depth) {
        cur = i;
        render();
        showMsg('已跳出当前函数', 'ok');
        return;
      }
    }
    cur = run.steps.length - 1;
    render();
    showMsg('已到程序结尾', 'ok');
  }

  function runToCursor() {
    const line = getCursorLine();
    if (!line) return;
    const after = function () {
      if (!run) return;
      let idx = run.steps.length - 1;
      for (let i = 0; i < run.steps.length; i++) {
        if (run.steps[i].line >= line) { idx = i; break; }
      }
      stop();
      setEditing(false);
      cur = idx;
      render();
      showMsg('已运行到第 ' + run.steps[cur].line + ' 行', 'ok');
    };
    if (!run || editor.value !== runCode) generate(false, true, after);
    else after();
  }

  /* ---------- 编辑即失效：避免代码和动画对不上 ---------- */
  function invalidateRun() {
    if (!run && !lastVizHTML) return;
    stop();
    run = null;
    cur = 0;
    runCode = '';
    lastVizHTML = '';
    lastVizHint = '';
    lastVizStep = -1;
    lastVizApplied = '';
    lastVarsHTML = '';
    lastStackHTML = '';
    lastOutText = '';
    lastMemHTML = '';
    outCacheText = '';
    outCacheCount = 0;
    seek.max = '0';
    seek.value = '0';
    seek.disabled = true;
    updateSeekFill();
    stepInfo.textContent = '第 0 / 0 步';
    varsEl.innerHTML = '';
    stackEl.innerHTML = '';
    varsCountEl.textContent = '0';
    stackCountEl.textContent = '0';
    outEl.textContent = '';
    vizHint.textContent = '';
    viz.innerHTML = heroEmpty();
    renderWatch(null);
    renderMemory(null);
  }

  /* ---------- 首屏引导 ---------- */
  function openWelcome() {
    document.body.classList.add('welcome-open');
  }
  function closeWelcome() {
    document.body.classList.remove('welcome-open');
  }

  /* ---------- 生成动画 ---------- */
  const LANG_BADGE = { c: 'C', cpp: 'C++', python: 'PY', java: 'JAVA' };

  function currentLang() {
    const v = langSel ? langSel.value : 'auto';
    if (v !== 'auto') return v;
    return window.LangTranslate ? window.LangTranslate.detect(editor.value) : 'c';
  }
  function syncLangBadge() {
    if (!langBadge) return;
    langBadge.textContent = LANG_BADGE[currentLang()] || 'C';
  }
  if (langSel) {
    try {
      const saved = localStorage.getItem('cv-lang');
      if (saved) langSel.value = saved;
    } catch (e) {}
    langSel.addEventListener('change', function () {
      try { localStorage.setItem('cv-lang', langSel.value); } catch (e) {}
      syncLangBadge();
      const lang = langSel.value;
      if (!currentGroup || lang === 'auto') return;
      const isExampleCode = currentGroup.variants.some(function (v) { return v.ex.code === editor.value; });
      if (!isExampleCode) {
        resetLangAuto('当前代码已修改，已切回「自动识别」，避免按错误语言执行');
        return;
      }
      const v = variantFor(currentGroup, lang);
      if (!v) {
        resetLangAuto('这个示例暂时没有 ' + (LANG_NAME[lang] || lang) + ' 版本，已切回「自动识别」');
        return;
      }
      if (v.ex.code !== editor.value) loadVariant(currentGroup, v);
    });
  }

  if (stdinEl) {
    try {
      const savedIn = localStorage.getItem('cv-stdin');
      if (savedIn) stdinEl.value = savedIn;
    } catch (e) {}
    updateInputCount();
    let inputTimer = null;
    stdinEl.addEventListener('input', function () {
      updateInputCount();
      try { localStorage.setItem('cv-stdin', stdinEl.value); } catch (e) {}
      if (!run || !editor.value.trim()) return;
      clearTimeout(inputTimer);
      inputTimer = setTimeout(function () {
        if (run) generate(false, true);
      }, 520);
    });
    stdinEl.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = stdinEl.selectionStart;
        stdinEl.value = stdinEl.value.slice(0, s) + '    ' + stdinEl.value.slice(stdinEl.selectionEnd);
        stdinEl.selectionStart = stdinEl.selectionEnd = s + 4;
      }
    });
  }

  function mapLine(map, n) {
    if (!map) return n;
    const v = map[n - 1];
    return v || n;
  }

  function remapResult(res, map) {
    if (!map) return res;
    (res.steps || []).forEach(function (s) {
      s.line = mapLine(map, s.line);
      (s.frames || []).forEach(function (f) { f.line = mapLine(map, f.line); });
    });
    if (res.errorLine) res.errorLine = mapLine(map, res.errorLine);
    if (res.error) {
      res.error = res.error
        .replace(/（停在第 (\d+) 行）/g, function (_, n) {
          return '（停在第 ' + mapLine(map, parseInt(n, 10)) + ' 行）';
        })
        .replace(/（第 (\d+) 行）/g, function (_, n) {
          return '（第 ' + mapLine(map, parseInt(n, 10)) + ' 行）';
        });
    }
    return res;
  }

  function failParse(message, line) {
    run = null;
    runCode = editor.value;
    setEditing(true);
    setErrorLine(line || null);
    viz.innerHTML = errorCard('解析失败', message, line || null);
    if (lintIssues.length) viz.insertAdjacentHTML('afterbegin', lintCard(lintIssues));
    varsEl.innerHTML = '';
    stackEl.innerHTML = '';
    outEl.textContent = '';
    stepInfo.textContent = '第 0 / 0 步';
    seek.max = '0';
    seek.value = '0';
    seek.disabled = true;
    updateSeekFill();
    showMsg('解析失败' + (line ? ' · 第 ' + line + ' 行' : ''), 'err');
    if (line) setTimeout(function () { gotoLine(line); }, 30);
  }

  function needsInputCalls(code) {
    return /\bscanf\s*\(|\bgets\s*\(|\bfgets\s*\(|\bcin\s*>>|\binput\s*\(|\bScanner\b/.test(String(code || ''));
  }
  function expandInputPanel() {
    if (!inputPanel) return;
    inputPanel.classList.add('needs');
    if (inputPanel.classList.contains('collapsed')) {
      inputPanel.classList.remove('collapsed');
      inputPanel.style.flex = '';
      inputPanel.style.height = '';
      saveCollapse();
    }
  }
  function updateInputCount() {
    if (!inputCountEl) return;
    const raw = stdinEl ? stdinEl.value.trim() : '';
    const n = raw ? raw.split(/\s+/).length : 0;
    inputCountEl.textContent = String(n);
    if (inputPanel && raw) inputPanel.classList.remove('needs');
  }

  function generate(autoPlay, keepEditing, onDone) {
    stop();
    const code = editor.value;
    if (!code.trim()) {
      invalidateRun();
      openWelcome();
      showMsg('先粘贴一段代码，或点「先看一个示例」', 'ok');
      if (onDone) onDone();
      return;
    }
    closeWelcome();
    const seq = ++genSeq;
    const runBtn = $('#btnRun');
    const oldLabel = runBtn ? runBtn.textContent : '';
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = '生成中…'; }
    showMsg('正在生成动画…', 'ok');
    // 先让浏览器画一帧“生成中”，再做同步解析/执行，避免点了没反应
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (seq !== genSeq) { if (onDone) onDone(); return; }
        try { buildRun(autoPlay, keepEditing); }
        finally {
          if (seq === genSeq && runBtn) { runBtn.disabled = false; runBtn.textContent = oldLabel; }
          if (onDone) onDone();
        }
      });
    });
  }

  function buildRun(autoPlay, keepEditing) {
    const code = editor.value;
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    lastVizHTML = '';
    lastVizHint = '';
    lastVizStep = -1;
    lastVizApplied = '';
    lastVarsHTML = '';
    lastStackHTML = '';
    lastOutText = '';
    lastMemHTML = '';
    outCacheText = '';
    outCacheCount = 0;
    lintIssues = window.CParseLint ? window.CParseLint(code) : [];
    syncLangBadge();
    buildCodeview(code);
    if (!keepEditing) setEditing(false);
    const needInput = needsInputCalls(code);
    if (needInput && stdinEl && !stdinEl.value.trim()) expandInputPanel();
    else if (inputPanel) inputPanel.classList.remove('needs');

    const lang = currentLang();
    let engineCode = code;
    let lineMap = null;
    if (window.LangTranslate && (lang === 'python' || lang === 'java')) {
      try {
        const tr = window.LangTranslate.translate(code, lang);
        engineCode = tr.code;
        lineMap = tr.map;
      } catch (ex) {
        failParse(ex && ex.message ? ex.message : String(ex), (ex && ex.cLine) || null);
        return;
      }
    }

    let res;
    try {
      res = window.CParseRun(engineCode, { input: stdinEl ? stdinEl.value : '' });
    } catch (e) {
      if (lineMap && e && e.cLine) e.cLine = mapLine(lineMap, e.cLine);
      failParse(e && e.message ? e.message : String(e), (e && e.cLine) || null);
      return;
    }
    remapResult(res, lineMap);

    if (!res.steps.length) {
      run = null;
      runCode = code;
      setEditing(true);
      setErrorLine(res.errorLine || null);
      viz.innerHTML = errorCard('运行出错', res.error || '代码没有产生可动画的步骤', res.errorLine || null);
      lastVizApplied = viz.innerHTML;
      if (lintIssues.length) viz.insertAdjacentHTML('afterbegin', lintCard(lintIssues));
      varsEl.innerHTML = '';
      stackEl.innerHTML = '';
      lastVarsHTML = '';
      lastStackHTML = '';
      outEl.textContent = '';
      lastOutText = '';
      seek.max = '0';
      seek.value = '0';
      seek.disabled = true;
      stepInfo.textContent = '第 0 / 0 步';
      showMsg('没有可播放的步骤', 'err');
      return;
    }

    run = res;
    runCode = code;
    errorLine = res.errorLine || null;
    cur = autoPlay ? firstDataStep(res) : 0;
    seek.max = String(res.steps.length - 1);
    seek.value = '0';
    render();

    const ms = Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - t0);
    if (res.error) {
      setErrorLine(res.errorLine || null);
      viz.insertAdjacentHTML('afterbegin', errorCard('运行出错', res.error, res.errorLine || null));
      showMsg('运行到第 ' + (res.errorLine || '?') + ' 行出错', 'err');
    } else if (res.inputMissing) {
      setErrorLine(null);
      expandInputPanel();
      showMsg('输入不足：程序读取的数据比「输入」面板多，请补齐后重新生成', 'warn');
    } else if (needInput && stdinEl && !stdinEl.value.trim()) {
      expandInputPanel();
      showMsg('共 ' + res.steps.length + ' 步 · 代码会读取输入，可在「输入」面板填数据', 'warn');
    } else {
      showMsg('共 ' + res.steps.length + ' 步 · ' + ms + ' ms', 'ok');
    }

    if (autoPlay) {
      setTimeout(function () {
        if (run === res && !playing) play();
      }, 420);
    }
  }

  /* ---------- 主题切换 ---------- */
  const THEME_ORDER = ['paper', 'dark'];
  const THEMES = {
    paper: { dark: false, icon: '🌙', title: '盛开的杏花（浅色）' },
    dark: { dark: true, icon: '☀️', title: '星月夜（深色）' }
  };

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'paper';
  }

  function applyTheme(theme, save) {
    if (!THEMES[theme]) theme = 'paper';
    const cfg = THEMES[theme];
    if (cfg.dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    const btn = $('#btnTheme');
    if (btn) {
      btn.textContent = cfg.icon;
      btn.title = '当前：' + cfg.title + '，点击切换下一个主题';
    }
    if (save) {
      try { localStorage.setItem('cv-theme', theme); } catch (e) {}
    }
    syncViewMenu();
  }

  /* ---------- 自定义代码 ---------- */
  function loadCustom() {
    closeWelcome();
    stop();
    currentGroup = null;
    const isExample = window.EXAMPLES.some(function (ex) { return ex.code === editor.value; });
    const own = editor.value.trim() !== '' && editor.value !== CUSTOM_TEMPLATE && !isExample;
    if (!own) {
      editor.value = CUSTOM_TEMPLATE;
      refreshGutter();
      refreshHighlight();
    }
    presetSel.value = 'custom';
    setEditing(true);
    editor.focus();
    if (!own) {
      editor.select();
      setTimeout(function () {
        editor.scrollTop = 0;
        syncScroll();
        updateCursorPos();
      }, 0);
    }
    setFileName('main.c');
    showMsg('把左边的代码换成你自己的，再点「生成动画」', 'ok');
  }

  /* 预览时跳到第一次出现数据结构的那一步，避免首屏空白 */
  function firstDataStep(res) {
    for (let i = 0; i < res.steps.length; i++) {
      const st = res.steps[i];
      const fr = st.frames[st.frames.length - 1];
      if (!fr) continue;
      const hasData = fr.vars.some(function (v) {
        return v.view.k === 'arr' || v.view.k === 'obj';
      });
      if (hasData) return i;
    }
    return 0;
  }

  /* ---------- 清空代码（两次点击确认） ---------- */
  let clearTimer = null;

  function resetClearBtn() {
    const b = $('#btnClear');
    b.textContent = '清空';
    b.classList.remove('armed');
  }

  function doClear() {
    stop();
    currentGroup = null;
    editor.value = '';
    savedScroll = 0;
    errorLine = null;
    runCode = '';
    lastVizHTML = '';
    lastVizHint = '';
    lastVizStep = -1;
    lastVizApplied = '';
    lastVarsHTML = '';
    lastStackHTML = '';
    lastOutText = '';
    lastMemHTML = '';
    outCacheText = '';
    outCacheCount = 0;
    lintIssues = [];
    breakpoints.clear();
    setFileName('main.c');
    refreshGutter();
    refreshHighlight();
    setEditing(true);
    editor.scrollTop = 0;
    syncScroll();
    updateCursorPos();
    presetSel.value = 'custom';
    run = null;
    cur = 0;
    seek.max = '0';
    seek.value = '0';
    seek.disabled = true;
    updateSeekFill();
    stepInfo.textContent = '第 0 / 0 步';
    varsEl.innerHTML = '';
    stackEl.innerHTML = '';
    varsCountEl.textContent = '0';
    stackCountEl.textContent = '0';
    outEl.textContent = '';
    vizHint.textContent = '';
    viz.innerHTML = heroEmpty('已清空。粘贴自己的 C 代码，或导入 .c / .h 文件，再点「生成动画」。');
    showMsg('已清空代码', 'ok');
    editor.focus();
  }

  function setFileName(name) {
    fileNameEl.textContent = name || 'main.c';
    fileNameEl.title = name || 'main.c';
  }

  /* ---------- 导入 .c / .h 文件 ---------- */
  function importFiles(files) {
    const list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    const ok = list.filter(function (f) { return /\.(c|cc|cpp|h|hpp|txt)$/i.test(f.name); });
    if (!ok.length) {
      showMsg('只支持 .c / .cpp / .h / .hpp / .txt；.slnx 是解决方案文件，里面没有代码', 'err');
      return;
    }
    closeWelcome();
    const readers = ok.map(function (f) {
      return new Promise(function (resolve) {
        const r = new FileReader();
        r.onload = function () { resolve({ name: f.name, text: String(r.result || '') }); };
        r.onerror = function () { resolve({ name: f.name, text: '' }); };
        r.readAsText(f);
      });
    });
    Promise.all(readers).then(function (arr) {
      arr.sort(function (a, b) {
        const ha = /\.(h|hpp)$/i.test(a.name) ? 0 : 1;
        const hb = /\.(h|hpp)$/i.test(b.name) ? 0 : 1;
        return ha - hb;
      });
      const parts = arr.map(function (f) {
        const body = f.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
        return '/* ===== ' + f.name + ' ===== */\n' + body;
      });
      editor.value = parts.join('\n\n');
      currentGroup = null;
      presetSel.value = 'custom';
      setFileName(arr.map(function (f) { return f.name; }).join(' + '));
      setEditing(true);
      refreshGutter();
      refreshHighlight();
      updateCursorPos();
      editor.scrollTop = 0;
      syncScroll();
      generate(false, true, function () {
        if (run && !run.error) {
          showMsg('已导入 ' + arr.length + ' 个文件 · 共 ' + run.steps.length + ' 步', 'ok');
        }
      });
    });
  }

  /* ---------- 事件绑定 ---------- */
  editor.addEventListener('input', function () {
    refreshGutter();
    refreshHighlight();
    updateCursorPos();
    if (langSel && langSel.value === 'auto') syncLangBadge();
    if (!editor.value.trim()) {
      if (run) invalidateRun();
    } else if (run && editor.value !== runCode) {
      stop();
      vizHint.textContent = '代码已修改 · 待重新生成';
      showMsg('代码已修改，点「生成动画」更新动画', 'warn');
    }
  });
  editor.addEventListener('click', updateCursorPos);
  editor.addEventListener('keyup', updateCursorPos);
  editor.addEventListener('select', updateCursorPos);
  editor.addEventListener('scroll', syncScroll);
  // 多行粘贴：归一化换行并立刻刷新高亮 / 行号
  editor.addEventListener('paste', function () {
    setTimeout(function () {
      if (editor.value.indexOf('\r') >= 0) {
        const pos = editor.selectionStart;
        editor.value = editor.value.replace(/\r\n?/g, '\n');
        editor.setSelectionRange(pos, pos);
      }
      refreshGutter();
      refreshHighlight();
      syncScroll();
    }, 0);
  });
  editor.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart;
      const en = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = s + 4;
      refreshGutter();
      refreshHighlight();
    }
  });

  // 单击行号 / 播放视图的行号：设置或取消断点
  gutter.addEventListener('click', function (e) {
    const row = e.target.closest('.gl');
    if (!row) return;
    toggleBreakpoint(parseInt(row.getAttribute('data-line'), 10));
  });
  codeview.addEventListener('click', function (e) {
    if (!e.target.classList.contains('ln')) return;
    const row = e.target.closest('.cl');
    if (!row) return;
    toggleBreakpoint(parseInt(row.getAttribute('data-line'), 10));
  });

  // 报错卡片 / 空状态里的按钮
  viz.addEventListener('click', function (e) {
    if (e.target.closest('[data-empty="import"]') || e.target.closest('[data-import]')) {
      fileInput.click();
      return;
    }
    const btn = e.target.closest('[data-goto]');
    if (!btn) return;
    const v = btn.getAttribute('data-goto');
    setEditing(true);
    if (v !== 'edit') {
      const line = parseInt(v, 10);
      setTimeout(function () { gotoLine(line); }, 20);
    }
  });

  // 导入文件：按钮 + 拖拽
  $('#btnImport').addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    importFiles(fileInput.files);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    codewrap.addEventListener(ev, function (e) {
      e.preventDefault();
      codewrap.classList.add('dragover');
    });
  });
  ['dragleave', 'dragend'].forEach(function (ev) {
    codewrap.addEventListener(ev, function () { codewrap.classList.remove('dragover'); });
  });
  codewrap.addEventListener('drop', function (e) {
    e.preventDefault();
    codewrap.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files) importFiles(e.dataTransfer.files);
  });

  $('#btnRun').addEventListener('click', function () { generate(true); });
  $('#btnRunTo').addEventListener('click', runToCursor);
  $('#btnStepOut').addEventListener('click', stepOut);
  $('#btnCustom').addEventListener('click', loadCustom);
  $('#btnClear').addEventListener('click', function () {
    const b = $('#btnClear');
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.textContent = '再点一次';
      clearTimer = setTimeout(resetClearBtn, 2600);
      return;
    }
    clearTimeout(clearTimer);
    resetClearBtn();
    doClear();
  });
  /* ---------- 玻璃透明度调节 ---------- */
  const glassRange = $('#glassRange');
  function applyGlass(v, save) {
    const k = Math.max(0.2, Math.min(1.4, v / 100));
    document.documentElement.style.setProperty('--glass-k', String(k));
    if (glassRange) glassRange.value = String(v);
    if (save) { try { localStorage.setItem('cv-glass', String(v)); } catch (e) {} }
  }
  if (glassRange) {
    let gv = 100;
    try {
      gv = parseInt(localStorage.getItem('cv-glass') || '100', 10);
      if (!isFinite(gv)) gv = 100;
    } catch (e) { gv = 100; }
    applyGlass(gv, false);
    glassRange.addEventListener('input', function () {
      applyGlass(parseInt(glassRange.value, 10) || 100, true);
    });
  }

  $('#btnTheme').addEventListener('click', function () {
    const i = THEME_ORDER.indexOf(currentTheme());
    const next = THEME_ORDER[(i + 1) % THEME_ORDER.length];
    applyTheme(next, true);
    if (run) render();
  });

  /* ---------- 可视化样式菜单 ---------- */
  function syncViewMenu() {
    const menu = $('#viewMenu');
    if (!menu) return;
    menu.querySelectorAll('.vm-opts').forEach(function (group) {
      const key = group.getAttribute('data-key');
      const val = key === 'theme' ? currentTheme() : vizPrefs[key];
      group.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-val') === val);
      });
    });
  }

  const btnView = $('#btnView');
  const viewMenu = $('#viewMenu');
  if (btnView && viewMenu) {
    btnView.addEventListener('click', function (e) {
      e.stopPropagation();
      viewMenu.hidden = !viewMenu.hidden;
      syncViewMenu();
    });
    document.addEventListener('click', function (e) {
      if (!viewMenu.hidden && !viewMenu.contains(e.target) && e.target !== btnView) viewMenu.hidden = true;
    });
    viewMenu.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-val]');
      if (!b) return;
      const group = b.closest('.vm-opts');
      if (!group) return;
      const key = group.getAttribute('data-key');
      const val = b.getAttribute('data-val');
      if (key === 'theme') {
        applyTheme(val, true);
      } else {
        vizPrefs[key] = val;
        saveVizPrefs();
      }
      syncViewMenu();
      if (run) render();
    });
  }
  $('#btnEdit').addEventListener('click', function () {
    stop();
    setEditing(true);
  });
  btnPlay.addEventListener('click', togglePlay);
  $('#btnPrev').addEventListener('click', function () { stepBy(-1); });
  $('#btnNext').addEventListener('click', function () { stepBy(1); });
  $('#btnFirst').addEventListener('click', function () {
    stop();
    cur = 0;
    render();
  });
  $('#btnLast').addEventListener('click', function () {
    if (!run) return;
    stop();
    cur = run.steps.length - 1;
    render();
  });

  seek.addEventListener('input', function () {
    stop();
    cur = parseInt(seek.value, 10) || 0;
    updateSeekFill();
    renderSoon();
  });

  $('#speed').addEventListener('change', function (e) {
    speed = parseFloat(e.target.value) || 1;
    if (playing) schedule();
  });

  document.addEventListener('keydown', function (e) {
    const inEditor = e.target === editor;
    if (e.key === 'F5') {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (e.key === 'F10' || (e.key === 'F11' && !e.shiftKey)) {
      e.preventDefault();
      stepBy(1);
      return;
    }
    if (e.key === 'F11' && e.shiftKey) {
      e.preventDefault();
      stepOut();
      return;
    }
    if (inEditor) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepBy(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepBy(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      stop();
      cur = 0;
      render();
    } else if (e.key === 'End') {
      if (!run) return;
      e.preventDefault();
      stop();
      cur = run.steps.length - 1;
      render();
    }
  });

  /* ---------- 初始化 ---------- */
  const presetSel = $('#preset');

  // 首屏引导的四个入口
  $('#wPaste').addEventListener('click', function () {
    closeWelcome();
    setEditing(true);
    editor.focus();
    if (!editor.value.trim()) viz.innerHTML = heroEmpty();
    showMsg('把代码粘贴到左边，然后点「生成动画」', 'ok');
  });
  $('#wImport').addEventListener('click', function () {
    closeWelcome();
    fileInput.click();
  });
  $('#wDemo').addEventListener('click', function () {
    closeWelcome();
    loadExample(0);
  });
  $('#wSkip').addEventListener('click', closeWelcome);
  $('#btnHelp').addEventListener('click', openWelcome);
  // 点击遮罩空白处也能关闭引导
  $('#welcome').addEventListener('click', function (e) {
    if (e.target === this) closeWelcome();
  });

  // 按钮点击涟漪
  document.addEventListener('click', function (e) {
    const b = e.target.closest('.btn, .pbtn');
    if (!b || b.disabled) return;
    const rect = b.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const r = document.createElement('span');
    r.className = 'ripple';
    r.style.width = size + 'px';
    r.style.height = size + 'px';
    r.style.left = (e.clientX - rect.left - size / 2) + 'px';
    r.style.top = (e.clientY - rect.top - size / 2) + 'px';
    b.appendChild(r);
    setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 620);
  });

  const customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = '✎ 自定义代码（粘贴我的代码）';
  presetSel.appendChild(customOpt);

  // 示例按类别分组
  const CAT_ORDER = ['线性表', '排序', '查找', '栈与队列', '树', '图', '递归', '基础'];
  const EXAMPLE_CATS = ['排序', '排序', '排序', '查找', '线性表', '栈与队列', '递归', '树',
    '线性表', '线性表', '图', '图', '线性表', '图', '图', '排序', '排序', '排序'];
  const LANG_NAME = { c: 'C', cpp: 'C++', python: 'Python', java: 'Java' };
  function resetLangAuto(msg) {
    if (langSel) langSel.value = 'auto';
    try { localStorage.setItem('cv-lang', 'auto'); } catch (e) {}
    syncLangBadge();
    if (msg) showMsg(msg, 'ok');
  }
  function stripExampleNo(name) {
    return String(name).replace(/^[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]\s*/, '');
  }
  // 同一 algo 的多语言版本合并为一个选项
  const groups = [];
  const groupOfIndex = {};
  window.EXAMPLES.forEach(function (ex, i) {
    const key = ex.algo ? ('a:' + ex.algo) : ('i:' + i);
    let g = groups.filter(function (x) { return x.key === key; })[0];
    if (!g) {
      g = { key: key, cat: ex.cat || EXAMPLE_CATS[i] || '其他', variants: [] };
      groups.push(g);
    }
    g.variants.push({
      ex: ex,
      i: i,
      lang: ex.lang || (window.LangTranslate ? window.LangTranslate.detect(ex.code) : 'c')
    });
    groupOfIndex[i] = g;
  });

  const groupByValue = {};
  groups.forEach(function (g, gi) {
    g.value = 'g' + gi;
    groupByValue[g.value] = g;
  });

  const byCat = {};
  groups.forEach(function (g) {
    (byCat[g.cat] = byCat[g.cat] || []).push(g);
  });
  CAT_ORDER.concat(Object.keys(byCat).filter(function (c) { return CAT_ORDER.indexOf(c) < 0; }))
    .forEach(function (cat) {
      if (!byCat[cat] || !byCat[cat].length) return;
      const og = document.createElement('optgroup');
      og.label = cat;
      byCat[cat].forEach(function (g) {
        const o = document.createElement('option');
        o.value = g.value;
        const first = g.variants[0].ex;
        let label = first.name;
        if (g.variants.length > 1) {
          label = stripExampleNo(first.name);
          const langs = [];
          g.variants.forEach(function (v) {
            const nm = LANG_NAME[v.lang] || 'C';
            if (langs.indexOf(nm) < 0) langs.push(nm);
          });
          label += '（' + langs.join(' / ') + '）';
        }
        o.textContent = label;
        g.option = o;
        og.appendChild(o);
      });
      presetSel.appendChild(og);
    });

  let currentGroup = null;

  function variantFor(g, lang) {
    if (!g) return null;
    if (lang && lang !== 'auto') {
      return g.variants.filter(function (v) { return v.lang === lang; })[0] || null;
    }
    // 自动识别：优先保留当前已打开的同一版本，否则默认 C
    const cur = g.variants.filter(function (v) { return v.ex.code === editor.value; })[0];
    if (cur) return cur;
    return g.variants.filter(function (v) { return v.lang === 'c'; })[0] || g.variants[0];
  }

  function loadVariant(g, variant) {
    stop();
    if (!g || !variant) return;
    currentGroup = g;
    const ex = variant.ex;
    presetSel.value = g.value;
    editor.value = ex.code;
    const l = variant.lang;
    setFileName(l === 'python' ? 'main.py' : l === 'java' ? 'Main.java' : l === 'cpp' ? 'main.cpp' : 'main.c');
    syncLangBadge();
    savedScroll = 0;
    setEditing(true);
    refreshGutter();
    refreshHighlight();
    updateCursorPos();
    editor.scrollTop = 0;
    syncScroll();
    if (stdinEl && ex.input != null) {
      stdinEl.value = ex.input;
      updateInputCount();
      try { localStorage.setItem('cv-stdin', stdinEl.value); } catch (e) {}
    }
    generate(true);
  }

  function loadExample(i) {
    const g = groupOfIndex[i];
    if (!g) return;
    loadVariant(g, variantFor(g, langSel ? langSel.value : 'auto'));
  }

  presetSel.addEventListener('change', function () {
    stop();
    if (presetSel.value === 'custom') {
      currentGroup = null;
      loadCustom();
      return;
    }
    const g = groupByValue[presetSel.value];
    if (!g) return;
    const lang = langSel ? langSel.value : 'auto';
    const variant = variantFor(g, lang);
    if (variant) {
      loadVariant(g, variant);
      return;
    }
    const fallback = variantFor(g, 'auto');
    const msg = '这个示例暂时没有 ' + (LANG_NAME[lang] || lang) +
      ' 版本，已切回「自动识别」并打开 ' + (LANG_NAME[fallback.lang] || 'C') + ' 版本';
    resetLangAuto('');
    loadVariant(g, fallback);
    showMsg(msg, 'ok');
  });

  // 主题：沿用上次选择
  /* ---------- 监视表达式 ---------- */
  let watchExprs = [];
  try {
    watchExprs = (JSON.parse(localStorage.getItem('cvz-watch') || '[]') || [])
      .filter(function (x) { return typeof x === 'string'; }).slice(0, 8);
  } catch (e) { watchExprs = []; }

  function saveWatchExprs() {
    try { localStorage.setItem('cvz-watch', JSON.stringify(watchExprs)); } catch (e) {}
  }

  function evalWatchExpr(expr, env) {
    const src = String(expr).replace(/->/g, '.');
    const toks = [];
    const re = /\s*(\d+\.?\d*|[A-Za-z_]\w*|[+\-*/%()[\].])/g;
    let m;
    while ((m = re.exec(src))) toks.push(m[1]);
    if (!toks.length) return undefined;
    let p = 0;

    function eat(t) { if (toks[p] === t) { p++; return true; } return false; }
    function toNum(v) {
      if (typeof v === 'number') return v;
      if (v && v.k === 'num') return v.v;
      return null;
    }
    function needNum(v) { const n = toNum(v); if (n === null) throw 0; return n; }
    function parseExpr() {
      let v = parseTerm();
      for (;;) {
        if (eat('+')) v = needNum(v) + needNum(parseTerm());
        else if (eat('-')) v = needNum(v) - needNum(parseTerm());
        else break;
      }
      return v;
    }
    function parseTerm() {
      let v = parseUnary();
      for (;;) {
        if (eat('*')) v = needNum(v) * needNum(parseUnary());
        else if (eat('/')) v = needNum(v) / needNum(parseUnary());
        else if (eat('%')) v = needNum(v) % needNum(parseUnary());
        else break;
      }
      return v;
    }
    function parseUnary() {
      if (eat('-')) return -needNum(parseUnary());
      if (eat('+')) return needNum(parseUnary());
      return parsePrimary();
    }
    function parsePrimary() {
      const t = toks[p++];
      if (t === '(') {
        const v = parseExpr();
        if (!eat(')')) throw 0;
        return v;
      }
      if (/^\d/.test(t)) return parseFloat(t);
      if (/^[A-Za-z_]/.test(t)) {
        let view = env[t];
        for (;;) {
          if (eat('[')) {
            const idx = needNum(parseExpr());
            if (!eat(']')) throw 0;
            if (!view || view.k !== 'arr') return undefined;
            view = view.items[Math.trunc(idx)];
          } else if (eat('.')) {
            const f = toks[p++];
            if (!view || view.k !== 'obj' || !view.fields || !view.fields[f]) return undefined;
            view = view.fields[f];
          } else break;
        }
        return view;
      }
      throw 0;
    }

    try {
      const v = parseExpr();
      if (p < toks.length) return undefined;
      return v;
    } catch (e) { return undefined; }
  }

  function watchVal(v) {
    if (v === undefined) return null;
    if (typeof v === 'number') {
      if (!isFinite(v)) return String(v);
      return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
    }
    if (typeof v === 'string') return JSON.stringify(v);
    if (!v) return null;
    if (v.k === 'num') return fmtNum(v.v);
    if (v.k === 'str') return JSON.stringify(v.v);
    if (v.k === 'null') return 'NULL';
    if (v.k === 'arr') return '[' + v.items.length + ']';
    if (v.k === 'obj') return '# ' + v.id;
    return '·';
  }

  function renderWatch(st) {
    const env = {};
    if (st) {
      if (st.frames.length) {
        st.frames[st.frames.length - 1].vars.forEach(function (v) { env[v.name] = v.view; });
      }
      (st.globals || []).forEach(function (v) { env[v.name] = v.view; });
    }
    // 让 #define N 8 这类常量也能在监视里直接用：N-1
    if (runCode) {
      const reDef = /^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)[ \t]+(\d+(?:\.\d+)?)[ \t]*$/gm;
      let mm;
      while ((mm = reDef.exec(runCode))) {
        if (!env[mm[1]]) env[mm[1]] = { k: 'num', v: parseFloat(mm[2]) };
      }
    }
    watchCountEl.textContent = String(watchExprs.length);
    if (!watchExprs.length) {
      watchListEl.innerHTML = '<div class="empty-small">添加表达式，如 a[i]、n-1、sum</div>';
      return;
    }
    watchListEl.innerHTML = watchExprs.map(function (ex, i) {
      const val = st ? watchVal(evalWatchExpr(ex, env)) : null;
      return '<div class="watchrow"><span class="we">' + esc(ex) + '</span>' +
        '<span class="wv' + (val === null ? ' bad' : '') + '">' +
        esc(val === null ? '—' : val) + '</span>' +
        '<button class="wx" data-wi="' + i + '" title="删除">×</button></div>';
    }).join('');
  }

  function addWatchExpr() {
    const ex = watchInput.value.trim();
    if (!ex) return;
    if (watchExprs.length >= 8) { showMsg('最多 8 个监视表达式', 'warn'); return; }
    if (watchExprs.indexOf(ex) >= 0) { watchInput.value = ''; return; }
    watchExprs.push(ex);
    saveWatchExprs();
    watchInput.value = '';
    const p = $('#watchPanel');
    if (p && p.classList.contains('collapsed')) { p.classList.remove('collapsed'); p.style.flex = ''; p.style.height = ''; saveCollapse(); }
    renderWatch(run ? run.steps[cur] : null);
  }

  btnAddWatch.addEventListener('click', addWatchExpr);
  watchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addWatchExpr(); }
  });
  watchListEl.addEventListener('click', function (e) {
    const b = e.target.closest('[data-wi]');
    if (!b) return;
    watchExprs.splice(parseInt(b.getAttribute('data-wi'), 10), 1);
    saveWatchExprs();
    renderWatch(run ? run.steps[cur] : null);
  });

  /* ---------- 内存监视（可自行添加变量 / 表达式） ---------- */
  let memExprs = [];
  try {
    memExprs = (JSON.parse(localStorage.getItem('cvz-mem') || '[]') || [])
      .filter(function (x) { return typeof x === 'string'; }).slice(0, 8);
  } catch (e) { memExprs = []; }

  function saveMemExprs() {
    try { localStorage.setItem('cvz-mem', JSON.stringify(memExprs)); } catch (e) {}
  }

  function renderMemChips() {
    if (!memExprsEl) return;
    memExprsEl.innerHTML = memExprs.map(function (ex, i) {
      return '<span class="memchip"><span class="we">' + esc(ex) + '</span>' +
        '<button data-mi="' + i + '" title="不再监视">×</button></span>';
    }).join('');
  }

  function structFieldsOf(typeText) {
    const m = String(typeText || '').match(/([A-Za-z_]\w*)\s*\*?\s*$/);
    if (!m) return null;
    const defs = (run && run.structs) || {};
    return defs[m[1]] || null;
  }
  function fieldTypeText(f) {
    let t = f.type.base + (f.type.ptr ? '*'.repeat(f.type.ptr) : '');
    if (f.type.dims && f.type.dims.length) t += '[]';
    return t;
  }
  function memTypeOf(expr, vars) {
    const s = String(expr).replace(/->/g, '.').trim();
    const m = s.match(/^([A-Za-z_]\w*)(.*)$/);
    if (!m) return '';
    const v = vars.filter(function (x) { return x.name === m[1]; })[0];
    if (!v) return '';
    let t = v.type || '';
    let rest = m[2];
    while (rest) {
      if (rest.charAt(0) === '[') {
        t = t.replace(/\[[^\]]*\]\s*$/, '');
        rest = rest.replace(/^\[[^\]]*\]/, '');
      } else if (rest.charAt(0) === '.') {
        const fm = rest.slice(1).match(/^([A-Za-z_]\w*)/);
        if (!fm) break;
        const fields = structFieldsOf(t);
        if (!fields) { t = ''; break; }
        const f = fields.filter(function (x) { return x.name === fm[1]; })[0];
        if (!f) { t = ''; break; }
        t = fieldTypeText(f);
        rest = rest.slice(1 + fm[1].length);
      } else break;
    }
    return t;
  }
  function memSizeOf(typeText) {
    if (/\bchar\b/.test(typeText || '')) return 1;
    if (/\bdouble\b/.test(typeText || '')) return 8;
    return 4;
  }
  function memBytes(n, size) {
    const bytes = [];
    if (size === 1) {
      bytes.push((Math.trunc(n) & 255).toString(16).toUpperCase().padStart(2, '0'));
      return bytes;
    }
    const u = Math.trunc(n) >>> 0;
    for (let b = 0; b < size; b++) bytes.push(((u >>> (8 * b)) & 255).toString(16).toUpperCase().padStart(2, '0'));
    return bytes;
  }
  function memLinesHTML(addr, values, size) {
    const per = size === 1 ? 16 : 4;
    const lines = [];
    for (let i = 0; i < values.length; i += per) {
      const bytes = [];
      for (let j = i; j < Math.min(i + per, values.length); j++) {
        Array.prototype.push.apply(bytes, memBytes(values[j], size));
      }
      lines.push('<div class="memline"><span class="maddr">0x' +
        (addr + i * size).toString(16).toUpperCase() + '</span>' +
        '<span class="mbytes">' + bytes.join(' ') + '</span></div>');
    }
    return lines.join('');
  }
  function memNoteRow(label, text) {
    return '<div class="memrow"><div class="memhead"><b>' + esc(label) + '</b></div>' +
      '<div class="empty-small" style="padding:4px 0">' + esc(text) + '</div></div>';
  }
  // 生成一个内存块，返回显示的元素个数
  function pushMemBlock(out, label, view, typeText, addr, heap, structs) {
    if (!view) return 0;
    if (view.k === 'num') {
      const size = memSizeOf(typeText);
      out.push('<div class="memrow"><div class="memhead"><b>' + esc(label) + '</b>' +
        '<span>' + esc(typeText || 'int') + '</span><span>' + size + ' 字节</span></div>' +
        memLinesHTML(addr, [view.v], size) + '</div>');
      return 1;
    }
    if (view.k === 'str') {
      const codes = String(view.v).split('').map(function (c) { return c.charCodeAt(0); });
      out.push('<div class="memrow"><div class="memhead"><b>' + esc(label) + '</b>' +
        '<span>' + esc(typeText || 'char[]') + '</span><span>' + (codes.length + 1) + ' 字节</span></div>' +
        memLinesHTML(addr, codes.concat([0]), 1) + '</div>');
      return codes.length + 1;
    }
    if (view.k === 'arr') {
      const items = view.items || [];
      if (!items.length) return 0;
      const allNum = items.every(function (it) { return it.k === 'num'; });
      const allChar = items.every(function (it) { return it.k === 'str'; }) && /\bchar\b/.test(typeText || '');
      if (!allNum && !allChar) return 0;
      const size = allChar ? 1 : memSizeOf(typeText);
      const limit = Math.min(items.length, allChar ? 32 : 16);
      const vals = items.slice(0, limit).map(function (it) {
        if (it.k === 'num') return it.v;
        const s = String(it.v == null ? '' : it.v);
        return s ? s.charCodeAt(0) : 0;
      });
      out.push('<div class="memrow"><div class="memhead"><b>' + esc(label) + '</b>' +
        '<span>' + esc(typeText || 'int') + '</span><span>' + items.length + ' 个</span></div>' +
        memLinesHTML(addr, vals, size) + '</div>');
      return limit;
    }
    if (view.k === 'obj') {
      const h = heap[view.id];
      const fields = structs[view.struct] || [];
      let shown = 0;
      let off = 0;
      fields.forEach(function (f) {
        if (!h || !h.fields || !(f.name in h.fields)) return;
        const fv = h.fields[f.name];
        const ft = fieldTypeText(f);
        const sub = [];
        const n = pushMemBlock(sub, label + '.' + f.name, fv, ft, addr + off * 0x10, heap, structs);
        if (!n) return;
        shown += n;
        off++;
        out.push(sub.join(''));
      });
      if (!shown) out.push(memNoteRow(label, '这个结构体没有可显示的数值字段'));
      return shown;
    }
    if (view.k === 'null') { out.push(memNoteRow(label, 'NULL，没有可显示的内存')); return 0; }
    if (view.k === 'ref') { out.push(memNoteRow(label, '是地址，不是变量本身')); return 0; }
    out.push(memNoteRow(label, '这个值没有可显示的内存（只支持数值 / 字符 / 数组 / 结构体）'));
    return 0;
  }

  function addMemExpr() {
    if (!memInput) return;
    const ex = memInput.value.trim();
    if (!ex) return;
    if (memExprs.length >= 8) { showMsg('最多 8 个内存监视变量', 'warn'); return; }
    if (memExprs.indexOf(ex) < 0) {
      memExprs.push(ex);
      saveMemExprs();
    }
    memInput.value = '';
    const p = $('#memPanel');
    if (p && p.classList.contains('collapsed')) {
      p.classList.remove('collapsed');
      p.style.flex = '';
      p.style.height = '';
      saveCollapse();
    }
    lastMemHTML = '';
    renderMemory(run ? run.steps[cur] : null);
  }

  if (btnAddMem) btnAddMem.addEventListener('click', addMemExpr);
  if (memInput) {
    memInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addMemExpr(); }
    });
  }
  if (memExprsEl) {
    memExprsEl.addEventListener('click', function (e) {
      const b = e.target.closest('[data-mi]');
      if (!b) return;
      memExprs.splice(parseInt(b.getAttribute('data-mi'), 10), 1);
      saveMemExprs();
      lastMemHTML = '';
      renderMemory(run ? run.steps[cur] : null);
    });
  }

  /* ---------- 内存视图（模拟地址） ---------- */
  function renderMemory(st) {
    renderMemChips();
    if (!st) {
      memCountEl.textContent = '0';
      const emptyMem = memExprs.length
        ? '<div class="empty-small">生成动画后显示内存</div>'
        : '<div class="empty-small">生成动画后显示数组内存；也可以在上面添加变量名</div>';
      if (lastMemHTML !== emptyMem) { memListEl.innerHTML = emptyMem; lastMemHTML = emptyMem; }
      return;
    }
    const memPanelEl = $('#memPanel');
    if (memPanelEl && memPanelEl.classList.contains('collapsed')) return;
    const frame = st.frames.length ? st.frames[st.frames.length - 1] : null;
    const frameVars = frame ? frame.vars : [];
    const allVars = frameVars.concat(st.globals || []);
    const heap = heapMapOf(st);
    const env = {};
    allVars.forEach(function (v) {
      let view = v.view;
      // 结构体变量补上字段视图，才能监视 s.data 这类成员
      if (view && view.k === 'obj' && heap[view.id] && heap[view.id].fields) {
        view = { k: 'obj', id: view.id, struct: view.struct, fields: heap[view.id].fields };
      }
      env[v.name] = view;
    });
    const structs = (run && run.structs) || st.structs || {};
    const out = [];
    let total = 0;
    const base = 0x7ffc0000;
    if (memExprs.length) {
      memExprs.forEach(function (ex, i) {
        const view = evalWatchExpr(ex, env);
        const t = memTypeOf(ex, allVars);
        if (view === undefined) {
          out.push(memNoteRow(ex, '当前帧没有这个变量或表达式'));
          return;
        }
        total += pushMemBlock(out, ex, view, t, base + i * 0x100, heap, structs);
      });
    } else {
      allVars.forEach(function (v, vi) {
        const view = v.view;
        if (!view || view.k !== 'arr' || !view.items || !view.items.length) return;
        if (!view.items.every(function (it) { return it.k === 'num'; })) return;
        total += pushMemBlock(out, v.name, view, v.type, base + vi * 0x100, heap, structs);
      });
    }
    memCountEl.textContent = String(total);
    const memHTML = out.join('') || '<div class="empty-small">当前帧没有可显示的数组内存</div>';
    if (memHTML !== lastMemHTML) { memListEl.innerHTML = memHTML; lastMemHTML = memHTML; }
  }

  /* ---------- 第三列：折叠 / 拖拽调高 ---------- */
  const sidePanels = Array.prototype.slice.call(document.querySelectorAll('.side > .panel'));
  function saveCollapse() {
    try {
      localStorage.setItem('cvz-collapse',
        JSON.stringify(sidePanels.map(function (p) { return !!p.classList.contains('collapsed'); })));
    } catch (e) {}
  }
  function saveHeights() {
    try {
      localStorage.setItem('cvz-heights',
        JSON.stringify(sidePanels.map(function (p) {
          return p.classList.contains('collapsed') ? 0 : Math.round(p.getBoundingClientRect().height);
        })));
    } catch (e) {}
  }
  function restoreHeights() {
    let hs = null;
    try { hs = JSON.parse(localStorage.getItem('cvz-heights') || 'null'); } catch (e) {}
    if (!Array.isArray(hs) || hs.length !== sidePanels.length) return;
    sidePanels.forEach(function (p, i) {
      if (!p.classList.contains('collapsed') && hs[i] > 60) {
        p.style.flex = '0 0 ' + hs[i] + 'px';
        p.style.height = hs[i] + 'px';
      }
    });
  }
  function startRowDrag(ev, a, b) {
    ev.preventDefault();
    // 相邻两块都折叠时没有可调空间
    if (a.classList.contains('collapsed') && b.classList.contains('collapsed')) return;
    document.body.classList.add('resizing');
    // 先把所有展开的面板冻结为当前高度
    sidePanels.forEach(function (p) {
      if (!p.classList.contains('collapsed')) {
        const h = Math.round(p.getBoundingClientRect().height);
        p.style.flex = '0 0 ' + h + 'px';
        p.style.height = h + 'px';
      }
    });
    const MIN = 46;
    let aCol = a.classList.contains('collapsed');
    let bCol = b.classList.contains('collapsed');
    let ha = aCol ? MIN : Math.round(a.getBoundingClientRect().height);
    let hb = bCol ? MIN : Math.round(b.getBoundingClientRect().height);
    let total = ha + hb;
    function wake(p) {
      p.classList.remove('collapsed');
      p.style.flex = '0 0 ' + MIN + 'px';
      p.style.height = MIN + 'px';
      if (p.id === 'memPanel') renderMemory(run ? run.steps[cur] : null);
      if (p.id === 'watchPanel') renderWatch(run ? run.steps[cur] : null);
    }
    const y0 = ev.clientY;
    let na = ha, nb = hb, dirty = false, rafId = 0;
    const write = function () {
      if (!dirty) return;
      dirty = false;
      a.style.flex = '0 0 ' + na + 'px';
      a.style.height = na + 'px';
      b.style.flex = '0 0 ' + nb + 'px';
      b.style.height = nb + 'px';
    };
    const schedule = function () {
      if (rafId) return;
      rafId = requestAnimationFrame(function () { rafId = 0; write(); });
    };
    const move = function (e) {
      const d = e.clientY - y0;
      // 向下拖到折叠的上方块 → 先展开它
      if (aCol && d > 0) { wake(a); aCol = false; ha = MIN; total = ha + hb; }
      // 向上拖到折叠的下方块 → 先展开它
      if (bCol && d < 0) { wake(b); bCol = false; hb = MIN; total = ha + hb; }
      if (!aCol && !bCol) {
        // 两块都展开：在上方块高与下方块高之间此消彼长
        const x = Math.max(MIN, Math.min(total - MIN, ha + d));
        na = x; nb = total - x;
      } else if (aCol && !bCol) {
        // 上方保持折叠，只调下方（向上拖 = 下方变高）
        nb = Math.max(MIN, Math.min(1600, hb - d));
        na = MIN;
      } else if (!aCol && bCol) {
        // 下方保持折叠，只调上方
        na = Math.max(MIN, Math.min(1600, ha + d));
        nb = MIN;
      }
      dirty = true;
      schedule();
    };
    const up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      write();
      document.body.classList.remove('resizing');
      saveHeights();
      saveCollapse();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }
  function buildRowSplitters() {
    Array.prototype.slice.call(document.querySelectorAll('.side > .split-y'))
      .forEach(function (n) { n.remove(); });
    for (let i = 0; i < sidePanels.length - 1; i++) {
      const sp = document.createElement('div');
      sp.className = 'split-y';
      sp.title = '拖动调整上方/下方高度';
      sidePanels[i].after(sp);
      (function (a, b) {
        sp.addEventListener('pointerdown', function (e) { startRowDrag(e, a, b); });
      })(sidePanels[i], sidePanels[i + 1]);
    }
    // 最后一块（输出）底部再加一条把手：向下拖直接放大输出面板
    const last = sidePanels[sidePanels.length - 1];
    if (last) {
      const sp = document.createElement('div');
      sp.className = 'split-y split-end';
      sp.title = '向下拖动放大输出面板';
      last.after(sp);
      sp.addEventListener('pointerdown', function (e) { startBottomDrag(e, last); });
    }
  }
  function startBottomDrag(ev, panel) {
    ev.preventDefault();
    document.body.classList.add('resizing');
    sidePanels.forEach(function (p) {
      if (!p.classList.contains('collapsed')) {
        const h = Math.round(p.getBoundingClientRect().height);
        p.style.flex = '0 0 ' + h + 'px';
        p.style.height = h + 'px';
      }
    });
    const h0 = Math.round(panel.getBoundingClientRect().height);
    const y0 = ev.clientY;
    let nh = h0, dirty = false, rafId = 0;
    const write = function () {
      if (!dirty) return;
      dirty = false;
      panel.style.flex = '0 0 ' + nh + 'px';
      panel.style.height = nh + 'px';
    };
    const schedule = function () {
      if (rafId) return;
      rafId = requestAnimationFrame(function () { rafId = 0; write(); });
    };
    const move = function (e) {
      const d = e.clientY - y0;
      nh = Math.max(46, Math.min(1600, h0 + d));
      dirty = true;
      schedule();
    };
    const up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      write();
      document.body.classList.remove('resizing');
      saveHeights();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }
  let savedCollapse = [];
  try { savedCollapse = JSON.parse(localStorage.getItem('cvz-collapse') || '[]') || []; } catch (e) {}
  sidePanels.forEach(function (p, i) {
    if (savedCollapse[i]) p.classList.add('collapsed');
    const head = p.querySelector('.phead');
    if (!head) return;
    head.addEventListener('click', function (e) {
      if (e.target.closest('button,input,select,a')) return;
      if (p.classList.contains('collapsed')) {
        p.style.flex = '';
        p.style.height = '';
      }
      p.classList.toggle('collapsed');
      if (!p.classList.contains('collapsed')) {
        // 折叠期间跳过的面板，展开时补一次渲染
        if (p.id === 'memPanel') renderMemory(run ? run.steps[cur] : null);
        if (p.id === 'watchPanel') renderWatch(run ? run.steps[cur] : null);
      }
      saveCollapse();
    });
  });
  buildRowSplitters();
  restoreHeights();

  // 第三列：窄屏横向溢出时，滚轮转横向。
  // 溢出状态缓存起来，避免每个 wheel 事件都读取 scrollWidth 触发重排。
  let sideCanX = false;
  function updateSideOverflow() {
    sideCanX = sideEl.scrollWidth > sideEl.clientWidth + 2;
  }
  let overflowRaf = 0;
  function updateSideOverflowSoon() {
    if (overflowRaf) return;
    overflowRaf = requestAnimationFrame(function () {
      overflowRaf = 0;
      updateSideOverflow();
    });
  }
  updateSideOverflow();
  if (window.ResizeObserver) {
    const sideRO = new ResizeObserver(updateSideOverflowSoon);
    sideRO.observe(sideEl);
    Array.prototype.forEach.call(sideEl.children, function (c) { sideRO.observe(c); });
  }
  sideEl.addEventListener('wheel', function (e) {
    if (!sideCanX || e.deltaX) return;
    sideEl.scrollLeft += e.deltaY;
  }, { passive: true });

  /* ---------- 列宽拖拽 ---------- */
  function startColDrag(ev, which) {
    if (window.innerWidth <= 1180) return;
    ev.preventDefault();
    document.body.classList.add('resizing-col');
    const handle = which === 'code' ? colA : colB;
    handle.classList.add('dragging');
    const x0 = ev.clientX;
    const cw = codePanelEl.getBoundingClientRect().width;
    const sw = sideEl.getBoundingClientRect().width;
    const totalW = layoutEl.getBoundingClientRect().width;
    let nc = cw, ns = sw, dirty = false, rafId = 0;
    const write = function () {
      if (!dirty) return;
      dirty = false;
      layoutEl.style.gridTemplateColumns =
        Math.round(nc) + 'px minmax(360px,1fr) ' + Math.round(ns) + 'px';
      placeColSplitters();
    };
    const schedule = function () {
      if (rafId) return;
      rafId = requestAnimationFrame(function () { rafId = 0; write(); });
    };
    const move = function (e) {
      const d = e.clientX - x0;
      if (which === 'code') nc = Math.max(320, Math.min(totalW - sw - 440, cw + d));
      else ns = Math.max(240, Math.min(totalW - cw - 440, sw - d));
      dirty = true;
      schedule();
    };
    const up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      dirty = true;
      write();
      document.body.classList.remove('resizing-col');
      handle.classList.remove('dragging');
      try {
        localStorage.setItem('cvz-cols', JSON.stringify({
          code: Math.round(codePanelEl.getBoundingClientRect().width),
          side: Math.round(sideEl.getBoundingClientRect().width)
        }));
      } catch (e) {}
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }
  const colA = document.createElement('div');
  colA.className = 'colsplit';
  colA.title = '拖动调整代码区宽度';
  const colB = document.createElement('div');
  colB.className = 'colsplit';
  colB.title = '拖动调整右侧栏宽度';
  layoutEl.appendChild(colA);
  layoutEl.appendChild(colB);
  colA.addEventListener('pointerdown', function (e) { startColDrag(e, 'code'); });
  colB.addEventListener('pointerdown', function (e) { startColDrag(e, 'side'); });
  // 双击把手恢复默认列宽
  function resetCols() {
    layoutEl.style.gridTemplateColumns = '';
    try { localStorage.removeItem('cvz-cols'); } catch (e) {}
    placeColSplitters();
  }
  colA.addEventListener('dblclick', resetCols);
  colB.addEventListener('dblclick', resetCols);

  function placeColSplitters() {
    const wide = window.innerWidth > 1180;
    colA.style.display = wide ? '' : 'none';
    colB.style.display = wide ? '' : 'none';
    if (!wide) return;
    const lr = layoutEl.getBoundingClientRect();
    const cr = codePanelEl.getBoundingClientRect();
    const sr = sideEl.getBoundingClientRect();
    colA.style.left = Math.round(cr.right - lr.left - 5) + 'px';
    colB.style.left = Math.round(sr.left - lr.left - 5) + 'px';
  }

  function restoreCols() {
    if (window.innerWidth <= 1180) { layoutEl.style.gridTemplateColumns = ''; return; }
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('cvz-cols') || 'null'); } catch (e) {}
    if (!saved || !saved.code || !saved.side) return;
    const total = layoutEl.getBoundingClientRect().width || (window.innerWidth - 28);
    const maxCode = total - saved.side - 440;
    const maxSide = total - saved.code - 440;
    if (maxCode < 320 || maxSide < 240) return;
    layoutEl.style.gridTemplateColumns =
      Math.max(320, Math.min(saved.code, maxCode)) + 'px minmax(360px,1fr) ' +
      Math.max(240, Math.min(saved.side, maxSide)) + 'px';
  }
  restoreCols();
  placeColSplitters();
  let rsTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(rsTimer);
    rsTimer = setTimeout(function () {
      if (window.innerWidth <= 1180) layoutEl.style.gridTemplateColumns = '';
      else if (!layoutEl.style.gridTemplateColumns) restoreCols();
      placeColSplitters();
    }, 150);
  });

  applyTheme(currentTheme(), false);

  // 首屏：不放代码，先告诉用户怎么用
  presetSel.value = 'custom';
  editor.value = '';
  setFileName('main.c');
  refreshGutter();
  refreshHighlight();
  savedScroll = 0;
  setEditing(true);
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  syncScroll();
  updateCursorPos();
  seek.disabled = true;
  updateSeekFill();
  viz.innerHTML = heroEmpty();
  renderWatch(null);
  renderMemory(null);
  syncLangBadge();
  showMsg('准备就绪 · 粘贴代码后点「生成动画」', 'ok');
  openWelcome();
})();
