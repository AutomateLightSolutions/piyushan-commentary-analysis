import os
import json
import re
from collections import defaultdict
import nltk
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from nltk.util import ngrams
import uuid
import datetime

class LexiconBuilder:
    def __init__(self, runs_dir=None):
        if runs_dir is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            runs_dir = os.path.join(base_dir, "data", "lexicon_runs")
        
        self.runs_dir = runs_dir
        os.makedirs(self.runs_dir, exist_ok=True)
        
        self.frequencies = defaultdict(lambda: defaultdict(int))
        self._ensure_nltk_data()
        
        # Load English stopwords
        self.stop_words = set(stopwords.words('english'))
        # Add custom rugby/commentary specific stopwords if needed
        self.stop_words.update(['well', 'oh', 'ah', 'yeah', 'yes', 'no', 'just', 'like'])

    def _ensure_nltk_data(self):
        """Ensure NLTK datasets are downloaded."""
        try:
            nltk.data.find('tokenizers/punkt')
            nltk.data.find('tokenizers/punkt_tab')
        except LookupError:
            print("Downloading NLTK punkt and punkt_tab tokenizer...")
            nltk.download('punkt', quiet=True)
            nltk.download('punkt_tab', quiet=True)
            
        try:
            nltk.data.find('corpora/stopwords')
        except LookupError:
            print("Downloading NLTK stopwords...")
            nltk.download('stopwords', quiet=True)

    def is_valid_word(self, word):
        """Check if a word should be kept (not stopword, has alphabets)."""
        if len(word) <= 2: return False
        if word in self.stop_words: return False
        if not re.search('[a-zA-Z]', word): return False
        return True

    def extract_terms(self, text):
        """Extracts valid unigrams, bigrams, and trigrams from text."""
        # Convert to lower and keep basic punctuation out of words
        text = text.lower()
        # Clean text
        text = re.sub(r'[^\w\s]', ' ', text)
        
        # Tokenize
        tokens = word_tokenize(text)
        
        extracted_terms = []
        
        # 1. Unigrams
        valid_unigrams = [t for t in tokens if self.is_valid_word(t)]
        extracted_terms.extend(valid_unigrams)
        
        # 2. Bigrams & Trigrams
        for n in [2, 3]:
            for gram in ngrams(tokens, n):
                if any(self.is_valid_word(w) for w in gram):
                    term = " ".join(gram)
                    extracted_terms.append(term)
                    
        return extracted_terms

    def process_chunk(self, text: str, event_label: str):
        """Extracts terms from a chunk of text and updates frequencies for the given event."""
        if not text or not event_label:
            return
            
        terms = self.extract_terms(text)
        for term in terms:
            self.frequencies[event_label][term] += 1
            
    def process_dataset(self, data: list, source_id: str = None, source_name: str = None):
        """
        Process a list of dictionaries containing 'text' and 'event_label'.
        data = [{'text': 'he crosses over', 'event_label': 'try_scoring'}, ...]
        """
        # Reset frequencies for this specific run
        self.frequencies = defaultdict(lambda: defaultdict(int))
        
        for item in data:
            self.process_chunk(item.get('text', ''), item.get('event_label', ''))
            
        if not source_id:
            source_id = str(uuid.uuid4())
        if not source_name:
            source_name = f"Unknown Source {source_id[:8]}"
            
        self._save_run(source_id, source_name)

    def _save_run(self, source_id, source_name):
        """Saves the current isolated run frequencies to a timestamped file."""
        run_id = f"run_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        run_file_path = os.path.join(self.runs_dir, f"{run_id}.json")
        
        run_data = {
            "run_id": run_id,
            "timestamp": datetime.datetime.now().isoformat(),
            "sources": [
                {
                    "id": source_id,
                    "name": source_name
                }
            ],
            "frequencies": self.frequencies
        }
        
        with open(run_file_path, 'w', encoding='utf-8') as f:
            json.dump(run_data, f, indent=4)
            
        print(f"Run {run_id} saved successfully with source: {source_name}")

