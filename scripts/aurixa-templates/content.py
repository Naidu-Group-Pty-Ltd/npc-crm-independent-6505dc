"""Content resolution for template builders.

A master template has two jobs that pull in opposite directions: it must ship
with binding tokens so the platform can inject into it, and it must be
reviewable by a designer, who cannot judge a layout from a page of
``{{property.address}}``.

``Fill`` resolves both from one builder. In ``tokens`` mode every value is the
binding path the generator will replace; in ``sample`` mode it is a realistic
value. The same builder therefore produces the shipped master and the sample
preview used for design review, admin content-injection testing and library
thumbnails — so a layout can never pass review in one mode and break in the
other.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from theme import token  # noqa: E402


class Fill:
    """Resolve a binding to its token or to a sample value."""

    def __init__(self, sample: bool = False) -> None:
        self.sample = sample

    def __call__(self, path: str, sample_value=None) -> str:
        if self.sample and sample_value is not None:
            return str(sample_value)
        return token(path)

    def text(self, path: str, sample_paragraphs: list[str]) -> list[str]:
        """A prose block. In tokens mode the whole block is one binding, because
        injected narrative arrives as a unit and must be free to be one
        paragraph or ten."""
        if self.sample:
            return sample_paragraphs
        return [token(path)]

    def rows(self, path: str, sample_rows: list[list[str]],
             token_row: list[str], count: int = 3) -> list[list[str]]:
        """A repeating table body. In tokens mode the generator emits ``count``
        specimen rows so a reviewer can see the banding, the header repeat and
        the totals behaviour before any data exists."""
        if self.sample:
            return sample_rows
        return [list(token_row) for _ in range(count)]

    def items(self, path: str, sample_items: list[str], count: int = 3) -> list[str]:
        if self.sample:
            return sample_items
        return [token(f"{path}[{i}]") for i in range(count)]

    def tuples(self, path: str, sample_tuples: list[tuple], token_tuple: tuple,
               count: int = 3) -> list[tuple]:
        if self.sample:
            return sample_tuples
        return [tuple(token_tuple) for _ in range(count)]


TOKENS = Fill(sample=False)
SAMPLE = Fill(sample=True)
