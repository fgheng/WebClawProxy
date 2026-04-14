<tools>
<tool>
name: read
description: Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.
parameters:
- path(string, required): Path to the file to read (relative or absolute)
- offset(number): Line number to start reading from (1-indexed)
- limit(number): Maximum number of lines to read
</tool>

<tool>
name: edit
description: Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.
parameters:
- path(string, required): Path to the file to edit (relative or absolute)
- edits(array, required): One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.
</tool>

<tool>
name: write
description: Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.
parameters:
- path(string, required): Path to the file to write (relative or absolute)
- content(string, required): Content to write to the file
</tool>

<tool>
name: apply_patch
description: Apply a patch to one or more files using the apply_patch format. The input should include *** Begin Patch and *** End Patch markers.
parameters:
- input(string, required): Patch content using the *** Begin Patch/End Patch format.
</tool>

<tool>
name: exec
description: Execute shell commands with background continuation for work that starts now. Use yieldMs/background to continue later via process tool. For long-running work started now, rely on automatic completion wake when it is enabled and the command emits output or fails; otherwise use process to confirm completion. Use process whenever you need logs, status, input, or intervention. Do not use exec sleep or delay loops for reminders or deferred follow-ups; use cron instead. Use pty=true for TTY-required commands (terminal UIs, coding agents).
parameters:
- command(string, required): Shell command to execute
- workdir(string): Working directory (defaults to cwd)
- env(object)
- yieldMs(number): Milliseconds to wait before backgrounding (default 10000)
- background(boolean): Run in background immediately
- timeout(number): Timeout in seconds (optional, kills process on expiry)
- pty(boolean): Run in a pseudo-terminal (PTY) when available (TTY-required CLIs, coding agents)
- elevated(boolean): Run on the host with elevated permissions (if allowed)
- host(string): Exec host/target (auto|sandbox|gateway|node).
- security(string): Exec security mode (deny|allowlist|full).
- ask(string): Exec ask mode (off|on-miss|always).
- node(string): Node id/name for host=node.
</tool>

<tool>
name: process
description: Manage running exec sessions for commands already started: list, poll, log, write, send-keys, submit, paste, kill. Use poll/log when you need status, logs, quiet-success confirmation, or completion confirmation when automatic completion wake is unavailable. Use write/send-keys/submit/paste/kill for input or intervention. Do not use process polling to emulate timers or reminders; use cron for scheduled follow-ups.
parameters:
- action(string, required): Process action
- sessionId(string): Session id for actions other than list
- data(string): Data to write for write
- keys(array): Key tokens to send for send-keys
- hex(array): Hex bytes to send for send-keys
- literal(string): Literal string for send-keys
- text(string): Text to paste for paste
- bracketed(boolean): Wrap paste in bracketed mode
- eof(boolean): Close stdin after write
- offset(number): Log offset
- limit(number): Log length
- timeout(number): For poll: wait up to this many milliseconds before returning
</tool>

<tool>
name: canvas
description: Control node canvases (present/hide/navigate/eval/snapshot/A2UI). Use snapshot to capture the rendered UI.
parameters:
- action(string, required)
- gatewayUrl(string)
- gatewayToken(string)
- timeoutMs(number)
- node(string)
- target(string)
- x(number)
- y(number)
- width(number)
- height(number)
- url(string)
- javaScript(string)
- outputFormat(string)
- maxWidth(number)
- quality(number)
- delayMs(number)
- jsonl(string)
- jsonlPath(string)
</tool>

<tool>
name: nodes
description: Discover and control paired nodes (status/describe/pairing/notify/camera/photos/screen/location/notifications/invoke).
parameters:
- action(string, required)
- gatewayUrl(string)
- gatewayToken(string)
- timeoutMs(number)
- node(string)
- requestId(string)
- title(string)
- body(string)
- sound(string)
- priority(string)
- delivery(string)
- facing(string): camera_snap: front/back/both; camera_clip: front/back only.
- maxWidth(number)
- quality(number)
- delayMs(number)
- deviceId(string)
- limit(number)
- duration(string)
- durationMs(number)
- includeAudio(boolean)
- fps(number)
- screenIndex(number)
- outPath(string)
- maxAgeMs(number)
- locationTimeoutMs(number)
- desiredAccuracy(string)
- notificationAction(string)
- notificationKey(string)
- notificationReplyText(string)
- invokeCommand(string)
- invokeParamsJson(string)
- invokeTimeoutMs(number)
</tool>

<tool>
name: cron
description: Manage Gateway cron jobs (status/list/add/update/remove/run/runs) and send wake events. Use this for reminders, "check back later" requests, delayed follow-ups, and recurring tasks. Do not emulate scheduling with exec sleep or process polling.

Main-session cron jobs enqueue system events for heartbeat handling. Isolated cron jobs create background task runs that appear in `openclaw tasks`.

ACTIONS:
- status: Check cron scheduler status
- list: List jobs (use includeDisabled:true to include disabled)
- add: Create job (requires job object, see schema below)
- update: Modify job (requires jobId + patch object)
- remove: Delete job (requires jobId)
- run: Trigger job immediately (requires jobId)
- runs: Get job run history (requires jobId)
- wake: Send wake event (requires text, optional mode)

JOB SCHEMA (for add action):
{
  "name": "string (optional)",
  "schedule": { ... },      // Required: when to run
  "payload": { ... },       // Required: what to execute
  "delivery": { ... },      // Optional: announce summary (isolated/current/session:xxx only) or webhook POST
  "sessionTarget": "main" | "isolated" | "current" | "session:<custom-id>",  // Optional, defaults based on context
  "enabled": true | false   // Optional, default true
}

SESSION TARGET OPTIONS:
- "main": Run in the main session (requires payload.kind="systemEvent")
- "isolated": Run in an ephemeral isolated session (requires payload.kind="agentTurn")
- "current": Bind to the current session where the cron is created (resolved at creation time)
- "session:<custom-id>": Run in a persistent named session (e.g., "session:project-alpha-daily")

DEFAULT BEHAVIOR (unchanged for backward compatibility):
- payload.kind="systemEvent" → defaults to "main"
- payload.kind="agentTurn" → defaults to "isolated"
To use current session binding, explicitly set sessionTarget="current".

SCHEDULE TYPES (schedule.kind):
- "at": One-shot at absolute time
  { "kind": "at", "at": "<ISO-8601 timestamp>" }
- "every": Recurring interval
  { "kind": "every", "everyMs": <interval-ms>, "anchorMs": <optional-start-ms> }
- "cron": Cron expression
  { "kind": "cron", "expr": "<cron-expression>", "tz": "<optional-timezone>" }

ISO timestamps without an explicit timezone are treated as UTC.

PAYLOAD TYPES (payload.kind):
- "systemEvent": Injects text as system event into session
  { "kind": "systemEvent", "text": "<message>" }
- "agentTurn": Runs agent with message (isolated sessions only)
  { "kind": "agentTurn", "message": "<prompt>", "model": "<optional>", "thinking": "<optional>", "timeoutSeconds": <optional, 0 means no timeout> }

DELIVERY (top-level):
  { "mode": "none|announce|webhook", "channel": "<optional>", "to": "<optional>", "bestEffort": <optional-bool> }
  - Default for isolated agentTurn jobs (when delivery omitted): "announce"
  - announce: send to chat channel (optional channel/to target)
  - webhook: send finished-run event as HTTP POST to delivery.to (URL required)
  - If the task needs to send to a specific chat/recipient, set announce delivery.channel/to; do not call messaging tools inside the run.

CRITICAL CONSTRAINTS:
- sessionTarget="main" REQUIRES payload.kind="systemEvent"
- sessionTarget="isolated" | "current" | "session:xxx" REQUIRES payload.kind="agentTurn"
- For webhook callbacks, use delivery.mode="webhook" with delivery.to set to a URL.
Default: prefer isolated agentTurn jobs unless the user explicitly wants current-session binding.

WAKE MODES (for wake action):
- "next-heartbeat" (default): Wake on next heartbeat
- "now": Wake immediately

Use jobId as the canonical identifier; id is accepted for compatibility. Use contextMessages (0-10) to add previous messages as context to the job text.
parameters:
- action(string, required)
- gatewayUrl(string)
- gatewayToken(string)
- timeoutMs(number)
- includeDisabled(boolean)
- job(object)
- jobId(string)
- id(string)
- patch(object)
- text(string)
- mode(string)
- runMode(string)
- contextMessages(number)
</tool>

<tool>
name: message
description: Send, delete, and manage messages via channel plugins. Supports actions: send, broadcast.
parameters:
- action(string, required)
- channel(string)
- target(string): Target channel/user id or name.
- targets(array)
- accountId(string)
- dryRun(boolean)
- message(string)
- effectId(string): Message effect name/id for sendWithEffect (e.g., invisible ink).
- effect(string): Alias for effectId (e.g., invisible-ink, balloons).
- media(string): Media URL or local path. data: URLs are not supported here, use buffer.
- filename(string)
- buffer(string): Base64 payload for attachments (optionally a data: URL).
- contentType(string)
- mimeType(string)
- caption(string)
- path(string)
- filePath(string)
- replyTo(string)
- threadId(string)
- asVoice(boolean)
- silent(boolean)
- quoteText(string): Quote text for Telegram reply_parameters
- bestEffort(boolean)
- gifPlayback(boolean)
- forceDocument(boolean): Send image/GIF as document to avoid Telegram compression (Telegram only).
- asDocument(boolean): Send image/GIF as document to avoid Telegram compression. Alias for forceDocument (Telegram only).
- messageId(string): Target message id for reaction. If omitted, defaults to the current inbound message id when available.
- message_id(string): snake_case alias of messageId. If omitted, defaults to the current inbound message id when available.
- emoji(string)
- remove(boolean)
- targetAuthor(string)
- targetAuthorUuid(string)
- groupId(string)
- limit(number)
- pageSize(number)
- pageToken(string)
- before(string)
- after(string)
- around(string)
- fromMe(boolean)
- includeArchived(boolean)
- pollId(string)
- pollOptionId(string): Poll answer id to vote for. Use when the channel exposes stable answer ids.
- pollOptionIds(array)
- pollOptionIndex(number): 1-based poll option number to vote for, matching the rendered numbered poll choices.
- pollOptionIndexes(array)
- pollQuestion(string)
- pollOption(array)
- pollDurationHours(number)
- pollMulti(boolean)
- channelId(string): Channel id filter (search/thread list/event create).
- chatId(string): Chat id for chat-scoped metadata actions.
- channelIds(array)
- memberId(string)
- memberIdType(string)
- guildId(string)
- userId(string)
- openId(string)
- unionId(string)
- authorId(string)
- authorIds(array)
- roleId(string)
- roleIds(array)
- participant(string)
- includeMembers(boolean)
- members(boolean)
- scope(string)
- kind(string)
- emojiName(string)
- stickerId(array)
- stickerName(string)
- stickerDesc(string)
- stickerTags(string)
- threadName(string)
- autoArchiveMin(number)
- appliedTags(array)
- query(string)
- eventName(string)
- eventType(string)
- startTime(string)
- endTime(string)
- desc(string)
- location(string)
- durationMin(number)
- until(string)
- reason(string)
- deleteDays(number)
- gatewayUrl(string)
- gatewayToken(string)
- timeoutMs(number)
- name(string)
- type(number)
- parentId(string)
- topic(string)
- position(number)
- nsfw(boolean)
- rateLimitPerUser(number)
- categoryId(string)
- clearParent(boolean): Clear the parent/category when supported by the provider.
- activityType(string): Activity type: playing, streaming, listening, watching, competing, custom.
- activityName(string): Activity name shown in sidebar (e.g. 'with fire'). Ignored for custom type.
- activityUrl(string): Streaming URL (Twitch or YouTube). Only used with streaming type; may not render for bots.
- activityState(string): State text. For custom type this is the status text; for others it shows in the flyout.
- status(string): Bot status: online, dnd, idle, invisible.
</tool>

<tool>
name: tts
description: Convert text to speech. Audio is delivered automatically from the tool result — reply with NO_REPLY after a successful call to avoid duplicate messages.
parameters:
- text(string, required): Text to convert to speech.
- channel(string): Optional channel id to pick output format (e.g. telegram).
</tool>

<tool>
name: image_generate
description: Generate new images or edit reference images with the configured or inferred image-generation model. Set agents.defaults.imageGenerationModel.primary to pick a provider/model. Providers declare their own auth/readiness; use action="list" to inspect registered providers, models, readiness, and auth hints. Generated images are delivered automatically from the tool result as MEDIA paths.
parameters:
- action(string): Optional action: "generate" (default) or "list" to inspect available providers/models.
- prompt(string): Image generation prompt.
- image(string): Optional reference image path or URL for edit mode.
- images(array): Optional reference images for edit mode (up to 5).
- model(string): Optional provider/model override, e.g. openai/gpt-image-1.
- filename(string): Optional output filename hint. OpenClaw preserves the basename and saves under its managed media directory.
- size(string): Optional size hint like 1024x1024, 1536x1024, 1024x1536, 1024x1792, or 1792x1024.
- aspectRatio(string): Optional aspect ratio hint: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, or 21:9.
- resolution(string): Optional resolution hint: 1K, 2K, or 4K. Useful for Google edit/generation flows.
- count(number): Optional number of images to request (1-4).
</tool>

<tool>
name: video_generate
description: Generate videos using configured providers. Generated videos are saved under OpenClaw-managed media storage and delivered automatically as attachments. Duration requests may be rounded to the nearest provider-supported value.
parameters:
- action(string): Optional action: "generate" (default), "status" to inspect the active session task, or "list" to inspect available providers/models.
- prompt(string): Video generation prompt.
- image(string): Optional single reference image path or URL.
- images(array): Optional reference images (up to 5).
- video(string): Optional single reference video path or URL.
- videos(array): Optional reference videos (up to 4).
- model(string): Optional provider/model override, e.g. qwen/wan2.6-t2v.
- filename(string): Optional output filename hint. OpenClaw preserves the basename and saves under its managed media directory.
- size(string): Optional size hint like 1280x720 or 1920x1080 when the provider supports it.
- aspectRatio(string): Optional aspect ratio hint: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, or 21:9.
- resolution(string): Optional resolution hint: 480P, 720P, or 1080P.
- durationSeconds(number): Optional target duration in seconds. OpenClaw may round this to the nearest provider-supported duration.
- audio(boolean): Optional audio toggle when the provider supports generated audio.
- watermark(boolean): Optional watermark toggle when the provider supports it.
</tool>

<tool>
name: gateway
description: Restart, inspect a specific config schema path, apply config, or update the gateway in-place (SIGUSR1). Use config.schema.lookup with a targeted dot path before config edits. Use config.patch for safe partial config updates (merges with existing). Use config.apply only when replacing entire config. Both trigger restart after writing. Always pass a human-readable completion message via the `note` parameter so the system can deliver it to the user after restart.
parameters:
- action(string, required)
- delayMs(number)
- reason(string)
- gatewayUrl(string)
- gatewayToken(string)
- timeoutMs(number)
- path(string)
- raw(string)
- baseHash(string)
- sessionKey(string)
- note(string)
- restartDelayMs(number)
</tool>

<tool>
name: agents_list
description: List OpenClaw agent ids you can target with `sessions_spawn` when `runtime="subagent"` (based on subagent allowlists).
parameters:
</tool>

<tool>
name: update_plan
description: Update the current structured work plan for this run. Use this for non-trivial multi-step work so the plan stays current while execution continues. Keep steps short, mark at most one step as `in_progress`, and skip this tool for simple one-step tasks.
parameters:
- explanation(string): Optional short note explaining what changed in the plan.
- plan(array, required): Ordered list of plan steps. At most one step may be in_progress.
</tool>

<tool>
name: sessions_list
description: List visible sessions with optional filters for kind, recent activity, and last messages. Use this to discover a target session before calling sessions_history or sessions_send.
parameters:
- kinds(array)
- limit(number)
- activeMinutes(number)
- messageLimit(number)
</tool>

<tool>
name: sessions_history
description: Fetch sanitized message history for a visible session. Supports limits and optional tool messages; use this to inspect another session before replying, debugging, or resuming work.
parameters:
- sessionKey(string, required)
- limit(number)
- includeTools(boolean)
</tool>

<tool>
name: sessions_send
description: Send a message into another visible session by sessionKey or label. Use this to delegate follow-up work to an existing session; waits for the target run and returns the updated assistant reply when available.
parameters:
- sessionKey(string)
- label(string)
- agentId(string)
- message(string, required)
- timeoutSeconds(number)
</tool>

<tool>
name: sessions_yield
description: End your current turn. Use after spawning subagents to receive their results as the next message.
parameters:
- message(string)
</tool>

<tool>
name: sessions_spawn
description: Spawn an isolated session with `runtime="subagent"` or `runtime="acp"`. `mode="run"` is one-shot and `mode="session"` is persistent or thread-bound. Subagents inherit the parent workspace directory automatically. Use this when the work should happen in a fresh child session instead of the current one.
parameters:
- task(string, required)
- label(string)
- runtime(string)
- agentId(string)
- resumeSessionId(string): Resume an existing agent session by its ID (e.g. a Codex session UUID from ~/.codex/sessions/). Requires runtime="acp". The agent replays conversation history via session/load instead of starting fresh.
- model(string)
- thinking(string)
- cwd(string)
- runTimeoutSeconds(number)
- timeoutSeconds(number)
- thread(boolean)
- mode(string)
- cleanup(string)
- sandbox(string)
- streamTo(string)
- attachments(array)
- attachAs(object)
</tool>

<tool>
name: subagents
description: List, kill, or steer spawned sub-agents for this requester session. Use this for sub-agent orchestration.
parameters:
- action(string)
- target(string)
- message(string)
- recentMinutes(number)
</tool>

<tool>
name: session_status
description: Show a /status-equivalent session status card for the current or another visible session, including usage, time, cost when available, and linked background task context. Optional `model` sets a per-session model override; `model=default` resets overrides. Use this for questions like what model is active or how a session is configured.
parameters:
- sessionKey(string)
- model(string)
</tool>

<tool>
name: web_search
description: Search the web using DuckDuckGo. Returns titles, URLs, and snippets with no API key required.
parameters:
- query(string, required): Search query string.
- count(number): Number of results to return (1-10).
- region(string): Optional DuckDuckGo region code such as us-en, uk-en, or de-de.
- safeSearch(string): SafeSearch level: strict, moderate, or off.
</tool>

<tool>
name: web_fetch
description: Fetch and extract readable content from a URL (HTML → markdown/text). Use for lightweight page access without browser automation.
parameters:
- url(string, required): HTTP or HTTPS URL to fetch.
- extractMode(string): Extraction mode ("markdown" or "text").
- maxChars(number): Maximum characters to return (truncates when exceeded).
</tool>

<tool>
name: image
description: Analyze one or more images with the configured image model (agents.defaults.imageModel). Use image for a single path/URL, or images for multiple (up to 20). Provide a prompt describing what to analyze.
parameters:
- prompt(string)
- image(string): Single image path or URL.
- images(array): Multiple image paths or URLs (up to maxImages, default 20).
- model(string)
- maxBytesMb(number)
- maxImages(number)
</tool>

<tool>
name: pdf
description: Analyze one or more PDF documents with a model. Supports native PDF analysis for Anthropic and Google models, with text/image extraction fallback for other providers. Use pdf for a single path/URL, or pdfs for multiple (up to 10). Provide a prompt describing what to analyze.
parameters:
- prompt(string)
- pdf(string): Single PDF path or URL.
- pdfs(array): Multiple PDF paths or URLs (up to 10).
- pages(string): Page range to process, e.g. "1-5", "1,3,5-7". Defaults to all pages.
- model(string)
- maxBytesMb(number)
</tool>

<tool>
name: browser
description: Control the browser via OpenClaw's browser control server (status/start/stop/profiles/tabs/open/snapshot/screenshot/actions). Browser choice: omit profile by default for the isolated OpenClaw-managed browser (`openclaw`). For the logged-in user browser on the local host, use profile="user". A supported Chromium-based browser (v144+) must be running. Use only when existing logins/cookies matter and the user is present. When a node-hosted browser proxy is available, the tool may auto-route to it. Pin a node with node=<id|name> or target="node". When using refs from snapshot (e.g. e12), keep the same tab: prefer passing targetId from the snapshot response into subsequent actions (act/click/type/etc). For stable, self-resolving refs across calls, use snapshot with refs="aria" (Playwright aria-ref ids). Default refs="role" are role+name-based. Use snapshot+act for UI automation. Avoid act:wait by default; use only in exceptional cases when no reliable UI state exists. target selects browser location (sandbox|host|node). Default: host. Host target allowed.
parameters:
- action(string, required)
- target(string)
- node(string)
- profile(string)
- targetUrl(string)
- url(string)
- targetId(string)
- limit(number)
- maxChars(number)
- mode(string)
- snapshotFormat(string)
- refs(string)
- interactive(boolean)
- compact(boolean)
- depth(number)
- selector(string)
- frame(string)
- labels(boolean)
- fullPage(boolean)
- ref(string)
- element(string)
- type(string)
- level(string)
- paths(array)
- inputRef(string)
- timeoutMs(number)
- accept(boolean)
- promptText(string)
- kind(string)
- doubleClick(boolean)
- button(string)
- modifiers(array)
- text(string)
- submit(boolean)
- slowly(boolean)
- key(string)
- delayMs(number)
- startRef(string)
- endRef(string)
- values(array)
- fields(array)
- width(number)
- height(number)
- timeMs(number)
- textGone(string)
- loadState(string)
- fn(string)
- request(object)
</tool>

<tool>
name: memory_search
description: Mandatory recall step: semantically search MEMORY.md + memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines. If response has disabled=true, memory retrieval is unavailable and should be surfaced to the user.
parameters:
- query(string, required)
- maxResults(number)
- minScore(number)
</tool>

<tool>
name: memory_get
description: Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.
parameters:
- path(string, required)
- from(number)
- lines(number)
</tool>
</tools>