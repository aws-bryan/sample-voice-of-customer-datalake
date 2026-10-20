# Company context, personal objectives and the design system

What the AI surfaces know about the company: its **vision and objectives** (company-wide), each user's
**own objectives and KPIs**, and the **design system** prototypes must follow. All travel as DATA blocks in the user
prompt (`<company_context>`, `<design_system>`) — never as system prompt:

- **Research, PR/FAQ, PRD, prototypes, personas and agent steps** (shared outputs) get the company vision and
  company objectives — never anyone's own objectives — together with the company memories
  (`lambda/shared/grounding.py`, policy SHARED; see docs/memory.md → "Who recalls what"). Prototypes, PRDs and
  PR/FAQs also get the design system.
- **The assistant** auto-injects a short `<company_context>` at the start of every run (`lambda/stream/src/assistant/runtime/company-brief.ts`):
  the vision (clipped), the company objective titles, and the caller's OWN objectives with their KPIs — read as the
  caller from `GET /settings/company-context` and `GET /settings/my-context` (keyed by the verified sub), at most
  2 KB. The `get_company_context`, `get_my_context` and `get_design_system` tools stay for full detail.
- **MCP** (`/mcp/global`) reads them through its tools.

| What | Route (settings Lambda) | Read | Write |
|---|---|---|---|
| Vision (markdown ≤ 20k) + objectives (≤ 50; horizon long / quarter / date) | `GET/PUT /settings/company-context` | everyone | admins |
| My objectives & KPIs | `GET/PUT /settings/my-context` | self | self (cannot touch company objectives) |
| Design system: tokens, guidelines, logo, references | `GET/PUT /settings/design-system`, `POST …/references`, `POST …/references/{id}/refresh`, `DELETE …/references/{id}` (archives) | everyone | admins |
| Figma / GitHub tokens | `PUT /settings/design-system/integrations` | nobody (GET reports `{figma, github}` booleans only) | admins |
| User flags `fallback_owner` (admins only, at most one), `memory_reviewer` | `PUT /users/{username}/flags` (users Lambda) | admins | admins |

Storage: aggregates rows `SETTINGS#company_context`, `SETTINGS#design_system`, `USERCTX#{sub}`, `USERFLAGS#{sub}`
(`sk = config`). Uploads (screenshots png/jpg/webp ≤ 5 MB, HTML ≤ 2 MB, the logo) go to the raw bucket under
`company-context/design/` by presigned PUT and are kept when a reference is archived. Figma and GitHub tokens live
in the Secrets Manager secret `voc/design-integrations-<account>-<region>` (Core stack, KMS, deleted with the stack), JSON
`{figma_token?, github_token?}`.

Infrastructure: the settings role gains `secretsmanager:GetSecretValue`/`PutSecretValue` on that one secret and
S3 read + put (no delete) on `company-context/*`; its environment gains `DESIGN_INTEGRATIONS_SECRET_ARN` and
`RAW_DATA_BUCKET`. The users Lambda keeps its single-item aggregates grant (`GetItem`/`PutItem`).

## Getting the Figma and GitHub tokens

Administration → Sources → Integrations (`/admin?tab=sources&section=integrations`) carries the same steps in-page (a "Setup help"
disclosure per token, in every locale). Summary, checked against the providers' docs:

| Token | Needed for | Where to create it | Grant | Sent only to |
|---|---|---|---|---|
| Figma personal access token | every Figma reference | Figma → account menu (top left) → Settings → Security → Personal access tokens → Generate new token ([docs](https://developers.figma.com/docs/rest-api/personal-access-tokens/)) | the one scope `file_content:read` ([scopes](https://developers.figma.com/docs/rest-api/scopes/)) | `api.figma.com` |
| GitHub fine-grained personal access token | private repositories (public ones work anonymously, at GitHub's lower rate limit) | GitHub → profile picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token ([docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)); [pre-filled form](https://github.com/settings/personal-access-tokens/new?name=VoC+design+system&description=Read-only+design+references+for+VoC&contents=read) | Only select repositories; Repository permissions → Contents: Read-only (Metadata read-only is automatic) | `api.github.com` |

There is no Test button: a token is exercised when a reference is fetched. Add a Figma file or GitHub repository
reference under Company → Design system and reload: **Ready** with a summary means the token works; **Failed**
shows the backend's reason under the reference (`… refused access` = wrong/expired/under-scoped token; `… could
not find it (or the token cannot see it)` = wrong link or no access; GitHub answers 404 for a private repository
the token was not granted). Fix it and click **Fetch again**. Both tokens act as the user who created them: set an
expiry, rotate before it lapses, and revoke at the provider if one leaks. The design-system GitHub token is
separate from the GitHub Issues data-source token ([github-issues.md](github-issues.md)); do not reuse one for
the other.

## Navigation proposal (for the frontend tracks)

Company context, memory, the design system and a project's **Product** tab (`/projects/{id}?tab=product`) all
answer one question — what does the AI know about our company and product — so they belong together. Settings is
reduced to administration.

| Section | Items | Who |
|---|---|---|
| Insights | Dashboard, Categories, Problems, Prioritization | all |
| Ideation | Projects, **Autonomous agents**, AI chat | all (agent writes: admins) |
| **Knowledge** (new) | **Memory** (Company · Personal · Needs review · Imports), **Company** (vision, objectives — read for all, edit admins), **Design system** (read for all, edit admins), **My objectives & KPIs** | all; review tab admins + memory reviewers |
| Data | Data explorer (admins), Scrapers, Feedback forms | as today |
| Settings | Administration (5.09 tabs): General, Sources (data sources, integrations incl. Figma/GitHub tokens, email inbox, Radar), Taxonomy, Privacy & access (source policies, users incl. the two flags), AI models, System · Account: profile, **Connect AI tools** | Administration: admins; Account: everyone |

A project's **Product** tab stays per project (it describes that product: docs, interview, report) but shows the
company context and design system it inherits, read-only, with a link to Knowledge — and can promote its findings
to company memory through `POST /memory/imports`.

## One MCP connection for the whole app

> Built: the global MCP on **Connect** ([mcp.md](mcp.md)). The per-project MCP tab has since been removed;
> the project header links to Connect with the project pre-selected. The original proposal follows.

A project's **MCP** tab (`/projects/{id}?tab=mcp`) used to mint a token for that project. Proposal: one per-user MCP
endpoint for the whole software under Account → **MCP tokens** (`/account?tab=access`, shipped), whose tools follow the user's own
access (projects by membership, reviews by category access, memory by scope) — the same delegated-principal model
the MCP and agent identities already use (never admin, capped at editor). The project tab becomes a shortcut that
pre-selects that project. Alongside the token, the page offers a downloadable **skill** (a link + instructions) so
Claude Cowork, GitHub Copilot or Amazon Quick can open it, connect over MCP and work from outside. Infra impact: the
MCP Lambda's delegation list (today metrics + projects) would gain the memory and agents APIs.
