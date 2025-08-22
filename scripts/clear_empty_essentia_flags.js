#!/usr/bin/env node
// clear_empty_essentia_flags.js
// Unset `essentiaProfileBuilt` and `essentiaProfileDate` for documents
// where the flag is true but `essentiaAudioProfile.trackMatrix` is empty or missing.
// Usage: set MONGODB_URI and run: node scripts/clear_empty_essentia_flags.js

const { MongoClient } = require('mongodb');

(async function main(){
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error('Missing MONGODB_URI');
      process.exit(2);
    }

    const client = await MongoClient.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    const db = client.db();
    const col = db.collection('artistGenres');

    const selector = { essentiaProfileBuilt: true };
    const toUpdateSelector = {
      $and: [
        selector,
        { $or: [ { 'essentiaAudioProfile.trackMatrix': { $exists: false } }, { 'essentiaAudioProfile.trackMatrix': { $size: 0 } }, { essentiaAudioProfile: { $exists: false } } ] }
      ]
    };

    const toFixCount = await col.countDocuments(toUpdateSelector);
    console.log('Found documents to fix:', toFixCount);

    if (!toFixCount) {
      await client.close();
      process.exit(0);
    }

    // Perform the unset to allow resume processing
    const res = await col.updateMany(toUpdateSelector, { $unset: { essentiaProfileBuilt: '', essentiaProfileDate: '' } });
    console.log('Update result:', { matchedCount: res.matchedCount, modifiedCount: res.modifiedCount });

    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
