# ============================================================
# CELL 1: Install dependencies
# ============================================================
!pip install -q transformers torch pandas scikit-learn matplotlib



# ============================================================
# CELL 2: Imports
# ============================================================
import os
import re
import json
import glob
import shutil
import zipfile
from dataclasses import dataclass
from typing import Optional

import torch
import torch.nn as nn
import pandas as pd
import matplotlib.pyplot as plt
from transformers import AutoTokenizer, AutoModel, AutoConfig
from transformers.modeling_outputs import ModelOutput
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {DEVICE}")




# ============================================================
# CELL 3: Load the trained model checkpoint from Google Drive
#
# Identical approach to colab_evaluation.py: files.upload() stalls on
# large files, so the checkpoint is uploaded to Drive first (drag-and-
# drop in the browser) and mounted here instead.
#
# Before running this cell:
#   1. Upload your trained model zip (the zipped "best/" directory —
#      containing config.json, pytorch_model.bin, tokenizer files,
#      and training_meta.json) to your Google Drive, e.g. into
#      "My Drive/colab_models/".
#   2. Set MODEL_ZIP_DRIVE_PATH below to that file's path.
# ============================================================
from google.colab import drive

drive.mount("/content/drive")

MODEL_ZIP_DRIVE_PATH = "/content/drive/MyDrive/roberta-base_model.zip"


assert os.path.exists(MODEL_ZIP_DRIVE_PATH), (
    f"Model zip not found at {MODEL_ZIP_DRIVE_PATH} — check the path matches "
    "where you uploaded it in your Google Drive."
)

MODEL_ZIP_PATH = "/content/opt_model.zip"
shutil.copy(MODEL_ZIP_DRIVE_PATH, MODEL_ZIP_PATH)
print(f"Copied model checkpoint from Drive ({os.path.getsize(MODEL_ZIP_PATH) / 1e6:.1f} MB).")

MODEL_DIR = "/content/opt_model"
if os.path.exists(MODEL_DIR):
    shutil.rmtree(MODEL_DIR)
os.makedirs(MODEL_DIR, exist_ok=True)

with zipfile.ZipFile(MODEL_ZIP_PATH, "r") as zf:
    zf.extractall(MODEL_DIR)

# The zip may extract straight into MODEL_DIR, or into a single
# subfolder (e.g. "best/") depending on how it was zipped — detect
# and flatten either layout so config.json is always at MODEL_DIR root.
if not os.path.exists(os.path.join(MODEL_DIR, "config.json")):
    subdirs = [
        d for d in glob.glob(os.path.join(MODEL_DIR, "*"))
        if os.path.isdir(d)
    ]
    if len(subdirs) == 1 and os.path.exists(os.path.join(subdirs[0], "config.json")):
        for item in os.listdir(subdirs[0]):
            shutil.move(os.path.join(subdirs[0], item), MODEL_DIR)
        shutil.rmtree(subdirs[0])

assert os.path.exists(os.path.join(MODEL_DIR, "config.json")), (
    f"config.json not found in {MODEL_DIR} — check the uploaded zip contains "
    "the checkpoint files directly (config.json, pytorch_model.bin, tokenizer files)."
)
print(f"Model checkpoint ready at: {MODEL_DIR}")




# ============================================================
# CELL 4: Upload dataset CSV(s) and lexicon.json
#
# Upload one or more dataset_match_*.csv files (multi-select is fine,
# and using more matches makes the sweep result more trustworthy) AND
# commentary_analysis_system/data/lexicon.json.
# ============================================================
from google.colab import files

print("Upload one or more dataset_match_*.csv files, plus lexicon.json:")
uploaded_data = files.upload()

DATASET_CSV_PATHS = sorted(
    name for name in uploaded_data.keys() if name.lower().endswith(".csv")
)
LEXICON_JSON_PATH = next(
    (
        name for name in uploaded_data.keys()
        if re.match(r"^lexicon(?: \(\d+\))?\.json$", os.path.basename(name), re.IGNORECASE)
    ),
    None,
)

assert DATASET_CSV_PATHS, "No CSV files were uploaded."
assert LEXICON_JSON_PATH, (
    "lexicon.json was not uploaded (or was saved under an unexpected name — "
    f"got: {sorted(uploaded_data.keys())})."
)
print(f"Datasets ({len(DATASET_CSV_PATHS)}): {DATASET_CSV_PATHS}")
print(f"Lexicon config: {LEXICON_JSON_PATH}")




# ============================================================
# CELL 5: DualHead model definition
#
# Ported unchanged from colab_evaluation.py — matches colab_backend.py
# / colab testing/colab_training.py, the scripts that actually
# produced every trained checkpoint in this project.
# ============================================================
@dataclass
class DualHeadRoBERTaOutput(ModelOutput):
    loss: Optional[torch.FloatTensor] = None
    logits: torch.FloatTensor = None
    highlight_scores: torch.FloatTensor = None


class DualHeadRoBERTa(nn.Module):
    def __init__(self, model_name, num_labels, id2label, label2id):
        super().__init__()
        self.config = AutoModel.from_pretrained(model_name).config
        self.config.num_labels = num_labels
        self.config.id2label = id2label
        self.config.label2id = label2id

        self.roberta = AutoModel.from_pretrained(model_name)

        self.event_classifier = nn.Linear(self.config.hidden_size, num_labels)
        self.highlight_scorer = nn.Linear(self.config.hidden_size, 1)

    def forward(self, input_ids, attention_mask, **kwargs):
        outputs = self.roberta(input_ids=input_ids, attention_mask=attention_mask)
        pooled_output = getattr(outputs, "pooler_output", None)
        if pooled_output is None:
            pooled_output = outputs.last_hidden_state[:, 0, :]

        event_logits = self.event_classifier(pooled_output)
        highlight_score = torch.sigmoid(self.highlight_scorer(pooled_output))

        return DualHeadRoBERTaOutput(logits=event_logits, highlight_scores=highlight_score)




# ============================================================
# CELL 6: Load the checkpoint
# ============================================================
class LoadedModel:
    def __init__(self, model_dir):
        config = AutoConfig.from_pretrained(model_dir)
        self.num_labels = config.num_labels
        self.id2label = {int(k): v for k, v in config.id2label.items()}
        self.label2id = {k: int(v) for k, v in config.label2id.items()}

        self.window_size = getattr(config, "window_size", 1)
        self.tokenizer_max_length = getattr(config, "tokenizer_max_length", 128)

        meta_path = os.path.join(model_dir, "training_meta.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                meta = json.load(f)
            self.window_size = meta.get("window_size", self.window_size)
            self.tokenizer_max_length = meta.get("tokenizer_max_length", self.tokenizer_max_length)

        base_model_name = getattr(config, "_name_or_path", "roberta-base")
        self.model = DualHeadRoBERTa(base_model_name, self.num_labels, self.id2label, self.label2id)

        state_dict = torch.load(os.path.join(model_dir, "pytorch_model.bin"), map_location="cpu")
        self.model.load_state_dict(state_dict)
        self.model.to(DEVICE)
        self.model.eval()

        self.tokenizer = AutoTokenizer.from_pretrained(model_dir)

    def predict_probs(self, text_list, batch_size=32):
        """Returns (event_probs, highlight_scores) — one list of softmax
        probs per event class and one highlight-score float per input text."""
        all_event_probs, all_highlight_scores = [], []
        for i in range(0, len(text_list), batch_size):
            batch_texts = text_list[i:i + batch_size]
            inputs = self.tokenizer(
                batch_texts, padding=True, truncation=True,
                max_length=self.tokenizer_max_length, return_tensors="pt",
            )
            inputs = {k: v.to(DEVICE) for k, v in inputs.items()}
            with torch.no_grad():
                outputs = self.model(**inputs)
                probs = torch.softmax(outputs.logits, dim=-1)
                all_event_probs.extend(probs.tolist())
                all_highlight_scores.extend(outputs.highlight_scores.view(-1).tolist())
        return all_event_probs, all_highlight_scores


loaded_model = LoadedModel(MODEL_DIR)
print(f"Loaded model: num_labels={loaded_model.num_labels}, "
      f"window_size={loaded_model.window_size}, "
      f"tokenizer_max_length={loaded_model.tokenizer_max_length}")
print(f"id2label: {loaded_model.id2label}")




# ============================================================
# CELL 7: Sliding-window context builder
#
# Ported from commentary_analysis_system/src/data_processing/chunker.py.
# ============================================================
def build_context_windows(texts: list[str], window_size: int) -> list[str]:
    if window_size <= 1:
        return list(texts)
    half = window_size // 2
    n = len(texts)
    return [
        " ".join(texts[max(0, i - half): min(n, i + half + 1)])
        for i in range(n)
    ]




# ============================================================
# CELL 8: Lexicon model
#
# Ported verbatim from commentary_analysis_system/src/models/lexicon_model.py.
# ============================================================
class LexiconModel:
    def __init__(self, config_path):
        with open(config_path, "r") as f:
            self.config = json.load(f)

    def _count_matches_weighted(self, text: str, terms: list[dict]) -> float:
        score = 0.0
        negations = [
            "no", "not", "missed", "missed the",
            "almost", "nearly", "just", "prevented",
            "stopped", "denied", "failed", "attempt",
            "trying to", "going for", "couldn't", "could not",
            "short of", "held up", "short",
        ]
        for term_obj in terms:
            if isinstance(term_obj, str):
                term, weight = term_obj, 1.0
            else:
                term = term_obj.get("text", "")
                weight = float(term_obj.get("weight", 1.0))
            if not term:
                continue

            if "\\" in term:
                pattern = term
            else:
                escaped_term = re.escape(term)
                pattern = rf"\b{escaped_term}(?:s|ed|ing|d)?\b"

            for match in re.finditer(pattern, text, re.IGNORECASE):
                start_idx = match.start()
                preceding_text = text[max(0, start_idx - 15):start_idx].lower()
                is_negated = any(preceding_text.strip().endswith(neg) for neg in negations)
                if not is_negated:
                    score += weight
        return score

    def generate_features(self, text: str) -> dict:
        text = text.lower()
        features = {}
        for category in self.config.get("categories", []):
            cat_id = category["id"]
            features[cat_id] = self._count_matches_weighted(text, category.get("terms", []))
        return features

    def score_chunk(self, text: str) -> float:
        feats = self.generate_features(text)
        raw_score = 0.0
        for category in self.config.get("categories", []):
            cat_id = category["id"]
            weight = category.get("weight", 0.0)
            count = feats.get(cat_id, 0)
            scaled_count = float(count) * 100.0
            raw_score += min(1.0, scaled_count) * weight
        return min(raw_score, 1.0)


lexicon_model = LexiconModel(LEXICON_JSON_PATH)
print(f"Loaded lexicon with {len(lexicon_model.config.get('categories', []))} categories.")




# ============================================================
# CELL 9: Ground-truth extraction from a dataset CSV
#
# Handles both current ("event_class"/"highlight_score") and older
# ("event"/"score") column names — same fallback used by
# colab_evaluation.py and the local pipeline's evaluator.py.
# ============================================================
def load_dataset_csv(csv_path: str, label2id: dict):
    df = pd.read_csv(csv_path)
    df = df.dropna(subset=["text"]).reset_index(drop=True)

    event_col = "event_class" if "event_class" in df.columns else "event"
    score_col = "highlight_score" if "highlight_score" in df.columns else "score"

    df["true_event_id"] = df[event_col].apply(
        lambda x: label2id.get(str(x).strip(), 0) if pd.notna(x) and str(x).strip() else 0
    )
    df["true_score"] = pd.to_numeric(df[score_col], errors="coerce").fillna(0.0)

    return df




# ============================================================
# CELL 10: Run the model ONCE per row and cache raw scores
#
# The sweep below re-scores every row at ~20 different weight values.
# Re-running the transformer at each step would be wasteful and slow,
# so — mirroring how scripts/03_run_pipeline.py caches
# raw_roberta_probs / raw_lexicon_features for scripts/
# 07_optimize_event_weights.py to reuse — we run RoBERTa + the lexicon
# exactly once per row here and cache everything the sweep needs.
#
# Context windows are built per-dataset (not on the concatenated pool)
# so a window never blends text across two different matches.
# ============================================================
records = []  # one dict per row, pooled across all uploaded matches

for csv_path in DATASET_CSV_PATHS:
    match_name = os.path.splitext(os.path.basename(csv_path))[0]
    df = load_dataset_csv(csv_path, loaded_model.label2id)
    texts = df["text"].tolist()

    windowed_texts = build_context_windows(texts, loaded_model.window_size)
    roberta_event_probs, roberta_highlight_scores = loaded_model.predict_probs(windowed_texts)

    for text, true_event_id, true_score, r_probs, r_h_score in zip(
        texts, df["true_event_id"].tolist(), df["true_score"].tolist(),
        roberta_event_probs, roberta_highlight_scores,
    ):
        records.append({
            "match": match_name,
            "text": text,
            "true_event_id": true_event_id,
            "true_score": true_score,
            "roberta_probs": r_probs,
            "roberta_highlight_score": r_h_score,
            "lexicon_score": lexicon_model.score_chunk(text),
            "lexicon_features": lexicon_model.generate_features(text),
        })

    print(f"  Cached {len(texts)} rows for {match_name}")

print(f"\nTotal cached rows across {len(DATASET_CSV_PATHS)} matches: {len(records)}")



# ============================================================
# CELL 11: Weight sweep — event classification (+ highlight score)
#
# Formulas ported verbatim from
# commentary_analysis_system/src/models/hybrid_model.py's
# HybridModel.predict(). Current production default (data/config/
# settings.json) is marked in the results as the baseline to compare
# the sweep's recommendation against.
# ============================================================
ROBERTA_WEIGHT = 1.0
CURRENT_EVENT_LEXICON_WEIGHT = 0.35      # data/config/settings.json -> event_lexicon_weight

# Fine resolution 0.00 -> 1.00 in steps of 0.05, then coarse resolution
# 1 -> 50 in steps of 2 (covers the case where the optimal weight lies
# well above 1.0). Deduplicated and sorted into one sweep.
WEIGHT_STEPS = sorted(set(
    [round(w / 100.0, 2) for w in range(0, 105, 5)] +      # 0.00, 0.05, ..., 1.00
    [float(w) for w in range(1, 51, 2)]                    # 1, 3, 5, ..., 49
))

NORMAL_PLAY_ID = loaded_model.label2id.get("normal_play", 0)

CATEGORY_WEIGHTS = {c["id"]: c["weight"] for c in lexicon_model.config["categories"]}


def sweep_event_lexicon_weight():
    """Mirrors scripts/07_optimize_event_weights.py: sweeps the weight
    that boosts each event's RoBERTa probability with that event's
    normalized, category-weighted lexicon score, scored by multiclass
    accuracy.

    For each weight, also computes a continuous highlight score per
    record (1 - hybrid P(normal_play)) instead of a binary highlight
    flag, since no binary highlight/not-highlight decision is needed
    here."""
    id2label = loaded_model.id2label
    results = []

    for weight in WEIGHT_STEPS:
        y_pred = []

        for r in records:
            max_hybrid_prob, predicted_event_id = -1.0, 0
            for i, p in enumerate(r["roberta_probs"]):
                event_name = id2label.get(i, "normal_play")
                l_for_event = r["lexicon_features"].get(event_name, 0.0)
                l_normalized = min(1.0, float(l_for_event) * 100.0) * CATEGORY_WEIGHTS.get(event_name, 1.0)
                event_hybrid_prob = (p * ROBERTA_WEIGHT) + (l_normalized * weight)
                if event_hybrid_prob > max_hybrid_prob:
                    max_hybrid_prob, predicted_event_id = event_hybrid_prob, i
            y_pred.append(predicted_event_id)

        y_true = [r["true_event_id"] for r in records]
        accuracy = accuracy_score(y_true, y_pred)
        _, _, f1_macro, _ = precision_recall_fscore_support(
            y_true, y_pred, average="macro", zero_division=0
        )
        results.append({
            "lexicon_weight": weight,
            "accuracy": accuracy,
            "f1_macro": f1_macro,
        })

    best = max(results, key=lambda x: x["accuracy"])
    for r in results:
        r["is_best"] = (r["lexicon_weight"] == best["lexicon_weight"])
        r["is_current_default"] = abs(r["lexicon_weight"] - CURRENT_EVENT_LEXICON_WEIGHT) < 1e-9

    # Re-run once at the best weight to capture per-record event +
    # continuous highlight score (1 - hybrid P(normal_play)).
    per_record = []
    for r in records:
        max_hybrid_prob, predicted_event_id = -1.0, 0
        normal_play_hybrid_prob = 0.0
        for i, p in enumerate(r["roberta_probs"]):
            event_name = id2label.get(i, "normal_play")
            l_for_event = r["lexicon_features"].get(event_name, 0.0)
            l_normalized = min(1.0, float(l_for_event) * 100.0) * CATEGORY_WEIGHTS.get(event_name, 1.0)
            event_hybrid_prob = (p * ROBERTA_WEIGHT) + (l_normalized * best["lexicon_weight"])
            if i == NORMAL_PLAY_ID:
                normal_play_hybrid_prob = event_hybrid_prob
            if event_hybrid_prob > max_hybrid_prob:
                max_hybrid_prob, predicted_event_id = event_hybrid_prob, i
        per_record.append({
            "match": r["match"],
            "text": r["text"],
            "predicted_event_id": predicted_event_id,
            "predicted_event": id2label.get(predicted_event_id, "normal_play"),
            "true_event_id": r["true_event_id"],
            "highlight_score": max(0.0, 1.0 - normal_play_hybrid_prob),
        })

    return results, best, per_record


print(f"Sweeping event_lexicon_weight over {len(WEIGHT_STEPS)} values "
      f"({WEIGHT_STEPS[0]:.2f} .. {WEIGHT_STEPS[-1]:.2f})...")
event_results, event_best, event_predictions_at_best = sweep_event_lexicon_weight()
print(f"  Best: weight={event_best['lexicon_weight']:.2f}  "
      f"accuracy={event_best['accuracy']:.4f}  f1_macro={event_best['f1_macro']:.4f}")
print(f"  (current production default weight = {CURRENT_EVENT_LEXICON_WEIGHT})")

# ============================================================
# CELL 12: Plot — visual proof of the sweep curve
#
# Weight axis spans two very different scales (0-1 fine steps, 1-50
# coarse steps), so it's plotted on a symlog x-axis to keep the 0-1
# region readable instead of being crushed against the left edge.
# ============================================================
def plot_event_sweep(results, best, current, path):
    weights = [r["lexicon_weight"] for r in results]
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.plot(weights, [r["accuracy"] for r in results], label="Accuracy", marker="o", markersize=3, linewidth=2)
    ax.plot(weights, [r["f1_macro"] for r in results], label="F1 (macro)", marker="o", markersize=3)
    ax.axvline(best["lexicon_weight"], color="green", linestyle="--", label=f"Best accuracy @ {best['lexicon_weight']:.2f}")
    ax.axvline(current, color="gray", linestyle=":", label=f"Current default @ {current:.2f}")
    ax.set_xscale("symlog", linthresh=1.0)
    ax.set_xlabel("event_lexicon_weight (symlog scale)")
    ax.set_ylabel("score")
    ax.set_title("Event-boost weight sweep (per-event hybrid classification)")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


OUT_DIR = "/content/optimization_results"
os.makedirs(OUT_DIR, exist_ok=True)

plot_event_sweep(event_results, event_best, CURRENT_EVENT_LEXICON_WEIGHT,
                  os.path.join(OUT_DIR, "event_lexicon_weight_sweep.png"))
print(f"Saved plot to {OUT_DIR}")

# ============================================================
# CELL 13: Export sweep data (JSON + CSV) and download
#
# Produces the artifacts that justify the chosen weight:
#   - optimization_sweep.json      : full curve + best/current-default markers
#   - event_lexicon_weight_sweep.csv
#   - event_predictions_at_best.csv : per-record event + highlight_score at best weight
#   - event_lexicon_weight_sweep.png
# All zipped together and downloaded to your browser.
# ============================================================
from datetime import datetime, timezone

summary = {
    "model_dir": os.path.basename(MODEL_ZIP_DRIVE_PATH),
    "datasets": DATASET_CSV_PATHS,
    "num_rows": len(records),
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "fixed_params": {
        "roberta_weight": ROBERTA_WEIGHT,
    },
    "weight_steps": WEIGHT_STEPS,
    "event_lexicon_weight_sweep": {
        "results": event_results,
        "best": event_best,
        "current_default": CURRENT_EVENT_LEXICON_WEIGHT,
    },
}

json_path = os.path.join(OUT_DIR, "optimization_sweep.json")
with open(json_path, "w") as f:
    json.dump(summary, f, indent=2)

pd.DataFrame(event_results).to_csv(
    os.path.join(OUT_DIR, "event_lexicon_weight_sweep.csv"), index=False
)
pd.DataFrame(event_predictions_at_best).to_csv(
    os.path.join(OUT_DIR, "event_predictions_at_best.csv"), index=False
)

ZIP_PATH = "/content/optimization_results.zip"
if os.path.exists(ZIP_PATH):
    os.remove(ZIP_PATH)
with zipfile.ZipFile(ZIP_PATH, "w") as zf:
    for fname in os.listdir(OUT_DIR):
        zf.write(os.path.join(OUT_DIR, fname), arcname=fname)

print(f"Saved sweep artifacts to {ZIP_PATH}:")
for fname in os.listdir(OUT_DIR):
    print(f"  - {fname}")

files.download(ZIP_PATH)

# Optional: also persist a copy to Drive instead of only the local
# browser download, so the evidence survives across Colab sessions.
# shutil.copy(ZIP_PATH, "/content/drive/MyDrive/optimization_results.zip")