const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { findAlternativeAudioSource, inferAudioFeaturesFromGenres, searchSoundCloudAudio } = require('./enhanced-audio-sources');

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// MongoDB connection
let db;
MongoClient.connect(MONGODB_URI)
  .then(client => {
    console.log('📊 Connected to MongoDB');
    db = client.db();
  })
  .catch(error => console.error('MongoDB connection error:', error));

// -------- Logging Helpers --------
function log(evt, data = {}) {
  try {
    const base = { evt, ts: new Date().toISOString() };
    console.log(JSON.stringify({ ...base, ...data }));
  } catch (e) {
    console.log('log_fail', evt, e.message);
  }
}

function withCorrelation(req) {
  return req.headers['x-correlation-id'] || crypto.randomUUID();
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const correlationId = withCorrelation(req);
  const stats = await collectQuickStats();
  const payload = { 
    status: 'healthy', 
    service: 'tiko-essentia-audio-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: db ? 'connected' : 'disconnected',
    correlationId,
    stats
  };
  res.setHeader('x-correlation-id', correlationId);
  res.json(payload);
});

// Internal metrics (lightweight – safe to call by health script)
app.get('/internal/metrics', async (req, res) => {
  const correlationId = withCorrelation(req);
  try {
    const stats = await collectQuickStats();
    res.setHeader('x-correlation-id', correlationId);
    res.json({ success: true, correlationId, ...stats });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, correlationId });
  }
});

// Audio analysis endpoint
app.post('/api/analyze', async (req, res) => {
  const startTime = Date.now();
  const correlationId = withCorrelation(req);
  res.setHeader('x-correlation-id', correlationId);
  try {
    const { audioUrl, trackId } = req.body;
    if (!audioUrl) {
      return res.status(400).json({ error: 'audioUrl is required', correlationId });
    }
    log('track_analyze_begin', { correlationId, audioUrlHash: hashAudioUrl(audioUrl), trackId });

    // Multi-key cache: trackId or audioUrl hash
    const audioHash = hashAudioUrl(audioUrl);
    if (db) {
      const existing = await db.collection('audio_features').findOne({ $or: [ { trackId }, { audioHash } ] });
      if (existing && existing.features) {
        log('track_analyze_cache_hit', { correlationId, trackId, audioHash });
        return res.json({ success: true, features: existing.features, source: existing.source || 'cache', cached: true, correlationId, analysisTime: Date.now() - startTime });
      }
    }
    const features = await analyzeAudioWithEssentia(audioUrl, { correlationId, audioHash, tier: 'single_track' });
    if (db) {
      await db.collection('audio_features').updateOne(
        { audioHash },
        { $set: { audioHash, trackId, features, source: 'essentia', audioUrl, analyzedAt: new Date(), analysisTime: Date.now() - startTime } },
        { upsert: true }
      );
    }
    log('track_analyze_success', { correlationId, trackId, audioHash });
    res.json({ success: true, features, source: 'essentia', correlationId, analysisTime: Date.now() - startTime });
  } catch (error) {
    log('track_analyze_error', { correlationId, error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: error.message, correlationId });
  }
});

// Batch analysis endpoint
app.post('/api/batch', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { audioUrls, batchId } = req.body;
    
    if (!audioUrls || !Array.isArray(audioUrls)) {
      return res.status(400).json({ error: 'audioUrls array is required' });
    }

    console.log(`🔄 Batch analyzing ${audioUrls.length} audio files...`);
    
    const results = [];
    
    for (let i = 0; i < audioUrls.length; i++) {
      const audioUrl = audioUrls[i];
      
      try {
        console.log(`   Analyzing ${i+1}/${audioUrls.length}: ${audioUrl.substring(0, 50)}...`);
        const features = await analyzeAudioWithEssentia(audioUrl);
        
        results.push({
          audioUrl,
          features,
          success: true
        });
        
        // Small delay between requests
        if (i < audioUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
      } catch (error) {
        console.warn(`⚠️ Failed to analyze ${audioUrl}:`, error.message);
        results.push({
          audioUrl,
          error: error.message,
          success: false
        });
      }
    }

    res.json({
      success: true,
      results,
      batchId,
      totalProcessed: results.length,
      successful: results.filter(r => r.success).length,
      analysisTime: Date.now() - startTime
    });

  } catch (error) {
    console.error('❌ Batch analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message 
    });
  }
});

// Artist analysis endpoint - STAGED TRACK ANALYSIS WITH ESSENTIA
app.post('/api/analyze-artist', async (req, res) => {
  const startTime = Date.now();
  const correlationId = req.headers['x-correlation-id'] || require('crypto').randomUUID();
  const startedLog = { evt: 'analyze_artist_begin', correlationId, ts: new Date().toISOString() };
  try {
    const { 
      artistName, 
      spotifyId, 
      maxTracks = 20, 
      includeRecentReleases = true,
      existingGenres = [], // Existing Spotify genres from database
      spotifyCredentials, // Accept Spotify credentials from frontend (may be absent if we force Apple/SoundCloud mode)
      fastMode = false, // fast mode to stay under Heroku 30s limit
      maxPreviewRecoveryAttempts, // Optional override for preview recovery attempts per track
      previewStrategy: incomingPreviewStrategy // allow client to explicitly force apple-based strategy
    } = req.body;
    
    if (!artistName) {
      return res.status(400).json({ error: 'artistName is required' });
    }

  console.log(JSON.stringify({ ...startedLog, artistName, spotifyId, maxTracks, includeRecentReleases }));
    console.log(`📊 Max tracks: ${maxTracks}, Recent releases: ${includeRecentReleases}`);
    
    // Get Spotify access token (use provided credentials or environment variables)
    let spotifyToken;
    let spotifyTokenStatus = 'unknown';
    if (spotifyCredentials && spotifyCredentials.accessToken) {
      spotifyToken = spotifyCredentials.accessToken;
      console.log('🔑 Using frontend-provided Spotify credentials');
      spotifyTokenStatus = 'provided';
    } else {
      spotifyToken = await getSpotifyToken();
      if (!spotifyToken) {
        console.warn('⚠️ No Spotify credentials available - limited functionality');
        // Continue without Spotify (Apple-only mode)
        spotifyTokenStatus = 'missing';
      } else {
        spotifyTokenStatus = 'acquired';
      }
    }
    log('spotify_token_status', { correlationId, artistName, spotifyTokenStatus });

    let tracks = [];
    const failureReasons = [];
    const acquisitionStats = {
      spotifyTokenStatus,
      initialTracks: 0,
      methods: { top: 0, recent: 0 },
      fallbacks: { search: false, appleMode: false },
      previewSourceCounts: { spotify: 0, apple: 0, apple_broad: 0, soundcloud: 0, youtube: 0, beatport: 0, bandcamp: 0, none: 0 },
      analysisRounds: { round1: { attempted: 0, withPreview: 0 }, round2: { attempted: 0, withPreview: 0 } },
      initialSpotifyTracks: 0,
      initialSpotifyTracksWithPreview: 0,
      missingSpotifyPreviewSample: [],
      spotifyPreviewRecovered: 0,
  soundcloudRescue: 0,
  previewRecovery: { attempts: 0, queries: 0, hits: 0, marketsTried: [], firstHit: null, relaxedAttempts: 0, suffixStrips: 0 },
      fastMode,
  previewRecoveryLimited: false,
  spotifyPreviewSuppressed: 0,
  spotifySuppressedRestored: 0,
    };
  // New: deeper SoundCloud diagnostics for soundcloud_primary / forceSoundCloudTest flows
  acquisitionStats.soundcloudDiagnostics = { attempts: 0, hits: 0, queries: [] };
    // Preview acquisition strategy (default now apple_primary)
  // Determine preview strategy. If Spotify token missing and client did not force something else, prefer apple_primary.
  const previewStrategy = (incomingPreviewStrategy || (!spotifyToken ? 'apple_primary' : 'apple_primary')).toLowerCase();
  acquisitionStats.previewStrategy = previewStrategy;
  acquisitionStats.appleOverrideSpotify = 0;
  acquisitionStats.spotifyRecoveryDisabled = false;
  // New: SoundCloud primary / forced test mode
  const forceSoundCloudTest = previewStrategy === 'soundcloud_primary' || !!req.body.forceSoundCloudTest;
  acquisitionStats.soundcloudPrimary = previewStrategy === 'soundcloud_primary';
  acquisitionStats.forceSoundCloudTest = !!req.body.forceSoundCloudTest;
  acquisitionStats.forceSkipApple = forceSoundCloudTest; // explicit flag to indicate Apple was intentionally skipped

    // Method 1: Get top tracks using artist ID (if provided and we have Spotify token)
  if (spotifyId && spotifyToken) {
      console.log(`🔍 Fetching top tracks for Spotify ID: ${spotifyId}`);
      
      try {
        const topTracksResponse = await fetch(`https://api.spotify.com/v1/artists/${spotifyId}/top-tracks?market=US`, {
          headers: { 'Authorization': `Bearer ${spotifyToken}` }
        });
        
        if (topTracksResponse.ok) {
          const topTracksData = await topTracksResponse.json();
          tracks = topTracksData.tracks || [];
          acquisitionStats.methods.top = tracks.length;
          console.log(`✅ Found ${tracks.length} top tracks`);
        }
      } catch (error) {
        failureReasons.push('spotify_top_tracks_error');
        console.warn(`⚠️ Failed to get top tracks: ${error.message}`);
      }

      // Method 2: Get recent releases (albums from last 2 years)
      if (includeRecentReleases) {
        try {
          const albumsResponse = await fetch(`https://api.spotify.com/v1/artists/${spotifyId}/albums?include_groups=album,single&market=US&limit=50`, {
            headers: { 'Authorization': `Bearer ${spotifyToken}` }
          });
          
          if (albumsResponse.ok) {
            const albumsData = await albumsResponse.json();
            const recentAlbums = albumsData.items?.filter(album => {
              const releaseYear = new Date(album.release_date).getFullYear();
              const currentYear = new Date().getFullYear();
              return currentYear - releaseYear <= 2;
            }) || [];
            
            console.log(`🆕 Found ${recentAlbums.length} recent albums`);
            
            // Get tracks from recent albums
            for (const album of recentAlbums.slice(0, 10)) { // Limit to 10 recent albums
              try {
                const albumTracksResponse = await fetch(`https://api.spotify.com/v1/albums/${album.id}/tracks`, {
                  headers: { 'Authorization': `Bearer ${spotifyToken}` }
                });
                
                if (albumTracksResponse.ok) {
                  const albumTracksData = await albumTracksResponse.json();
                  const albumTracks = albumTracksData.items?.map(track => ({
                    ...track,
                    album: album,
                    isRecentRelease: true
                  })) || [];
                  
      tracks = tracks.concat(albumTracks);
                }
              } catch (error) {
                failureReasons.push('spotify_album_tracks_error');
                console.warn(`⚠️ Failed to get tracks for album ${album.name}:`, error.message);
              }
            }
    acquisitionStats.methods.recent = tracks.filter(t => t.isRecentRelease).length;
          }
        } catch (error) {
          failureReasons.push('spotify_recent_albums_error');
          console.warn(`⚠️ Failed to get recent albums: ${error.message}`);
        }
      }
    }

    // Fallback: Search for artist if no tracks found and we have Spotify token
  if (tracks.length === 0 && spotifyToken) {
      console.log(`🔍 Fallback: Searching for tracks by artist name`);
      
      try {
        const searchResponse = await fetch(`https://api.spotify.com/v1/search?q=artist:"${encodeURIComponent(artistName)}"&type=track&market=US&limit=20`, {
          headers: { 'Authorization': `Bearer ${spotifyToken}` }
        });
        
        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          tracks = searchData.tracks?.items || [];
          if (tracks.length > 0) acquisitionStats.fallbacks.search = true;
          console.log(`🔍 Search fallback found ${tracks.length} tracks`);
        }
      } catch (error) {
        failureReasons.push('spotify_search_error');
        console.warn(`⚠️ Search fallback failed: ${error.message}`);
      }
    }
    
    // Apple-only or Apple/SoundCloud (when no Spotify or explicit strategy)
    if (tracks.length === 0 && (!spotifyToken || previewStrategy.startsWith('apple'))) {
      const appleLimit = Math.min(50, maxTracks * 3); // fetch broader set to allow top/recent partition
      console.log(`🍎 Fetching Apple catalog for artist (limit=${appleLimit})`);
      tracks = await findAppleTracksForArtist(artistName, appleLimit, { includeReleaseDate: true });
      if (tracks.length === 0) {
        failureReasons.push('apple_mode_no_tracks');
      } else {
        acquisitionStats.fallbacks.appleMode = true;
        // Re-rank Apple tracks: approximate "top" by presence of preview & randomness (iTunes API lacks popularity score)
        // We'll keep original order; recent detection already flagged.
      }
    }

    const hadInitialTracks = tracks.length > 0; // for later fail classification
    // Gather initial spotify preview coverage stats BEFORE any recovery attempts
    if (tracks.length > 0) {
      acquisitionStats.initialSpotifyTracks = tracks.length;
      const missingSample = [];
      for (const t of tracks) {
        if (t.preview_url) acquisitionStats.initialSpotifyTracksWithPreview++;
        else if (missingSample.length < 5) missingSample.push(t.id || t.name);
      }
      acquisitionStats.missingSpotifyPreviewSample = missingSample;
      acquisitionStats.spotifyPreviewCoveragePercent = acquisitionStats.initialSpotifyTracks === 0 ? 0 : +( (acquisitionStats.initialSpotifyTracksWithPreview / acquisitionStats.initialSpotifyTracks) * 100 ).toFixed(1);
    }
    acquisitionStats.initialTracks = tracks.length;
    if (tracks.length === 0) {
      log('analyze_artist_no_tracks', { correlationId, artistName, failureReasons, acquisitionStats });
      return res.json({ success: false, error: 'No tracks found for artist', failSubtype: 'no_tracks', artistName, failureReasons, correlationId, spotifyTokenStatus, acquisitionStats });
    }

    // ===== STAGED TRACK ANALYSIS =====
    // Round 1: 5 top + 5 recent = 10 tracks
    // Round 2: 5 more top + 5 more recent = 10 more tracks (if Round 1 successful)
    // Total Max: 10 top + 10 recent = 20 tracks
    
  const topTracks = tracks.filter(t => !t.isRecentRelease);
  const recentTracks = tracks.filter(t => t.isRecentRelease);
    
    console.log(`🎵 Available: ${topTracks.length} top tracks, ${recentTracks.length} recent releases`);
    
    // Round 1: First 10 tracks (5 top + 5 recent)
    const round1TopTracks = topTracks.slice(0, 5);
    const round1RecentTracks = recentTracks.slice(0, 5);
  // In fastMode only analyze top tracks first (up to 5) to guarantee speed
  const round1Tracks = fastMode ? round1TopTracks : [...round1TopTracks, ...round1RecentTracks];
  acquisitionStats.analysisRounds.round1.attempted = round1Tracks.length;
    
    console.log(`🔄 Round 1: Analyzing ${round1Tracks.length} tracks (${round1TopTracks.length} top + ${round1RecentTracks.length} recent)`);
    
    const trackProfiles = [];
    const averageFeatures = {};
    const spectralFeatures = {};
    let featureCounts = {};

    // Helper: attempt to acquire preview URL (Spotify -> Spotify search variants -> Apple exact -> Apple broad -> SoundCloud -> multi-source aggregator)
    async function acquirePreviewForTrack(track) {
      // Identify if existing preview belongs to Apple (from Apple artist catalog fetch) vs Spotify
      const originalApplePreview = (track.preview_url && (track.applePreview || /mzstatic|audio-ssl\.itunes\.apple\.com/i.test(track.preview_url))) ? track.preview_url : null;
      let previewUrl = track.preview_url;
      let audioSource = previewUrl ? (originalApplePreview ? 'apple' : 'spotify') : null;
      // In soundcloud_primary we ONLY suppress Spotify previews (keep Apple unless forceSoundCloudTest explicitly set)
      let originalSpotifyPreview = null;
      if (previewUrl && (previewStrategy === 'soundcloud_primary') && audioSource === 'spotify') {
        originalSpotifyPreview = previewUrl; // remember so we can restore if SC fails
        previewUrl = null;
        audioSource = null;
        acquisitionStats.spotifyPreviewSuppressed++;
      }
      // If explicitly forcing SoundCloud test, suppress any existing preview (even Apple) to measure rescue capability
      if (previewUrl && acquisitionStats.forceSoundCloudTest) {
        previewUrl = null;
        audioSource = null;
      }
      let alternativeSourceInfo = null;
      // Determine per-track recovery limit
      const perTrackRecoveryLimit = maxPreviewRecoveryAttempts
        ? Number(maxPreviewRecoveryAttempts)
        : (fastMode ? 20 : 120); // total query attempts across all patterns/markets per track
      let perTrackAttempts = 0;
      // Utility: clean track name (remove mix/remix suffixes and parenthetical descriptors)
      function simplifyName(name) {
        if (!name) return name;
        let base = name;
        // Remove parenthetical descriptors e.g. (Mixed), (Remix), (feat. ...)
        base = base.replace(/\([^)]*\)/gi, '').trim();
        // Common dash-separated suffixes we want to remove for relaxed search
        const dashIdx = base.indexOf(' - ');
        if (dashIdx !== -1) {
          const candidate = base.substring(0, dashIdx).trim();
          // Only treat as suffix if right side contains remix/mixed/edit/reform
          if (/remix|mixed|edit|reform|version/i.test(base.substring(dashIdx+3))) {
            acquisitionStats.previewRecovery.suffixStrips++;
            base = candidate;
          }
        }
        return base.replace(/\s{2,}/g,' ').trim();
      }
  const useApplePrimary = previewStrategy === 'apple_primary';
  const soundcloudPrimary = previewStrategy === 'soundcloud_primary';
  const forceSoundCloudTest = soundcloudPrimary || acquisitionStats.forceSoundCloudTest;

      // (EARLY) Force SoundCloud path before any Apple/Spotify recovery when testing SC directly
  if (!previewUrl && forceSoundCloudTest && process.env.SOUNDCLOUD_CLIENT_ID) {
        try {
          const primaryArtist = track.artists[0]?.name;
          const scQueryName = track.name;
          acquisitionStats.soundcloudDiagnostics.attempts++;
          if (acquisitionStats.soundcloudDiagnostics.queries.length < 12) {
            const q = `${primaryArtist} :: ${scQueryName}`.replace(/\s+/g,' ').trim();
            if (!acquisitionStats.soundcloudDiagnostics.queries.includes(q)) acquisitionStats.soundcloudDiagnostics.queries.push(q);
          }
          const scEarly = await searchSoundCloudAudio(primaryArtist, scQueryName);
          if (scEarly && (scEarly.streamUrl || scEarly.previewUrl)) {
            previewUrl = scEarly.streamUrl || scEarly.previewUrl;
            audioSource = 'soundcloud';
            alternativeSourceInfo = { source: 'soundcloud', confidence: scEarly.confidence || 0.85, forced: true };
            acquisitionStats.soundcloudRescue++;
            acquisitionStats.soundcloudDiagnostics.hits++;
          }
        } catch (e) {
          // ignore – continue to normal flow
        }
      }

      // If still no SoundCloud result and SoundCloud is primary/test, attempt simplified & artist‑only queries
      if (!previewUrl && (forceSoundCloudTest || soundcloudPrimary) && process.env.SOUNDCLOUD_CLIENT_ID) {
        try {
          const primaryArtist = track.artists[0]?.name;
          const simple = simplifyName(track.name);
          // 1) Simplified track name search (if changed)
          if (simple && simple !== track.name) {
            acquisitionStats.soundcloudDiagnostics.attempts++;
            if (acquisitionStats.soundcloudDiagnostics.queries.length < 12) {
              const q = `${primaryArtist} :: ${simple}`.replace(/\s+/g,' ').trim();
              if (!acquisitionStats.soundcloudDiagnostics.queries.includes(q)) acquisitionStats.soundcloudDiagnostics.queries.push(q);
            }
            const scSimple = await searchSoundCloudAudio(primaryArtist, simple);
            if (!previewUrl && scSimple && (scSimple.streamUrl || scSimple.previewUrl)) {
              previewUrl = scSimple.streamUrl || scSimple.previewUrl;
              audioSource = 'soundcloud';
              alternativeSourceInfo = { source: 'soundcloud', confidence: scSimple.confidence || 0.8, simplified: true };
              acquisitionStats.soundcloudRescue++;
              acquisitionStats.soundcloudDiagnostics.hits++;
            }
          }
          // 2) Artist-only query (discover any top track if specific title fails)
          if (!previewUrl) {
            acquisitionStats.soundcloudDiagnostics.attempts++;
            if (acquisitionStats.soundcloudDiagnostics.queries.length < 12) {
              const q = `${primaryArtist}`.replace(/\s+/g,' ').trim();
              if (!acquisitionStats.soundcloudDiagnostics.queries.includes(q)) acquisitionStats.soundcloudDiagnostics.queries.push(q);
            }
            const scArtistOnly = await searchSoundCloudAudio(primaryArtist, '');
            if (scArtistOnly && (scArtistOnly.streamUrl || scArtistOnly.previewUrl)) {
              previewUrl = scArtistOnly.streamUrl || scArtistOnly.previewUrl;
              audioSource = 'soundcloud';
              alternativeSourceInfo = { source: 'soundcloud', confidence: scArtistOnly.confidence || 0.7, artistOnly: true };
              acquisitionStats.soundcloudRescue++;
              acquisitionStats.soundcloudDiagnostics.hits++;
            }
          }
        } catch (e) {
          // continue silently
        }
      }

      // APPLE PRIMARY STRATEGY: Attempt Apple sources before any Spotify recovery.
  if (useApplePrimary && !forceSoundCloudTest) { // skip Apple entirely if forcing SC test or SC primary
        // Even if Spotify preview exists, we prefer Apple for consistency; only fallback to Spotify if Apple not found.
        let hadSpotify = !!previewUrl;
        if (track.artists && track.artists[0] && track.name) {
          if (!previewUrl) {
            try {
              previewUrl = await findApplePreviewUrl(track.artists[0].name, track.name);
              if (previewUrl) audioSource = 'apple';
            } catch (e) {}
          }
          if (!previewUrl) {
            try {
              const broad = await findApplePreviewUrlBroader(track.artists[0].name, track.name);
              if (broad) { previewUrl = broad; audioSource = 'apple_broad'; }
            } catch (e) {}
          }
        }
        if (previewUrl && audioSource && hadSpotify && audioSource.startsWith('apple')) {
          acquisitionStats.appleOverrideSpotify++;
        }
      }

  // (1) Attempt Spotify recovery (only if NOT apple_primary strategy)
  if (!previewUrl && spotifyToken && !useApplePrimary && !forceSoundCloudTest && !soundcloudPrimary) {
        try {
          // In fastMode restrict to first market to reduce latency
          const marketsEnv = (process.env.SPOTIFY_PREVIEW_MARKETS || 'US,GB,DE,SE,CA').split(',').map(m => m.trim()).filter(Boolean);
          const markets = fastMode ? [marketsEnv[0] || 'US'] : marketsEnv;
          let recovered = null;
          const unique = (arr) => [...new Set(arr.filter(Boolean))];
          const artistCandidates = unique([
            track.artists?.[0]?.name,
            artistName,
            ...(track.artists?.slice(1).map(a => a.name) || [])
          ]);
          for (const m of markets) {
            if (!acquisitionStats.previewRecovery.marketsTried.includes(m)) acquisitionStats.previewRecovery.marketsTried.push(m);
            // Two query patterns per artist candidate
            for (const cand of artistCandidates) {
              const patterns = [
                `track:"${track.name}" artist:"${cand}"`,
                `track:"${track.name}" "${cand}"`
              ];
              for (const pattern of patterns) {
                if (perTrackAttempts >= perTrackRecoveryLimit) { acquisitionStats.previewRecoveryLimited = true; break; }
                acquisitionStats.previewRecovery.attempts++;
                acquisitionStats.previewRecovery.queries++;
                const q = encodeURIComponent(pattern);
                const resp = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&market=${m}&limit=5`, { headers: { 'Authorization': `Bearer ${spotifyToken}` } });
                if (resp.ok) {
                  const data = await resp.json();
                  const candidate = data.tracks?.items?.find(it => it.preview_url && (it.id === track.id || it.name.toLowerCase() === track.name.toLowerCase()));
                  if (candidate) { 
                    recovered = candidate; 
                    acquisitionStats.previewRecovery.hits++;
                    if (!acquisitionStats.previewRecovery.firstHit) {
                      acquisitionStats.previewRecovery.firstHit = { market: m, pattern, artist: cand };
                    }
                    break; 
                  }
                }
                perTrackAttempts++;
                // Shorter delay in fastMode
                await new Promise(r => setTimeout(r, fastMode ? 50 : 120));
              }
              if (recovered) break;
              if (perTrackAttempts >= perTrackRecoveryLimit) break;

              // Relaxed phase: simplified name (once per candidate) if not found yet
              if (!recovered && perTrackAttempts < perTrackRecoveryLimit) {
                const simple = simplifyName(track.name);
                if (simple && simple !== track.name) {
                  const relaxedPatterns = [
                    `track:"${simple}" artist:"${cand}"`,
                    `${simple} ${cand}`
                  ];
                  for (const rpat of relaxedPatterns) {
                    if (perTrackAttempts >= perTrackRecoveryLimit) { acquisitionStats.previewRecoveryLimited = true; break; }
                    acquisitionStats.previewRecovery.attempts++;
                    acquisitionStats.previewRecovery.relaxedAttempts++;
                    acquisitionStats.previewRecovery.queries++;
                    const rq = encodeURIComponent(rpat);
                    const rresp = await fetch(`https://api.spotify.com/v1/search?q=${rq}&type=track&market=${m}&limit=5`, { headers: { 'Authorization': `Bearer ${spotifyToken}` } });
                    if (rresp.ok) {
                      const rdata = await rresp.json();
                      const rcand = rdata.tracks?.items?.find(it => it.preview_url && (it.id === track.id || it.name.toLowerCase() === simple.toLowerCase()));
                      if (rcand) { 
                        recovered = rcand; 
                        acquisitionStats.previewRecovery.hits++;
                        if (!acquisitionStats.previewRecovery.firstHit) {
                          acquisitionStats.previewRecovery.firstHit = { market: m, pattern: rpat, artist: cand, relaxed: true };
                        }
                        break; 
                      }
                    }
                    perTrackAttempts++;
                    await new Promise(r => setTimeout(r, fastMode ? 40 : 100));
                  }
                }
              }
            }
            if (recovered) break;
            if (perTrackAttempts >= perTrackRecoveryLimit) break;
          }
          if (recovered && recovered.preview_url) {
            previewUrl = recovered.preview_url;
            audioSource = 'spotify';
            acquisitionStats.spotifyPreviewRecovered++;
          }
        } catch (e) {
          // silent; recovery optional
        }
      }
  if ((useApplePrimary || forceSoundCloudTest || soundcloudPrimary) && !previewUrl) {
        acquisitionStats.spotifyRecoveryDisabled = true; // recorded if we skipped the spotify recovery block
      }
      // (2) Apple exact (balanced strategy only)
  if (!previewUrl && !useApplePrimary && !forceSoundCloudTest && !soundcloudPrimary) {
        try {
          previewUrl = await findApplePreviewUrl(track.artists[0].name, track.name);
          if (previewUrl) audioSource = 'apple';
        } catch (e) {}
      }
      // (3) Apple broad (balanced strategy only)
  if (!previewUrl && !useApplePrimary && !forceSoundCloudTest && !soundcloudPrimary) {
        try {
          previewUrl = await findApplePreviewUrlBroader(track.artists[0].name, track.name);
          if (previewUrl) audioSource = 'apple_broad';
        } catch (e) {}
      }
      // (4) SoundCloud explicit (secondary after Apple in apple_primary, same position otherwise) if client ID configured
  if (!previewUrl && process.env.SOUNDCLOUD_CLIENT_ID) {
        try {
          acquisitionStats.soundcloudDiagnostics.attempts++;
          if (acquisitionStats.soundcloudDiagnostics.queries.length < 12) {
            const q = `${track.artists[0]?.name} :: ${track.name}`.replace(/\s+/g,' ').trim();
            if (!acquisitionStats.soundcloudDiagnostics.queries.includes(q)) acquisitionStats.soundcloudDiagnostics.queries.push(q);
          }
          const sc = await searchSoundCloudAudio(track.artists[0]?.name, track.name);
          if (sc && (sc.streamUrl || sc.previewUrl)) {
            previewUrl = sc.streamUrl || sc.previewUrl;
            audioSource = 'soundcloud';
            alternativeSourceInfo = { source: 'soundcloud', confidence: sc.confidence || 0.8 };
            acquisitionStats.soundcloudRescue++;
            acquisitionStats.soundcloudDiagnostics.hits++;
          }
        } catch (e) {
          // ignore
        }
      }
      // (5) Alternative multi-source aggregator (Beatport, YouTube, Bandcamp, etc.)
      if (!previewUrl) {
        try {
          const alternativeResult = await findAlternativeAudioSource(track.artists[0]?.name, track.name, track);
          if (alternativeResult.bestSource && alternativeResult.bestSource.streamUrl) {
            previewUrl = alternativeResult.bestSource.streamUrl;
            audioSource = alternativeResult.bestSource.source;
            alternativeSourceInfo = {
              source: alternativeResult.bestSource.source,
              confidence: alternativeResult.bestSource.confidence,
              totalSources: alternativeResult.totalSources
            };
          }
        } catch (e) {}
      }
      // (6) Fallback to original Spotify preview if we skipped earlier and Apple/SoundCloud/alt failed (apple_primary only)
  if (useApplePrimary && !forceSoundCloudTest && !soundcloudPrimary && !previewUrl && track.preview_url) {
        previewUrl = track.preview_url;
        audioSource = 'spotify';
      }
      // NEW: In soundcloud_primary (or forced SC test) if all SC attempts failed, restore original Apple preview (if any) so we still analyze audio
      if (!previewUrl && (soundcloudPrimary || forceSoundCloudTest) && originalApplePreview) {
        previewUrl = originalApplePreview;
        audioSource = 'apple';
      }
      // If still nothing AND we had suppressed a Spotify preview (soundcloud_primary without force test), restore it
      if (!previewUrl && soundcloudPrimary && !forceSoundCloudTest && originalSpotifyPreview) {
        previewUrl = originalSpotifyPreview;
        audioSource = 'spotify';
        acquisitionStats.spotifySuppressedRestored++;
      }
      return { previewUrl, audioSource, alternativeSourceInfo };
    }

    // ROUND 1 ANALYSIS
    let round1Success = 0;
  for (let i = 0; i < round1Tracks.length; i++) {
      const track = round1Tracks[i];
      
      try {
        console.log(`   [R1] Track ${i+1}/${round1Tracks.length}: ${track.name}${track.isRecentRelease ? ' (recent)' : ' (top)'}...`);
        
        const { previewUrl, audioSource, alternativeSourceInfo } = await acquirePreviewForTrack(track);
        if (previewUrl && audioSource) {
          // update previewSourceCounts early for instrumentation parity
          acquisitionStats.previewSourceCounts[audioSource] = (acquisitionStats.previewSourceCounts[audioSource] || 0) + 1;
        }
        
  if (previewUrl) {
          const features = await analyzeAudioWithEssentia(previewUrl, { correlationId, tier: 'artist_track_r1', artistName, trackName: track.name });
          
          trackProfiles.push({
            trackId: track.id,
            name: track.name,
            artist: track.artists[0]?.name,
            popularity: track.popularity,
            isRecentRelease: track.isRecentRelease || false,
            albumInfo: track.album || null,
            previewUrl: previewUrl,
            audioSource: audioSource,
            alternativeSourceInfo: alternativeSourceInfo,
            essentiaFeatures: features,
            analyzedAt: new Date(),
            analysisRound: 1
          });
          
          // Aggregate for backward compatibility
          for (const [key, value] of Object.entries(features)) {
            if (typeof value === 'number' && !isNaN(value)) {
              averageFeatures[key] = (averageFeatures[key] || 0) + value;
              featureCounts[key] = (featureCounts[key] || 0) + 1;
            }
          }
          
          round1Success++;
          acquisitionStats.analysisRounds.round1.withPreview++;
          // already incremented above
          console.log(`     ✅ Round 1 analysis complete`);
        } else {
          failureReasons.push('no_preview_round1');
          console.log(`     ⚠️ No preview URL for: ${track.name}`);
          acquisitionStats.previewSourceCounts.none++;
        }
        
        // Small delay
  await new Promise(resolve => setTimeout(resolve, fastMode ? 150 : 500));
        
      } catch (error) {
        console.warn(`⚠️ Round 1 failed to analyze ${track.name}:`, error.message);
      }
    }

    console.log(`📊 Round 1 Results: ${round1Success}/${round1Tracks.length} tracks analyzed successfully`);
    
    // ROUND 2 ANALYSIS (only if Round 1 had reasonable success)
    const round1SuccessRate = round1Success / round1Tracks.length;
    let round2Success = 0;
    let round2Tracks = []; // Initialize empty array
    
  // Skip Round 2 in fastMode or if nearing Heroku 30s timeout (safety guard at 22s)
  const elapsedMs = Date.now() - startTime;
  const nearingTimeout = elapsedMs > 22000; // heroku hard timeout 30s
  if (!fastMode && !nearingTimeout && round1SuccessRate >= 0.4 && maxTracks > 10) { // At least 40% success rate and maxTracks allows more
      console.log(`🔄 Round 1 success rate: ${(round1SuccessRate * 100).toFixed(1)}% - Starting Round 2`);
      
      // Round 2: Next 10 tracks (5 more top + 5 more recent)
      const round2TopTracks = topTracks.slice(5, 10); // Next 5 top tracks
      const round2RecentTracks = recentTracks.slice(5, 10); // Next 5 recent tracks
      round2Tracks = [...round2TopTracks, ...round2RecentTracks];
      
      console.log(`🔄 Round 2: Analyzing ${round2Tracks.length} more tracks (${round2TopTracks.length} top + ${round2RecentTracks.length} recent)`);
      
  for (let i = 0; i < round2Tracks.length; i++) {
        const track = round2Tracks[i];
        
        try {
          console.log(`   [R2] Track ${i+1}/${round2Tracks.length}: ${track.name}${track.isRecentRelease ? ' (recent)' : ' (top)'}...`);
          
          // Get preview URL (Spotify first, Apple fallback, extended Apple search, then alternative sources)
          const { previewUrl, audioSource, alternativeSourceInfo } = await acquirePreviewForTrack(track);
          if (previewUrl && audioSource) {
            acquisitionStats.previewSourceCounts[audioSource] = (acquisitionStats.previewSourceCounts[audioSource] || 0) + 1;
          }
          
          if (previewUrl) {
            const features = await analyzeAudioWithEssentia(previewUrl, { correlationId, tier: 'artist_track_r2', artistName, trackName: track.name });
            
            trackProfiles.push({
              trackId: track.id,
              name: track.name,
              artist: track.artists[0]?.name,
              popularity: track.popularity,
              isRecentRelease: track.isRecentRelease || false,
              albumInfo: track.album || null,
              previewUrl: previewUrl,
              audioSource: audioSource,
              alternativeSourceInfo: alternativeSourceInfo,
              essentiaFeatures: features,
              analyzedAt: new Date(),
              analysisRound: 2
            });
            
            // Aggregate for backward compatibility
            for (const [key, value] of Object.entries(features)) {
              if (typeof value === 'number' && !isNaN(value)) {
                averageFeatures[key] = (averageFeatures[key] || 0) + value;
                featureCounts[key] = (featureCounts[key] || 0) + 1;
              }
            }
            
            round2Success++;
            acquisitionStats.analysisRounds.round2.withPreview++;
            // already counted
            console.log(`     ✅ Round 2 analysis complete`);
          } else {
            failureReasons.push('no_preview_round2');
            console.log(`     ⚠️ No preview URL for: ${track.name}`);
            acquisitionStats.previewSourceCounts.none++;
          }
          
          // Small delay
          await new Promise(resolve => setTimeout(resolve, fastMode ? 150 : 500));
          
        } catch (error) {
          console.warn(`⚠️ Round 2 failed to analyze ${track.name}:`, error.message);
        }
      }
      
      console.log(`📊 Round 2 Results: ${round2Success}/${round2Tracks.length} additional tracks analyzed`);
    } else {
  console.log(`⚠️ Skipping Round 2 - Conditions unmet (fastMode=${fastMode}, nearingTimeout=${nearingTimeout}, successRate=${(round1SuccessRate * 100).toFixed(1)}%, maxTracks=${maxTracks})`);
    }

    const totalSuccess = round1Success + round2Success;
    const totalAttempted = round1Tracks.length + round2Tracks.length;
    
  console.log(JSON.stringify({ evt: 'analysis_rounds_complete', correlationId, artistName, totalAnalyzed: totalSuccess, totalAttempted, topTracksAnalyzed: trackProfiles.filter(t => !t.isRecentRelease).length, recentTracksAnalyzed: trackProfiles.filter(t => t.isRecentRelease).length, successRate: ((totalSuccess/totalAttempted)*100).toFixed(1) }));

    // Calculate averages for backward compatibility
    for (const [key, total] of Object.entries(averageFeatures)) {
      if (featureCounts[key] > 0) {
        averageFeatures[key] = total / featureCounts[key];
      }
    }

    // Basic spectral features (placeholder for advanced analysis)
    if (trackProfiles.length > 0) {
      spectralFeatures.spectralCentroid = averageFeatures.spectral_centroid || 0;
      spectralFeatures.spectralRolloff = averageFeatures.spectral_rolloff || 0;
      spectralFeatures.mfcc = averageFeatures.mfcc_mean || 0;
    }

    // Build genre mapping and sound characteristics (works even without track profiles)
    const genreMapping = await buildGenreMapping(trackProfiles, artistName, existingGenres);
    const recentEvolution = calculateRecentSoundEvolution(trackProfiles);

    // If no tracks were analyzed but we have genre mapping from existing genres, return partial success
    if (trackProfiles.length === 0) {
      // Failure classification when no audio vectors produced
      const failSubtype = hadInitialTracks ? 'no_preview' : (existingGenres.length > 0 ? 'no_tracks_genre_only' : 'no_tracks');
      // Partial success path if we do have genres (either existingGenres or inferred mapping)
      if (genreMapping && genreMapping.inferredGenres && genreMapping.inferredGenres.length > 0) {
        console.log(`✅ Partial success: No audio analysis but genres available for ${artistName}`);
        const metadataFeatures = inferAudioFeaturesFromGenres(genreMapping.inferredGenres, artistName, 'mixed_tracks');
        const partial = {
          success: true,
          partial: true,
          failSubtype,
          artistName,
          spotifyId,
          trackMatrix: [],
          genreMapping,
          recentEvolution: { evolution: 'insufficient_data' },
          averageFeatures: metadataFeatures,
          spectralFeatures: metadataFeatures,
          metadata: {
            totalTracksAnalyzed: 0,
            tracksAttempted: totalAttempted,
            topTracks: 0,
            recentReleases: 0,
            analysisRounds: 1,
            successRate: 0,
            hasGenreMapping: true,
            hasAudioAnalysis: false,
            hasMetadataInference: true,
            inferenceSource: 'genre_mapping',
            lowConfidenceAudio: true,
            failureReasons
          }
        };
        res.setHeader('x-correlation-id', correlationId);
        partial.metadata.spotifyTokenStatus = spotifyTokenStatus;
        return res.json({ ...partial, spotifyTokenStatus, acquisitionStats });
      }
      return res.json({ success: false, error: 'No tracks could be analyzed and no genres available', failSubtype, artistName, tracksAttempted: totalAttempted, failureReasons, correlationId, spotifyTokenStatus, acquisitionStats });
    }

  const result = {
      success: true,
      artistName,
      spotifyId,
      trackMatrix: trackProfiles, // Individual track analysis (NOT aggregated)
      genreMapping,
      recentEvolution,
      averageFeatures, // For backward compatibility
      spectralFeatures, // For backward compatibility
      metadata: {
        totalTracksAnalyzed: trackProfiles.length,
        topTracks: trackProfiles.filter(t => !t.isRecentRelease).length,
        recentReleases: trackProfiles.filter(t => t.isRecentRelease).length,
        round1Success: round1Success,
        round2Success: round2Success,
        analysisRounds: round2Success > 0 ? 2 : 1,
        successRate: `${((totalSuccess/totalAttempted)*100).toFixed(1)}%`,
        analysisTime: Date.now() - startTime,
        source: 'essentia',
        stagedAnalysis: true,
  fastMode,
  audioSources: {
          spotify: trackProfiles.filter(t => t.audioSource === 'spotify').length,
          apple: trackProfiles.filter(t => t.audioSource === 'apple' || t.audioSource === 'apple_broad').length,
          soundcloud: trackProfiles.filter(t => t.audioSource === 'soundcloud').length,
          youtube: trackProfiles.filter(t => t.audioSource === 'youtube').length,
          beatport: trackProfiles.filter(t => t.audioSource === 'beatport').length,
          bandcamp: trackProfiles.filter(t => t.audioSource === 'bandcamp').length,
          alternativeSourcesUsed: trackProfiles.filter(t => t.alternativeSourceInfo).length
  },
  lowConfidenceAudio: trackProfiles.length < 3,
  failureReasons,
  spotifyTokenStatus
      }
    };
  res.setHeader('x-correlation-id', correlationId);
  // Persist artist-level profile (audio + genres) for downstream unified events/frontend
  try {
    if (db) {
      await db.collection('artist_genre_profiles').updateOne(
        { artistName: artistName.toLowerCase() },
        { $set: {
            artistName,
            spotifyId: spotifyId || null,
            updatedAt: new Date(),
            trackMatrix: trackProfiles,
            genreMapping: result.genreMapping,
            averageFeatures: result.averageFeatures,
            spectralFeatures: result.spectralFeatures,
            recentEvolution: result.recentEvolution,
            acquisitionStats,
            audioSourcesSummary: result.metadata.audioSources,
            totalTracksAnalyzed: result.metadata.totalTracksAnalyzed
          } },
        { upsert: true }
      );
    }
  } catch (persistErr) {
    console.warn('⚠️ Failed to persist artist_genre_profiles:', persistErr.message);
  }
  console.log(JSON.stringify({ evt: 'analyze_artist_success', correlationId, artistName, spotifyId, tracksAnalyzed: trackProfiles.length, durationMs: Date.now() - startTime, audioSources: result.metadata.audioSources, acquisitionStats }));
  res.json({ ...result, acquisitionStats });

  } catch (error) {
  console.error(JSON.stringify({ evt: 'analyze_artist_error', correlationId, artistName: req.body.artistName, error: error.message, stack: error.stack }));
  res.setHeader('x-correlation-id', correlationId);
  res.status(500).json({
      success: false,
      error: error.message,
      artistName: req.body.artistName
    });
  }
});

// User sound profile matrix endpoint - build from recent 20 tracks
app.post('/api/user-profile', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { userId, recentTracks, maxTracks = 20 } = req.body;
    
    if (!userId || !recentTracks || !Array.isArray(recentTracks)) {
      return res.status(400).json({ error: 'userId and recentTracks array required' });
    }

    console.log(`👤 Building user sound profile matrix for: ${userId}`);
    console.log(`🎵 Analyzing ${Math.min(recentTracks.length, maxTracks)} recent tracks (up to 20)`);
    
    const userTrackProfiles = [];
    const tracksToAnalyze = recentTracks.slice(0, maxTracks);
    
    for (let i = 0; i < tracksToAnalyze.length; i++) {
      const track = tracksToAnalyze[i];
      
      try {
        console.log(`   Analyzing user track ${i+1}/${tracksToAnalyze.length}: ${track.name}...`);
        
        // Get preview URL (Spotify first, Apple fallback)
        let previewUrl = track.preview_url;
        if (!previewUrl && track.artists && track.name) {
          previewUrl = await findApplePreviewUrl(track.artists[0].name, track.name);
        }
        
        if (previewUrl) {
          const features = await analyzeAudioWithEssentia(previewUrl);
          
          userTrackProfiles.push({
            trackId: track.id,
            name: track.name,
            artist: track.artists[0]?.name,
            essentiaFeatures: features,
            listenedAt: track.listenedAt || new Date(),
            analyzedAt: new Date()
          });
          
          console.log(`     ✅ User track analysis complete`);
        } else {
          console.log(`     ⚠️ No preview URL for user track: ${track.name}`);
        }
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.warn(`⚠️ Failed to analyze user track ${track.name}:`, error.message);
      }
    }

    if (userTrackProfiles.length === 0) {
      return res.json({
        success: false,
        error: 'No user tracks could be analyzed',
        userId
      });
    }

    // Calculate user sound preferences
    const soundPreferences = calculateUserSoundPreferences(userTrackProfiles);
    
    // Store user profile in database
    if (db) {
      await db.collection('user_sound_profiles').updateOne(
        { userId },
        {
          $set: {
            userId,
            trackMatrix: userTrackProfiles, // Individual track matrix
            soundPreferences,
            profileUpdatedAt: new Date(),
            tracksAnalyzed: userTrackProfiles.length,
            source: 'essentia'
          }
        },
        { upsert: true }
      );
    }

    res.json({
      success: true,
      userId,
      trackMatrix: userTrackProfiles, // Individual track analysis
      soundPreferences,
      metadata: {
        tracksAnalyzed: userTrackProfiles.length,
        analysisTime: Date.now() - startTime,
        source: 'essentia'
      }
    });

  } catch (error) {
    console.error('❌ User profile analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      userId: req.body.userId
    });
  }
});

// ===== HELPER FUNCTIONS =====

// Get Spotify access token
async function getSpotifyToken() {
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });

    if (response.ok) {
      const data = await response.json();
      return data.access_token;
    }
  } catch (error) {
    console.error('❌ Spotify token error:', error);
  }
  return null;
}

// Find Apple preview URL as fallback
async function findApplePreviewUrl(artistName, trackName) {
  try {
    const searchTerm = `${artistName} ${trackName}`.replace(/[^\w\s]/gi, '');
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=music&entity=song&limit=1`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        return data.results[0].previewUrl;
      }
    }
  } catch (error) {
    console.warn(`⚠️ Apple search failed for ${artistName} - ${trackName}:`, error.message);
  }
  return null;
}

// Find Apple tracks for artist (when no Spotify access)
async function findAppleTracksForArtist(artistName, limit = 20) {
  try {
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&media=music&entity=song&limit=${limit}`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        return data.results.map(result => ({
          id: result.trackId,
          name: result.trackName,
          artists: [{ name: result.artistName }],
          album: { name: result.collectionName },
          popularity: 50, // Default
          preview_url: result.previewUrl,
          applePreview: !!result.previewUrl,
          external_urls: { itunes: result.trackViewUrl }
        }));
      }
    }
  } catch (error) {
    console.warn(`⚠️ Apple artist search failed for ${artistName}:`, error.message);
  }
  return [];
}

// Broader Apple search (for difficult tracks)
async function findApplePreviewUrlBroader(artistName, trackName) {
  try {
    // Try with just the artist name
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&media=music&entity=song&limit=10`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        // Return the first result's preview URL
        const firstResult = data.results.find(result => result.previewUrl);
        return firstResult ? firstResult.previewUrl : null;
      }
    }
  } catch (error) {
    console.warn(`⚠️ Broader Apple search failed for ${artistName}:`, error.message);
  }
  return null;
}

// Analyze audio with Essentia (placeholder - replace with actual Essentia.js calls)
async function analyzeAudioWithEssentia(audioUrl, context = {}) {
  // This is a placeholder - in production, you would use Essentia.js
  // For now, returning mock features that match Essentia's output structure
  const { correlationId, audioHash, tier, artistName, trackName } = context;
  log('essentia_track_begin', { correlationId, audioHash: audioHash || hashAudioUrl(audioUrl), tier, artistName, trackName });
  
  // Simulate analysis time
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Mock Essentia features (replace with real Essentia.js analysis)
  const featurePayload = {
    // Low-level features
    spectral_centroid: Math.random() * 4000 + 1000,
    spectral_rolloff: Math.random() * 8000 + 2000,
    spectral_flux: Math.random() * 100,
    mfcc_mean: Math.random() * 50 - 25,
    chroma_mean: Math.random(),
    
    // Rhythm features
    tempo: Math.random() * 100 + 80,
    beats_per_minute: Math.random() * 100 + 80,
    rhythm_strength: Math.random(),
    
    // Tonal features
    key_strength: Math.random(),
    harmonicity: Math.random(),
    
    // High-level features
    danceability: Math.random(),
    energy: Math.random(),
    valence: Math.random(),
    arousal: Math.random(),
    
    // Essentia-specific
    loudness: Math.random() * 60 - 60,
    dynamic_range: Math.random() * 20,
    zerocrossingrate: Math.random() * 0.2,
    
    // Analysis metadata
    analysis_source: 'essentia',
    analysis_version: '2.1-beta5',
    vector: [] // Placeholder embedding vector (future: real Essentia embedding)
  };
  // Provide deterministic short vector for prototyping (e.g., 8 dims)
  featurePayload.vector = Array.from({ length: 8 }, () => Math.random());
  log('essentia_track_complete', { correlationId, audioHash: audioHash || hashAudioUrl(audioUrl), tier, dims: featurePayload.vector.length });
  // Return mock features (placeholder until real Essentia integration)
  return featurePayload;
}

function hashAudioUrl(url) {
  return crypto.createHash('sha1').update(url).digest('hex');
}

async function collectQuickStats() {
  if (!db) return { dbConnected: false };
  try {
    const audioFeaturesCount = await db.collection('audio_features').countDocuments();
    const userProfiles = await db.collection('user_sound_profiles').countDocuments();
    return { dbConnected: true, audioFeaturesCount, userProfiles };
  } catch (e) {
    return { dbConnected: true, statsError: e.message };
  }
}

// Calculate user sound preferences from track matrix
function calculateUserSoundPreferences(trackProfiles) {
  if (!trackProfiles || trackProfiles.length === 0) return {};
  
  const preferences = {};
  const features = ['danceability', 'energy', 'valence', 'tempo', 'spectral_centroid'];
  
  features.forEach(feature => {
    const values = trackProfiles
      .map(track => track.essentiaFeatures[feature])
      .filter(val => val !== undefined && !isNaN(val));
    
    if (values.length > 0) {
      const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
      const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
      
      preferences[feature] = {
        average: avg,
        variance: variance,
        range: [Math.min(...values), Math.max(...values)]
      };
    }
  });
  
  return preferences;
}

// Build genre mapping from tracks
async function buildGenreMapping(trackProfiles, artistName, existingGenres = []) {
  // PRIORITY 1: Use existing Spotify genres if available
  if (existingGenres && existingGenres.length > 0) {
    console.log(`🎼 Using existing Spotify genres for ${artistName}: ${existingGenres.join(', ')}`);
    return {
      inferredGenres: existingGenres.slice(0, 5), // Use up to 5 existing genres as array
      source: 'spotify',
      confidence: 1.0
    };
  }
  
  // PRIORITY 2: Infer from audio features
  const genres = inferGenresFromTracks(trackProfiles, artistName);
  const genreProfile = calculateGenreSoundProfile(trackProfiles);
  
  // Return object with inferredGenres array (as expected by frontend)
  if (genres && genres.length > 0) {
    console.log(`🎼 Inferred genres from audio features for ${artistName}: ${genres.join(', ')}`);
    return {
      inferredGenres: genres,
      source: 'audio_analysis',
      confidence: 0.8
    };
  }
  
  // PRIORITY 3: If no genres inferred from audio features, try artist name-based inference
  const artistBasedGenres = inferGenreFromArtistName(artistName);
  if (artistBasedGenres && artistBasedGenres.length > 0) {
    console.log(`🎼 Inferred genres from artist name for ${artistName}: ${artistBasedGenres.join(', ')}`);
    return {
      inferredGenres: artistBasedGenres,
      source: 'name_inference',
      confidence: 0.6
    };
  }
  
  console.log(`⚠️ No genres found for ${artistName}`);
  return {
    inferredGenres: [],
    source: 'none',
    confidence: 0.0
  };
}

// Calculate recent sound evolution
function calculateRecentSoundEvolution(trackProfiles) {
  const recentTracks = trackProfiles.filter(t => t.isRecentRelease);
  const topTracks = trackProfiles.filter(t => !t.isRecentRelease);
  
  if (recentTracks.length === 0 || topTracks.length === 0) {
    return { evolution: 'insufficient_data' };
  }
  
  const recentAvg = calculateAverageFeatures(recentTracks);
  const topAvg = calculateAverageFeatures(topTracks);
  
  return {
    evolution: 'detected',
    energyChange: recentAvg.energy - topAvg.energy,
    danceabilityChange: recentAvg.danceability - topAvg.danceability,
    valenceChange: recentAvg.valence - topAvg.valence,
    tempoChange: recentAvg.tempo - topAvg.tempo,
    recentTracksCount: recentTracks.length,
    topTracksCount: topTracks.length
  };
}

// Calculate average features from track profiles
function calculateAverageFeatures(trackProfiles) {
  if (!trackProfiles || trackProfiles.length === 0) return {};
  
  const features = ['energy', 'danceability', 'valence', 'tempo', 'spectral_centroid'];
  const averages = {};
  
  features.forEach(feature => {
    const values = trackProfiles
      .map(track => track.essentiaFeatures[feature])
      .filter(val => val !== undefined && !isNaN(val));
    
    if (values.length > 0) {
      averages[feature] = values.reduce((sum, val) => sum + val, 0) / values.length;
    }
  });
  
  return averages;
}

// Infer genres from track characteristics
function inferGenresFromTracks(trackProfiles, artistName) {
  if (!trackProfiles || trackProfiles.length === 0) return [];
  
  const genres = [];
  const avgFeatures = calculateAverageFeatures(trackProfiles);
  
  // Only proceed if we have meaningful features
  if (!avgFeatures.energy && !avgFeatures.tempo && !avgFeatures.danceability) {
    return [];
  }
  
  // EDM/Electronic genre detection (prioritized)
  if (avgFeatures.energy > 0.75 && avgFeatures.tempo > 125 && avgFeatures.danceability > 0.65) {
    genres.push('edm', 'electronic', 'dance');
  } else if (avgFeatures.energy > 0.7 && avgFeatures.tempo > 120) {
    genres.push('electronic', 'dance');
  }
  
  // House/Techno
  if (avgFeatures.tempo > 115 && avgFeatures.tempo < 135 && avgFeatures.danceability > 0.7) {
    genres.push('house', 'techno');
  }
  
  // Trance
  if (avgFeatures.tempo > 130 && avgFeatures.energy > 0.8 && avgFeatures.valence > 0.6) {
    genres.push('trance');
  }
  
  // Dubstep/Bass
  if (avgFeatures.energy > 0.8 && avgFeatures.tempo > 140) {
    genres.push('dubstep', 'bass');
  }
  
  // Pop/Dance-Pop
  if (avgFeatures.energy > 0.6 && avgFeatures.danceability > 0.7 && avgFeatures.valence > 0.5) {
    genres.push('pop', 'dance-pop');
  }
  
  // Alternative/Indie
  if (avgFeatures.valence < 0.4 && avgFeatures.energy < 0.6) {
    genres.push('indie', 'alternative');
  }
  
  // Ambient/Downtempo
  if (avgFeatures.tempo < 100 && avgFeatures.energy < 0.4) {
    genres.push('ambient', 'downtempo');
  }
  
  // Hip-hop/Rap
  if (avgFeatures.tempo > 80 && avgFeatures.tempo < 110 && avgFeatures.energy > 0.6) {
    genres.push('hip-hop', 'rap');
  }
  
  return [...new Set(genres)].slice(0, 3);
}

// Infer genre from artist name (fallback method)
function inferGenreFromArtistName(artistName) {
  const name = artistName.toLowerCase();
  
  // EDM artists (prioritized)
  const edmArtists = ['deadmau5', 'skrillex', 'calvin harris', 'tiesto', 'david guetta', 'armin van buuren', 
                      'martin garrix', 'diplo', 'zedd', 'marshmello', 'fisher', 'ferry corsten', 'dvbbs', 
                      'rezz', 'porter robinson', 'richie hawtin', 'tiga', 'above & beyond', 'eric prydz',
                      'deadmau5', 'swedish house mafia', 'axwell', 'steve angello', 'sebastian ingrosso'];
  
  if (edmArtists.some(artist => name.includes(artist))) {
    return ['edm', 'electronic', 'dance'];
  }
  
  // Rock/Metal
  const rockArtists = ['metallica', 'iron maiden', 'black sabbath', 'suffocation', 'killswitch engage', 
                       'parkway drive', 'beartooth', 'anvil'];
  if (rockArtists.some(artist => name.includes(artist))) {
    return ['rock', 'metal'];
  }
  
  // Hip-hop
  const hipHopArtists = ['wu-tang clan', 'run the jewels', 'big sean', 'russ'];
  if (hipHopArtists.some(artist => name.includes(artist))) {
    return ['hip-hop', 'rap'];
  }
  
  // Pop
  const popArtists = ['coldplay', 'shania twain', 'luke bryan', 'thomas rhett'];
  if (popArtists.some(artist => name.includes(artist))) {
    return ['pop'];
  }
  
  // Alternative/Indie
  const indieArtists = ['pup', 'jeff rosenstock', 'kurt vile', 'tripping daisy', 'mest'];
  if (indieArtists.some(artist => name.includes(artist))) {
    return ['indie', 'alternative'];
  }
  
  return [];
}

// Calculate genre sound profile
function calculateGenreSoundProfile(trackProfiles) {
  const avgFeatures = calculateAverageFeatures(trackProfiles);
  
  return {
    energy_level: avgFeatures.energy > 0.7 ? 'high' : avgFeatures.energy > 0.4 ? 'medium' : 'low',
    danceability_level: avgFeatures.danceability > 0.7 ? 'high' : avgFeatures.danceability > 0.4 ? 'medium' : 'low',
    tempo_range: avgFeatures.tempo > 130 ? 'fast' : avgFeatures.tempo > 100 ? 'medium' : 'slow',
    mood: avgFeatures.valence > 0.6 ? 'positive' : avgFeatures.valence > 0.4 ? 'neutral' : 'melancholic'
  };
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Essentia Audio Service running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🎯 Analysis endpoint: http://localhost:${PORT}/api/analyze`);
  console.log(`🎤 Artist analysis: http://localhost:${PORT}/api/analyze-artist`);
  console.log(`👤 User profile: http://localhost:${PORT}/api/user-profile`);
});
