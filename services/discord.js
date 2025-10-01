// Param values from https://developer.mozilla.org/Add-ons/WebExtensions/API/contextualIdentities/create
const DISCORD_CONTAINER_NAME = "Discord";
const DISCORD_CONTAINER_COLOR = "blue";
// const icons = ["fingerprint", "briefcase", "dollar", "cart", "vacation", "gift", "food", "fruit", "pet", "tree", "chill", "circle"];
const DISCORD_CONTAINER_ICON = "circle";
let DISCORD_DOMAINS = ["discord.gg", "discord.com", "discordapp.com", "discord.media", "discordapp.net", "discordcdn.com", "discord.dev", "discord.new", "discord.gift", "discordstatus.com", "dis.gd", "discord.co"]; // https://gist.github.com/GodderE2D/26a39d654cfd2f2ba225bae6f1fa2d7a

let DISCORDMacAddonEnabled = false;
let DISCORDCookieStoreId = null;
let DISCORDCookiesCleared = false;

const DISCORDHostREs = [];

async function isDISCORDMACAddonEnabled () {
  try {
    const DISCORDMacAddonInfo = await browser.management.get(MAC_ADDON_ID);
    if (DISCORDMacAddonInfo.enabled) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function DISCORDSetupMACAddonManagementListeners () {
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

function generateDISCORDHostREs () {
  for (let DISCORDDomain of DISCORD_DOMAINS) {
    DISCORDHostREs.push(new RegExp(`^(.*\\.)?${DISCORDDomain}$`));
  }
}

async function clearDISCORDCookies () {
  // Clear all DISCORD cookies
  const containers = await browser.contextualIdentities.query({});
  containers.push({
    cookieStoreId: 'firefox-default'
  });
  containers.map(container => {
    const storeId = container.cookieStoreId;
    if (storeId === DISCORDCookieStoreId) {
      // Don't clear cookies in the DISCORD Container
      return;
    }

    DISCORD_DOMAINS.map(async DISCORDDomain => {
      const DISCORDCookieUrl = `https://${DISCORDDomain}/`;

      const cookies = await browser.cookies.getAll({
        domain: DISCORDDomain,
        storeId
      });

      cookies.map(cookie => {
        browser.cookies.remove({
          name: cookie.name,
          url: DISCORDCookieUrl,
          storeId
        });
      });
    });
  });
}

async function setupDISCORDContainer () {
  let currentSettings = await browser.storage.sync.get();
  // Use existing DISCORD container, or create one
  const contexts = await browser.contextualIdentities.query({name: DISCORD_CONTAINER_NAME})
  if (contexts.length > 0) {
    DISCORDCookieStoreId = contexts[0].cookieStoreId;
    if (currentSettings.disable_DISCORD) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(DISCORDCookieStoreId);
    }
  } else {
    const context = await browser.contextualIdentities.create({
      name: DISCORD_CONTAINER_NAME,
      color: DISCORD_CONTAINER_COLOR,
      icon: DISCORD_CONTAINER_ICON
    })
    DISCORDCookieStoreId = context.cookieStoreId;
    if (currentSettings.disable_DISCORD) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(DISCORDCookieStoreId);
    }
  }
}

async function containDISCORD (options) {
  // Listen to requests and open DISCORD into its Container,
  // open other sites into the default tab context
  const requestUrl = new URL(options.url);

  let isDISCORD = false;
  for (let DISCORDHostRE of DISCORDHostREs) {
    if (DISCORDHostRE.test(requestUrl.host)) {
      isDISCORD = true;
      break;
    }
  }

  // We have to check with every request if the requested URL is assigned with MAC
  // because the user can assign URLs at any given time (needs MAC Events)
  if (DISCORDMacAddonEnabled) {
    const macAssigned = await Globals.getMACAssignment(options.url);
    if (macAssigned) {
      // This URL is assigned with MAC, so we don't handle this request
      return;
    }
  }

  const tab = await browser.tabs.get(options.tabId);
  const tabCookieStoreId = tab.cookieStoreId;
  if (isDISCORD) {
    if (tabCookieStoreId !== DISCORDCookieStoreId && !tab.incognito) {
      // See https://github.com/mozilla/contain-DISCORD/issues/23
      // Sometimes this add-on is installed but doesn't get a DISCORDCookieStoreId ?
      if (DISCORDCookieStoreId) {
        if (Globals.shouldCancelEarly(tab, options)) {
          return {cancel: true};
        }
        browser.tabs.create({
          url: requestUrl.toString(),
          cookieStoreId: DISCORDCookieStoreId,
          active: tab.active,
          index: tab.index,
          windowId: tab.windowId
        });
        browser.tabs.remove(options.tabId);
        return {cancel: true};
      }
    }
  } else {
    if (tabCookieStoreId === DISCORDCookieStoreId) {
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
  await DISCORDSetupMACAddonManagementListeners();
  DISCORDMacAddonEnabled = await isDISCORDMACAddonEnabled();

  await setupDISCORDContainer();
  clearDISCORDCookies();
  generateDISCORDHostREs();


  // Do nothing if the user has disabled the container
  let currentSettings = await browser.storage.sync.get();
  if (currentSettings.disable_DISCORD) {
    return
  } else {
    // Add the request listener
    browser.webRequest.onBeforeRequest.addListener(containDISCORD, {urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);

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
