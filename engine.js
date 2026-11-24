/* 代码转动画 · 迷你 C 解释器（教学子集）
   支持：基本类型 / 一二维数组 / 结构体 / 指针 / malloc / 函数与递归 /
        if、for、while、do-while、break、continue、switch / printf /
        scanf、gets、fgets、getchar、cin（输入来自界面「输入」面板）
   输出：逐语句快照（变量、堆对象、调用栈、控制台输出）
*/
(function (global) {
  'use strict';

  const OPS = ['<<=', '>>=', '->', '++', '--', '+=', '-=', '*=', '/=', '%=',
    '==', '!=', '<=', '>=', '&&', '||', '<<', '>>'];
  const SINGLE = '+-*/%<>=!&|^~?:;,.()[]{}';
  const TYPE_WORDS = new Set(['int', 'char', 'float', 'double', 'void', 'long',
    'short', 'signed', 'unsigned', 'bool', '_Bool', 'size_t', 'ssize_t',
    'clock_t', 'time_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
    'int8_t', 'int16_t', 'int32_t', 'int64_t', 'intptr_t', 'uintptr_t']);
  const MAX_STEPS = 3500;
  const MAX_DEPTH = 100;

  function err(msg, line) {
    const e = new Error(msg);
    e.cLine = line;
    throw e;
  }

  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
    return 0;
  }

  function toCStr(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      let s = '';
      for (let i = 0; i < v.length; i++) {
        if (v[i] == null || v[i] === '') continue;
        s += String(v[i]);
      }
      return s;
    }
    return String(v);
  }

  function writeCStr(dst, s) {
    if (Array.isArray(dst)) {
      for (let i = 0; i < dst.length; i++) dst[i] = i < s.length ? s[i] : '';
    }
  }

  /* ================= 预处理 ================= */
  function preprocess(src) {
    const macros = Object.create(null);
    const kept = [];
    const lines = String(src).split(/\r?\n/);

    function splitShifts(body) {
      const parts = [];
      let cur = '';
      let q = null;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (q) {
          cur += ch;
          if (ch === '\\') { cur += body[++i] || ''; }
          else if (ch === q) q = null;
          continue;
        }
        if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
        if (ch === '<' && body[i + 1] === '<') { parts.push(cur); cur = ''; i++; continue; }
        cur += ch;
      }
      parts.push(cur);
      return parts;
    }

    function transformCoutLine(raw) {
      let rest = raw;
      let prefix = '';
      for (;;) {
        const m = rest.match(/\b(?:std::)?cout\s*<</);
        if (!m) break;
        const start = m.index + m[0].length;
        let q = null;
        let end = -1;
        for (let i = start; i < rest.length; i++) {
          const c = rest[i];
          if (q) {
            if (c === '\\') i++;
            else if (c === q) q = null;
            continue;
          }
          if (c === '"' || c === "'") { q = c; continue; }
          if (c === ';') { end = i; break; }
        }
        if (end < 0) break;
        const outs = [];
        splitShifts(rest.slice(start, end)).forEach(function (p) {
          const t = p.trim();
          if (!t) return;
          if (t === 'endl' || t === '"\\n"' || t === "'\\n'") outs.push('__endl();');
          else outs.push('__out(' + t + ');');
        });
        prefix += rest.slice(0, m.index) + '{' + outs.join('') + '}';
        rest = rest.slice(end + 1);
      }
      return prefix + rest;
    }

    function splitChain(body, sep) {
      const parts = [];
      let cur = '';
      let q = null;
      let depth = 0;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (q) {
          cur += ch;
          if (ch === '\\') { cur += body[++i] || ''; }
          else if (ch === q) q = null;
          continue;
        }
        if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth--;
        if (depth === 0 && body.startsWith(sep, i)) {
          parts.push(cur);
          cur = '';
          i += sep.length - 1;
          continue;
        }
        cur += ch;
      }
      parts.push(cur);
      return parts.map(function (x) { return x.trim(); });
    }

    // cin >> a >> b;  ->  __in(&a); __in(&b);
    // while (cin >> x) -> while (__in(&x))
    function transformCinLine(raw) {
      let out = '';
      let rest = raw;
      for (;;) {
        const m = rest.match(/\b(?:std::)?cin\s*>>/);
        if (!m) { out += rest; break; }
        const before = rest.slice(0, m.index);
        const start = m.index + m[0].length;
        let depth = 0;
        let q = null;
        let end = -1;
        let term = '';
        for (let i = start; i < rest.length; i++) {
          const c = rest[i];
          if (q) {
            if (c === '\\') i++;
            else if (c === q) q = null;
            continue;
          }
          if (c === '"' || c === "'") { q = c; continue; }
          if (c === '(' || c === '[') depth++;
          else if (c === ')' || c === ']') {
            if (depth === 0) { end = i; term = ')'; break; }
            depth--;
          } else if (c === ';' && depth === 0) { end = i; term = ';'; break; }
        }
        if (end < 0) { out += before + rest.slice(start); break; }
        const vars = splitChain(rest.slice(start, end), '>>').filter(function (v) { return v; });
        const simple = term === ')' && vars.length === 1 && !/&&|\|\||,/.test(vars[0]);
        if (term === ')' && !simple) {
          out += before + 'cin >>' + rest.slice(start, end + 1);
          rest = rest.slice(end + 1);
          continue;
        }
        const exprs = vars.map(function (v) { return '__in(&' + v + ')'; });
        if (term === ';') {
          out += before + exprs.join(';') + ';' + rest.slice(end + 1);
          break;
        }
        out += before + exprs.join(' && ') + ')';
        rest = rest.slice(end + 1);
      }
      return out;
    }

    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li];
      if (/^\s*using\s+namespace\s+std\s*;/.test(raw)) { kept.push(''); continue; }
      if (/getline\s*\(\s*cin\s*,/.test(raw) && !/^\s*#/.test(raw)) {
        kept.push(raw.replace(/getline\s*\(\s*cin\s*,\s*([A-Za-z_]\w*)\s*\)/g, 'gets($1)'));
        continue;
      }
      if (raw.indexOf('cin') >= 0 && /cin\s*>>/.test(raw) && !/^\s*#/.test(raw)) {
        kept.push(transformCinLine(raw));
        continue;
      }
      if (raw.indexOf('cout') >= 0 && /cout\s*<</.test(raw) && !/^\s*#/.test(raw)) {
        kept.push(transformCoutLine(raw));
        continue;
      }
      const m = raw.match(/^\s*#\s*define\s+([A-Za-z_]\w*)\s*(.*)$/);
      if (m) {
        macros[m[1]] = m[2].replace(/\/\/.*$/, '').trim() || '0';
        kept.push('');                 // 保留空行，报错行号才和编辑器一致
        continue;
      }
      if (/^\s*#/.test(raw)) { kept.push(''); continue; }
      kept.push(raw);
    }
    let text = kept.join('\n');
    Object.keys(macros).forEach(function (k) {
      text = text.replace(new RegExp('\\b' + k + '\\b', 'g'), macros[k]);
    });
    return text;
  }

  /* ================= 词法 ================= */
  function tokenize(text) {
    const toks = [];
    let i = 0;
    let line = 1;
    const ESC = { n: '\n', t: '\t', '0': '\0', r: '\r', '\\': '\\', '"': '"', "'": "'" };
    while (i < text.length) {
      const c = text[i];
      if (c === '\n') { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
          if (text[i] === '\n') line++;
          i++;
        }
        i += 2;
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
        let s = '';
        while (i < text.length && /[0-9a-fA-FxX.]/.test(text[i])) s += text[i++];
        if (/[fFlLuU]/.test(text[i] || '')) i++;
        toks.push({ k: 'num', v: s, line: line });
        continue;
      }
      if (c === '"' || c === "'") {
        const q = c;
        i++;
        let s = '';
        while (i < text.length && text[i] !== q) {
          if (text[i] === '\\') {
            const n = text[i + 1];
            s += (n in ESC) ? ESC[n] : n;
            i += 2;
          } else {
            if (text[i] === '\n') line++;
            s += text[i++];
          }
        }
        i++;
        toks.push({ k: q === '"' ? 'str' : 'chr', v: s, line: line });
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let s = '';
        while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) s += text[i++];
        toks.push({ k: 'id', v: s, line: line });
        continue;
      }
      let matched = false;
      for (let oi = 0; oi < OPS.length; oi++) {
        if (text.startsWith(OPS[oi], i)) {
          toks.push({ k: 'op', v: OPS[oi], line: line });
          i += OPS[oi].length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      if (SINGLE.indexOf(c) >= 0) {
        toks.push({ k: 'op', v: c, line: line });
        i++;
        continue;
      }
      err('无法识别的字符 "' + c + '"', line);
    }
    toks.push({ k: 'eof', v: '<eof>', line: line });
    return toks;
  }

  /* ================= 语法分析 ================= */
  const LEVELS = [
    ['||'], ['&&'], ['|'], ['^'], ['&'],
    ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'],
    ['+', '-'], ['*', '/', '%']
  ];

  function Parser(tokens) {
    this.t = tokens;
    this.i = 0;
    this.typedefs = Object.create(null);
    this.structs = Object.create(null);
    this.anon = 0;
  }

  Parser.prototype.peek = function (o) { return this.t[this.i + (o || 0)] || this.t[this.t.length - 1]; };
  Parser.prototype.next = function () { return this.t[this.i++]; };
  Parser.prototype.is = function (v, o) { return this.peek(o).v === v; };
  Parser.prototype.eat = function (v) { if (this.is(v)) { this.i++; return true; } return false; };
  Parser.prototype.expect = function (v) {
    const tk = this.next();
    if (tk.v !== v) err('语法错误：这里应该是 "' + v + '"，实际是 "' + tk.v + '"', tk.line);
    return tk;
  };
  Parser.prototype.isId = function (o) { return this.peek(o).k === 'id'; };

  Parser.prototype.isTypeStart = function (o) {
    const tk = this.peek(o || 0);
    if (tk.k !== 'id') return false;
    if (TYPE_WORDS.has(tk.v) || tk.v === 'struct' || tk.v === 'const' || tk.v === 'static') return true;
    if (this.typedefs[tk.v] || this.structs[tk.v]) return true;
    // 未知别名：形如 Foo bar; 或 Foo *bar;
    const n1 = this.peek((o || 0) + 1);
    if (n1.k === 'id') return true;
    if (n1.v === '*') {
      let j = (o || 0) + 1;
      while (this.peek(j).v === '*') j++;
      return this.peek(j).k === 'id';
    }
    return false;
  };

  Parser.prototype.parseType = function () {
    while (this.is('const') || this.is('static') || this.is('unsigned') ||
      this.is('signed') || this.is('short') || this.is('long')) {
      this.next();
    }
    let base = 'int';
    if (this.is('struct')) {
      this.next();
      let name = null;
      if (this.isId()) name = this.next().v;
      if (this.is('{')) {
        const fields = this.parseStructBody();
        name = name || ('__anon' + (++this.anon));
        this.structs[name] = fields;
      }
      base = name || 'int';
    } else if (this.isId()) {
      const tk = this.next();
      base = tk.v;
      // 记录未定义的类型名（多为头文件里的 typedef/struct 没有一起导入）
      if (!TYPE_WORDS.has(base) && !this.typedefs[base] && !this.structs[base]) {
        if (!this.unknownTypes) this.unknownTypes = [];
        this.unknownTypes.push({ name: base, line: tk.line });
      }
    } else {
      const tk = this.next();
      err('语法错误：这里需要类型', tk.line);
    }
    let ptr = 0;
    while (this.is('*')) { this.next(); ptr++; }
    if (this.typedefs[base]) {
      ptr += this.typedefs[base].ptr;
      base = this.typedefs[base].base;
    }
    return { base: base, ptr: ptr, dims: [] };
  };

  Parser.prototype.parseStructBody = function () {
    this.expect('{');
    const fields = [];
    while (!this.is('}')) {
      const type = this.parseType();
      do {
        let ptr = 0;
        while (this.is('*')) { this.next(); ptr++; }
        const nm = this.next();
        if (nm.k !== 'id') err('结构体字段名不合法', nm.line);
        const dims = [];
        while (this.is('[')) { this.next(); const e = this.parseExpr(); this.expect(']'); dims.push(e); }
        fields.push({ name: nm.v, type: { base: type.base, ptr: type.ptr + ptr, dims: dims } });
      } while (this.eat(','));
      this.expect(';');
    }
    this.expect('}');
    return fields;
  };

  Parser.prototype.parseDeclarators = function (type) {
    const vars = [];
    do {
      let ptr = 0;
      while (this.is('*')) { this.next(); ptr++; }
      const nm = this.next();
      if (nm.k !== 'id') err('变量名不合法', nm.line);
      const dims = [];
      while (this.is('[')) {
        this.next();
        if (this.is(']')) { dims.push(null); } else { dims.push(this.parseExpr()); }
        this.expect(']');
      }
      let init = null;
      if (this.eat('=')) {
        init = this.is('{') ? this.parseInitList() : this.parseAssign();
      }
      vars.push({
        name: nm.v,
        type: { base: type.base, ptr: type.ptr + ptr, dims: dims },
        init: init,
        line: nm.line
      });
    } while (this.eat(','));
    return vars;
  };

  Parser.prototype.parseInitList = function () {
    this.expect('{');
    const items = [];
    if (!this.is('}')) {
      do {
        if (this.is('}')) break;
        items.push(this.is('{') ? this.parseInitList() : this.parseAssign());
      } while (this.eat(','));
    }
    this.expect('}');
    return { t: 'InitList', items: items };
  };

  Parser.prototype.parseTypedef = function () {
    const type = this.parseType();
    let first = true;
    do {
      let ptr = 0;
      while (this.is('*')) { this.next(); ptr++; }
      const nm = this.next();
      if (nm.k !== 'id') err('typedef 名称不合法', nm.line);
      // typedef struct { ... } SqList;  —— 用别名给匿名结构体命名
      if (first && /^__anon/.test(type.base) && this.structs[type.base]) {
        this.structs[nm.v] = this.structs[type.base];
        delete this.structs[type.base];
        type.base = nm.v;
      }
      this.typedefs[nm.v] = { base: type.base, ptr: type.ptr + ptr };
      first = false;
    } while (this.eat(','));
    this.expect(';');
  };

  Parser.prototype.parseProgram = function () {
    const items = [];
    while (this.peek().k !== 'eof') {
      if (this.eat(';')) continue;
      if (this.is('typedef')) { this.next(); this.parseTypedef(); continue; }
      if (!this.isTypeStart()) {
        const tk = this.peek();
        err('无法解析的顶层语句 "' + tk.v + '"', tk.line);
      }
      const type = this.parseType();
      if (this.eat(';')) continue;   // struct X { ... };
      const save = this.i;
      let ptr = 0;
      while (this.is('*')) { this.next(); ptr++; }
      const nm = this.peek();
      if (nm.k === 'id' && this.peek(1).v === '(') {
        this.next();
        const params = this.parseParams();
        const retType = { base: type.base, ptr: type.ptr + ptr, dims: [] };
        if (this.is('{')) {
          const body = this.parseBlock();
          items.push({ t: 'FuncDef', name: nm.v, retType: retType, params: params, body: body, line: nm.line });
        } else {
          this.expect(';');
          items.push({ t: 'FuncProto', name: nm.v, retType: retType, params: params, line: nm.line });
        }
      } else {
        this.i = save;
        const vars = this.parseDeclarators(type);
        this.expect(';');
        items.push({ t: 'GlobalDecl', vars: vars });
      }
    }
    if (this.unknownTypes && this.unknownTypes.length) {
      const u = this.unknownTypes[0];
      err('类型 "' + u.name + '" 没有定义。如果它来自头文件，请把对应的 .h 一起导入' +
        '（或把头文件里的 typedef / struct 粘贴进来）', u.line);
    }
    return { items: items, structs: this.structs, typedefs: this.typedefs };
  };

  Parser.prototype.parseParams = function () {
    this.expect('(');
    const ps = [];
    if (this.is('void') && this.peek(1).v === ')') {
      this.next();
    } else if (!this.is(')')) {
      do {
        if (this.is('...')) { this.next(); break; }
        const type = this.parseType();
        if (this.is(')')) break;
        let ptr = 0;
        let ref = false;
        while (this.is('*') || this.is('&')) {
          if (this.is('&')) ref = true;
          else ptr++;
          this.next();
        }
        const nm = this.next();
        if (nm.k !== 'id') {
          err('函数参数列表第 ' + (ps.length + 1) + ' 个参数缺少参数名：这里应该是 "类型 名字"，' +
            '却看到了 "' + nm.v + '"', nm.line);
        }
        const dims = [];
        while (this.is('[')) {
          this.next();
          while (!this.is(']') && this.peek().k !== 'eof') this.next();
          this.expect(']');
          dims.push(null);
        }
        ps.push({ name: nm.v, type: { base: type.base, ptr: type.ptr + ptr, dims: dims, ref: ref } });
      } while (this.eat(','));
    }
    this.expect(')');
    return ps;
  };

  Parser.prototype.parseBlock = function () {
    const line = this.peek().line;
    this.expect('{');
    const body = [];
    while (!this.is('}') && this.peek().k !== 'eof') body.push(this.parseStmt());
    this.expect('}');
    return { t: 'Block', body: body, line: line };
  };

  Parser.prototype.parseStmt = function () {
    const tk = this.peek();
    if (tk.v === '{') return this.parseBlock();
    if (tk.v === ';') { this.next(); return { t: 'Empty', line: tk.line }; }
    if (tk.v === 'if') return this.parseIf();
    if (tk.v === 'for') return this.parseFor();
    if (tk.v === 'while') return this.parseWhile();
    if (tk.v === 'do') return this.parseDo();
    if (tk.v === 'switch') return this.parseSwitch();
    if (tk.v === 'return') {
      this.next();
      let e = null;
      if (!this.is(';')) e = this.parseExpr();
      this.expect(';');
      return { t: 'Return', e: e, line: tk.line };
    }
    if (tk.v === 'break') { this.next(); this.expect(';'); return { t: 'Break', line: tk.line }; }
    if (tk.v === 'continue') { this.next(); this.expect(';'); return { t: 'Continue', line: tk.line }; }
    if (this.isTypeStart()) {
      const type = this.parseType();
      if (this.eat(';')) return { t: 'Empty', line: tk.line };
      const vars = this.parseDeclarators(type);
      this.expect(';');
      return { t: 'Decl', vars: vars, line: tk.line };
    }
    const e = this.parseExpr();
    this.expect(';');
    return { t: 'ExprStmt', e: e, line: tk.line };
  };

  Parser.prototype.parseIf = function () {
    const line = this.next().line;
    this.expect('(');
    const cond = this.parseExpr();
    this.expect(')');
    const then = this.parseStmt();
    let els = null;
    if (this.is('else')) { this.next(); els = this.parseStmt(); }
    return { t: 'If', cond: cond, then: then, else: els, line: line };
  };

  Parser.prototype.parseFor = function () {
    const line = this.next().line;
    this.expect('(');
    let init = null;
    if (!this.is(';')) {
      if (this.isTypeStart()) {
        const type = this.parseType();
        init = { t: 'Decl', vars: this.parseDeclarators(type), line: line };
      } else {
        init = this.parseExpr();
      }
    }
    this.expect(';');
    let cond = null;
    if (!this.is(';')) cond = this.parseExpr();
    this.expect(';');
    let update = null;
    if (!this.is(')')) update = this.parseExpr();
    this.expect(')');
    const body = this.parseStmt();
    return { t: 'For', init: init, cond: cond, update: update, body: body, line: line };
  };

  Parser.prototype.parseWhile = function () {
    const line = this.next().line;
    this.expect('(');
    const cond = this.parseExpr();
    this.expect(')');
    return { t: 'While', cond: cond, body: this.parseStmt(), line: line };
  };

  Parser.prototype.parseSwitch = function () {
    const line = this.next().line;
    this.expect('(');
    const disc = this.parseExpr();
    this.expect(')');
    this.expect('{');
    const cases = [];
    let cur = null;
    while (!this.is('}') && this.peek().k !== 'eof') {
      if (this.is('case')) {
        const cl = this.next().line;
        const test = this.parseConditional();
        this.expect(':');
        cur = { test: test, stmts: [], line: cl };
        cases.push(cur);
      } else if (this.is('default')) {
        const cl = this.next().line;
        this.expect(':');
        cur = { test: null, stmts: [], line: cl };
        cases.push(cur);
      } else {
        if (!cur) err('switch 的 case / default 之前不能写语句', this.peek().line);
        cur.stmts.push(this.parseStmt());
      }
    }
    this.expect('}');
    return { t: 'Switch', disc: disc, cases: cases, line: line };
  };

  Parser.prototype.parseDo = function () {
    const line = this.next().line;
    const body = this.parseStmt();
    if (!this.is('while')) err('do 语句缺少 while', line);
    this.next();
    this.expect('(');
    const cond = this.parseExpr();
    this.expect(')');
    this.expect(';');
    return { t: 'DoWhile', body: body, cond: cond, line: line };
  };

  Parser.prototype.parseExpr = function () { return this.parseAssign(); };

  Parser.prototype.parseAssign = function () {
    const left = this.parseConditional();
    const tk = this.peek();
    if (tk.k === 'op' && ['=', '+=', '-=', '*=', '/=', '%='].indexOf(tk.v) >= 0) {
      this.next();
      const right = this.parseAssign();
      return { t: 'Assign', op: tk.v, target: left, value: right, line: tk.line };
    }
    return left;
  };

  Parser.prototype.parseConditional = function () {
    const c = this.parseBinary(0);
    if (this.peek().k === 'op' && this.is('?')) {
      const tk = this.next();
      const a = this.parseAssign();
      this.expect(':');
      const b = this.parseConditional();
      return { t: 'Cond', c: c, a: a, b: b, line: tk.line };
    }
    return c;
  };

  Parser.prototype.parseBinary = function (lv) {
    if (lv >= LEVELS.length) return this.parseUnary();
    let left = this.parseBinary(lv + 1);
    while (this.peek().k === 'op' && LEVELS[lv].indexOf(this.peek().v) >= 0) {
      const op = this.next();
      const right = this.parseBinary(lv + 1);
      left = { t: 'Binary', op: op.v, l: left, r: right, line: op.line };
    }
    return left;
  };

  Parser.prototype.isCastStart = function () {
    const t = this.peek(1);
    if (t.k !== 'id') return false;
    const isKnown = TYPE_WORDS.has(t.v) || !!this.typedefs[t.v] || !!this.structs[t.v];
    let j = 2;
    if (t.v === 'struct') {
      if (this.peek(j).k === 'id') j++;
    }
    let stars = 0;
    while (this.peek(j).v === '*') { j++; stars++; }
    if (this.peek(j).v !== ')') return false;
    // (Node*) 这种未知类型指针强转也要识别，避免误判成乘号
    return isKnown || stars > 0;
  };

  Parser.prototype.parseUnary = function () {
    const tk = this.peek();
    if (tk.v === 'sizeof') {
      this.next();
      if (this.is('(')) {
        this.next();
        while (!this.is(')') && this.peek().k !== 'eof') this.next();
        this.expect(')');
      } else {
        this.parseUnary();
      }
      return { t: 'Num', v: 8, line: tk.line };
    }
    if (tk.k === 'op' && ['!', '~', '-', '+', '&', '*', '++', '--'].indexOf(tk.v) >= 0) {
      this.next();
      return { t: 'Unary', op: tk.v, arg: this.parseUnary(), prefix: true, line: tk.line };
    }
    if (tk.v === '(' && this.isCastStart()) {
      this.next();
      const type = this.parseType();
      this.expect(')');
      return { t: 'Cast', type: type, arg: this.parseUnary(), line: tk.line };
    }
    return this.parsePostfix();
  };

  Parser.prototype.parsePostfix = function () {
    let e = this.parsePrimary();
    while (true) {
      const tk = this.peek();
      if (tk.k !== 'op') break;
      if (tk.v === '(') {
        this.next();
        const args = [];
        if (!this.is(')')) {
          do { args.push(this.parseAssign()); } while (this.eat(','));
        }
        this.expect(')');
        e = { t: 'Call', callee: e, args: args, line: tk.line };
      } else if (tk.v === '[') {
        this.next();
        const idx = this.parseExpr();
        this.expect(']');
        e = { t: 'Index', obj: e, idx: idx, line: tk.line };
      } else if (tk.v === '.' || tk.v === '->') {
        this.next();
        const p = this.next();
        e = { t: 'Member', obj: e, prop: p.v, arrow: tk.v === '->', line: tk.line };
      } else if (tk.v === '++' || tk.v === '--') {
        this.next();
        e = { t: 'Unary', op: tk.v, arg: e, prefix: false, line: tk.line };
      } else {
        break;
      }
    }
    return e;
  };

  Parser.prototype.parsePrimary = function () {
    const tk = this.next();
    if (tk.k === 'num') {
      const v = /^0[xX]/.test(tk.v) ? parseInt(tk.v, 16) : parseFloat(tk.v);
      return { t: 'Num', v: v, line: tk.line };
    }
    if (tk.k === 'str' || tk.k === 'chr') return { t: 'Str', v: tk.v, line: tk.line };
    if (tk.k === 'id') return { t: 'Ident', name: tk.v, line: tk.line };
    if (tk.v === '(') {
      const e = this.parseExpr();
      this.expect(')');
      return e;
    }
    err('表达式写错了：意外的 "' + tk.v + '"', tk.line);
  };

  /* ================= 执行 ================= */
  function Runner(ast, opts) {
    this.ast = ast;
    this.structs = Object.assign({}, ast.structs);
    this.funcs = Object.create(null);
    this.globals = { vars: new Map(), parent: null, fn: '<全局>' };
    this.steps = [];
    this.outputs = [];
    this.heap = new Map();
    this.nextId = 1;
    this.stack = [];
    // 标准输入：由界面「输入」面板提供，按 scanf / cin 的读取顺序消费
    this.stdin = String((opts && opts.input) || '').replace(/\r\n?/g, '\n');
    this.stdinPos = 0;
    this.inputMissing = false;
  }

  /* ---------------- 标准输入流 ---------------- */
  Runner.prototype.inputSkipWs = function () {
    while (this.stdinPos < this.stdin.length && /\s/.test(this.stdin[this.stdinPos])) this.stdinPos++;
  };
  Runner.prototype.inputToken = function () {
    this.inputSkipWs();
    if (this.stdinPos >= this.stdin.length) { this.inputMissing = true; return null; }
    const start = this.stdinPos;
    while (this.stdinPos < this.stdin.length && !/\s/.test(this.stdin[this.stdinPos])) this.stdinPos++;
    return this.stdin.slice(start, this.stdinPos);
  };
  Runner.prototype.inputChar = function () {
    if (this.stdinPos >= this.stdin.length) { this.inputMissing = true; return null; }
    return this.stdin[this.stdinPos++];
  };
  Runner.prototype.inputLine = function () {
    if (this.stdinPos >= this.stdin.length) { this.inputMissing = true; return null; }
    const idx = this.stdin.indexOf('\n', this.stdinPos);
    let s;
    if (idx < 0) { s = this.stdin.slice(this.stdinPos); this.stdinPos = this.stdin.length; }
    else { s = this.stdin.slice(this.stdinPos, idx); this.stdinPos = idx + 1; }
    return s;
  };

  /* 把读到的值写回 &x / &a[i] / &s.field */
  Runner.prototype.storeRef = function (ref, value, line) {
    if (Array.isArray(ref)) {          // char 数组按值传进来（scanf("%s", s)）
      if (typeof value === 'string') { writeCStr(ref, value); return true; }
      ref[0] = value;
      return true;
    }
    if (ref && ref.__refArr) {
      ref.arr[ref.idx] = value;
      return true;
    }
    if (ref && ref.__refSlot) {
      const slot = ref.env.vars.get(ref.name);
      if (!slot) err('输入失败：变量 "' + ref.name + '" 不存在', line);
      let v = value;
      if (typeof v === 'string') {
        if (Array.isArray(slot.value)) { writeCStr(slot.value, v); return true; }
        if (slot.type && slot.type.base === 'char' && !(slot.type.dims && slot.type.dims.length)) {
          slot.value = v;
          return true;
        }
        const n = parseFloat(v);
        v = isNaN(n) ? 0 : n;
      }
      slot.value = v;
      return true;
    }
    if (ref && ref.__refMember) {
      const o = ref.obj;
      if (o && typeof o === 'object') {
        if (Array.isArray(o[ref.prop]) && typeof value === 'string') { writeCStr(o[ref.prop], value); return true; }
        o[ref.prop] = value;
        return true;
      }
    }
    err('这里需要变量的地址（例如 &n、&a[i]）', line);
  };

  Runner.prototype.builtinScanf = function (argNodes, env) {
    if (!argNodes.length) return 0;
    const fmtVal = this.evalExpr(argNodes[0], env);
    const fmt = fmtVal == null ? '' : String(fmtVal);
    let ai = 1;
    let assigned = 0;
    for (let i = 0; i < fmt.length; i++) {
      const ch = fmt[i];
      if (/\s/.test(ch)) { this.inputSkipWs(); continue; }
      if (ch !== '%') continue;
      i++;
      if (fmt[i] === '%') continue;
      let suppress = false;
      if (fmt[i] === '*') { suppress = true; i++; }
      while (i < fmt.length && /[0-9]/.test(fmt[i])) i++;
      while (i < fmt.length && /[lhL]/.test(fmt[i])) i++;
      const conv = fmt[i];
      const node = argNodes[ai];
      if (!suppress) ai++;
      let value;
      if (conv === 'c') {
        const c = this.inputChar();
        if (c == null) return assigned || -1;
        value = c;
      } else if (conv === 's' || conv === '[') {
        if (conv === '[') { while (i < fmt.length && fmt[i] !== ']') i++; }
        const tok = this.inputToken();
        if (tok == null) return assigned || -1;
        value = tok;
      } else if (conv === 'd' || conv === 'i' || conv === 'u') {
        const tok = this.inputToken();
        if (tok == null) return assigned || -1;
        const n = parseInt(tok, 10);
        value = isNaN(n) ? 0 : n;
      } else if (conv === 'x' || conv === 'X' || conv === 'o') {
        const tok = this.inputToken();
        if (tok == null) return assigned || -1;
        const n = parseInt(tok, conv === 'o' ? 8 : 16);
        value = isNaN(n) ? 0 : n;
      } else if (conv === 'f' || conv === 'e' || conv === 'g' || conv === 'E' || conv === 'G') {
        const tok = this.inputToken();
        if (tok == null) return assigned || -1;
        const n = parseFloat(tok);
        value = isNaN(n) ? 0 : n;
      } else {
        continue;
      }
      if (suppress || !node) continue;
      const ref = this.evalExpr(node, env);
      this.storeRef(ref, value, node.line);
      assigned++;
    }
    return assigned;
  };

  Runner.prototype.typeStr = function (type) {
    let s = type.base;
    if (type.ptr) s += '*'.repeat(type.ptr);
    if (type.dims && type.dims.length) {
      s += type.dims.map(function (d) { return '[' + (d == null ? '' : d) + ']'; }).join('');
    }
    return s;
  };

  Runner.prototype.zero = function (type) {
    if (!type) return 0;
    if (type.ptr) return null;
    if (type.dims && type.dims.length) return [];
    if (type.base === 'char') return '';
    if (this.structs[type.base]) return null;
    return 0;
  };

  /* 创建一个结构体对象（含数组字段、嵌套结构体字段） */
  Runner.prototype.newStruct = function (name, depth) {
    depth = depth || 0;
    const obj = { __id: this.nextId++, __struct: name };
    this.heap.set(obj.__id, obj);
    const fields = this.structs[name] || [];
    const self = this;
    fields.forEach(function (f) {
      if (f.type.ptr) { obj[f.name] = null; return; }
      if (f.type.dims && f.type.dims.length) {
        const dims = f.type.dims.map(function (x) {
          if (x === null) return 0;
          try { return Math.max(0, Math.floor(num(self.evalExpr(x, self.globals)))); }
          catch (e) { return 0; }
        });
        obj[f.name] = self.makeArray(dims, { base: f.type.base, ptr: 0, dims: [] });
        return;
      }
      if (self.structs[f.type.base] && depth < 4) obj[f.name] = self.newStruct(f.type.base, depth + 1);
      else obj[f.name] = self.zero(f.type);
    });
    return obj;
  };

  Runner.prototype.coerce = function (v, type) {
    if (!type) return v;
    if (type.dims && type.dims.length) return v;
    if (type.ptr) {
      if (v && typeof v === 'object' && v.__malloc) {
        v.__malloc = false;
        this.setStruct(v, type.base);
      }
      return v === undefined ? null : v;
    }
    if (this.structs[type.base]) {
      if (v && typeof v === 'object') return v;
      return this.newStruct(type.base);
    }
    if (type.base === 'char') {
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String.fromCharCode(v);
      return v == null ? '' : String(v);
    }
    if (typeof v === 'string') return v;      // char* / 字符串字面量
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    if (v == null) return 0;
    return num(v);
  };

  Runner.prototype.setStruct = function (obj, name) {
    if (!obj || typeof obj !== 'object' || obj.__struct || !name) return obj;
    const fields = this.structs[name];
    if (!fields) return obj;
    obj.__struct = name;
    const self = this;
    fields.forEach(function (f) {
      if (f.name in obj) return;
      if (f.type.ptr) { obj[f.name] = null; return; }
      if (f.type.dims && f.type.dims.length) {
        const dims = f.type.dims.map(function (x) {
          if (x === null) return 0;
          try { return Math.max(0, Math.floor(num(self.evalExpr(x, self.globals)))); }
          catch (e) { return 0; }
        });
        obj[f.name] = self.makeArray(dims, { base: f.type.base, ptr: 0, dims: [] });
        return;
      }
      if (self.structs[f.type.base]) { obj[f.name] = self.newStruct(f.type.base, 1); return; }
      obj[f.name] = self.zero(f.type);
    });
    return obj;
  };

  Runner.prototype.makeArray = function (dims, elemType) {
    if (!dims.length) {
      if (!elemType.ptr && this.structs[elemType.base]) return this.newStruct(elemType.base);
      return this.zero(elemType);
    }
    const n = Math.max(0, Math.floor(num(dims[0])));
    const arr = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = this.makeArray(dims.slice(1), elemType);
    return arr;
  };

  Runner.prototype.fillInit = function (arr, init, elemType, env) {
    const items = init.items || [];
    const self = this;
    items.forEach(function (item, i) {
      if (i >= arr.length) return;
      if (Array.isArray(arr[i])) {
        if (item.t === 'InitList') self.fillInit(arr[i], item, elemType, env);
      } else {
        arr[i] = self.coerce(self.evalExpr(item, env), elemType);
      }
    });
  };

  Runner.prototype.lookup = function (env, name, line) {
    for (let e = env; e; e = e.parent) {
      if (e.vars.has(name)) {
        const v = e.vars.get(name).value;
        if (v && v.__refSlot) return this.deref(v, line);
        if (v && v.__refArr) return v.arr[v.idx];
        return v;
      }
    }
    if (name === 'NULL' || name === 'nullptr') return null;
    if (name === 'true') return 1;
    if (name === 'false') return 0;
    if (name === 'CLOCKS_PER_SEC') return 1000;
    if (name === 'EXIT_SUCCESS') return 0;
    if (name === 'EXIT_FAILURE') return 1;
    if (name === 'INT_MAX') return 2147483647;
    if (name === 'INT_MIN') return -2147483648;
    if (name === 'RAND_MAX') return 32767;
    err('未定义的变量 "' + name + '"', line);
  };

  Runner.prototype.truthy = function (v) {
    if (v === null || v === undefined || v === false) return false;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0 && v !== '\0';
    return true;
  };

  Runner.prototype.record = function (line) {
    if (!this.stack.length) return;
    if (this.steps.length >= MAX_STEPS) {
      const e = new Error('step limit');
      e.__stepLimit = true;
      if (this.stack.length) e.cLine = this.stack[this.stack.length - 1].line;
      throw e;
    }
    const top = this.stack[this.stack.length - 1];
    if (line) top.line = line;
    const self = this;
    const heap = [];
    this.heap.forEach(function (obj) {
      if (obj.__struct) heap.push(self.heapView(obj));
    });
    const frames = this.stack.map(function (fr) {
      return { fn: fr.fn, line: fr.line, vars: self.varsView(fr.env) };
    });
    this.steps.push({
      line: top.line,
      frames: frames,
      globals: this.varsView(this.globals),
      heap: heap,
      outCount: this.outputs.length
    });
  };

  Runner.prototype.varsView = function (env) {
    const out = [];
    const self = this;
    env.vars.forEach(function (slot, name) {
      out.push({ name: name, type: self.typeStr(slot.type), view: self.view(slot.value) });
    });
    return out;
  };

  Runner.prototype.view = function (v) {
    if (v === null || v === undefined) return { k: 'null' };
    if (typeof v === 'number') return { k: 'num', v: Math.abs(v) < 1e-12 ? 0 : v };
    if (typeof v === 'string') return { k: 'str', v: v };
    if (Array.isArray(v)) {
      const self = this;
      return { k: 'arr', items: v.map(function (x) { return self.view(x); }) };
    }
    if (v.__refSlot) return { k: 'ref', label: '&' + v.name };
    if (v.__refArr) return { k: 'ref', label: '&arr[' + v.idx + ']' };
    if (v.__struct) return { k: 'obj', id: v.__id, struct: v.__struct };
    if (v.__malloc) return { k: 'malloc' };
    return { k: 'str', v: String(v) };
  };

  Runner.prototype.heapView = function (obj) {
    const fields = {};
    const self = this;
    Object.keys(obj).forEach(function (k) {
      if (k.indexOf('__') === 0) return;
      const v = obj[k];
      if (v === null || v === undefined) fields[k] = { k: 'null' };
      else if (typeof v === 'number') fields[k] = { k: 'num', v: v };
      else if (typeof v === 'string') fields[k] = { k: 'str', v: v };
      else if (Array.isArray(v)) fields[k] = { k: 'arr', items: v.slice(0, 60).map(function (x) { return self.view(x); }) };
      else if (v.__struct) fields[k] = { k: 'obj', id: v.__id };
      else fields[k] = { k: 'other' };
    });
    return { id: obj.__id, struct: obj.__struct, fields: fields };
  };

  Runner.prototype.execDecl = function (decl, env) {
    const self = this;
    decl.vars.forEach(function (d) {
      const dims = d.type.dims.map(function (x) { return x === null ? null : self.evalExpr(x, env); });
      if (dims.length) {
        if (dims[0] === null) {
          if (d.init && d.init.t === 'InitList') dims[0] = d.init.items.length;
          else if (d.init && d.init.t === 'Str') dims[0] = String(d.init.v).length + 1;
          else dims[0] = 0;
        }
        const elemType = { base: d.type.base, ptr: d.type.ptr, dims: [] };
        let value = self.makeArray(dims, elemType);
        if (d.init && d.init.t === 'InitList') self.fillInit(value, d.init, elemType, env);
        else if (d.init && d.init.t === 'Str' && Array.isArray(value)) {
          const s = String(d.init.v);
          for (let k = 0; k < value.length; k++) {
            value[k] = k < s.length ? s[k] : '';
          }
        }
        if (!Array.isArray(value)) value = [];
        env.vars.set(d.name, {
          type: { base: d.type.base, ptr: d.type.ptr, dims: dims },
          value: value
        });
        return;
      }
      let value;
      if (d.init) value = self.evalExpr(d.init, env);
      else if (!d.type.ptr && self.structs[d.type.base]) value = self.newStruct(d.type.base);
      else value = self.zero(d.type);
      value = self.coerce(value, d.type);
      env.vars.set(d.name, {
        type: { base: d.type.base, ptr: d.type.ptr, dims: [] },
        value: value
      });
    });
  };

  Runner.prototype.execBlock = function (block, env) {
    for (let i = 0; i < block.body.length; i++) this.execStmt(block.body[i], env);
  };

  Runner.prototype.execStmt = function (st, env) {
    if (st.t === 'Empty') return;
    if (st.t === 'Block') {
      this.execBlock(st, { vars: new Map(), parent: env, fn: env.fn });
      return;
    }
    const frame = this.stack[this.stack.length - 1];
    if (frame) frame.line = st.line;
    this.record(st.line);
    switch (st.t) {
      case 'Decl':
        this.execDecl(st, env);
        break;
      case 'ExprStmt':
        this.evalExpr(st.e, env);
        break;
      case 'If':
        if (this.truthy(this.evalExpr(st.cond, env))) this.execStmt(st.then, env);
        else if (st.else) this.execStmt(st.else, env);
        break;
      case 'While': {
        let guard = 0;
        while (this.truthy(this.evalExpr(st.cond, env))) {
          if (++guard > 100000) err('循环次数过多，可能有死循环', st.line);
          this.record(st.line);
          try {
            this.execStmt(st.body, env);
          } catch (e) {
            if (e && e.__break) break;
            if (e && e.__continue) continue;
            throw e;
          }
        }
        break;
      }
      case 'DoWhile': {
        let guard = 0;
        while (true) {
          if (++guard > 100000) err('循环次数过多，可能有死循环', st.line);
          try {
            this.execStmt(st.body, env);
          } catch (e) {
            if (e && e.__break) break;
            if (e && e.__continue) { /* 继续条件判断 */ } else throw e;
          }
          if (!this.truthy(this.evalExpr(st.cond, env))) break;
        }
        break;
      }
      case 'For': {
        const fenv = { vars: new Map(), parent: env, fn: env.fn };
        if (st.init) {
          if (st.init.t === 'Decl') this.execDecl(st.init, fenv);
          else this.evalExpr(st.init, fenv);
        }
        let guard = 0;
        while (!st.cond || this.truthy(this.evalExpr(st.cond, fenv))) {
          if (++guard > 100000) err('循环次数过多，可能有死循环', st.line);
          this.record(st.line);
          try {
            this.execStmt(st.body, fenv);
          } catch (e) {
            if (e && e.__break) break;
            if (e && e.__continue) { /* 继续走 update */ } else throw e;
          }
          if (st.update) this.evalExpr(st.update, fenv);
        }
        break;
      }
      case 'Switch': {
        const dv = num(this.evalExpr(st.disc, env));
        let start = -1;
        let def = -1;
        for (let i = 0; i < st.cases.length; i++) {
          if (st.cases[i].test === null) { def = i; continue; }
          if (start < 0 && num(this.evalExpr(st.cases[i].test, env)) === dv) start = i;
        }
        if (start < 0) start = def;
        if (start >= 0) {
          try {
            for (let i = start; i < st.cases.length; i++) {
              this.record(st.cases[i].line);
              for (let j = 0; j < st.cases[i].stmts.length; j++) {
                this.execStmt(st.cases[i].stmts[j], env);
              }
            }
          } catch (e) {
            if (!(e && e.__break)) throw e;
          }
        }
        break;
      }
      case 'Return':
        throw { __return: st.e ? this.evalExpr(st.e, env) : 0 };
      case 'Break':
        throw { __break: true };
      case 'Continue':
        throw { __continue: true };
      default:
        break;
    }
  };

  Runner.prototype.callFunction = function (fn, args, isMain) {
    if (this.stack.length > MAX_DEPTH) err('递归/调用层数太深（超过 ' + MAX_DEPTH + ' 层）', fn.line);
    const env = { vars: new Map(), parent: this.globals, fn: fn.name };
    const self = this;
    this.stack.push({ fn: fn.name, line: fn.line, env: env });
    fn.params.forEach(function (p, idx) {
      const t = { base: p.type.base, ptr: p.type.ptr, dims: p.type.dims, ref: p.type.ref };
      const raw = args[idx];
      let value;
      if (p.type.ref && raw && (raw.__refSlot || raw.__refArr)) {
        value = raw;                       // C++ 引用参数：直接绑定到实参
      } else {
        value = self.coerce(raw === undefined ? self.zero(p.type) : raw, p.type);
      }
      env.vars.set(p.name, { type: t, value: value });
    });
    if (isMain) this.record(fn.line);
    let ret = 0;
    try {
      this.execBlock(fn.body, env);
    } catch (e) {
      if (e && e.__return !== undefined) ret = e.__return;
      else throw e;
    }
    this.stack.pop();
    return ret;
  };

  Runner.prototype.deref = function (p, line) {
    if (p === null || p === undefined) err('解引用了空指针', line);
    if (typeof p === 'string') return p;
    if (p.__refSlot) {
      const v = p.env.vars.get(p.name).value;
      return (v && (v.__refSlot || v.__refArr)) ? this.deref(v, line) : v;
    }
    if (p.__refArr) return p.arr[p.idx];
    return p;
  };

  /* 把实参转成可回写的引用（用于 C++ 引用参数 &x） */
  Runner.prototype.makeRefValue = function (node, env) {
    if (!node) return null;
    if (node.t === 'Ident') {
      for (let e = env; e; e = e.parent) {
        if (e.vars.has(node.name)) {
          const slot = e.vars.get(node.name);
          if (slot.value && (slot.value.__refSlot || slot.value.__refArr)) return slot.value;
          return { __refSlot: true, env: e, name: node.name };
        }
      }
      return null;
    }
    if (node.t === 'Index') {
      const arr = this.evalExpr(node.obj, env);
      const idx = Math.trunc(num(this.evalExpr(node.idx, env)));
      if (Array.isArray(arr)) return { __refArr: true, arr: arr, idx: idx };
    }
    return null;
  };

  /* 取变量的原始值（不自动解引用），用于 *p = ... 这类写回 */
  Runner.prototype.rawValue = function (name, env) {
    for (let e = env; e; e = e.parent) {
      if (e.vars.has(name)) return e.vars.get(name).value;
    }
    return undefined;
  };

  Runner.prototype.assignTo = function (target, value, env) {
    if (target.t === 'Ident') {
      for (let e = env; e; e = e.parent) {
        if (e.vars.has(target.name)) {
          const slot = e.vars.get(target.name);
          if (slot.value && slot.value.__refSlot) {
            const ref = slot.value;
            const ts = ref.env.vars.get(ref.name);
            ts.value = this.coerce(value, ts.type);
            return;
          }
          if (slot.value && slot.value.__refArr) {
            slot.value.arr[slot.value.idx] = value;
            return;
          }
          slot.value = this.coerce(value, slot.type);
          return;
        }
      }
      err('给未定义的变量 "' + target.name + '" 赋值', target.line);
    }
    if (target.t === 'Index') {
      const obj = this.evalExpr(target.obj, env);
      const idx = Math.trunc(num(this.evalExpr(target.idx, env)));
      if (obj == null) err('对空指针/空数组赋值', target.line);
      const name = target.obj.t === 'Ident' ? target.obj.name : '';
      if (obj.__refArr) {
        const p = obj.idx + idx;
        if (p < 0 || p >= obj.arr.length) {
          err('数组下标越界：' + (name || '该数组') + '[' + p + ']，长度 ' + obj.arr.length, target.line);
        }
        obj.arr[p] = value;
        return;
      }
      if (Array.isArray(obj)) {
        if (idx < 0 || idx >= obj.length) {
          err('数组下标越界：' + (name || '该数组') + '[' + idx + ']，长度 ' + obj.length +
            (obj.length ? '，合法下标 0 ~ ' + (obj.length - 1) : ''), target.line);
        }
        obj[idx] = value;
        return;
      }
      if (obj.__refSlot) { this.deref(obj, target.line)[idx] = value; return; }
      err('这不是数组，不能按下标赋值', target.line);
    }
    if (target.t === 'Unary' && target.op === '*') {
      let p;
      if (target.arg.t === 'Ident') p = this.rawValue(target.arg.name, env);
      else p = this.evalExpr(target.arg, env);
      if (p === null || p === undefined) err('给空指针赋值', target.line);
      if (p.__refSlot) { p.env.vars.get(p.name).value = this.coerce(value, p.env.vars.get(p.name).type); return; }
      if (p.__refArr) { p.arr[p.idx] = value; return; }
      err('这里不能赋值', target.line);
    }
    if (target.t === 'Member') {
      let o = this.evalExpr(target.obj, env);
      if (o && o.__refSlot) o = this.deref(o, target.line);
      if (o == null) err('不能给空指针的成员赋值（' + target.prop + '）', target.line);
      if (typeof o !== 'object') err('该值没有成员 ' + target.prop, target.line);
      if (!o.__struct && o.__malloc) { o.__malloc = false; }
      o[target.prop] = value;
      return;
    }
    err('赋值号左边不是可赋值的目标', target.line);
  };

  Runner.prototype.evalExpr = function (e, env) {
    const self = this;
    switch (e.t) {
      case 'Num':
        return e.v;
      case 'Str':
        return e.v;
      case 'Ident':
        return this.lookup(env, e.name, e.line);
      case 'InitList':
        return 0;
      case 'Cast': {
        const v = this.evalExpr(e.arg, env);
        if (v && typeof v === 'object' && v.__malloc) {
          v.__malloc = false;
          this.setStruct(v, e.type.base);
        }
        return v;
      }
      case 'Index': {
        const obj = this.evalExpr(e.obj, env);
        const idx = Math.trunc(num(this.evalExpr(e.idx, env)));
        if (obj == null) err('对空指针取下标', e.line);
        if (typeof obj === 'string') {
          if (idx < 0 || idx > obj.length) err('字符串下标越界：下标 ' + idx + '，长度 ' + obj.length, e.line);
          return idx < obj.length ? obj[idx] : '\0';
        }
        const name = e.obj.t === 'Ident' ? e.obj.name : '';
        if (obj.__refArr) {
          const p = obj.idx + idx;
          if (p < 0 || p >= obj.arr.length) {
            err('数组下标越界：' + (name || '该数组') + '[' + p + ']，长度 ' + obj.arr.length, e.line);
          }
          return obj.arr[p];
        }
        if (Array.isArray(obj)) {
          if (idx < 0 || idx >= obj.length) {
            err('数组下标越界：' + (name || '该数组') + '[' + idx + ']，长度 ' + obj.length +
              (obj.length ? '，合法下标 0 ~ ' + (obj.length - 1) : ''), e.line);
          }
          return obj[idx];
        }
        if (obj.__refSlot) return this.deref(obj, e.line)[idx];
        err('这个值不能取下标', e.line);
        break;
      }
      case 'Member': {
        let o = this.evalExpr(e.obj, env);
        if (o && o.__refSlot) o = this.deref(o, e.line);
        if (o == null) err('访问了空指针的成员 "' + e.prop + '"', e.line);
        if (typeof o === 'object') {
          if (!o.__struct && o.__malloc) { o.__malloc = false; }
          const v = o[e.prop];
          return v === undefined ? null : v;
        }
        err('这个值没有成员 "' + e.prop + '"', e.line);
        break;
      }
      case 'Call': {
        if (e.callee.t !== 'Ident') err('不支持这种函数调用写法', e.line);
        const name = e.callee.name;
        if (name === 'printf') return this.builtinPrint(false, e.args, env);
        if (name === 'puts') return this.builtinPrint(true, e.args, env);
        if (name === '__out') {
          const v = e.args.length ? this.evalExpr(e.args[0], env) : '';
          const isCharArr = Array.isArray(v) && v.length &&
            v.every(function (x) { return x == null || typeof x === 'string'; });
          this.outputs.push({
            text: isCharArr ? toCStr(v) : (Array.isArray(v) ? '[' + v.map(function (x) {
              return typeof x === 'string' ? x : String(x);
            }).join(', ') + ']' : (v == null ? '' : String(v)))
          });
          return 0;
        }
        if (name === '__endl') {
          this.outputs.push({ text: '\n' });
          return 0;
        }
        if (name === 'malloc' || name === 'calloc') {
          const obj = { __malloc: true, __id: this.nextId++ };
          this.heap.set(obj.__id, obj);
          return obj;
        }
        if (name === 'free') {
          e.args.forEach(function (a) { self.evalExpr(a, env); });
          return 0;
        }
        if (name === 'perror') {
          const s = e.args.length ? this.evalExpr(e.args[0], env) : '';
          this.outputs.push({ text: '[perror] ' + (s == null ? '' : String(s)) + '\n' });
          return 0;
        }
        if (name === 'clock') return this.steps.length;
        if (name === 'srand') {
          e.args.forEach(function (a) { self.evalExpr(a, env); });
          return 0;
        }
        if (name === 'rand') {
          return (this.steps.length * 9301 + 49297) % 233280 % 32768 % 100;
        }
        if (name === 'strlen') {
          const s = this.evalExpr(e.args[0], env);
          return toCStr(s).length;
        }
        if (name === 'strcmp' || name === 'strncmp') {
          const a = toCStr(this.evalExpr(e.args[0], env));
          const b = toCStr(this.evalExpr(e.args[1], env));
          let n = Math.min(a.length, b.length);
          if (name === 'strncmp' && e.args[2]) n = Math.min(n, Math.trunc(num(this.evalExpr(e.args[2], env))));
          for (let k = 0; k < n; k++) {
            if (a[k] !== b[k]) return a.charCodeAt(k) < b.charCodeAt(k) ? -1 : 1;
          }
          if (name === 'strncmp') return 0;
          return a.length === b.length ? 0 : (a.length < b.length ? -1 : 1);
        }
        if (name === 'strcpy' || name === 'strncpy') {
          const dst = this.evalExpr(e.args[0], env);
          let s = toCStr(this.evalExpr(e.args[1], env));
          if (name === 'strncpy' && e.args[2]) {
            s = s.slice(0, Math.max(0, Math.trunc(num(this.evalExpr(e.args[2], env)))));
          }
          writeCStr(dst, s);
          return dst;
        }
        if (name === 'strcat' || name === 'strncat') {
          const dst = this.evalExpr(e.args[0], env);
          let s = toCStr(this.evalExpr(e.args[1], env));
          if (name === 'strncat' && e.args[2]) {
            s = s.slice(0, Math.max(0, Math.trunc(num(this.evalExpr(e.args[2], env)))));
          }
          writeCStr(dst, toCStr(dst) + s);
          return dst;
        }
        if (name === 'memset') {
          const dst = this.evalExpr(e.args[0], env);
          const v = this.evalExpr(e.args[1], env);
          const n = e.args[2] ? Math.trunc(num(this.evalExpr(e.args[2], env))) : (Array.isArray(dst) ? dst.length : 0);
          if (Array.isArray(dst)) {
            for (let k = 0; k < n && k < dst.length; k++) dst[k] = v;
          } else if (dst && dst.__refArr) {
            for (let k = 0; k < n; k++) dst.arr[dst.idx + k] = v;
          }
          return dst;
        }
        if (name === 'atoi' || name === 'atof') {
          const s = toCStr(this.evalExpr(e.args[0], env)).trim();
          const n = parseFloat(s);
          return isNaN(n) ? 0 : (name === 'atoi' ? Math.trunc(n) : n);
        }
        if (name === 'abs' || name === 'labs') {
          return Math.abs(num(this.evalExpr(e.args[0], env)));
        }
        if (name === 'toupper') return String.fromCharCode(num(this.evalExpr(e.args[0], env))).toUpperCase();
        if (name === 'tolower') return String.fromCharCode(num(this.evalExpr(e.args[0], env))).toLowerCase();
        /* ---- 标准输入 ---- */
        if (name === 'scanf') return this.builtinScanf(e.args, env);
        if (name === 'gets' || name === '__gets') {
          const line = this.inputLine();
          if (line == null) return null;
          const dst = e.args.length ? this.evalExpr(e.args[0], env) : null;
          if (Array.isArray(dst)) { writeCStr(dst, line); return dst; }
          return line;
        }
        if (name === 'fgets') {
          const dst = e.args.length ? this.evalExpr(e.args[0], env) : null;
          const limit = e.args[1] ? Math.max(1, Math.trunc(num(this.evalExpr(e.args[1], env)))) : 256;
          const line = this.inputLine();
          if (line == null) return null;
          const cut = line.slice(0, Math.max(0, limit - 1));
          if (Array.isArray(dst)) { writeCStr(dst, cut); return dst; }
          return cut + '\n';
        }
        if (name === 'getchar') {
          const c = this.inputChar();
          return c == null ? -1 : c.charCodeAt(0);
        }
        if (name === '__in') {
          const tok = this.inputToken();
          if (tok == null) return 0;
          const ref = e.args.length ? this.evalExpr(e.args[0], env) : null;
          let asStr = false;
          if (ref && ref.__refSlot) {
            const slot = ref.env.vars.get(ref.name);
            if (slot && (Array.isArray(slot.value) || typeof slot.value === 'string')) asStr = true;
          }
          if (asStr) this.storeRef(ref, tok, e.line);
          else {
            const n = parseFloat(tok);
            this.storeRef(ref, isNaN(n) ? 0 : n, e.line);
          }
          return 1;
        }
        if (name === '__readint') {
          const tok = this.inputToken();
          if (tok == null) return 0;
          const n = parseInt(tok, 10);
          return isNaN(n) ? 0 : n;
        }
        if (name === '__readfloat') {
          const tok = this.inputToken();
          if (tok == null) return 0;
          const n = parseFloat(tok);
          return isNaN(n) ? 0 : n;
        }
        if (name === '__readstr') {
          const tok = this.inputToken();
          return tok == null ? '' : tok;
        }
        if (name === '__readline') {
          const s = this.inputLine();
          return s == null ? '' : s;
        }
        if (name === '__cat') {
          let s = '';
          e.args.forEach(function (a) { s += toCStr(self.evalExpr(a, env)); });
          return s;
        }
        if (name === '__print' || name === '__println') {
          const v = e.args.length ? this.evalExpr(e.args[0], env) : '';
          this.outputs.push({ text: toCStr(v) });
          if (name === '__println') this.outputs.push({ text: '\n' });
          return 0;
        }
        const fn = this.funcs[name];
        if (!fn) err('未定义的函数 "' + name + '"', e.line);
        const args = fn.params.map(function (p, i) {
          const node = e.args[i];
          if (node && p.type.ref) {
            const rv = self.makeRefValue(node, env);
            if (rv) return rv;
          }
          return node ? self.evalExpr(node, env) : 0;
        });
        return this.callFunction(fn, args, false);
      }
      case 'Unary': {
        if (e.op === '++' || e.op === '--') {
          const old = this.evalExpr(e.arg, env);
          const nv = num(old) + (e.op === '++' ? 1 : -1);
          this.assignTo(e.arg, nv, env);
          return e.prefix ? nv : old;
        }
        if (e.op === '&') {
          const a = e.arg;
          if (a.t === 'Ident') {
            for (let en = env; en; en = en.parent) {
              if (en.vars.has(a.name)) {
                const slot = en.vars.get(a.name);
                if (slot.value && (slot.value.__refSlot || slot.value.__refArr)) return slot.value;
                return { __refSlot: true, env: en, name: a.name };
              }
            }
            err('取地址失败：未定义的变量 "' + a.name + '"', e.line);
          }
          if (a.t === 'Index') {
            const arr = this.evalExpr(a.obj, env);
            const idx = Math.trunc(num(this.evalExpr(a.idx, env)));
            if (Array.isArray(arr)) return { __refArr: true, arr: arr, idx: idx };
            err('只能对数组元素取地址', e.line);
          }
          if (a.t === 'Member') {
            let o = this.evalExpr(a.obj, env);
            if (o && o.__refSlot) o = this.deref(o, e.line);
            if (o && typeof o === 'object') return { __refMember: true, obj: o, prop: a.prop };
            err('只能对结构体成员取地址', e.line);
          }
          err('暂不支持这种取地址写法', e.line);
          break;
        }
        if (e.op === '*') return this.deref(this.evalExpr(e.arg, env), e.line);
        const v = this.evalExpr(e.arg, env);
        if (e.op === '!') return this.truthy(v) ? 0 : 1;
        if (e.op === '-') return -num(v);
        if (e.op === '+') return num(v);
        if (e.op === '~') return ~num(v);
        break;
      }
      case 'Binary':
        return this.evalBinary(e, env);
      case 'Cond':
        return this.truthy(this.evalExpr(e.c, env))
          ? this.evalExpr(e.a, env) : this.evalExpr(e.b, env);
      case 'Assign': {
        let value = this.evalExpr(e.value, env);
        if (e.op !== '=') {
          const old = this.evalExpr(e.target, env);
          if (e.op === '+=') value = num(old) + num(value);
          else if (e.op === '-=') value = num(old) - num(value);
          else if (e.op === '*=') value = num(old) * num(value);
          else if (e.op === '/=') value = num(value) === 0 ? 0 : num(old) / num(value);
          else if (e.op === '%=') value = num(value) === 0 ? 0 : num(old) % num(value);
        }
        this.assignTo(e.target, value, env);
        return value;
      }
      default:
        err('无法执行的表达式', e.line);
    }
  };

  Runner.prototype.evalBinary = function (e, env) {
    if (e.op === '&&') {
      const l = this.evalExpr(e.l, env);
      return this.truthy(l) ? this.evalExpr(e.r, env) : 0;
    }
    if (e.op === '||') {
      const l = this.evalExpr(e.l, env);
      return this.truthy(l) ? 1 : this.evalExpr(e.r, env);
    }
    const l = this.evalExpr(e.l, env);
    const r = this.evalExpr(e.r, env);
    if (e.op === '==' || e.op === '!=') {
      let eq;
      if ((l && typeof l === 'object') || (r && typeof r === 'object')) eq = l === r;
      else if (typeof l === 'string' || typeof r === 'string') eq = l === r;
      else eq = num(l) === num(r);
      return e.op === '==' ? (eq ? 1 : 0) : (eq ? 0 : 1);
    }
    const a = num(l);
    const b = num(r);
    switch (e.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) err('除数为 0', e.line);
        return (Number.isInteger(a) && Number.isInteger(b)) ? Math.trunc(a / b) : a / b;
      case '%':
        if (b === 0) err('取余的除数为 0', e.line);
        return a % b;
      case '<': return a < b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
      case '<<': return a << b;
      case '>>': return a >> b;
      default: err('不支持的运算符 ' + e.op, e.line);
    }
  };

  Runner.prototype.builtinPrint = function (isPuts, argNodes, env) {
    const self = this;
    const vals = argNodes.map(function (a) { return self.evalExpr(a, env); });
    let text = '';
    if (isPuts) {
      text = (vals[0] == null ? '' : String(vals[0])) + '\n';
    } else {
      const fmt = vals[0] == null ? '' : String(vals[0]);
      let ai = 1;
      for (let i = 0; i < fmt.length; i++) {
        const ch = fmt[i];
        if (ch !== '%') { text += ch; continue; }
        i++;
        let spec = '';
        while (i < fmt.length && /[0-9.+\-#l]/.test(fmt[i])) { spec += fmt[i]; i++; }
        const conv = fmt[i];
        const v = vals[ai++];
        if (conv === 'd' || conv === 'i' || conv === 'u') text += String(Math.trunc(num(v)));
        else if (conv === 'c') text += (typeof v === 'string' ? v : String.fromCharCode(num(v)));
        else if (conv === 's') text += toCStr(v);
        else if (conv === 'f') {
          const m = spec.match(/\.(\d+)/);
          text += num(v).toFixed(m ? parseInt(m[1], 10) : 2);
        } else if (conv === 'x') text += Math.trunc(num(v)).toString(16);
        else if (conv === '%') text += '%';
        else text += '%' + conv;
      }
    }
    this.outputs.push({ text: text });
    return text.length;
  };

  Runner.prototype.run = function () {
    const self = this;
    const items = this.ast.items;
    let error = null;
    let errorLine = null;
    items.forEach(function (it) { if (it.t === 'FuncDef') self.funcs[it.name] = it; });
    try {
      items.forEach(function (it) {
        if (it.t === 'GlobalDecl') self.execDecl(it, self.globals);
      });
      let main = this.funcs['main'];
      if (!main) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].t === 'FuncDef') { main = items[i]; break; }
        }
      }
      if (!main) err('没有找到 main 函数', 1);
      this.callFunction(main, [], true);
    } catch (e) {
      if (e && e.__stepLimit) {
        errorLine = e.cLine || null;
        error = '执行的步骤太多（超过 ' + MAX_STEPS + ' 步），已自动停下：很可能是死循环。' +
          '请检查循环变量是否更新、终止条件是否会成立' +
          (errorLine ? '（停在第 ' + errorLine + ' 行）' : '') + '。';
      } else if (e && e.__return !== undefined) {
        error = null;
      } else {
        error = (e && e.message) ? e.message : String(e);
        errorLine = (e && e.cLine) || null;
        if (errorLine) error += '（第 ' + errorLine + ' 行）';
      }
    }
    return {
      steps: this.steps,
      outputs: this.outputs,
      structs: this.structs,
      error: error,
      errorLine: errorLine,
      inputMissing: this.inputMissing
    };
  };

  /* ================= 静态检查 ================= */
  function lint(src) {
    const issues = [];
    const seen = Object.create(null);
    const FULLWIDTH = '，。；：（）【】“”‘’';
    const PAIRS = { ')': '(', ']': '[', '}': '{' };
    const brackets = [];
    let inBlock = false;

    function add(line, msg, hint) {
      const key = line + '|' + msg;
      if (seen[key] || issues.length >= 12) return;
      seen[key] = 1;
      issues.push({ line: line, msg: msg, hint: hint || '' });
    }

    const lines = String(src).split(/\r?\n/);
    lines.forEach(function (line, i) {
      const ln = i + 1;
      let q = null;
      let code = '';
      for (let j = 0; j < line.length; j++) {
        const c = line[j];
        if (inBlock) {
          if (c === '*' && line[j + 1] === '/') { inBlock = false; j++; }
          continue;
        }
        if (q) {
          if (c === '\\') { j++; continue; }
          if (c === q) q = null;
          continue;
        }
        if (c === '/' && line[j + 1] === '/') break;
        if (c === '/' && line[j + 1] === '*') { inBlock = true; j++; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        code += c;
        if (FULLWIDTH.indexOf(c) >= 0) {
          add(ln, '检测到中文标点「' + c + '」',
            'C 代码里的标点要用半角：逗号 , 、分号 ; 、冒号 : 、括号 ( ) [ ] { } 、引号 " \' 。');
          continue;
        }
        if (c === '(' || c === '[' || c === '{') {
          brackets.push({ c: c, ln: ln });
        } else if (c === ')' || c === ']' || c === '}') {
          const top = brackets[brackets.length - 1];
          if (top && top.c === PAIRS[c]) brackets.pop();
          else add(ln, '多余的右括号「' + c + '」', '检查前面的括号是否配对，可能多写了一个右括号。');
        }
      }

      if (/^\s*#/.test(line)) return;

      const m = code.match(/^\s*(?:else\s+)?(if|while|for)\s*\(([^)]*)\)/);
      if (m) {
        const inner = m[2].replace(/==|!=|<=|>=|<<=|>>=|=>/g, '');
        if (/(^|[^=!<>])=(?!=)/.test(inner)) {
          add(ln, '条件里用了赋值号「=」', '判断相等要写「==」；如果确实想赋值，请把赋值单独写成一句。');
        }
      }
      if (/\bscanf\s*\(/.test(code)) {
        add(ln, '检测到 scanf 输入', '运行前在右侧「输入」面板按读取顺序填数据（空格或换行分隔）；也可以把数据直接写成变量。');
      }
      if (/\bgets\s*\(|\bfgets\s*\(|\bcin\s*>>/.test(code)) {
        add(ln, '检测到输入语句', '运行前在右侧「输入」面板按读取顺序填数据（空格或换行分隔）。');
      }
    });

    brackets.forEach(function (b) {
      add(b.ln, '括号「' + b.c + '」没有闭合', '从这里往后缺少对应的右括号，检查函数体、循环体或函数调用。');
    });
    issues.sort(function (a, b) { return a.line - b.line; });
    return issues;
  }

  function parseAndRun(src, opts) {
    const text = preprocess(src);
    const tokens = tokenize(text);
    const parser = new Parser(tokens);
    const ast = parser.parseProgram();
    const runner = new Runner(ast, opts);
    return runner.run();
  }

  const API = { parseAndRun: parseAndRun, tokenize: tokenize, Parser: Parser, lint: lint };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else { global.CParseRun = parseAndRun; global.CParseLint = lint; }
})(typeof window !== 'undefined' ? window : globalThis);
