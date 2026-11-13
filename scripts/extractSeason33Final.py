"""Build a reviewable Season 33 snapshot from the 2026-08-29 screenshots."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from difflib import SequenceMatcher, get_close_matches
from pathlib import Path
from statistics import median


ROOT = Path(__file__).resolve().parents[1]
OCR_CACHE = Path.home() / "AppData" / "Local" / "Temp" / "codex-notag-season33-final-ocr"

CATEGORY_SCREENSHOTS = {
    "Guild Challenge": [*range(2, 8), *range(9, 26)],
    "PvE (Outlands and Roads)": range(26, 41),
    "Gathering (Outlands and Roads)": range(41, 47),
    "Hideout Power Cores": range(47, 54),
    "Outlands Treasures": range(54, 66),
    "Keeper Uprising": range(66, 77),
    "Smugglers": range(77, 87),
    "Hellgates": range(87, 89),
    "The Depths": range(89, 97),
    "Corrupted Dungeons": range(97, 101),
    "Castles & Castle Outposts": range(101, 106),
}

SEASON_POINTS = {
    "Guild Challenge": 17_100,
    "PvE (Outlands and Roads)": 11_000,
    "Gathering (Outlands and Roads)": 7_600,
    "Hideout Power Cores": 6_075,
    "Outlands Treasures": 5_616,
    "Keeper Uprising": 89_225,
    "Smugglers": 4_216,
    "Hellgates": 800,
    "The Depths": 6_600,
    "Corrupted Dungeons": 550,
    "Castles & Castle Outposts": 1_950,
}

DISPLAYED_TOTALS = {
    "Guild Challenge": 212_134_000,
    "PvE (Outlands and Roads)": 31_000_000,
    "Gathering (Outlands and Roads)": 1_900_000,
    "Hideout Power Cores": 6_200_000,
    "Outlands Treasures": 3_700_000,
    "Keeper Uprising": 7_200_000,
    "Smugglers": 5_300_000,
    "Hellgates": 55_000,
    "The Depths": 422_000,
    "Corrupted Dungeons": 19_000,
    "Castles & Castle Outposts": 1_500_000,
}

EXPECTED_MAX_RANK = {
    "Guild Challenge": 266,
    "PvE (Outlands and Roads)": 205,
    "Gathering (Outlands and Roads)": 97,
    "Hideout Power Cores": 102,
    "Outlands Treasures": 177,
    "Keeper Uprising": 165,
    "Smugglers": 152,
    "Hellgates": 21,
    "The Depths": 62,
    "Corrupted Dungeons": 20,
    "Castles & Castle Outposts": 77,
}

PLAYER_ALIASES = {
    "tmalusculo": "Tmaiusculo",
    "tmaiusculo": "Tmaiusculo",
    "bsaigunner": "BSAIGunner",
    "robertxvll": "RobertXVII",
    "robertxvii": "RobertXVII",
    "naqacaburos": "Nagacaburos",
    "nagacaburus": "Nagacaburos",
    "onigumooo": "OniGuM000",
    "onigumo00": "OniGuM000",
    "sumol": "Sum0l",
    "ssshadowless": "SShadowless",
    "sshadowless": "SShadowless",
    "ispellnotfound": "ISpellNotFound",
    "xishanksxl": "XIShanksXI",
    "xishanksxi": "XIShanksXI",
    "jwar": "JJWAR",
    "jiwar": "JJWAR",
    "superr2855": "Superrr2855",
    "superrr2855": "Superrr2855",
    "patinhas": "Patiinhas",
    "patiinhas": "Patiinhas",
    "awen1996": "avven1996",
    "awven1996": "avven1996",
    "daviimix": "Davllmix",
    "davllmix": "Davllmix",
    "ispelinotfound": "ISpellNotFound",
    "larjarjeanbon": "Jarjarjeanbon",
    "owerlor1123": "OWERLORI123",
    "owerlori123": "OWERLORI123",
    "jorjao": "JORJAO",
    "jorao": "JORJAO",
    "minhafemeal": "minhafemea1",
    "xitos": "Xiitos",
    "xiitos": "Xiitos",
    "vnfat": "VnfaTI",
    "vnfatl": "VnfaTI",
    "jabirocal": "Jabiroca1",
    "anjothali": "AnjoThall",
    "lordiapaa": "LORDJAPAA",
    "dortiuses": "Dorfiuses",
    "fulitime": "FullTime",
    "fulltime": "FullTime",
    "lowmanolow": "JowManojow",
    "onigumoo0": "OniGuM000",
    "dpdzpio": "DpOZPIO",
    "1111": "IIIIIIIIIII",
    "11111": "IIIIIIIIIII",
}

MANUAL_ROWS = {
    "Guild Challenge": {
        75: ("Elga7id", 710_765),
        129: ("IIIIIIIIIII", 164_620),
        242: ("Avelha", 0),
        243: ("HromeuPint0", 0),
        244: ("Phomi", 0),
        245: ("St4ayawayfromme", 0),
        246: ("AmadaFoka", 0),
        247: ("CARLGALAGHER", 0),
        248: ("TheOneSinx", 0),
        249: ("Caxa01", 0),
        250: ("tistaoo", 0),
        251: ("ShobbyYeti", 0),
        252: ("Hlinha2", 0),
        253: ("SucoDeFruta", 0),
        254: ("OReiDoGado", 0),
        255: ("user01Ouser", 0),
        256: ("BuchaCaller", 0),
        257: ("ORKuT", 0),
        258: ("Itryit", 0),
        259: ("MoneyMaker555", 0),
        260: ("ReiDsn", 0),
        261: ("HematomaBr", 0),
        262: ("Leygrin", 0),
        263: ("muller001122", 0),
        264: ("UCKRAPT", 0),
        265: ("noob0102", 0),
        266: ("NOTAGBusiness", 0),
    },
    "PvE (Outlands and Roads)": {
        171: ("Toolsnew", 908),
        195: ("Afonsosa", 99),
        204: ("SHEIKdoPONTILHAO", 2),
        205: ("lord3444", 1),
    },
    "Gathering (Outlands and Roads)": {
        62: ("Tuga95", 4_973),
    },
    "Hideout Power Cores": {
        45: ("IIIIIIIIIII", 32_731),
    },
    "Outlands Treasures": {
        114: ("MissyPT", 3_339),
        115: ("FullTime", 3_313),
        116: ("JackTrip21", 3_293),
        117: ("Superrr2855", 3_188),
        118: ("TensaiPT", 2_868),
        119: ("diovolo", 2_852),
        120: ("KatarinaSemC", 2_840),
        127: ("IIIIIIIIIII", 2_359),
        162: ("jotarokunBR78", 696),
    },
    "Keeper Uprising": {
        30: ("goncalves23", 72_614),
        31: ("MARIOMALAN", 69_968),
        32: ("MineMim", 69_119),
        61: ("IIIIIIIIIII", 16_756),
    },
    "Smugglers": {
        16: ("dsn", 88_397),
        17: ("3YS4N", 88_316),
        84: ("IIIIIIIIIII", 13_385),
    },
    "The Depths": {
        35: ("Lamusk", 1_392),
    },
    "Castles & Castle Outposts": {
        13: ("Nandixx", 39_318),
    },
}

IGNORED_NAMES = {
    "guildmight",
    "guildmembercontribution",
    "gathering(outlandsandroads)",
    "pve(outlandsandroads)",
    "hideoutpowercores",
    "keeperuprising",
    "outlandstreasures",
    "castles&castleoutposts",
    "corrupteddungeons",
    "thedepths",
    "smugglers",
    "hellgates",
}


def parse_amount(text: str):
    matches = re.findall(r"\d[\d,.]*", text)
    if not matches:
        return None
    digits = re.sub(r"\D", "", matches[-1])
    if not digits:
        return None
    value = int(digits)
    if re.search(r"\bk\b|k$", text, flags=re.IGNORECASE) and value < 1_000_000:
        value *= 1_000
    return value


def normalized_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def is_ignored_name(value: str) -> bool:
    normalized = normalized_name(value)
    if normalized in IGNORED_NAMES:
        return True
    return (
        normalized.startswith(("castle", "castie", "casle", "casfle"))
        or "outpost" in normalized
        or "uuiposis" in normalized
    )


def load_tokens(number: int) -> list[dict]:
    path = OCR_CACHE / f"Screenshot_{number}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def extract_rows(number: int):
    tokens = load_tokens(number)
    rank_headers = [token for token in tokens if token["text"].casefold() == "rank"]
    amount_headers = [token for token in tokens if token["text"].casefold() == "amount"]
    player_headers = [token for token in tokens if token["text"].casefold() == "player"]
    if not rank_headers or not amount_headers or not player_headers:
        return [], {"file": f"Screenshot_{number}.png", "error": "table headers not found"}

    header_y = max(token["y"] for token in rank_headers)
    rank_x = min(token["x"] for token in rank_headers if abs(token["y"] - header_y) < 15)
    player_x = min(player_headers, key=lambda token: abs(token["y"] - header_y))["x"]
    amount_x = max(amount_headers, key=lambda token: token["x"])["x"]
    name_min_x = (rank_x + player_x) / 2
    amount_min_x = (player_x + amount_x) / 2

    amount_tokens = []
    for token in tokens:
        amount = parse_amount(token["text"])
        if token["y"] > header_y + 8 and token["x"] > amount_min_x and amount is not None:
            amount_tokens.append((token, amount))

    rows = []
    for amount_token, amount in sorted(amount_tokens, key=lambda item: item[0]["y"]):
        same_line = [token for token in tokens if abs(token["y"] - amount_token["y"]) <= 6]
        names = [
            token
            for token in same_line
            if name_min_x < token["x"] < amount_min_x
            and not re.fullmatch(r"\d{1,3}", token["text"])
            and token is not amount_token
        ]
        ranks = [
            token
            for token in same_line
            if token["x"] < name_min_x and re.fullmatch(r"\d{1,3}", token["text"])
        ]
        if not names:
            continue
        name_token = max(names, key=lambda token: (token["score"], len(token["text"])))
        if is_ignored_name(name_token["text"]):
            continue
        rows.append(
            {
                "rank": int(ranks[0]["text"]) if ranks else None,
                "player": re.sub(r"\s+", "", name_token["text"]),
                "amount": amount,
                "confidence": round((name_token["score"] + amount_token["score"]) / 2, 4),
                "file": f"Screenshot_{number}.png",
                "y": amount_token["y"],
            }
        )

    row_positions = sorted(row["y"] for row in rows)
    short_gaps = [
        current - previous
        for previous, current in zip(row_positions, row_positions[1:])
        if 10 <= current - previous <= 22
    ]
    row_step = median(short_gaps) if short_gaps else 15
    base_y = min(row_positions, default=0)
    for row in rows:
        row["lineIndex"] = round((row["y"] - base_y) / row_step)

    offsets = Counter(
        row["rank"] - row["lineIndex"] for row in rows if row["rank"] is not None
    )
    if offsets:
        dominant_offset = offsets.most_common(1)[0][0]
        for row in rows:
            inferred_rank = dominant_offset + row["lineIndex"]
            if 1 <= inferred_rank <= 999:
                row["rank"] = inferred_rank

    return [row for row in rows if row["rank"] is not None], None


def merge_rows(category: str, candidates: list[dict]):
    by_rank = defaultdict(list)
    for row in candidates:
        by_rank[row["rank"]].append(row)

    merged = []
    conflicts = []
    for rank in sorted(by_rank):
        options = by_rank[rank]
        signatures = Counter((normalized_name(row["player"]), row["amount"]) for row in options)
        signature, support = max(
            signatures.items(),
            key=lambda item: (
                item[1],
                max(row["confidence"] for row in options if (normalized_name(row["player"]), row["amount"]) == item[0]),
            ),
        )
        matches = [row for row in options if (normalized_name(row["player"]), row["amount"]) == signature]
        chosen = max(matches, key=lambda row: row["confidence"])
        player = PLAYER_ALIASES.get(normalized_name(chosen["player"]), chosen["player"])
        merged.append({"rank": rank, "player": player, "amount": chosen["amount"]})
        unique = sorted({(row["player"], row["amount"]) for row in options})
        if len(unique) > 1:
            conflicts.append(
                {
                    "category": category,
                    "rank": rank,
                    "chosen": [player, chosen["amount"]],
                    "options": unique,
                    "support": support,
                }
            )
    previous_amount = None
    for row in merged:
        original_amount = row["amount"]
        while (
            previous_amount is not None
            and row["amount"] > previous_amount * 3
            and row["amount"] >= 10
        ):
            row["amount"] = int(str(row["amount"])[1:] or "0")
        if row["amount"] != original_amount:
            row["ocrAmount"] = original_amount
        previous_amount = row["amount"]
    return merged, conflicts


def main() -> None:
    categories = []
    review = {
        "errors": [],
        "conflicts": [],
        "missingRanks": {},
        "monotonicViolations": {},
        "totals": {},
        "nameSuggestions": [],
    }

    for category, numbers in CATEGORY_SCREENSHOTS.items():
        candidates = []
        for number in numbers:
            rows, error = extract_rows(number)
            candidates.extend(rows)
            if error:
                review["errors"].append(error)
        merged, conflicts = merge_rows(category, candidates)
        by_rank = {row["rank"]: row for row in merged}
        for rank, (player, amount) in MANUAL_ROWS.get(category, {}).items():
            by_rank[rank] = {"rank": rank, "player": player, "amount": amount, "manual": True}
        merged = sorted(by_rank.values(), key=lambda row: row["rank"])
        review["conflicts"].extend(conflicts)

        ranks = [row["rank"] for row in merged]
        if ranks:
            missing = sorted(set(range(1, EXPECTED_MAX_RANK[category] + 1)) - set(ranks))
        else:
            missing = []
        review["missingRanks"][category] = missing

        violations = []
        for previous, current in zip(merged, merged[1:]):
            if current["amount"] > previous["amount"]:
                violations.append(
                    {
                        "previous": [previous["rank"], previous["player"], previous["amount"]],
                        "current": [current["rank"], current["player"], current["amount"]],
                    }
                )
        review["monotonicViolations"][category] = violations

        extracted_total = sum(max(0, row["amount"]) for row in merged)
        displayed_total = DISPLAYED_TOTALS[category]
        review["totals"][category] = {
            "rowCount": len(merged),
            "extractedTotal": extracted_total,
            "displayedRoundedTotal": displayed_total,
            "ratio": round(extracted_total / displayed_total, 6) if displayed_total else None,
        }
        categories.append(
            {
                "name": category,
                "seasonPoints": SEASON_POINTS[category],
                "totalAmount": extracted_total,
                "displayedRoundedTotal": displayed_total,
                "rows": merged,
            }
        )

    canonical_names = {
        normalized_name(row["player"]): row["player"]
        for row in categories[0]["rows"]
    }
    seen_suggestions = set()
    for category in categories[1:]:
        for row in category["rows"]:
            key = normalized_name(row["player"])
            if key in canonical_names or row["player"] in seen_suggestions:
                continue
            matches = get_close_matches(key, canonical_names.keys(), n=2, cutoff=0.72)
            if not matches:
                continue
            seen_suggestions.add(row["player"])
            review["nameSuggestions"].append(
                {
                    "observed": row["player"],
                    "suggested": canonical_names[matches[0]],
                    "score": round(SequenceMatcher(None, key, matches[0]).ratio(), 4),
                    "nextScore": round(SequenceMatcher(None, key, matches[1]).ratio(), 4) if len(matches) > 1 else 0,
                    "category": category["name"],
                }
            )

    output = {
        "season": 33,
        "guild": "NoTag",
        "snapshotLabel": "Final 2026-08-29",
        "capturedAt": "2026-08-29",
        "officialGuildRank": 84,
        "officialGuildPoints": 150_732,
        "formula": "seasonPoints * memberAmount / totalAmount",
        "sourceFolder": r"C:\Users\Lucas\Documents\pontos season 29082026",
        "sourceNotes": [
            "Season point categories reconcile exactly to the official guild total of 150,732.",
            "Member contribution totals use the sum of extracted ranked rows and require OCR review before publication.",
        ],
        "categories": categories,
    }

    destination_dir = ROOT / "data" / "season33"
    destination_dir.mkdir(parents=True, exist_ok=True)
    draft_path = destination_dir / "snapshot-final.json"
    review_path = destination_dir / "ocr-final-review.json"
    draft_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "draft": str(draft_path),
                "review": str(review_path),
                "seasonPointsSum": sum(SEASON_POINTS.values()),
                "rowCounts": {category["name"]: len(category["rows"]) for category in categories},
                "conflicts": len(review["conflicts"]),
                "errors": len(review["errors"]),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
