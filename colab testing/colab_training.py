
# ============================================================
# CELL 1: Install dependencies
# ============================================================
!pip install -U transformers datasets fsspec
!pip install pandas scikit-learn


# ============================================================
# CELL 2: Imports
# ============================================================
import os
import json
import glob
import shutil
import zipfile
from dataclasses import dataclass
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F
import pandas as pd

from transformers import AutoTokenizer, AutoModel, Trainer, TrainingArguments
from transformers.modeling_outputs import ModelOutput
from datasets import Dataset, ClassLabel
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, mean_squared_error, mean_absolute_error, classification_report


# ============================================================
# CELL 3: Upload training data
# ============================================================
from google.colab import files

uploaded = files.upload()
zip_path = next(iter(uploaded))  # name of the uploaded zip file

extract_dir = "/content/training_data"
os.makedirs(extract_dir, exist_ok=True)
with zipfile.ZipFile(zip_path, "r") as zip_ref:
    zip_ref.extractall(extract_dir)

print(f"Extracted training data to {extract_dir}")


# ============================================================
# CELL 4: View how data is spread across events
#
# Searches subfolders too (recursive=True) - zips usually extract
# into a nested folder rather than dropping CSVs at the top level.
# ============================================================
csv_files_preview = glob.glob(os.path.join(extract_dir, "**", "*.csv"), recursive=True)
if not csv_files_preview:
    raise FileNotFoundError(
        f"No .csv files found under {extract_dir}. Contents: {os.listdir(extract_dir)}"
    )

df_preview = pd.concat([pd.read_csv(f) for f in csv_files_preview], ignore_index=True)

event_col = "event_class" if "event_class" in df_preview.columns else "event"
print(df_preview[event_col].value_counts())
print(f"Total rows: {len(df_preview)}")


# ============================================================
# CELL 5: Build label maps
# normal_play is pinned to id 0
# ============================================================
EVENT_CLASSES = [
    "try",
    "goal_kick",
    "card_event",
    "scrum",
    "maul",
    "lineout",
    "kick_off",
    "tmo_replay",
    "penalty",
]

label2id = {"normal_play": 0}
id2label = {0: "normal_play"}
for i, evt in enumerate(EVENT_CLASSES, start=1):
    label2id[evt] = i
    id2label[i] = evt

num_labels = len(label2id)
print("Labels:", label2id)


# ============================================================
# CELL 6: Model definition - DualHeadModel
#   - event_classifier: predicts the event type (try, penalty, ...)
#   - highlight_scorer: predicts a 0-1 "how exciting is this" score
# ============================================================
MODEL_NAME = "roberta-base"  # change if training a different base model


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

    def forward(self, input_ids, attention_mask, labels=None, highlight_labels=None, **kwargs):
        outputs = self.roberta(input_ids=input_ids, attention_mask=attention_mask)
        pooled_output = getattr(outputs, "pooler_output", None)
        if pooled_output is None:
            pooled_output = outputs.last_hidden_state[:, 0, :]

        event_logits = self.event_classifier(pooled_output)
        highlight_score = torch.sigmoid(self.highlight_scorer(pooled_output))

        return DualHeadRoBERTaOutput(logits=event_logits, highlight_scores=highlight_score)


# ============================================================
# CELL 7: Loss functions
#
# FocalLoss: for the event classifier - handles class imbalance
#   automatically, so normal_play should NOT be down-weighted
#   separately (that destroys precision, see class_weights below).
# WeightedMSELoss: for the highlight scorer - upweights samples
#   with a meaningfully high highlight score.
# ============================================================
class FocalLoss(nn.Module):
    def __init__(self, alpha=None, gamma=2.0, reduction="mean"):
        super().__init__()
        self.alpha = alpha
        self.gamma = gamma
        self.reduction = reduction

    def forward(self, inputs, targets):
        ce_loss = F.cross_entropy(inputs, targets, weight=self.alpha, reduction="none")
        pt = torch.exp(-ce_loss)
        focal_loss = ((1 - pt) ** self.gamma) * ce_loss
        if self.reduction == "mean":
            return focal_loss.mean()
        elif self.reduction == "sum":
            return focal_loss.sum()
        return focal_loss


class WeightedMSELoss(nn.Module):
    def __init__(self, base_weight=1.0, high_score_weight=5.0, threshold=0.01):
        super().__init__()
        self.base_weight = base_weight
        self.high_score_weight = high_score_weight
        self.threshold = threshold

    def forward(self, inputs, targets):
        mse = F.mse_loss(inputs, targets, reduction="none")
        weights = torch.where(targets > self.threshold, self.high_score_weight, self.base_weight)
        return (mse * weights).mean()


# ============================================================
# CELL 8: Custom Trainer
#
# stage=1 trains the event classifier head, stage=2 trains the
# highlight scorer head (see CELL 13/15).
# ============================================================
class CustomTrainer(Trainer):
    def __init__(self, *args, class_weights=None, stage=1, **kwargs):
        super().__init__(*args, **kwargs)
        self.stage = stage
        self.loss_fct_events = FocalLoss(alpha=class_weights, gamma=2.0)
        self.loss_fct_highlights = WeightedMSELoss(base_weight=1.0, high_score_weight=5.0, threshold=0.01)

    def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
        labels = inputs.pop("labels")
        highlight_labels = inputs.pop("highlight_labels")

        outputs = model(**inputs)
        logits = outputs.logits
        highlight_scores = outputs.highlight_scores

        if self.stage == 1:
            if self.loss_fct_events.alpha is not None and self.loss_fct_events.alpha.device != logits.device:
                self.loss_fct_events.alpha = self.loss_fct_events.alpha.to(logits.device)
            loss = self.loss_fct_events(logits.view(-1, self.model.config.num_labels), labels.view(-1))
        else:
            loss = self.loss_fct_highlights(highlight_scores.view(-1), highlight_labels.view(-1).to(highlight_scores.dtype))

        return (loss, outputs) if return_outputs else loss


# ============================================================
# CELL 9: Evaluation metrics
#
# The model always returns both heads' outputs, but only one head is
# actually being trained per stage - the other one's weights are
# frozen (or not yet trained), so its predictions are meaningless
# noise for that stage. make_compute_metrics only computes the
# metrics that correspond to the stage actually being trained.
# ============================================================
def make_compute_metrics(stage):
    def compute_metrics(eval_pred):
        (event_logits, highlight_preds) = eval_pred.predictions
        (event_labels, highlight_labels) = eval_pred.label_ids

        if stage == 1:
            event_preds = event_logits.argmax(axis=-1)
            accuracy = accuracy_score(event_labels, event_preds)
            precision, recall, f1, _ = precision_recall_fscore_support(
                event_labels, event_preds, average="weighted", zero_division=0
            )
            precision_macro, recall_macro, f1_macro, _ = precision_recall_fscore_support(
                event_labels, event_preds, average="macro", zero_division=0
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
        else:
            highlight_preds = highlight_preds.reshape(-1)
            highlight_labels = highlight_labels.reshape(-1)
            mse = mean_squared_error(highlight_labels, highlight_preds)
            mae = mean_absolute_error(highlight_labels, highlight_preds)
            return {
                "mse": mse,
                "mae": mae,
            }

    return compute_metrics


# ============================================================
# CELL 10: Load the tokenizer + model (fresh start every run)
# ============================================================
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = DualHeadRoBERTa(MODEL_NAME, num_labels=num_labels, id2label=id2label, label2id=label2id)


# ============================================================
# CELL 11: Load CSVs, build sliding-window text, and compute class weights
#
# WINDOW_SIZE=5 concatenates each row with its 2 neighbors on either
# side into one training sample, and uses the CENTER row's label and
# highlight_score as the target. Commentary describing an event (e.g.
# a try) usually builds across several consecutive lines, so this
# gives the model that surrounding context instead of judging one
# isolated line. 
#
# any inference code must build the same 5-line
# window around a line before classifying it - feeding a single raw
# line to this model would not match what it was trained on.
# ============================================================
WINDOW_SIZE = 5
MAX_LENGTH = 256
window_half = WINDOW_SIZE // 2

csv_files = glob.glob(os.path.join(extract_dir, "**", "*.csv"), recursive=True)
windowed_dfs = []
for f in csv_files:
    d = pd.read_csv(f)
    if "event_class" in d.columns:
        d["label"] = d["event_class"].apply(lambda x: label2id.get(str(x).strip(), 0) if pd.notna(x) else 0)
    elif "event" in d.columns:
        d["label"] = d["event"].apply(lambda x: label2id.get(str(x).strip(), 0) if pd.notna(x) else 0)

    if "highlight_score" in d.columns:
        d["highlight_label"] = pd.to_numeric(d["highlight_score"], errors="coerce").fillna(0.0)
    else:
        d["highlight_label"] = 0.0

    d = d.dropna(subset=["text"]).reset_index(drop=True)
    texts = d["text"].tolist()

    if len(texts) <= 2 * window_half:
        print(f"Skipping {f}: only {len(texts)} rows, need more than {2 * window_half} for window size {WINDOW_SIZE}")
        continue

    rows = []
    for i in range(window_half, len(texts) - window_half):
        window_text = " ".join(texts[i - window_half : i + window_half + 1])
        rows.append({
            "text": window_text,
            "label": d.loc[i, "label"],
            "highlight_label": d.loc[i, "highlight_label"],
        })
    windowed_dfs.append(pd.DataFrame(rows))

df = pd.concat(windowed_dfs, ignore_index=True)
df_balanced = df.sample(frac=1, random_state=42).reset_index(drop=True)

total_samples = len(df_balanced)
class_counts = df_balanced["label"].value_counts().to_dict()
weights = []
for i in range(num_labels):
    count = class_counts.get(i, 0)
    w = total_samples / (num_labels * count) if count > 0 else 1.0
    weights.append(w)

class_weights = torch.tensor(weights, dtype=torch.float)
print("Class weights:", class_weights)


# ============================================================
# CELL 12: Tokenize and split into train/test
# stratify_by_column
# ============================================================
dataset = Dataset.from_pandas(df_balanced)
dataset = dataset.cast_column(
    "label", ClassLabel(num_classes=num_labels, names=[id2label[i] for i in range(num_labels)])
)


def tokenize_func(examples):
    tokenized = tokenizer(examples["text"], padding="max_length", truncation=True, max_length=MAX_LENGTH)
    tokenized["labels"] = examples["label"]
    tokenized["highlight_labels"] = examples["highlight_label"]
    return tokenized


tokenized_datasets = dataset.map(tokenize_func, batched=True)
split_datasets = tokenized_datasets.train_test_split(test_size=0.2, seed=42, stratify_by_column="label")

OUTPUT_DIR = "/content/model_output"


def get_training_args(output_dir_suffix, epochs=5, metric_for_best_model="loss", greater_is_better=None):
    return TrainingArguments(
        output_dir=f"{OUTPUT_DIR}/{output_dir_suffix}",
        num_train_epochs=epochs,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=16,
        eval_strategy="epoch",
        logging_strategy="steps",
        logging_steps=5,
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model=metric_for_best_model,
        greater_is_better=greater_is_better,
        learning_rate=2e-5,
        warmup_ratio=0.1,
    )


# ============================================================
# CELL 13: Stage 1 - Train the event classifier
#
# metric_for_best_model="f1_macro" 
# ============================================================
trainer_stage1 = CustomTrainer(
    model=model,
    args=get_training_args("stage1", epochs=5, metric_for_best_model="f1_macro", greater_is_better=True),
    train_dataset=split_datasets["train"],
    eval_dataset=split_datasets["test"],
    class_weights=class_weights,
    stage=1,
    compute_metrics=make_compute_metrics(1),
)
trainer_stage1.train()


# ============================================================
# CELL 14: Per-class classification report (event head)
#
# compute_metrics only reports weighted-average precision/recall/f1
# each epoch. 
# ============================================================
pred_output = trainer_stage1.predict(split_datasets["test"])
event_logits, _ = pred_output.predictions
event_labels, _ = pred_output.label_ids
event_preds = event_logits.argmax(axis=-1)

target_names = [id2label[i] for i in range(num_labels)]
print(classification_report(
    event_labels, event_preds, labels=list(range(num_labels)), target_names=target_names, zero_division=0
))


# ============================================================
# CELL 15: Stage 2 - Train the highlight scorer
# (backbone + event head are frozen so stage 1 knowledge is kept)
# ============================================================
for name, param in model.named_parameters():
    if "highlight_scorer" not in name:
        param.requires_grad = False

trainer_stage2 = CustomTrainer(
    model=model,
    args=get_training_args("stage2", epochs=5, metric_for_best_model="mse", greater_is_better=False),
    train_dataset=split_datasets["train"],
    eval_dataset=split_datasets["test"],
    class_weights=class_weights,
    stage=2,
    compute_metrics=make_compute_metrics(2),
)
trainer_stage2.train()

for param in model.parameters():
    param.requires_grad = True


# ============================================================
# CELL 16: Save the best model and zip it
# ============================================================
model.config.window_size = WINDOW_SIZE
model.config.tokenizer_max_length = MAX_LENGTH

best_dir = os.path.join(OUTPUT_DIR, "best")
os.makedirs(best_dir, exist_ok=True)
torch.save(model.state_dict(), os.path.join(best_dir, "pytorch_model.bin"))
model.config.save_pretrained(best_dir)
tokenizer.save_pretrained(best_dir)

with open(os.path.join(best_dir, "training_meta.json"), "w") as f:
    json.dump({"window_size": WINDOW_SIZE, "tokenizer_max_length": MAX_LENGTH}, f)

out_zip_base = "/content/trained_model"
shutil.make_archive(out_zip_base, "zip", best_dir)
print(f"Model zipped to {out_zip_base}.zip")


# ============================================================
# CELL 17: Download the trained model to your local machine
# ============================================================
files.download(f"{out_zip_base}.zip")
