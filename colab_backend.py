# Run this script in a Google Colab Notebook cell:
# 
# !pip install pyngrok fastapi uvicorn python-multipart openai-whisper pydantic nest-asyncio transformers datasets torch pandas scikit-learn
# 
# Paste the following code into the next cell and run it.

import os
import sys
import shutil
import zipfile
import json
import threading
import uuid
import nest_asyncio
from pyngrok import ngrok
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse
import uvicorn

import whisper
from transformers import AutoTokenizer, AutoModelForSequenceClassification, Trainer, TrainingArguments, AutoModel
from datasets import Dataset
import torch
import torch.nn as nn
import torch.nn.functional as F
import pandas as pd

nest_asyncio.apply()

# ==========================================
# stdout / stderr Catcher for Live Logs
# ==========================================
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

# ==========================================
# Transformer Classifier Logic
# ==========================================

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
        pooled_output = outputs.pooler_output
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

class CustomTrainer(Trainer):
    def __init__(self, *args, class_weights=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.loss_fct_events = FocalLoss(alpha=class_weights, gamma=2.0)
        self.loss_fct_highlights = nn.MSELoss()

    def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
        labels = inputs.pop("labels")
        highlight_labels = inputs.pop("highlight_labels")
        
        outputs = model(**inputs)
        logits = outputs.logits
        highlight_scores = outputs.highlight_scores
        
        if self.loss_fct_events.alpha is not None and self.loss_fct_events.alpha.device != logits.device:
            self.loss_fct_events.alpha = self.loss_fct_events.alpha.to(logits.device)
            
        event_loss = self.loss_fct_events(logits.view(-1, self.model.config.num_labels), labels.view(-1))
        highlight_loss = self.loss_fct_highlights(highlight_scores.view(-1), highlight_labels.view(-1).to(highlight_scores.dtype))
        
        # Weights: 1.0 for Events, 3.0 for Highlights (since MSE loss is naturally very small, this keeps Event Detection dominating)
        loss = event_loss + (3.0 * highlight_loss)
            
        return (loss, outputs) if return_outputs else loss

# ==========================================
# FastAPI Application
# ==========================================
app = FastAPI()

print("Loading Whisper model (medium) ...")
whisper_model = whisper.load_model("medium") 
print("Whisper model loaded!")

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
            verbose=True # Forces Whisper to print to stdout so we can catch it!
        )
        
        os.remove(file_location)
        tasks[task_id]["status"] = "completed"
        tasks[task_id]["result_data"] = result["segments"]
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

def run_train(task_id, zip_path, model_name):
    try:
        print(f"Task {task_id}: Starting Training for {model_name}...")
        extract_dir = f"/content/training_data_{task_id}"
        output_dir = f"/content/model_output_{model_name.replace('/', '_')}"
        
        os.makedirs(extract_dir, exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)
        
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
        print("Loading HuggingFace model into VRAM...")
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = DualHeadRoBERTa(
            model_name, num_labels=num_labels, id2label=id2label, label2id=label2id
        )
        
        csv_files = [os.path.join(extract_dir, f) for f in os.listdir(extract_dir) if f.endswith('.csv')]
        dfs = []
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
                
            dfs.append(d)
            
        df = pd.concat(dfs, ignore_index=True).dropna(subset=['text'])
        df_balanced = df.sample(frac=1, random_state=42).reset_index(drop=True)
        
        total_samples = len(df_balanced)
        class_counts = df_balanced['label'].value_counts().to_dict()
        weights = [total_samples / (num_labels * class_counts.get(i, 0)) if class_counts.get(i, 0) > 0 else 1.0 for i in range(num_labels)]
        class_weights = torch.tensor(weights, dtype=torch.float)
        
        dataset = Dataset.from_pandas(df_balanced)
        def tokenize_func(examples):
            tokenized = tokenizer(examples['text'], padding="max_length", truncation=True, max_length=128)
            tokenized['labels'] = examples['label']
            tokenized['highlight_labels'] = examples['highlight_label']
            return tokenized
            
        tokenized_datasets = dataset.map(tokenize_func, batched=True)
        split_datasets = tokenized_datasets.train_test_split(test_size=0.2, seed=42)
        
        training_args = TrainingArguments(
            output_dir=output_dir,
            num_train_epochs=15,
            per_device_train_batch_size=16,
            per_device_eval_batch_size=16,
            eval_strategy="epoch",
            logging_strategy="steps",
            logging_steps=5,
            save_strategy="epoch",
            load_best_model_at_end=True,
            disable_tqdm=False, # We want tqdm so we can catch it in stdout!
        )
        
        trainer = CustomTrainer(
            model=model,
            args=training_args,
            train_dataset=split_datasets['train'],
            eval_dataset=split_datasets['test'],
            class_weights=class_weights
        )
        
        print("Starting training loop...")
        trainer.train()
        
        best_dir = os.path.join(output_dir, "best")
        os.makedirs(best_dir, exist_ok=True)
        torch.save(model.state_dict(), os.path.join(best_dir, "pytorch_model.bin"))
        model.config.save_pretrained(best_dir)
        tokenizer.save_pretrained(best_dir)
        
        history_path = os.path.join(best_dir, "training_history.json")
        with open(history_path, 'w') as f:
            json.dump(trainer.state.log_history, f)
            
        out_zip = f"/content/{model_name.replace('/', '_')}_trained.zip"
        shutil.make_archive(out_zip.replace('.zip', ''), 'zip', best_dir)
        
        print(f"Task {task_id}: Training complete! Zipped to {out_zip}")
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


# Start server
NGROK_TOKEN = "3GwEt4nSMyyoJasWtZ7aOR6Uf89_5pWtkqYXVtPwUsxc4yJYM" # <-- PASTE YOUR NGROK TOKEN HERE
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
