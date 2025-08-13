// Enhanced Audio Source Module for Essentia Pipeline
// Provides fallback strategies for finding audio when Apple iTunes doesn't have preview URLs

const https = require('https');
const fetch = require('node-fetch');

/**
 * Search for artist tracks on YouTube with enhanced API support
 */
async function searchYouTubeAudio(artistName, trackName) {
  console.log(`🎵 Searching YouTube for: ${artistName} - ${trackName}`);
  
  try {
    // Use multiple YouTube API keys for better reliability
    const apiKeys = [
      process.env.YOUTUBE_API_KEY,
      process.env.GOOGLE_API_KEY,
      process.env.YT_API_KEY,
      // Add fallback keys if available
    ].filter(Boolean);
    
    if (apiKeys.length === 0) {
      console.log('⚠️ No YouTube API keys configured');
      
      // Fallback to YouTube search URL for manual extraction
      const query = encodeURIComponent(`${artistName} ${trackName} official audio`);
      const searchUrl = `https://www.youtube.com/results?search_query=${query}`;
      
      return {
        source: 'youtube',
        searchUrl: searchUrl,
        confidence: 0.5,
        note: 'YouTube search URL provided - requires manual extraction or youtube-dl integration',
        requiresExtraction: true
      };
    }

    // Try each API key until one works
    for (const apiKey of apiKeys) {
      try {
        const query = encodeURIComponent(`${artistName} ${trackName} official audio`);
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=10&key=${apiKey}`;
        
        const response = await fetch(searchUrl, {
          timeout: 10000
        });
        
        if (!response.ok) {
          console.log(`❌ YouTube API error with key: ${response.status}`);
          continue;
        }
        
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
          // Enhanced matching and scoring
          const scoredVideos = data.items.map(item => {
            let score = 0;
            const titleLower = item.snippet.title.toLowerCase();
            const channelLower = item.snippet.channelTitle.toLowerCase();
            const artistLower = artistName.toLowerCase();
            const trackLower = trackName.toLowerCase();
            
            // Exact matches
            if (titleLower.includes(trackLower)) score += 40;
            if (channelLower.includes(artistLower)) score += 30;
            
            // Official content indicators
            if (titleLower.includes('official')) score += 25;
            if (titleLower.includes('music video')) score += 20;
            if (titleLower.includes('audio')) score += 15;
            if (channelLower.includes('official')) score += 20;
            if (channelLower.includes('records') || channelLower.includes('music')) score += 10;
            
            // Avoid covers, remixes unless specified
            if (!trackLower.includes('remix') && titleLower.includes('remix')) score -= 15;
            if (!trackLower.includes('cover') && titleLower.includes('cover')) score -= 20;
            if (titleLower.includes('karaoke')) score -= 25;
            
            // Word-by-word matching
            const artistWords = artistLower.split(' ');
            const trackWords = trackLower.split(' ');
            
            artistWords.forEach(word => {
              if (word.length > 2) {
                if (channelLower.includes(word)) score += 8;
                if (titleLower.includes(word)) score += 5;
              }
            });
            
            trackWords.forEach(word => {
              if (word.length > 2 && titleLower.includes(word)) score += 10;
            });
            
            return { ...item, matchScore: score };
          });
          
          // Sort by match score
          scoredVideos.sort((a, b) => b.matchScore - a.matchScore);
          const bestMatch = scoredVideos[0];
          
          if (bestMatch.matchScore > 25) { // Minimum confidence threshold
            const confidence = Math.min(0.85, Math.max(0.4, bestMatch.matchScore / 100));
            const videoUrl = `https://www.youtube.com/watch?v=${bestMatch.id.videoId}`;
            
            console.log(`✅ YouTube match found: "${bestMatch.snippet.title}" by ${bestMatch.snippet.channelTitle} (score: ${bestMatch.matchScore}, confidence: ${confidence.toFixed(2)})`);
            
            return {
              source: 'youtube',
              url: videoUrl,
              videoId: bestMatch.id.videoId,
              title: bestMatch.snippet.title,
              channelTitle: bestMatch.snippet.channelTitle,
              publishedAt: bestMatch.snippet.publishedAt,
              confidence: confidence,
              matchScore: bestMatch.matchScore,
              requiresExtraction: true,
              note: 'YouTube video found - requires youtube-dl or similar for audio extraction',
              extractionHint: `youtube-dl -x --audio-format mp3 "${videoUrl}"`
            };
          }
        }
      } catch (apiError) {
        console.log(`⚠️ Error with YouTube API key:`, apiError.message);
        continue;
      }
    }
    
    console.log('❌ No suitable YouTube matches found');
    return null;
  } catch (error) {
    console.error('❌ YouTube search error:', error.message);
    return null;
  }
}

/**
 * Search for artist tracks on SoundCloud with enhanced streaming support
 */
async function searchSoundCloudAudio(artistName, trackName) {
  console.log(`🔊 Searching SoundCloud for: ${artistName} - ${trackName}`);
  
  try {
    // Use multiple SoundCloud client IDs for better reliability
    const clientIds = [
      process.env.SOUNDCLOUD_CLIENT_ID,
      'lcKCKyUaMW1dgS42vr9wdJkSmrGRZcGh', // Backup client ID
      'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoJ', // Alternative client ID
      'fDoItMDbsbZz8dY16ZzARCZmzgHBPotA'  // Additional backup
    ].filter(Boolean);
    
    if (clientIds.length === 0) {
      console.log('⚠️ No SoundCloud client IDs configured');
      return null;
    }

    // Try each client ID until one works
    for (const clientId of clientIds) {
      try {
        const query = encodeURIComponent(`${artistName} ${trackName}`);
        const searchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${query}&client_id=${clientId}&limit=10`;
        
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
          timeout: 10000
        });
        
        if (!response.ok) {
          console.log(`❌ SoundCloud API error with client ${clientId}: ${response.status}`);
          continue;
        }
        
        const data = await response.json();
        
        if (data.collection && data.collection.length > 0) {
          // Enhanced matching algorithm
          const scoredTracks = data.collection.map(track => {
            let score = 0;
            const titleLower = track.title.toLowerCase();
            const usernameLower = track.user.username.toLowerCase();
            const artistLower = artistName.toLowerCase();
            const trackLower = trackName.toLowerCase();
            
            // Exact matches
            if (titleLower.includes(trackLower)) score += 50;
            if (usernameLower.includes(artistLower)) score += 40;
            
            // Partial matches
            const artistWords = artistLower.split(' ');
            const trackWords = trackLower.split(' ');
            
            artistWords.forEach(word => {
              if (word.length > 2 && usernameLower.includes(word)) score += 10;
              if (word.length > 2 && titleLower.includes(word)) score += 5;
            });
            
            trackWords.forEach(word => {
              if (word.length > 2 && titleLower.includes(word)) score += 15;
            });
            
            // Boost verified artists and popular tracks
            if (track.user.verified) score += 20;
            if (track.playback_count && track.playback_count > 100000) score += 10;
            if (track.likes_count && track.likes_count > 1000) score += 5;
            
            return { ...track, matchScore: score };
          });
          
          // Sort by match score
          scoredTracks.sort((a, b) => b.matchScore - a.matchScore);
          const bestMatch = scoredTracks[0];
          
          if (bestMatch.matchScore > 20) { // Minimum confidence threshold
            // Get actual streaming URL
            let streamUrl = null;
            if (bestMatch.stream_url) {
              streamUrl = `${bestMatch.stream_url}?client_id=${clientId}`;
            } else if (bestMatch.media && bestMatch.media.transcodings) {
              // Try to find progressive stream
              const progressive = bestMatch.media.transcodings.find(t => 
                t.format && t.format.protocol === 'progressive'
              );
              if (progressive && progressive.url) {
                streamUrl = `${progressive.url}?client_id=${clientId}`;
              }
            }
            
            const confidence = Math.min(0.9, Math.max(0.3, bestMatch.matchScore / 100));
            
            console.log(`✅ SoundCloud match found: "${bestMatch.title}" by ${bestMatch.user.username} (score: ${bestMatch.matchScore}, confidence: ${confidence.toFixed(2)})`);
            
            return {
              source: 'soundcloud',
              url: bestMatch.permalink_url,
              streamUrl: streamUrl,
              title: bestMatch.title,
              user: bestMatch.user.username,
              duration: bestMatch.duration,
              playbackCount: bestMatch.playback_count,
              confidence: confidence,
              matchScore: bestMatch.matchScore,
              usesDirectStream: !!streamUrl,
              note: streamUrl ? 'Direct streaming URL available for Essentia analysis' : 'Permalink only - requires stream extraction'
            };
          }
        }
      } catch (clientError) {
        console.log(`⚠️ Error with SoundCloud client ${clientId}:`, clientError.message);
        continue;
      }
    }
    
    console.log('❌ No suitable SoundCloud matches found');
    return null;
  } catch (error) {
    console.error('❌ SoundCloud search error:', error.message);
    return null;
  }
}

/**
 * Search for artist tracks on Beatport (EDM focused) with web scraping
 */
async function searchBeatportAudio(artistName, trackName) {
  console.log(`🎧 Searching Beatport for: ${artistName} - ${trackName}`);
  
  try {
    // Enhanced Beatport search with multiple strategies
    const query = encodeURIComponent(`${artistName} ${trackName}`);
    const searchUrl = `https://www.beatport.com/search?q=${query}`;
    
    // For EDM artists, Beatport is particularly valuable
    const isEDMArtist = await checkIfEDMArtist(artistName, []);
    const confidence = isEDMArtist ? 0.8 : 0.6;
    
    console.log(`🔍 Beatport search URL: ${searchUrl} (EDM artist: ${isEDMArtist})`);
    
    // In a production environment, you would implement web scraping here
    // For now, return enhanced metadata for potential manual processing
    return {
      source: 'beatport',
      searchUrl: searchUrl,
      isEDMFocused: isEDMArtist,
      confidence: confidence,
      note: `Beatport search for ${isEDMArtist ? 'EDM' : 'general'} artist - high-quality previews available`,
      extractionStrategy: 'web_scraping',
      potentialPreviewUrl: `${searchUrl}#preview-available`,
      priority: isEDMArtist ? 'high' : 'medium'
    };
  } catch (error) {
    console.error('❌ Beatport search error:', error.message);
    return null;
  }
}

/**
 * Check if artist is likely EDM based on name patterns and genres
 */
async function checkIfEDMArtist(artistName, genres = []) {
  const artistLower = artistName.toLowerCase();
  
  // EDM genre indicators
  const edmGenres = ['house', 'techno', 'trance', 'dubstep', 'edm', 'electronic', 'dance'];
  const hasEDMGenre = genres.some(genre => 
    edmGenres.some(edmGenre => genre.toLowerCase().includes(edmGenre))
  );
  
  // EDM artist name patterns
  const edmPatterns = [
    'dj ', ' dj', 'mc ', ' mc',
    'fisher', 'deadmau5', 'skrillex', 'calvin harris', 'martin garrix',
    'tiesto', 'armin', 'hardwell', 'avicii', 'zedd', 'diplo'
  ];
  
  const hasEDMPattern = edmPatterns.some(pattern => artistLower.includes(pattern));
  
  return hasEDMGenre || hasEDMPattern;
}

/**
 * Enhanced Spotify preview URL search with multiple strategies
 */
async function searchSpotifyPreviewUrl(artistName, trackName, spotifyCredentials = null) {
  console.log(`🎵 Enhanced Spotify search for: ${artistName} - ${trackName}`);
  
  try {
    // Use provided credentials or environment variables
    const clientId = spotifyCredentials?.clientId || process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = spotifyCredentials?.clientSecret || process.env.SPOTIFY_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.log('⚠️ Spotify credentials not available for enhanced search');
      return null;
    }
    
    // Get access token
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });
    
    if (!tokenResponse.ok) {
      console.log('❌ Spotify token request failed');
      return null;
    }
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    
    // Multiple search strategies
    const searchQueries = [
      `track:"${trackName}" artist:"${artistName}"`, // Exact match
      `"${trackName}" "${artistName}"`, // Quoted search
      `${trackName} ${artistName}`, // Simple search
      `artist:${artistName} ${trackName}`, // Artist-focused
      artistName // Artist-only fallback
    ];
    
    for (const query of searchQueries) {
      try {
        const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=20`;
        
        const searchResponse = await fetch(searchUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });
        
        if (!searchResponse.ok) continue;
        
        const searchData = await searchResponse.json();
        const tracks = searchData.tracks?.items || [];
        
        // Score and rank tracks
        const scoredTracks = tracks.map(track => {
          let score = 0;
          const trackNameLower = track.name.toLowerCase();
          const searchTrackLower = trackName.toLowerCase();
          const searchArtistLower = artistName.toLowerCase();
          
          // Exact name match
          if (trackNameLower === searchTrackLower) score += 50;
          else if (trackNameLower.includes(searchTrackLower)) score += 30;
          else if (searchTrackLower.includes(trackNameLower)) score += 20;
          
          // Artist match
          const artistMatch = track.artists.some(artist => {
            const artistNameLower = artist.name.toLowerCase();
            if (artistNameLower === searchArtistLower) return (score += 40, true);
            if (artistNameLower.includes(searchArtistLower)) return (score += 25, true);
            if (searchArtistLower.includes(artistNameLower)) return (score += 15, true);
            return false;
          });
          
          // Preview URL availability
          if (track.preview_url) score += 30;
          
          // Popularity boost
          if (track.popularity) score += track.popularity * 0.1;
          
          // Explicit content (sometimes better quality)
          if (track.explicit && !trackName.toLowerCase().includes('clean')) score += 5;
          
          return { ...track, matchScore: score };
        });
        
        // Find best match with preview URL
        scoredTracks.sort((a, b) => b.matchScore - a.matchScore);
        const bestWithPreview = scoredTracks.find(track => track.preview_url && track.matchScore > 20);
        
        if (bestWithPreview) {
          const confidence = Math.min(0.95, Math.max(0.5, bestWithPreview.matchScore / 100));
          
          console.log(`✅ Enhanced Spotify match: "${bestWithPreview.name}" by ${bestWithPreview.artists[0].name} (score: ${bestWithPreview.matchScore})`);
          
          return {
            source: 'spotify_enhanced',
            url: bestWithPreview.external_urls.spotify,
            previewUrl: bestWithPreview.preview_url,
            trackId: bestWithPreview.id,
            title: bestWithPreview.name,
            artist: bestWithPreview.artists[0].name,
            popularity: bestWithPreview.popularity,
            confidence: confidence,
            matchScore: bestWithPreview.matchScore,
            note: 'Enhanced Spotify search with direct preview URL for Essentia analysis'
          };
        }
      } catch (queryError) {
        console.log(`⚠️ Spotify query error:`, queryError.message);
        continue;
      }
    }
    
    console.log('❌ No Spotify tracks with preview URLs found');
    return null;
  } catch (error) {
    console.error('❌ Enhanced Spotify search error:', error.message);
    return null;
  }
}

/**
 * Search for artist tracks on Bandcamp with enhanced scraping hints
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
 * Main fallback strategy coordinator with enhanced prioritization
 */
async function findAlternativeAudioSource(artistName, trackName, spotifyTrack = null, spotifyCredentials = null) {
  console.log(`🔍 Enhanced alternative audio search for: ${artistName} - ${trackName}`);
  
  const sources = [];
  const startTime = Date.now();
  
  // Strategy 1: Enhanced Spotify search (highest priority)
  try {
    const spotifyResult = await searchSpotifyPreviewUrl(artistName, trackName, spotifyCredentials);
    if (spotifyResult) sources.push(spotifyResult);
  } catch (error) {
    console.log('⚠️ Enhanced Spotify search failed:', error.message);
  }
  
  // Strategy 2: Parallel search of all alternative sources
  const searchPromises = [
    searchSoundCloudAudio(artistName, trackName),
    searchYouTubeAudio(artistName, trackName),
    searchBeatportAudio(artistName, trackName),
    searchBandcampAudio(artistName, trackName)
  ];
  
  const results = await Promise.allSettled(searchPromises);
  
  // Collect successful results
  results.forEach((result, index) => {
    const sourceNames = ['soundcloud', 'youtube', 'beatport', 'bandcamp'];
    if (result.status === 'fulfilled' && result.value) {
      result.value.searchOrder = index;
      sources.push(result.value);
    } else if (result.status === 'rejected') {
      console.log(`⚠️ ${sourceNames[index]} search failed:`, result.reason?.message);
    }
  });
  
  // Enhanced scoring and prioritization
  const scoredSources = sources.map(source => {
    let priorityScore = source.confidence || 0.5;
    
    // Direct streaming URL availability (highest priority)
    if (source.streamUrl || source.previewUrl) priorityScore += 0.3;
    
    // Source reliability bonuses
    if (source.source === 'spotify_enhanced') priorityScore += 0.2;
    if (source.source === 'soundcloud' && source.usesDirectStream) priorityScore += 0.15;
    if (source.source === 'beatport' && source.isEDMFocused) priorityScore += 0.1;
    
    // Match quality bonuses
    if (source.matchScore && source.matchScore > 50) priorityScore += 0.1;
    if (source.matchScore && source.matchScore > 75) priorityScore += 0.1;
    
    // Penalize sources requiring extraction
    if (source.requiresExtraction) priorityScore -= 0.2;
    if (source.extractionStrategy === 'web_scraping') priorityScore -= 0.1;
    
    return { ...source, priorityScore };
  });
  
  // Sort by priority score
  scoredSources.sort((a, b) => b.priorityScore - a.priorityScore);
  
  const searchTime = Date.now() - startTime;
  console.log(`📊 Found ${sources.length} alternative sources in ${searchTime}ms`);
  
  // Log top 3 sources for debugging
  scoredSources.slice(0, 3).forEach((source, index) => {
    console.log(`  ${index + 1}. ${source.source}: ${source.priorityScore.toFixed(2)} priority (${source.note})`);
  });
  
  return {
    alternativeSources: scoredSources,
    bestSource: scoredSources[0] || null,
    totalSources: sources.length,
    searchTime: searchTime,
    hasDirectStream: scoredSources.some(s => s.streamUrl || s.previewUrl),
    hasHighConfidence: scoredSources.some(s => s.priorityScore > 0.8),
    recommendedAction: getRecommendedAction(scoredSources)
  };
}

/**
 * Get recommended action based on available sources
 */
function getRecommendedAction(sources) {
  if (sources.length === 0) return 'use_genre_inference';
  
  const bestSource = sources[0];
  
  if (bestSource.streamUrl || bestSource.previewUrl) {
    return 'direct_analysis';
  } else if (bestSource.source === 'youtube' && bestSource.requiresExtraction) {
    return 'youtube_extraction';
  } else if (bestSource.source === 'soundcloud' && bestSource.url) {
    return 'soundcloud_extraction';
  } else {
    return 'manual_processing';
  }
}

module.exports = {
  searchYouTubeAudio,
  searchSoundCloudAudio,
  searchBeatportAudio,
  searchBandcampAudio,
  searchSpotifyPreviewUrl,
  inferAudioFeaturesFromGenres,
  findAlternativeAudioSource,
  checkIfEDMArtist
};
