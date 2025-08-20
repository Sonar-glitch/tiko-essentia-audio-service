#!/usr/bin/env node
/**
 * Batch Artist Audio Coverage Improver
 *
 * Goal: Iterate a list of artists (from artistGenres or provided file) and attempt
 * to improve preview + Essentia coverage by re-running analyze-artist with
 * desired preview strategies. Prioritizes:
 *  1. Apple primary (fast) pass to capture easy wins
 *  2. SoundCloud primary (forced) pass for tracks that still lack audio vectors
 *  3. (Optional) Balanced strategy (future) if we re‑enable Spotify recovery
 *
 * Usage:
 *  node batch-artist-audio-coverage.js --limit 100 --appleFirst --soundcloudPass
 *  node batch-artist-audio-coverage.js --fromFile artists.txt --soundcloudOnly
 *
 * Env Requirements:
 *  MONGODB_URI (for reading/writing audio_features + artistGenres)
 *  SOUNDCLOUD_CLIENT_ID (for SoundCloud searches)
 */

const fetch = require('node-fetch');
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');

const SERVICE_URL = process.env.ESSENTIA_SERVICE_URL || process.env.ESSENTIA_URL || 'http://localhost:3001';
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI');
  process.exit(1);
}

// ---- CLI ARG PARSE ----
const args = process.argv.slice(2);
function hasFlag(name){ return args.includes('--'+name); }
function getArg(name, def){ const idx = args.indexOf('--'+name); return idx !== -1 ? args[idx+1] : def; }

const limit = parseInt(getArg('limit', '200'), 10);
const fromFile = getArg('fromFile');
const appleFirst = hasFlag('appleFirst');
const soundcloudPass = hasFlag('soundcloudPass');
const soundcloudOnly = hasFlag('soundcloudOnly');
const maxTracks = parseInt(getArg('maxTracks','10'),10);
const minMissingVectors = parseInt(getArg('minMissing','3'),10); // threshold to trigger SC pass
const dryRun = hasFlag('dry');

(async () => {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db();
  const artistCol = db.collection('artistGenres');
  const audioCol = db.collection('audio_features');

  let artists = [];
  if (fromFile) {
    const filePath = path.resolve(fromFile);
    if (!fs.existsSync(filePath)) { console.error('File not found', filePath); process.exit(1); }
    artists = fs.readFileSync(filePath,'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(n => ({ name: n }));
  } else {
    // Load artists ordered by recent activity (fallback: popularity desc)
    artists = await artistCol.find({}, { projection: { name:1, spotifyId:1, genres:1 } })
      .limit(limit)
      .toArray();
  }

  console.log(`Loaded ${artists.length} artists (limit=${limit}).`);
  let improved = 0; let skipped = 0; let scTriggered = 0; let errors = 0;
  const results = [];

  for (const artist of artists) {
    // be defensive: some artist docs may not have a `name` field (older/dirty data)
    const aName = (artist && (artist.name || artist.artistName || artist.displayName || (artist._id && artist._id.toString()))) || null;
    const spotifyId = artist && artist.spotifyId;
    const existingGenres = (artist && artist.genres) || [];
    if (!aName) {
      // log the offending doc minimally and skip to avoid calling the API with `undefined`
      process.stdout.write(`\n👉 undefined (missing name) ... `);
      console.error('\n   ❌ Missing artist name for document:', JSON.stringify({ _id: artist && artist._id, spotifyId: artist && artist.spotifyId }));
      skipped++;
      results.push({ name: null, status: 'error', message: 'missing name', docId: artist && artist._id, spotifyId: artist && artist.spotifyId });
      continue;
    }
    process.stdout.write(`\n👉 ${aName} ... `);

    // Quick existing coverage check: count track vectors for this artist in audio_features
    const existingVectors = await audioCol.countDocuments({ 'features.analysis_source': 'essentia', artist: aName });
    if (existingVectors >= maxTracks) {
      process.stdout.write(`skip (already ${existingVectors} vectors)\n`);
      skipped++;
      results.push({ name: aName, status: 'skip', existingVectors });
      continue;
    }

    if (dryRun) {
      process.stdout.write('dry-run skip\n');
      skipped++;
      results.push({ name: aName, status: 'dry-skip', existingVectors });
      continue;
    }

    try {
      const entry = { name: aName, status: 'processing', existingVectors, passes: [] };
      if (!soundcloudOnly && appleFirst) {
        const appleResp = await callAnalyze(aName, spotifyId, existingGenres, 'apple_primary');
        reportResult('apple', appleResp);
        const analyzed = appleResp.metadata?.totalTracksAnalyzed || 0;
        const sources = appleResp.metadata?.audioSources || {};
        entry.passes.push({ strategy: 'apple', analyzed, sources, acquisitionStats: appleResp.acquisitionStats || null });
      }
      if ((soundcloudPass || soundcloudOnly)) {
        // Only run SC pass if still under target coverage
        const postAppleVectors = await audioCol.countDocuments({ 'features.analysis_source': 'essentia', artist: aName });
        const stillMissing = postAppleVectors < maxTracks - 1; // modest slack
        if (stillMissing) {
          scTriggered++;
          const scResp = await callAnalyze(aName, spotifyId, existingGenres, 'soundcloud_primary', { forceSoundCloudTest: true });
          reportResult('soundcloud', scResp);
          const analyzed = scResp.metadata?.totalTracksAnalyzed || 0;
          const sources = scResp.metadata?.audioSources || {};
          entry.passes.push({ strategy: 'soundcloud', analyzed, sources, acquisitionStats: scResp.acquisitionStats || null });
        } else {
          process.stdout.write(' SC-pass-skip (coverage ok)');
        }
      }
      improved++;
      entry.status = 'done';
      results.push(entry);
    } catch (e) {
      errors++; console.error(`\n   ❌ Error processing ${aName}:`, e.message);
      results.push({ name: aName, status: 'error', message: e.message });
    }
  }

  console.log('\n\n===== SUMMARY =====');
  console.log({ total: artists.length, improved, skipped, scTriggered, errors });
  try {
    const payload = { total: artists.length, improved, skipped, scTriggered, errors, results };
    // Always print JSON to stdout so Heroku one-off runs can capture it even if /tmp write fails
    console.log('===BATCH_COVERAGE_JSON_START===');
    console.log(JSON.stringify(payload, null, 2));
    console.log('===BATCH_COVERAGE_JSON_END===');
    const outPath = '/tmp/batch_coverage_results.json';
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log('Wrote results to', outPath);
  } catch (werr) {
    console.error('Failed to write /tmp results:', werr.message);
  }
  await client.close();
})();

async function callAnalyze(artistName, spotifyId, existingGenres, strategy, extraBody={}) {
  const body = { artistName, spotifyId, existingGenres, maxTracks, fastMode: true, previewStrategy: strategy, ...extraBody };
  const resp = await fetch(`${SERVICE_URL}/api/analyze-artist`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`analyze-artist failed ${resp.status}`);
  return resp.json();
}

function reportResult(label, r){
  if (!r) return;
  const analyzed = r.metadata?.totalTracksAnalyzed || 0;
  const sources = r.metadata?.audioSources || {};
  const sc = sources.soundcloud || 0;
  const apple = sources.apple || 0;
  process.stdout.write(`${label}[tracks=${analyzed}, apple=${apple}, sc=${sc}]`);
  if (r.acquisitionStats?.soundcloudRescue) process.stdout.write(` rescueSC=${r.acquisitionStats.soundcloudRescue}`);
}
