"""
Rebuilds data/lexicon.json from the raw run data in data/lexicon_runs/.

Raw per-match n-gram counts are noisy: team/nation names and generic
commentary filler ("hes", "got", "one") are frequent in every event, and a
player's surname can look "discriminative" for an event just because they
happened to score in one particular match. Plain frequency ranking can't
tell these apart from genuine event vocabulary.

This script instead:
  1. Drops terms in the shared nation/filler blocklist (config/lexicon_filters.json).
  2. Requires a term to appear in >=2 different matches (when >=2 matches have
     data for that event), so single-match artifacts like player names don't
     pass as event vocabulary.
  3. Ranks survivors by log-likelihood "keyness" against all other events
     combined, instead of raw in-event frequency, so words common across
     every event sink to the bottom.
  4. Always includes the curated seed vocabulary (config/seed_lexicon.json)
     at weight 1.0, marked as manual so future auto re-aggregation preserves it.

Usage: python scripts/regenerate_lexicon.py [--top-n 25]
"""
import argparse
import json
import math
import os
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS_DIR = os.path.join(BASE_DIR, "data", "lexicon_runs")
LEXICON_PATH = os.path.join(BASE_DIR, "data", "lexicon.json")
FILTERS_PATH = os.path.join(BASE_DIR, "data", "config", "lexicon_filters.json")
SEED_PATH = os.path.join(BASE_DIR, "data", "config", "seed_lexicon.json")


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def keyness(freq_in_event, total_in_event, freq_in_others, total_others):
    a, b = freq_in_event, freq_in_others
    total = total_in_event + total_others
    if total == 0 or (a + b) == 0:
        return 0.0

    expected_event = total_in_event * (a + b) / total
    expected_others = total_others * (a + b) / total

    ll = 0.0
    if expected_event > 0 and a > 0:
        ll += a * math.log(a / expected_event)
    if expected_others > 0 and b > 0:
        ll += b * math.log(b / expected_others)
    ll *= 2

    rate_event = a / total_in_event if total_in_event > 0 else 0
    rate_others = b / total_others if total_others > 0 else 0
    return ll if rate_event >= rate_others else -ll


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--top-n", type=int, default=25, help="Auto-extracted terms to keep per event")
    args = parser.parse_args()

    filters = load_json(FILTERS_PATH, {})
    blocklist = set(filters.get("nations_and_teams", [])) | set(filters.get("generic_fillers", []))
    seed_lexicon = {k: v for k, v in load_json(SEED_PATH, {}).items() if not k.startswith("_")}

    run_files = [f for f in os.listdir(RUNS_DIR) if f.endswith(".json")] if os.path.isdir(RUNS_DIR) else []

    agg_freqs = defaultdict(lambda: defaultdict(int))
    term_sources = defaultdict(lambda: defaultdict(set))
    event_source_count = defaultdict(int)

    for fname in run_files:
        run = load_json(os.path.join(RUNS_DIR, fname), {})
        source_id = (run.get("sources") or [{}])[0].get("id", run.get("run_id", fname))
        for event, terms in (run.get("frequencies") or {}).items():
            if not terms:
                continue
            event_source_count[event] += 1
            for term, freq in terms.items():
                agg_freqs[event][term] += freq
                term_sources[event][term].add(source_id)

    term_grand_total = defaultdict(int)
    for event, terms in agg_freqs.items():
        for term, freq in terms.items():
            term_grand_total[term] += freq
    grand_total = sum(term_grand_total.values())

    current_lexicon = load_json(LEXICON_PATH, {"categories": []})
    categories_by_id = {c["id"]: c for c in current_lexicon.get("categories", [])}

    all_ids = list(agg_freqs.keys()) + list(categories_by_id.keys()) + list(seed_lexicon.keys())
    events = sorted({e for e in all_ids if not e.startswith("_")})

    output_categories = []
    for event in events:
        event_freqs = agg_freqs.get(event, {})
        total_freq = sum(event_freqs.values())
        total_others = grand_total - total_freq
        min_sources = 2 if event_source_count.get(event, 0) >= 2 else 1
        seed_terms = seed_lexicon.get(event, [])
        seed_set = set(seed_terms)

        candidates = []
        for term, freq in event_freqs.items():
            if term in seed_set:
                continue  # seeds are added separately, always kept
            if term in blocklist:
                continue
            if len(term_sources[event][term]) < min_sources:
                continue
            freq_in_others = term_grand_total[term] - freq
            score = keyness(freq, total_freq, freq_in_others, total_others)
            if score <= 0:
                continue  # not actually over-represented in this event
            candidates.append((term, freq, score))

        candidates.sort(key=lambda x: -x[2])
        top_auto = candidates[: args.top_n]

        terms_out = [{"text": t, "weight": 1.0} for t in seed_terms]
        for term, freq, _score in top_auto:
            terms_out.append({"text": term, "weight": round(freq / total_freq, 4) if total_freq else 0.0})

        existing = categories_by_id.get(event, {})
        output_categories.append({
            "id": event,
            "name": existing.get("name", event.replace("_", " ").title()),
            "weight": existing.get("weight", 0.1),
            "terms": terms_out,
        })

    with open(LEXICON_PATH, "w", encoding="utf-8") as f:
        json.dump({"categories": output_categories}, f, indent=2)

    for cat in output_categories:
        print(f"{cat['id']:12s} seeds={len(seed_lexicon.get(cat['id'], []))}  auto={len(cat['terms']) - len(seed_lexicon.get(cat['id'], []))}")
    print(f"\nSaved {LEXICON_PATH}")


if __name__ == "__main__":
    main()
