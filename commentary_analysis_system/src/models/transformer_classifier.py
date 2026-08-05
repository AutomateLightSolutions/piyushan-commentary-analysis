from transformers import AutoTokenizer, AutoModelForSequenceClassification, Trainer, TrainingArguments, AutoModel
from datasets import Dataset
import torch
import pandas as pd
import torch.nn as nn
import json
import os

import torch.nn.functional as F

class FocalLoss(nn.Module):
    def __init__(self, alpha=None, gamma=2.0, reduction='mean'):
        super(FocalLoss, self).__init__()
        self.alpha = alpha
        self.gamma = gamma
        self.reduction = reduction

    def forward(self, inputs, targets):
        ce_loss = F.cross_entropy(inputs, targets, weight=self.alpha, reduction='none')
        pt = torch.exp(-ce_loss) # Prevents nans
        focal_loss = ((1 - pt) ** self.gamma) * ce_loss
        
        if self.reduction == 'mean':
            return focal_loss.mean()
        elif self.reduction == 'sum':
            return focal_loss.sum()
        return focal_loss

from transformers.modeling_outputs import ModelOutput
from dataclasses import dataclass
from typing import Optional

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
        self.event_classifier = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(self.config.hidden_size, num_labels)
        )
        self.highlight_scorer = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(self.config.hidden_size, 1)
        )

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
        
        if self.reduction == 'mean':
            return focal_loss.mean()
        elif self.reduction == 'sum':
            return focal_loss.sum()
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

class TransformerClassifier:
    def _load_events(self):
        try:
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            events_path = os.path.join(base_dir, "data", "events.json")
            with open(events_path, 'r') as f:
                events = json.load(f)
            
            label2id = {"normal_play": 0}
            id2label = {0: "normal_play"}
            for i, evt in enumerate(events, start=1):
                label2id[evt] = i
                id2label[i] = evt
            return label2id, id2label
        except Exception:
            return {"normal_play": 0, "highlight": 1}, {0: "normal_play", 1: "highlight"}

    def __init__(self, model_name="roberta-base"):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.label2id, self.id2label = self._load_events()
        self.num_labels = len(self.label2id)
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        self.model = DualHeadRoBERTa(
            model_name,
            num_labels=self.num_labels,
            id2label=self.id2label,
            label2id=self.label2id
        )
        self.model.to(self.device)
        
    def prepare_dataset(self, text_list, labels=None):
        encodings = self.tokenizer(text_list, truncation=True, padding=True, max_length=128)
        
        dataset_dict = {
            'input_ids': encodings['input_ids'],
            'attention_mask': encodings['attention_mask'],
        }
        if labels is not None:
            dataset_dict['labels'] = labels
            
        return Dataset.from_dict(dataset_dict)
        
    def train(self, data_files, output_dir="./models/finetuned", epochs=5, batch_size=16):
        import pandas as pd
        
        # 1. Load CSVs into a single DataFrame
        dfs = []
        for f in data_files:
            try:
                d = pd.read_csv(f)
                # Map new event schema to specific event label for training
                if 'event_class' in d.columns:
                    d['label'] = d['event_class'].apply(lambda x: self.label2id.get(str(x).strip(), 0) if pd.notna(x) else 0)
                elif 'event' in d.columns:
                    d['label'] = d['event'].apply(lambda x: self.label2id.get(str(x).strip(), 0) if pd.notna(x) else 0)
                elif 'label' not in d.columns:
                    continue # Cannot use this data
                    
                if 'highlight_score' in d.columns:
                    d['highlight_label'] = pd.to_numeric(d['highlight_score'], errors='coerce').fillna(0.0)
                else:
                    d['highlight_label'] = 0.0
                    
                dfs.append(d)
            except Exception as e:
                pass
                
        if not dfs:
            raise ValueError("No valid training data found.")
            
        df = pd.concat(dfs, ignore_index=True)
        # Handle column naming differences
        if 'Text' in df.columns and 'text' not in df.columns:
            df = df.rename(columns={'Text': 'text'})
            
        df = df.dropna(subset=['text'])
        
        # 2. Balance dataset - We keep all negative data and rely on Focal Loss to handle imbalance
        df_balanced = df.sample(frac=1, random_state=42).reset_index(drop=True)
        
        total_samples = len(df_balanced)
        class_counts = df_balanced['label'].value_counts().to_dict()
        
        weights = []
        for i in range(self.num_labels):
            count = class_counts.get(i, 0)
            w = total_samples / (self.num_labels * count) if count > 0 else 1.0
            # FocalLoss handles class imbalance automatically.
            # Do NOT artificially down-weight normal_play here — it causes the model
            # to treat false positives as acceptable, destroying precision.
            weights.append(w)
            
        class_weights = torch.tensor(weights, dtype=torch.float)
        
        # 4. Convert back to HuggingFace Dataset
        dataset = Dataset.from_pandas(df_balanced)
        
        # Dynamic Tokenization across batches
        def tokenize_func(examples):
            tokenized = self.tokenizer(examples['text'], padding="max_length", truncation=True, max_length=128)
            tokenized['labels'] = examples['label']
            tokenized['highlight_labels'] = examples['highlight_label']
            return tokenized
            
        tokenized_datasets = dataset.map(tokenize_func, batched=True)
        
        # 80/20 train validation split natively
        split_datasets = tokenized_datasets.train_test_split(test_size=0.2, seed=42)
        train_dataset = split_datasets['train']
        val_dataset = split_datasets['test']

        def get_training_args(output_dir_suffix, epochs=5):
            return TrainingArguments(
                output_dir=f"{output_dir}/{output_dir_suffix}",
                num_train_epochs=epochs,
                per_device_train_batch_size=batch_size,
                per_device_eval_batch_size=batch_size,
                eval_strategy="epoch",
                logging_strategy="steps",
                logging_steps=5,
                save_strategy="epoch",
                load_best_model_at_end=True,
                disable_tqdm=True,
                learning_rate=2e-5,
                warmup_ratio=0.1
            )

        print("Starting Stage 1: Training Event Classifier...")
        trainer_stage1 = CustomTrainer(
            model=self.model,
            args=get_training_args("stage1", epochs=5),
            train_dataset=train_dataset,
            eval_dataset=val_dataset,
            class_weights=class_weights,
            stage=1
        )
        trainer_stage1.train()

        print("Starting Stage 2: Training Highlight Scorer...")
        # Freeze backbone and event classifier for Stage 2
        for name, param in self.model.named_parameters():
            if 'highlight_scorer' not in name:
                param.requires_grad = False
                
        trainer_stage2 = CustomTrainer(
            model=self.model,
            args=get_training_args("stage2", epochs=5),
            train_dataset=train_dataset,
            eval_dataset=val_dataset,
            class_weights=class_weights,
            stage=2
        )
        trainer_stage2.train()
        
        # Unfreeze after training
        for param in self.model.parameters():
            param.requires_grad = True
        
        os.makedirs(f"{output_dir}/best", exist_ok=True)
        torch.save(self.model.state_dict(), f"{output_dir}/best/pytorch_model.bin")
        self.model.config.save_pretrained(f"{output_dir}/best")
        self.tokenizer.save_pretrained(f"{output_dir}/best")
        
    def load_model(self, model_path):
        from transformers import AutoConfig
        config = AutoConfig.from_pretrained(model_path)
        self.num_labels = config.num_labels
        self.id2label = config.id2label
        self.label2id = config.label2id
        
        # It's a custom model, we extract the base model name from config usually or fall back
        model_name = getattr(config, "_name_or_path", "roberta-base")
        self.model = DualHeadRoBERTa(model_name, self.num_labels, self.id2label, self.label2id)
        
        state_dict = torch.load(os.path.join(model_path, "pytorch_model.bin"), map_location="cpu")

        # --- Backward-compat: remap keys from old architecture (plain Linear heads)
        # to new architecture (Sequential(Dropout, Linear) heads where Linear is index 1)
        key_map = {
            "event_classifier.weight":  "event_classifier.1.weight",
            "event_classifier.bias":    "event_classifier.1.bias",
            "highlight_scorer.weight":  "highlight_scorer.1.weight",
            "highlight_scorer.bias":    "highlight_scorer.1.bias",
        }
        remapped = {}
        for k, v in state_dict.items():
            remapped[key_map.get(k, k)] = v
        state_dict = remapped

        self.model.load_state_dict(state_dict)
        self.model.to(self.device)
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        
    def predict_probs(self, text_list, batch_size=32):
        """Returns (event_probs, highlight_scores)."""
        self.model.eval()
        device = next(self.model.parameters()).device
        
        all_event_probs = []
        all_highlight_scores = []
        
        for i in range(0, len(text_list), batch_size):
            batch_texts = text_list[i:i+batch_size]
            inputs = self.tokenizer(batch_texts, padding=True, truncation=True, return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}
            
            with torch.no_grad():
                outputs = self.model(**inputs)
                logits = outputs.logits
                probs = torch.softmax(logits, dim=-1)
                all_event_probs.extend(probs.tolist())
                
                # highlight_scores is already shape (batch, 1) and passed through sigmoid
                h_scores = outputs.highlight_scores.view(-1).tolist()
                all_highlight_scores.extend(h_scores)
                
        return all_event_probs, all_highlight_scores
