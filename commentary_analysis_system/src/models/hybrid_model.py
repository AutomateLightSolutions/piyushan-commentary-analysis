from src.models.transformer_classifier import TransformerClassifier
from src.models.lexicon_model import LexiconModel

class HybridModel:
    def __init__(self, roberta_model_path=None, model_name="roberta-base"):
        self.roberta = TransformerClassifier(model_name=model_name)
        if roberta_model_path:
            self.roberta.load_model(roberta_model_path)
            
        self.lexicon = LexiconModel()
        
    def predict(self, text_list: list[str], lexicon_weight=0.3):
        """
        Generates combined score using booster formula: min(1.0, RoBERTa + (Lexicon * lexicon_weight))
        """
        roberta_probs = self.roberta.predict_probs(text_list)
        
        results = []
        for text, r_probs in zip(text_list, roberta_probs):
            l_prob = self.lexicon.score_chunk(text)
            
            # r_probs is a list of probabilities for each class
            # Highlight probability is 1.0 - probability of normal_play (index 0)
            base_highlight_prob = 1.0 - r_probs[0]
            
            # Predict the specific event (argmax)
            max_prob = -1
            predicted_event_id = 0
            for i, p in enumerate(r_probs):
                if p > max_prob:
                    max_prob = p
                    predicted_event_id = i
                    
            predicted_event = self.roberta.id2label.get(predicted_event_id, "normal_play")
            
            # Booster formula: Lexicon score boosts the RoBERTa base score
            hybrid_score = min(1.0, base_highlight_prob + (l_prob * lexicon_weight))
            
            results.append({
                "roberta_score": base_highlight_prob,
                "lexicon_score": l_prob,
                "hybrid_score": hybrid_score,
                "predicted_event": predicted_event,
                "predicted_event_prob": max_prob
            })
            
        return results
