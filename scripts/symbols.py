#!/usr/bin/env python3
"""
scripts/symbols.py
Extracts top-level and class-level symbol signatures and docstrings using Python's standard ast module.
Output is printed as JSON.
"""

import ast
import json
import os
import sys

def extract_symbols(filepath):
    if not os.path.exists(filepath):
        return {"error": f"File not found: {filepath}"}

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            source = f.read()
        tree = ast.parse(source, filename=filepath)
    except Exception as e:
        return {"error": f"Failed to parse {filepath}: {str(e)}"}

    symbols = []

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = [a.arg for a in node.args.args]
            doc = ast.get_docstring(node) or ""
            symbols.append({
                "name": node.name,
                "type": "function",
                "line": node.lineno,
                "signature": f"def {node.name}({', '.join(args)})",
                "docstring": doc.strip().split("\n")[0] if doc else ""
            })
        elif isinstance(node, ast.ClassDef):
            methods = []
            class_doc = ast.get_docstring(node) or ""
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    args = [a.arg for a in item.args.args]
                    doc = ast.get_docstring(item) or ""
                    methods.append({
                        "name": item.name,
                        "line": item.lineno,
                        "signature": f"def {item.name}({', '.join(args)})",
                        "docstring": doc.strip().split("\n")[0] if doc else ""
                    })
            symbols.append({
                "name": node.name,
                "type": "class",
                "line": node.lineno,
                "docstring": class_doc.strip().split("\n")[0] if class_doc else "",
                "methods": methods
            })

    return {"file": filepath, "symbols": symbols}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: symbols.py <path-to-python-file>"}))
        sys.exit(1)

    result = extract_symbols(sys.argv[1])
    print(json.dumps(result, indent=2))
