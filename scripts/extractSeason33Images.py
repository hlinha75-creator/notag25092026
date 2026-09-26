"""Extract Season 33 ranking rows from the supplied Albion screenshots.

This is a one-off, review-oriented helper. It expects RapidOCR to be available
through PYTHONPATH and writes both the merged data and a conflict report.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from rapidocr_onnxruntime import RapidOCR


TEMP = Path(r"C:\Users\Lucas\AppData\Local\Temp")
ROOT = Path(__file__).resolve().parents[1]
CACHE = TEMP / "codex-notag-season33-ocr-cache"

CATEGORY_FILES = {
    "Guild Challenge": [
        "2e31b743-38f7-482d-bbde-538d15256e9e", "6dd35045-6efc-4541-84b1-e106afae0004",
        "631b1659-2919-4296-b1fb-1b7bd43ae44d", "984216e3-3fe9-4b17-a762-3fd6d9c6c985",
        "8b09729e-d708-4bcb-85cc-8c0e6bba636c", "cdb63488-aa13-4349-8e6b-a065ea3acc47",
        "2c178c8a-fa93-4ae6-a3cb-ff6f7dd40960", "a3d1376c-8e70-4d40-82a3-1e8decde2bbf",
        "18058003-153a-4aba-aac5-852507adcee1", "d4d6c5d2-ecd3-41ae-b833-55f22823b81b",
        "b73bf877-3bdd-41dc-8381-3ad392831107", "174b16e2-57c8-44d4-846a-349030b64546",
        "ae610e9e-3508-422c-9a80-cbb4649c5186", "e4fc0fba-5cc4-4318-bd43-5dc76f900953",
        "1a3c3eb3-750f-4e71-b9f5-e1caef054c74", "cfd5f643-6db7-46c9-999a-42f94e150fb5",
        "fbfc55eb-41cd-4e1a-b6cb-196de919933c",
    ],
    "PvE (Outlands and Roads)": [
        "e88aca2a-c82a-41a3-b22b-143232886341", "ff464c73-3e70-4550-89eb-01a7b86ba383",
        "c7a23e70-9469-41b3-8880-7d6cabd8d07f", "f055ad44-89cb-46fe-bf1b-c4aa798598a7",
        "6fbfd572-a148-487e-a0b1-a36d04833d39", "c0f5b3d7-2e23-4552-86aa-4251ae830977",
        "758489e8-97fc-451c-8735-b12c9729c5e9", "077e4c19-3e7f-4a9d-955d-1a0cfd7ee0fe",
        "d9924a59-ec44-4a9a-bae1-cf848d2b1263",
    ],
    "Keeper Uprising": [
        "de293a74-1e15-4ad6-9f14-244c9624d5f3", "85937f99-8276-4431-9f76-f5e707db281e",
        "4a96e851-8ed3-4370-93c3-c16dfab78140", "ac7c069d-8331-4eca-9442-a7490f48e43f",
        "0f38fbe9-9335-4dc7-96fb-0ef593d6aa2d", "67b5b98e-86a2-4d16-9675-87ee11796ba6",
        "88f61088-a863-4a5d-bb45-b30c4618a70e", "a21458f1-18b3-4cf7-9f69-f2cf8aeee04b",
    ],
    "Gathering (Outlands and Roads)": [
        "0c4f5086-e478-4a25-a839-54a8b60330c3", "bcec1b53-b672-4f70-b6d0-f3d570441201",
        "87778175-f7cf-46cc-bd64-f2a43a486c62", "b6f466e9-347d-4577-aaa4-72a1571fb9b4",
        "fd33c3c6-e8e2-4e95-bdb2-1bc6b6337aac", "000f7ea0-fe32-47a1-8fb7-de55cf5a19e1",
        "c9f31b25-bef5-4bb9-a3be-085419f39494",
    ],
    "Hideout Power Cores": [
        "779335ab-f424-4187-becc-1cfa248a6c80", "080f05d3-5f58-4b5a-90a2-68a14bb3ed38",
        "0cfa9dd2-5dfc-44f5-baef-2148a0994886", "63690ff2-e1ec-4bdf-b1d8-f9403fc118ba",
        "f424fe20-9994-4be5-954c-49c087cd3447", "bdfdff51-8278-4c9a-ac90-cc6f60bcbc26",
    ],
    "Outlands Treasures": [
        "0efb7b99-e39a-4139-aa4e-398c44b0be1d", "d7fb0e32-0003-4949-b3f5-2c350b5f08ce",
        "2c886a17-6ffe-41ec-abce-8bdb733f7f03", "88e54842-4bf9-4be7-9f77-59d6abc77e88",
        "5e5412ac-0125-4a1b-b9dc-35c9481c241a", "ea1d39ee-f7ec-4327-9e8d-23fe7809436d",
        "45c2381e-00ac-489c-a634-1e5a14214a0c", "6ef76d40-c59d-4b2b-b8b7-9b394275e07c",
        "3a56df88-edcc-4296-a4cc-11981ffad3c1",
    ],
    "Smugglers": [
        "817cebfc-db14-466e-940b-da1540a6eedc", "7a27fb41-065e-48e3-befb-29ec4814ed6d",
        "b0bca870-4e28-4563-ae5e-fceecf586b35", "411fd442-1758-4199-8495-bb9b7520ec60",
        "7e054c90-83f9-4ffb-8be5-488f3453737c", "aa8ae241-8979-4aac-b25f-0645949b2483",
        "0e590801-ba3b-4386-8092-1514ca4a8e0f",
    ],
    "Hellgates": ["b4b3c8a6-d0ae-41c4-908a-833e68e24fdb"],
    "The Depths": [
        "bdf9020b-169d-4423-94e5-a9a80ada2469", "f66e5b64-3b29-4be5-b9b5-20cd2013df08",
        "79d5315d-6f20-4a22-8e14-b9b596dbcf21",
    ],
    "Corrupted Dungeons": ["b4797bf2-137c-4610-a4a9-ec5a7eb6d6c8"],
    "Castles & Castle Outposts": [
        "ffb0d063-8ac1-4d37-b1a1-61667a7fc9a5", "340b4b47-43ce-40dd-903c-4694f438e389",
        "c5220fe6-2313-441c-a621-5a6c90cf3e0d",
    ],
}

SEASON_POINTS = {
    "Guild Challenge": 13200,
    "PvE (Outlands and Roads)": 9000,
    "Keeper Uprising": 41300,
    "Gathering (Outlands and Roads)": 5000,
    "Hideout Power Cores": 3135,
    "Outlands Treasures": 2392,
    "Smugglers": 2016,
    "Hellgates": 500,
    "The Depths": 4000,
    "Corrupted Dungeons": 350,
    "Castles & Castle Outposts": 150,
}

TOTAL_AMOUNTS = {
    "Guild Challenge": 136_126_000,
    "PvE (Outlands and Roads)": 22_000_000,
    "Keeper Uprising": 3_300_000,
    "Gathering (Outlands and Roads)": 858_000,
    "Hideout Power Cores": 3_200_000,
    "Outlands Treasures": 1_600_000,
    "Smugglers": 2_500_000,
    "Hellgates": 25_000,
    "The Depths": 170_000,
    "Corrupted Dungeons": 8_755,
    "Castles & Castle Outposts": 183_000,
}

MAX_RANKS = {
    "Guild Challenge": 209,
    "PvE (Outlands and Roads)": 146,
    "Keeper Uprising": 114,
    "Gathering (Outlands and Roads)": 106,
    "Hideout Power Cores": 72,
    "Outlands Treasures": 127,
    "Smugglers": 105,
    "Hellgates": 14,
    "The Depths": 44,
    "Corrupted Dungeons": 15,
    "Castles & Castle Outposts": 34,
}

IGNORED_ROW_NAMES = {
    "smugglers", "thedepths", "castles&castleoutposts", "guildmight",
    "gathering(outlandsandroads)", "pve(outlandsandroads)",
    "hideoutpowercores", "keeperuprising", "outlandstreasures",
}

PLAYER_ALIASES = {
    "tmalusculo": "Tmaiusculo",
    "ispelinotfound": "ISpellNotFound",
    "clsn": "dsn",
    "dlsn": "dsn",
    "bobbob": "BobBob",
    "robertxvll": "RobertXVII",
    "robertxvll": "RobertXVII",
    "xishanksxl": "XIShanksXI",
    "xishanksxi": "XIShanksXI",
    "sumol": "Sum0l",
    "wilihue": "WillHue",
    "onigumooo": "OniGuM000",
    "jwar": "JJWAR",
    "jiwar": "JJWAR",
    "owerlor1123": "OWERLORI123",
    "patinhas": "Patiinhas",
    "ellzabethr": "ElizabethR",
    "thordasilva": "ThordaSilva",
    "nagacaburus": "Nagacaburos",
    "jairrodrigo": "Jairrodrigo",
    "julioczr": "Julioczr",
    "ssshadowless": "SShadowless",
    "sshadowless": "SShadowless",
    "hoolisheet": "HooLiSheet",
}

MANUAL_ROWS = {
    "Guild Challenge": {
        39: ("hardfedles", 1_009_876),
        40: ("jordansPt", 988_349),
        41: ("Dorfiuses", 918_416),
        42: ("VnfaTI", 854_240),
        43: ("Merlinavo", 783_622),
        44: ("Jmbv", 783_402),
        45: ("YukitoRaiden", 767_262),
        46: ("Elga7id", 710_765),
        47: ("BBob", 688_134),
        48: ("MARIOMALAN", 664_569),
        49: ("Superpk", 641_725),
        50: ("Soldier027", 621_344),
        87: ("IIIIIIIIIII", 164_620),
        130: ("Andrezao", 36_477),
        158: ("ziorni", 8_010),
        163: ("KalosKirk2", 6_482),
        184: ("TioTrymmi", 1_111),
    },
    "Keeper Uprising": {
        39: ("IIIIIIIIIII", 16_756),
    },
    "Gathering (Outlands and Roads)": {
        103: ("SuSex", 7),
        106: ("MaCiRoSKi", 1),
    },
}


def image_path(identifier: str) -> Path:
    return TEMP / f"codex-clipboard-{identifier}.png"


def center(box):
    return sum(point[0] for point in box) / 4, sum(point[1] for point in box) / 4


def parse_amount(text: str):
    parts = re.findall(r"[\d][\d,\.]*", text)
    if not parts:
        return None
    compact = parts[-1]
    if "," in compact:
        first, *rest = compact.split(",")
        if len(first) > 3:
            first = first[-3:]
        compact = ",".join([first, *rest])
    if not re.fullmatch(r"[\d,\.]+", compact):
        return None
    digits = re.sub(r"\D", "", compact)
    if not digits:
        return None
    value = int(digits)
    if re.search(r"\bk\b|k$", text, flags=re.IGNORECASE) and value < 100_000:
        value *= 1000
    return value


def ocr_tokens(engine, path: Path):
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{path.stem}.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))
    result, _ = engine(str(path))
    tokens = []
    for box, text, score in result or []:
        x, y = center(box)
        tokens.append({"x": x, "y": y, "text": text.strip(), "score": float(score)})
    cached.write_text(json.dumps(tokens, ensure_ascii=False), encoding="utf-8")
    return tokens


def extract_rows(engine, path: Path):
    tokens = ocr_tokens(engine, path)

    rank_headers = [t for t in tokens if t["text"].lower() == "rank"]
    amount_headers = [t for t in tokens if t["text"].lower() == "amount"]
    if not rank_headers or not amount_headers:
        return [], {"file": path.name, "error": "headers not found"}
    header_y = max(t["y"] for t in rank_headers)
    amount_header = max((t for t in amount_headers if abs(t["y"] - header_y) < 12), key=lambda t: t["x"])
    amount_x = amount_header["x"]
    player_headers = [t for t in tokens if t["text"].lower() == "player" and abs(t["y"] - header_y) < 12]
    if not player_headers:
        return [], {"file": path.name, "error": "player header not found"}
    player_x = player_headers[0]["x"]
    rank_x = min(t["x"] for t in rank_headers if abs(t["y"] - header_y) < 12)
    name_min_x = (rank_x + player_x) / 2
    amount_min_x = (player_x + amount_x) / 2

    amounts = []
    for token in tokens:
        value = parse_amount(token["text"])
        if token["y"] > header_y + 8 and token["x"] > amount_min_x and value is not None:
            amounts.append((token, value))

    rows = []
    for amount_token, amount in sorted(amounts, key=lambda item: item[0]["y"]):
        same_line = [t for t in tokens if abs(t["y"] - amount_token["y"]) <= 5]
        names = [
            t for t in same_line
            if name_min_x < t["x"] < amount_min_x
            and not re.fullmatch(r"\d{1,3}", t["text"])
            and t is not amount_token
        ]
        ranks = [t for t in same_line if t["x"] < name_min_x and re.fullmatch(r"\d{1,3}", t["text"])]
        if not names:
            continue
        name_token = max(names, key=lambda t: (t["score"], len(t["text"])))
        normalized_name = re.sub(r"\s+", "", name_token["text"]).casefold()
        if normalized_name in IGNORED_ROW_NAMES:
            continue
        explicit_rank = int(ranks[0]["text"]) if ranks else None
        rows.append({
            "rank": explicit_rank,
            "player": name_token["text"].strip(),
            "amount": amount,
            "confidence": round((name_token["score"] + amount_token["score"]) / 2, 4),
            "y": amount_token["y"],
            "file": path.name,
        })

    offsets = Counter(row["rank"] - index for index, row in enumerate(rows) if row["rank"] is not None)
    if offsets:
        dominant_offset, _ = offsets.most_common(1)[0]
        anchors = [
            (index, row["rank"])
            for index, row in enumerate(rows)
            if row["rank"] is not None and abs((row["rank"] - index) - dominant_offset) <= 3
        ]
        for index, row in enumerate(rows):
            is_reliable = row["rank"] is not None and abs((row["rank"] - index) - dominant_offset) <= 3
            if is_reliable:
                continue
            if anchors:
                anchor_index, anchor_rank = min(anchors, key=lambda item: abs(item[0] - index))
                inferred = anchor_rank + index - anchor_index
            else:
                inferred = dominant_offset + index
            if 1 <= inferred <= 999:
                row["rank"] = inferred
    return [row for row in rows if row["rank"] is not None], None


def merge_candidates(category, candidates):
    merged = []
    conflicts = []
    by_rank = defaultdict(list)
    for row in candidates:
        by_rank[row["rank"]].append(row)

    for rank in sorted(by_rank):
        options = by_rank[rank]
        signatures = Counter((row["player"].casefold().replace(" ", ""), row["amount"]) for row in options)
        best_signature, count = max(signatures.items(), key=lambda item: (item[1], max(
            row["confidence"] for row in options
            if (row["player"].casefold().replace(" ", ""), row["amount"]) == item[0]
        )))
        matching = [row for row in options if (row["player"].casefold().replace(" ", ""), row["amount"]) == best_signature]
        best = max(matching, key=lambda row: row["confidence"])
        merged.append({"rank": rank, "player": best["player"].replace(" ", ""), "amount": best["amount"]})
        unique = sorted({(row["player"], row["amount"]) for row in options})
        if len(unique) > 1:
            conflicts.append({"category": category, "rank": rank, "chosen": [best["player"], best["amount"]], "options": unique, "support": count})
    previous_amount = None
    for row in merged:
        amount = row["amount"]
        while previous_amount is not None and amount > previous_amount and str(amount).startswith("8"):
            amount = int(str(amount)[1:] or "0")
        row["amount"] = amount
        previous_amount = amount
    return merged, conflicts


def main():
    engine = RapidOCR()
    output = {
        "season": 33,
        "guild": "NoTag",
        "snapshotLabel": "Ouro",
        "capturedAt": "2026-08-05",
        "officialGuildPoints": 81043,
        "formula": "seasonPoints * memberAmount / totalAmount",
        "ignoredSources": ["Guild Season Bracket Level Up", "Personal Season Stats", "zero-value categories"],
        "missingRanks": {},
        "sourceNotes": [
            "Guild Challenge ranks 39-52 and total amount were refreshed from the follow-up screenshot captured about three hours later."
        ],
        "categories": [],
    }
    all_conflicts = []
    errors = []
    for category, identifiers in CATEGORY_FILES.items():
        candidates = []
        for identifier in identifiers:
            path = image_path(identifier)
            print(f"OCR {category}: {path.name}", file=sys.stderr)
            rows, error = extract_rows(engine, path)
            candidates.extend(rows)
            if error:
                errors.append(error)
        merged, conflicts = merge_candidates(category, candidates)
        by_rank = {row["rank"]: row for row in merged}
        for rank, (player, amount) in MANUAL_ROWS.get(category, {}).items():
            by_rank[rank] = {"rank": rank, "player": player, "amount": amount}
        merged = sorted(by_rank.values(), key=lambda row: row["rank"])
        for row in merged:
            row["player"] = PLAYER_ALIASES.get(row["player"].casefold(), row["player"])
        merged = [row for row in merged if row["rank"] <= MAX_RANKS[category]]
        conflicts = [row for row in conflicts if row["rank"] <= MAX_RANKS[category]]
        all_conflicts.extend(conflicts)
        output["categories"].append({
            "name": category,
            "seasonPoints": SEASON_POINTS[category],
            "totalAmount": TOTAL_AMOUNTS[category],
            "rows": merged,
        })

    destination = ROOT / "data" / "season33" / "snapshot-gold.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review = ROOT / "data" / "season33" / "ocr-review.json"
    review.write_text(json.dumps({"conflicts": all_conflicts, "errors": errors}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(destination),
        "review": str(review),
        "counts": {item["name"]: len(item["rows"]) for item in output["categories"]},
        "conflicts": len(all_conflicts),
        "errors": errors,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
