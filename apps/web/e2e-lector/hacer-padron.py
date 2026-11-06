"""Scanned rolls of invented people for the reader's browser test.

    uv run --project <scanner> python hacer-padron.py <scanner> <folder>

Writes padron-de-prueba.pdf, four pages of a ruled table and a last page without one, and
sin-tabla.pdf, a letter the reader cannot take as a roll. Three rows of the roll always need a
look: the first person has a document of nine digits, the 21st an unknown status and the 41st
a digit in the name.
"""

import sys
from pathlib import Path

import numpy as np

PAGES = 4
ROWS_PER_PAGE = 15
BAD_DOCUMENT = "990012345"


def main(scanner: str, folder: str) -> None:
    sys.path.insert(0, str(Path(scanner).resolve() / "tests"))
    from fake_roll import PAGE_SIZE, draw_page, fake_rows, find_font, make_text_pdf, save_pdf

    font, accents = find_font()
    rows = fake_rows(PAGES * ROWS_PER_PAGE, seed=5, accents=accents)
    rows[0]["document"] = BAD_DOCUMENT
    rows[20]["status"] = "X"
    rows[40]["name"] = "Prueba 3, Ana"
    pages = [
        draw_page(rows[i * ROWS_PER_PAGE : (i + 1) * ROWS_PER_PAGE], angle=0.6 - 0.3 * i, seed=20 + i, font=font)
        for i in range(PAGES)
    ]
    pages.append(np.full((PAGE_SIZE[1], PAGE_SIZE[0]), 250, dtype=np.uint8))
    save_pdf(pages, Path(folder) / "padron-de-prueba.pdf")
    make_text_pdf(Path(folder) / "sin-tabla.pdf")


if __name__ == "__main__":
    main(*sys.argv[1:])
