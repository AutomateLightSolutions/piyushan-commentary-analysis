import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '..', 'commentary_analysis_system', 'data');
const RUNS_DIR = path.join(DATA_DIR, 'lexicon_runs');
const EVENTS_PATH = path.join(DATA_DIR, 'events.json');
const LEXICON_PATH = path.join(DATA_DIR, 'lexicon.json');

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const specificRunId = searchParams.get('run_id');

    let allRuns = [];
    if (fs.existsSync(RUNS_DIR)) {
      const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const runData = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, file), 'utf8'));
          allRuns.push(runData);
        } catch (e) {
          console.error(`Error parsing run file ${file}`, e);
        }
      }
    }

    // Sort runs by timestamp descending
    allRuns.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const availableRuns = allRuns.map(r => ({
      run_id: r.run_id,
      timestamp: r.timestamp,
      sources: r.sources
    }));

    // Aggregate frequencies
    const aggregatedFreqs = {};
    const processedSources = [];

    const runsToAggregate = specificRunId 
      ? allRuns.filter(r => r.run_id === specificRunId)
      : allRuns;

    for (const run of runsToAggregate) {
      processedSources.push(...(run.sources || []));
      
      for (const [event, terms] of Object.entries(run.frequencies || {})) {
        if (!aggregatedFreqs[event]) aggregatedFreqs[event] = {};
        for (const [term, freq] of Object.entries(terms)) {
          aggregatedFreqs[event][term] = (aggregatedFreqs[event][term] || 0) + freq;
        }
      }
    }

    let events = Object.keys(aggregatedFreqs);
    if (events.length === 0 && fs.existsSync(EVENTS_PATH)) {
      try {
        events = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8'));
      } catch (e) {}
    }

    // Read current lexicon to get default weights
    let currentLexicon = { categories: [] };
    if (fs.existsSync(LEXICON_PATH)) {
       try {
           currentLexicon = JSON.parse(fs.readFileSync(LEXICON_PATH, 'utf8'));
       } catch(e) {}
    }

    const defaultWeights = {};
    currentLexicon.categories.forEach(cat => {
        defaultWeights[cat.id] = cat.weight || 0.1;
    });

    const eventScores = [];

    for (const event of events) {
      const eventFreqs = aggregatedFreqs[event] || {};
      let totalFreq = 0;
      for (const val of Object.values(eventFreqs)) {
        totalFreq += val;
      }

      const scores = [];
      if (totalFreq > 0) {
        for (const [word, freq] of Object.entries(eventFreqs)) {
          scores.push({
            text: word,
            weight: Number((freq / totalFreq).toFixed(4))
          });
        }
      }

      scores.sort((a, b) => b.weight - a.weight);

      eventScores.push({
        id: event,
        name: event.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        default_weight: defaultWeights[event] || 0.1,
        scores: scores
      });
    }

    return NextResponse.json({
      available_runs: availableRuns,
      current_view: {
        run_id: specificRunId || 'cumulative',
        sources: processedSources,
        events: eventScores
      }
    });
  } catch (error) {
    console.error('Error auto-generating lexicon data:', error);
    return NextResponse.json({ error: 'Failed to generate lexicon data' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('run_id');
    
    if (!runId) {
      return NextResponse.json({ error: 'run_id is required' }, { status: 400 });
    }
    
    const runFilePath = path.join(RUNS_DIR, `${runId}.json`);
    if (fs.existsSync(runFilePath)) {
      fs.unlinkSync(runFilePath);
      return NextResponse.json({ message: `Run ${runId} deleted successfully` });
    } else {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
  } catch (error) {
    console.error('Error deleting run:', error);
    return NextResponse.json({ error: 'Failed to delete run' }, { status: 500 });
  }
}
