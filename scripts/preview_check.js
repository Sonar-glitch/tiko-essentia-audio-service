(async ()=>{
  const fs = require('fs');
  const path = require('path');
  const mod = require('../enhanced-audio-sources.js');

  const csvPath = path.resolve(__dirname, '..', 'artists_tracks.csv');
  const outPath = path.resolve(__dirname, '..', 'preview_check_results.json');

  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  console.log('Lines:', lines.length);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^([^,]+),([\s\S]*)$/);
    if (!m) { console.log('Skipping malformed:', line); continue; }
    const artist = m[1].trim();
    const track = m[2].trim();
    console.log('Querying:', artist, '-', track);
    try {
      const r = await mod.findAudioUrlEnhanced(artist, track);
      out.push({ artist, track, result: r });
    } catch (e) {
      console.error('Error for', artist, track, e.message);
      out.push({ artist, track, error: e.message });
    }
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Wrote', outPath);
})();
