# dsh-roast-office

`dsh-roast-office` observes Agent tool results and emits deterministic behavior findings plus a turn-level behavior report with optional roast-style feedback. It never blocks, rewrites, delays, or retries a tool call. The package is a presentation layer over existing loop facts; `dsh-repeat-tool-reminder` remains the owner of repeat-call model guidance.

This repository is an independent dsh plugin project. It targets published dsh package APIs instead of importing monorepo workspace paths.

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
```

`style` accepts `neutral`, `gentle`, or `roast`. `context` adds a plugin-sourced notice to the next model request; `console` writes the rendered finding to the context logger. The default configuration enables both channels.

`reportChannel` accepts `console`, `event`, `both`, or `none`. The `event` option emits a structured `roast-office/report` event for UI, telemetry, or other plugins without requiring them to parse logger text. `mutationTools` and `verificationTools` accept exact names or `*` wildcards.

The observer detects `repeat-call` when one Agent invokes the same tool with canonicalized identical arguments consecutively. It detects `failed-retry` when the same tool and failure code/message repeat consecutively. `clean-finish` is emitted to the console when an agent becomes idle after at least one call and includes calls, failures, repeat incidents, failure retries, unique tools, mutations, verification runs, unverified changes, score, risk, and verdict.

Finding facts and reports are deterministic and contain only tool names, counts, and failure summaries needed by the rule. The score starts at 100, subtracts 20 per repeat incident, 15 per failure-retry incident, 20 per unverified change window, and up to 30 for the failure rate. A mutation remains unverified until a configured verification tool runs later in the same turn. Scores from 85 are `low` risk, scores from 60 are `medium` risk, and lower scores are `high` risk. The roast renderer targets behavior, never the user's identity or ability. Tool results and policy decisions pass through unchanged.

## Model Experience

### Behavior notices

#### What the model sees

When `context` is enabled, a finding is appended as a plugin-sourced notice after the affected tool result. The notice includes the observed fact, a short recommendation, and the selected style. It does not replace the tool result or change the tool decision.

#### Token effect

No context is added before a rule fires. `maxFindingsPerTurn` bounds additional notices for one turn.

#### KV Cache effect

Notices are append-only additions after the existing tool result and do not rewrite earlier context.

## Extension points

The exported `canonicalize` function defines argument equality for the repeat rule. `buildBehaviorReport`, `BehaviorMetrics`, and `BehaviorReport` are the stable vocabulary for score consumers and future renderer registries. Consumers can subscribe to `roast-office/report` without importing a transport or UI type.

## Known Limitations and Deferred Work

- Reports are emitted at the agent idle transition and are not persisted as a new session event.
- `clean-finish` is logger-only because the status event does not carry a post-turn decision context.
- Failure matching includes the full normalized error message, so similar failures with different dynamic text do not coalesce.
- Search-without-progress and scope drift remain deferred until their evidence windows are defined.
