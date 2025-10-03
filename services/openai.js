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
  const requestUrl = new URL(options.url);

  let isOPENAI = false;
  for (let OPENAIHostRE of OPENAIHostREs) {
    if (OPENAIHostRE.test(requestUrl.host)) {
      isOPENAI = true;
      break;
    }
  }

  // If MAC has an assignment for this URL, let MAC handle it
  if (OPENAIMacAddonEnabled) {
    const macAssigned = await Globals.getMACAssignment(options.url);
    if (macAssigned) return;
  }

  const tab = await browser.tabs.get(options.tabId);
  const tabCookieStoreId = tab.cookieStoreId;

  if (isOPENAI) {
    // Enforce: OpenAI → must live in the OpenAI container
    if (tabCookieStoreId !== OPENAICookieStoreId && !tab.incognito && OPENAICookieStoreId) {
      if (Globals.shouldCancelEarly(tab, options)) return { cancel: true };

      browser.tabs.create({
        url: requestUrl.toString(),
        cookieStoreId: OPENAICookieStoreId,
        active: tab.active,
        index: tab.index,
        windowId: tab.windowId
      });
      browser.tabs.remove(options.tabId);
      return { cancel: true };
    }
    // already in the right container → allow
    return;
  }

  // Not an OpenAI domain:
  // Old code forcibly moved these out of the OpenAI container.
  // We *don’t* do that anymore so that auth redirects (Google/Apple/etc.)
  // work seamlessly. Just allow the request.
  return;
}

// --- keep your init() mostly the same ---
(async function init() {
  await OPENAISetupMACAddonManagementListeners();
  OPENAIMacAddonEnabled = await isOPENAIMACAddonEnabled();

  await setupOPENAIContainer();
  clearOPENAICookies();
  generateOPENAIHostREs();

  const currentSettings = await browser.storage.sync.get();
  if (currentSettings.disable_OPENAI) return;

  browser.webRequest.onBeforeRequest.addListener(
    containOPENAI,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"]
  );

  // (Optional) Your cleanup listeners can remain as-is
})();
