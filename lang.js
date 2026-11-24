/* 多语言前端：Python / Java -> C 子集，再交给现有可视化引擎执行。
   返回 { code, map }，map[生成行-1] = 原始行号（1 起）。 */
(function (root) {
  'use strict';

  function LangError(msg, line) {
    const e = new Error(msg);
    e.cLine = line || null;
    e.__lang = true;
    return e;
  }

  function indentOf(s) {
    const m = s.match(/^[ \t]*/)[0];
    return m.replace(/\t/g, '    ').length;
  }

  function splitTop(s, sep) {
    const out = [];
    let cur = '';
    let depth = 0;
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        cur += c;
        if (c === '\\') { cur += s[++i] || ''; }
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      if (c === ')' || c === ']' || c === '}') depth--;
      if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); });
  }

  function singleToDouble(expr) {
    return expr.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, function (_, s) {
      return '"' + s.replace(/"/g, '\\"') + '"';
    });
  }

  function pyStrip(raw) {
    let q = null;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) {
        if (c === '\\') i++;
        else if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === '#') return { code: raw.slice(0, i), comment: raw.slice(i + 1).trim() };
    }
    return { code: raw, comment: '' };
  }

  function pyExpr(expr, line, lens) {
    let e = String(expr).trim();
    // 输入：int(input()) / float(input()) / input()
    e = e.replace(/\b(?:int|float)\s*\(\s*input\s*\([\s\S]*?\)\s*\)/g, function (m) {
      return /^\s*float/.test(m) ? '__readfloat()' : '__readint()';
    });
    e = e.replace(/\binput\s*\([\s\S]*?\)/g, '__readstr()');
    if (/f["']/.test(e)) throw LangError('f-string 只在 print(...) 里支持', line);
    e = e.replace(/len\s*\(\s*([A-Za-z_]\w*)\s*\)/g, function (_, n) {
      if (lens[n] == null) throw LangError('无法确定列表 "' + n + '" 的长度（只支持直接写出的列表）', line);
      return '(' + lens[n] + ')';
    });
    e = e.replace(/\bTrue\b/g, '1').replace(/\bFalse\b/g, '0').replace(/\bNone\b/g, 'NULL');
    e = e.replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b/g, '!');
    e = e.replace(/\/\//g, '/');
    e = e.replace(/\*\*/g, '*');
    e = singleToDouble(e);
    return e;
  }

  /* ---------------- Python ---------------- */
  function pythonToC(src) {
    const rawLines = String(src).replace(/\r/g, '').split('\n');
    const lines = [];
    let doc = false;
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      if (/^\s*"""/.test(raw)) {
        doc = !doc;
        lines.push({ line: i + 1, indent: 0, body: '', comment: '' });
        continue;
      }
      if (doc) { lines.push({ line: i + 1, indent: 0, body: '', comment: '' }); continue; }
      const st = pyStrip(raw);
      lines.push({
        line: i + 1,
        indent: indentOf(raw),
        body: st.code.trim(),
        comment: st.comment
      });
    }

    const out = [];
    const map = [];
    const lens = Object.create(null);
    let loopSeq = 0;
    function emit(text, line) {
      out.push(text);
      map.push(line || 1);
    }

    const funcs = [];
    const mainStmts = [];
    // 先扫描所有直接写出的列表，函数里用到 len(a) 时也能拿到长度
    lines.forEach(function (L) {
      if (!L.body) return;
      const m = L.body.match(/^([A-Za-z_]\w*)\s*=\s*\[(.*)\]$/);
      if (m) lens[m[1]] = m[2].trim() ? splitTop(m[2], ',').length : 1;
    });
    for (let i = 0; i < lines.length;) {
      const L = lines[i];
      if (!L.body) { i++; continue; }
      if (L.indent === 0 && /^def\s+/.test(L.body)) {
        const m = L.body.match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:\s*$/);
        if (!m) throw LangError('Python 函数定义只支持 def name(参数): 的形式', L.line);
        const name = m[1];
        const params = m[2].trim() ? splitTop(m[2], ',') : [];
        let j = i + 1;
        const body = [];
        while (j < lines.length) {
          const B = lines[j];
          if (B.body && B.indent <= 0) break;
          body.push(B);
          j++;
        }
        const bodyText = body.map(function (x) { return x.body; }).join('\n');
        const paramsC = params.map(function (p) {
          if (!/^[A-Za-z_]\w*$/.test(p)) throw LangError('函数参数只支持简单变量名', L.line);
          const isArr = new RegExp('\\b' + p + '\\s*\\[').test(bodyText);
          return isArr ? 'int ' + p + '[]' : 'int ' + p;
        });
        funcs.push({ name: name, paramsC: paramsC, body: body, header: L.line });
        i = j;
      } else {
        if (/^if\s+__name__\s*==/.test(L.body)) { i++; continue; }
        mainStmts.push(L);
        i++;
      }
    }

    function collectDecls(stmts, paramsC) {
      const reserved = Object.create(null);
      paramsC.forEach(function (p) {
        reserved[p.replace(/\[\]/g, '').split(/\s+/).pop()] = 1;
      });
      const names = [];
      const seen = Object.create(null);
      stmts.forEach(function (L) {
        if (!L.body) return;
        let m = L.body.match(/^for\s+([A-Za-z_]\w*)\s+in\s+/);
        if (m) { reserved[m[1]] = 1; }
        m = L.body.match(/^([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$/);
        if (m && !/^\[/.test(m[2])) {
          if (!reserved[m[1]] && !seen[m[1]]) { seen[m[1]] = 1; names.push(m[1]); }
        }
        m = L.body.match(/^([A-Za-z_]\w*)\s*(?:\+=|-=|\*=|\/=)/);
        if (m && !reserved[m[1]] && !seen[m[1]]) { seen[m[1]] = 1; names.push(m[1]); }
      });
      return names;
    }

    function genBlock(stmts) {
      const stack = [];
      let lastLine = stmts.length ? stmts[0].line : 1;
      stmts.forEach(function (L) {
        if (!L.body) {
          if (L.comment) emit('// ' + L.comment, L.line);
          return;
        }
        lastLine = L.line;
        const ind = L.indent;
        const isElse = /^(else|elif)\b/.test(L.body);
        while (stack.length && stack[stack.length - 1].indent >= ind) {
          const top = stack[stack.length - 1];
          if (isElse && top.indent === ind && top.kind === 'if') break;
          emit('}', L.line);
          stack.pop();
        }
        const merged = isElse && stack.length &&
          stack[stack.length - 1].indent === ind && stack[stack.length - 1].kind === 'if';

        let text = null;
        let opens = null;
        let m;

        if ((m = L.body.match(/^for\s+([A-Za-z_]\w*)\s+in\s+range\(([^)]*)\)\s*:$/))) {
          const args = splitTop(m[2], ',');
          const v = m[1];
          let start = '0';
          let end = '0';
          let step = '1';
          if (args.length === 1) end = pyExpr(args[0], L.line, lens);
          else if (args.length === 2) {
            start = pyExpr(args[0], L.line, lens);
            end = pyExpr(args[1], L.line, lens);
          } else if (args.length === 3) {
            start = pyExpr(args[0], L.line, lens);
            end = pyExpr(args[1], L.line, lens);
            step = pyExpr(args[2], L.line, lens);
          } else throw LangError('range() 参数过多', L.line);
          const down = /^-\d+$/.test(step);
          text = 'for (int ' + v + ' = ' + start + '; ' + v + (down ? ' > ' : ' < ') +
            end + '; ' + v + ' += ' + step + ') {';
          opens = 'for';
        } else if ((m = L.body.match(/^for\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\s*:\s*$/))) {
          const arrName = m[2];
          if (lens[arrName] == null) {
            throw LangError('无法确定列表 "' + arrName + '" 的长度，暂时只能遍历直接写出的列表', L.line);
          }
          const idx = '__i' + (++loopSeq);
          text = 'for (int ' + idx + ' = 0; ' + idx + ' < (' + lens[arrName] + '); ' + idx + '++) {' +
            ' int ' + m[1] + ' = ' + arrName + '[' + idx + '];';
          opens = 'for';
        } else if (/^for\s+/.test(L.body)) {
          throw LangError('暂不支持这种 for 写法。列表请用 for i in range(n) 或 for x in 列表', L.line);
        } else if ((m = L.body.match(/^while\s+(.+)\s*:$/))) {
          text = 'while (' + pyExpr(m[1], L.line, lens) + ') {';
          opens = 'while';
        } else if ((m = L.body.match(/^if\s+(.+)\s*:$/))) {
          text = (merged ? '} else ' : '') + 'if (' + pyExpr(m[1], L.line, lens) + ') {';
          opens = 'if';
        } else if ((m = L.body.match(/^elif\s+(.+)\s*:$/))) {
          text = '} else if (' + pyExpr(m[1], L.line, lens) + ') {';
        } else if (L.body === 'else:') {
          text = '} else {';
        } else if ((m = L.body.match(/^print\s*\((.*)\)\s*$/))) {
          const args = m[1].trim() ? splitTop(m[1], ',') : [];
          const stmts = [];
          if (!args.length) {
            stmts.push('__endl();');
          } else {
            args.forEach(function (a, i) {
              if (i) stmts.push('__out(" ");');
              const fm = a.match(/^f(["'])([\s\S]*)\1$/);
              if (!fm) {
                stmts.push('__out(' + pyExpr(a, L.line, lens) + ');');
                return;
              }
              // f-string：拆成 字面量 + 表达式 交替输出
              const body = fm[2].replace(/\{\{/g, '\u0001').replace(/\}\}/g, '\u0002');
              const parts = body.split(/(\{[^{}]*\})/);
              parts.forEach(function (p) {
                if (!p) return;
                if (p.charAt(0) === '{' && p.charAt(p.length - 1) === '}') {
                  const expr = p.slice(1, -1).split(':')[0].trim();
                  stmts.push('__out(' + pyExpr(expr, L.line, lens) + ');');
                } else {
                  const lit = p.replace(/\u0001/g, '{').replace(/\u0002/g, '}');
                  stmts.push('__out(' + JSON.stringify(lit) + ');');
                }
              });
            });
            stmts.push('__endl();');
          }
          text = stmts.join('');
        } else if (/^[A-Za-z_]\w*\.append\s*\(/.test(L.body)) {
          throw LangError('Python 的 append 暂不支持（列表长度固定）：请预先分配足够长的列表，再用下标赋值', L.line);
        } else if ((m = L.body.match(/^([A-Za-z_]\w*)\s*=\s*\[([^,\]]*)\]\s*\*\s*(.+)$/))) {
          const name = m[1];
          const nExpr = pyExpr(m[3], L.line, lens);
          lens[name] = nExpr;
          text = 'int ' + name + '[' + nExpr + '];';
        } else if ((m = L.body.match(/^return(?:\s+(.+))?$/))) {
          text = 'return ' + (m[1] ? pyExpr(m[1], L.line, lens) : '0') + ';';
        } else if ((m = L.body.match(/^([A-Za-z_]\w*)\s*=\s*\[(.*)\]$/))) {
          const name = m[1];
          const items = m[2].trim() ? splitTop(m[2], ',') : [];
          items.forEach(function (x, i) {
            items[i] = pyExpr(x, L.line, lens);
          });
          lens[name] = items.length || 1;
          text = 'int ' + name + '[' + lens[name] + '] = {' + items.join(', ') + '};';
        } else if ((m = L.body.match(/^([A-Za-z_]\w*)\[([^\]]+)\]\s*(\+=|-=|\*=|\/=)\s*(.+)$/))) {
          text = m[1] + '[' + pyExpr(m[2], L.line, lens) + '] ' + m[3] + ' ' +
            pyExpr(m[4], L.line, lens) + ';';
        } else if ((m = L.body.match(/^([A-Za-z_]\w*)\[([^\]]+)\]\s*=\s*(.+)$/))) {
          text = m[1] + '[' + pyExpr(m[2], L.line, lens) + '] = ' + pyExpr(m[3], L.line, lens) + ';';
        } else if ((m = L.body.match(/^([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=)\s*(.+)$/))) {
          text = m[1] + ' ' + m[2] + ' ' + pyExpr(m[3], L.line, lens) + ';';
        } else if ((m = L.body.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/))) {
          text = m[1] + ' = ' + pyExpr(m[2], L.line, lens) + ';';
        } else if (/^(break|continue)\s*$/.test(L.body)) {
          text = L.body + ';';
        } else if (L.body === 'pass') {
          text = ';';
        } else if (/^import\s+|^from\s+/.test(L.body)) {
          text = ';';
        } else if (/^[A-Za-z_]\w*\s*\(.*\)\s*$/.test(L.body)) {
          text = pyExpr(L.body, L.line, lens) + ';';
        } else {
          throw LangError('暂不支持这行 Python：' + L.body, L.line);
        }

        emit(text, L.line);
        if (opens && !(merged && opens === 'if')) stack.push({ indent: ind, kind: opens });
      });
      while (stack.length) { emit('}', lastLine); stack.pop(); }
    }

    funcs.forEach(function (f) {
      const decls = collectDecls(f.body, f.paramsC);
      emit('int ' + f.name + '(' + f.paramsC.join(', ') + ') {' +
        (decls.length ? ' int ' + decls.join(', ') + ';' : ''), f.header);
      genBlock(f.body);
      const endLine = f.body.length ? f.body[f.body.length - 1].line : f.header;
      emit('return 0;', endLine);
      emit('}', endLine);
    });

    const mainDecls = collectDecls(mainStmts, []);
    emit('int main() {' + (mainDecls.length ? ' int ' + mainDecls.join(', ') + ';' : ''),
      mainStmts.length ? mainStmts[0].line : 1);
    genBlock(mainStmts);
    const last = mainStmts.length ? mainStmts[mainStmts.length - 1].line : 1;
    emit('return 0;', last);
    emit('}', last);

    return { code: out.join('\n'), map: map };
  }

  /* ---------------- Java ---------------- */
  function javaType(t) {
    return t === 'boolean' ? 'bool' : t;
  }

  function stripBlockComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, function (m) {
      return m.replace(/[^\n]/g, '');
    });
  }

  function braceDelta(text) {
    let d = 0;
    let q = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '\\') i++;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '{') d++;
      else if (c === '}') d--;
    }
    return d;
  }

  function javaToC(src) {
    const lines = stripBlockComments(String(src)).replace(/\r/g, '').split('\n');
    const out = [];
    const map = [];
    const lens = Object.create(null);
    const strVars = Object.create(null);
    let loopSeq = 0;
    function emit(text, line) { out.push(text); map.push(line || 1); }

    // Scanner 调用 -> 内置输入函数
    function javaIn(expr) {
      let e = String(expr);
      e = e.replace(/\b[A-Za-z_]\w*\.nextLine\s*\(\s*\)/g, '__readline()');
      e = e.replace(/\b[A-Za-z_]\w*\.nextInt\s*\(\s*\)/g, '__readint()');
      e = e.replace(/\b[A-Za-z_]\w*\.nextLong\s*\(\s*\)/g, '__readint()');
      e = e.replace(/\b[A-Za-z_]\w*\.nextDouble\s*\(\s*\)/g, '__readfloat()');
      e = e.replace(/\b[A-Za-z_]\w*\.nextFloat\s*\(\s*\)/g, '__readfloat()');
      e = e.replace(/\b[A-Za-z_]\w*\.next\s*\(\s*\)/g, '__readstr()');
      return e;
    }

    // 常用 String / 数组方法
    function javaMethods(expr, line) {
      let e = String(expr);
      e = e.replace(/\b([A-Za-z_]\w*)\.charAt\s*\(\s*([^)]*?)\s*\)/g, '$1[$2]');
      e = e.replace(/\b([A-Za-z_]\w*)\.equals\s*\(\s*([^)]*?)\s*\)/g, '(strcmp($1, $2) == 0)');
      e = e.replace(/([A-Za-z_]\w*)\.length\s*\(\s*\)/g, function (_, n) {
        if (strVars[n]) return 'strlen(' + n + ')';
        if (lens[n] == null) throw LangError('无法确定数组 "' + n + '" 的长度', line);
        return '(' + lens[n] + ')';
      });
      e = e.replace(/([A-Za-z_]\w*)\.length\b/g, function (_, n) {
        if (strVars[n]) return 'strlen(' + n + ')';
        if (lens[n] == null) throw LangError('无法确定数组 "' + n + '" 的长度', line);
        return '(' + lens[n] + ')';
      });
      return e;
    }

    function javaExpr(expr, line) {
      let e = javaMethods(javaIn(String(expr).trim()), line);
      e = e.replace(/\btrue\b/g, '1').replace(/\bfalse\b/g, '0');
      return e;
    }

    // 行内 System.out.print / println（例如 if (x) System.out.println(...)）
    function inlinePrint(argsText, newline, line) {
      const terms = splitTop(argsText, '+');
      const hasStr = terms.some(function (t) { return /^".*"$/.test(t); });
      const val = (hasStr && terms.length > 1)
        ? '__cat(' + terms.map(function (t) { return javaExpr(t, line); }).join(', ') + ')'
        : (terms.length && terms[0] ? javaExpr(terms[0], line) : '""');
      return (newline ? '__println(' : '__print(') + val + ')';
    }

    function emitPrint(argsText, newline, line) {
      const args = argsText.trim() ? splitTop(argsText, ',') : [];
      if (!args.length) { if (newline) emit('__endl();', line); return; }
      args.forEach(function (a, i) {
        const terms = splitTop(a, '+');
        const hasStr = terms.some(function (t) { return /^".*"$/.test(t); });
        if (hasStr && terms.length > 1) {
          terms.forEach(function (t) { if (t) emit('__out(' + javaExpr(t, line) + ');', line); });
        } else {
          emit('__out(' + javaExpr(a, line) + ');', line);
        }
        if (i < args.length - 1) emit('__out(" ");', line);
      });
      if (newline) emit('__endl();', line);
    }

    function genMethodBody(bodyLines, startLine) {
      bodyLines.forEach(function (entry) {
        const raw = entry.raw;
        const t = raw.trim();
        const line = entry.line;
        if (!t) { emit('', line); return; }
        if (t.startsWith('//')) { emit(t, line); return; }
        if (t === '}') { emit('}', line); return; }
        let x = t;
        let m;

        if ((m = x.match(/^System\.out\.print(?:ln)?\((.*)\)\s*;\s*$/))) {
          emitPrint(m[1], /println/.test(x), line);
          return;
        }
        if ((m = x.match(/^(?:java\.util\.)?Scanner\s+([A-Za-z_]\w*)\s*=\s*new\s+Scanner\s*\(\s*System\.in\s*\)\s*;\s*$/))) {
          emit(';', line);               // Scanner 只是输入源，读取时直接走输入面板
          return;
        }
        if (/^[A-Za-z_]\w*\.close\s*\(\s*\)\s*;\s*$/.test(x)) { emit(';', line); return; }
        if ((m = x.match(/^String\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\.(nextLine|next)\s*\(\s*\)\s*;\s*$/))) {
          strVars[m[1]] = 1;
          emit('char *' + m[1] + ' = ' + (m[3] === 'nextLine' ? '__readline()' : '__readstr()') + ';', line);
          return;
        }
        if ((m = x.match(/^String\s+([A-Za-z_]\w*)\s*=\s*("(?:[^"\\]|\\.)*")\s*;\s*$/))) {
          strVars[m[1]] = 1;
          emit('char *' + m[1] + ' = ' + m[2] + ';', line);
          return;
        }
        if (/String\s+[A-Za-z_]\w*/.test(x)) {
          throw LangError('暂不支持这个 String 写法（只支持 = "字面量" 或 Scanner.next/nextLine）', line);
        }
        if (/\bnew\s+(?!int\s*\[|long\s*\[|double\s*\[|char\s*\[)/.test(x)) {
          throw LangError('暂不支持 new 对象（链表/树这类类结构暂时只能看数组写法）', line);
        }
        if (/for\s*\([^;)]*:[^;)]*\)/.test(x)) {
          const fm = x.match(/^for\s*\(\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)\s*\)\s*\{?\s*$/);
          if (!fm || lens[fm[3]] == null) {
            throw LangError('暂不支持这个 for-each 写法，请改成 for (int i = 0; i < a.length; i++)', line);
          }
          const idx = '__i' + (++loopSeq);
          emit('for (int ' + idx + ' = 0; ' + idx + ' < (' + lens[fm[3]] + '); ' + idx + '++) { ' +
            javaType(fm[1]) + ' ' + fm[2] + ' = ' + fm[3] + '[' + idx + '];', line);
          return;
        }
        if ((m = x.match(/^(int|long|double|char|boolean)\s*\[\s*\]\s*([A-Za-z_]\w*)\s*=\s*\{([^}]*)\}\s*;\s*$/))) {
          const items = m[3].trim() ? splitTop(m[3], ',') : [];
          lens[m[2]] = items.length || 1;
          emit(javaType(m[1]) + ' ' + m[2] + '[' + lens[m[2]] + '] = {' + items.join(', ') + '};', line);
          return;
        }
        if ((m = x.match(/^(int|long|double|char|boolean)\s*\[\s*\]\s*([A-Za-z_]\w*)\s*=\s*new\s+(?:int|long|double|char|boolean)\s*\[([^\]]+)\]\s*;\s*$/))) {
          lens[m[2]] = javaExpr(m[3], line);
          emit(javaType(m[1]) + ' ' + m[2] + '[' + lens[m[2]] + '];', line);
          return;
        }

        x = javaIn(x);
        x = x.replace(/\bboolean\b/g, 'bool');
        x = x.replace(/\btrue\b/g, '1').replace(/\bfalse\b/g, '0');
        x = javaMethods(x, line);
        x = x.replace(/System\.out\.print(ln)?\s*\(\s*([^;]*?)\s*\)/g, function (_, nl, args) {
          return inlinePrint(args, !!nl, line);
        });
        emit(x, line);
      });
    }

    let inClass = false;
    for (let i = 0; i < lines.length; i++) {
      const line = i + 1;
      const t = lines[i].trim();
      if (!t) { emit('', line); continue; }
      if (/^(package|import)\b/.test(t)) { emit('', line); continue; }
      if (!inClass && /\bclass\s+\w+/.test(t)) { inClass = true; emit('', line); continue; }
      if (t === '}') { inClass = false; emit('', line); continue; }
      if (t.startsWith('//')) { emit(t, line); continue; }

      const sig = t.match(/^(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(int|long|double|char|boolean|void|String)\s+(\w+)\s*\(([^)]*)\)\s*\{\s*$/);
      if (sig) {
        const ret = sig[1];
        const name = sig[2];
        const params = sig[3].trim();
        if (params.indexOf('String') >= 0 && name !== 'main') {
          throw LangError('暂不支持 String 参数，请改用 int / char 数组', line);
        }
        if (ret === 'String') throw LangError('暂不支持返回 String，请改成数值数组操作', line);
        const paramsC = (name !== 'main' && params) ? splitTop(params, ',').map(function (p) {
          p = p.replace(/\bfinal\s+/g, '').trim();
          const m = p.match(/^([A-Za-z_]\w*)\s*(\[\s*\])?\s+([A-Za-z_]\w*)(\[\s*\])?$/);
          if (!m) throw LangError('暂不支持这个参数写法：' + p, line);
          if (m[1] === 'String') throw LangError('暂不支持 String 参数', line);
          return javaType(m[1]) + ' ' + m[3] + (m[2] || m[4] ? '[]' : '');
        }) : [];

        // 找到方法体的闭合位置
        let d = 0;
        let end = lines.length - 1;
        for (let k = i; k < lines.length; k++) {
          d += braceDelta(lines[k]);
          if (d <= 0) { end = k; break; }
        }
        const body = [];
        for (let k = i + 1; k < end; k++) body.push({ raw: lines[k], line: k + 1 });

        if (name === 'main') emit('int main() {', line);
        else emit(javaType(ret) + ' ' + name + '(' + paramsC.join(', ') + ') {', line);
        genMethodBody(body);
        if (name === 'main' || ret !== 'void') emit('return 0;', end + 1);
        emit('}', end + 1);
        i = end;
        continue;
      }

      const f = t.match(/^static\s+final\s+int\s+([A-Za-z_]\w*)\s*=\s*(\d+)\s*;\s*$/);
      if (f) { emit('#define ' + f[1] + ' ' + f[2], line); continue; }
      throw LangError('暂不支持类成员定义：' + t + '（目前支持 static 方法与数组）', line);
    }

    return { code: out.join('\n'), map: map };
  }

  function detect(code) {
    const s = String(code || '');
    const cLike = /#include|#define|;\s*$|\bint\s+main\s*\(|\bstruct\s+\w+\s*\{/.test(s);
    if (/^\s*(def|import|from)\s+/m.test(s)) return 'python';
    if (!cLike && /:\s*$/m.test(s) && /^\s{2,}\w/m.test(s)) return 'python';
    if (/\bpublic\s+(?:final\s+)?class\b/.test(s) || /\bSystem\.out\.print/.test(s)) return 'java';
    if (/#include\s*<iostream>|\bcout\s*<<|\bcin\s*>>|using\s+namespace\s+std/.test(s)) return 'cpp';
    return 'c';
  }

  function translate(src, lang) {
    if (lang === 'python') return pythonToC(src);
    if (lang === 'java') return javaToC(src);
    return { code: src, map: null };
  }

  const API = { translate: translate, detect: detect };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.LangTranslate = API;
})(typeof window !== 'undefined' ? window : globalThis);
