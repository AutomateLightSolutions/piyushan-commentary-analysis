from src.models.transformer_classifier import TransformerClassifier
from src.models.lexicon_model import LexiconModel

class HybridModel:
    def __init__(self, roberta_model_path=None, model_name="roberta-base"):
        self.roberta = TransformerClassifier(model_name=model_name)
        if roberta_model_path:
            self.roberta.load_model(roberta_model_path)
            
        self.lexicon = LexiconModel()
        
    def predict(self, text_list: list[str], lexicon_weight=0.3, roberta_weight=1.0):
        """
        Generates combined score using booster formula: min(1.0, (RoBERTa * roberta_weight) + (Lexicon * lexicon_weight))
        """
        roberta_probs = self.roberta.predict_probs(text_list)
        
        results = []
        for text, r_probs in zip(text_list, roberta_probs):
            # Overall highlight score from lexicon
            l_prob = self.lexicon.score_chunk(text)
            
            # r_probs is a list of probabilities for each class
            # Highlight probability is 1.0 - probability of normal_play (index 0)
            base_highlight_prob = 1.0 - r_probs[0]
            
            # Booster formula: Lexicon score boosts the RoBERTa base score
            hybrid_score = min(1.0, (base_highlight_prob * roberta_weight) + (l_prob * lexicon_weight))
            
            # Predict the specific event using event-specific lexicon features
            lexicon_features = self.lexicon.generate_features(text)
            
            max_hybrid_prob = -1
            predicted_event_id = 0
            
            for i, p in enumerate(r_probs):
                event_name = self.roberta.id2label.get(i, "normal_play")
                
                # Get the lexicon score specifically for this event
                l_prob_for_event = lexicon_features.get(event_name, 0.0)
                
                # Normalize lexicon score (similar to how score_chunk scales weights)
                l_prob_normalized = min(1.0, float(l_prob_for_event) * 100.0)
                
                # Combine them for this specific event
                event_hybrid_prob = (p * roberta_weight) + (l_prob_normalized * lexicon_weight)
                
                if event_hybrid_prob > max_hybrid_prob:
                    max_hybrid_prob = event_hybrid_prob
                    predicted_event_id = i
                    
            predicted_event = self.roberta.id2label.get(predicted_event_id, "normal_play")
            
            results.append({
                "roberta_score": base_highlight_prob,
                "lexicon_score": l_prob,
                "hybrid_score": hybrid_score,
                "predicted_event": predicted_event,
                "predicted_event_prob": max_hybrid_prob,
                "raw_roberta_probs": r_probs,
                "raw_lexicon_features": lexicon_features
            })
            
        return results
