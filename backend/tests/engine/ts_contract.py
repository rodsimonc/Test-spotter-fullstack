"""Checks plain JSON against the shapes declared in frontend/src/api/types.ts.

The TypeScript file is read at test time, so the plan builder cannot drift from the types the
React app compiles against. The reader understands only what that file uses: `export type`
aliases of string literals, `export interface` blocks (with `extends` and optional members),
arrays, tuples, unions, `Partial`, `Exclude` and `Record`. Anything else raises, so a new
construct fails loudly instead of slipping past the check.

An object may not carry keys the type does not declare. The frontend would ignore them, but an
extra key usually means one side was renamed.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

TYPES_FILE = Path(__file__).resolve().parents[3] / "frontend" / "src" / "api" / "types.ts"

_TOKEN = re.compile(r"\s*(?:'([^']*)'|\"([^\"]*)\"|([A-Za-z_][A-Za-z0-9_]*)|(\S))")
_PRIMITIVES = ("string", "number", "boolean")

Node = tuple[Any, ...]
Members = dict[str, tuple[bool, Node]]


def _tokens(text: str) -> list[tuple[str, str]]:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"//[^\n]*", "", text)
    text = text.split("export const")[0]  # values below the declarations are not types
    out = []
    for match in _TOKEN.finditer(text):
        single, double, word, symbol = match.groups()
        if single is not None or double is not None:
            out.append(("lit", single if single is not None else double))
        elif word is not None:
            out.append(("word", word))
        else:
            out.append(("sym", symbol))
    return out


class _Parser:
    def __init__(self, text: str) -> None:
        self.tokens = _tokens(text)
        self.i = 0

    def _peek(self, ahead: int = 0) -> tuple[str, str]:
        index = self.i + ahead
        return self.tokens[index] if index < len(self.tokens) else ("end", "")

    def _next(self) -> tuple[str, str]:
        token = self._peek()
        self.i += 1
        return token

    def _accept(self, kind: str, value: str) -> bool:
        if self._peek() == (kind, value):
            self.i += 1
            return True
        return False

    def _expect(self, kind: str, value: str | None = None) -> str:
        token = self._next()
        if token[0] != kind or (value is not None and token[1] != value):
            raise ValueError(f"types.ts: expected {value or kind}, found {token[1]!r} (token {self.i})")
        return token[1]

    def declarations(self) -> dict[str, Node]:
        found: dict[str, Node] = {}
        while self._peek()[0] != "end":
            self._expect("word", "export")
            keyword = self._expect("word")
            name = self._expect("word")
            if keyword == "type":
                self._expect("sym", "=")
                found[name] = self._type()
            elif keyword == "interface":
                base = self._expect("word") if self._accept("word", "extends") else None
                found[name] = ("object", self._members(), base)
            else:
                raise ValueError(f"types.ts: cannot read `export {keyword}`")
        return found

    def _members(self) -> Members:
        members: Members = {}
        self._expect("sym", "{")
        while not self._accept("sym", "}"):
            name = self._expect("word")
            optional = self._accept("sym", "?")
            self._expect("sym", ":")
            members[name] = (optional, self._type())
            if not self._accept("sym", ";"):
                self._accept("sym", ",")  # the last member may have no separator at all
        return members

    def _type(self) -> Node:
        self._accept("sym", "|")  # a leading bar is allowed
        options = [self._postfix()]
        while self._accept("sym", "|"):
            options.append(self._postfix())
        return options[0] if len(options) == 1 else ("union", options)

    def _postfix(self) -> Node:
        node = self._primary()
        while self._peek() == ("sym", "[") and self._peek(1) == ("sym", "]"):
            self.i += 2
            node = ("array", node)
        return node

    def _primary(self) -> Node:
        kind, value = self._next()
        if kind == "lit":
            return ("lit", value)
        if kind == "word":
            if self._accept("sym", "<"):
                args = [self._type()]
                while self._accept("sym", ","):
                    args.append(self._type())
                self._expect("sym", ">")
                return ("generic", value, args)
            return ("ref", value)
        if (kind, value) == ("sym", "["):
            items = [self._type()]
            while self._accept("sym", ","):
                items.append(self._type())
            self._expect("sym", "]")
            return ("tuple", items)
        if (kind, value) == ("sym", "{"):
            self.i -= 1
            return ("object", self._members(), None)
        raise ValueError(f"types.ts: cannot read a type starting at {value!r} (token {self.i})")


class Contract:
    """The declarations of a types.ts file and a checker for values against them."""

    def __init__(self, declarations: dict[str, Node]) -> None:
        self.declarations = declarations

    @classmethod
    def from_text(cls, text: str) -> Contract:
        return cls(_Parser(text).declarations())

    @classmethod
    def from_file(cls, path: Path = TYPES_FILE) -> Contract:
        return cls.from_text(path.read_text(encoding="utf-8"))

    def fields(self, name: str) -> list[str]:
        """Member names of an interface, base interface first."""
        return list(self._members(("ref", name)))

    def check(self, value: Any, name: str) -> list[str]:
        """Problems found, as readable strings. An empty list means the value fits."""
        return self._check(value, ("ref", name), "$")

    # -- internals --

    def _members(self, node: Node) -> Members:
        if node[0] == "ref":
            node = self._declared(node[1])
        if node[0] != "object":
            raise ValueError(f"{node[0]} has no members")
        base = self._members(("ref", node[2])) if node[2] else {}
        return {**base, **node[1]}

    def _declared(self, name: str) -> Node:
        if name not in self.declarations:
            raise ValueError(f"types.ts does not declare {name}")
        return self.declarations[name]

    def _literals(self, node: Node) -> set[str]:
        if node[0] == "lit":
            return {node[1]}
        if node[0] == "union":
            return set().union(*(self._literals(option) for option in node[1]))
        if node[0] == "ref" and node[1] in self.declarations:
            return self._literals(self.declarations[node[1]])
        raise ValueError(f"{node} is not a set of string literals")

    def _check(self, value: Any, node: Node, path: str) -> list[str]:
        kind = node[0]
        if kind == "lit":
            return (
                [] if value == node[1] and isinstance(value, str) else [f"{path}: expected '{node[1]}', got {value!r}"]
            )
        if kind == "ref":
            return self._check_ref(value, node[1], path)
        if kind == "array":
            if not isinstance(value, list):
                return [f"{path}: expected a list, got {type(value).__name__}"]
            return [p for i, item in enumerate(value) for p in self._check(item, node[1], f"{path}[{i}]")]
        if kind == "tuple":
            if not isinstance(value, list) or len(value) != len(node[1]):
                return [f"{path}: expected a list of {len(node[1])}, got {value!r}"]
            return [
                p
                for i, (item, part) in enumerate(zip(value, node[1], strict=True))
                for p in self._check(item, part, f"{path}[{i}]")
            ]
        if kind == "union":
            attempts = [self._check(value, option, path) for option in node[1]]
            if any(not problems for problems in attempts):
                return []
            return [f"{path}: {value!r} fits none of the union's options"]
        if kind == "object":
            return self._check_object(value, self._members(node), path)
        if kind == "generic":
            return self._check_generic(value, node[1], node[2], path)
        raise ValueError(f"cannot check a {kind} type")

    def _check_ref(self, value: Any, name: str, path: str) -> list[str]:
        if name == "string":
            return [] if isinstance(value, str) else [f"{path}: expected a string, got {value!r}"]
        if name == "number":
            ok = isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
            return [] if ok else [f"{path}: expected a finite number, got {value!r}"]
        if name == "boolean":
            return [] if isinstance(value, bool) else [f"{path}: expected a boolean, got {value!r}"]
        return self._check(value, self._declared(name), path)

    def _check_object(self, value: Any, members: Members, path: str) -> list[str]:
        if not isinstance(value, dict):
            return [f"{path}: expected an object, got {type(value).__name__}"]
        problems = []
        for key, (optional, node) in members.items():
            if key not in value:
                if not optional:
                    problems.append(f"{path}.{key}: missing")
                continue
            problems += self._check(value[key], node, f"{path}.{key}")
        problems += [f"{path}.{key}: not declared in types.ts" for key in value if key not in members]
        return problems

    def _check_generic(self, value: Any, name: str, args: list[Node], path: str) -> list[str]:
        if name == "Partial":
            members = {key: (True, node) for key, (_, node) in self._members(args[0]).items()}
            return self._check_object(value, members, path)
        if name == "Exclude":
            allowed = self._literals(args[0]) - self._literals(args[1])
            return (
                []
                if isinstance(value, str) and value in allowed
                else [f"{path}: {value!r} is not one of {sorted(allowed)}"]
            )
        if name == "Record":
            if not isinstance(value, dict):
                return [f"{path}: expected an object, got {type(value).__name__}"]
            problems = []
            for key, item in value.items():
                problems += self._check(key, args[0], f"{path}.<key {key!r}>")
                problems += self._check(item, args[1], f"{path}.{key}")
            return problems
        raise ValueError(f"types.ts: cannot check the generic type {name}")


def load() -> Contract:
    return Contract.from_file()
