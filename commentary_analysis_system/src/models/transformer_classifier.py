from transformers import AutoTokenizer, AutoModelForSequenceClassification, Trainer, TrainingArguments
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

class CustomTrainer(Trainer):
    def __init__(self, *args, class_weights=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.loss_fct = FocalLoss(alpha=class_weights, gamma=2.0)

    def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
        labels = inputs.pop("labels")
        outputs = model(**inputs)
        logits = outputs.logits
        
        if self.loss_fct.alpha is not None and self.loss_fct.alpha.device != logits.device:
            self.loss_fct.alpha = self.loss_fct.alpha.to(logits.device)
            
        loss = self.loss_fct(logits.view(-1, self.model.config.num_labels), labels.view(-1))
            
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
        
        self.model = AutoModelForSequenceClassification.from_pretrained(
            model_name, 
            num_labels=self.num_labels,
            id2label=self.id2label,
            label2id=self.label2id,
            ignore_mismatched_sizes=True
        )
        
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
                if 'event' in d.columns:
                    d['label'] = d['event'].apply(lambda x: self.label2id.get(str(x).strip(), 0) if pd.notna(x) else 0)
                elif 'label' not in d.columns:
                    continue # Cannot use this data
                dfs.append(d)
            except Exception as e:
                pass
                
        if not dfs:
            raise ValueError("No valid training data found.")
            
        df = pd.concat(dfs, ignore_index=True)
        df = df.dropna(subset=['text'])
        
        # 2. Balance dataset - We keep all negative data and rely on Focal Loss to handle imbalance
        df_balanced = df.sample(frac=1, random_state=42).reset_index(drop=True)
        
        # 3. Compute class weights for the loss function
        total_samples = len(df_balanced)
        class_counts = df_balanced['label'].value_counts().to_dict()
        
        weights = []
        for i in range(self.num_labels):
            count = class_counts.get(i, 0)
            w = total_samples / (self.num_labels * count) if count > 0 else 1.0
            weights.append(w)
            
        class_weights = torch.tensor(weights, dtype=torch.float)
        
        # 4. Convert back to HuggingFace Dataset
        dataset = Dataset.from_pandas(df_balanced)
        
        # Dynamic Tokenization across batches
        def tokenize_func(examples):
            tokenized = self.tokenizer(examples['text'], padding="max_length", truncation=True, max_length=128)
            tokenized['labels'] = examples['label']
            return tokenized
            
        tokenized_datasets = dataset.map(tokenize_func, batched=True)
        
        # 80/20 train validation split natively
        split_datasets = tokenized_datasets.train_test_split(test_size=0.2, seed=42)
        train_dataset = split_datasets['train']
        val_dataset = split_datasets['test']

        training_args = TrainingArguments(
            output_dir=output_dir,
            num_train_epochs=epochs,
            per_device_train_batch_size=batch_size,
            per_device_eval_batch_size=batch_size,
            eval_strategy="epoch",
            logging_strategy="steps",
            logging_steps=5,
            save_strategy="epoch",
            load_best_model_at_end=True,
            disable_tqdm=True,
        )

        trainer = CustomTrainer(
            model=self.model,
            args=training_args,
            train_dataset=train_dataset,
            eval_dataset=val_dataset,
            class_weights=class_weights
        )

        trainer.train()
        self.model.save_pretrained(f"{output_dir}/best")
        self.tokenizer.save_pretrained(f"{output_dir}/best")
        
    def load_model(self, model_path):
        self.model = AutoModelForSequenceClassification.from_pretrained(model_path)
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.num_labels = self.model.config.num_labels
        self.id2label = self.model.config.id2label
        self.label2id = self.model.config.label2id
        
    def predict_probs(self, text_list, batch_size=32):
        """Returns the full probability distribution across all classes."""
        self.model.eval()
        device = next(self.model.parameters()).device
        
        all_probs = []
        for i in range(0, len(text_list), batch_size):
            batch_texts = text_list[i:i+batch_size]
            inputs = self.tokenizer(batch_texts, padding=True, truncation=True, return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}
            
            with torch.no_grad():
                outputs = self.model(**inputs)
                logits = outputs.logits
                probs = torch.softmax(logits, dim=-1)
                all_probs.extend(probs.tolist())
                
        return all_probs
