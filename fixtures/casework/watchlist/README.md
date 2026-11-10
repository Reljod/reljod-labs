# Synthetic watchlist

The `screen` Job checks every name in a case against these entries. Each scenario's author owns one file (`<scenario>.json`). Every entry is fictional: no real sanctioned person, politician or news subject.

```json
[
  {
    "id": "WL-SAN-0001",
    "name": "Full Name As Listed",
    "aliases": ["Other spelling"],
    "date_of_birth": "1961-04-02",
    "nationality": "Country",
    "list_type": "sanctions",
    "list_source": "Consolidated Sanctions List (synthetic)",
    "reason": "Why listed, or the public role for a PEP"
  }
]
```

`date_of_birth` may be a full date, a year (`"1961"`) or empty. `list_type` is `sanctions`, `pep` or `adverse_media`.
