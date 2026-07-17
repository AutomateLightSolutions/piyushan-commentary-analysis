# Rugby Highlight Commentary Analysis & Training System

A full-stack tool for processing rugby match commentary, annotating excitement levels, and training an NLP Hybrid Model (RoBERTa + Lexicon) to detect highlight events automatically.

## System Overview
`frontend (Next.js App)`   →   `Next.js API Routes`   →   `Python Subprocess (Whisper & RoBERTa)`
      `:3000`                        `:3000/api/*`                   `commentary_analysis_system/`

**Workflow:**
1. **Register a match video** (audio is extracted automatically)
2. **Transcribe & Chunk** the commentary into small text segments
3. **Annotate chunks (Optional)** with rugby events and excitement scores
4. **Train & Predict** — Fine-tune an AI model and run the Hybrid Lexicon+ML prediction
5. **Extract Highlights** — Output timestamps defining exactly when highlights occurred
6. **Compare Models** — View evaluation metrics (Precision, Recall, F1 Score)

## Prerequisites
| Tool | Version | Notes |
| :--- | :--- | :--- |
| **Python** | 3.10+ | Required for backend NLP scripts |
| **Node.js** | 20+ | Required for the Next.js frontend |
| **FFmpeg** | Latest | Required by OpenAI Whisper for audio extraction |
| **Docker** | Latest | (Optional) For containerized execution |

## Setup

### Option 1: Docker (Recommended)
The easiest way to run the entire system (Frontend + Backend + FFmpeg) without manual configuration.
```bash
git clone <repo-url>
cd "Test FYP"
docker-compose up --build
```
*The app will be available at [http://localhost:3000](http://localhost:3000).*

### Option 2: Local Development Setup
If you want to run the components natively on your machine:

**1. Set up the Python backend**
```bash
cd commentary_analysis_system
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

**2. Download FFmpeg**
- **Windows**: Download via `winget install ffmpeg` or Chocolatey.
- **macOS**: `brew install ffmpeg`
- **Linux**: `sudo apt install ffmpeg`

**3. Set up the React frontend**
```bash
cd ../frontend
npm install
```

## Running the System (Local Mode)
If you aren't using Docker, start the frontend. (The frontend API routes will automatically invoke the Python scripts from the `.venv`).

```bash
cd frontend
npm run dev
```
Open your browser at [http://localhost:3000](http://localhost:3000).

## Using the Application

### Step 1: Provide Context & Upload Videos
- Open the **Dashboard** page.
- Enter a unique **Match Identifier Base Name** (e.g., `match_01`) or select an existing one.
- Select the **Full Match MP4** video file (the system will extract its audio).
- Click **Start Pipeline**.

### Step 2: Monitor Data Pipeline Progress
- The dashboard will show live terminal output as the system runs.
- **Transcription**: OpenAI's Whisper converts speech to text.
- **Data Chunking**: Transcripts are grouped into analyzable chunks.

### Step 3: Annotate Clips (Optional)
- Click **Go to Manual Labeling**.
- Review the transcript chunks.
- Assign an event class (e.g., *Try, Penalty, Tackle*) and set an excitement score if you are building a custom dataset.

### Step 4: Train & Run the ML Sequence
- Back on the Dashboard, in the **Advanced ML Execution** section.
- **Select AI Model**: Choose from models like *Roberta, DeBERTa, ModernBERT, or BERT*.
- Click **Run ML Sequence**.
- The model trains (fine-tunes) on your labeled data, then runs predictions. It uses a **Hybrid approach** weighting both the ML Model and Lexical rules (keyword matching).

### Step 5: View Results
- **Evaluation Metrics**: The dashboard displays Precision, Recall, and F1 Scores for your chosen model.
- **Extracted Highlights**: The final output is generated as a `highlights_timestamps.json` specifying exact video clip bounds.

## Data Storage
All data is stored inside `commentary_analysis_system/data/` to ensure persistence:

```text
commentary_analysis_system/data/
├── raw/            # Uploaded audio/video and transcripts
├── processed/      # Chunked json files and datasets
├── output/         # Model checkpoints, predictions, and highlight timestamps
├── config/         # System thresholds and hyperparameter settings
├── lexicon.json    # Rugby vocabulary keywords and excitement weightings
└── events.json     # Defined event categories (Try, Scrum, etc.)
```

## Troubleshooting

- **"Pipeline Running" gets stuck or FFmpeg Error:**
  Make sure FFmpeg is properly installed and accessible in your system's PATH. If using Windows, try running inside Docker to bypass FFmpeg configuration entirely.

- **Python Scripts failing to run from UI:**
  Ensure the virtual environment is named exactly `.venv` inside the `commentary_analysis_system` folder. The Next.js API route (`api/python-env.js`) looks for this specific path.

- **CUDA / Out of Memory (OOM) during Training:**
  If the training script crashes with a memory error on your GPU, you can switch to a smaller model (e.g., BERT instead of RoBERTa) via the dropdown on the dashboard.
