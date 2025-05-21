// Stuff that's shared between all containers
const MAC_ADDON_ID = "@testpilot-containers";
const canceledRequests = {};
let extensionSettings = {};

// Used in Globals.shouldCancelEarly
function cancelRequest (tab, options) {
  // we decided to cancel the request at this point, register canceled request
  canceledRequests[tab.id] = {
    requestIds: {
      [options.requestId]: true
    },
    urls: {
      [options.url]: true
    }
  };

  // since webRequest onCompleted and onErrorOccurred are not 100% reliable
  // we register a timer here to cleanup canceled requests, just to make sure we don't
  // end up in a situation where certain urls in a tab.id stay canceled
  setTimeout(() => {
    if (canceledRequests[tab.id]) {
      delete canceledRequests[tab.id];
    }
  }, 2000);
}

async function loadExtensionSettings () {
  extensionSettings = await browser.storage.sync.get();
  if (extensionSettings.whitelist === undefined){
 	extensionSettings.whitelist = "";
  }
  if (extensionSettings.allowlist === undefined){
 	extensionSettings.allowlist = "";
  }
}

// Global functions for each container to invoke
Globals = {
  loadExtensionSettings: loadExtensionSettings,

  getMACAssignment: async function getMACAssignment (url) {
    try {
      const assignment = await browser.runtime.sendMessage(MAC_ADDON_ID, {
        method: "getAssignment",
        url
      });
      return assignment;
    } catch (e) {
      return false;
    }
  },

  shouldCancelEarly: function shouldCancelEarly (tab, options) {
    // we decided to cancel the request at this point
    if (!canceledRequests[tab.id]) {
      cancelRequest(tab, options);
    } else {
      let cancelEarly = false;
      if (canceledRequests[tab.id].requestIds[options.requestId] ||
          canceledRequests[tab.id].urls[options.url]) {
        // same requestId or url from the same tab
        // this is a redirect that we have to cancel early to prevent opening two tabs
        cancelEarly = true;
      }
      // register this requestId and url as canceled too
      canceledRequests[tab.id].requestIds[options.requestId] = true;
      canceledRequests[tab.id].urls[options.url] = true;
      if (cancelEarly) {
        return true;
      }
    }
    return false;
  }
}
