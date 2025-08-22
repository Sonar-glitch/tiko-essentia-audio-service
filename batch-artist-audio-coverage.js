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
const os = require('os');
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
const edmOnly = hasFlag('edm');
const genreFilter = getArg('genre', null); // e.g. --genre "progressive house"
const maxTracks = parseInt(getArg('maxTracks','10'),10);
const minMissingVectors = parseInt(getArg('minMissing','3'),10); // threshold to trigger SC pass
const dryRun = hasFlag('dry');
// Allow explicit control of fastMode from CLI: --fastMode or --noFastMode (default: true)
const fastModeFlag = hasFlag('fastMode') ? true : (hasFlag('noFastMode') ? false : true);

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
    const q = {};
    if (edmOnly) {
      // EDM subset: match common EDM genre tokens in the genres array
      q.genres = { $elemMatch: { $regex: /(house|techno|trance|edm|dubstep|drum|bass|progressive|melodic)/i } };
    }
    if (genreFilter) {
      q.genres = q.genres || {};
      q.genres.$elemMatch = q.genres.$elemMatch || {};
      // exact-ish match for the requested genre
      q.genres.$elemMatch.$regex = new RegExp(genreFilter.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i');
    }
  // Only select artists that are missing an Essentia profile or have a staged/partial profile to resume work efficiently.
  // We include `essentiaProfileStaged:true` so partially-populated profiles are reprocessed until they reach `maxTracks`.
  const missingProfileOrEmpty = { $or: [ { essentiaAudioProfile: { $exists: false } }, { 'essentiaAudioProfile.trackMatrix': { $exists: false } }, { 'essentiaAudioProfile.trackMatrix': { $size: 0 } }, { essentiaProfileStaged: true } ] };
    const baseQ = Object.keys(q).length ? { $and: [ q, missingProfileOrEmpty ] } : missingProfileOrEmpty;

  artists = await artistCol.find(baseQ, { projection: { name:1, spotifyId:1, genres:1, essentiaProfileBuilt:1, essentiaAudioProfile:1, essentiaProfileStaged:1 } })
      .limit(limit)
      .toArray();
  }

  console.log(`Loaded ${artists.length} artists (limit=${limit}).`);
  let improved = 0; let skipped = 0; let scTriggered = 0; let errors = 0;
  let writesSucceeded = 0; let writesFailed = 0; let stagedCreated = 0;
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
    // Compute staged length from the existing artist doc and how many tracks remain to reach maxTracks
    const stagedLen = Array.isArray(artist && artist.essentiaAudioProfile && artist.essentiaAudioProfile.trackMatrix) ? artist.essentiaAudioProfile.trackMatrix.length : 0;
    const remainingTracks = Math.max(0, maxTracks - stagedLen);
    // If staged already meets or exceeds maxTracks, mark built and skip reprocessing
    if (stagedLen >= maxTracks && artist && !artist.essentiaProfileBuilt) {
      try {
        const r = await artistCol.updateOne({ _id: artist._id }, { $set: { essentiaProfileBuilt: true, essentiaProfileDate: new Date() }, $unset: { essentiaProfileStaged: '' } });
        if (r && r.modifiedCount > 0) { writesSucceeded++; process.stdout.write(' MARKED_BUILT'); }
      } catch (uerr) { writesFailed++; console.error('   ❌ Failed to mark built from staged:', uerr.message); }
      skipped++; results.push({ name: aName, status: 'already_staged_built' });
      continue;
    }
    // If an Essentia profile is already built, skip unless the caller explicitly requests re-run with --force
    if (artist && artist.essentiaProfileBuilt && !hasFlag('force')) {
      process.stdout.write(`skip (essentia profile exists)\n`);
      skipped++;
      results.push({ name: aName, status: 'skip_profile', existingVectors });
      continue;
    }
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
      let lastAnalysis = null;
      if (!soundcloudOnly && appleFirst) {
        // Request only remaining tracks when there's a staged partial profile
        const appleResp = await callAnalyze(aName, spotifyId, existingGenres, 'apple_primary', { maxTracks: remainingTracks || maxTracks });
        reportResult('apple', appleResp);
        lastAnalysis = appleResp;
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
          // SoundCloud removed: replace soundcloud_primary strategy with 'apple_primary' for diagnostic runs
          const scResp = await callAnalyze(aName, spotifyId, existingGenres, 'apple_primary', { forceSoundCloudTest: true, maxTracks: remainingTracks || maxTracks });
          // legacy label kept for compatibility but the analysis now prefers Apple/Deezer paths
          reportResult('soundcloud', scResp);
          lastAnalysis = scResp || lastAnalysis;
          const analyzed = scResp.metadata?.totalTracksAnalyzed || 0;
          const sources = scResp.metadata?.audioSources || {};
          entry.passes.push({ strategy: 'soundcloud', analyzed, sources, acquisitionStats: scResp.acquisitionStats || null });
        } else {
          process.stdout.write(' SC-pass-skip (coverage ok)');
        }
      }

      // If we have a successful analysis result, write the artist profile back to artistGenres
      if (lastAnalysis && lastAnalysis.success && !dryRun) {
        try {
          const profile = {
            trackMatrix: lastAnalysis.trackMatrix || [],
            genreMapping: lastAnalysis.genreMapping || null,
            recentEvolution: lastAnalysis.recentEvolution || null,
            averageFeatures: lastAnalysis.averageFeatures || null,
            spectralFeatures: lastAnalysis.spectralFeatures || null,
            metadata: lastAnalysis.metadata || {}
          };
          // Write the profile first, then set the "built" flag only after verifying the profile was written
          try {
            const updProfileRes = await artistCol.updateOne({ _id: artist._id }, { $set: { essentiaAudioProfile: profile, essentiaVersion: lastAnalysis.metadata?.version || '2.0' } });
            // Mark the profile as built only when we have the configured number of tracks (maxTracks).
            // If we have some tracks but fewer than maxTracks, save as a staged profile so subsequent runs resume
            const tmLen = Array.isArray(profile.trackMatrix) ? profile.trackMatrix.length : 0;
            if (updProfileRes && updProfileRes.modifiedCount > 0 && tmLen >= maxTracks) {
              // Complete profile
              await artistCol.updateOne({ _id: artist._id }, { $set: { essentiaProfileBuilt: true, essentiaProfileDate: new Date() }, $unset: { essentiaProfileStaged: '' } });
              writesSucceeded++;
              process.stdout.write(' UPDATED_ARTIST');
              process.stdout.write('\nMETRIC|essentia_write|success');
            } else if (updProfileRes && updProfileRes.modifiedCount > 0 && tmLen > 0) {
              // Partial/staged profile: save it but do not set built flag so the resume batch will continue
              await artistCol.updateOne({ _id: artist._id }, { $set: { essentiaProfileStaged: true, essentiaProfileDate: new Date() } });
              stagedCreated++;
              writesSucceeded++;
              process.stdout.write(' STAGED_ARTIST');
              process.stdout.write('\nMETRIC|essentia_write|staged');
            } else {
              // Log a warning when the profile is missing/empty or the update had no effect
              writesFailed++;
              console.error('   ⚠️ Profile write did not produce a usable trackMatrix or no change was recorded; leaving essentiaProfileBuilt unset');
              process.stdout.write('\nMETRIC|essentia_write|failure');
            }
          } catch (uerr) {
            console.error('   ❌ Failed to update artist profile:', uerr.message);
          }
        } catch (uerr) {
          console.error('   ❌ Failed to update artist profile:', uerr.message);
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
  console.log({ total: artists.length, improved, skipped, scTriggered, errors, writesSucceeded, writesFailed, stagedCreated });
  try {
  const payload = { total: artists.length, improved, skipped, scTriggered, errors, writesSucceeded, writesFailed, stagedCreated, results };
    // Always print JSON to stdout so Heroku one-off runs can capture it even if /tmp write fails
    console.log('===BATCH_COVERAGE_JSON_START===');
    console.log(JSON.stringify(payload, null, 2));
    console.log('===BATCH_COVERAGE_JSON_END===');
  const outPath = path.join(os.tmpdir(), 'batch_coverage_results.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log('Wrote results to', outPath);
  } catch (werr) {
    console.error('Failed to write /tmp results:', werr.message);
  }
  await client.close();
})();

async function callAnalyze(artistName, spotifyId, existingGenres, strategy, extraBody={}) {
  const body = { artistName, spotifyId, existingGenres, maxTracks, fastMode: fastModeFlag, previewStrategy: strategy, ...extraBody };
  const resp = await fetch(`${SERVICE_URL}/api/analyze-artist`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`analyze-artist failed ${resp.status}`);
  return resp.json();
}

function reportResult(label, r){
  if (!r) return;
  const analyzed = r.metadata?.totalTracksAnalyzed || 0;
  const sources = r.metadata?.audioSources || {};
  const deezer = sources.deezer || 0;
  const apple = sources.apple || 0;
  process.stdout.write(`${label}[tracks=${analyzed}, apple=${apple}, deezer=${deezer}]`);
  if (r.acquisitionStats?.previewSourceCounts?.soundcloud) process.stdout.write(` soundcloud=${r.acquisitionStats.previewSourceCounts.soundcloud}`);
}
