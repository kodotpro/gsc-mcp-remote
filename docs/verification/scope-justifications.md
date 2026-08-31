# Scope justifications for the verification form

> **Status: preparation only.** Finalise once per-user OAuth ships and the hosted deployment is live. Keep the app description consistent with the consent screen name and the privacy policy page — reviewers cross-check them.

## App description (used across the form)

gsc-mcp-remote is an open-source MCP (Model Context Protocol) server that lets a user's AI assistant answer questions about the user's own Google Search Console data: quick-win keywords, traffic drops, content decay, keyword cannibalisation, CTR benchmarks, image-search performance, and similar analyses.

It can be self-hosted by the user, and is also offered as a hosted instance. In the hosted case each user signs in with their own Google account, and the server acts only on that user's behalf: Google's own Search Console property permissions decide what each user can see, and the service grants no access of its own.

Data handling in the hosted deployment: the user's Google refresh token is stored server-side, encrypted at rest, and used solely to call Google's Search Console API in response to a request that user made. Search Console responses are returned to the requesting user and not retained afterwards. Tokens are deleted when the user disconnects. No Google user data is sold, used for advertising, or used to train models, and none is shared with third parties.

Source code: https://github.com/kodotpro/gsc-mcp-remote

The hosted service requests **only the read-only scope**. It cannot modify anything in a user's Search Console account.

## https://www.googleapis.com/auth/webmasters.readonly

The only scope requested. It powers every tool in the hosted service:

- **Search analytics** (`searchanalytics.query`) — keyword, page, device, country and image-search reports, which are the substance of every analysis tool
- **`sites.list`** — so the user can see and choose which of their own verified properties to analyse. Without it the assistant cannot tell the user what is available and the user must type exact property identifiers by hand
- **`sitemaps.list`** — to report sitemap status, errors and indexed counts
- **URL Inspection** (`urlInspection.index.inspect`) — to answer whether a specific page of the user's own site is indexed, and if not, why

Every call is made on demand, in direct response to a question the user asked their assistant, and the result is returned to that user.

## Why a narrower scope is insufficient

There is no narrower Search Console scope. `webmasters.readonly` is already the minimum-privilege option: it is read-only and cannot submit sitemaps, request indexing, or change any setting. The two write scopes (`webmasters`, `indexing`) exist in the codebase for self-hosted users who opt into them locally, and are deliberately **not** requested by the hosted service.

## Limited Use statement (also on the privacy policy page)

The app's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

Specifically: Google user data is used only to provide the features the user requested; it is not transferred to third parties except as necessary to provide those features, to comply with applicable law, or as part of a merger or acquisition with user notice; it is not used for advertising; it is not used to train generalised machine-learning models; and no humans read it except with the user's explicit consent, for security purposes, to comply with applicable law, or where the data has been aggregated and anonymised.

Stored data is limited to the OAuth refresh token needed to keep the connection working, held encrypted at rest and deleted when the user disconnects.
