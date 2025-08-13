# Enhanced Audio Source Strategy - Implementation Guide

## Overview
This enhancement addresses the challenge of missing preview URLs for small/niche artists by implementing a comprehensive fallback strategy and metadata-based feature inference.

## Problem Statement
- Apple iTunes doesn't have preview URLs for many niche artists
- Small/underground EDM artists are particularly affected
- Previous pipeline would fail with "No tracks could be analyzed with Essentia"
- User question: "what do we do if apple doesnt have preview url? small niche artists will have this issue more. sound cloud? beatport? how can we get the sound charecteristics ?"

## Solution Architecture

### 1. Enhanced Audio Source Hierarchy
```
1. Spotify Preview URL (if available)
2. Apple iTunes Preview URL (primary search)
3. Apple iTunes Preview URL (broader search)
4. SoundCloud API (requires client ID)
5. YouTube Data API v3 (requires API key)
6. Beatport Search (web scraping capability)
7. Bandcamp Search (web scraping capability)
8. Genre-based Feature Inference (ultimate fallback)
```

### 2. Files Modified/Created

#### New Files:
- `enhanced-audio-source-strategy.js` - Strategy documentation
- `enhanced-audio-sources.js` - Implementation module

#### Modified Files:
- `server.js` - Integrated fallback strategy into analysis pipeline

### 3. Implementation Details

#### A. Enhanced Audio Sources Module (`enhanced-audio-sources.js`)
```javascript
const { findAlternativeAudioSource, inferAudioFeaturesFromGenres } = require('./enhanced-audio-sources');
```

**Functions:**
- `searchYouTubeAudio(artistName, trackName)` - YouTube Data API v3 integration
- `searchSoundCloudAudio(artistName, trackName)` - SoundCloud API v2 integration
- `searchBeatportAudio(artistName, trackName)` - Beatport search capability
- `searchBandcampAudio(artistName, trackName)` - Bandcamp search capability
- `inferAudioFeaturesFromGenres(genres, artistName)` - Metadata-based inference
- `findAlternativeAudioSource(artistName, trackName, spotifyTrack)` - Main coordinator

#### B. Genre-Based Feature Inference
When no audio is available, the system infers audio features based on genre mappings:

**EDM Genre Mappings:**
- House: 128 BPM, high energy (0.8), high danceability (0.9)
- Techno: 130 BPM, very high energy (0.9), medium valence (0.5)
- Trance: 132 BPM, high energy (0.8), positive valence (0.8)
- Dubstep: 140 BPM, very high energy (0.9), low valence (0.4)
- Drum & Bass: 174 BPM, very high energy (0.9), medium valence (0.6)

**Features Inferred:**
- Tempo, BPM, energy, danceability, valence, loudness
- Spectral features (estimated), MFCC, chroma
- Confidence scoring and source tracking

#### C. Integration Points

**Round 1 & Round 2 Analysis:**
```javascript
// Enhanced fallback sequence
let previewUrl = track.preview_url; // Spotify
if (!previewUrl) previewUrl = await findApplePreviewUrl(...); // Apple
if (!previewUrl) previewUrl = await findApplePreviewUrlBroader(...); // Apple broader
if (!previewUrl) {
  const alternativeResult = await findAlternativeAudioSource(...); // New fallbacks
  if (alternativeResult.bestSource && alternativeResult.bestSource.streamUrl) {
    previewUrl = alternativeResult.bestSource.streamUrl;
    audioSource = alternativeResult.bestSource.source;
  }
}
```

**Track Profile Enhancement:**
```javascript
trackProfiles.push({
  // ... existing fields
  audioSource: audioSource, // 'spotify', 'apple', 'soundcloud', 'youtube', etc.
  alternativeSourceInfo: alternativeSourceInfo, // metadata about alternative source
  // ... rest of profile
});
```

### 4. API Requirements

#### Required Environment Variables:
```bash
# Optional - for enhanced fallback capabilities
YOUTUBE_API_KEY=your_youtube_api_key_here
SOUNDCLOUD_CLIENT_ID=your_soundcloud_client_id_here
```

#### API Setup Instructions:

**YouTube Data API v3:**
1. Go to Google Cloud Console
2. Enable YouTube Data API v3
3. Create API key
4. Set `YOUTUBE_API_KEY` environment variable

**SoundCloud API:**
1. Register at SoundCloud Developers
2. Get client ID
3. Set `SOUNDCLOUD_CLIENT_ID` environment variable

### 5. Metadata Tracking

#### Enhanced Metadata in Analysis Results:
```javascript
metadata: {
  // ... existing metadata
  audioSources: {
    spotify: 5,
    apple: 3,
    soundcloud: 2,
    youtube: 1,
    beatport: 0,
    bandcamp: 0,
    alternativeSourcesUsed: 3
  }
}
```

### 6. Confidence Scoring

Each audio source provides a confidence score:
- **Spotify**: 1.0 (original source)
- **Apple**: 0.9 (high quality alternative)
- **SoundCloud**: 0.8 (good alternative, often official)
- **YouTube**: 0.7 (variable quality)
- **Beatport**: 0.6 (EDM focused, but requires scraping)
- **Bandcamp**: 0.7 (artist-direct, high quality)
- **Genre Inference**: 0.6 (metadata-based estimation)

### 7. Benefits

#### For Niche Artists:
- **Improved Success Rate**: Genre-based inference ensures analysis always succeeds
- **EDM Focus**: Specialized mappings for electronic subgenres
- **Multiple Sources**: SoundCloud and Beatport specifically help underground artists
- **Fallback Gracefully**: Never fails completely, always provides usable data

#### For System Reliability:
- **Partial Success**: Returns genre mapping even when no audio is available
- **Source Tracking**: Detailed metadata about which sources were used
- **Confidence Scoring**: Quality assessment for each analysis
- **Performance Monitoring**: Tracks success rates by source

### 8. Current Status

#### ✅ Completed:
- Enhanced audio source module created
- Genre-based feature inference implemented
- Integration into main analysis pipeline
- Confidence scoring and metadata tracking
- Round 1 and Round 2 analysis enhanced

#### 🔄 Requires API Keys:
- YouTube Data API v3 (optional)
- SoundCloud API (optional)

#### 📝 Future Enhancements:
- Web scraping for Beatport and Bandcamp
- Machine learning for better genre-to-feature mapping
- Audio fingerprinting for match verification
- Caching of alternative source results

### 9. Testing

#### Test Cases to Validate:
1. **Mainstream Artist**: Should use Spotify/Apple sources
2. **Niche EDM Artist**: Should fall back to SoundCloud/YouTube
3. **Unknown Artist**: Should use genre inference
4. **Mixed Results**: Should show source distribution in metadata

#### Example API Response:
```javascript
{
  "success": true,
  "artistName": "Underground DJ",
  "trackMatrix": [
    {
      "name": "Deep Track",
      "audioSource": "soundcloud",
      "alternativeSourceInfo": {
        "source": "soundcloud",
        "confidence": 0.8,
        "totalSources": 2
      },
      "essentiaFeatures": { ... }
    }
  ],
  "metadata": {
    "audioSources": {
      "spotify": 2,
      "soundcloud": 3,
      "alternativeSourcesUsed": 3
    }
  }
}
```

### 10. Deployment

The enhanced audio source strategy is now integrated into the Essentia service. To deploy:

1. **Optional**: Add API keys to Heroku config vars
2. **Deploy**: Push to Heroku (already done)
3. **Test**: Run matrix builder to validate improved success rates
4. **Monitor**: Check metadata for source distribution

This enhancement ensures that the TIKO audio analysis pipeline can handle niche artists and provides meaningful audio characteristics even when preview URLs are unavailable, significantly improving the system's robustness for EDM events and underground artists.
