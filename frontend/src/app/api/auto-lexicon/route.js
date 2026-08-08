import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '..', 'commentary_analysis_system', 'data');
const RUNS_DIR = path.join(DATA_DIR, 'lexicon_runs');
const EVENTS_PATH = path.join(DATA_DIR, 'events.json');
const LEXICON_PATH = path.join(DATA_DIR, 'lexicon.json');
const FILTERS_PATH = path.join(DATA_DIR, 'config', 'lexicon_filters.json');
const SEED_PATH = path.join(DATA_DIR, 'config', 'seed_lexicon.json');

// Terms with no event-discriminative value (team/nation names mentioned throughout
// every match, plus pronouns/fillers used in every commentary sentence). These are
// dropped from auto-extraction candidates entirely rather than just down-ranked,
// since they'd otherwise dominate every event's top-N by raw frequency alone.
function loadBlocklist() {
  const blocked = new Set();
  try {
    const data = JSON.parse(fs.readFileSync(FILTERS_PATH, 'utf8'));
    for (const group of ['nations_and_teams', 'generic_fillers']) {
      for (const term of data[group] || []) blocked.add(term);
    }
  } catch (e) {}
  return blocked;
}

function loadSeedTerms() {
  try {
    return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

// Log-likelihood "keyness" score: how over-represented `term` is in `event`
// relative to its rate in every other event combined. Plain frequency alone
// can't tell a genuinely event-specific word from a word that's just common
// in commentary generally (it would rank both equally high); keyness only
// scores a term up when it concentrates in this one event.
function keyness(freqInEvent, totalInEvent, freqInOthers, totalInOthers) {
  const a = freqInEvent;
  const b = freqInOthers;
  const total = totalInEvent + totalInOthers;
  if (total === 0 || (a + b) === 0) return 0;

  const expectedInEvent = totalInEvent * (a + b) / total;
  const expectedInOthers = totalInOthers * (a + b) / total;

  let ll = 0;
  if (expectedInEvent > 0 && a > 0) ll += a * Math.log(a / expectedInEvent);
  if (expectedInOthers > 0 && b > 0) ll += b * Math.log(b / expectedInOthers);
  ll *= 2;

  // Only reward over-representation in this event; a term that's actually
  // rarer here than elsewhere should rank low, not score high on magnitude alone.
  const rateInEvent = totalInEvent > 0 ? a / totalInEvent : 0;
  const rateInOthers = totalInOthers > 0 ? b / totalInOthers : 0;
  return rateInEvent >= rateInOthers ? ll : -ll;
}

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

    // Aggregate frequencies, and separately track how many distinct sources
    // (matches) each term appears in per event. A term tied to a single match
    // (e.g. a player's surname who happened to score that day) is noise even
    // if its raw frequency is high; genuine event vocabulary recurs across
    // multiple matches.
    const aggregatedFreqs = {};
    const termSourceCounts = {};
    const eventSourceCounts = {};
    const processedSources = [];

    const runsToAggregate = specificRunId
      ? allRuns.filter(r => r.run_id === specificRunId)
      : allRuns;

    for (const run of runsToAggregate) {
      processedSources.push(...(run.sources || []));
      const runSourceId = (run.sources && run.sources[0] && run.sources[0].id) || run.run_id;

      for (const [event, terms] of Object.entries(run.frequencies || {})) {
        if (Object.keys(terms).length === 0) continue;
        if (!aggregatedFreqs[event]) aggregatedFreqs[event] = {};
        if (!termSourceCounts[event]) termSourceCounts[event] = {};
        eventSourceCounts[event] = (eventSourceCounts[event] || 0) + 1;

        for (const [term, freq] of Object.entries(terms)) {
          aggregatedFreqs[event][term] = (aggregatedFreqs[event][term] || 0) + freq;
          if (!termSourceCounts[event][term]) termSourceCounts[event][term] = new Set();
          termSourceCounts[event][term].add(runSourceId);
        }
      }
    }

    const blocklist = loadBlocklist();
    const seedTerms = loadSeedTerms();

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

    // Each term's frequency summed across ALL events, needed to score how much
    // a term concentrates in one event vs. being spread evenly (= generic filler).
    const termGrandTotal = {};
    for (const ev of events) {
      for (const [term, freq] of Object.entries(aggregatedFreqs[ev] || {})) {
        termGrandTotal[term] = (termGrandTotal[term] || 0) + freq;
      }
    }
    const grandTotal = Object.values(termGrandTotal).reduce((s, v) => s + v, 0);

    const eventScores = [];

    for (const event of events) {
      const eventFreqs = aggregatedFreqs[event] || {};
      const totalFreq = Object.values(eventFreqs).reduce((s, v) => s + v, 0);
      const totalOthers = grandTotal - totalFreq;

      // Require the term to show up in >=2 different matches (when >=2 matches
      // have data for this event at all) so a one-off proper noun tied to a
      // single game can't pass as event vocabulary just by being frequent there.
      const minSources = (eventSourceCounts[event] || 0) >= 2 ? 2 : 1;
      const seedSet = new Set(seedTerms[event] || []);
      const sourceCountsForEvent = termSourceCounts[event] || {};

      const scores = [];
      if (totalFreq > 0) {
        for (const [word, freq] of Object.entries(eventFreqs)) {
          const isSeed = seedSet.has(word);
          if (!isSeed) {
            if (blocklist.has(word)) continue;
            const sourceCount = (sourceCountsForEvent[word] || new Set()).size;
            if (sourceCount < minSources) continue;
          }

          const freqInOthers = (termGrandTotal[word] || 0) - freq;
          const score = keyness(freq, totalFreq, freqInOthers, totalOthers);
          scores.push({
            text: word,
            weight: Number((freq / totalFreq).toFixed(4)),
            _keyness: score
          });
        }
      }

      scores.sort((a, b) => b._keyness - a._keyness);
      scores.forEach(s => { delete s._keyness; });

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

      // Re-aggregate remaining runs to update lexicon.json
      let allRuns = [];
      if (fs.existsSync(RUNS_DIR)) {
        const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            allRuns.push(JSON.parse(fs.readFileSync(path.join(RUNS_DIR, file), 'utf8')));
          } catch (e) {}
        }
      }

      const aggregatedFreqs = {};
      for (const run of allRuns) {
        for (const [event, terms] of Object.entries(run.frequencies || {})) {
          if (!aggregatedFreqs[event]) aggregatedFreqs[event] = {};
          for (const [term, freq] of Object.entries(terms)) {
            aggregatedFreqs[event][term] = (aggregatedFreqs[event][term] || 0) + freq;
          }
        }
      }

      if (fs.existsSync(LEXICON_PATH)) {
        const lexicon = JSON.parse(fs.readFileSync(LEXICON_PATH, 'utf8'));
        
        for (const cat of lexicon.categories) {
          const eventFreqs = aggregatedFreqs[cat.id] || {};
          let totalFreq = 0;
          for (const val of Object.values(eventFreqs)) {
            totalFreq += val;
          }

          const newWeights = {};
          if (totalFreq > 0) {
            for (const [word, freq] of Object.entries(eventFreqs)) {
               newWeights[word] = Number((freq / totalFreq).toFixed(4));
            }
          }

          const updatedTerms = [];
          for (const term of cat.terms) {
            if (newWeights[term.text] !== undefined) {
              updatedTerms.push({
                text: term.text,
                weight: newWeights[term.text]
              });
            } else if (term.weight >= 1.0) {
              // Preserve manually added terms (which have weight >= 1.0 by default)
              updatedTerms.push(term);
            }
          }
          
          updatedTerms.sort((a, b) => b.weight - a.weight);
          cat.terms = updatedTerms;
        }
        
        fs.writeFileSync(LEXICON_PATH, JSON.stringify(lexicon, null, 2), 'utf8');
      }

      return NextResponse.json({ message: `Run ${runId} deleted successfully and lexicon updated` });
    } else {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
  } catch (error) {
    console.error('Error deleting run:', error);
    return NextResponse.json({ error: 'Failed to delete run' }, { status: 500 });
  }
}
