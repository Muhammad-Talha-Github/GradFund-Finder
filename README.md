# GradFund Finder

Next.js App Router, TypeScript, Tailwind CSS, DaisyUI and MySQL 8.4. The dashboard searches saved database opportunities only. Internet collection runs separately with `npm run collect`; its fixed Master's and PhD search queries are defined in `scripts/collect.ts`. Crawlee/Cheerio follows a bounded set of relevant public HTML links, and optional Gemini extraction remains server-side.

## Local setup

1. Install Node.js 20.19+ or 22.12+ and Docker Desktop.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`. Set MySQL credentials and make `DATABASE_URL` match `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD`. Set `TAVILY_API_KEY` for online collection. For optional Gemini extraction, set `EXTRACTION_PROVIDER=gemini` and `GEMINI_API_KEY`. Gemini defaults to `gemini-3.5-flash-lite`; set `GEMINI_MODEL` to another model available to your key if needed.
4. Run `npm run db:setup`. This starts MySQL and initializes the schema. On an existing database it removes the retired `Source` and `DiscoveryQuery` tables and their obsolete ID columns; it preserves opportunities, their collected source URLs, candidate history, discovered URLs, drafts, and run history.
5. Run `npm run dev` and open http://localhost:3000.

## Accounts and sign-in

The dashboard requires an account. Open `/signup` to create one with a username, email, and password (at least 10 characters), then use `/login` to sign in. The username appears in the dashboard greeting and sidebar. Sessions use an HTTP-only cookie backed by MySQL and expire after 30 days; use **Log out** in the sidebar to revoke the current session.

Run `npm run db:auth` before signing up so the additive `AppUser`, `AppSession`, and `UserSavedOpportunity` tables and per-user ownership columns exist. This focused migration does not remove or rewrite existing records or unrelated tables. Existing opportunities remain shared. On the first account only, existing unowned email drafts, email settings, Gmail connection, and legacy saved-opportunity flags are assigned to that account; subsequent accounts receive separate drafts, settings, Gmail connections, and saved lists. The app does not yet include email verification or password reset, and sign-in rate limiting is local to the running server process.

## AI email drafts and Gmail

Email draft generation uses the `GEMINI_API_KEY` above and a bounded LangGraph workflow through LangChain's Gemini chat integration. The required `@langchain/langgraph` and `@langchain/google-genai` packages are included in the project dependencies. The graph uses the saved template, adjustment rules, applicant context, and the selected opportunity's stored evidence. Generated drafts are stored in MySQL for review and editing; unresolved facts remain marked for manual completion. The graph does not send mail.

To enable the email tools:

1. In Google Cloud, enable the Gmail API and create an OAuth client of type **Web application**. Add `http://localhost:3000` as an authorized JavaScript origin and `http://localhost:3000/api/gmail/callback` as an authorized redirect URI. Configure the consent screen for your account (add your Gmail address as a test user while the app is in testing mode).
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GMAIL_REDIRECT_URI` in `.env.local`. Generate a separate token-encryption key with `openssl rand -base64 32` and set it as `GMAIL_TOKEN_ENCRYPTION_KEY`. Keep all of these values private.
3. Run `npm run db:init` once to create the settings/connection tables and add nullable Gmail metadata columns to existing `EmailDraft` rows. This is additive and preserves existing drafts.
4. In the app, edit/save the base template and adjustment rules, then click **Connect Gmail**. The refresh token is encrypted before it is stored in MySQL. Select opportunities, generate drafts, review them, and click **Save to Gmail**. That button creates or updates a Gmail draft only; it never sends it.

The OAuth flow requests the `gmail.compose` and basic account identity scopes. Because this project does not have general app authentication, keep it on your local machine and do not expose the development server to a network. Disconnecting Gmail revokes the stored refresh token when Google's revocation endpoint is available and removes the local encrypted token.

No source registry is seeded or needed. The fixed search terms in `scripts/collect.ts` discover candidate page URLs directly. `OpportunitySource` is retained because it stores the actual URLs attached to saved opportunities; it is not a preloaded source registry.

## Collection flow

Run `npm run collect` from the project directory to search for active U.S. computer science professor and lab posts recruiting PhD students. The configured query set covers `.edu`, `github.io`, DuoOffer, and multiple CS research areas and recruitment phrasings. It runs at most 12 Tavily searches per invocation and rotates through the query set across successive normal collection runs, so later runs expand coverage without increasing the number of API calls per run. By default, each search requests up to 15 results, and up to 200 result pages are crawled (subject to the 200 page cap). Raise/lower `TAVILY_QUERIES_PER_RUN`, `TAVILY_MAX_QUERIES_PER_RUN`, `TAVILY_MAX_RESULTS_PER_QUERY`, `CRAWL_ROOTS_PER_RUN`, and `CRAWL_MAX_PAGES` to control provider use and crawl volume. Tavily basic-search calls are sequential.

Collection still only creates opportunities when the fetched page itself contains CS context, professor/lab context, and evidence of active PhD recruitment. It does not treat a professor profile or general graduate funding page as an active opening. Search results that are known aggregators or scholarship roundup sites are excluded from crawling. This evidence gate preserves precision; broadening discovery increases the number of pages checked without weakening the requirement for an actual recruitment signal.

Tavily URLs returned by the configured queries in `scripts/collect.ts` enter the `discovered_urls` queue with query/provider references. The collector crawls only those result URLs; it does not follow internal page links or use `OpportunitySource` as a seed list. `--crawl-only` is restricted to depth-zero Tavily URLs attributed to those same configured queries. Crawled pages record hashes and status. Promising professor/lab posts become `DiscoveryCandidate` records and are enriched into `Opportunity` records. If a professor/lab result cannot be fetched, a relevant Tavily excerpt can still be stored as an explicitly labeled fallback; the page remains blocked or failed as appropriate, and no crawl bypasses robots rules. Generic homepages and advice/roundup pages are excluded. Duplicate URLs are upserted, opportunity source URLs are preserved, and unchanged pages avoid repeat extraction. Unknown details remain unknown; funding is not considered confirmed without sufficient evidence. Collection prints JSON statistics and exits nonzero if all discovery/crawl paths fail.

To process existing queued URLs without making fresh Tavily searches, use `npm run collect -- --crawl-only`. To schedule weekly collection on Windows, create a Task Scheduler task with program `npm.cmd`, arguments `run collect`, and **Start in** set to the project directory.

## Safe fetching and extraction

Page fetches validate public IP addresses, pin requests to validated DNS results, validate every redirect, respect robots.txt, apply per-domain delays, enforce an 8 second timeout and a 1.5 MB response cap, and record blocked, deferred, and failed results separately. A robots denial is terminal for that crawl attempt and is never bypassed. When Gemini is enabled, both full-page extraction and failed-fetch snippet classification run through small LangGraph workflows. Each workflow calls Gemini once, then locally validates returned fields and supporting excerpts before data can reach storage. For snippets, Gemini sees only the supplied title, snippet, and URL; it does not visit the URL. A snippet is saved as an unverified professor/lab lead only if Gemini returns an exact recruitment quote that local validation confirms. Snippet-only results always keep funding unknown and are never represented as verified or fully funded. Rejected snippets remain discovery candidates without creating opportunities. Accepted and rejected classifications are cached by canonical URL and snippet hash; provider errors are not cached and can be retried. The extraction method records `tavily-snippet+gemini-v3-classified`, and the original fetch failure remains in the opportunity's extraction note. Without Gemini configured, the prior stricter Tavily-only fallback remains. These graphs are bounded extraction workflows: they do not browse, call tools, or make independent collection decisions. Crawlee uses static HTML and Cheerio; it does not launch a browser for the main collector. The separate `npm run scout` recruitment scout remains an optional, standalone Playwright tool and does not write to the opportunity database.

Rules extraction is the default. Gemini is optional; unsupported or missing Gemini fields are completed from conservative source-text rules where possible, while Gemini values still require matching evidence in the page. Gemini failures and empty/invalid evidence fall back to rules extraction and are recorded with the provider's error message when available. A versioned Gemini extractor rechecks unchanged records with missing structured facts once; content hashes prevent later repeat extraction. The dashboard displays unknown extracted fields, extraction status, errors, and supporting excerpts. Failed refreshes do not clear existing opportunity facts. Recruitment eligibility is decided during ingestion from the full fetched page; the API does not re-run that strict check against shorter Gemini excerpts.

## Dashboard and checks

The dashboard filters saved database records by degree, country, subject, funding, deadline, category, free text, and eligibility. It does not trigger web discovery. Opportunity source URLs remain available as evidence links. Email drafting settings and generated drafts are stored in MySQL, and Gmail export requires an explicit user click after review.

Run `npm run typecheck`, `npm test`, and `npm run build`. `npm run test:integration` additionally requires the initialized MySQL database.

## Public read-only opportunity snapshot

The main application remains the full account-based, database-backed app. A separate static snapshot can be published without changing or deploying that app:

1. To refresh the public listing from your local MySQL database, run `npm run snapshot:export`. This reads saved opportunities and writes only a public allowlist of listing fields and source URLs to `snapshot/opportunities.json`. It deliberately excludes accounts, sessions, email drafts/settings, Gmail tokens, and credentials.
2. Run `npm run snapshot:build` to create `snapshot-site/`. This step reads only the checked-in snapshot files and does not connect to MySQL or require any environment variables.
3. To publish from GitHub, push the project to a repository, enable **Settings → Pages → Build and deployment → Source: GitHub Actions**, then push to `main` or run the **Deploy public opportunity snapshot** workflow manually. The workflow publishes only `snapshot-site/`; it does not deploy the authenticated Next.js application. No API keys, database credentials, OAuth credentials, or GitHub secrets are needed for this static deployment.

The page supports browser-side text, degree, country, field, and funding filters. It is read-only and shows the dataset committed in `snapshot/opportunities.json`; it does not perform live collection or connect to MySQL. Because it is public, the exported opportunity details and source URLs are visible to anyone. Refresh and commit the JSON whenever you want the published snapshot updated. The output folder `snapshot-site/` is ignored by Git and can be regenerated at any time.

Before publishing the full project repository, keep `.env.local` private. The existing `.gitignore` excludes `.env*` files while allowing the placeholder `.env.example`; check for any credentials accidentally placed in tracked source or history before making a repository public.
