// Enhanced Audio Source Module for Essentia Pipeline
// Provides fallback strategies for finding audio when Apple iTunes doesn't have preview URLs

const https = require('https');
const fetch = require('node-fetch');

/**
 * Search for artist tracks on YouTube Music/YouTube
 */
async function searchYouTubeAudio(artistName, trackName) {
  console.log(`🎵 Searching YouTube for: ${artistName} - ${trackName}`);
  
  try {
    // Use YouTube Data API v3 (requires API key)
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.log('⚠️ YouTube API key not configured');
      return null;
    }

    const query = encodeURIComponent(`${artistName} ${trackName}`);
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=5&key=${apiKey}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      // Find the best match (prefer official uploads)
      const bestMatch = data.items.find(item => 
        item.snippet.title.toLowerCase().includes('official') ||
        item.snippet.channelTitle.toLowerCase().includes(artistName.toLowerCase())
      ) || data.items[0];
      
      return {
        source: 'youtube',
        url: `https://www.youtube.com/watch?v=${bestMatch.id.videoId}`,
        title: bestMatch.snippet.title,
        channelTitle: bestMatch.snippet.channelTitle,
        confidence: 0.7,
        note: 'YouTube requires audio extraction from video for Essentia analysis'
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ YouTube search error:', error.message);
    return null;
  }
}

/**
 * Search for artist tracks on SoundCloud
 */
async function searchSoundCloudAudio(artistName, trackName) {
  console.log(`🔊 Searching SoundCloud for: ${artistName} - ${trackName}`);
  
  try {
    // Use SoundCloud API v2 with provided client ID
    const clientId = process.env.SOUNDCLOUD_CLIENT_ID || 'lcKCKyUaMW1dgS42vr9wdJkSmrGRZcGh';
    
    if (!clientId) {
      console.log('⚠️ SoundCloud client ID not configured');
      return null;
    }

    const query = encodeURIComponent(`${artistName} ${trackName}`);
    const url = `https://api-v2.soundcloud.com/search/tracks?q=${query}&client_id=${clientId}&limit=5`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.collection && data.collection.length > 0) {
      // Find the best match (prefer verified artists)
      const bestMatch = data.collection.find(track => 
        track.user.verified ||
        track.user.username.toLowerCase().includes(artistName.toLowerCase()) ||
        track.title.toLowerCase().includes(trackName.toLowerCase())
      ) || data.collection[0];
      
      return {
        source: 'soundcloud',
        url: bestMatch.permalink_url,
        streamUrl: bestMatch.stream_url ? `${bestMatch.stream_url}?client_id=${clientId}` : null,
        title: bestMatch.title,
        user: bestMatch.user.username,
        confidence: 0.8,
        note: 'SoundCloud provides streaming URLs but requires audio extraction for Essentia analysis'
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ SoundCloud search error:', error.message);
    return null;
  }
}

/**
 * Search for artist tracks on Beatport (EDM focused)
 */
async function searchBeatportAudio(artistName, trackName) {
  console.log(`🎧 Searching Beatport for: ${artistName} - ${trackName}`);
  
  try {
    // Beatport doesn't have a public API, but we can scrape search results
    // This is a simplified example - in production, consider using a proper API or service
    const query = encodeURIComponent(`${artistName} ${trackName}`);
    const url = `https://www.beatport.com/search?q=${query}`;
    
    // Note: This would require HTML parsing in a real implementation
    // For now, return a placeholder that indicates Beatport search capability
    console.log(`🔍 Beatport search URL: ${url}`);
    
    return {
      source: 'beatport',
      searchUrl: url,
      note: 'Beatport search capability - requires HTML parsing and audio extraction for analysis',
      confidence: 0.6
    };
  } catch (error) {
    console.error('❌ Beatport search error:', error.message);
    return null;
  }
}

/**
 * Search for artist tracks on Bandcamp
 */
async function searchBandcampAudio(artistName, trackName) {
  console.log(`🎼 Searching Bandcamp for: ${artistName} - ${trackName}`);
  
  try {
    // Bandcamp search - similar to Beatport, would require scraping
    const query = encodeURIComponent(`${artistName} ${trackName}`);
    const url = `https://bandcamp.com/search?q=${query}`;
    
    console.log(`🔍 Bandcamp search URL: ${url}`);
    
    return {
      source: 'bandcamp',
      searchUrl: url,
      note: 'Bandcamp search capability - requires HTML parsing and audio extraction for analysis',
      confidence: 0.7
    };
  } catch (error) {
    console.error('❌ Bandcamp search error:', error.message);
    return null;
  }
}

/**
 * Infer audio features from genres and metadata when no audio is available
 * This provides sound characteristics based on musical knowledge and genre analysis
 */
function inferAudioFeaturesFromGenres(genres, artistName, trackName = null) {
  console.log(`📊 Inferring audio features from genres: ${genres.join(', ')}`);
  
  const genreMappings = {
    // EDM genres - Primary focus for TIKO
    'house': { tempo: 128, energy: 0.8, danceability: 0.9, valence: 0.7, loudness: -8, arousal: 0.8 },
    'tech house': { tempo: 126, energy: 0.85, danceability: 0.9, valence: 0.6, loudness: -7, arousal: 0.85 },
    'deep house': { tempo: 122, energy: 0.7, danceability: 0.8, valence: 0.8, loudness: -10, arousal: 0.7 },
    'progressive house': { tempo: 128, energy: 0.8, danceability: 0.7, valence: 0.7, loudness: -8, arousal: 0.75 },
    'techno': { tempo: 130, energy: 0.9, danceability: 0.8, valence: 0.5, loudness: -6, arousal: 0.9 },
    'minimal techno': { tempo: 128, energy: 0.8, danceability: 0.7, valence: 0.4, loudness: -8, arousal: 0.75 },
    'trance': { tempo: 132, energy: 0.8, danceability: 0.7, valence: 0.8, loudness: -7, arousal: 0.8 },
    'progressive trance': { tempo: 132, energy: 0.85, danceability: 0.7, valence: 0.8, loudness: -7, arousal: 0.85 },
    'uplifting trance': { tempo: 132, energy: 0.9, danceability: 0.8, valence: 0.9, loudness: -6, arousal: 0.9 },
    'psytrance': { tempo: 145, energy: 0.95, danceability: 0.8, valence: 0.6, loudness: -5, arousal: 0.95 },
    'dubstep': { tempo: 140, energy: 0.9, danceability: 0.8, valence: 0.4, loudness: -5, arousal: 0.85 },
    'brostep': { tempo: 140, energy: 0.95, danceability: 0.9, valence: 0.5, loudness: -4, arousal: 0.9 },
    'drum and bass': { tempo: 174, energy: 0.9, danceability: 0.7, valence: 0.6, loudness: -6, arousal: 0.9 },
    'liquid dnb': { tempo: 170, energy: 0.8, danceability: 0.8, valence: 0.8, loudness: -8, arousal: 0.75 },
    'neurofunk': { tempo: 174, energy: 0.95, danceability: 0.6, valence: 0.3, loudness: -5, arousal: 0.9 },
    'electro': { tempo: 128, energy: 0.85, danceability: 0.85, valence: 0.6, loudness: -7, arousal: 0.8 },
    'electro house': { tempo: 128, energy: 0.9, danceability: 0.9, valence: 0.7, loudness: -6, arousal: 0.85 },
    'big room': { tempo: 128, energy: 0.95, danceability: 0.9, valence: 0.8, loudness: -4, arousal: 0.9 },
    'future house': { tempo: 125, energy: 0.85, danceability: 0.9, valence: 0.75, loudness: -6, arousal: 0.8 },
    'bass house': { tempo: 128, energy: 0.9, danceability: 0.95, valence: 0.7, loudness: -5, arousal: 0.85 },
    'edm': { tempo: 128, energy: 0.85, danceability: 0.9, valence: 0.7, loudness: -6, arousal: 0.8 },
    'festival trap': { tempo: 140, energy: 0.9, danceability: 0.85, valence: 0.6, loudness: -5, arousal: 0.85 },
    'future bass': { tempo: 150, energy: 0.8, danceability: 0.8, valence: 0.7, loudness: -6, arousal: 0.75 },
    'melodic dubstep': { tempo: 140, energy: 0.8, danceability: 0.7, valence: 0.6, loudness: -7, arousal: 0.75 },
    'hardstyle': { tempo: 150, energy: 0.95, danceability: 0.8, valence: 0.6, loudness: -4, arousal: 0.9 },
    'hardcore': { tempo: 180, energy: 0.98, danceability: 0.7, valence: 0.4, loudness: -3, arousal: 0.95 },
    
    // Other electronic
    'electronic': { tempo: 120, energy: 0.7, danceability: 0.7, valence: 0.6, loudness: -8, arousal: 0.7 },
    'ambient': { tempo: 90, energy: 0.3, danceability: 0.2, valence: 0.5, loudness: -15, arousal: 0.3 },
    'downtempo': { tempo: 100, energy: 0.4, danceability: 0.4, valence: 0.6, loudness: -12, arousal: 0.4 },
    'chillout': { tempo: 95, energy: 0.3, danceability: 0.3, valence: 0.7, loudness: -12, arousal: 0.3 },
    'synthwave': { tempo: 120, energy: 0.7, danceability: 0.6, valence: 0.6, loudness: -8, arousal: 0.65 },
    
    // Non-electronic genres
    'rock': { tempo: 120, energy: 0.7, danceability: 0.4, valence: 0.5, loudness: -8, arousal: 0.7 },
    'pop': { tempo: 110, energy: 0.6, danceability: 0.6, valence: 0.7, loudness: -10, arousal: 0.6 },
    'hip hop': { tempo: 90, energy: 0.6, danceability: 0.8, valence: 0.5, loudness: -8, arousal: 0.65 },
    'rap': { tempo: 95, energy: 0.7, danceability: 0.8, valence: 0.5, loudness: -7, arousal: 0.7 },
    'country': { tempo: 100, energy: 0.5, danceability: 0.4, valence: 0.7, loudness: -12, arousal: 0.5 },
    'jazz': { tempo: 100, energy: 0.4, danceability: 0.3, valence: 0.6, loudness: -15, arousal: 0.4 },
    'classical': { tempo: 90, energy: 0.3, danceability: 0.1, valence: 0.5, loudness: -20, arousal: 0.3 },
    'metal': { tempo: 140, energy: 0.9, danceability: 0.3, valence: 0.3, loudness: -5, arousal: 0.9 },
    'metalcore': { tempo: 150, energy: 0.95, danceability: 0.4, valence: 0.3, loudness: -4, arousal: 0.9 },
    'punk': { tempo: 160, energy: 0.9, danceability: 0.5, valence: 0.4, loudness: -6, arousal: 0.85 },
    'reggae': { tempo: 80, energy: 0.5, danceability: 0.7, valence: 0.8, loudness: -10, arousal: 0.5 },
    'funk': { tempo: 110, energy: 0.7, danceability: 0.9, valence: 0.8, loudness: -8, arousal: 0.75 },
    'disco': { tempo: 120, energy: 0.8, danceability: 0.95, valence: 0.9, loudness: -7, arousal: 0.8 }
  };
  
  // Find best matching genre and get its features
  let bestMatch = null;
  let bestScore = 0;
  let matchedGenre = '';
  
  for (const genre of genres) {
    const genreLower = genre.toLowerCase();
    for (const [mappedGenre, features] of Object.entries(genreMappings)) {
      if (genreLower.includes(mappedGenre)) {
        const score = mappedGenre.length; // Prefer more specific matches
        if (score > bestScore) {
          bestMatch = features;
          bestScore = score;
          matchedGenre = mappedGenre;
        }
      }
    }
  }
  
  // Advanced inference based on artist name and track name
  const artistLower = artistName.toLowerCase();
  const trackLower = (trackName || '').toLowerCase();
  
  // DJ name patterns suggest electronic music
  const isDJ = artistLower.includes('dj ') || artistLower.startsWith('dj') || artistLower.includes(' dj');
  
  // Artist name hints for EDM subgenres
  const artistHints = {
    techno: ['richie', 'hawtin', 'liebing', 'beyer', 'cox', 'digweed'],
    house: ['solardo', 'fisher', 'green velvet', 'claude', 'patrick topping'],
    trance: ['van buuren', 'corsten', 'oakenfold', 'tiesto', 'above & beyond'],
    dubstep: ['skrillex', 'zomboy', 'excision', 'nero'],
    dnb: ['pendulum', 'netsky', 'matrix', 'futurebound']
  };
  
  // Check for artist-specific genre hints
  for (const [hintGenre, artists] of Object.entries(artistHints)) {
    if (artists.some(hint => artistLower.includes(hint))) {
      if (genreMappings[hintGenre]) {
        bestMatch = genreMappings[hintGenre];
        matchedGenre = hintGenre + ' (artist_hint)';
        break;
      }
    }
  }
  
  // Track name analysis for additional context
  const trackHints = {
    remix: 0.1, // Remixes tend to be more energetic
    extended: -0.05, // Extended versions might be slightly less intense
    radio: -0.1, // Radio edits might be toned down
    club: 0.15, // Club versions are more danceable
    vocal: 0.05, // Vocal versions might be more positive
    instrumental: -0.05 // Instrumental might be less emotional
  };
  
  let trackModifier = 0;
  for (const [hint, modifier] of Object.entries(trackHints)) {
    if (trackLower.includes(hint)) {
      trackModifier += modifier;
    }
  }
  
  // Default fallback logic
  if (!bestMatch) {
    const hasElectronicTerms = genres.some(g => 
      g.toLowerCase().includes('electronic') || 
      g.toLowerCase().includes('dance') ||
      g.toLowerCase().includes('edm')
    ) || isDJ;
    
    if (hasElectronicTerms) {
      bestMatch = genreMappings['electronic'];
      matchedGenre = 'electronic (fallback)';
    } else {
      bestMatch = genreMappings['pop']; // Safe default
      matchedGenre = 'pop (default)';
    }
  }
  
  // Add variance and track modifiers to avoid identical profiles
  const variance = 0.08; // Slightly reduced variance for more consistent results
  const addVariance = (value, extraModifier = 0) => {
    const variation = (Math.random() - 0.5) * variance;
    const modified = value + variation + extraModifier;
    return Math.max(0, Math.min(1, modified));
  };
  
  const addTempoVariance = (tempo) => {
    const variation = (Math.random() - 0.5) * 8; // ±4 BPM variance
    return Math.max(60, Math.min(200, tempo + variation));
  };
  
  const inferredFeatures = {
    // Core rhythm features
    tempo: addTempoVariance(bestMatch.tempo),
    beats_per_minute: addTempoVariance(bestMatch.tempo),
    rhythm_strength: addVariance(0.7, trackModifier * 0.5),
    
    // Energy and emotion
    energy: addVariance(bestMatch.energy, trackModifier),
    danceability: addVariance(bestMatch.danceability, trackModifier * 0.8),
    valence: addVariance(bestMatch.valence, trackModifier * 0.6),
    arousal: addVariance(bestMatch.arousal || bestMatch.energy, trackModifier),
    
    // Audio characteristics (estimated)
    loudness: bestMatch.loudness + (Math.random() - 0.5) * 4,
    dynamic_range: 12 + (Math.random() - 0.5) * 8,
    
    // Spectral features (genre-based estimates)
    spectral_centroid: (bestMatch.energy * 2500) + 1500 + (Math.random() - 0.5) * 800,
    spectral_rolloff: (bestMatch.energy * 4000) + 3000 + (Math.random() - 0.5) * 1200,
    spectral_bandwidth: (bestMatch.energy * 1500) + 800 + (Math.random() - 0.5) * 400,
    mfcc_mean: (Math.random() - 0.5) * 25,
    chroma_mean: addVariance(0.5),
    zero_crossing_rate: addVariance(0.1),
    
    // Harmonic and timbral characteristics
    harmonic_ratio: addVariance(0.6),
    pitch_salience: addVariance(0.4),
    inharmonicity: addVariance(0.3),
    
    // Analysis metadata
    analysis_source: 'genre_inference',
    analysis_version: '2.2-enhanced-metadata',
    confidence: Math.max(0.5, Math.min(0.8, 0.6 + (bestScore * 0.02))), // Higher confidence for better matches
    inference_genres: genres,
    matched_genre: matchedGenre,
    artist_is_dj: isDJ,
    track_modifiers: Object.keys(trackHints).filter(hint => trackLower.includes(hint))
  };
  
  console.log(`📊 Inferred features from "${matchedGenre}"`);
  console.log(`   Tempo: ${inferredFeatures.tempo.toFixed(0)} BPM`);
  console.log(`   Energy: ${inferredFeatures.energy.toFixed(2)}`);
  console.log(`   Danceability: ${inferredFeatures.danceability.toFixed(2)}`);
  console.log(`   Valence: ${inferredFeatures.valence.toFixed(2)}`);
  console.log(`   Confidence: ${inferredFeatures.confidence.toFixed(2)}`);
  if (inferredFeatures.track_modifiers.length > 0) {
    console.log(`   Track hints: ${inferredFeatures.track_modifiers.join(', ')}`);
  }
  
  return inferredFeatures;
}

/**
 * Main fallback strategy coordinator
 */
async function findAlternativeAudioSource(artistName, trackName, spotifyTrack = null) {
  console.log(`🔍 Finding alternative audio source for: ${artistName} - ${trackName}`);
  
  const sources = [];
  
  // Try all fallback sources in parallel
  const [youtube, soundcloud, beatport, bandcamp] = await Promise.allSettled([
    searchYouTubeAudio(artistName, trackName),
    searchSoundCloudAudio(artistName, trackName),
    searchBeatportAudio(artistName, trackName),
    searchBandcampAudio(artistName, trackName)
  ]);
  
  // Collect successful results
  if (youtube.status === 'fulfilled' && youtube.value) sources.push(youtube.value);
  if (soundcloud.status === 'fulfilled' && soundcloud.value) sources.push(soundcloud.value);
  if (beatport.status === 'fulfilled' && beatport.value) sources.push(beatport.value);
  if (bandcamp.status === 'fulfilled' && bandcamp.value) sources.push(bandcamp.value);
  
  // Sort by confidence score
  sources.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  
  console.log(`📊 Found ${sources.length} alternative sources`);
  
  return {
    alternativeSources: sources,
    bestSource: sources[0] || null,
    totalSources: sources.length
  };
}

module.exports = {
  searchYouTubeAudio,
  searchSoundCloudAudio,
  searchBeatportAudio,
  searchBandcampAudio,
  inferAudioFeaturesFromGenres,
  findAlternativeAudioSource
};
