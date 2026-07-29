import os
import sys

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(base_dir)

from src.data_processing.lexicon_builder import LexiconBuilder

def main():
    print("Testing Lexicon Builder...")
    builder = LexiconBuilder()
    
    # Dummy labeled chunks
    dummy_data = [
        {"text": "he scores a brilliant try in the corner", "event_label": "try_scoring"},
        {"text": "what a finish he dives over for the try", "event_label": "try_scoring"},
        {"text": "the referee checks the tmo for a dangerous tackle", "event_label": "referee_decisions"},
        {"text": "yellow card given for high tackle", "event_label": "referee_decisions"},
        {"text": "he converts the penalty goal straight through the posts", "event_label": "conversion_penalty_points"}
    ]
    
    print("Processing dummy data (Run 1)...")
    builder.process_dataset(dummy_data, source_id="match_1_id", source_name="Match 1: Ireland vs South Africa")
    
    # Simulate a second match run
    dummy_data_2 = [
        {"text": "he grounds the ball try time", "event_label": "try_scoring"},
        {"text": "red card for a dangerous tackle", "event_label": "referee_decisions"}
    ]
    print("Processing dummy data (Run 2)...")
    builder.process_dataset(dummy_data_2, source_id="match_2_id", source_name="Match 2: New Zealand vs France")
    
    print(f"\nRun files saved to {builder.runs_dir}")

if __name__ == "__main__":
    main()
