"""Remove duplicate papers from the classification Excel (keep first row per paper id)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
EXCEL = ROOT / "classification" / "Copy of Classified_DataSheet.xlsx"
SHEET = "Classified"
ID_COL = "MongoDB_ID"


def main() -> None:
    xl = pd.ExcelFile(EXCEL)
    sheets = {name: xl.parse(name) for name in xl.sheet_names}
    df = sheets[SHEET]
    before = len(df)
    deduped = df.drop_duplicates(subset=[ID_COL], keep="first")
    removed = before - len(deduped)
    sheets[SHEET] = deduped

    with pd.ExcelWriter(EXCEL, engine="openpyxl") as writer:
        for name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=name, index=False)

    print(f"{EXCEL.name} | sheet '{SHEET}'")
    print(f"  before: {before:,} rows")
    print(f"  after:  {len(deduped):,} rows")
    print(f"  removed {removed:,} duplicate rows")


if __name__ == "__main__":
    main()
