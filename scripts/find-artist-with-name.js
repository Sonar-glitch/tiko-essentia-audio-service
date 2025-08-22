#!/usr/bin/env node
// find-artist-with-name.js
// Prints one artistGenres doc that has a non-empty name and spotifyId

const { MongoClient } = require('mongodb');
(async ()=>{
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGODB_URI'); process.exit(2); }
  const client = await MongoClient.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = client.db();
  const col = db.collection('artistGenres');
  const doc = await col.findOne({ name: { $exists: true, $ne: null }, spotifyId: { $exists: true, $ne: null } });
  if (!doc) { console.log('No artist with name+spotifyId found'); process.exit(0); }
  console.log(JSON.stringify({ _id: doc._id, name: doc.name, spotifyId: doc.spotifyId }, null, 2));
  await client.close();
})();
