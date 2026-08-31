# Demo video script (OAuth verification)

> **Status: preparation only.** This script assumes per-user Google sign-in is live, because the video has to show the real consent flow. It cannot be recorded against the shared-bearer-token deployment.

**What the video must satisfy:** show the OAuth consent flow with the app name and the client ID visible in the address bar, demonstrate the requested scope actually being used by a feature, and show where the data ends up. Unlisted YouTube upload, English narration or captions. Under five minutes is plenty.

Record at 1080p or higher so the consent screen text is legible. Use a property with nothing sensitive on screen — a test property is ideal, and avoid showing client data.

## Shot list

**1. Identity (20s).**
Show the GitHub repository page. Say: "gsc-mcp-remote is an open-source MCP server that lets an AI assistant answer questions about the user's own Google Search Console data. It can be self-hosted, and this is the hosted instance."

**2. Connecting (30s).**
In Claude, add the connector by URL. Show the connector appearing and the prompt to sign in. Say: "Each user connects their own Google account. The service holds no access of its own."

**3. Consent flow (60s).**
The browser opens on Google's account picker, then the consent screen. **Pause here** so three things are clearly readable: the app name as it appears on the consent screen, the single requested permission ("View Search Console data for your verified sites"), and the `client_id` parameter in the address bar. Approve, and show the redirect back to a success page.

**4. The scope in use (90s).**
Back in Claude, ask: *"What Search Console properties do I have?"* — show the property list returning. Then ask: *"What are my quick-win keywords for the first one?"* — show the response rendering real Search Console data. Say: "This is the webmasters.readonly scope: `sites.list` so the user can choose a property, and search analytics queries for that property, fetched on demand in response to the user's question and shown only to them."

Optionally also show *"Is this URL indexed?"* to demonstrate the URL Inspection call under the same scope.

**5. Read-only, and revocable (40s).**
Say: "The service requests only the read-only scope, so it cannot submit URLs, change sitemaps, or modify anything in the account." Then show the disconnect control in the service, and say the stored token is deleted on disconnect. Finally show myaccount.google.com/permissions and the app listed there, saying access can be revoked from Google's side at any time.

**6. Data handling (30s).**
State plainly, over the privacy policy page: "The user's refresh token is stored on the server, encrypted at rest, and used only to answer that user's own requests. Search Console responses are returned to the user and not retained. Nothing is sold, used for advertising, or used to train models."

Do not claim the developer receives no data — for a hosted service that is untrue, and the reviewer is checking the hosted story specifically.

## Upload

YouTube, **Unlisted**, titled something like "gsc-mcp-remote: OAuth verification demo". Paste the URL into the verification form.
