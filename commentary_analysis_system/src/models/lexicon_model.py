import re
import json
import os

class LexiconModel:
    def __init__(self, config_path=None):
        if config_path is None:
            # Default path relative to this file or absolute path
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            config_path = os.path.join(base_dir, "data", "lexicon.json")
        
        self.config_path = config_path
        self.load_config()

    def load_config(self):
        try:
            with open(self.config_path, 'r') as f:
                self.config = json.load(f)
        except Exception as e:
            print(f"Error loading lexicon config: {e}")
            # Fallback to empty if file not found
            self.config = {"categories": []}

    def _count_matches(self, text: str, terms: list[str]) -> int:
        count = 0
        
        # Simple negation words to check before the term
        negations = ["no", "not", "missed", "missed the"]
        
        for term in terms:
            if "\\" in term:
                pattern = term
            else:
                escaped_term = re.escape(term)
                # Allow common suffixes (e.g. score -> scores, scored, scoring)
                pattern = rf"\b{escaped_term}(?:s|ed|ing|d)?\b"
                
            for match in re.finditer(pattern, text, re.IGNORECASE):
                # Check for negation in the preceding context
                start_idx = match.start()
                preceding_text = text[max(0, start_idx - 15):start_idx].lower()
                
                is_negated = False
                for neg in negations:
                    if preceding_text.strip().endswith(neg):
                        is_negated = True
                        break
                
                if not is_negated:
                    count += 1
                    
        return count

    def generate_features(self, text: str) -> dict:
        """Counts frequency of category keywords in the chunk."""
        text = text.lower()
        features = {}
        for category in self.config.get("categories", []):
            cat_id = category["id"]
            terms = category.get("terms", [])
            # Return actual count for frequency scaling instead of binary 1/0
            features[cat_id] = self._count_matches(text, terms)
        return features

    def score_chunk(self, text: str) -> float:
        """
        Calculates Lexicon Score (0.0 to 1.0) using weighted aggregation.
        """
        feats = self.generate_features(text)
        
        raw_score = 0.0
        for category in self.config.get("categories", []):
            cat_id = category["id"]
            weight = category.get("weight", 0.0)
            raw_score += feats.get(cat_id, 0) * weight
            
        return min(raw_score, 1.0)
