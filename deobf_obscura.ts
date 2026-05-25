import chalk, { type ChalkInstance } from "chalk";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

const traverse = (
  typeof _traverse === "function" ? _traverse : (_traverse as { default: typeof _traverse }).default
) as typeof _traverse;
const generate = (
  typeof _generate === "function" ? _generate : (_generate as { default: typeof _generate }).default
) as typeof _generate;

function gradient(text: string): string {
  const colors = [
    chalk.hex("#FF0000"), chalk.hex("#FF4500"), chalk.hex("#FF8C00"),
    chalk.hex("#FFD700"), chalk.hex("#ADFF2F"), chalk.hex("#00FF7F"),
    chalk.hex("#00FFFF"), chalk.hex("#1E90FF"), chalk.hex("#8A2BE2"),
    chalk.hex("#FF1493"),
  ];
  return text.split("").map((ch, i) => colors[i % colors.length]!(ch)).join("");
}

function rainbowLine(text: string, offset = 0): string {
  const colors = [
    chalk.hex("#FF0000"), chalk.hex("#FF4500"), chalk.hex("#FF8C00"),
    chalk.hex("#FFD700"), chalk.hex("#ADFF2F"), chalk.hex("#00FF7F"),
    chalk.hex("#00FFFF"), chalk.hex("#1E90FF"), chalk.hex("#8A2BE2"),
    chalk.hex("#FF1493"),
  ];
  return text.split("").map((ch, i) => colors[(i + offset) % colors.length]!(ch)).join("");
}

function printBanner() {
  console.clear();
  const ktn = [
    "  ██╗  ██╗████████╗███╗   ██╗",
    "  ██║ ██╔╝╚══██╔══╝████╗  ██║",
    "  █████╔╝    ██║   ██╔██╗ ██║",
    "  ██╔═██╗    ██║   ██║╚██╗██║",
    "  ██║  ██╗   ██║   ██║ ╚████║",
    "  ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═══╝",
  ];
  console.log();
  ktn.forEach((line, i) => console.log(rainbowLine(line, i * 3)));
  console.log();
  console.log(gradient("  ╔══════════════════════════════════════════════╗"));
  console.log(
    gradient("  ║") + chalk.bold.white("     JS Obscura Deobfuscator     ") +
    chalk.hex("#FF69B4")("✦ ") + chalk.bold.cyan("by KTN   ") + gradient("  ║")
  );
  console.log(
    gradient("  ║") +
    chalk.hex("#888888")("     github.com/Swp-dev/Obscura-Deobfuscator") +
    gradient("  ║")
  );
  console.log(gradient("  ╚══════════════════════════════════════════════╝"));
  console.log();
}

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function log(tag: string, color: ChalkInstance, msg: string) {
  console.log(color.bold(`  [${tag}]`) + chalk.white(` ${msg}`));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ObscuraNames {
  tagFuncName: string | null;
  decodeFuncName: string | null;
  poolName: string | null;
  tableName: string | null;
  symName: string | null;
  methodAliasNames: string[];
}

function detectObscuraNames(code: string): ObscuraNames {
  const esc = escapeRegex;

  const tagFuncName =
    code.match(/function\s+(_0x[0-9a-f]+)\s*\(\s*v\s*,\s*checksum\s*\)/)?.[1] ??
    (code.includes("function __obscura_tag") ? "__obscura_tag" : null);

  const decodeFuncName =
    code.match(/function\s+(_0x[0-9a-f]+)\s*\(\s*start\s*,\s*len\s*,\s*seed\s*\)/)?.[1] ??
    (code.includes("function __obscura_sp") ? "__obscura_sp" : null);

  const symName =
    code.match(/const\s+(_0x[0-9a-f]+)\s*=\s*Symbol\s*\(/)?.[1] ??
    (code.includes("__obscura_sym") ? "__obscura_sym" : null);

  const poolName = tagFuncName
    ? code.match(new RegExp(`const\\s+(_0x[0-9a-f]+)\\s*=\\s*${esc(tagFuncName)}\\s*\\(\\s*\\[\\s*\\d`))?.[1] ??
      (code.includes("__obscura_pool") ? "__obscura_pool" : null)
    : (code.includes("__obscura_pool") ? "__obscura_pool" : null);

  const tableName = tagFuncName
    ? code.match(new RegExp(`const\\s+(_0x[0-9a-f]+)\\s*=\\s*${esc(tagFuncName)}\\s*\\(\\s*\\[\\s*function`))?.[1] ??
      (code.includes("__obscura_ft") ? "__obscura_ft" : null)
    : (code.includes("__obscura_ft") ? "__obscura_ft" : null);

  const methodAliasNames: string[] = [];
  const maRe = /const\s+(_0x[0-9a-f]+)\s*=\s*[\w.]+\.bind\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = maRe.exec(code)) !== null) methodAliasNames.push(m[1]!);

  return { tagFuncName, decodeFuncName, poolName, tableName, symName, methodAliasNames };
}

function resolveObscuraStrings(code: string, names: ObscuraNames): Record<string, string> {
  const resolved: Record<string, string> = {};
  const { tagFuncName, decodeFuncName } = names;
  if (!decodeFuncName) return resolved;

  try {
    const sandbox: Record<string, unknown> = { Object, Array, String, Math, Symbol };
    const ctx = vm.createContext(sandbox);

    let preamble: string;
    if (tagFuncName) {
      const tableIdx = code.search(
        new RegExp(`const\\s+_0x[0-9a-f]+\\s*=\\s*${escapeRegex(tagFuncName)}\\s*\\(\\s*\\[\\s*function`)
      );
      if (tableIdx > 0) {
        preamble = code.slice(0, tableIdx);
      } else {
        const poolRe = new RegExp(
          `const\\s+_0x[0-9a-f]+\\s*=\\s*${escapeRegex(tagFuncName)}\\s*\\(\\s*\\[[\\s\\S]*?\\]\\s*,\\s*\\d+\\s*\\)`
        );
        const poolMatch = code.match(poolRe);
        if (poolMatch) {
          const poolEnd = code.indexOf(poolMatch[0]) + poolMatch[0].length;
          preamble = code.slice(0, poolEnd + 1);
        } else {
          preamble = code.slice(0, Math.min(code.length, 15000));
        }
      }
    } else {
      const legacyMatch = code.match(
        /^(function __obscura_tag[\s\S]*?const __obscura_pool=__obscura_tag\([\s\S]*?\);)/
      );
      preamble = legacyMatch?.[1] ?? code.slice(0, 5000);
    }

    try { vm.runInContext(preamble, ctx); } catch { /* ignore */ }

    const callRe = new RegExp(
      `${escapeRegex(decodeFuncName)}\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)`,
      "g"
    );
    let callMatch: RegExpExecArray | null;
    while ((callMatch = callRe.exec(code)) !== null) {
      const call = callMatch[0]!;
      if (resolved[call]) continue;
      try {
        const val = vm.runInContext(call, ctx);
        if (typeof val === "string") resolved[call] = val;
      } catch { /* ignore */ }
    }

    const legacyRe = /__obscura_sp\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g;
    let legacyMatch2: RegExpExecArray | null;
    while ((legacyMatch2 = legacyRe.exec(code)) !== null) {
      const call = legacyMatch2[0]!;
      if (resolved[call]) continue;
      try {
        const val = vm.runInContext(call, ctx);
        if (typeof val === "string") resolved[call] = val;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  return resolved;
}

const JUNK_VAR =
  /^_(?:shift|flag|state|key|buf|tick|rot|flip|mask|xor|val|tmp|seed|nonce|iv|cnt|acc|idx|ptr|res|out|hash|data|block|round|word|byte|bit|step|iter|loop|node|leaf|prev|next|cur|last|head|tail|top|bot|left|right|mid|end|pos|off|len|size|src|dst|ref|arg|ret|err|ok|id|op|fn|cb|ctx|env|cfg|opt|req|rsp|msg|buf|chunk|crc|p)[_0-9a-f]+$/;
const HEX_VAR = /^_0x[0-9a-f]{6,}$/;

function isJunkVarName(name: string): boolean {
  return JUNK_VAR.test(name) || HEX_VAR.test(name);
}

function isJunkStatement(stmt: t.Statement): boolean {
  if (t.isBlockStatement(stmt)) {
    if (stmt.body.length === 0) return true;
    const first = stmt.body[0];
    if (
      first && t.isVariableDeclaration(first) &&
      first.declarations.every((d: t.VariableDeclarator) => t.isIdentifier(d.id) && isJunkVarName((d.id as t.Identifier).name))
    ) return true;
  }
  if (t.isExpressionStatement(stmt)) {
    const expr = stmt.expression;
    if (t.isCallExpression(expr) && t.isFunctionExpression(expr.callee)) {
      const id = (expr.callee as t.FunctionExpression).id;
      if (id && (HEX_VAR.test(id.name) || id.name.startsWith("_0x"))) return true;
    }
    if (
      t.isAssignmentExpression(expr) &&
      t.isIdentifier(expr.left) &&
      isJunkVarName(expr.left.name)
    ) return true;
  }
  if (
    t.isVariableDeclaration(stmt) &&
    stmt.declarations.every((d: t.VariableDeclarator) => t.isIdentifier(d.id) && isJunkVarName((d.id as t.Identifier).name))
  ) return true;
  return false;
}

function isConstantFolded(expr: t.Expression): boolean {
  if (t.isNumericLiteral(expr)) return true;
  if (t.isBinaryExpression(expr)) {
    return isConstantFolded(expr.left as t.Expression) &&
           isConstantFolded(expr.right as t.Expression);
  }
  return false;
}

function findStateVarInit(
  stmts: t.Statement[]
): { name: string; initState: number; declIdx: number } | null {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i]!;
    if (!t.isVariableDeclaration(s)) continue;
    if (s.kind !== "let") continue;
    for (const d of s.declarations) {
      if (!t.isIdentifier(d.id)) continue;
      if (!d.init || !t.isNumericLiteral(d.init)) continue;
      const varName = d.id.name;
      if (!varName.startsWith("__obscura_s") && !HEX_VAR.test(varName)) continue;
      for (let j = 0; j < stmts.length; j++) {
        const ws = stmts[j]!;
        if (!t.isWhileStatement(ws)) continue;
        if (!t.isBooleanLiteral(ws.test, { value: true })) continue;
        const wb = ws.body;
        if (!t.isBlockStatement(wb) || wb.body.length !== 1) continue;
        const sw = wb.body[0]!;
        if (!t.isSwitchStatement(sw)) continue;
        if (t.isIdentifier(sw.discriminant) && sw.discriminant.name === varName) {
          return { name: varName, initState: d.init.value, declIdx: i };
        }
      }
    }
  }
  return null;
}

function extractStateTransition(stmt: t.Statement, varName: string): number | null {
  if (!t.isExpressionStatement(stmt)) return null;
  const expr = stmt.expression;
  if (!t.isAssignmentExpression(expr, { operator: "=" })) return null;
  if (!t.isIdentifier(expr.left) || expr.left.name !== varName) return null;
  if (!t.isNumericLiteral(expr.right)) return null;
  return expr.right.value;
}

function linearizeFunctionBody(body: t.BlockStatement): t.BlockStatement {
  const stmts = body.body;
  const stateInfo = findStateVarInit(stmts);
  if (!stateInfo) return body;
  const { name: stateVar, initState, declIdx } = stateInfo;

  let whileIdx = -1;
  let switchCases: t.SwitchCase[] = [];

  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i]!;
    if (!t.isWhileStatement(s)) continue;
    if (!t.isBooleanLiteral(s.test, { value: true })) continue;
    const wb = s.body;
    if (!t.isBlockStatement(wb) || wb.body.length !== 1) continue;
    const sw = wb.body[0]!;
    if (!t.isSwitchStatement(sw)) continue;
    if (!t.isIdentifier(sw.discriminant) || sw.discriminant.name !== stateVar) continue;
    whileIdx = i;
    switchCases = sw.cases;
    break;
  }

  if (whileIdx === -1) return body;

  const caseMap = new Map<number, { realStmts: t.Statement[]; nextState: number | null }>();
  for (const sc of switchCases) {
    if (!sc.test || !t.isNumericLiteral(sc.test)) continue;
    const stateNum = sc.test.value;
    const realStmts: t.Statement[] = [];
    let nextState: number | null = null;
    let hitTerminator = false;

    for (const stmt of sc.consequent) {
      if (t.isBreakStatement(stmt)) continue;
      if (hitTerminator) continue;
      const trans = extractStateTransition(stmt, stateVar);
      if (trans !== null) { nextState = trans; continue; }
      if (isJunkStatement(stmt)) continue;
      realStmts.push(stmt);
      if (t.isReturnStatement(stmt) || t.isThrowStatement(stmt)) hitTerminator = true;
    }

    caseMap.set(stateNum, { realStmts, nextState });
  }

  const linearized: t.Statement[] = [];
  let state: number | null = initState;
  const visited = new Set<number>();

  while (state !== null && !visited.has(state)) {
    visited.add(state);
    const entry = caseMap.get(state);
    if (!entry) break;
    linearized.push(...entry.realStmts);
    state = entry.nextState;
  }

  const newBody: t.Statement[] = [];
  for (let i = 0; i < stmts.length; i++) {
    if (i === declIdx) continue;
    if (i === whileIdx) {
      newBody.push(...linearized);
    } else {
      const s = stmts[i]!;
      if (!isJunkStatement(s)) newBody.push(s);
    }
  }

  return t.blockStatement(newBody);
}

interface FunctionTableResult {
  functionNames: Map<number, string>;
  declarations: t.FunctionDeclaration[];
}

function deepLinearizeArrowsInNode(node: t.Node): void {
  if (!node || typeof node !== "object") return;
  const isFuncLike = t.isArrowFunctionExpression(node) || t.isFunctionExpression(node);
  if (isFuncLike && t.isBlockStatement((node as t.ArrowFunctionExpression | t.FunctionExpression).body)) {
    const fn = node as t.ArrowFunctionExpression | t.FunctionExpression;
    const newBody = linearizeFunctionBody(fn.body as t.BlockStatement);
    if (newBody !== fn.body) fn.body = newBody;
    deepLinearizeArrowsInNode(fn.body);
    return;
  }
  const keys: readonly string[] = t.VISITOR_KEYS[node.type] ?? [];
  for (const key of keys) {
    const val = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(val)) {
      for (const child of val) {
        if (child && typeof child === "object" && "type" in child) {
          deepLinearizeArrowsInNode(child as t.Node);
        }
      }
    } else if (val && typeof val === "object" && "type" in (val as object)) {
      deepLinearizeArrowsInNode(val as t.Node);
    }
  }
}

function extractFunctionTable(ast: t.File, tableName: string): FunctionTableResult {
  const functionNames = new Map<number, string>();
  const declarations: t.FunctionDeclaration[] = [];

  traverse(ast, {
    VariableDeclaration(nodePath: NodePath<t.VariableDeclaration>) {
      if (nodePath.node.declarations.length !== 1) return;
      const d = nodePath.node.declarations[0]!;
      if (!t.isIdentifier(d.id) || d.id.name !== tableName) return;
      if (!d.init || !t.isArrayExpression(d.init)) return;

      d.init.elements.forEach((elem: t.Expression | t.SpreadElement | null, idx: number) => {
        if (!elem || !t.isFunctionExpression(elem)) return;
        const funcExpr = elem as t.FunctionExpression;
        const name = funcExpr.id?.name ?? `func_${idx}`;
        const linearBody = linearizeFunctionBody(funcExpr.body);
        deepLinearizeArrowsInNode(linearBody);
        functionNames.set(idx, name);
        declarations.push(
          t.functionDeclaration(
            t.identifier(name),
            funcExpr.params,
            linearBody,
            funcExpr.generator,
            funcExpr.async
          )
        );
      });

      nodePath.remove();
    },
  });

  return { functionNames, declarations };
}

function mergeVarDeclarationsInPlace(body: t.BlockStatement): void {
  const stmts = body.body;
  if (stmts.length === 0) return;

  const pendingVars = new Set<string>();
  const skipIdxs = new Set<number>();

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i]!;
    if (!t.isVariableDeclaration(stmt) || stmt.kind !== "var") continue;
    const allBare = stmt.declarations.every(
      (d: t.VariableDeclarator) =>
        d.init == null &&
        t.isIdentifier(d.id) &&
        !isJunkVarName((d.id as t.Identifier).name)
    );
    if (!allBare) continue;
    for (const d of stmt.declarations) {
      if (t.isIdentifier(d.id)) pendingVars.add(d.id.name);
    }
    skipIdxs.add(i);
  }

  if (pendingVars.size === 0) return;

  const result: t.Statement[] = [];
  for (let i = 0; i < stmts.length; i++) {
    if (skipIdxs.has(i)) continue;
    const stmt = stmts[i]!;

    if (
      t.isExpressionStatement(stmt) &&
      t.isAssignmentExpression(stmt.expression) &&
      stmt.expression.operator === "=" &&
      t.isIdentifier(stmt.expression.left) &&
      pendingVars.has(stmt.expression.left.name)
    ) {
      const varName = stmt.expression.left.name;
      result.push(
        t.variableDeclaration("const", [
          t.variableDeclarator(t.identifier(varName), stmt.expression.right),
        ])
      );
      pendingVars.delete(varName);
      continue;
    }

    result.push(stmt);
  }

  if (pendingVars.size > 0) {
    result.unshift(
      t.variableDeclaration("var", [
        ...[...pendingVars].map((n: string) => t.variableDeclarator(t.identifier(n))),
      ])
    );
  }

  body.body = result;
}

function isTernaryCallStatement(expr: t.Expression): expr is t.ConditionalExpression {
  return (
    t.isConditionalExpression(expr) &&
    t.isCallExpression(expr.consequent) &&
    t.isCallExpression(expr.alternate)
  );
}

function isRequireDeclaration(node: t.Statement): boolean {
  if (!t.isVariableDeclaration(node)) return false;
  return node.declarations.every((d: t.VariableDeclarator) => {
    if (d.init == null) return false;
    if (
      t.isCallExpression(d.init) &&
      t.isIdentifier(d.init.callee) &&
      d.init.callee.name === "require"
    ) return true;
    if (
      t.isMemberExpression(d.init) &&
      t.isCallExpression(d.init.object) &&
      t.isIdentifier((d.init.object as t.CallExpression).callee) &&
      ((d.init.object as t.CallExpression).callee as t.Identifier).name === "require"
    ) return true;
    return false;
  });
}

function reorderProgramBody(ast: t.File): void {
  const imports: t.Statement[] = [];
  const varDecls: t.Statement[] = [];
  const funcDecls: t.Statement[] = [];
  const rest: t.Statement[] = [];

  for (const node of ast.program.body) {
    if (t.isImportDeclaration(node) || isRequireDeclaration(node)) {
      imports.push(node);
    } else if (t.isFunctionDeclaration(node)) {
      funcDecls.push(node);
    } else if (t.isVariableDeclaration(node)) {
      varDecls.push(node);
    } else {
      rest.push(node);
    }
  }

  ast.program.body = [...imports, ...varDecls, ...funcDecls, ...rest];
}

function deobfuscate(code: string): string {
  log("INFO", chalk.cyan, "Detecting obfuscation patterns...");
  const names = detectObscuraNames(code);
  const { tagFuncName, tableName, symName, poolName, methodAliasNames } = names;
  log("INFO", chalk.hex("#888888"),
    `tag=${tagFuncName ?? "?"} decode=${names.decodeFuncName ?? "?"} table=${tableName ?? "?"}`);

  log("INFO", chalk.cyan, "Resolving obfuscated strings...");
  const stringMap = resolveObscuraStrings(code, names);
  log("INFO", chalk.green, `Resolved ${Object.keys(stringMap).length} string(s)`);
  for (const [call, val] of Object.entries(stringMap)) {
    const escaped = val
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")
      .replace(/\0/g, "\\0")
      .replace(/[\x01-\x1f\x7f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
    code = code.replaceAll(call, `"${escaped}"`);
  }

  log("INFO", chalk.cyan, "Parsing AST...");
  let ast: ReturnType<typeof parser.parse>;
  try {
    ast = parser.parse(code, { sourceType: "module", errorRecovery: true });
  } catch {
    ast = parser.parse(code, { sourceType: "script", errorRecovery: true });
  }

  const tagNames = new Set<string>(
    [tagFuncName, "__obscura_tag"].filter(Boolean) as string[]
  );
  traverse(ast, {
    CallExpression(np: NodePath<t.CallExpression>) {
      const callee = np.node.callee;
      if (t.isIdentifier(callee) && tagNames.has(callee.name)) {
        const first = np.node.arguments[0];
        if (first && t.isExpression(first)) np.replaceWith(first);
      }
    },
  });

  const actualTableName = tableName ?? "__obscura_ft";
  log("INFO", chalk.cyan, `Extracting function table [${actualTableName}]...`);
  const { functionNames, declarations } = extractFunctionTable(ast, actualTableName);
  log("INFO", chalk.green, `Found ${declarations.length} function(s)`);
  if (declarations.length > 0) ast.program.body.unshift(...declarations);

  if (functionNames.size > 0) {
    traverse(ast, {
      CallExpression(np: NodePath<t.CallExpression>) {
        const callee = np.node.callee;
        if (!t.isMemberExpression(callee)) return;
        if (!t.isIdentifier(callee.object) || callee.object.name !== actualTableName) return;
        if (!callee.computed || !t.isNumericLiteral(callee.property)) return;
        const name = functionNames.get((callee.property as t.NumericLiteral).value);
        if (name) np.node.callee = t.identifier(name);
      },
    });
  }

  log("INFO", chalk.cyan, "Linearizing top-level callbacks & IIFEs...");
  for (const stmt of ast.program.body) {
    deepLinearizeArrowsInNode(stmt);
  }

  const internalNames = new Set<string>([
    ...(tagFuncName ? [tagFuncName] : []),
    ...(names.decodeFuncName ? [names.decodeFuncName] : []),
    ...(symName ? [symName] : []),
    ...(poolName ? [poolName] : []),
    ...methodAliasNames,
    "__obscura_tag", "__obscura_sp", "__obscura_sym", "__obscura_pool",
    "__obscura_Math_floor", "__obscura_Math_random", "__obscura_Math_ceil",
    "__obscura_Math_round", "__obscura_Object_defineProperty", "__obscura_Object_keys",
    "__obscura_Array_prototype_slice", "__obscura_Array_prototype_forEach",
  ]);

  log("INFO", chalk.cyan, "Removing preamble & method aliases...");
  traverse(ast, {
    FunctionDeclaration(np: NodePath<t.FunctionDeclaration>) {
      const name = np.node.id?.name ?? "";
      if (internalNames.has(name)) np.remove();
    },
    VariableDeclaration(np: NodePath<t.VariableDeclaration>) {
      const all = np.node.declarations.every((d: t.VariableDeclarator) => {
        if (!t.isIdentifier(d.id)) return false;
        const n = (d.id as t.Identifier).name;
        return internalNames.has(n) || n.startsWith("__obscura_") || isJunkVarName(n);
      });
      if (all) np.remove();
    },
  });

  log("INFO", chalk.cyan, "Linearizing state machines...");
  traverse(ast, {
    FunctionDeclaration(np: NodePath<t.FunctionDeclaration>) {
      const newBody = linearizeFunctionBody(np.node.body);
      if (newBody !== np.node.body) np.node.body = newBody;
    },
    FunctionExpression(np: NodePath<t.FunctionExpression>) {
      const newBody = linearizeFunctionBody(np.node.body);
      if (newBody !== np.node.body) np.node.body = newBody;
    },
    ArrowFunctionExpression(np: NodePath<t.ArrowFunctionExpression>) {
      if (!t.isBlockStatement(np.node.body)) return;
      const newBody = linearizeFunctionBody(np.node.body);
      if (newBody !== np.node.body) np.node.body = newBody;
    },
  });

  log("INFO", chalk.cyan, "Merging hoisted var declarations...");
  traverse(ast, {
    BlockStatement(np: NodePath<t.BlockStatement>) {
      mergeVarDeclarationsInPlace(np.node);
    },
  });

  log("INFO", chalk.cyan, "Removing junk code...");
  traverse(ast, {
    ExpressionStatement(np: NodePath<t.ExpressionStatement>) {
      const expr = np.node.expression;
      if (
        t.isAssignmentExpression(expr) &&
        t.isIdentifier(expr.left) &&
        isJunkVarName(expr.left.name)
      ) { np.remove(); return; }
      if (t.isCallExpression(expr) && t.isFunctionExpression(expr.callee)) {
        const id = (expr.callee as t.FunctionExpression).id;
        if (id && (HEX_VAR.test(id.name) || id.name.startsWith("_0x"))) { np.remove(); return; }
      }
    },

    VariableDeclaration(np: NodePath<t.VariableDeclaration>) {
      if (np.node.declarations.every((d: t.VariableDeclarator) => t.isIdentifier(d.id) && isJunkVarName((d.id as t.Identifier).name))) {
        np.remove();
      }
    },

    SwitchStatement(np: NodePath<t.SwitchStatement>) {
      const disc = np.node.discriminant;
      if (
        (t.isIdentifier(disc) && isJunkVarName(disc.name)) ||
        isConstantFolded(disc as t.Expression)
      ) np.remove();
    },

    IfStatement: {
      exit(np: NodePath<t.IfStatement>) {
        const test = np.node.test;
        const leftId =
          t.isIdentifier(test) ? test :
          t.isBinaryExpression(test) && t.isIdentifier(test.left) ? test.left :
          t.isBinaryExpression(test) && t.isBinaryExpression(test.left) && t.isIdentifier((test.left as t.BinaryExpression).left)
            ? (test.left as t.BinaryExpression).left : null;
        if (leftId && isJunkVarName((leftId as t.Identifier).name)) { np.remove(); return; }
        const cons = np.node.consequent;
        if (t.isBlockStatement(cons) && cons.body.length === 0) { np.remove(); return; }
      },
    },

    ForStatement: {
      exit(np: NodePath<t.ForStatement>) {
        const { init, test, body } = np.node;
        if (
          init && t.isVariableDeclaration(init) &&
          init.declarations.every((d: t.VariableDeclarator) => t.isIdentifier(d.id) && isJunkVarName((d.id as t.Identifier).name))
        ) { np.remove(); return; }
        if (t.isBlockStatement(body) && body.body.length === 0) { np.remove(); return; }
        if (
          !init && test &&
          t.isBinaryExpression(test) && t.isIdentifier(test.left) && isJunkVarName(test.left.name)
        ) { np.remove(); return; }
      },
    },

    WhileStatement: {
      exit(np: NodePath<t.WhileStatement>) {
        const { test, body } = np.node;
        if (t.isBlockStatement(body) && body.body.length === 0) { np.remove(); return; }
        if (t.isIdentifier(test) && isJunkVarName(test.name)) { np.remove(); return; }
        if (
          t.isBinaryExpression(test) && t.isIdentifier(test.left) && isJunkVarName(test.left.name)
        ) { np.remove(); return; }
      },
    },

    TryStatement: {
      exit(np: NodePath<t.TryStatement>) {
        const { block, handler } = np.node;
        const handlerEmpty = handler === null || handler === undefined || handler.body.body.length === 0;
        if (handlerEmpty && !np.node.finalizer && (block.body.length === 0 || block.body.every(isJunkStatement))) {
          np.remove(); return;
        }
      },
    },
  });

  traverse(ast, {
    BlockStatement(np: NodePath<t.BlockStatement>) {
      const parent = np.parent;
      if (
        t.isFunction(parent) || t.isTryStatement(parent) || t.isCatchClause(parent) ||
        t.isIfStatement(parent) || t.isForStatement(parent) || t.isWhileStatement(parent) ||
        t.isDoWhileStatement(parent) || t.isSwitchCase(parent)
      ) return;
      if (np.node.body.length === 0) try { np.remove(); } catch { /* ignore */ }
    },
  });

  traverse(ast, {
    ExpressionStatement(np: NodePath<t.ExpressionStatement>) {
      const expr = np.node.expression;
      if (!isTernaryCallStatement(expr)) return;
      np.replaceWith(
        t.ifStatement(
          expr.test,
          t.blockStatement([t.expressionStatement(expr.consequent)]),
          t.blockStatement([t.expressionStatement(expr.alternate)])
        )
      );
    },
  });

  traverse(ast, {
    ExpressionStatement(np: NodePath<t.ExpressionStatement>) {
      const expr = np.node.expression;
      if (!t.isLogicalExpression(expr)) return;
      if (expr.operator !== "&&" && expr.operator !== "||") return;

      const right = expr.right;
      const bodyStmts: t.Statement[] = t.isSequenceExpression(right)
        ? right.expressions.map((e: t.Expression) => t.expressionStatement(e))
        : [t.expressionStatement(right)];

      if (expr.operator === "&&") {
        np.replaceWith(t.ifStatement(expr.left, t.blockStatement(bodyStmts)));
      } else {
        np.replaceWith(
          t.ifStatement(t.unaryExpression("!", expr.left), t.blockStatement(bodyStmts))
        );
      }
    },
  });

  const legacyAliases: Record<string, string> = {
    __obscura_Math_floor: "Math.floor", __obscura_Math_random: "Math.random",
    __obscura_Math_ceil: "Math.ceil", __obscura_Math_round: "Math.round",
    __obscura_Object_defineProperty: "Object.defineProperty",
    __obscura_Object_keys: "Object.keys",
    __obscura_Array_prototype_slice: "Array.prototype.slice",
    __obscura_Array_prototype_forEach: "Array.prototype.forEach",
  };
  traverse(ast, {
    CallExpression(np: NodePath<t.CallExpression>) {
      const callee = np.node.callee;
      if (!t.isIdentifier(callee)) return;
      const mapped = legacyAliases[callee.name];
      if (!mapped) return;
      const parts = mapped.split(".");
      let repl: t.Expression = t.identifier(parts[0]!);
      for (let i = 1; i < parts.length; i++) repl = t.memberExpression(repl, t.identifier(parts[i]!));
      np.node.callee = repl;
    },
  });

  log("INFO", chalk.cyan, "Reordering program body...");
  reorderProgramBody(ast);

  log("INFO", chalk.cyan, "Generating clean output...");
  const output = generate(ast, { retainLines: false, compact: false, concise: false, comments: true }, code);
  return output.code.replace(/\n{3,}/g, "\n\n");
}

async function main() {
  printBanner();

  const inputRaw = await ask(
    chalk.bold.yellow("  ┌─ ") +
    chalk.bold.white("Nhập đường dẫn file cần deobf") +
    chalk.bold.yellow(" ─► ") +
    chalk.bold.cyan("")
  );

  const inputFile = inputRaw.replace(/^["']|["']$/g, "");
  if (!inputFile) { log("ERR", chalk.red, "Bạn chưa nhập đường dẫn file!"); process.exit(1); }

  const resolvedInput = path.resolve(inputFile);
  if (!fs.existsSync(resolvedInput)) {
    log("ERR", chalk.red, `File không tồn tại: ${resolvedInput}`);
    process.exit(1);
  }

  const ext = path.extname(resolvedInput);
  const base = path.basename(resolvedInput, ext);
  const dir = path.dirname(resolvedInput);
  const outputFile = path.join(dir, `${base}.deobf${ext || ".js"}`);

  log("INFO", chalk.blue, `Đọc file: ${resolvedInput}`);
  const code = fs.readFileSync(resolvedInput, "utf-8");

  console.log();
  log("WORK", chalk.magenta, "Bắt đầu deobfuscate...");
  console.log(chalk.hex("#888888")("  " + "─".repeat(52)));

  let result: string;
  try {
    result = deobfuscate(code);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERR", chalk.red, `Lỗi trong quá trình deobf: ${msg}`);
    process.exit(1);
  }

  console.log(chalk.hex("#888888")("  " + "─".repeat(52)));
  console.log();

  fs.writeFileSync(outputFile, result, "utf-8");

  log("DONE", chalk.green, `Deobfuscate thành công!`);
  log("OUT ", chalk.green, `File output: ${outputFile}`);
  log("STAT", chalk.yellow,
    `${code.length} bytes → ${result.length} bytes (${(
      ((code.length - result.length) / code.length) * 100
    ).toFixed(1)}% nhỏ hơn)`
  );
  console.log();
  console.log(gradient("  ════════════════════════════════════════════════"));
  console.log("  " + chalk.bold.white("KTN Deobfuscator") + chalk.hex("#888888")(" — hoàn tất."));
  console.log(gradient("  ════════════════════════════════════════════════"));
  console.log();
}

main().catch(e => { console.error(chalk.red("Lỗi nghiêm trọng:"), e); process.exit(1); });
