// Param values from https://developer.mozilla.org/Add-ons/WebExtensions/API/contextualIdentities/create
const OPENAI_CONTAINER_NAME = "OpenAI";
const OPENAI_CONTAINER_COLOR = "green";
// const icons = ["fingerprint", "briefcase", "dollar", "cart", "vacation", "gift", "food", "fruit", "pet", "tree", "chill", "circle"];
const OPENAI_CONTAINER_ICON = "circle";
// https://github.com/v2fly/domain-list-community/blob/master/data/openai
let OPENAI_DOMAINS = ["chatgpt.com", "chat.com", "oaistatic.com", "oaiusercontent.com", "openai.com", "sora.com", "openai.com.cdn.cloudflare.net", "openaiapi-site.azureedge.net", "openaicom-api-bdcpf8c6d2e9atf6.z01.azurefd.net", "openaicomproductionae4b.blob.core.windows.net", "production-openaicom-storage.azureedge.net", "chatgpt.livekit.cloud", "host.livekit.cloud", "turn.livekit.cloud"];

let OPENAIMacAddonEnabled = false;
let OPENAICookieStoreId = null;
let OPENAICookiesCleared = false;

const OPENAIHostREs = [];

async function isOPENAIMACAddonEnabled () {
  try {
    const OPENAIMacAddonInfo = await browser.management.get(MAC_ADDON_ID);
    if (OPENAIMacAddonInfo.enabled) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function OPENAISetupMACAddonManagementListeners () {
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

function generateOPENAIHostREs () {
  for (let OPENAIDomain of OPENAI_DOMAINS) {
    OPENAIHostREs.push(new RegExp(`^(.*\\.)?${OPENAIDomain}$`));
  }
}

async function clearOPENAICookies () {
  // Clear all OPENAI cookies
  const containers = await browser.contextualIdentities.query({});
  containers.push({
    cookieStoreId: 'firefox-default'
  });
  containers.map(container => {
    const storeId = container.cookieStoreId;
    if (storeId === OPENAICookieStoreId) {
      // Don't clear cookies in the OPENAI Container
      return;
    }

    OPENAI_DOMAINS.map(async OPENAIDomain => {
      const OPENAICookieUrl = `https://${OPENAIDomain}/`;

      const cookies = await browser.cookies.getAll({
        domain: OPENAIDomain,
        storeId
      });

      cookies.map(cookie => {
        browser.cookies.remove({
          name: cookie.name,
          url: OPENAICookieUrl,
          storeId
        });
      });
    });
  });
}

async function setupOPENAIContainer () {
  let currentSettings = await browser.storage.sync.get();
  // Use existing OPENAI container, or create one
  const contexts = await browser.contextualIdentities.query({name: OPENAI_CONTAINER_NAME})
  if (contexts.length > 0) {
    OPENAICookieStoreId = contexts[0].cookieStoreId;
    if (currentSettings.disable_OPENAI) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(OPENAICookieStoreId);
    }
  } else {
    const context = await browser.contextualIdentities.create({
      name: OPENAI_CONTAINER_NAME,
      color: OPENAI_CONTAINER_COLOR,
      icon: OPENAI_CONTAINER_ICON
    })
    OPENAICookieStoreId = context.cookieStoreId;
    if (currentSettings.disable_OPENAI) {
      // Remove the container
      const context = await browser.contextualIdentities.remove(OPENAICookieStoreId);
    }
  }
}

async function containOPENAI (options) {
  // Listen to requests and open OPENAI into its Container,
  // open other sites into the default tab context
  const requestUrl = new URL(options.url);

  let isOPENAI = false;
  for (let OPENAIHostRE of OPENAIHostREs) {
    if (OPENAIHostRE.test(requestUrl.host)) {
      isOPENAI = true;
      break;
    }
  }

  // We have to check with every request if the requested URL is assigned with MAC
  // because the user can assign URLs at any given time (needs MAC Events)
  if (OPENAIMacAddonEnabled) {
    const macAssigned = await Globals.getMACAssignment(options.url);
    if (macAssigned) {
      // This URL is assigned with MAC, so we don't handle this request
      return;
    }
  }

  const tab = await browser.tabs.get(options.tabId);
  const tabCookieStoreId = tab.cookieStoreId;
  if (isOPENAI) {
    if (tabCookieStoreId !== OPENAICookieStoreId && !tab.incognito) {
      // See https://github.com/mozilla/contain-OPENAI/issues/23
      // Sometimes this add-on is installed but doesn't get a OPENAICookieStoreId ?
      if (OPENAICookieStoreId) {
        if (Globals.shouldCancelEarly(tab, options)) {
          return {cancel: true};
        }
        browser.tabs.create({
          url: requestUrl.toString(),
          cookieStoreId: OPENAICookieStoreId,
          active: tab.active,
          index: tab.index,
          windowId: tab.windowId
        });
        browser.tabs.remove(options.tabId);
        return {cancel: true};
      }
    }
  } else {
    if (tabCookieStoreId === OPENAICookieStoreId) {
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
  await OPENAISetupMACAddonManagementListeners();
  OPENAIMacAddonEnabled = await isOPENAIMACAddonEnabled();

  await setupOPENAIContainer();
  clearOPENAICookies();
  generateOPENAIHostREs();


  // Do nothing if the user has disabled the container
  let currentSettings = await browser.storage.sync.get();
  if (currentSettings.disable_OPENAI) {
    return
  } else {
    // Add the request listener
    browser.webRequest.onBeforeRequest.addListener(containOPENAI, {urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);

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
