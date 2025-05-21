## Heywoodlh Container for Firefox

A Firefox Extension for isolating multiple services in one extension. The following services have been implemented:
- [Amazon](./services/amazon.js)
- [Google](./services/google.js)
- [Plex](./services/plex.js)
- [Reddit](./services/reddit.js)
- [Spotify](./services/spotify.js)

Specifically, my priority are services I use that are often allergic to user privacy.

## Background

I initially wrote this when I realized the [Reddit Container extension](https://addons.mozilla.org/en-US/firefox/addon/reddit-container/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search) didn't have links that worked for me to investigate the source code of the extension for any malicious activity. I eventually extracted the extension archive, found nothing malicious, but realized I could probably implement this myself and keep the source code open and accessible for review.

## Kudos

Just wanted to credit the following since this extension is built on their work:
- [Facebook Container by Mozilla](https://github.com/mozilla/contain-facebook)
- [Google Container](https://github.com/containers-everywhere/contain-google)
- [Reddit Container](https://addons.mozilla.org/en-US/firefox/addon/reddit-container/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search)
