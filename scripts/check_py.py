#!/usr/bin/env python3
"""
scripts/check_py.py
Performs AST syntax validation, undefined variable/name resolution checks,
and phantom-symbol detection (checking new imports and external calls against a provided symbol index or environment).
"""

import ast
import json
import sys
import importlib.util

def is_builtin_or_installed_module(module_name):
    base_mod = module_name.split('.')[0]
    if base_mod in sys.builtin_module_names:
        return True
    try:
        spec = importlib.util.find_spec(base_mod)
        return spec is not None
    except Exception:
        return False

def collect_absolute_imports(source_text):
    """Absolute module names imported by a source file (relative imports excluded)."""
    try:
        tree = ast.parse(source_text)
    except SyntaxError:
        return set()
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module)
    return names


def check_python_source(source_text, filename="<patch>", allowed_symbols=None, baseline_text=None):
    """
    Validates python code syntax and checks for phantom symbols:
    - SyntaxError is caught and returned.
    - New imports must be installed or resolve against known symbols. When baseline_text
      (the file before the edit) is given, only imports the edit adds are checked, so a
      file is never rejected for imports it already had.
    - Relative imports (from .x import y) are package-local and are not resolved here.
    - Function calls must resolve to local scope, builtins, standard library, or known symbols.
    """
    errors = []
    preexisting_imports = collect_absolute_imports(baseline_text) if baseline_text is not None else set()
    try:
        tree = ast.parse(source_text, filename=filename)
    except SyntaxError as e:
        return {
            "valid": False,
            "errors": [{
                "line": e.lineno,
                "offset": e.offset,
                "message": f"SyntaxError: {e.msg}"
            }]
        }

    known_symbols_set = set(allowed_symbols) if allowed_symbols else set()
    builtin_names = set(dir(__builtins__))

    class PhantomVisitor(ast.NodeVisitor):
        def __init__(self):
            # Track scopes: each scope has a set of declared names
            self.scopes = [set(builtin_names)]
            self.imported_modules = set()

        def current_scope_names(self):
            all_names = set()
            for s in self.scopes:
                all_names.update(s)
            return all_names

        def visit_Import(self, node):
            for alias in node.names:
                mod_name = alias.name
                as_name = alias.asname or mod_name.split('.')[0]
                self.scopes[-1].add(as_name)
                self.imported_modules.add(mod_name)
                # Phantom import check (only for imports the edit introduces)
                if mod_name in preexisting_imports:
                    continue
                if not is_builtin_or_installed_module(mod_name) and mod_name not in known_symbols_set:
                    errors.append({
                        "line": node.lineno,
                        "offset": node.col_offset,
                        "message": f"PhantomSymbolError: Cannot resolve imported module '{mod_name}'"
                    })

        def visit_ImportFrom(self, node):
            mod_name = node.module or ""
            for alias in node.names:
                self.scopes[-1].add(alias.asname or alias.name)
            # Relative imports are resolved by the package itself; pre-existing imports are trusted.
            if node.level > 0 or mod_name in preexisting_imports:
                return
            mod_valid = is_builtin_or_installed_module(mod_name) or (mod_name in known_symbols_set)
            if not mod_valid:
                errors.append({
                    "line": node.lineno,
                    "offset": node.col_offset,
                    "message": f"PhantomSymbolError: Cannot resolve from-import module '{mod_name}'"
                })

        def visit_FunctionDef(self, node):
            self.scopes[-1].add(node.name)
            local_scope = set([a.arg for a in node.args.args])
            if node.args.vararg:
                local_scope.add(node.args.vararg.arg)
            if node.args.kwarg:
                local_scope.add(node.args.kwarg.arg)
            self.scopes.append(local_scope)
            self.generic_visit(node)
            self.scopes.pop()

        def visit_AsyncFunctionDef(self, node):
            self.visit_FunctionDef(node)

        def visit_ClassDef(self, node):
            self.scopes[-1].add(node.name)
            self.scopes.append(set())
            self.generic_visit(node)
            self.scopes.pop()

        def visit_Name(self, node):
            if isinstance(node.ctx, ast.Store):
                self.scopes[-1].add(node.id)

        def visit_Call(self, node):
            # Check phantom calls for top-level direct name calls
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
                in_scope = func_name in self.current_scope_names()
                if not in_scope and known_symbols_set and func_name not in known_symbols_set:
                    errors.append({
                        "line": node.lineno,
                        "offset": node.col_offset,
                        "message": f"PhantomSymbolError: Called symbol '{func_name}' is undefined and does not exist in symbol index"
                    })
            self.generic_visit(node)

    visitor = PhantomVisitor()
    visitor.visit(tree)

    return {
        "valid": len(errors) == 0,
        "errors": errors
    }

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Syntax and phantom-symbol check for Python source.")
    parser.add_argument("code_file", nargs="?", default="-", help="file to check, or - for stdin")
    parser.add_argument("--symbols", help="JSON file with a list of known symbol names")
    parser.add_argument("--baseline", help="the file before the edit; only imports the edit adds are checked")
    parser.add_argument("--json-stdin", action="store_true",
                        help='read {"source": ..., "baseline": ...} from stdin (nothing is written to disk)')
    args = parser.parse_args()

    symbols_arg = None
    if args.symbols:
        with open(args.symbols, "r", encoding="utf-8") as sf:
            symbols_arg = json.load(sf)

    baseline = None
    if args.json_stdin:
        payload = json.loads(sys.stdin.read())
        code = payload.get("source", "")
        baseline = payload.get("baseline")
    elif args.code_file != "-":
        with open(args.code_file, "r", encoding="utf-8") as f:
            code = f.read()
    else:
        code = sys.stdin.read()

    if args.baseline:
        with open(args.baseline, "r", encoding="utf-8") as bf:
            baseline = bf.read()

    result = check_python_source(code, allowed_symbols=symbols_arg, baseline_text=baseline)
    print(json.dumps(result, indent=2))
    if not result["valid"]:
        sys.exit(1)
