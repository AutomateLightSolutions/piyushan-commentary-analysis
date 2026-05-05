from transformers import RobertaTokenizer, RobertaForSequenceClassification, Trainer, TrainingArguments
from datasets import Dataset
import torch
import pandas as pd

class RobertaClassifier:
    def __init__(self, model_name="roberta-base"):
        self.tokenizer = RobertaTokenizer.from_pretrained(model_name)
        # 2 labels: 0 for non-highlight, 1 for highlight
        self.model = RobertaForSequenceClassification.from_pretrained(model_name, num_labels=2)
        
    def prepare_dataset(self, text_list, labels=None):
        encodings = self.tokenizer(text_list, truncation=True, padding=True, max_length=128)
        
        dataset_dict = {
            'input_ids': encodings['input_ids'],
            'attention_mask': encodings['attention_mask'],
        }
        if labels is not None:
            dataset_dict['labels'] = labels
            
        return Dataset.from_dict(dataset_dict)
        
    def train(self, data_files, output_dir="./models/roberta_finetuned", epochs=3, batch_size=16):
        # Convert CSVs safely eliminating massive RAM spikes using Apache Arrow mapping
        from datasets import load_dataset
        dataset = load_dataset('csv', data_files=data_files)
        
        # Strip corrupted/null text fields
        dataset = dataset.filter(lambda x: x['text'] is not None)
        
        # Dynamic Tokenization across batches
        def tokenize_func(examples):
            # Assumes CSVs map text and label accurately
            tokenized = self.tokenizer(examples['text'], padding="max_length", truncation=True, max_length=128)
            tokenized['labels'] = examples['label']
            return tokenized
            
        tokenized_datasets = dataset.map(tokenize_func, batched=True, remove_columns=dataset['train'].column_names)
        
        # 80/20 train validation split natively
        split_datasets = tokenized_datasets['train'].train_test_split(test_size=0.2, seed=42)
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

        trainer = Trainer(
            model=self.model,
            args=training_args,
            train_dataset=train_dataset,
            eval_dataset=val_dataset,
        )

        trainer.train()
        self.model.save_pretrained(f"{output_dir}/best")
        self.tokenizer.save_pretrained(f"{output_dir}/best")
        
    def load_model(self, model_path):
        self.model = RobertaForSequenceClassification.from_pretrained(model_path)
        self.tokenizer = RobertaTokenizer.from_pretrained(model_path)
        
    def predict_probs(self, text_list):
        """Returns the probability of class 1 (highlight)"""
        dataset = self.prepare_dataset(text_list)
        
        # Disable gradient calc for inference
        self.model.eval()
        
        # For simplicity without dataloader, suitable for batches
        # Can be scaled using Trainer.predict()
        inputs = self.tokenizer(text_list, padding=True, truncation=True, return_tensors="pt")
        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits
            probs = torch.softmax(logits, dim=-1)
            
        return probs[:, 1].tolist()
