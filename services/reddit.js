// Param values from https://developer.mozilla.org/Add-ons/WebExtensions/API/contextualIdentities/create
const REDDIT_CONTAINER_NAME = "Reddit";
const REDDIT_CONTAINER_COLOR = "orange";
const REDDIT_CONTAINER_ICON = "briefcase";
let REDDIT_DOMAINS = ["reddit.com", "redditstatic.com", "redd.it", "redditmedia.com", "redditspace.com"]; //https://www.netify.ai/resources/applications/reddit
const REDDIT_RELATED_DOMAINS = ["imgur.com", "gfycat.com", "vidble.com"];

REDDIT_DOMAINS = REDDIT_DOMAINS.concat(REDDIT_RELATED_DOMAINS);

let redditMacAddonEnabled = false;
let redditCookieStoreId = null;
let redditCookiesCleared = false;

const redditHostREs = [];

async function isRedditMACAddonEnabled () {
  try {
    const redditMacAddonInfo = await browser.management.get(MAC_ADDON_ID);
    if (redditMacAddonInfo.enabled) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function redditSetupMACAddonManagementListeners () {
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

function generateredditHostREs () {
  for (let redditDomain of REDDIT_DOMAINS) {
    redditHostREs.push(new RegExp(`^(.*\\.)?${redditDomain}$`));
  }
}

async function clearredditCookies () {
  // Clear all reddit cookies
  const containers = await browser.contextualIdentities.query({});
  containers.push({
    cookieStoreId: 'firefox-default'
  });
  containers.map(container => {
    const storeId = container.cookieStoreId;
    if (storeId === redditCookieStoreId) {
      // Don't clear cookies in the reddit Container
      return;
    }

    REDDIT_DOMAINS.map(async redditDomain => {
      const redditCookieUrl = `https://${redditDomain}/`;

      const cookies = await browser.cookies.getAll({
        domain: redditDomain,
        storeId
      });

      cookies.map(cookie => {
        browser.cookies.remove({
          name: cookie.name,
          url: redditCookieUrl,
          storeId
        });
      });
    });
  });
}

async function setupRedditContainer () {
  let currentSettings = await browser.storage.sync.get();
  // Use existing reddit container, or create one
  const contexts = await browser.contextualIdentities.query({name: REDDIT_CONTAINER_NAME})
  if (contexts.length > 0) {
    redditCookieStoreId = contexts[0].cookieStoreId;
    if (currentSettings.disable_reddit) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(redditCookieStoreId);
    }
  } else {
    const context = await browser.contextualIdentities.create({
      name: REDDIT_CONTAINER_NAME,
      color: REDDIT_CONTAINER_COLOR,
      icon: REDDIT_CONTAINER_ICON
    })
    redditCookieStoreId = context.cookieStoreId;
    if (currentSettings.disable_reddit) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(redditCookieStoreId);
    }
  }
}

async function containreddit (options) {
  // Listen to requests and open reddit into its Container,
  // open other sites into the default tab context
  const requestUrl = new URL(options.url);

  let isreddit = false;
  for (let redditHostRE of redditHostREs) {
    if (redditHostRE.test(requestUrl.host)) {
      isreddit = true;
      break;
    }
  }

  // We have to check with every request if the requested URL is assigned with MAC
  // because the user can assign URLs at any given time (needs MAC Events)
  if (redditMacAddonEnabled) {
    const macAssigned = await Globals.getMACAssignment(options.url);
    if (macAssigned) {
      // This URL is assigned with MAC, so we don't handle this request
      return;
    }
  }

  const tab = await browser.tabs.get(options.tabId);
  const tabCookieStoreId = tab.cookieStoreId;
  if (isreddit) {
    if (tabCookieStoreId !== redditCookieStoreId && !tab.incognito) {
      // See https://github.com/mozilla/contain-reddit/issues/23
      // Sometimes this add-on is installed but doesn't get a redditCookieStoreId ?
      if (redditCookieStoreId) {
        if (Globals.shouldCancelEarly(tab, options)) {
          return {cancel: true};
        }
        browser.tabs.create({
          url: requestUrl.toString(),
          cookieStoreId: redditCookieStoreId,
          active: tab.active,
          index: tab.index,
          windowId: tab.windowId
        });
        browser.tabs.remove(options.tabId);
        return {cancel: true};
      }
    }
  } else {
    if (tabCookieStoreId === redditCookieStoreId) {
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
  await redditSetupMACAddonManagementListeners();
  redditMacAddonEnabled = await isRedditMACAddonEnabled();

  await setupRedditContainer();
  clearredditCookies();
  generateredditHostREs();

  // Do nothing if the user has disabled the container
  let currentSettings = await browser.storage.sync.get();
  if (currentSettings.disable_reddit) {
    return
  } else {
    // Add the request listener
    browser.webRequest.onBeforeRequest.addListener(containreddit, {urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);

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
