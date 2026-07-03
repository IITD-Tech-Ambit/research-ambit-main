# Knowledge Graph (Research Ambit)

Offline batch pipeline + pre-generated JSON graphs served by `/api/kg/*`.

## Layout

```
research-ambit-main/
├── data/knowledge-graph/          # Generated graph store (gitignored in prod)
│   ├── explore_index.json
│   └── graphs/
│       ├── index.json
│       └── <facultyId>.json
├── knowledge-graph/
│   ├── pipeline/build_kg.py       # Build graphs from Excel + MongoDB
│   ├── classification/            # Classifier + Excel source data
│   │   ├── paper_classifier.py
│   │   ├── keyword_extractor.py
│   │   └── classified_all_69k.xlsx
│   └── requirements.txt
└── src/
    ├── controllers/kgController.js
    └── routes/kg.js               # mounted at /api/kg
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kg/health` | Graph data readiness |
| GET | `/api/kg/faculty` | Faculty index for search dropdown |
| GET | `/api/kg/faculty/:id/knowledge-graph` | Per-faculty graph JSON |
| GET | `/api/kg/explore/terms?q=&limit=` | Topic/theme/sub-domain search |
| GET | `/api/kg/explore/detail?key=` | Departments + professors for a term |

## Rebuild graphs

```powershell
cd research-ambit-main
python -m venv .venv-kg
.venv-kg\Scripts\pip install -r knowledge-graph\requirements.txt
.venv-kg\Scripts\python.exe -u knowledge-graph\pipeline\build_kg.py
```

Uses `MONGO_URI` from `.env` (read-only). Classification source:

`knowledge-graph/classification/Copy of Classified_DataSheet.xlsx` (~67,525 rows, Domain column included).

Output is written to `data/knowledge-graph/`.

## Reclassify papers (optional)

```powershell
cd knowledge-graph\classification
python paper_classifier.py --limit 0 --output classified_all_69k.xlsx
```

Then re-run `build_kg.py`.
