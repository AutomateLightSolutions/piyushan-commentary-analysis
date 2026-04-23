import re

class LexiconModel:
    def __init__(self):
        # Category 1: Scoring Terms
        self.scoring_terms = [r"\btry\b", r"\bscores?\b", r"\bover\b", r"\bdives?\b", r"\bconversion\b", r"\bdrop goal\b"]
        # Category 2: Referee Terms
        self.referee_terms = [r"\badvantage\b", r"\bpenalty\b", r"\boffside\b", r"\bforward pass\b", r"\bknock on\b"]
        # Category 3: Set Piece Terms
        self.set_piece_terms = [r"\bscrum\b", r"\blineout\b", r"\bmaul\b", r"\bruck\b"]
        # Category 4: Excitement Terms
        self.excitement_terms = [r"\bbrilliant\b", r"\bwhat a play\b", r"\bhuge moment\b", r"\bsensational\b"]

    def _count_matches(self, text: str, patterns: list[str]) -> int:
        count = 0
        for pattern in patterns:
            if re.search(pattern, text):
                count += 1
        return count

    def generate_features(self, text: str) -> dict:
        """Counts presence/absence of category keywords in the chunk."""
        text = text.lower()
        return {
            "scoring": 1 if self._count_matches(text, self.scoring_terms) > 0 else 0,
            "referee": 1 if self._count_matches(text, self.referee_terms) > 0 else 0,
            "set_piece": 1 if self._count_matches(text, self.set_piece_terms) > 0 else 0,
            "excitement": 1 if self._count_matches(text, self.excitement_terms) > 0 else 0,
        }

    def score_chunk(self, text: str) -> float:
        """
        Simple heuristic implementation of Lexicon Score (0.0 to 1.0).
        Assigns weightages to categories. For instance:
        - Excitement + Scoring usually strongly indicates a highlight.
        """
        feats = self.generate_features(text)
        
        # Maximum possible score based on simple weighted aggregation
        raw_score = (
            feats["scoring"] * 0.40 +
            feats["excitement"] * 0.35 +
            feats["referee"] * 0.15 +
            feats["set_piece"] * 0.10
        )
        return min(raw_score, 1.0)
