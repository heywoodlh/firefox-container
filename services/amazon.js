// Param values from https://developer.mozilla.org/Add-ons/WebExtensions/API/contextualIdentities/create
const AMAZON_CONTAINER_NAME = "Amazon";
const AMAZON_CONTAINER_COLOR = "yellow";
const AMAZON_CONTAINER_ICON = "briefcase";
let AMAZON_DOMAINS = ["byamazon.com", "pscdn.co", "scdn.co", "spoti.fi", "amazon-everywhere.com", "amazon.com", "amazon.design", "amazoncdn.com", "amazoncdn.net", "amazoncharts.com", "amazoncodes.com", "amazonforbrands.com", "amazonjobs.com", "amazon.link"]; // https://github.com/v2ray/domain-list-community/blob/master/data/amazon
const AMAZON_RELATED_DOMAINS = ["audio-ak-amazon-com.akamaized.net", "audio4-ak-amazon-com.akamaized.net", "cdn-amazon-experiments.conductrics.com", "heads-ak-amazon-com.akamaized.net", "heads4-ak-amazon-com.akamaized.net", "amazon.com.edgesuite.net", "amazon.map.fastly.net", "amazon.map.fastlylb.net"];

AMAZON_DOMAINS = AMAZON_DOMAINS.concat(AMAZON_RELATED_DOMAINS);

let amazonMacAddonEnabled = false;
let amazonCookieStoreId = null;
let amazonCookiesCleared = false;

const amazonHostREs = [];

async function isAmazonMACAddonEnabled () {
  try {
    const amazonMacAddonInfo = await browser.management.get(MAC_ADDON_ID);
    if (amazonMacAddonInfo.enabled) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function amazonSetupMACAddonManagementListeners () {
  browser.management.onInstalled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      amazonMacAddonEnabled = true;
    }
  });
  browser.management.onUninstalled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      amazonMacAddonEnabled = false;
    }
  })
  browser.management.onEnabled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      amazonMacAddonEnabled = true;
    }
  })
  browser.management.onDisabled.addListener(info => {
    if (info.id === MAC_ADDON_ID) {
      amazonMacAddonEnabled = false;
    }
  })
}

function generateamazonHostREs () {
  for (let amazonDomain of AMAZON_DOMAINS) {
    amazonHostREs.push(new RegExp(`^(.*\\.)?${amazonDomain}$`));
  }
}

async function clearamazonCookies () {
  // Clear all amazon cookies
  const containers = await browser.contextualIdentities.query({});
  containers.push({
    cookieStoreId: 'firefox-default'
  });
  containers.map(container => {
    const storeId = container.cookieStoreId;
    if (storeId === amazonCookieStoreId) {
      // Don't clear cookies in the amazon Container
      return;
    }

    AMAZON_DOMAINS.map(async amazonDomain => {
      const amazonCookieUrl = `https://${amazonDomain}/`;

      const cookies = await browser.cookies.getAll({
        domain: amazonDomain,
        storeId
      });

      cookies.map(cookie => {
        browser.cookies.remove({
          name: cookie.name,
          url: amazonCookieUrl,
          storeId
        });
      });
    });
  });
}

async function setupAmazonContainer () {
  let currentSettings = await browser.storage.sync.get();
  // Use existing amazon container, or create one
  const contexts = await browser.contextualIdentities.query({name: AMAZON_CONTAINER_NAME})
  if (contexts.length > 0) {
    amazonCookieStoreId = contexts[0].cookieStoreId;
    // Check if the user has disabled the container
    if (currentSettings.disable_amazon) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(amazonCookieStoreId);
    }
  } else {
    const context = await browser.contextualIdentities.create({
      name: AMAZON_CONTAINER_NAME,
      color: AMAZON_CONTAINER_COLOR,
      icon: AMAZON_CONTAINER_ICON
    })
    amazonCookieStoreId = context.cookieStoreId;
    if (currentSettings.disable_amazon) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(amazonCookieStoreId);
    }
  }
}

async function containamazon (options) {
  // Listen to requests and open amazon into its Container,
  // open other sites into the default tab context
  const requestUrl = new URL(options.url);

  let isamazon = false;
  for (let amazonHostRE of amazonHostREs) {
    if (amazonHostRE.test(requestUrl.host)) {
      isamazon = true;
      break;
    }
  }

  // We have to check with every request if the requested URL is assigned with MAC
  // because the user can assign URLs at any given time (needs MAC Events)
  if (amazonMacAddonEnabled) {
    const macAssigned = await Globals.getMACAssignment(options.url);
    if (macAssigned) {
      // This URL is assigned with MAC, so we don't handle this request
      return;
    }
  }

  const tab = await browser.tabs.get(options.tabId);
  const tabCookieStoreId = tab.cookieStoreId;
  if (isamazon) {
    if (tabCookieStoreId !== amazonCookieStoreId && !tab.incognito) {
      // See https://github.com/mozilla/contain-amazon/issues/23
      // Sometimes this add-on is installed but doesn't get a amazonCookieStoreId ?
      if (amazonCookieStoreId) {
        if (Globals.shouldCancelEarly(tab, options)) {
          return {cancel: true};
        }
        browser.tabs.create({
          url: requestUrl.toString(),
          cookieStoreId: amazonCookieStoreId,
          active: tab.active,
          index: tab.index,
          windowId: tab.windowId
        });
        browser.tabs.remove(options.tabId);
        return {cancel: true};
      }
    }
  } else {
    if (tabCookieStoreId === amazonCookieStoreId) {
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
  await amazonSetupMACAddonManagementListeners();
  amazonMacAddonEnabled = await isAmazonMACAddonEnabled();

  Globals.loadExtensionSettings();
  await setupAmazonContainer();
  clearamazonCookies();
  generateamazonHostREs();

  // Do nothing if the user has disabled the container
  let currentSettings = await browser.storage.sync.get();
  if (currentSettings.disable_amazon) {
    return
  } else {
    browser.webRequest.onBeforeRequest.addListener(containamazon, {urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);

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
