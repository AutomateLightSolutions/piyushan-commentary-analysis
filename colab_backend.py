# ============================================================
# SECTION 1: Setup - run this script in a Google Colab Notebook cell
#
# !pip install pyngrok fastapi uvicorn python-multipart openai-whisper pydantic nest-asyncio transformers datasets torch pandas scikit-learn
#
# Paste the following code into the next cell and run it.
# ============================================================


# ============================================================
# SECTION 2: Imports
# ============================================================
import os
import sys
import glob
import shutil
import zipfile
import json
import threading
import uuid
import nest_asyncio
from pyngrok import ngrok
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.encoders import jsonable_encoder
import uvicorn

import whisper
from transformers import AutoTokenizer, Trainer, TrainingArguments, AutoModel
from datasets import Dataset, ClassLabel
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    mean_squared_error,
    mean_absolute_error,
    classification_report,
)
import torch
import torch.nn as nn
import torch.nn.functional as F
import pandas as pd

nest_asyncio.apply()


# ============================================================
# SECTION 3: stdout / stderr Catcher for Live Logs
#
# Wraps stdout/stderr so every print() (including tqdm/Trainer
# logging) is also buffered into `catcher.logs`, which the
# /status/{task_id} endpoint drains and returns to the frontend
# as a live log stream.
# ============================================================
class LogCatcher:
    def __init__(self):
        self.logs = []
        self.original_stdout = sys.stdout
        self.original_stderr = sys.stderr

    def write(self, text):
        if text.strip():
            self.logs.append(text.strip())
        self.original_stdout.write(text)

    def flush(self):
        self.original_stdout.flush()

    def isatty(self):
        return False

catcher = LogCatcher()
sys.stdout = catcher
sys.stderr = catcher

tasks = {} # Store task state: {"status": "running|completed|failed", "result_file": str, "result_data": any}


# ============================================================
# SECTION 4: Transformer Classifier Logic
#   - DualHeadRoBERTa: backbone + two heads
#       - event_classifier: predicts the event type (try, penalty, ...)
#       - highlight_scorer: predicts a 0-1 "how exciting is this" score
#   - FocalLoss / WeightedMSELoss: losses for each head
#   - CustomTrainer: switches between the two losses via `stage`
# ============================================================

from transformers.modeling_outputs import ModelOutput
from dataclasses import dataclass
from typing import Optional
import torch

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
        
        # Dual Heads
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


class FocalLoss(nn.Module):
    def __init__(self, alpha=None, gamma=2.0, reduction='mean'):
        super(FocalLoss, self).__init__()
        self.alpha = alpha
        self.gamma = gamma
        self.reduction = reduction

    def forward(self, inputs, targets):
        ce_loss = F.cross_entropy(inputs, targets, weight=self.alpha, reduction='none')
        pt = torch.exp(-ce_loss)
        focal_loss = ((1 - pt) ** self.gamma) * ce_loss
        if self.reduction == 'mean': return focal_loss.mean()
        elif self.reduction == 'sum': return focal_loss.sum()
        return focal_loss

class WeightedMSELoss(nn.Module):
    def __init__(self, base_weight=1.0, high_score_weight=5.0, threshold=0.01):
        super().__init__()
        self.base_weight = base_weight
        self.high_score_weight = high_score_weight
        self.threshold = threshold

    def forward(self, inputs, targets):
        mse = F.mse_loss(inputs, targets, reduction='none')
        weights = torch.where(targets > self.threshold, self.high_score_weight, self.base_weight)
        return (mse * weights).mean()


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
# SECTION 5: Sliding-Window Context Config
#
# WINDOW_SIZE=5 concatenates each row with its 2 neighbors on either
# side into one training sample, using the CENTER row's label and
# highlight_score as the target - commentary describing an event
# (e.g. a try) usually builds across several consecutive lines, so
# this gives the model that surrounding context instead of judging
# one isolated line. Persisted into the saved model's config so
# inference code can read it back instead of hardcoding it.
# ============================================================
WINDOW_SIZE = 5
MAX_LENGTH = 256
WINDOW_HALF = WINDOW_SIZE // 2


# ============================================================
# SECTION 6: Evaluation Metrics
#
# Reports both weighted and macro averages for precision/recall/f1.
# Weighted is dominated by normal_play (the majority class), so a
# model can look good on it while doing badly on rare events. Macro
# treats every class equally, which is why Stage 1's best checkpoint
# is selected by f1_macro instead of the weighted f1.
#
# The model always returns both heads' outputs, but only one head is
# actually being trained per stage - the other one's weights are
# frozen (or not yet trained), so its predictions are meaningless
# noise for that stage. Reporting classification metrics on a frozen
# classifier (Stage 2) or MSE/MAE on an untrained regressor (Stage 1)
# is misleading, so make_compute_metrics only computes the metrics
# that correspond to the stage actually being trained.
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
# SECTION 7: Data Preprocessing Helpers
#
# Turns uploaded CSVs into windowed training rows, computes
# per-class loss weights, and logs a per-class breakdown of the
# best Stage 1 checkpoint. Used by run_train() below.
# ============================================================
def build_windowed_dataframe(csv_files, label2id):
    """
    Builds sliding-window training rows per CSV file, BEFORE concatenating
    them together, so a window can never bridge two different uploaded
    matches. The first and last WINDOW_HALF rows of each file are dropped
    rather than padded with a shorter window, so every training sample has
    full context.
    """
    windowed_dfs = []
    for f in csv_files:
        d = pd.read_csv(f)
        if 'event_class' in d.columns:
            d['label'] = d['event_class'].apply(lambda x: label2id.get(str(x).strip(), 0) if pd.notna(x) else 0)
        elif 'event' in d.columns:
            d['label'] = d['event'].apply(lambda x: label2id.get(str(x).strip(), 0) if pd.notna(x) else 0)

        if 'highlight_score' in d.columns:
            d['highlight_label'] = pd.to_numeric(d['highlight_score'], errors='coerce').fillna(0.0)
        else:
            d['highlight_label'] = 0.0

        d = d.dropna(subset=['text']).reset_index(drop=True)
        texts = d['text'].tolist()

        if len(texts) <= 2 * WINDOW_HALF:
            print(f"Skipping {f}: only {len(texts)} rows, need more than {2 * WINDOW_HALF} for window size {WINDOW_SIZE}")
            continue

        rows = []
        for i in range(WINDOW_HALF, len(texts) - WINDOW_HALF):
            window_text = " ".join(texts[i - WINDOW_HALF : i + WINDOW_HALF + 1])
            rows.append({
                'text': window_text,
                'label': d.loc[i, 'label'],
                'highlight_label': d.loc[i, 'highlight_label'],
            })
        windowed_dfs.append(pd.DataFrame(rows))

    return pd.concat(windowed_dfs, ignore_index=True)

def compute_class_weights(df_balanced, num_labels):
    total_samples = len(df_balanced)
    class_counts = df_balanced['label'].value_counts().to_dict()
    weights = []
    for i in range(num_labels):
        count = class_counts.get(i, 0)
        w = total_samples / (num_labels * count) if count > 0 else 1.0
        # FocalLoss handles class imbalance automatically.
        # Do NOT artificially down-weight normal_play here — it causes the model
        # to treat false positives as acceptable, destroying precision.
        weights.append(w)
    return torch.tensor(weights, dtype=torch.float)

def log_stage1_classification_report(trainer_stage1, test_dataset, id2label, num_labels):
    """Per-class breakdown of the best Stage 1 checkpoint, printed so it
    shows up in the live log stream the frontend polls."""
    pred_output = trainer_stage1.predict(test_dataset)
    event_logits, _ = pred_output.predictions
    event_labels, _ = pred_output.label_ids
    event_preds = event_logits.argmax(axis=-1)
    target_names = [id2label[i] for i in range(num_labels)]
    print("Stage 1 per-class report on held-out test split:")
    print(classification_report(
        event_labels, event_preds, labels=list(range(num_labels)), target_names=target_names, zero_division=0
    ))


# ============================================================
# SECTION 8: FastAPI Application & Whisper Model
# ============================================================
app = FastAPI()

print("Loading Whisper model (medium) ...")
whisper_model = whisper.load_model("medium")
print("Whisper model loaded!")


# ============================================================
# SECTION 9: Transcription Endpoint
# ============================================================
def run_transcribe(task_id, file_location):
    try:
        print(f"Task {task_id}: Starting Whisper Transcription...")
        initial_prompt = (
            "Rugby union commentary. Teams: Ireland, South Africa, England, France, New Zealand, Australia, Wales, Scotland. "
            "Rugby terms: try, conversion, penalty goal, drop goal, scrum, lineout, ruck, maul, offload, tackle, breakdown, turnover, "
            "sin bin, yellow card, red card, TMO, knock on, forward pass, offside, high tackle, line break, grubber kick, box kick."
        )
            
        result = whisper_model.transcribe(
            file_location,
            language="en",
            initial_prompt=initial_prompt,
            condition_on_previous_text=True,
            compression_ratio_threshold=2.4,
            no_speech_threshold=0.6,
            word_timestamps=True,
            verbose=True # Forces Whisper to print to stdout so we can catch it!
        )
        
        os.remove(file_location)
        # Set result_data before status: a poller reading "status: completed" must
        # never observe a dict where result_data is still missing (see predict_only.py
        # bug where a completed-but-dataless response wrote a null transcript).
        tasks[task_id]["result_data"] = jsonable_encoder(result["segments"])
        tasks[task_id]["status"] = "completed"
        print(f"Task {task_id}: Transcription completed successfully.")
    except Exception as e:
        print(f"Task {task_id} failed: {str(e)}")
        tasks[task_id]["status"] = "failed"

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    task_id = str(uuid.uuid4())
    catcher.logs = [] # Reset logs for new task
    tasks[task_id] = {"status": "running"}
    
    file_location = f"/content/{file.filename}"
    with open(file_location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    threading.Thread(target=run_transcribe, args=(task_id, file_location)).start()
    return {"task_id": task_id}


# ============================================================
# SECTION 10: Training Endpoint
#
# Runs the Stage 1 (event classifier) + Stage 2 (highlight scorer)
# training pipeline on the uploaded CSVs, then zips the best model
# so the frontend can download it for local predictions.
# ============================================================
def run_train(task_id, zip_path, model_name):
    try:
        print(f"Task {task_id}: Starting Training for {model_name}...")
        extract_dir = f"/content/training_data_{task_id}"
        output_dir = f"/content/model_output_{model_name.replace('/', '_')}"

        os.makedirs(extract_dir, exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)

        # Only extract the CSV data sent from the frontend (~1MB, not the full model)
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)

        # Read events.json
        events_path = os.path.join(extract_dir, "events.json")
        events = ["highlight"]
        if os.path.exists(events_path):
            with open(events_path, 'r') as f:
                events = json.load(f)

        label2id = {"normal_play": 0}
        id2label = {0: "normal_play"}
        for i, evt in enumerate(events, start=1):
            label2id[evt] = i
            id2label[i] = evt

        num_labels = len(label2id)

        print(f"Starting fresh training from '{model_name}'.")
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = DualHeadRoBERTa(
            model_name, num_labels=num_labels, id2label=id2label, label2id=label2id
        )

        csv_files = glob.glob(os.path.join(extract_dir, "**", "*.csv"), recursive=True)
        df = build_windowed_dataframe(csv_files, label2id)
        df_balanced = df.sample(frac=1, random_state=42).reset_index(drop=True)
        class_weights = compute_class_weights(df_balanced, num_labels)

        # stratify_by_column keeps every event class represented in both the
        # train and test split, proportional to its overall frequency -
        # without it, a plain random split can leave a rare class with zero
        # test rows. train_test_split requires the stratify column to be a
        # ClassLabel feature, hence the cast.
        dataset = Dataset.from_pandas(df_balanced)
        dataset = dataset.cast_column(
            'label', ClassLabel(num_classes=num_labels, names=[id2label[i] for i in range(num_labels)])
        )

        def tokenize_func(examples):
            tokenized = tokenizer(examples['text'], padding="max_length", truncation=True, max_length=MAX_LENGTH)
            tokenized['labels'] = examples['label']
            tokenized['highlight_labels'] = examples['highlight_label']
            return tokenized

        tokenized_datasets = dataset.map(tokenize_func, batched=True)
        split_datasets = tokenized_datasets.train_test_split(test_size=0.2, seed=42, stratify_by_column='label')

        def get_training_args(output_dir_suffix, epochs=5, metric_for_best_model="loss", greater_is_better=None):
            return TrainingArguments(
                output_dir=f"{output_dir}/{output_dir_suffix}",
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
                disable_tqdm=False, # We want tqdm so we can catch it in stdout!
                learning_rate=2e-5,
                warmup_ratio=0.1
            )

        print("Starting Stage 1: Training Event Classifier...")
        # metric_for_best_model="f1_macro" makes load_best_model_at_end restore
        # the epoch that was actually best at classifying events (weighted
        # across all classes equally), not just the epoch with the lowest loss.
        trainer_stage1 = CustomTrainer(
            model=model,
            args=get_training_args("stage1", epochs=25, metric_for_best_model="f1_macro", greater_is_better=True),
            train_dataset=split_datasets['train'],
            eval_dataset=split_datasets['test'],
            class_weights=class_weights,
            stage=1,
            compute_metrics=make_compute_metrics(1),
        )
        trainer_stage1.train()

        log_stage1_classification_report(trainer_stage1, split_datasets['test'], id2label, num_labels)

        print("Starting Stage 2: Training Highlight Scorer...")
        # Freeze backbone and event classifier for Stage 2
        for name, param in model.named_parameters():
            if 'highlight_scorer' not in name:
                param.requires_grad = False

        # metric_for_best_model="mse" + greater_is_better=False restores the
        # epoch with the lowest highlight-score error, same reasoning as
        # Stage 1's f1_macro choice.
        trainer_stage2 = CustomTrainer(
            model=model,
            args=get_training_args("stage2", epochs=5, metric_for_best_model="mse", greater_is_better=False),
            train_dataset=split_datasets['train'],
            eval_dataset=split_datasets['test'],
            class_weights=class_weights,
            stage=2,
            compute_metrics=make_compute_metrics(2),
        )
        trainer_stage2.train()

        # Unfreeze after training
        for param in model.parameters():
            param.requires_grad = True

        # `model` already holds the best checkpoint's weights, not the last
        # epoch's: load_best_model_at_end restores the best-f1_macro epoch
        # after trainer_stage1.train() and the best-mse epoch after
        # trainer_stage2.train(). So this is already the best event
        # classifier + best highlight scorer, combined into one model.
        #
        # window_size/tokenizer_max_length are stashed on the config so
        # inference code can read back how this model expects its input to
        # be windowed, instead of hardcoding it separately.
        model.config.window_size = WINDOW_SIZE
        model.config.tokenizer_max_length = MAX_LENGTH

        # Zip the best model so the frontend can download it locally for predictions.
        best_dir = os.path.join(output_dir, "best")
        os.makedirs(best_dir, exist_ok=True)
        torch.save(model.state_dict(), os.path.join(best_dir, "pytorch_model.bin"))
        model.config.save_pretrained(best_dir)
        tokenizer.save_pretrained(best_dir)

        # Also write window_size/tokenizer_max_length as a plain sidecar file,
        # not just on model.config. transformers' config serialization is not
        # guaranteed to round-trip arbitrary custom attributes across every
        # version - if it silently drops them, inference falls back to
        # window_size=1 (unwindowed) while the model was actually trained on
        # WINDOW_SIZE-chunk context, which degrades predictions badly. This
        # file is unambiguous and always readable regardless of that.
        with open(os.path.join(best_dir, "training_meta.json"), "w") as f:
            json.dump({"window_size": WINDOW_SIZE, "tokenizer_max_length": MAX_LENGTH}, f)

        out_zip = f"/content/{model_name.replace('/', '_')}_trained.zip"
        shutil.make_archive(out_zip.replace('.zip', ''), 'zip', best_dir)

        print(f"Task {task_id}: Training complete! Model zipped to {out_zip}")
        tasks[task_id]["status"] = "completed"
        tasks[task_id]["result_file"] = out_zip
    except Exception as e:
        import traceback
        print(f"Task {task_id} failed:")
        traceback.print_exc()
        tasks[task_id]["status"] = "failed"

@app.post("/train")
async def train_model(file: UploadFile = File(...), model_name: str = Form(...)):
    task_id = str(uuid.uuid4())
    catcher.logs = [] # Reset logs for new task
    tasks[task_id] = {"status": "running"}
    
    zip_path = f"/content/upload_{task_id}.zip"
    with open(zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    threading.Thread(target=run_train, args=(task_id, zip_path, model_name)).start()
    return {"task_id": task_id}


# ============================================================
# SECTION 11: Status & Download Endpoints
# ============================================================
@app.get("/status/{task_id}")
async def get_status(task_id: str):
    if task_id not in tasks:
        return {"status": "error", "message": "Task not found"}
        
    # Drain logs (return logs and clear them so we don't send duplicates)
    current_logs = list(catcher.logs)
    catcher.logs.clear()
    
    return {
        "status": tasks[task_id]["status"],
        "logs": current_logs,
        "result_data": tasks[task_id].get("result_data")
    }

@app.get("/download/{task_id}")
async def download_result(task_id: str):
    if task_id not in tasks or tasks[task_id]["status"] != "completed":
        return {"error": "Not ready"}
    file_path = tasks[task_id].get("result_file")
    if not file_path or not os.path.exists(file_path):
        return {"error": "File not found"}
    return FileResponse(file_path, media_type="application/zip", filename=os.path.basename(file_path))


# ============================================================
# SECTION 12: Server Startup (ngrok tunnel + uvicorn)
# ============================================================
NGROK_TOKEN = "3HaGzT01qmCqQsQt9O4XeApdUo4_7hTA4NQeb6jCiHP3JagCx" # <-- PASTE YOUR NGROK TOKEN HERE
ngrok.set_auth_token(NGROK_TOKEN)
ngrok.kill()
public_url = ngrok.connect(8000).public_url

print(f"\n=======================================================")
print(f"✅ YOUR CLOUD API IS LIVE AT: {public_url}")
print(f"✅ Update your local system's .env file with this URL!")
print(f"=======================================================\n")

# Start Uvicorn in a background thread so it doesn't fight Jupyter's event loop
def run_server():
    uvicorn.run(app, host="0.0.0.0", port=8000, access_log=False)

threading.Thread(target=run_server, daemon=True).start()

# Keep the main thread alive so the Colab cell doesn't finish!
import time
while True:
    time.sleep(1)
