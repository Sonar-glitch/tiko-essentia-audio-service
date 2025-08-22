const fs = require('fs');
const path = require('path');

describe('SoundCloud removal smoke tests', () => {
  test('server.js should not contain active SoundCloud lookup strings', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(server).not.toMatch(/SOUNDCLOUD_CLIENT_ID/);
    expect(server).not.toMatch(/soundcloud_primary/);
    expect(server).not.toMatch(/findSoundCloudAudioUrl/);
  });

  test('enhanced-audio-sources.js should not export SoundCloud helper', () => {
    const sources = fs.readFileSync(path.join(__dirname, '..', '..', 'users', 'sonar-edm-user', 'enhanced-audio-sources.js'), 'utf8');
    expect(sources).not.toMatch(/findSoundCloudAudioUrl/);
    expect(sources).not.toMatch(/SOUNDCLOUD_CLIENT_ID/);
  });

  test('SoundCloud worker stub returns graceful failure (class exists)', () => {
    const scPath = path.join(__dirname, '..', '..', 'heroku-workers', 'event-population', 'lib', 'soundCloudAPI.js');
    const exists = fs.existsSync(scPath);
    expect(exists).toBe(true);
    const sc = require(scPath);
    // class should be present and have getGracefulFailureResponse function
    const inst = new sc();
    const r = inst.getGracefulFailureResponse('Artist', 'SOUNDCLOUD_CLIENT_ID_MISSING');
    expect(r.gracefulDegradation).toBe(true);
  });
});
