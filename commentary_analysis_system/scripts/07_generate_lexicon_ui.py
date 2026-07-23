import os
import sys
import json
import streamlit as st

# Add src to path so we can import LexiconBuilder
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(base_dir)

from src.data_processing.lexicon_builder import LexiconBuilder

st.set_page_config(page_title="Lexicon Generator UI", layout="wide")
st.title("🏉 Rugby Commentary Lexicon Generator")

# Initialize Builder
@st.cache_resource
def get_builder():
    return LexiconBuilder()

builder = get_builder()

# Get events from frequencies or fallback to events.json
events = list(builder.frequencies.keys())
if not events:
    # Try loading events.json as fallback
    events_path = os.path.join(base_dir, "data", "events.json")
    if os.path.exists(events_path):
        with open(events_path, "r") as f:
            events = json.load(f)
    if not events:
        st.warning("No data found in keyword_frequencies.json. Run data processing first!")
        st.stop()

# Load current lexicon if it exists to get existing weights
lexicon_path = os.path.join(base_dir, "data", "lexicon.json")
current_lexicon = {}
if os.path.exists(lexicon_path):
    with open(lexicon_path, "r") as f:
        current_lexicon = json.load(f)

# Create a mapping of current event weights
existing_event_weights = {}
for cat in current_lexicon.get("categories", []):
    existing_event_weights[cat["id"]] = cat.get("weight", 0.1)

st.markdown("""
This tool allows you to review the automatically calculated keyword scores for each event.
Scores are calculated as: `(Frequency of keyword in Event) / (Total frequency of all keywords in Event)`
""")

# Store final selections in session state
if 'final_lexicon' not in st.session_state:
    st.session_state.final_lexicon = {"categories": []}

# UI for each event
st.header("Review Keywords by Event")

tabs = st.tabs([e.replace("_", " ").title() for e in events])

selected_categories = []

for i, event in enumerate(events):
    with tabs[i]:
        st.subheader(f"Event: {event}")
        
        # Event Weight Input
        default_weight = existing_event_weights.get(event, 0.1)
        event_weight = st.number_input(f"Weight for '{event}'", min_value=0.0, max_value=1.0, value=default_weight, step=0.05, key=f"weight_{event}")
        
        # Keyword Selection
        scores = builder.get_scores(event)
        
        if not scores:
            st.info(f"No frequency data recorded for {event} yet.")
            continue
            
        top_n = st.slider(f"Top N keywords to show for {event}", min_value=5, max_value=200, value=30, step=5, key=f"top_{event}")
        
        st.write("Select the valid keywords to include in the lexicon:")
        
        # Show Top N
        top_keywords = list(scores.items())[:top_n]
        
        # We will use columns to make it look nicer
        cols = st.columns(3)
        
        selected_terms = []
        for idx, (word, score) in enumerate(top_keywords):
            col_idx = idx % 3
            with cols[col_idx]:
                # Automatically check it if the score is somewhat decent, or just default to True
                checked = st.checkbox(f"{word} ({score:.4f})", value=True, key=f"check_{event}_{word}")
                if checked:
                    selected_terms.append({"text": word, "weight": round(score, 4)})
                    
        # Add to the categories list for final JSON compilation
        selected_categories.append({
            "id": event,
            "name": event.replace("_", " ").title(),
            "weight": event_weight,
            "terms": selected_terms
        })

# Generation Section
st.header("Export Final Lexicon")
st.write("Once you are happy with the selections above, generate the updated `lexicon.json` file.")

if st.button("Generate & Save lexicon.json", type="primary"):
    final_data = {"categories": selected_categories}
    
    with open(lexicon_path, "w", encoding='utf-8') as f:
        json.dump(final_data, f, indent=2)
    
    st.success(f"Successfully saved to {lexicon_path}!")
    st.json(final_data) # Show preview
