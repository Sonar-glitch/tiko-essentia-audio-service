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
        confidence: 0.7
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
    // Use SoundCloud API v2 (requires client ID)
    const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
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
        confidence: 0.8
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
      note: 'Beatport search capability - requires HTML parsing implementation',
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
      note: 'Bandcamp search capability - requires HTML parsing implementation',
      confidence: 0.7
    };
  } catch (error) {
    console.error('❌ Bandcamp search error:', error.message);
    return null;
  }
}

/**
 * Infer audio features from genres and metadata when no audio is available
 */
function inferAudioFeaturesFromGenres(genres, artistName) {
  console.log(`📊 Inferring audio features from genres: ${genres.join(', ')}`);
  
  const genreMappings = {
    // EDM genres
    'house': { tempo: 128, energy: 0.8, danceability: 0.9, valence: 0.7, loudness: -8 },
    'tech house': { tempo: 126, energy: 0.85, danceability: 0.9, valence: 0.6, loudness: -7 },
    'deep house': { tempo: 122, energy: 0.7, danceability: 0.8, valence: 0.8, loudness: -10 },
    'progressive house': { tempo: 128, energy: 0.8, danceability: 0.7, valence: 0.7, loudness: -8 },
    'techno': { tempo: 130, energy: 0.9, danceability: 0.8, valence: 0.5, loudness: -6 },
    'trance': { tempo: 132, energy: 0.8, danceability: 0.7, valence: 0.8, loudness: -7 },
    'progressive trance': { tempo: 132, energy: 0.85, danceability: 0.7, valence: 0.8, loudness: -7 },
    'uplifting trance': { tempo: 132, energy: 0.9, danceability: 0.8, valence: 0.9, loudness: -6 },
    'dubstep': { tempo: 140, energy: 0.9, danceability: 0.8, valence: 0.4, loudness: -5 },
    'drum and bass': { tempo: 174, energy: 0.9, danceability: 0.7, valence: 0.6, loudness: -6 },
    'electro': { tempo: 128, energy: 0.85, danceability: 0.85, valence: 0.6, loudness: -7 },
    'electro house': { tempo: 128, energy: 0.9, danceability: 0.9, valence: 0.7, loudness: -6 },
    'big room': { tempo: 128, energy: 0.95, danceability: 0.9, valence: 0.8, loudness: -4 },
    'edm': { tempo: 128, energy: 0.85, danceability: 0.9, valence: 0.7, loudness: -6 },
    
    // Other electronic
    'electronic': { tempo: 120, energy: 0.7, danceability: 0.7, valence: 0.6, loudness: -8 },
    'ambient': { tempo: 90, energy: 0.3, danceability: 0.2, valence: 0.5, loudness: -15 },
    'downtempo': { tempo: 100, energy: 0.4, danceability: 0.4, valence: 0.6, loudness: -12 },
    
    // Non-electronic genres
    'rock': { tempo: 120, energy: 0.7, danceability: 0.4, valence: 0.5, loudness: -8 },
    'pop': { tempo: 110, energy: 0.6, danceability: 0.6, valence: 0.7, loudness: -10 },
    'hip hop': { tempo: 90, energy: 0.6, danceability: 0.8, valence: 0.5, loudness: -8 },
    'country': { tempo: 100, energy: 0.5, danceability: 0.4, valence: 0.7, loudness: -12 },
    'jazz': { tempo: 100, energy: 0.4, danceability: 0.3, valence: 0.6, loudness: -15 },
    'classical': { tempo: 90, energy: 0.3, danceability: 0.1, valence: 0.5, loudness: -20 },
    'metal': { tempo: 140, energy: 0.9, danceability: 0.3, valence: 0.3, loudness: -5 },
    'metalcore': { tempo: 150, energy: 0.95, danceability: 0.4, valence: 0.3, loudness: -4 },
    'punk': { tempo: 160, energy: 0.9, danceability: 0.5, valence: 0.4, loudness: -6 }
  };
  
  // Find best matching genre and get its features
  let bestMatch = null;
  let bestScore = 0;
  
  for (const genre of genres) {
    const genreLower = genre.toLowerCase();
    for (const [mappedGenre, features] of Object.entries(genreMappings)) {
      if (genreLower.includes(mappedGenre)) {
        const score = mappedGenre.length; // Prefer more specific matches
        if (score > bestScore) {
          bestMatch = features;
          bestScore = score;
        }
      }
    }
  }
  
  // Default to electronic if no match found but looks electronic
  if (!bestMatch) {
    const hasElectronicTerms = genres.some(g => 
      g.toLowerCase().includes('electronic') || 
      g.toLowerCase().includes('dance') ||
      artistName.toLowerCase().includes('dj')
    );
    
    if (hasElectronicTerms) {
      bestMatch = genreMappings['electronic'];
    } else {
      bestMatch = genreMappings['pop']; // Safe default
    }
  }
  
  // Add some randomness to avoid identical profiles
  const variance = 0.1;
  const addVariance = (value) => {
    const variation = (Math.random() - 0.5) * variance;
    return Math.max(0, Math.min(1, value + variation));
  };
  
  const inferredFeatures = {
    // Rhythm features
    tempo: bestMatch.tempo + (Math.random() - 0.5) * 10,
    beats_per_minute: bestMatch.tempo + (Math.random() - 0.5) * 10,
    rhythm_strength: addVariance(0.7),
    
    // Energy and mood
    energy: addVariance(bestMatch.energy),
    danceability: addVariance(bestMatch.danceability),
    valence: addVariance(bestMatch.valence),
    arousal: addVariance(bestMatch.energy),
    
    // Audio characteristics
    loudness: bestMatch.loudness + (Math.random() - 0.5) * 5,
    dynamic_range: 15 + (Math.random() - 0.5) * 10,
    
    // Spectral features (estimated)
    spectral_centroid: bestMatch.energy * 3000 + 1000,
    spectral_rolloff: bestMatch.energy * 6000 + 2000,
    mfcc_mean: (Math.random() - 0.5) * 30,
    chroma_mean: addVariance(0.5),
    
    // Analysis metadata
    analysis_source: 'genre_inference',
    analysis_version: '2.1-genre-fallback',
    confidence: 0.6,
    inference_genres: genres
  };
  
  console.log(`📊 Inferred features - Tempo: ${inferredFeatures.tempo.toFixed(0)}, Energy: ${inferredFeatures.energy.toFixed(2)}, Danceability: ${inferredFeatures.danceability.toFixed(2)}`);
  
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
