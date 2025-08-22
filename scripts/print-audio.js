#!/usr/bin/env node
// print-audio.js
// Prints full audio_features doc for inspection

const { MongoClient, ObjectId } = require('mongodb');
const id = '68927a3169f0532f886dead9';

(async function(){
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(2);
  }
  const client = await MongoClient.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = client.db();
  const audioCol = db.collection('audio_features');
  const doc = await audioCol.findOne({ _id: new ObjectId(id) });
  console.log(JSON.stringify(doc, null, 2));
  await client.close();
})();
