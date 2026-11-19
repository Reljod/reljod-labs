"""Check digits. Meridian formats are defined in fixtures/loupe/README.md."""
from __future__ import annotations

import re


def _clean(s: str) -> str:
    return re.sub(r"[\s\-.]", "", s or "").upper()


def iban_ok(s: str) -> bool:
    """ISO 13616 mod-97 for any IBAN. A Meridian IBAN is MR + 2 check digits + 4-letter bank code + 12-digit account."""
    c = _clean(s)
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{10,30}", c):
        return False
    if c.startswith("MR") and not re.fullmatch(r"MR\d{2}[A-Z]{4}\d{12}", c):
        return False
    moved = c[4:] + c[:4]
    return int("".join(str(int(ch, 36)) for ch in moved)) % 97 == 1


def iban_check_digits(bank: str, account: str, country: str = "MR") -> str:
    moved = (bank + account + country + "00").upper()
    return f"{98 - int(''.join(str(int(ch, 36)) for ch in moved)) % 97:02d}"


def luhn_digit(digits: str) -> int:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - total % 10) % 10


def tax_id_ok(s: str) -> bool:
    """Meridian Tax ID: nine digits printed NNN-NNN-NNC; C is the Luhn digit of the first eight."""
    c = _clean(s)
    return bool(re.fullmatch(r"\d{9}", c)) and luhn_digit(c[:8]) == int(c[8])


def icao_digit(s: str) -> int:
    """ICAO 9303 check digit: weights 7, 3, 1 over digits, A-Z = 10-35, '<' = 0."""
    total = 0
    for i, ch in enumerate(s.upper()):
        v = 0 if ch == "<" else int(ch, 36)
        total += v * (7, 3, 1)[i % 3]
    return total % 10


def national_id_ok(s: str) -> bool:
    """Meridian National ID / document number: MRD + 7 digits + C; C is the ICAO 7-3-1 digit of the 7 digits."""
    c = _clean(s)
    return bool(re.fullmatch(r"MRD\d{8}", c)) and icao_digit(c[3:10]) == int(c[10])


def mrz_ok(field: str, check: str) -> bool:
    """True when `check` is the ICAO 9303 check digit of an MRZ field."""
    return check.isdigit() and icao_digit(field) == int(check)
