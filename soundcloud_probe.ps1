<#!
SoundCloud probing helper for Essentia pipeline debugging.
Usage (from repo root or this folder):
  pwsh -File .\soundcloud_probe.ps1 -Artist "Maze 28" -Track "Some Track Name"
If -Track is omitted, shows top candidate tracks.
#>
[CmdletBinding()]param(
  [Parameter(Mandatory=$true)][string]$Artist,
  [string]$Track,
  [string]$ClientId = '[REDACTED_SOUNDCLOUD_CLIENT_ID]',
  [switch]$VerboseJson,
  [int]$MaxUserTracks = 100
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Section($t){ Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Trunc($s,$n=90){ if(!$s){return $s}; if($s.Length -le $n){return $s}; return $s.Substring(0,$n)+'…' }
function Show-Obj($o){ $o | ConvertTo-Json -Depth 8 }

function Get-SCUsers($artist,$clientId){
  $url = "https://api-v2.soundcloud.com/search/users?q=$( [uri]::EscapeDataString($artist) )&client_id=$clientId&limit=5"
  Invoke-RestMethod $url
}
function Score-User($artist,$u){
  $target=$artist.ToLower(); $un=($u.username|ToString).ToLower()
  $score = 0
  if($u.verified){ $score+=5 }
  if($un -eq $target){ $score+=2 } elseif($un -like "*$target*"){ $score+=1 }
  $score += [Math]::Min(3,[Math]::Floor(($u.followers_count)/50000))
  [pscustomobject]@{ id=$u.id; username=$u.username; verified=$u.verified; followers=$u.followers_count; score=$score }
}
function Get-SCUserTracks($userId,$clientId,$limit){
  $url = "https://api-v2.soundcloud.com/users/$userId/tracks?client_id=$clientId&limit=$limit"
  Invoke-RestMethod $url
}
function Choose-ProgressiveTranscoding($track){
  $t = $track.media.transcodings | Where-Object { $_.format.protocol -eq 'progressive' } | Select-Object -First 1
  if(-not $t){ $t = $track.media.transcodings | Select-Object -First 1 }
  return $t
}
function Resolve-Transcoding($transcoding,$clientId){
  if(-not $transcoding){ return $null }
  $resolveUrl = "$($transcoding.url)?client_id=$clientId"
  Invoke-RestMethod $resolveUrl
}
function Search-TrackFallback($query,$clientId){
  $url = "https://api-v2.soundcloud.com/search/tracks?q=$( [uri]::EscapeDataString($query) )&client_id=$clientId&limit=10"
  Invoke-RestMethod $url
}

Write-Section "User Search"
$users = Get-SCUsers -artist $Artist -clientId $ClientId
if(-not $users.collection){ Write-Host "No users found" -ForegroundColor Yellow; exit 1 }
$scored = $users.collection | ForEach-Object { Score-User $Artist $_ } | Sort-Object score -Descending
$scored | Format-Table -AutoSize | Out-String | Write-Host
$bestUser = $scored | Select-Object -First 1
Write-Host "Chosen user: $($bestUser.username) (id=$($bestUser.id)) score=$($bestUser.score)" -ForegroundColor Green

Write-Section "User Tracks"
$userTracks = Get-SCUserTracks -userId $bestUser.id -clientId $ClientId -limit $MaxUserTracks
$trackRows = $userTracks | Select-Object id, @{n='title';e={Trunc $_.title 50}}, duration, streamable, @{n='hasMedia';e={($_.media.transcodings).Count -gt 0}}
$trackRows | Select-Object -First 15 | Format-Table -AutoSize | Out-String | Write-Host

# Optionally filter by requested track title snippet
$selectedTrack = $null
if($Track){
  Write-Section "Filter Attempt"
  $regex = [Regex]::Escape($Track)
  $matches = $userTracks | Where-Object { $_.title -match $regex }
  if($matches){
    $selectedTrack = $matches | Select-Object -First 1
    Write-Host "Matched track: $($selectedTrack.title) (id=$($selectedTrack.id))" -ForegroundColor Green
  } else {
    Write-Host "No direct title match for '$Track' in user list (will fallback to best scoring heuristic)." -ForegroundColor Yellow
  }
}
if(-not $selectedTrack){
  # Simple heuristic: prefer streamable + media + longer duration
  $selectedTrack = $userTracks | Sort-Object @{e={ $_.streamable -ne $false };Descending=$true}, @{e={ ($_.media.transcodings).Count };Descending=$true}, @{e={$_.duration};Descending=$true} | Select-Object -First 1
  Write-Host "Heuristic pick: $($selectedTrack.title) (id=$($selectedTrack.id))" -ForegroundColor Green
}

Write-Section "Track Media"
if(-not $selectedTrack.media.transcodings){ Write-Host "No transcodings available on chosen track." -ForegroundColor Yellow } else {
  $selectedTrack.media.transcodings | Select-Object @{n='protocol';e={$_.format.protocol}}, @{n='mime';e={$_.format.mime_type}}, url | Format-Table -AutoSize | Out-String | Write-Host
}

$transcoding = Choose-ProgressiveTranscoding $selectedTrack
if($transcoding){
  Write-Section "Resolve Transcoding"
  $resolved = Resolve-Transcoding -transcoding $transcoding -clientId $ClientId
  if($VerboseJson){ Show-Obj $resolved }
  $finalUrl = $resolved.url
  if($finalUrl){ Write-Host "Final stream URL: $finalUrl" -ForegroundColor Green } else { Write-Host "Failed to resolve final URL" -ForegroundColor Red }
} else {
  Write-Host "No transcoding object chosen" -ForegroundColor Yellow
}

if(-not $finalUrl){
  Write-Section "Search Fallback"
  $q = "$Artist $Track".Trim()
  $search = Search-TrackFallback -query $q -clientId $ClientId
  if($search.collection){
    $cand = $search.collection | Where-Object { $_.streamable -ne $false -and $_.media.transcodings } | Select-Object -First 1
    if($cand){
      Write-Host "Search candidate: $($cand.title) id=$($cand.id)" -ForegroundColor Green
      $t2 = Choose-ProgressiveTranscoding $cand
      $resolved2 = Resolve-Transcoding -transcoding $t2 -clientId $ClientId
      if($resolved2.url){ Write-Host "Final stream (search fallback): $($resolved2.url)" -ForegroundColor Green }
    } else { Write-Host "No suitable track in search fallback." -ForegroundColor Yellow }
  } else { Write-Host "Search fallback returned 0 tracks." -ForegroundColor Yellow }
}

Write-Section "Summary"
[pscustomobject]@{
  Artist = $Artist
  TrackRequest = $Track
  ChosenUser = $bestUser.username
  ChosenTrack = $selectedTrack.title
  DurationMs = $selectedTrack.duration
  Streamable = $selectedTrack.streamable
  ProgressiveResolved = [bool]$finalUrl
  FinalStreamUrl = $finalUrl
} | Format-List
