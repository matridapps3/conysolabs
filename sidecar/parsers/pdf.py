from __future__ import annotations
import pdfplumber


def parse(stream) -> dict:
    pages = []
    with pdfplumber.open(stream) as pdf:
        for i, page in enumerate(pdf.pages):
            tables = page.extract_tables() or []
            pages.append({
                "page": i + 1,
                "text": page.extract_text() or "",
                "tables": [
                    {"header": t[0] if t else [], "rows": t[1:] if len(t) > 1 else []}
                    for t in tables
                ],
            })
    return {"kind": "pdf", "n_pages": len(pages), "pages": pages}
