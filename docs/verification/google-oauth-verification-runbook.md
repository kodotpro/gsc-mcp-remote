# Google OAuth verification runbook

> **Status: preparation only.** These notes are for the milestone where the public instance opens to people outside a hand-picked test group. Finalise them *after* per-user OAuth ships — the demo video has to show the real sign-in flow, and Google will not review an app that does not exist yet. Adapted from the equivalent notes in the upstream project, then rewritten for a **hosted** service, which changes the data-handling story materially.

**Goal:** an OAuth app in *In production* status, verified for the Search Console sensitive scope, so that anyone can sign in without a "Google hasn't verified this app" warning and without the 100-user cap.

## Why this is needed at all

While the app sits in **Testing** status:

- it is capped at **100 manually-listed test users**
- refresh tokens expire after **7 days**, so every user re-consents weekly
- every user sees an unverified-app interstitial

All three lift only by publishing to production, which for a sensitive scope requires passing review. Verification cannot be done first: Google requires a live homepage, a privacy policy on the same domain, and a demo video of the real consent flow. Testing status is therefore the mandatory beta stage, not a fallback.

**Good news:** Search Console scopes are classified **sensitive**, not **restricted**. There is no third-party CASA security assessment, so the cost is paperwork and waiting rather than money.

## Status tracker

| Step | State |
|---|---|
| 1. Dedicated Cloud project | not started |
| 2. Enable APIs | not started |
| 3. Consent screen + branding | not started |
| 4. Add scopes | not started |
| 5. Create the OAuth client | not started |
| 6. Privacy policy page | not started |
| 7. Record demo video | blocked on per-user OAuth shipping |
| 8. Submit for verification | blocked on 1–7 |
| 9. Publish and drop the cap | blocked on 8 |

## 1. Create a dedicated project

console.cloud.google.com → project picker → New project.

- Name: something matching the public app name
- Keep it separate from any project holding unrelated service accounts or data exports, so verification, quota and any future incident stay isolated

## 2. Enable APIs

APIs & Services → Library:

- **Google Search Console API** — required
- **Web Search Indexing API** — only if the write tools are ever exposed remotely. They are not in v1, so leave it disabled; fewer scopes is a simpler review.

## 3. Consent screen (Google Auth Platform → Branding)

- **App name:** must not contain the word "Google" — that fails branding review
- **User support email:** an address actually monitored
- **App home page:** a real page describing the service, on the domain the service runs on
- **Privacy policy:** on the same domain, live before submission (step 6)
- **Authorised domain:** the service's domain. Verify it in Search Console first, which makes this instant
- **Audience:** External. Start in Testing with your own account, switch to In production when submitting

## 4. Scopes

Google Auth Platform → Data access → Add or remove scopes.

| Scope | Classification | In v1? |
|---|---|---|
| `https://www.googleapis.com/auth/webmasters.readonly` | sensitive | **yes** |
| `https://www.googleapis.com/auth/webmasters` | sensitive | no |
| `https://www.googleapis.com/auth/indexing` | sensitive | no |

**Request only `webmasters.readonly`.** Remote mode is read-only by design, and a single sensitive scope is the simplest possible review. The trade-off to be aware of: adding a scope later **restarts** review, so if write features are genuinely planned for the hosted service, it is cheaper to submit all three at once. Decide before submitting.

## 5. Create the OAuth client

APIs & Services → Credentials → Create credentials → OAuth client ID.

- Application type: **Web application** (not Desktop — the server runs the flow, not a local binary)
- Authorised redirect URI: the deployment's callback path, e.g. `https://gsc.example.com/oauth/google/callback`

The client ID and secret become server-side environment variables. Unlike a desktop client, a web client secret **is** confidential — it must never be committed or shipped to a client.

## 6. Privacy policy page

Must be reachable on the app's own domain, and must:

- name the app exactly as it appears on the consent screen
- state what Google data is accessed, why, and how long it is kept
- carry the Limited Use disclosure verbatim (see `scope-justifications.md`)

**This is where a hosted service differs sharply from a local one.** A local MCP server can honestly say the developer operates no servers and receives no data. A hosted one cannot. The page must state plainly that:

- Google refresh tokens are stored **server-side**, encrypted at rest
- Search Console data is fetched on demand to answer a request and is not retained afterwards
- users can disconnect at any time, which deletes their stored token, and can also revoke at myaccount.google.com/permissions
- data is never sold, never used for advertising, and never used to train models

Writing anything weaker than the truth here is a false statement to a reviewer, and the review does check.

## 7. Demo video

Record per `demo-video-script.md`. Unlisted YouTube upload. It must show the real consent flow with the app name and client ID visible, and each requested scope actually being used.

## 8. Submit

Google Auth Platform → Verification Centre (appears once the app is In production with sensitive scopes). Provide the scope justifications from `scope-justifications.md`, the demo video URL, and confirmation of Limited Use compliance.

Then watch the developer contact inbox. Reviewers reply by email, sometimes with clarifying questions, and the clock resets while replies sit unanswered. Google documents 3–5 business days; in practice, expect longer once revisions start.

## 9. After approval

1. Switch the app to In production if not already
2. Remove any test-user gating and the 100-user cap workarounds
3. Confirm refresh tokens no longer carry the 7-day expiry
4. Only then advertise the hosted instance publicly

## Constraints to remember

- **Quota is per project.** Every user of the hosted instance draws from this project's Search Console quota. Search Analytics ceilings are generous (1,200 queries/min per property, 30M/day per project) but URL Inspection is tight at **2,000/day per property**. Add per-user rate limits before opening signups, and watch APIs & Services → Quotas.
- **Annual reverification.** Google re-reviews sensitive-scope apps yearly, and whenever scopes change.
- **Self-hosting stays the escape hatch.** Anyone can run their own instance with their own OAuth client and needs no verification at all. Keep that path documented — it is also the honest answer for anyone uncomfortable with a third party holding their token.
