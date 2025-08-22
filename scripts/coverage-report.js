#!/usr/bin/env node
// coverage-report.js
// Quick Mongo coverage report for artist -> essentia audio vectors -> events impact
// Usage: set MONGODB_URI in env then run: node scripts/coverage-report.js

const { MongoClient } = require('mongodb');

(async function(){
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI environment variable.');
    console.error('Set it from your project config or Heroku config and re-run.');
    process.exit(2);
  }

  let client;
  try {
    client = await MongoClient.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    const db = client.db();

    const artistCol = db.collection('artistGenres');
    const audioCol = db.collection('audio_features');
    const eventsCol = db.collection('events'); // adjust if your events collection differs

    const totalArtists = await artistCol.countDocuments();

    // audio_features in this deployment store top-level `source: 'essentia'` and often only trackId
    // Count total essentia vectors (per-track)
    const totalEssentiaTracks = await audioCol.countDocuments({ source: 'essentia' });

    // Heuristic: try to attribute audio_features to artists by matching any of:
    // - audio_features.artist == artist.name
    // - audio_features.spotifyId == artist.spotifyId
    // - audio_features.trackId in artist.topTrackIds or artist.recentTrackIds (if those arrays exist)
    // We'll compute vectorsCount per artist via aggregation lookup.

    const dist = await artistCol.aggregate([
      { $project: { name: 1, spotifyId: 1, topTrackIds: 1, recentTrackIds: 1 } },
      { $lookup: {
          from: 'audio_features',
          let: { name: '$name', spotifyId: '$spotifyId', topTrackIds: '$topTrackIds', recentTrackIds: '$recentTrackIds' },
          pipeline: [
            { $match: { $expr: { $eq: ['$source', 'essentia'] } } },
            { $match: { $expr: {
              $or: [
                { $and: [ { $ne: ['$$name', null] }, { $eq: ['$artist', '$$name'] } ] },
                { $and: [ { $ne: ['$$spotifyId', null] }, { $eq: ['$spotifyId', '$$spotifyId'] } ] },
                { $and: [ { $isArray: ['$$topTrackIds'] }, { $in: ['$trackId', '$$topTrackIds'] } ] },
                { $and: [ { $isArray: ['$$recentTrackIds'] }, { $in: ['$trackId', '$$recentTrackIds'] } ] }
              ]
            } } }
          ],
          as: 'vec'
      } },
      { $addFields: { vectorsCount: { $size: '$vec' } } },
      { $group: { _id: null, avg: { $avg: '$vectorsCount' }, min: { $min: '$vectorsCount' }, max: { $max: '$vectorsCount' }, totalArtistsWithVectors: { $sum: { $cond: [ { $gt: ['$vectorsCount', 0] }, 1, 0 ] } } } }
    ]).toArray();

  const avgVectorsPerArtist = dist[0]?.avg || 0;
  // Use artistGenres.essentiaAudioProfile.trackMatrix as the authoritative coverage marker
  const totalArtistsWithVectors = await artistCol.countDocuments({ 'essentiaAudioProfile.trackMatrix.0': { $exists: true } });
  const artistsZeroVectors = totalArtists - totalArtistsWithVectors;

    // Top 20 artists with fewest vectors (including zero) to prioritize
  // Top missing: artists that don't have an essentiaAudioProfile.trackMatrix
  const topMissing = await artistCol.find({ 'essentiaAudioProfile.trackMatrix.0': { $exists: false } }, { projection: { name: 1, spotifyId: 1, topTrackIds: 1, recentTrackIds: 1 } }).limit(20).toArray();

    // Events that reference artists which lack essentia vectors
    // This uses event.artistName — adjust if your events schema differs
  const eventsImpacted = await eventsCol.aggregate([
      { $match: { artistName: { $exists: true, $ne: null } } },
      { $lookup: {
          from: 'audio_features',
          let: { artistName: '$artistName' },
          pipeline: [
            { $match: { $expr: { $and: [ { $eq: ['$artist', '$$artistName'] }, { $eq: ['$source', 'essentia'] } ] } } },
            { $limit: 1 }
          ],
          as: 'vec'
      } },
      { $match: { vec: { $size: 0 } } },
      { $group: { _id: null, impactedEvents: { $sum: 1 } } }
    ]).toArray();

  // sample any audio docs missing artist/spotifyId to help diagnose schema problems
  const sampleAudioMissing = await audioCol.find({ $or: [ { artist: { $exists: false } }, { artist: null }, { spotifyId: { $exists: false } }, { spotifyId: null } ] }).limit(10).toArray();

    const report = {
      totalArtists,
      totalEssentiaTracks,
      totalArtistsWithVectors,
      artistsZeroVectors,
      avgVectorsPerArtist,
      topMissing: topMissing.map(a => ({ name: a.name, spotifyId: a.spotifyId, vectorsCount: a.vectorsCount })),
      eventsImpacted: eventsImpacted[0]?.impactedEvents || 0,
      sampleAudioMissing
    };

    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error running coverage report:', err && err.message ? err.message : err);
    process.exit(3);
  } finally {
    if (client) await client.close();
  }
})();
