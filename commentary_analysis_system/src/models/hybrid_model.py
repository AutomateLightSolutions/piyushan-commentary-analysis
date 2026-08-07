from src.models.transformer_classifier import TransformerClassifier
from src.models.lexicon_model import LexiconModel

class HybridModel:
    def __init__(self, roberta_model_path=None, model_name="roberta-base"):
        self.roberta = TransformerClassifier(model_name=model_name)
        if roberta_model_path:
            self.roberta.load_model(roberta_model_path)
            
        self.lexicon = LexiconModel()
        
    def predict(self, text_list: list[str], roberta_text_list: list[str] = None,
                highlight_lexicon_weight=0.3, event_lexicon_weight=0.3, roberta_weight=1.0):
        """
        Generates combined score using booster formula: min(1.0, (RoBERTa * roberta_weight) + (Lexicon * highlight_lexicon_weight))

        text_list is each chunk's own text - used for lexicon scoring and
        returned alongside results, so lexicon keywords stay attributed to
        the chunk they actually appear in.

        roberta_text_list is optional windowed text (see
        src/data_processing/chunker.py's build_context_windows) fed to the
        RoBERTa model only, matching how it was trained. Defaults to
        text_list (no windowing) if not given.
        """
        if roberta_text_list is None:
            roberta_text_list = text_list
        roberta_event_probs, roberta_highlight_scores = self.roberta.predict_probs(roberta_text_list)
        
        results = []
        for text, r_probs, r_h_score in zip(text_list, roberta_event_probs, roberta_highlight_scores):
            # Overall highlight score from lexicon
            l_prob = self.lexicon.score_chunk(text)
            
            # r_h_score is the direct highlight probability from the new highlight head
            base_highlight_prob = r_h_score
            
            # Booster formula: Lexicon score boosts the RoBERTa base score
            hybrid_score = min(1.0, (base_highlight_prob * roberta_weight) + (l_prob * highlight_lexicon_weight))
            
            # Predict the specific event using event-specific lexicon features
            lexicon_features = self.lexicon.generate_features(text)
            
            # --- LEXICON EVENT ---
            max_lexicon_score = -1
            lexicon_predicted_event_id = 0
            for i in range(len(r_probs)):
                event_name = self.roberta.id2label.get(i, "normal_play")
                l_score = lexicon_features.get(event_name, 0.0)
                if l_score > max_lexicon_score:
                    max_lexicon_score = l_score
                    lexicon_predicted_event_id = i
            lexicon_predicted_event = self.roberta.id2label.get(lexicon_predicted_event_id, "normal_play")

            # --- ML MODEL EVENT ---
            max_roberta_prob = -1
            roberta_predicted_event_id = 0
            for i, p in enumerate(r_probs):
                if p > max_roberta_prob:
                    max_roberta_prob = p
                    roberta_predicted_event_id = i
            roberta_predicted_event = self.roberta.id2label.get(roberta_predicted_event_id, "normal_play")
            
            # --- HYBRID EVENT ---
            max_hybrid_prob = -1
            predicted_event_id = 0
            
            for i, p in enumerate(r_probs):
                event_name = self.roberta.id2label.get(i, "normal_play")
                
                # Get the lexicon score specifically for this event
                l_prob_for_event = lexicon_features.get(event_name, 0.0)
                
                # Normalize lexicon score (similar to how score_chunk scales weights)
                l_prob_normalized = min(1.0, float(l_prob_for_event) * 100.0)
                
                # Combine them for this specific event
                event_hybrid_prob = (p * roberta_weight) + (l_prob_normalized * event_lexicon_weight)
                
                if event_hybrid_prob > max_hybrid_prob:
                    max_hybrid_prob = event_hybrid_prob
                    predicted_event_id = i
                    
            predicted_event = self.roberta.id2label.get(predicted_event_id, "normal_play")
            
            results.append({
                "roberta_score": base_highlight_prob,
                "lexicon_score": l_prob,
                "hybrid_score": hybrid_score,
                "predicted_event": predicted_event,
                "lexicon_predicted_event": lexicon_predicted_event,
                "roberta_predicted_event": roberta_predicted_event,
                "hybrid_predicted_event": predicted_event,
                "predicted_event_prob": max_hybrid_prob,
                "raw_roberta_probs": r_probs,
                "raw_lexicon_features": lexicon_features
            })
            
        return results
