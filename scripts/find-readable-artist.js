#!/usr/bin/env node
// find-readable-artist.js
// Find one artistGenres doc with a human-readable name field

const { MongoClient } = require('mongodb');
(async ()=>{
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGODB_URI'); process.exit(2); }
  const client = await MongoClient.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = client.db();
  const col = db.collection('artistGenres');
  const doc = await col.findOne({ $or: [ { name: { $exists: true, $ne: null } }, { originalName: { $exists: true, $ne: null } }, { artistName: { $exists: true, $ne: null } }, { displayName: { $exists: true, $ne: null } } ] });
  if (!doc) { console.log('No readable artist found'); process.exit(0); }
  console.log(JSON.stringify({ _id: doc._id, name: doc.name, originalName: doc.originalName, artistName: doc.artistName, displayName: doc.displayName, spotifyId: doc.spotifyId }, null, 2));
  await client.close();
})();
