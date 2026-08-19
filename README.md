# dsh-roast-office

`dsh-roast-office` observes Agent tool results and emits deterministic behavior findings plus a turn-level behavior report with optional roast-style feedback. It never blocks, rewrites, delays, or retries a tool call. The package is a presentation layer over existing loop facts; `dsh-repeat-tool-reminder` remains the owner of repeat-call model guidance.

This repository is an independent dsh plugin project. It targets published dsh package APIs instead of importing monorepo workspace paths.

## Run the demo

The demo builds the package, loads the real compiled plugin entrypoint, simulates a source mutation followed by a failed test, and prints the roast plus the structured report:

```sh
npm run build
npm run demo
```

For a one-command run after dependencies are installed, use `npm run demo:build`.

The plugin can also be mounted by a dsh Cordis composition after the package is installed and built:

```yaml
- '@dsh-plugins/roast-office':
    style: roast
    channels: [console]
    reportChannel: event
```

It is observational only: it calls `next()` on the tool waterfall and returns the downstream decision unchanged.

## Config

```yaml
- id: roast-office
  name: '@dsh-plugins/roast-office'
  config:
    style: roast
    channels: [context, console]
    repeatThreshold: 3
    failureThreshold: 2
    maxFindingsPerTurn: 3
    cleanFinish: true
    reportChannel: console
    mutationTools: [write, edit, apply_patch, str_replace_editor]
    verificationTools: [test, lint, typecheck, build, check]
    verificationPaths: [src/**, packages/**, examples/**, scripts/**, '*.config.*', package.json, tsconfig*.json]
    historySize: 5
    autoReview: true
    reviewTriggers: [threshold, turn-end]
    maxReviewObservations: 20
```

`style` accepts `neutral`, `gentle`, or `roast`. `context` adds a plugin-sourced notice to the next model request; `console` writes the rendered finding to the context logger. The default configuration enables both channels.

`reportChannel` accepts `console`, `event`, `both`, or `none`. The `event` option emits a structured `roast-office/report` event for UI, telemetry, or other plugins without requiring them to parse logger text. `mutationTools`, `verificationTools`, and `verificationPaths` accept exact names or `*` wildcards. `historySize` controls how many previous scores are retained for trend comparison.

`roast-office/review-request` is the integration point for an independent Reviewer Agent. Automatic requests use `threshold` or `turn-end`; a Web UI can request a review by emitting `roast-office/request-review` with `scope: turn`, `selection`, or `session`. The event contains sanitized tool names, success flags, failure codes, and the deterministic report, not raw tool arguments or file contents. A consumer must dispatch the request to a separate read-only reviewer session and render its result outside the execution conversation.

The plugin keeps the latest completed-turn snapshot in memory, so a manual request still works after the trajectory reaches idle. `selection` and `session` are protocol scopes for the Web consumer; this standalone package currently supplies the latest available snapshot and leaves selection/session retrieval to that consumer.

The observer detects `repeat-call` when one Agent invokes the same tool with canonicalized identical arguments consecutively. It detects `failed-retry` when the same tool and failure code/message repeat consecutively. A mutation only enters the verification window when one of its path-like arguments matches `verificationPaths`; documentation-only paths such as `README.md` are ignored by default. `clean-finish` is emitted to the console when an agent becomes idle after at least one call and includes calls, failures, repeat incidents, failure retries, unique tools, mutations, verification runs, unverified changes, score, risk, and verdict.

Finding facts and reports are deterministic and contain only tool names, counts, and failure summaries needed by the rule. The report exposes stability, completeness, efficiency, and closure scores; the total is their rounded average. It also reports whether the score is `first-turn`, `improving`, `stable`, or `declining` compared with the previous report for the same Agent. Only successful verification runs clear the unverified-change state. Stability accounts for repeats, failed retries, and failure rate. Completeness accounts for unverified source changes. Efficiency tolerates two calls per distinct tool before applying a small call-volume penalty and labels the result `normal`, `watch`, or `stuck`. Closure accounts for failed calls and unverified changes. Scores from 85 are `low` risk, scores from 60 are `medium` risk, and lower scores are `high` risk. The roast renderer targets behavior, never the user's identity or ability. Tool results and policy decisions pass through unchanged.

## Model Experience

### Behavior notices

#### What the model sees

When `context` is enabled, a finding is appended as a plugin-sourced notice after the affected tool result. The notice includes the observed fact, a short recommendation, and the selected style. It does not replace the tool result or change the tool decision.

#### Token effect

No context is added before a rule fires. `maxFindingsPerTurn` bounds additional notices for one turn.

#### KV Cache effect

Notices are append-only additions after the existing tool result and do not rewrite earlier context.

## Extension points

The exported `canonicalize` function defines argument equality for the repeat rule. `buildBehaviorReport`, `BehaviorMetrics`, and `BehaviorReport` are the stable vocabulary for score consumers and future renderer registries. Consumers can subscribe to `roast-office/report` without importing a transport or UI type. Review consumers subscribe to `roast-office/review-request`; the `reviewer: 'independent-agent'` marker makes same-conversation self-review an invalid consumer implementation.

## Known Limitations and Deferred Work

- Reports are emitted at the agent idle transition and are not persisted as a new session event.
- `clean-finish` is logger-only because the status event does not carry a post-turn decision context.
- Failure matching includes the full normalized error message, so similar failures with different dynamic text do not coalesce.
- Trend history is held in memory and resets when the plugin is reloaded.
- Search-without-progress and scope drift remain deferred until their evidence windows are defined.
