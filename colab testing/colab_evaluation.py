# ============================================================
# Colab evaluation script — run each CELL below in its own Colab cell,
# in order, top to bottom.
#
# Purpose: evaluate all 3 prediction approaches used by this project
#   - ML Model Only   : the trained DualHeadRoBERTa transformer
#   - Lexicon Only     : rule-based keyword scoring (data/lexicon.json)
#   - Hybrid Model     : ML + Lexicon combined (same formula as
#                        commentary_analysis_system/src/models/hybrid_model.py)
#
# ...against one or more dataset_match_*.csv files, reporting:
#   Classification: Accuracy, Precision, Recall, F1, Precision Macro,
#                   Recall Macro, F1 Macro, plus a per-event breakdown
#                   (precision/recall/f1/support for each of the 9
#                   event classes) — the pooled precision/recall/f1
#                   above blends all classes together and hides how
#                   any single event class performs.
#   Regression:     MSE, MAE
#
# This script is self-contained (no import of the local repo's `src/`
# package) so it runs standalone in Colab. It mirrors the model
# architecture and loading logic from colab_backend.py / colab
# testing/colab_training.py (the scripts that actually produced the
# trained checkpoints), and the lexicon/hybrid logic from
# commentary_analysis_system/src/models/{lexicon_model,hybrid_model}.py.
# ============================================================


# ============================================================
# CELL 1: Install dependencies
# ============================================================
# !pip install -q transformers torch pandas scikit-learn


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
from transformers import AutoTokenizer, AutoModel, AutoConfig
from transformers.modeling_outputs import ModelOutput
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    mean_squared_error,
    mean_absolute_error,
    classification_report,
)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {DEVICE}")


# ============================================================
# CELL 3: Load the trained model checkpoint from Google Drive
#
# files.upload() (the browser upload widget) is unreliable for large
# files like a ~400MB model checkpoint — it can stall for a long time
# with no progress feedback. Uploading to Drive first (drag-and-drop
# in your browser, which is fast and resumable) and mounting Drive
# here instead is far more reliable.
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

MODEL_ZIP_PATH = "/content/eval_model.zip"
shutil.copy(MODEL_ZIP_DRIVE_PATH, MODEL_ZIP_PATH)
print(f"Copied model checkpoint from Drive ({os.path.getsize(MODEL_ZIP_PATH) / 1e6:.1f} MB).")

MODEL_DIR = "/content/eval_model"
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
# Upload one or more dataset_match_*.csv files (multi-select is fine)
# AND commentary_analysis_system/data/lexicon.json. These are small
# text files (a few MB at most), so the files.upload() widget is fine
# here — it's only large binaries like the model checkpoint that need
# the Drive-mount approach used in Cell 3.
# ============================================================
from google.colab import files

print("Upload one or more dataset_match_*.csv files, plus lexicon.json:")
uploaded_data = files.upload()

DATASET_CSV_PATHS = sorted(
    name for name in uploaded_data.keys() if name.lower().endswith(".csv")
)
# Colab's upload widget appends " (1)", " (2)", etc. to the saved filename
# whenever /content already has a file with that exact name (e.g. left over
# from a previous run in this session) — match that pattern too, not just
# the exact "lexicon.json", or LEXICON_JSON_PATH silently ends up None.
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
# Plain nn.Linear heads — matches colab_backend.py / colab
# testing/colab_training.py (the scripts that actually produced every
# trained checkpoint in this project), not the Sequential(Dropout,
# Linear) variant used by the local pipeline's transformer_classifier.py.
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
#
# Reads id2label/label2id/num_labels from config.json, and
# window_size/tokenizer_max_length from training_meta.json (falling
# back to config attributes, then to window_size=1 /
# tokenizer_max_length=128 if neither is present).
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
        """Returns (event_probs, highlight_scores) — one list of 10-way
        softmax probs and one highlight-score float per input text."""
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
# The ML/Hybrid model was trained on windowed text (each row joined
# with its neighbors) — skipping this for a checkpoint with
# window_size > 1 collapses predictions to a single class.
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
# Ported verbatim from
# commentary_analysis_system/src/models/lexicon_model.py.
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
# CELL 9: Hybrid combination
#
# Ported verbatim (formula-for-formula) from
# commentary_analysis_system/src/models/hybrid_model.py's
# HybridModel.predict(). Default weights match this project's
# production config (data/config/settings.json).
# ============================================================
HIGHLIGHT_LEXICON_WEIGHT = 0.75
EVENT_LEXICON_WEIGHT = 0.35
ROBERTA_WEIGHT = 1.0


def run_all_approaches(texts: list[str], id2label: dict, model: LoadedModel, lexicon: LexiconModel):
    """
    texts: raw per-row commentary text, in original CSV row order.
    Returns a dict of per-row predictions for all 3 approaches.
    """
    windowed_texts = build_context_windows(texts, model.window_size)
    roberta_event_probs, roberta_highlight_scores = model.predict_probs(windowed_texts)

    ml_pred_event_id, ml_highlight_score = [], []
    lex_pred_event_id, lex_score = [], []
    hybrid_pred_event_id, hybrid_score_list = [], []

    for text, r_probs, r_h_score in zip(texts, roberta_event_probs, roberta_highlight_scores):
        # --- ML Model Only ---
        ml_event_id = max(range(len(r_probs)), key=lambda i: r_probs[i])
        ml_pred_event_id.append(ml_event_id)
        ml_highlight_score.append(r_h_score)

        # --- Lexicon Only ---
        l_prob = lexicon.score_chunk(text)
        lexicon_features = lexicon.generate_features(text)
        max_lex_score, lex_event_id = -1.0, 0
        for i in range(len(r_probs)):
            event_name = id2label.get(i, "normal_play")
            l_score = lexicon_features.get(event_name, 0.0)
            if l_score > max_lex_score:
                max_lex_score, lex_event_id = l_score, i
        lex_pred_event_id.append(lex_event_id)
        lex_score.append(l_prob)

        # --- Hybrid ---
        hybrid_score = min(1.0, (r_h_score * ROBERTA_WEIGHT) + (l_prob * HIGHLIGHT_LEXICON_WEIGHT))
        hybrid_score_list.append(hybrid_score)

        max_hybrid_prob, hyb_event_id = -1.0, 0
        for i, p in enumerate(r_probs):
            event_name = id2label.get(i, "normal_play")
            l_prob_for_event = lexicon_features.get(event_name, 0.0)
            l_prob_normalized = min(1.0, float(l_prob_for_event) * 100.0)
            event_hybrid_prob = (p * ROBERTA_WEIGHT) + (l_prob_normalized * EVENT_LEXICON_WEIGHT)
            if event_hybrid_prob > max_hybrid_prob:
                max_hybrid_prob, hyb_event_id = event_hybrid_prob, i
        hybrid_pred_event_id.append(hyb_event_id)

    return {
        "ML Model Only": {"event_id": ml_pred_event_id, "score": ml_highlight_score},
        "Lexicon Only": {"event_id": lex_pred_event_id, "score": lex_score},
        "Hybrid Model": {"event_id": hybrid_pred_event_id, "score": hybrid_score_list},
    }


# ============================================================
# CELL 10: Ground-truth extraction from a dataset CSV
#
# Handles both current ("event_class"/"highlight_score") and older
# ("event"/"score") column names, same fallback as
# build_windowed_dataframe() in colab_backend.py and _extract_labels()
# in the local pipeline's evaluator.py: missing/blank event -> normal_play.
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
# CELL 11: Metrics computation
#
# Mirrors make_compute_metrics() in colab_backend.py / colab
# testing/colab_training.py — sklearn weighted + macro averages over
# all classes (including normal_play), plus MSE/MAE for regression.
# ============================================================
def compute_classification_metrics(y_true, y_pred):
    accuracy = accuracy_score(y_true, y_pred)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="weighted", zero_division=0
    )
    precision_macro, recall_macro, f1_macro, _ = precision_recall_fscore_support(
        y_true, y_pred, average="macro", zero_division=0
    )
    return {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "precision_macro": precision_macro,
        "recall_macro": recall_macro,
        "f1_macro": f1_macro,
    }


def compute_regression_metrics(y_true, y_pred):
    return {
        "mse": mean_squared_error(y_true, y_pred),
        "mae": mean_absolute_error(y_true, y_pred),
    }


def print_metrics_table(title, metrics_by_approach, keys):
    print(f"\n--- {title} ---")
    header = f"{'Approach':<16}" + "".join(f"{k:>16}" for k in keys)
    print(header)
    print("-" * len(header))
    for approach, metrics in metrics_by_approach.items():
        row = f"{approach:<16}" + "".join(f"{metrics[k]:>16.4f}" for k in keys)
        print(row)


def compute_per_class_metrics(y_true, y_pred, id2label):
    """Per-event breakdown (precision/recall/f1/support), the same shape as
    sklearn's classification_report — a single pooled precision/recall/f1
    hides how the model does on any one event class, so this is reported
    alongside (not instead of) the macro/weighted summary."""
    labels = sorted(id2label.keys())
    target_names = [id2label[i] for i in labels]
    report = classification_report(
        y_true, y_pred, labels=labels, target_names=target_names,
        output_dict=True, zero_division=0,
    )
    return {name: report[name] for name in target_names}


def print_per_class_table(title, per_class_by_approach, event_names):
    print(f"\n--- {title}: Per-Event ---")
    header = f"{'Event':<14}{'precision':>12}{'recall':>12}{'f1-score':>12}{'support':>10}"
    for approach, per_class in per_class_by_approach.items():
        print(f"\n{approach}:")
        print(header)
        print("-" * len(header))
        for event in event_names:
            m = per_class[event]
            print(
                f"{event:<14}{m['precision']:>12.4f}{m['recall']:>12.4f}"
                f"{m['f1-score']:>12.4f}{m['support']:>10.0f}"
            )


# ============================================================
# CELL 12: Run evaluation over all uploaded datasets
#
# Computes per-match metrics for all 3 approaches, then pools
# predictions across every match for a combined/aggregate result.
# ============================================================
CLASSIFICATION_KEYS = ["accuracy", "precision", "recall", "f1"]  # TODO: re-add precision_macro, recall_macro, f1_macro
REGRESSION_KEYS = ["mse", "mae"]
APPROACH_NAMES = ["ML Model Only", "Lexicon Only", "Hybrid Model"]

EVENT_NAMES = [loaded_model.id2label[i] for i in sorted(loaded_model.id2label.keys())]

per_match_results = {}  # match_name -> {"classification": {...}, "per_class": {...}, "regression": {...}}
pooled_true_event, pooled_true_score = [], []
pooled_pred_event = {name: [] for name in APPROACH_NAMES}
pooled_pred_score = {name: [] for name in APPROACH_NAMES}

for csv_path in DATASET_CSV_PATHS:
    match_name = os.path.splitext(os.path.basename(csv_path))[0]
    print(f"\n{'=' * 60}\nEvaluating: {match_name}\n{'=' * 60}")

    df = load_dataset_csv(csv_path, loaded_model.label2id)
    texts = df["text"].tolist()
    true_event = df["true_event_id"].tolist()
    true_score = df["true_score"].tolist()

    predictions = run_all_approaches(texts, loaded_model.id2label, loaded_model, lexicon_model)

    classification_metrics, per_class_metrics, regression_metrics = {}, {}, {}
    for approach in APPROACH_NAMES:
        pred_event = predictions[approach]["event_id"]
        pred_score = predictions[approach]["score"]

        classification_metrics[approach] = compute_classification_metrics(true_event, pred_event)
        per_class_metrics[approach] = compute_per_class_metrics(true_event, pred_event, loaded_model.id2label)
        regression_metrics[approach] = compute_regression_metrics(true_score, pred_score)

        pooled_pred_event[approach].extend(pred_event)
        pooled_pred_score[approach].extend(pred_score)

    pooled_true_event.extend(true_event)
    pooled_true_score.extend(true_score)

    print_metrics_table("Classification", classification_metrics, CLASSIFICATION_KEYS)
    print_per_class_table("Classification", per_class_metrics, EVENT_NAMES)
    print_metrics_table("Regression", regression_metrics, REGRESSION_KEYS)

    per_match_results[match_name] = {
        "classification": classification_metrics,
        "per_class": per_class_metrics,
        "regression": regression_metrics,
    }

# --- Combined (pooled across all uploaded matches) ---
print(f"\n{'=' * 60}\nCOMBINED (all {len(DATASET_CSV_PATHS)} matches pooled)\n{'=' * 60}")
combined_classification, combined_per_class, combined_regression = {}, {}, {}
for approach in APPROACH_NAMES:
    combined_classification[approach] = compute_classification_metrics(
        pooled_true_event, pooled_pred_event[approach]
    )
    combined_per_class[approach] = compute_per_class_metrics(
        pooled_true_event, pooled_pred_event[approach], loaded_model.id2label
    )
    combined_regression[approach] = compute_regression_metrics(
        pooled_true_score, pooled_pred_score[approach]
    )

print_metrics_table("Classification", combined_classification, CLASSIFICATION_KEYS)
print_per_class_table("Classification", combined_per_class, EVENT_NAMES)
print_metrics_table("Regression", combined_regression, REGRESSION_KEYS)


# ============================================================
# CELL 13: Export results as JSON
#
# Schema mirrors commentary_analysis_system/data/output/evaluation_metrics.json
# ("Lexicon Only" / "ML Model Only" / "Hybrid Model" keys), extended
# with accuracy/precision_macro/recall_macro/f1_macro plus a per-event
# ("per_class") breakdown for each of the 9 event classes. Includes
# both the per-match breakdown and the combined/pooled result.
# ============================================================
from datetime import datetime, timezone

output = {
    "model_dir": os.path.basename(MODEL_ZIP_PATH),
    "datasets": DATASET_CSV_PATHS,
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "hybrid_weights": {
        "highlight_lexicon_weight": HIGHLIGHT_LEXICON_WEIGHT,
        "event_lexicon_weight": EVENT_LEXICON_WEIGHT,
        "roberta_weight": ROBERTA_WEIGHT,
    },
    "per_match": per_match_results,
    "combined": {
        "classification": combined_classification,
        "per_class": combined_per_class,
        "regression": combined_regression,
    },
}

OUTPUT_PATH = "/content/evaluation_results.json"
with open(OUTPUT_PATH, "w") as f:
    json.dump(output, f, indent=2)

print(f"Saved results to {OUTPUT_PATH}")
files.download(OUTPUT_PATH)
