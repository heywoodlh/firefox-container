// Param values from https://developer.mozilla.org/Add-ons/WebExtensions/API/contextualIdentities/create
const SPOTIFY_CONTAINER_NAME = "Spotify";
const SPOTIFY_CONTAINER_COLOR = "green";
const SPOTIFY_CONTAINER_ICON = "briefcase";
let SPOTIFY_DOMAINS = ["byspotify.com", "pscdn.co", "scdn.co", "spoti.fi", "spotify-everywhere.com", "spotify.com", "spotify.design", "spotifycdn.com", "spotifycdn.net", "spotifycharts.com", "spotifycodes.com", "spotifyforbrands.com", "spotifyjobs.com", "spotify.link"]; // https://github.com/v2ray/domain-list-community/blob/master/data/spotify
const SPOTIFY_RELATED_DOMAINS = ["audio-ak-spotify-com.akamaized.net", "audio4-ak-spotify-com.akamaized.net", "cdn-spotify-experiments.conductrics.com", "heads-ak-spotify-com.akamaized.net", "heads4-ak-spotify-com.akamaized.net", "spotify.com.edgesuite.net", "spotify.map.fastly.net", "spotify.map.fastlylb.net"];

SPOTIFY_DOMAINS = SPOTIFY_DOMAINS.concat(SPOTIFY_RELATED_DOMAINS);

let spotifyMacAddonEnabled = false;
let spotifyCookieStoreId = null;
let spotifyCookiesCleared = false;

const spotifyHostREs = [];

async function isSpotifyMACAddonEnabled () {
  try {
    const spotifyMacAddonInfo = await browser.management.get(MAC_ADDON_ID);
    if (spotifyMacAddonInfo.enabled) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function spotifySetupMACAddonManagementListeners () {
  browser.management.onInstalled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = true;
    }
  });
  browser.management.onUninstalled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = false;
    }
  });
  browser.management.onEnabled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = true;
    }
  });
  browser.management.onDisabled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = false;
    }
  });
}

function generatespotifyHostREs () {
  for (let spotifyDomain of SPOTIFY_DOMAINS) {
    spotifyHostREs.push(new RegExp(`^(.*\\.)?${spotifyDomain}$`));
  }
}

async function clearspotifyCookies () {
  // Clear all spotify cookies
  const containers = await browser.contextualIdentities.query({});
  containers.push({
    cookieStoreId: 'firefox-default'
  });
  containers.map(container => {
    const storeId = container.cookieStoreId;
    if (storeId === spotifyCookieStoreId) {
      // Don't clear cookies in the spotify Container
      return;
    }

    SPOTIFY_DOMAINS.map(async spotifyDomain => {
      const spotifyCookieUrl = `https://${spotifyDomain}/`;

      const cookies = await browser.cookies.getAll({
        domain: spotifyDomain,
        storeId
      });

      cookies.map(cookie => {
        browser.cookies.remove({
          name: cookie.name,
          url: spotifyCookieUrl,
          storeId
        });
      });
    });
  });
}

async function setupSpotifyContainer () {
  let currentSettings = await browser.storage.sync.get();
  // Use existing spotify container, or create one
  const contexts = await browser.contextualIdentities.query({name: SPOTIFY_CONTAINER_NAME})
  if (contexts.length > 0) {
    spotifyCookieStoreId = contexts[0].cookieStoreId;
    if (currentSettings.disable_spotify) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(spotifyCookieStoreId);
    }
  } else {
    const context = await browser.contextualIdentities.create({
      name: SPOTIFY_CONTAINER_NAME,
      color: SPOTIFY_CONTAINER_COLOR,
      icon: SPOTIFY_CONTAINER_ICON
    })
    spotifyCookieStoreId = context.cookieStoreId;
    if (currentSettings.disable_spotify) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(spotifyCookieStoreId);
    }
  }
}

async function containspotify (options) {
  // Listen to requests and open spotify into its Container,
  // open other sites into the default tab context
  const requestUrl = new URL(options.url);

  let isspotify = false;
  for (let spotifyHostRE of spotifyHostREs) {
    if (spotifyHostRE.test(requestUrl.host)) {
      isspotify = true;
      break;
    }
  }

  // We have to check with every request if the requested URL is assigned with MAC
  // because the user can assign URLs at any given time (needs MAC Events)
  if (spotifyMacAddonEnabled) {
    const macAssigned = await Globals.getMACAssignment(options.url);
    if (macAssigned) {
      // This URL is assigned with MAC, so we don't handle this request
      return;
    }
  }

  const tab = await browser.tabs.get(options.tabId);
  const tabCookieStoreId = tab.cookieStoreId;
  if (isspotify) {
    if (tabCookieStoreId !== spotifyCookieStoreId && !tab.incognito) {
      // See https://github.com/mozilla/contain-spotify/issues/23
      // Sometimes this add-on is installed but doesn't get a spotifyCookieStoreId ?
      if (spotifyCookieStoreId) {
        if (Globals.shouldCancelEarly(tab, options)) {
          return {cancel: true};
        }
        browser.tabs.create({
          url: requestUrl.toString(),
          cookieStoreId: spotifyCookieStoreId,
          active: tab.active,
          index: tab.index,
          windowId: tab.windowId
        });
        browser.tabs.remove(options.tabId);
        return {cancel: true};
      }
    }
  } else {
    if (tabCookieStoreId === spotifyCookieStoreId) {
      if (Globals.shouldCancelEarly(tab, options)) {
        return {cancel: true};
      }
      browser.tabs.create({
        url: requestUrl.toString(),
        active: tab.active,
        index: tab.index,
        windowId: tab.windowId
      });
      browser.tabs.remove(options.tabId);
      return {cancel: true};
    }
  }
}

(async function init() {
  await spotifySetupMACAddonManagementListeners();
  spotifyMacAddonEnabled = await isSpotifyMACAddonEnabled();

  await setupSpotifyContainer();
  clearspotifyCookies();
  generatespotifyHostREs();


  // Do nothing if the user has disabled the container
  let currentSettings = await browser.storage.sync.get();
  if (currentSettings.disable_spotify) {
    return
  } else {
    // Add the request listener
    browser.webRequest.onBeforeRequest.addListener(containspotify, {urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);

    // Clean up canceled requests
    browser.webRequest.onCompleted.addListener((options) => {
      if (canceledRequests[options.tabId]) {
       delete canceledRequests[options.tabId];
      }
    },{urls: ["<all_urls>"], types: ["main_frame"]});
    browser.webRequest.onErrorOccurred.addListener((options) => {
      if (canceledRequests[options.tabId]) {
        delete canceledRequests[options.tabId];
      }
    },{urls: ["<all_urls>"], types: ["main_frame"]});
  }
})();
