// When you leave the desk: what to pause, and what to leave playing. Music (the Music and Spotify apps, or a music site in a browser tab) can be left
// playing if you want to hear it while you are away ("keep music playing"); video is paused so it does not play to an empty room. Pure.

const MUSIC_SITES = /(^|\.)(music\.youtube\.com|open\.spotify\.com|spotify\.com|music\.apple\.com|soundcloud\.com|bandcamp\.com|deezer\.com|tidal\.com|pandora\.com|music\.amazon\.[a-z.]+|last\.fm|radio\.[a-z.]+|tunein\.com|iheart\.com)$/i;
const isMusicSite = (url) => { try { return MUSIC_SITES.test(new URL(url).hostname); } catch { return false; } };

// musicApp: the name of the app that is playing (Music or Spotify) or null; tabs: the browser tabs making sound ({ url }).
// -> { pauseMusicApp, pauseVideo }: pause the music app / press the media key for the video that is playing.
function decideAway({ keepMusic = false, pauseVideo = true, musicApp = null, tabs = [] } = {}) {
  const audible = tabs.filter((t) => t && t.url);
  const videoTabs = audible.filter((t) => !isMusicSite(t.url));
  const musicTabs = audible.filter((t) => isMusicSite(t.url));
  return {
    pauseMusicApp: !keepMusic, // the pause command itself finds out what is playing (and says so when nothing is)
    // The media key goes to whatever app has "now playing", so it is only pressed when no music app is playing (the music app would get it instead)
    // and when the sound in the browser is video, or is music you did not ask to keep.
    pauseVideo: pauseVideo !== false && !musicApp && (videoTabs.length > 0 || (musicTabs.length > 0 && !keepMusic))
  };
}

module.exports = { decideAway, isMusicSite };
