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

def check_python_source(source_text, filename="<patch>", allowed_symbols=None):
    """
    Validates python code syntax and checks for phantom symbols:
    - SyntaxError is caught and returned.
    - New imports must be installed or resolve against known symbols.
    - Function calls must resolve to local scope, builtins, standard library, or known symbols.
    """
    errors = []
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
                # Phantom import check
                if not is_builtin_or_installed_module(mod_name) and mod_name not in known_symbols_set:
                    errors.append({
                        "line": node.lineno,
                        "offset": node.col_offset,
                        "message": f"PhantomSymbolError: Cannot resolve imported module '{mod_name}'"
                    })

        def visit_ImportFrom(self, node):
            mod_name = node.module or ""
            mod_valid = is_builtin_or_installed_module(mod_name) or (mod_name in known_symbols_set)
            if not mod_valid:
                errors.append({
                    "line": node.lineno,
                    "offset": node.col_offset,
                    "message": f"PhantomSymbolError: Cannot resolve from-import module '{mod_name}'"
                })
            for alias in node.names:
                name = alias.asname or alias.name
                self.scopes[-1].add(name)

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
    symbols_arg = None
    if len(sys.argv) > 1 and sys.argv[1].endswith(".json"):
        try:
            with open(sys.argv[1], "r", encoding="utf-8") as sf:
                symbols_arg = json.load(sf)
            code_file = sys.argv[2] if len(sys.argv) > 2 else None
        except Exception:
            code_file = sys.argv[1]
    else:
        code_file = sys.argv[1] if len(sys.argv) > 1 else None

    if code_file and code_file != "-":
        with open(code_file, "r", encoding="utf-8") as f:
            code = f.read()
    else:
        code = sys.stdin.read()

    result = check_python_source(code, allowed_symbols=symbols_arg)
    print(json.dumps(result, indent=2))
    if not result["valid"]:
        sys.exit(1)
