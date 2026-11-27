#!/usr/bin/env python3
"""Generate staff and stage-link QR codes for patient journey pages."""
from pathlib import Path
import segno

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://josenni-rgb.github.io"

PAGES = {
    "wisdom-teeth": [
        ("", "qr"),
        ("after-consult", "qr/after-consult"),
        ("before", "qr/before"),
        ("surgery", "qr/surgery"),
        ("recovery", "qr/recovery"),
    ],
    "implants": [
        ("", "qr"),
        ("after-consult", "qr/after-consult"),
        ("before", "qr/before"),
        ("surgery", "qr/surgery"),
        ("healing", "qr/healing"),
        ("restore", "qr/restore"),
    ],
    "lesions": [
        ("", "qr"),
        ("after-consult", "qr/after-consult"),
        ("procedure", "qr/procedure"),
        ("recovery", "qr/recovery"),
        ("results", "qr/results"),
    ],
    "journeys": [
        ("", "qr"),
    ],
}


def save(url: str, dest_stem: Path) -> None:
    dest_stem.parent.mkdir(parents=True, exist_ok=True)
    qr = segno.make(url, error="h")
    qr.save(str(dest_stem.with_suffix(".svg")), scale=10, dark="#2c3844", light="#fff")
    qr.save(str(dest_stem.with_suffix(".png")), scale=10, dark="#2c3844", light="#fff")
    print(f"{dest_stem.with_suffix('.png').relative_to(ROOT)}  {url}")


EXTRA = [
    (f"{BASE}/jaw-surgery-journey/fluids/", ROOT / "jaw-surgery-journey" / "qr" / "fluids"),
]


def main() -> None:
    for folder, items in PAGES.items():
        for stage, stem in items:
            url = f"{BASE}/{folder}/"
            if stage:
                url += f"?stage={stage}"
            save(url, ROOT / folder / stem)
    for url, dest in EXTRA:
        save(url, dest)


if __name__ == "__main__":
    main()

