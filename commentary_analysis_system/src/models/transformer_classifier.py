from transformers import AutoTokenizer, AutoModelForSequenceClassification, Trainer, TrainingArguments
from datasets import Dataset
import torch
import pandas as pd
import torch.nn as nn

class CustomTrainer(Trainer):
    def __init__(self, *args, class_weights=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.class_weights = class_weights

    def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
        labels = inputs.pop("labels")
        outputs = model(**inputs)
        logits = outputs.logits
        
        if self.class_weights is not None:
            loss_fct = nn.CrossEntropyLoss(weight=self.class_weights.to(model.device))
            loss = loss_fct(logits.view(-1, self.model.config.num_labels), labels.view(-1))
        else:
            loss_fct = nn.CrossEntropyLoss()
            loss = loss_fct(logits.view(-1, self.model.config.num_labels), labels.view(-1))
            
        return (loss, outputs) if return_outputs else loss

class TransformerClassifier:
    def __init__(self, model_name="roberta-base"):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        # 2 labels: 0 for non-highlight, 1 for highlight
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name, num_labels=2)
        
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
                # Map new event schema to legacy binary label for training
                if 'event' in d.columns:
                    d['label'] = d['event'].apply(lambda x: 1 if pd.notna(x) and str(x).strip() not in ['', '-', 'None'] else 0)
                elif 'label' not in d.columns:
                    continue # Cannot use this data
                dfs.append(d)
            except Exception as e:
                pass
                
        if not dfs:
            raise ValueError("No valid training data found.")
            
        df = pd.concat(dfs, ignore_index=True)
        df = df.dropna(subset=['text'])
        
        # 2. Balance dataset (Option A: Downsample class 0 to 1:2 ratio)
        df_1 = df[df.label == 1]
        df_0 = df[df.label == 0]
        
        if len(df_0) > len(df_1) * 2:
            df_0 = df_0.sample(len(df_1) * 2, random_state=42)
            
        df_balanced = pd.concat([df_0, df_1]).sample(frac=1, random_state=42).reset_index(drop=True)
        
        # 3. Compute class weights for the loss function
        total_samples = len(df_balanced)
        count_0 = len(df_balanced[df_balanced.label == 0])
        count_1 = len(df_balanced[df_balanced.label == 1])
        
        weight_0 = total_samples / (2.0 * count_0) if count_0 > 0 else 1.0
        weight_1 = total_samples / (2.0 * count_1) if count_1 > 0 else 1.0
        
        class_weights = torch.tensor([weight_0, weight_1], dtype=torch.float)
        
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
        
    def predict_probs(self, text_list):
        """Returns the probability of class 1 (highlight)"""
        dataset = self.prepare_dataset(text_list)
        
        # Disable gradient calc for inference
        self.model.eval()
        
        # For simplicity without dataloader, suitable for batches
        inputs = self.tokenizer(text_list, padding=True, truncation=True, return_tensors="pt")
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits
            probs = torch.softmax(logits, dim=-1)
            
        return probs[:, 1].tolist()
