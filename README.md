# dsh-roast-office

`dsh-roast-office` observes Agent tool results and emits deterministic behavior findings with optional roast-style feedback. It never blocks, rewrites, delays, or retries a tool call. The package is a presentation layer over existing loop facts; `dsh-repeat-tool-reminder` remains the owner of repeat-call model guidance.

This repository is an independent dsh plugin project. It targets published dsh package APIs instead of importing monorepo workspace paths.

## Config

```yaml
- id: roast-office
  name: '@deepseek-ai/dsh-roast-office'
  config:
    style: roast
    channels: [context, console]
    repeatThreshold: 3
    failureThreshold: 2
    maxFindingsPerTurn: 3
    cleanFinish: true
```

`style` accepts `neutral`, `gentle`, or `roast`. `context` adds a plugin-sourced notice to the next model request; `console` writes the rendered finding to the context logger. The default configuration enables both channels.

The observer detects `repeat-call` when one Agent invokes the same tool with canonicalized identical arguments consecutively. It detects `failed-retry` when the same tool and failure code/message repeat consecutively. `clean-finish` is emitted to the console when an agent becomes idle after at least one call and the finding limit has not been reached.

Finding facts are deterministic and contain only tool names, counts, and failure summaries needed by the rule. The roast renderer targets behavior, never the user's identity or ability. Tool results and policy decisions pass through unchanged.

## Model Experience

### Behavior notices

#### What the model sees

When `context` is enabled, a finding is appended as a plugin-sourced notice after the affected tool result. The notice includes the observed fact, a short recommendation, and the selected style. It does not replace the tool result or change the tool decision.

#### Token effect

No context is added before a rule fires. `maxFindingsPerTurn` bounds additional notices for one turn.

#### KV Cache effect

Notices are append-only additions after the existing tool result and do not rewrite earlier context.

## Extension points

The exported `canonicalize` function defines argument equality for the repeat rule. `Finding` and `RuleId` are the stable vocabulary for future rule and renderer registries. A future UI consumer can subscribe to structured findings without importing a transport or UI type; the first version exposes rendered context and logger output only.

## Known Limitations and Deferred Work

- The first version does not persist structured findings as a new session event.
- `clean-finish` is logger-only because the status event does not carry a post-turn decision context.
- Failure matching includes the full normalized error message, so similar failures with different dynamic text do not coalesce.
- Search-without-progress, scope drift, and unverified-change rules remain deferred until their evidence windows are defined.
