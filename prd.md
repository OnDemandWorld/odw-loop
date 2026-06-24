# Loop — Product Requirements Document

**Product:** Loop
**Parent Suite:** ODW.ai
**Version:** 1.0
**Status:** Draft
**Last Updated:** 2026-06-23
**Author:** Product Team, ODW.ai

---

## 1. Product Overview

### 1.1 What Loop Is

Loop is the orchestration layer of the ODW.ai sovereign agent suite. It wires ODW's individual agents — Vault (knowledge base), Desk (workspace/productivity), Recap (meeting intelligence), and future modules — into automated, multi-step workflows that run entirely on the customer's own infrastructure.

Loop is not a general-purpose workflow tool competing with n8n or Zapier on feature breadth. It is the conductor of a sovereign agent suite: the only orchestrator purpose-built to coordinate ODW's own agents end to end, with data sovereignty as a first-class constraint rather than an afterthought.

### 1.2 Core Value Proposition

- **Sovereign by design.** Every workflow runs on the customer's hardware. No telemetry, no cloud fallback, no data egress unless the operator explicitly configures it.
- **Agent-native, not bolt-on.** Loop understands ODW's agent primitives (Vault documents, Recap transcripts, Desk tasks) as first-class workflow objects, not as opaque webhooks.
- **Low-code surface, code escape hatch.** Non-engineers compose workflows visually; engineers drop into Python/TypeScript for advanced logic without leaving the platform.
- **Model-agnostic.** Workflows reference capabilities (summarize, classify, extract), not specific models. Swap LLM providers without rewriting automations.
- **Open-core economics.** Free single-instance core; paid tier adds cross-module orchestration at scale, unified control plane, HA deployment, and premium connectors.

### 1.3 Strategic Context

The AI agent orchestration market has moved from experimental to mission-critical. Enterprises are deploying multi-agent systems for research, customer support, compliance, and internal operations. Existing tools (n8n, Activepieces, Flowise, Langflow, AutoGen, CrewAI) are either cloud-dependent, lack deep RAG integration, or treat sovereignty as a deployment option rather than an architectural principle.

Loop's defensible niche: it is the only orchestrator that can coordinate ODW's sovereign agents with full awareness of their semantic primitives, while keeping every byte of data inside the customer's trust boundary.

### 1.4 Target Market

Small and medium businesses (SMBs) operating in regulated or data-residency-sensitive contexts — legal, healthcare, financial services, government contractors, and privacy-conscious enterprises in the EU, APAC, and LATAM regions.

### 1.5 Pricing Model

| Tier | Price | What's Included |
|------|-------|-----------------|
| **Core (Free)** | $0 | Single-instance deployment, unlimited local workflows, all ODW agent connectors, community support |
| **Scale** | Usage-based | Multi-instance orchestration, unified control plane, HA deployment, SLA-backed support |
| **Enterprise** | Custom | Premium connectors (SAP, Salesforce, custom ERP), dedicated onboarding, audit-grade logging, white-glove deployment |

---

## 2. Goals & Success Metrics

### 2.1 Product Goals

| # | Goal | Horizon |
|---|------|---------|
| G1 | Establish Loop as the default orchestrator for ODW.ai agent suites | 12 months |
| G2 | Enable non-engineers to build production workflows in under 30 minutes | 6 months |
| G3 | Achieve zero data egress by default for all Core-tier deployments | Launch |
| G4 | Support at least 5 ODW agent modules as first-class workflow primitives at launch | Launch |
| G5 | Convert 8% of Core users to paid Scale tier within 12 months of GA | 12 months post-GA |

### 2.2 Success Metrics

| Metric | Target (6 months post-GA) | Target (12 months post-GA) |
|--------|---------------------------|----------------------------|
| Active deployments (Core + paid) | 500 | 2,500 |
| Workflows created per deployment (median) | 12 | 25 |
| Workflow execution success rate | ≥ 95% | ≥ 98% |
| Time-to-first-workflow (new user) | ≤ 45 min | ≤ 20 min |
| Core-to-paid conversion rate | 5% | 8% |
| Net Promoter Score (NPS) | ≥ 40 | ≥ 50 |
| Mean time to recover from workflow failure | ≤ 5 min | ≤ 2 min |
| Paid tier ARR | $500K | $2.5M |

### 2.3 North Star Metric

**Weekly active workflows per deployment** — captures both adoption depth (are users building multiple workflows?) and retention (are they running them repeatedly?).

---

## 3. Scope Definition

### 3.1 In Scope (v1.0)

**Workflow Authoring**
- Visual drag-and-drop workflow builder (node-and-edge canvas)
- Pre-built node library for all ODW agent primitives (Vault, Desk, Recap, etc.)
- Conditional branching, loops, parallel execution, error handling nodes
- Code node (Python and TypeScript) for custom logic
- Variable and parameter system with type checking
- Version control for workflow definitions (git-backed)
- Workflow templates for common patterns (meeting → action items → KB update)

**Execution Engine**
- Local execution engine (single-instance)
- Scheduled triggers (cron-style)
- Event-driven triggers (webhooks, file-watchers, ODW agent events)
- Manual triggers (UI button, API call)
- Execution history with full input/output capture
- Retry logic with configurable backoff
- Timeout and circuit-breaker controls per node

**ODW Agent Integration**
- Vault: read/write documents, search, RAG queries, tag management
- Desk: create/update tasks, manage projects, calendar operations
- Recap: ingest transcripts, extract action items, summarize, classify
- Generic agent connector for future ODW modules
- Semantic type system: workflows understand "document," "transcript," "action item" as typed objects

**Infrastructure & Deployment**
- Self-hosted deployment via Docker Compose (single-node)
- Kubernetes Helm chart (single-cluster)
- SQLite (Core) and PostgreSQL (Scale) state backends
- Local model integration (Ollama, llama.cpp, vLLM)
- Remote model integration (OpenAI, Anthropic, Azure OpenAI, AWS Bedrock, Google Vertex)
- Secrets management (env vars, HashiCorp Vault integration)

**Observability**
- Execution logs per workflow run
- Metrics dashboard (success rate, latency, throughput)
- Error alerting (webhook, email, Slack)
- Audit log for compliance-sensitive operations

**Security & Sovereignty**
- Air-gapped deployment mode (no outbound network required)
- Role-based access control (RBAC) with read/write/admin roles
- Encryption at rest (AES-256) and in transit (TLS 1.3)
- No telemetry without explicit opt-in
- Data residency enforcement (block egress to non-approved regions)

**Paid Tier (Scale)**
- Multi-instance orchestration (federate workflows across nodes)
- Unified control plane (single pane of glass for fleet)
- High-availability deployment (active-active, failover)
- Premium connectors (SAP, Salesforce, ServiceNow, custom ERP)
- SLA-backed support (4-hour response)
- Workflow execution priority queues

### 3.2 Out of Scope (v1.0)

- Building a general-purpose iPaaS to replace Zapier/n8n for non-ODW use cases
- Hosting Loop as a managed SaaS (ODW.ai will not operate Loop in the cloud for customers)
- Mobile app for workflow authoring (mobile monitoring only, post-v1.0)
- Real-time collaborative workflow editing (multiplayer canvas)
- Native voice/video agent orchestration (defer to ODW's future voice module)
- Multi-tenant SaaS isolation (each deployment is single-tenant by design)
- Workflow marketplace / community template sharing in v1.0 (internal templates only)
- Natural-language workflow generation ("build me a workflow that...") — deferred to v1.1
- Cross-organization workflow federation

### 3.3 Deferred to Future Releases

| Feature | Target Release |
|---------|----------------|
| NL workflow generation | v1.1 |
| Workflow marketplace | v1.2 |
| Multi-player canvas | v1.2 |
| Cross-org federation | v2.0 |
| Edge deployment (IoT/branch office) | v2.0 |

---

## 4. User Personas

### 4.1 Persona: Maya — The Operations Lead

**Role:** Operations Manager at a 50-person legal consultancy
**Technical skill:** Moderate — comfortable with SaaS admin panels, Zapier-level tools; not a developer
**Pain points:**
- Meeting notes from client calls sit in Recap but never flow into Vault or Desk
- Manual copy-paste between tools wastes 5+ hours/week
- Compliance requires all client data stay on-prem; cloud automation tools are off-limits
**Goals:** Automate the meeting → knowledge base → follow-up pipeline without writing code
**Success looks like:** "I built a workflow in 20 minutes that does what used to take me an hour every day, and I know our client data never left our server."

### 4.2 Persona: Raj — The Platform Engineer

**Role:** Senior DevOps/Platform Engineer at a 200-person fintech
**Technical skill:** High — Kubernetes, Terraform, Python, infrastructure-as-code
**Pain points:**
- Evaluated n8n and Activepieces; both require cloud callbacks or awkward self-hosting
- Needs audit-grade logs for SOC 2 compliance
- Wants to extend workflows with custom Python logic without forking the orchestrator
**Goals:** Deploy Loop on their existing K8s cluster, integrate with internal OIDC, write custom nodes in Python
**Success looks like:** "Loop runs on our infra, passes our security review, and I can drop into Python when the visual builder isn't enough."

### 4.3 Persona: Elena — The Compliance Officer

**Role:** Data Protection Officer at a healthcare SMB in the EU
**Technical skill:** Low — reads dashboards and audit logs, doesn't build workflows
**Pain points:**
- Needs proof that patient data never leaves the EU or the on-prem environment
- Must approve every automation that touches PHI
- Existing tools have opaque telemetry and unclear data flows
**Goals:** Verify Loop's data flows, configure egress policies, review audit logs
**Success looks like:** "I can see every byte of data Loop touches, I've blocked all egress except our approved endpoints, and I have audit logs for every workflow run."

### 4.4 Persona: Diego — The Founder / Solo Operator

**Role:** Solo consultant running a privacy-focused research practice
**Technical skill:** Moderate-to-high — comfortable with Docker, basic scripting
**Pain points:**
- Can't afford enterprise automation tools
- Wants ODW's full suite but needs the glue between modules
- Needs something that runs on a single $50/month VPS
**Goals:** Free tier that's genuinely useful, not a crippled demo
**Success looks like:** "I'm running Loop on a single box, it orchestrates all my ODW agents, and I haven't paid a cent."

### 4.5 Persona: Aisha — The Enterprise Architect

**Role:** Enterprise Architect at a 1,000-person government contractor
**Technical skill:** High — designs multi-system integrations, evaluates vendor security
**Pain points:**
- Needs to deploy Loop across 5 regional offices with different data residency rules
- Requires HA and disaster recovery
- Must integrate with existing ITSM (ServiceNow) and identity (Azure AD)
**Goals:** Scale tier that supports multi-region, federated control plane, premium connectors
**Success looks like:** "Loop runs HA across our regions, each region's data stays in-region, and I have one dashboard to monitor everything."

---

## 5. User Journeys & Flows

### 5.1 Journey: Meeting Notes → Action Items → Knowledge Base → Follow-up

**Actor:** Maya (Operations Lead)
**Trigger:** A client meeting ends; Recap has a new transcript

**Flow:**
1. Recap ingests the meeting transcript and emits a `transcript.completed` event
2. Loop's event trigger catches the event and starts the workflow
3. Node 1: **Recap → Extract Action Items** — calls Recap's extraction API, returns structured list of action items with owners and due dates
4. Node 2: **Conditional Branch** — for each action item, check if owner is in current projects
   - If yes → Node 3a: **Desk → Create Task** with due date and link back to transcript
   - If no → Node 3b: **Desk → Create Task** + **Vault → Create Draft Document** for onboarding context
5. Node 4: **Recap → Summarize** — generate a 3-sentence summary of the meeting
6. Node 5: **Vault → Upsert Document** — store summary in the client's knowledge base folder, tagged with meeting date and participants
7. Node 6: **Desk → Schedule Follow-up** — create a calendar event 48 hours later with the summary pre-populated in the description
8. Node 7: **Notification** — send a Slack/email digest to Maya with links to created tasks and KB entry

**Outcome:** Maya opens Desk the next morning and sees new tasks, a KB entry, and a scheduled follow-up — all without touching any tool manually.

### 5.2 Journey: Engineer Extends Workflow with Custom Python

**Actor:** Raj (Platform Engineer)
**Trigger:** Raj needs to enrich Vault documents with metadata from an internal API that has no ODW connector

**Flow:**
1. Raj opens the Loop visual builder and loads an existing "Ingest Document" workflow
2. He drags a **Code Node** onto the canvas between "Vault → Read Document" and "Vault → Update Metadata"
3. He writes a Python function that calls the internal API, parses the response, and returns enriched metadata
4. The Code Node exposes the function's input (document content) and output (metadata dict) as typed ports
5. Raj tests the node in isolation using a sample document
6. He saves the workflow, which commits the updated definition to the git-backed version store
7. He triggers a manual run on a test document; execution logs show the Code Node's stdout and the API response
8. Raj promotes the workflow to production via the version control UI

**Outcome:** The internal API is now part of the ingestion pipeline, and Raj didn't have to wait for ODW to ship a connector.

### 5.3 Journey: Compliance Officer Audits Data Flows

**Actor:** Elena (Compliance Officer)
**Trigger:** Quarterly audit requires proof that PHI never leaves the on-prem environment

**Flow:**
1. Elena logs into the Loop admin dashboard (read-only role)
2. She navigates to **Data Flow Map** — a visual graph showing every external endpoint any workflow has contacted in the last 90 days
3. She verifies that the only outbound connections are to the approved LLM provider (Azure OpenAI, EU region)
4. She drills into a specific workflow run and sees the full input/output payload for each node, redacted per her policy
5. She exports the audit log as a signed PDF for the external auditor
6. She adjusts the **Egress Policy** to block a newly-discovered endpoint that a workflow was using for model fallback

**Outcome:** Audit passes; Elena has continuous visibility into data flows without needing engineering support.

### 5.4 Journey: Solo Operator Deploys on a Single VPS

**Actor:** Diego (Solo Consultant)
**Trigger:** Diego wants to automate his research workflow

**Flow:**
1. Diego provisions a $50/month VPS in his preferred region
2. He runs `curl ... | docker compose up -d` (single command install)
3. Loop starts with SQLite backend, local Ollama integration, and all ODW agent connectors
4. He opens the Loop UI at `http://localhost:3000` and authenticates with a local password
5. He picks a template: "Research → Summarize → Store in Vault"
6. He customizes the template to point at his Vault instance and his preferred local model (Llama 3 via Ollama)
7. He triggers a test run; it completes in 12 seconds
8. He sets a cron trigger to run daily at 6 AM

**Outcome:** Diego has a fully sovereign, zero-cost automation running on a single box. No data leaves his VPS.

### 5.5 Journey: Enterprise Architect Deploys HA Across Regions

**Actor:** Aisha (Enterprise Architect)
**Trigger:** Government contract requires HA deployment across 3 EU regions

**Flow:**
1. Aisha uses the Scale tier Helm chart to deploy Loop on 3 regional K8s clusters (Frankfurt, Amsterdam, Dublin)
2. She configures the **Unified Control Plane** to federate all 3 instances
3. She sets **Data Residency Rules**: workflows tagged `region=de` can only execute on Frankfurt nodes
4. She deploys a workflow that ingests classified documents; the control plane routes execution to the correct region based on document tags
5. She configures **Active-Active failover**: if Frankfurt goes down, its workflows failover to Amsterdam (with data residency override approval)
6. She connects premium connectors: ServiceNow (for incident workflows) and Azure AD (for SSO)
7. She monitors all 3 regions from a single dashboard; alerting fires to PagerDuty on failure

**Outcome:** HA deployment passes the government security review; Aisha has one pane of glass for the entire fleet.

---

## 6. Functional Requirements

### 6.1 Workflow Authoring

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-A1 | Visual canvas with drag-and-drop node placement | P0 |
| FR-A2 | Node library with search, categorization, and preview | P0 |
| FR-A3 | Pre-built nodes for all ODW agent primitives (Vault, Desk, Recap) | P0 |
| FR-A4 | Conditional branching (if/else, switch/case) | P0 |
| FR-A5 | Loop/iteration nodes (for-each over lists, while conditions) | P0 |
| FR-A6 | Parallel execution (fan-out / fan-in) | P0 |
| FR-A7 | Error handling nodes (try/catch, fallback paths) | P0 |
| FR-A8 | Code node supporting Python 3.11+ and TypeScript | P0 |
| FR-A9 | Variable system with type inference and validation | P0 |
| FR-A10 | Workflow versioning backed by git (auto-commit on save) | P1 |
| FR-A11 | Workflow templates (bundled + user-created) | P1 |
| FR-A12 | Import/export workflows as JSON/YAML | P1 |
| FR-A13 | Sub-workflow invocation (call another workflow as a node) | P1 |
| FR-A14 | Workflow comments and documentation annotations | P2 |
| FR-A15 | Dark mode and accessibility (WCAG 2.1 AA) | P2 |

### 6.2 Execution Engine

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-E1 | Local execution engine (in-process, no external queue for Core tier) | P0 |
| FR-E2 | Cron-style scheduled triggers with timezone support | P0 |
| FR-E3 | Webhook triggers with HMAC signature verification | P0 |
| FR-E4 | Event triggers from ODW agent lifecycle events | P0 |
| FR-E5 | Manual trigger via UI button and REST API | P0 |
| FR-E6 | Execution history with full I/O capture (configurable retention) | P0 |
| FR-E7 | Retry logic with configurable backoff (exponential, linear, fixed) | P0 |
| FR-E8 | Per-node timeout configuration | P0 |
| FR-E9 | Circuit breaker pattern (disable node after N consecutive failures) | P1 |
| FR-E10 | Execution pause/resume (human-in-the-loop approval gates) | P1 |
| FR-E11 | Priority queues (Scale tier) | P1 |
| FR-E12 | Distributed execution across multiple nodes (Scale tier) | P1 |
| FR-E13 | Workflow-level concurrency limits | P1 |
| FR-E14 | Execution replay (re-run a past execution with same inputs) | P2 |

### 6.3 ODW Agent Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-I1 | Vault connector: CRUD documents, search, RAG queries, tag management | P0 |
| FR-I2 | Desk connector: tasks, projects, calendar, notifications | P0 |
| FR-I3 | Recap connector: ingest transcripts, extract items, summarize, classify | P0 |
| FR-I4 | Generic ODW agent connector (auto-discover capabilities via agent manifest) | P0 |
| FR-I5 | Semantic type system: typed objects (Document, Transcript, ActionItem, Task) | P0 |
| FR-I6 | Connector health monitoring and auto-reconnect | P1 |
| FR-I7 | Connector version pinning (lock to specific ODW module version) | P1 |
| FR-I8 | Premium connectors: SAP, Salesforce, ServiceNow (Scale tier) | P1 |
| FR-I9 | Custom connector SDK (Python) for user-built integrations | P2 |

### 6.4 Infrastructure & Deployment

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-D1 | Docker Compose deployment (single-node, Core tier) | P0 |
| FR-D2 | Kubernetes Helm chart (single-cluster) | P0 |
| FR-D3 | SQLite state backend (Core tier default) | P0 |
| FR-D4 | PostgreSQL state backend (Scale tier) | P0 |
| FR-D5 | Local model integration: Ollama, llama.cpp, vLLM | P0 |
| FR-D6 | Remote model integration: OpenAI, Anthropic, Azure OpenAI, Bedrock, Vertex | P0 |
| FR-D7 | Secrets management via environment variables | P0 |
| FR-D8 | HashiCorp Vault integration for secrets | P1 |
| FR-D9 | Multi-instance Helm chart (Scale tier, multi-cluster) | P1 |
| FR-D10 | Automated backup and restore of workflow definitions and state | P1 |
| FR-D11 | Air-gapped installation mode (no outbound network) | P0 |

### 6.5 Observability

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-O1 | Execution logs per workflow run (structured, searchable) | P0 |
| FR-O2 | Metrics dashboard: success rate, latency (p50/p95/p99), throughput | P0 |
| FR-O3 | Error alerting via webhook, email, Slack | P0 |
| FR-O4 | Audit log for all state-changing operations (immutable, append-only) | P0 |
| FR-O5 | Data flow map: visual graph of all external endpoints contacted | P1 |
| FR-O6 | Prometheus metrics endpoint (/metrics) | P1 |
| FR-O7 | OpenTelemetry trace export | P2 |
| FR-O8 | Custom dashboard builder | P2 |

### 6.6 Security & Sovereignty

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-S1 | Air-gapped deployment mode (zero outbound network required) | P0 |
| FR-S2 | RBAC: read, write, admin roles | P0 |
| FR-S3 | Encryption at rest (AES-256) | P0 |
| FR-S4 | Encryption in transit (TLS 1.3) | P0 |
| FR-S5 | No telemetry without explicit opt-in (opt-in, not opt-out) | P0 |
| FR-S6 | Data residency enforcement (block egress to non-approved regions/endpoints) | P0 |
| FR-S7 | OIDC / SAML SSO integration | P1 |
| FR-S8 | API key management with scope and expiry | P1 |
| FR-S9 | IP allowlisting for API access | P1 |
| FR-S10 | SOC 2 Type II audit-ready logging | P1 |
| FR-S11 | Workflow execution sandboxing (isolate Code Node execution) | P0 |

### 6.7 Paid Tier (Scale) Features

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-P1 | Multi-instance orchestration (federate workflows across nodes) | P0 |
| FR-P2 | Unified control plane (single dashboard for fleet) | P0 |
| FR-P3 | High-availability deployment (active-active, automatic failover) | P0 |
| FR-P4 | Premium connectors (SAP, Salesforce, ServiceNow, custom ERP) | P1 |
| FR-P5 | SLA-backed support (4-hour response time) | P1 |
| FR-P6 | Workflow execution priority queues | P1 |
| FR-P7 | Cross-region data residency rules | P1 |
| FR-P8 | Dedicated onboarding and deployment assistance | P1 |

---

## 7. User Stories & Acceptance Criteria

### 7.1 Workflow Authoring

**US-A1:** As a non-engineer, I want to build a workflow visually so that I don't need to write code.
- **AC1:** Given I am on the workflow builder canvas, when I drag a node from the library, then the node appears on the canvas with its configuration panel open.
- **AC2:** Given two nodes on the canvas, when I draw an edge between them, then data flows from the output port of the first to the input port of the second.
- **AC3:** Given a workflow with 5+ nodes, when I click "Run," then the workflow executes and I see real-time progress on each node.

**US-A2:** As an engineer, I want to write custom Python logic in a workflow so that I can handle cases the visual builder can't.
- **AC1:** Given a Code Node on the canvas, when I write a Python function, then the function's input and output are exposed as typed ports.
- **AC2:** Given a Code Node with a syntax error, when I click "Test," then the editor shows the error with line number and a helpful message.
- **AC3:** Given a Code Node that raises an exception at runtime, when the workflow executes, then the error is captured in the execution log and the workflow follows the error-handling path.

**US-A3:** As a workflow author, I want to version my workflows so that I can roll back if a change breaks something.
- **AC1:** Given I save a workflow, then a new version is committed to the git-backed store with a timestamp and my username.
- **AC2:** Given a workflow with 3 versions, when I open the version history, then I see all 3 versions with diffs.
- **AC3:** Given I select a past version, when I click "Restore," then the workflow reverts to that version and a new version is created marking the restore.

### 7.2 Execution Engine

**US-E1:** As an operations lead, I want workflows to trigger automatically when a meeting ends so that I don't have to remember to run them.
- **AC1:** Given a workflow with an event trigger on `recap.transcript.completed`, when Recap emits that event, then the workflow starts within 5 seconds.
- **AC2:** Given a workflow with a cron trigger set to "daily at 6 AM UTC," when the clock strikes 6 AM, then the workflow starts.
- **AC3:** Given a workflow with a webhook trigger, when I POST to the webhook URL with a valid HMAC signature, then the workflow starts with the POST body as input.

**US-E2:** As a platform engineer, I want workflows to retry on transient failures so that I don't get paged for blips.
- **AC1:** Given a node configured with "retry 3 times, exponential backoff," when the node fails, then it retries up to 3 times with delays of 1s, 2s, 4s.
- **AC2:** Given a node that fails all retries, when the workflow has an error-handling path, then execution follows that path.
- **AC3:** Given a node that fails all retries and no error-handling path, then the workflow is marked as failed and an alert is sent.

**US-E3:** As a workflow author, I want to pause a workflow for human approval so that sensitive actions require sign-off.
- **AC1:** Given an "Approval Gate" node, when execution reaches it, then the workflow pauses and a notification is sent to the configured approvers.
- **AC2:** Given a paused workflow, when an approver clicks "Approve," then execution resumes from the next node.
- **AC3:** Given a paused workflow, when an approver clicks "Reject" with a reason, then execution follows the rejection path and the reason is logged.

### 7.3 ODW Agent Integration

**US-I1:** As a user, I want my meeting transcripts to automatically become action items in Desk so that nothing falls through the cracks.
- **AC1:** Given a workflow that connects Recap → Extract Action Items → Desk → Create Task, when a new transcript is ingested, then a task is created in Desk for each action item with the correct owner and due date.
- **AC2:** Given an action item with no clear owner, when the workflow runs, then the task is assigned to a default owner (configurable) and flagged for review.

**US-I2:** As a user, I want my Vault knowledge base to stay up-to-date with meeting summaries so that I can find context later.
- **AC1:** Given a workflow that summarizes a transcript and upserts to Vault, when the workflow runs, then a document appears in the configured Vault folder with the summary, tagged with meeting date and participants.
- **AC2:** Given a Vault folder with an existing summary for the same meeting, when the workflow runs again, then the existing document is updated (not duplicated).

**US-I3:** As an engineer, I want to connect a new ODW module to Loop without waiting for a custom connector so that I can automate with new agents immediately.
- **AC1:** Given a new ODW module that exposes a manifest file, when I add it to Loop, then Loop auto-discovers its capabilities and they appear in the node library.
- **AC2:** Given a module without a manifest, when I use the generic connector, then I can configure it manually with endpoint URLs and auth.

### 7.4 Security & Sovereignty

**US-S1:** As a compliance officer, I want to verify that no data leaves my infrastructure so that I can pass audits.
- **AC1:** Given an air-gapped deployment, when I run a workflow, then no outbound network connections are made (verifiable via network monitoring).
- **AC2:** Given a data residency policy that blocks egress to non-EU endpoints, when a workflow attempts to call a US-hosted API, then the call is blocked and an alert is fired.
- **AC3:** Given the Data Flow Map, when I open it, then I see every external endpoint contacted by any workflow in the configured time window.

**US-S2:** As an admin, I want to control who can edit workflows so that only authorized users make changes.
- **AC1:** Given a user with the "read" role, when they open a workflow, then they can view it but not edit or run it.
- **AC2:** Given a user with the "write" role, when they edit a workflow, then the change is saved and attributed to them in the version history.
- **AC3:** Given a user with the "admin" role, when they configure RBAC, then they can assign roles to other users.

### 7.5 Deployment & Operations

**US-D1:** As a solo operator, I want to deploy Loop on a single VPS with one command so that I can get started in minutes.
- **AC1:** Given a fresh Ubuntu 22.04 VPS, when I run the install script, then Loop is running and accessible at port 3000 within 5 minutes.
- **AC2:** Given a running Core-tier deployment, when I check resource usage, then it consumes ≤ 2 GB RAM and ≤ 2 CPU cores at idle.

**US-D2:** As an enterprise architect, I want to deploy Loop HA across multiple regions so that I meet uptime SLAs.
- **AC1:** Given a Scale-tier deployment across 3 regions, when one region goes down, then workflows failover to another region within 60 seconds.
- **AC2:** Given a multi-region deployment, when I open the control plane, then I see the status of all regions on one dashboard.
- **AC3:** Given a data residency rule for a region, when a workflow is tagged for that region, then it only executes on nodes in that region.

---

## 8. Non-Functional Requirements (NFRs)

### 8.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-P1 | Workflow execution start latency (trigger → first node) | ≤ 500ms (p95) |
| NFR-P2 | Node execution overhead (engine overhead per node, excluding node logic) | ≤ 50ms (p95) |
| NFR-P3 | Concurrent workflow executions (Core tier, single instance) | ≥ 50 |
| NFR-P4 | Concurrent workflow executions (Scale tier, per node) | ≥ 200 |
| NFR-P5 | Workflow builder UI responsiveness | ≤ 100ms for canvas interactions |
| NFR-P6 | Execution history query (last 1,000 runs) | ≤ 2s |

### 8.2 Reliability & Availability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-R1 | Workflow execution success rate (excluding node-level failures) | ≥ 99.9% |
| NFR-R2 | Engine uptime (Scale tier, HA deployment) | ≥ 99.95% |
| NFR-R3 | Mean time to recover from node failure (Scale tier) | ≤ 60s |
| NFR-R4 | Data durability (workflow definitions, execution history) | ≥ 99.999% (with configured backups) |
| NFR-R5 | Graceful degradation: if an ODW agent is down, workflows that don't depend on it continue | Required |

### 8.3 Scalability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-S1 | Max workflows per deployment (Core tier) | ≥ 1,000 |
| NFR-S2 | Max workflow executions per day (Core tier) | ≥ 10,000 |
| NFR-S3 | Max workflow executions per day (Scale tier, per node) | ≥ 100,000 |
| NFR-S4 | Max nodes per workflow | ≥ 200 |
| NFR-S5 | Max concurrent instances of the same workflow | ≥ 20 |
| NFR-S6 | Horizontal scaling (Scale tier): add nodes to increase throughput | Linear to 10 nodes |

### 8.4 Security

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-SC1 | Zero known critical/high CVEs in production dependencies at launch | Required |
| NFR-SC2 | Dependency vulnerability scanning in CI | Every PR |
| NFR-SC3 | Code Node execution sandboxing (no host filesystem access, network restricted) | Required |
| NFR-SC4 | Secrets never logged or exposed in UI (masked) | Required |
| NFR-SC5 | Penetration testing before GA | By external firm |
| NFR-SC6 | SOC 2 Type II audit readiness (Scale tier) | Within 12 months of GA |

### 8.5 Usability & Accessibility

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-U1 | WCAG 2.1 AA compliance for the web UI | Required |
| NFR-U2 | Keyboard-navigable workflow builder | Required |
| NFR-U3 | Documentation: every node type has a reference page with examples | Required at launch |
| NFR-U4 | In-app onboarding tour for first-time users | Required |
| NFR-U5 | Localization: UI available in English, Spanish, German, French, Portuguese at launch | Required |

### 8.6 Maintainability & Extensibility

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-M1 | Plugin architecture for custom node types | Required |
| NFR-M2 | Public API for all workflow operations (CRUD, execute, history) | Required |
| NFR-M3 | Infrastructure-as-code: all configuration expressible as code (no click-ops required) | Required |
| NFR-M4 | Automated upgrade path (Core tier: docker pull + restart; Scale tier: Helm upgrade) | Required |
| NFR-M5 | Backward compatibility: workflow definitions from v1.0 run on v1.x | Required |

---

## 9. Data & State Requirements

### 9.1 State Categories

| Category | Description | Backend (Core) | Backend (Scale) |
|----------|-------------|----------------|-----------------|
| Workflow definitions | Node graph, configuration, version history | SQLite + git | PostgreSQL + git |
| Execution state | In-flight workflow runs, node status, intermediate values | SQLite (in-memory for active) | PostgreSQL + Redis |
| Execution history | Completed run records, I/O payloads, logs | SQLite (configurable retention) | PostgreSQL (configurable retention) |
| Credentials & secrets | API keys, OAuth tokens, passwords | Encrypted SQLite | HashiCorp Vault or encrypted PostgreSQL |
| Audit log | Immutable record of all state-changing operations | Append-only SQLite | Append-only PostgreSQL |
| Configuration | System settings, RBAC, data residency policies | SQLite | PostgreSQL |

### 9.2 Data Retention

| Data Type | Default Retention | Configurable |
|-----------|-------------------|--------------|
| Execution history (full I/O) | 30 days | Yes (1 day – unlimited) |
| Execution history (summary) | 365 days | Yes |
| Audit log | Unlimited (append-only) | No (immutable by design) |
| Workflow versions | All versions retained | Yes (prune old versions) |
| Logs (stdout/stderr from Code Nodes) | 7 days | Yes |

### 9.3 Data Models (Key Entities)

**Workflow**
- `id` (UUID)
- `name` (string)
- `description` (string)
- `definition` (JSON: node graph)
- `version` (integer, auto-increment)
- `created_at`, `updated_at` (timestamps)
- `created_by`, `updated_by` (user IDs)
- `tags` (list of strings)
- `status` (draft | active | archived)

**WorkflowExecution**
- `id` (UUID)
- `workflow_id` (FK)
- `workflow_version` (integer)
- `trigger_type` (manual | cron | webhook | event)
- `trigger_payload` (JSON)
- `status` (pending | running | succeeded | failed | cancelled | paused)
- `started_at`, `completed_at` (timestamps)
- `duration_ms` (integer)
- `error` (string, nullable)

**NodeExecution**
- `id` (UUID)
- `execution_id` (FK)
- `node_id` (string, references workflow definition)
- `status` (pending | running | succeeded | failed | skipped)
- `input` (JSON)
- `output` (JSON)
- `error` (string, nullable)
- `started_at`, `completed_at` (timestamps)
- `retry_count` (integer)

**AuditEvent**
- `id` (UUID)
- `timestamp` (timestamp)
- `actor` (user ID or system)
- `action` (string: workflow.created, workflow.executed, config.changed, etc.)
- `resource_type` (workflow, config, user, etc.)
- `resource_id` (UUID)
- `details` (JSON)
- `ip_address` (string)

### 9.4 Data Flow & Sovereignty

- All state is stored locally by default. No replication to external services unless explicitly configured (Scale tier multi-region).
- Execution I/O payloads are encrypted at rest using AES-256 with a deployment-specific key.
- Secrets are encrypted with a separate key and never appear in logs or UI.
- Data residency enforcement: before any outbound network call, the engine checks the destination against the egress policy. Blocked calls raise an alert and fail the node.
- Backup exports are encrypted and can be stored on customer-controlled storage (S3-compatible, NFS, etc.).

### 9.5 Migration & Portability

- Workflow definitions are stored as portable JSON/YAML; can be exported and imported across deployments.
- State backend migration: SQLite → PostgreSQL tool provided for Core → Scale upgrades.
- No vendor lock-in: all data can be exported in open formats (JSON, CSV for logs).

---

## 10. Assumptions & Constraints

### 10.1 Assumptions

| # | Assumption | Risk if Wrong |
|---|------------|---------------|
| A1 | ODW agent modules (Vault, Desk, Recap) expose stable APIs or event buses that Loop can integrate with | High — delays launch, requires re-architecture |
| A2 | Target customers have infrastructure expertise to self-host (Docker, K8s) or can hire someone who does | Medium — reduces addressable market, increases support burden |
| A3 | Local LLMs (Ollama, vLLM) are performant enough for workflow-embedded inference on commodity hardware | Medium — users forced to use remote APIs, undermining sovereignty story |
| A4 | SMBs in regulated contexts prioritize data sovereignty over convenience and will accept self-hosting complexity | Medium — market smaller than projected |
| A5 | ODW.ai can sustain open-core economics: free tier drives adoption, paid tier converts at ≥ 8% | High — business model fails if conversion is too low |
| A6 | Git is an acceptable version-control backend for workflow definitions (users have git or Loop bundles it) | Low — can swap to internal VFS if needed |
| A7 | SQLite is sufficient for Core-tier state (single-instance, moderate concurrency) | Low — can cap Core tier at lower concurrency if needed |
| A8 | Premium connectors (SAP, Salesforce, ServiceNow) can be built by a small team in 6 months | Medium — delays Scale tier GA |

### 10.2 Constraints

| # | Constraint | Impact |
|---|------------|--------|
| C1 | Loop must run fully offline (air-gapped) — no mandatory cloud callbacks | Limits integration options; must bundle or proxy all dependencies |
| C2 | No telemetry without explicit opt-in | Reduces product analytics; must rely on self-reported feedback and deployment pings (opt-in) |
| C3 | Open-source core (Apache 2.0 or similar) | Limits proprietary differentiation to Scale-tier features |
| C4 | Must integrate with ODW agent modules as they exist today (APIs may evolve) | Requires tight coupling; abstract via adapter layer |
| C5 | Target market is SMB (price-sensitive, small IT teams) | UX must be simpler than enterprise tools; docs must be excellent |
| C6 | v1.0 must ship within 9 months | Scope must be ruthlessly prioritized; P2 features deferred |
| C7 | Code Node must be sandboxed (no host access) | Limits what custom code can do; must provide rich built-in primitives |
| C8 | Must support at least 5 LLM providers at launch | Engineering effort to abstract model differences |

---

## 11. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | ODW agent APIs change or are unstable, breaking Loop integrations | High | High | Define stable integration contracts (OpenAPI specs) between Loop and each ODW module; version-pin connectors; adapter layer absorbs changes |
| R2 | Self-hosting complexity deters target market | Medium | High | Invest in one-command install (Docker Compose), extensive docs, video tutorials; offer paid deployment assistance (Scale tier) |
| R3 | Local LLMs too slow for production workflows | Medium | Medium | Benchmark early; provide guidance on hardware requirements; support remote APIs as fallback (with sovereignty warnings); optimize prompt caching |
| R4 | Open-core conversion rate below 8% | Medium | High | Validate pricing with beta users; ensure free tier is genuinely useful (not crippled); add compelling Scale-tier features (HA, control plane) that enterprises need |
| R5 | Competitors (n8n, Activepieces) add ODW-like agent integrations, eroding differentiation | Medium | Medium | Move fast on ODW-native features (semantic types, deep RAG integration); build network effects via templates and community (post-v1.0) |
| R6 | Security vulnerability in Code Node sandbox escape | Low | Critical | Use gVisor or Firecracker for Code Node isolation; regular pen testing; bug bounty program post-GA |
| R7 | Scope creep delays v1.0 launch | High | High | Ruthless P0/P1/P2 prioritization; P2 features deferred; bi-weekly scope reviews with product lead |
| R8 | SMB market too small to sustain business | Medium | High | Validate market size with beta cohort; if too small, pivot messaging to mid-market (200–1,000 employees) |
| R9 | Multi-region HA (Scale tier) harder than expected | Medium | Medium | Start with active-passive (simpler); promote to active-active in v1.1 if demand warrants |
| R10 | Premium connector development slower than expected | Medium | Medium | Prioritize connectors by beta-user demand; defer low-demand connectors to v1.1 |
| R11 | Git-backed versioning too complex for non-engineers | Low | Medium | Abstract git behind UI; users see "versions" not "commits"; power users can access git directly |
| R12 | Air-gapped deployment breaks when users need to install updates | Medium | Low | Provide offline update packages (signed tarballs); document air-gapped update procedure |

---

## 12. Dependencies

### 12.1 Internal Dependencies

| Dependency | Owner | Status | Risk |
|------------|-------|--------|------|
| Vault API stability and event bus | ODW Vault team | In development | High — Loop can't integrate without stable API |
| Desk API stability and event bus | ODW Desk team | In development | High — same as above |
| Recap API stability and event bus | ODW Recap team | In development | High — same as above |
| ODW agent manifest specification | ODW Platform team | Design phase | Medium — needed for generic connector |
| ODW branding and design system | ODW Design team | Available | Low |
| ODW documentation infrastructure | ODW Docs team | Available | Low |

### 12.2 External Dependencies

| Dependency | Purpose | Risk | Mitigation |
|------------|---------|------|------------|
| Docker & Docker Compose | Core-tier deployment | Low — ubiquitous | None |
| Kubernetes & Helm | Scale-tier deployment | Low — standard | None |
| SQLite | Core-tier state backend | Low — mature, bundled | None |
| PostgreSQL | Scale-tier state backend | Low — mature | None |
| Redis | Scale-tier execution state (in-flight runs) | Low — mature | None |
| Ollama / vLLM / llama.cpp | Local LLM inference | Medium — evolving ecosystem | Support multiple backends; abstract via provider interface |
| OpenAI / Anthropic / Azure / Bedrock / Vertex APIs | Remote LLM inference | Low — stable APIs | Abstract via provider interface; swap if needed |
| HashiCorp Vault | Secrets management (optional) | Low — mature | None; env vars as fallback |
| Git (bundled or system) | Workflow versioning | Low — ubiquitous | Bundle libgit2 if system git unavailable |
| gVisor or Firecracker | Code Node sandboxing | Medium — operational complexity | Evaluate both in PoC; choose based on perf vs. complexity |
| React / Next.js | Web UI | Low — mature | None |
| Python 3.11+ | Code Node runtime, backend | Low — mature | None |
| TypeScript / Node.js | Backend services, web UI | Low — mature | None |

### 12.3 Critical Path Dependencies

The following must be resolved before Loop v1.0 can ship:

1. **ODW agent API contracts finalized** — Vault, Desk, Recap teams must publish stable OpenAPI specs and event schemas.
2. **Code Node sandbox PoC complete** — must demonstrate secure isolation with acceptable performance overhead (< 100ms cold start).
3. **Pricing validation with beta users** — must confirm willingness to pay for Scale tier at proposed price points.
4. **Air-gapped deployment validated** — must demonstrate full functionality with zero outbound network.

---

## 13. Open Questions

| # | Question | Owner | Due Date | Impact |
|---|----------|-------|----------|--------|
| OQ1 | Should Loop's open-source license be Apache 2.0 (permissive) or AGPL (copyleft, prevents cloud providers from competing)? | Product + Legal | Before GA | Affects competitive moat and community adoption |
| OQ2 | What is the maximum acceptable cold-start latency for Code Node execution? (gVisor ~200ms, Firecracker ~125ms, Docker ~500ms) | Engineering | PoC phase | Affects sandbox technology choice |
| OQ3 | Should workflow definitions be stored in git (user-visible, power-user friendly) or an internal VFS (simpler UX, abstracted)? | Product + Engineering | Before v1.0 feature freeze | Affects UX complexity and power-user appeal |
| OQ4 | What is the minimum viable set of premium connectors for Scale tier GA? (SAP, Salesforce, ServiceNow — all 3, or subset?) | Product + Sales | Before Scale tier development | Affects time-to-market for paid tier |
| OQ5 | Should Loop support workflow execution on edge devices (IoT, branch offices) in v1.0, or defer to v2.0? | Product | Before v1.0 scope lock | Affects architecture (edge runtime, sync) |
| OQ6 | How do we handle schema evolution for ODW agent APIs? (backward-compatible only, or versioned with migration tooling?) | ODW Platform team | Before integration development | Affects integration stability and maintenance burden |
| OQ7 | Should the free tier include execution history beyond 30 days, or is that a Scale-tier feature? | Product + Business | Before pricing finalization | Affects free-tier attractiveness vs. conversion incentive |
| OQ8 | What is the target market size (TAM/SAM/SOM) for sovereign agent orchestration in SMBs? Do we need to expand to mid-market? | Product + Market Research | Before launch | Affects business viability and go-to-market strategy |
| OQ9 | Should Loop provide a managed hosting option (ODW-operated, for customers who can't self-host) despite the sovereignty positioning? | Product + Leadership | Before GA | Affects positioning, infrastructure costs, and sovereignty claims |
| OQ10 | How do we handle multi-tenancy if a single deployment serves multiple teams/departments with different data access rules? | Engineering + Product | Before Scale tier development | Affects data model and RBAC complexity |
| OQ11 | What is the upgrade path from Core (SQLite) to Scale (PostgreSQL)? In-place migration, or export/import? | Engineering | Before Scale tier GA | Affects customer migration experience |
| OQ12 | Should Loop support workflow execution triggered by ODW agent-to-agent communication (not just user-facing events)? | ODW Platform + Loop | Before v1.0 | Affects event model and integration depth |
| OQ13 | What is the acceptable error rate for webhook triggers? (If a webhook fails to deliver, do we retry, or drop?) | Engineering | Before v1.0 | Affects reliability guarantees |
| OQ14 | Should Loop provide a CLI for workflow management (CI/CD integration), or is the API sufficient? | Engineering + DX | Before v1.0 | Affects developer experience and automation capabilities |
| OQ15 | How do we measure "sovereignty" quantitatively for marketing and compliance purposes? (Zero egress? Zero cloud dependencies? Zero telemetry?) | Product + Legal + Marketing | Before launch messaging | Affects positioning and compliance claims |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **ODW.ai** | The parent product suite of sovereign AI agents (Vault, Desk, Recap, and future modules) |
| **Vault** | ODW's knowledge base agent — stores, retrieves, and reasons over documents |
| **Desk** | ODW's workspace/productivity agent — tasks, projects, calendar |
| **Recap** | ODW's meeting intelligence agent — transcripts, summaries, action items |
| **Sovereign** | Data stays on the customer's infrastructure; no mandatory cloud egress |
| **Air-gapped** | Deployment with zero outbound network connectivity |
| **Core tier** | Free, single-instance deployment |
| **Scale tier** | Paid, multi-instance, HA, with premium features |
| **Node** | A single step in a workflow (e.g., "Extract action items from transcript") |
| **Edge** | A connection between two nodes, defining data flow |
| **Code Node** | A workflow node that executes user-written Python or TypeScript |
| **Semantic type** | A typed workflow object (Document, Transcript, ActionItem) that carries meaning across agents |
| **Control plane** | Unified dashboard for managing multiple Loop instances (Scale tier) |

---

## Appendix B: Competitive Landscape

| Tool | Self-Hosted | Sovereign-First | ODW Agent Integration | Low-Code | Open Source |
|------|-------------|-----------------|----------------------|----------|-------------|
| **Loop** | ✅ | ✅ (core design principle) | ✅ (native, deep) | ✅ | ✅ (core) |
| n8n | ✅ | ❌ (cloud-dependent features) | ❌ (generic webhooks only) | ✅ | ✅ (fair-code) |
| Activepieces | ✅ | ❌ | ❌ | ✅ | ✅ |
| Flowise | ✅ | ❌ | ❌ (LangChain-focused) | ✅ | ✅ |
| Langflow | ✅ | ❌ | ❌ (LangChain-focused) | ✅ | ✅ |
| AutoGen | ✅ | ❌ | ❌ (Microsoft ecosystem) | ❌ (code-first) | ✅ |
| CrewAI | ✅ | ❌ | ❌ (Python-first) | ❌ (code-first) | ✅ |

**Loop's defensible moat:** Native, semantic integration with ODW's sovereign agents. No other orchestrator understands Vault documents, Recap transcripts, or Desk tasks as first-class objects.

---

## Appendix C: Release Plan (High-Level)

| Milestone | Target Date | Scope |
|-----------|-------------|-------|
| Alpha (internal) | Month 3 | Core workflow engine, Vault integration, basic UI |
| Beta (closed, 20 customers) | Month 6 | All ODW integrations, Code Node, full UI, Docker Compose deploy |
| GA (Core tier, public) | Month 9 | Full Core tier feature set, docs, community launch |
| Scale tier Beta | Month 12 | Multi-instance, HA, control plane, premium connectors |
| Scale tier GA | Month 15 | Full Scale tier, enterprise sales launch |

---

## Appendix D: Open Source Landscape & Reference Implementations (Added 2026-06-24)

### D.1 Competitive Landscape Update

Based on comprehensive research of 12 open-source workflow/agent orchestration platforms conducted June 2026:

| Platform | Stars (2026) | License | Category | Threat Level |
|----------|-------------|---------|----------|-------------|
| n8n | 180K+ | Fair-code (SUL) | Visual workflow automation | Medium — largest community, but not sovereign-first |
| Langflow | 130K+ | MIT | Visual LLM workflow builder | Low — LangChain-focused, not general orchestration |
| CrewAI | 44K+ | MIT | Multi-agent framework | Low — code-first, no visual builder |
| Apache Airflow | 38K+ | Apache 2.0 | Data pipeline orchestration | Low — data engineering focus, not agent orchestration |
| Flowise | 31K+ | Apache 2.0 | Visual LLM flow builder | Low — LangChain-focused, limited to AI chains |
| AutoGen | 32K+ | MIT | Multi-agent framework | Low — code-first, Microsoft ecosystem |
| Activepieces | 25K+ | MIT | Visual workflow automation | Medium — closest competitor, MIT-licensed, AI-first |
| Prefect | 18K+ | Apache 2.0 | Data workflow orchestration | Low — data pipeline focus |
| Windmill | 16K+ | AGPLv3 | Code-first workflow engine | Low — AGPL license limits adoption |
| Temporal | 12K+ | MIT | Durable execution platform | Low — infrastructure, not end-user product |
| Trigger.dev | 10K+ | Apache 2.0 | TypeScript durable workflows | Low — developer tool, not visual builder |
| Inngest | 5K+ | Apache 2.0 | Event-driven workflows | Low — developer tool |

### D.2 Loop's Competitive Moat (Validated)

The research confirms Loop's defensible positioning from Appendix B:

1. **No competitor combines visual workflow building + sovereign agent orchestration.** n8n and Activepieces are visual but lack native ODW agent integration. AutoGen and CrewAI are agent-focused but lack visual builders.
2. **Sovereignty as architecture, not option.** No competitor treats data sovereignty as a first-class design constraint. Activepieces and n8n offer self-hosting but depend on cloud features.
3. **Semantic type system is unique.** No competitor understands agent primitives (Document, Transcript, ActionItem) as typed workflow objects.

### D.3 License Recommendation

Based on research, **Apache 2.0** is recommended for the Core tier:
- Most successful workflow engines use permissive licenses (Temporal, Flowise, Prefect, Trigger.dev)
- Apache 2.0 allows commercial Scale tier differentiation
- MIT (Activepieces, CrewAI) is also viable but Apache 2.0 adds patent protection
- AGPLv3 (Windmill) limits commercial adoption — avoid
- Fair-code/SUL (n8n) restricts competing SaaS but reduces community adoption

### D.4 Reference Repositories

The following open-source repositories have been cloned to `reference/` for implementation reference:

| Repository | Path | Use For |
|-----------|------|---------|
| Activepieces | `reference/activepieces/` | Piece SDK pattern, trigger system, monorepo structure, React Flow canvas |
| n8n | `reference/n8n/` | Node execution engine, credential management, webhook handling, error routing |
| Flowise | `reference/Flowise/` | React Flow visual builder, LLM integration patterns |
| Trigger.dev | `reference/trigger.dev/` | Durable execution engine, retry logic, TypeScript-first API design |
| Inngest | `reference/inngest/` | Event-driven step functions, event matching |
| Windmill | `reference/windmill/` | Multi-language execution, Rust performance patterns, RBAC |

### D.5 Key Findings That Validate PRD Decisions

1. **React Flow is the correct canvas choice** — Used by Flowise, Langflow, and Activepieces. It's the de facto standard for visual workflow editors in the React ecosystem.
2. **Code Node sandboxing MUST be OS-level** — n8n suffered two critical sandbox escape CVEs in 2025 (severity 9.9) with VM/WASM-based sandboxing. Loop's gVisor/Firecracker choice (FR-S11) is validated.
3. **SQLite for Core tier is validated** — Multiple successful platforms (Activepieces, n8n dev mode, Restate) use SQLite for single-instance deployments.
4. **Model-agnostic LLM abstraction is table stakes** — All successful AI workflow tools support multiple LLM providers through an abstraction layer.
5. **MCP (Model Context Protocol) support should be on the roadmap** — Becoming standard for AI tool integration across Langflow, AutoGen, and Activepieces.

---

**End of Document**
