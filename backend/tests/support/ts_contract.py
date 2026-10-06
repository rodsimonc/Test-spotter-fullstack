"""Check JSON against the TypeScript contract in `frontend/src/api/types.ts`.

The interfaces and type aliases are read straight from that file, so a field renamed or retyped
on either side fails a test here instead of failing in someone's browser.

It understands only the shapes `types.ts` uses: primitives, string literals, unions, arrays,
tuples, inline objects, references, `Partial<T>`, `Exclude<A, B>` and `Record<string, T>`.
Anything else raises, so the parser can't quietly stop checking something.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

TYPES_FILE = Path(__file__).resolve().parents[3] / "frontend" / "src" / "api" / "types.ts"

Node = tuple[Any, ...]

_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_LINE_COMMENT = re.compile(r"//[^\n]*")
_INTERFACE = re.compile(r"^export interface (\w+)(?:\s+extends\s+(\w+))?\s*\{(.*?)^\}", re.S | re.M)
_ALIAS = re.compile(r"^export type (\w+)\s*=\s*(.*?)(?=^export\s|\Z)", re.S | re.M)
_TOKEN = re.compile(r"\s*(?:('(?:[^'\\]|\\.)*')|([A-Za-z_]\w*)|(\S))")
_PRIMITIVES = {"string", "number", "boolean"}


def _tokens(text: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    position = 0
    while position < len(text):
        match = _TOKEN.match(text, position)
        if not match:
            break
        position = match.end()
        if match.group(1) is not None:
            found.append(("lit", match.group(1)[1:-1]))
        elif match.group(2):
            found.append(("name", match.group(2)))
        else:
            found.append(("sym", match.group(3)))
    return found


class _TypeParser:
    def __init__(self, text: str) -> None:
        self.text = text
        self.tokens = _tokens(text)
        self.index = 0

    def parse(self) -> Node:
        node = self._union()
        if self.index != len(self.tokens):
            raise ValueError(f"Can't read the type {self.text!r}")
        return node

    def _peek(self, offset: int = 0) -> tuple[str, str] | None:
        at = self.index + offset
        return self.tokens[at] if at < len(self.tokens) else None

    def _accept(self, symbol: str) -> bool:
        if self._peek() == ("sym", symbol):
            self.index += 1
            return True
        return False

    def _expect(self, symbol: str) -> None:
        if not self._accept(symbol):
            raise ValueError(f"Expected {symbol!r} in the type {self.text!r}")

    def _union(self) -> Node:
        self._accept("|")  # a leading pipe is allowed on multi-line unions
        parts = [self._postfix()]
        while self._accept("|"):
            parts.append(self._postfix())
        return parts[0] if len(parts) == 1 else ("union", parts)

    def _postfix(self) -> Node:
        node = self._primary()
        while self._peek() == ("sym", "[") and self._peek(1) == ("sym", "]"):
            self.index += 2
            node = ("array", node)
        return node

    def _primary(self) -> Node:
        token = self._peek()
        if token is None:
            raise ValueError(f"The type {self.text!r} ends too soon")
        self.index += 1
        kind, text = token
        if kind == "lit":
            return ("lit", text)
        if kind == "name":
            if self._accept("<"):
                args = [self._union()]
                while self._accept(","):
                    args.append(self._union())
                self._expect(">")
                return ("generic", text, args)
            if text == "null":
                return ("null",)
            return ("prim", text) if text in _PRIMITIVES else ("ref", text)
        if token == ("sym", "["):
            items = [self._union()]
            while self._accept(","):
                items.append(self._union())
            self._expect("]")
            return ("tuple", items)
        if token == ("sym", "{"):
            return ("object", self._members())
        raise ValueError(f"Unexpected {text!r} in the type {self.text!r}")

    def _members(self) -> dict[str, Field]:
        """Read `key?: type` members up to the closing brace. Newlines, `;` or `,` separate them."""
        members: dict[str, Field] = {}
        while not self._accept("}"):
            token = self._peek()
            if token is None or token[0] != "name":
                raise ValueError(f"Expected a field name in the type {self.text!r}")
            self.index += 1
            optional = self._accept("?")
            self._expect(":")
            members[token[1]] = Field(optional, self._union())
            if not self._accept(";"):
                self._accept(",")
        return members


@dataclass(frozen=True)
class Field:
    optional: bool
    node: Node


class Contract:
    def __init__(self, source: str) -> None:
        text = _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", source))
        self._parents: dict[str, str | None] = {}
        self._own_fields: dict[str, dict[str, Field]] = {}
        self._aliases: dict[str, Node] = {}
        for name, parent, body in _INTERFACE.findall(text):
            self._parents[name] = parent or None
            members = _TypeParser("{" + body + "}").parse()
            self._own_fields[name] = members[1]
        for name, body in _ALIAS.findall(text):
            self._aliases[name] = _TypeParser(body.strip().rstrip(";")).parse()

    @property
    def names(self) -> set[str]:
        return set(self._own_fields) | set(self._aliases)

    def fields_of(self, name: str) -> dict[str, Field]:
        if name not in self._own_fields:
            raise KeyError(f"types.ts has no interface called {name}")
        parent = self._parents[name]
        inherited = self.fields_of(parent) if parent else {}
        return {**inherited, **self._own_fields[name]}

    # Checking ---------------------------------------------------------------------------

    def problems(self, value: Any, type_name: str) -> list[str]:
        found: list[str] = []
        self._check(("ref", type_name), value, type_name.lower(), found)
        return found

    def assert_matches(self, value: Any, type_name: str) -> None:
        found = self.problems(value, type_name)
        if found:
            shown = "\n  ".join(found[:25])
            more = f"\n  ... and {len(found) - 25} more" if len(found) > 25 else ""
            raise AssertionError(f"The JSON doesn't match {type_name} in types.ts:\n  {shown}{more}")

    def _check(self, node: Node, value: Any, path: str, out: list[str]) -> None:
        kind = node[0]
        if kind == "prim":
            self._check_primitive(node[1], value, path, out)
        elif kind == "lit":
            if value != node[1]:
                out.append(f"{path}: expected {node[1]!r}, got {value!r}")
        elif kind == "null":
            if value is not None:
                out.append(f"{path}: expected null, got {_describe(value)}")
        elif kind == "ref":
            self._check_reference(node[1], value, path, out)
        elif kind == "array":
            if not isinstance(value, list):
                out.append(f"{path}: expected an array, got {_describe(value)}")
                return
            for index, item in enumerate(value):
                self._check(node[1], item, f"{path}[{index}]", out)
        elif kind == "tuple":
            self._check_tuple(node[1], value, path, out)
        elif kind == "union":
            self._check_union(node[1], value, path, out)
        elif kind == "object":
            self._check_members("an inline object", node[1], value, path, out)
        elif kind == "generic":
            self._check_generic(node[1], node[2], value, path, out)
        else:  # pragma: no cover - the parser only builds the kinds above
            raise NotImplementedError(kind)

    @staticmethod
    def _check_primitive(name: str, value: Any, path: str, out: list[str]) -> None:
        if name == "string":
            ok = isinstance(value, str)
        elif name == "boolean":
            ok = isinstance(value, bool)
        else:
            ok = isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
        if not ok:
            out.append(f"{path}: expected {name}, got {_describe(value)}")

    def _check_reference(self, name: str, value: Any, path: str, out: list[str]) -> None:
        if name in self._aliases:
            self._check(self._aliases[name], value, path, out)
            return
        self._check_members(name, self.fields_of(name), value, path, out)

    def _check_members(self, name: str, fields: dict[str, Field], value: Any, path: str, out: list[str]) -> None:
        if not isinstance(value, dict):
            out.append(f"{path}: expected an object ({name}), got {_describe(value)}")
            return
        for key in value.keys() - fields.keys():
            out.append(f"{path}.{key}: not in {name}")
        for key, field in fields.items():
            if key not in value:
                if not field.optional:
                    out.append(f"{path}.{key}: missing")
                continue
            self._check(field.node, value[key], f"{path}.{key}", out)

    def _check_tuple(self, items: list[Node], value: Any, path: str, out: list[str]) -> None:
        if not isinstance(value, list) or len(value) != len(items):
            out.append(f"{path}: expected a {len(items)}-item array, got {_describe(value)}")
            return
        for index, (item_node, item) in enumerate(zip(items, value, strict=True)):
            self._check(item_node, item, f"{path}[{index}]", out)

    def _check_union(self, options: list[Node], value: Any, path: str, out: list[str]) -> None:
        for option in options:
            attempt: list[str] = []
            self._check(option, value, path, attempt)
            if not attempt:
                return
        out.append(f"{path}: {_describe(value)} matches none of the allowed types")

    def _check_generic(self, name: str, args: list[Node], value: Any, path: str, out: list[str]) -> None:
        if name == "Partial":
            target = args[0][1]
            fields = self.fields_of(target)
            if not isinstance(value, dict):
                out.append(f"{path}: expected an object, got {_describe(value)}")
                return
            for key, item in value.items():
                if key not in fields:
                    out.append(f"{path}.{key}: not in {target}")
                else:
                    self._check(fields[key].node, item, f"{path}.{key}", out)
        elif name == "Exclude":
            allowed = self._literals(args[0]) - self._literals(args[1])
            if not isinstance(value, str) or value not in allowed:
                out.append(f"{path}: expected one of {sorted(allowed)}, got {value!r}")
        elif name == "Record":
            if not isinstance(value, dict):
                out.append(f"{path}: expected an object, got {_describe(value)}")
                return
            for key, item in value.items():
                self._check(args[1], item, f"{path}.{key}", out)
        else:
            raise NotImplementedError(f"types.ts uses {name}<...>, which the contract checker can't read")

    def _literals(self, node: Node) -> set[str]:
        if node[0] == "lit":
            return {node[1]}
        if node[0] == "union":
            return set().union(*(self._literals(part) for part in node[1]))
        if node[0] == "ref" and node[1] in self._aliases:
            return self._literals(self._aliases[node[1]])
        raise NotImplementedError(f"Not a set of string literals: {node!r}")


def _describe(value: Any) -> str:
    if isinstance(value, dict):
        return "an object"
    if isinstance(value, list):
        return f"an array of {len(value)}"
    return repr(value) if not isinstance(value, str) or len(value) < 40 else repr(value[:37] + "...")


@cache
def load() -> Contract:
    if not TYPES_FILE.exists():
        raise FileNotFoundError(f"The contract file is missing: {TYPES_FILE}")
    return Contract(TYPES_FILE.read_text(encoding="utf-8"))
