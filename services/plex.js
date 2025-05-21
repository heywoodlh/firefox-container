// Param values from https://developer.mozilla.org/Add-ons/WebExtensions/API/contextualIdentities/create
const PLEX_CONTAINER_NAME = "Plex";
const PLEX_CONTAINER_COLOR = "purple";
const PLEX_CONTAINER_ICON = "briefcase";
let PLEX_DOMAINS = ["plex.tv", "plex.bz", "plex.direct", "plexapp.com", "plex.services"]; // https://github.com/deathbybandaid/pihole-whitelists/blob/master/plex.txt

let plexMacAddonEnabled = false;
let plexCookieStoreId = null;
let plexCookiesCleared = false;

const plexHostREs = [];

async function isPlexMACAddonEnabled () {
  try {
    const plexMacAddonInfo = await browser.management.get(MAC_ADDON_ID);
    if (plexMacAddonInfo.enabled) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function plexSetupMACAddonManagementListeners () {
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

function generateplexHostREs () {
  for (let plexDomain of PLEX_DOMAINS) {
    plexHostREs.push(new RegExp(`^(.*\\.)?${plexDomain}$`));
  }
}

async function clearplexCookies () {
  // Clear all plex cookies
  const containers = await browser.contextualIdentities.query({});
  containers.push({
    cookieStoreId: 'firefox-default'
  });
  containers.map(container => {
    const storeId = container.cookieStoreId;
    if (storeId === plexCookieStoreId) {
      // Don't clear cookies in the plex Container
      return;
    }

    PLEX_DOMAINS.map(async plexDomain => {
      const plexCookieUrl = `https://${plexDomain}/`;

      const cookies = await browser.cookies.getAll({
        domain: plexDomain,
        storeId
      });

      cookies.map(cookie => {
        browser.cookies.remove({
          name: cookie.name,
          url: plexCookieUrl,
          storeId
        });
      });
    });
  });
}

async function setupPlexContainer () {
  let currentSettings = await browser.storage.sync.get();
  // Use existing plex container, or create one
  const contexts = await browser.contextualIdentities.query({name: PLEX_CONTAINER_NAME})
  if (contexts.length > 0) {
    plexCookieStoreId = contexts[0].cookieStoreId;
    if (currentSettings.disable_plex) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(plexCookieStoreId);
    }
  } else {
    const context = await browser.contextualIdentities.create({
      name: PLEX_CONTAINER_NAME,
      color: PLEX_CONTAINER_COLOR,
      icon: PLEX_CONTAINER_ICON
    })
    plexCookieStoreId = context.cookieStoreId;
    if (currentSettings.disable_plex) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(plexCookieStoreId);
    }
  }
}

async function containplex (options) {
  // Listen to requests and open plex into its Container,
  // open other sites into the default tab context
  const requestUrl = new URL(options.url);

  let isplex = false;
  for (let plexHostRE of plexHostREs) {
    if (plexHostRE.test(requestUrl.host)) {
      isplex = true;
      break;
    }
  }

  // We have to check with every request if the requested URL is assigned with MAC
  // because the user can assign URLs at any given time (needs MAC Events)
  if (plexMacAddonEnabled) {
    const macAssigned = await Globals.getMACAssignment(options.url);
    if (macAssigned) {
      // This URL is assigned with MAC, so we don't handle this request
      return;
    }
  }

  const tab = await browser.tabs.get(options.tabId);
  const tabCookieStoreId = tab.cookieStoreId;
  if (isplex) {
    if (tabCookieStoreId !== plexCookieStoreId && !tab.incognito) {
      // See https://github.com/mozilla/contain-plex/issues/23
      // Sometimes this add-on is installed but doesn't get a plexCookieStoreId ?
      if (plexCookieStoreId) {
        if (Globals.shouldCancelEarly(tab, options)) {
          return {cancel: true};
        }
        browser.tabs.create({
          url: requestUrl.toString(),
          cookieStoreId: plexCookieStoreId,
          active: tab.active,
          index: tab.index,
          windowId: tab.windowId
        });
        browser.tabs.remove(options.tabId);
        return {cancel: true};
      }
    }
  } else {
    if (tabCookieStoreId === plexCookieStoreId) {
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
  await plexSetupMACAddonManagementListeners();
  plexMacAddonEnabled = await isPlexMACAddonEnabled();

  await setupPlexContainer();
  clearplexCookies();
  generateplexHostREs();

  // Check if the user has disabled the container
  let currentSettings = await browser.storage.sync.get();
  if (currentSettings.disable_plex) {
    return
  } else {
    // Add the request listener
    browser.webRequest.onBeforeRequest.addListener(containplex, {urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);

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
