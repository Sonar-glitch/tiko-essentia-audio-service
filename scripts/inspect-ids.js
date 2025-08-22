#!/usr/bin/env node
// inspect-ids.js
// Usage: set MONGODB_URI then node scripts/inspect-ids.js

const { MongoClient } = require('mongodb');

const ids = [
  '74NBPbyyftqJ4SpDZ4c1Ed',
  '4ItRDIouodpnW6nm4TYDk1',
  '0AkmSuTOzM2pNCIOSP8ziv',
  '4gzpq5DPGxSnKTe4SA8HAU',
  '2CIMQHirSU0MQqyYHq0eOx'
];

(async function(){
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(2);
  }

  const client = await MongoClient.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = client.db();
  const artistCol = db.collection('artistGenres');
  const audioCol = db.collection('audio_features');

  for (const id of ids) {
    console.log('\n=== Inspecting', id, '===');
    const artistDoc = await artistCol.findOne({ spotifyId: id });
    console.log('artistDoc:', artistDoc ? { _id: artistDoc._id, name: artistDoc.name, spotifyId: artistDoc.spotifyId } : 'NOT FOUND');

    // find audio docs where spotifyId field equals id
    const audioBySpotifyField = await audioCol.find({ spotifyId: id }).limit(5).toArray();
    console.log('audioBySpotifyField count:', audioBySpotifyField.length);

    // find audio docs where artist field equals id (artist field might store spotifyId)
    const audioByArtistEqId = await audioCol.find({ artist: id }).limit(5).toArray();
    console.log('audioByArtistEqId count:', audioByArtistEqId.length);

    // if artistDoc exists, search audio by artist name
    if (artistDoc && artistDoc.name) {
      const audioByName = await audioCol.find({ artist: artistDoc.name }).limit(5).toArray();
      console.log('audioByArtistName count:', audioByName.length);
      if (audioByName.length) console.log('sample audioByName[0]:', { _id: audioByName[0]._id, trackId: audioByName[0].trackId, artist: audioByName[0].artist, spotifyId: audioByName[0].spotifyId });
    }

    if (audioBySpotifyField.length) console.log('sample audioBySpotifyField[0]:', { _id: audioBySpotifyField[0]._id, trackId: audioBySpotifyField[0].trackId, artist: audioBySpotifyField[0].artist, spotifyId: audioBySpotifyField[0].spotifyId });
    if (audioByArtistEqId.length) console.log('sample audioByArtistEqId[0]:', { _id: audioByArtistEqId[0]._id, trackId: audioByArtistEqId[0].trackId, artist: audioByArtistEqId[0].artist, spotifyId: audioByArtistEqId[0].spotifyId });
  }

  // also show a small sample of audio docs to inspect shape
  console.log('\n=== sample audio_features docs (5) ===');
  const sample = await audioCol.find({}).limit(5).toArray();
  sample.forEach(d => console.log({ _id: d._id, trackId: d.trackId, artist: d.artist, spotifyId: d.spotifyId, features: d.features ? Object.keys(d.features) : null }));

  await client.close();
})();
