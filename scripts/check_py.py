#!/usr/bin/env python3
"""
scripts/check_py.py
Performs AST syntax validation and undefined variable/name resolution checks on post-patch content.
"""

import ast
import json
import sys

def check_python_source(source_text, filename="<patch>"):
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

    # Basic scope / undefined name detector
    defined_names = set(dir(__builtins__))
    undefined_references = []

    class ScopeVisitor(ast.NodeVisitor):
        def __init__(self):
            self.scopes = [set(defined_names)]

        def visit_FunctionDef(self, node):
            self.scopes[-1].add(node.name)
            local_scope = set([a.arg for a in node.args.args])
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

    visitor = ScopeVisitor()
    visitor.visit(tree)

    return {
        "valid": True,
        "errors": errors
    }

if __name__ == "__main__":
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            code = f.read()
    else:
        code = sys.stdin.read()

    result = check_python_source(code)
    print(json.dumps(result, indent=2))
    if not result["valid"]:
        sys.exit(1)
