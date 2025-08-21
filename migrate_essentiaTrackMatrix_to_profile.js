const { MongoClient } = require('mongodb');

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && process.argv.length > idx + 1 ? process.argv[idx + 1] : def;
}

const apply = process.argv.includes('--apply');
const removeOld = process.argv.includes('--remove-old');
const dry = !apply;
const batchSize = parseInt(getArg('--batch', '200'), 10);

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }
  const client = await MongoClient.connect(uri, { useUnifiedTopology: true });
  const db = client.db();
  const col = db.collection('artistGenres');

  const filter = { essentiaTrackMatrix: { $exists: true } };
  const total = await col.countDocuments(filter);
  console.log(`Found ${total} documents with top-level essentiaTrackMatrix`);
  if (total === 0) { await client.close(); process.exit(0); }

  // show a sample document (id + lengths)
  const sample = await col.findOne(filter, { projection: { _id:1, essentiaTrackMatrix:1, 'essentiaAudioProfile.trackMatrix':1 } });
  console.log('Sample doc (truncated):', JSON.stringify({ _id: sample._id, topLen: (sample.essentiaTrackMatrix||[]).length, nestedLen: (sample.essentiaAudioProfile && sample.essentiaAudioProfile.trackMatrix) ? sample.essentiaAudioProfile.trackMatrix.length : 0 }, null, 2));

  if (dry) {
    console.log('\nDRY RUN - no changes will be made. To apply changes run with --apply');
    await client.close();
    process.exit(0);
  }

  console.log('\nAPPLYING migration...');
  const cursor = col.find(filter).batchSize(batchSize);
  let processed = 0;
  while (await cursor.hasNext()) {
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      if (!await cursor.hasNext()) break;
      const doc = await cursor.next();
      const top = doc.essentiaTrackMatrix || [];
      // Skip copying empty arrays
      if (!Array.isArray(top) || top.length === 0) {
        processed++;
        continue;
      }
      const update = { $set: { 'essentiaAudioProfile.trackMatrix': top, 'essentiaProfileBuilt': true, 'essentiaProfileDate': new Date() } };
      if (removeOld) update.$unset = { 'essentiaTrackMatrix': '' };
      batch.push({ updateOne: { filter: { _id: doc._id }, update, upsert: false } });
    }
    if (batch.length > 0) {
      const res = await col.bulkWrite(batch, { ordered: false });
      console.log(`Applied batch: matched ${res.matchedCount}, modified ${res.modifiedCount}`);
    }
    processed += batch.length;
  }

  console.log('Migration completed. Processed (approx):', processed);
  await client.close();
})();
