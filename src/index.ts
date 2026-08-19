/**
 * Deterministic Agent behavior findings with optional roast-style feedback.
 * The plugin observes tool results and never changes tool execution decisions.
 * @module @deepseek-ai/dsh-roast-office
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type MessageSource } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export const name = 'roast-office'

/** Text style used by the renderer. */
export type Style = 'neutral' | 'gentle' | 'roast'

/** Output destination for a finding. */
export type Channel = 'context' | 'console'

/** Rules available in the first version. */
export type RuleId = 'repeat-call' | 'failed-retry' | 'clean-finish'

/** Plugin configuration. */
export interface Config {
  /** Render style; defaults to `roast`. */
  style?: Style
  /** Destinations for rendered findings; defaults to `['context', 'console']`. */
  channels?: Channel[]
  /** Consecutive identical calls needed for `repeat-call`. */
  repeatThreshold?: number
  /** Consecutive identical failures needed for `failed-retry`. */
  failureThreshold?: number
  /** Maximum findings emitted for one turn. */
  maxFindingsPerTurn?: number
  /** Enable the turn-end summary finding. */
  cleanFinish?: boolean
}

export const Config: z<Config> = z.object({
  style: z.union([z.const('neutral'), z.const('gentle'), z.const('roast')]).default('roast'),
  channels: z.array(z.union([z.const('context'), z.const('console')])).default(['context', 'console']),
  repeatThreshold: z.number().default(3),
  failureThreshold: z.number().default(2),
  maxFindingsPerTurn: z.number().default(3),
  cleanFinish: z.boolean().default(true),
})

/** A stable, machine-readable observation produced by a rule. */
export interface Finding {
  readonly ruleId: RuleId
  readonly facts: Readonly<Record<string, string | number>>
  readonly recommendation: string
}

/** State kept for one Agent until its next user message or idle transition. */
interface AgentState {
  calls: number
  failures: number
  findings: number
  lastCallKey?: string
  repeatedCalls: number
  lastFailureKey?: string
  repeatedFailures: number
}

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'roast-office' }

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) sorted[key] = sortJson(record[key])
    return sorted
  }
  return value
}

/** Canonicalize lossless tool arguments for stable equality. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function validatePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`roast-office: ${field} must be a positive integer`)
  return value
}

function stateFor(states: WeakMap<Agent, AgentState>, agent: Agent): AgentState {
  const current = states.get(agent)
  if (current !== undefined) return current
  const created: AgentState = { calls: 0, failures: 0, findings: 0, repeatedCalls: 0, repeatedFailures: 0 }
  states.set(agent, created)
  return created
}

function roast(style: Style, finding: Finding): string {
  const { ruleId, facts, recommendation } = finding
  const detail = ruleId === 'repeat-call'
    ? `连续 ${facts.count} 次调用 ${facts.tool}，参数没有变化。`
    : ruleId === 'failed-retry'
      ? `相同工具 ${facts.tool} 连续失败 ${facts.count} 次。`
      : `本回合调用 ${facts.calls} 次工具，失败 ${facts.failures} 次。`
  if (style === 'neutral') return `[吐槽办·${ruleId}] ${detail} 建议：${recommendation}`
  if (style === 'gentle') return `[吐槽办·${ruleId}] ${detail} 可以试试：${recommendation}`
  const joke = ruleId === 'repeat-call'
    ? '你不是在搜索，你是在和文件系统培养感情。'
    : ruleId === 'failed-retry'
      ? '这不是坚持，这是给同一个错误刷存在感。'
      : '现场秩序良好，暂未发现需要传唤的工具。'
  return `[吐槽办·${ruleId}] ${detail} ${joke}\n建议：${recommendation}`
}

function contextFor(text: string, ruleId: RuleId): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: ruleId },
  })
}

function prependContext(
  context: ReturnType<typeof createUserMessage>,
  existing: ReturnType<typeof createUserMessage>[] | undefined,
): ReturnType<typeof createUserMessage>[] {
  return [context, ...existing ?? []]
}

function observe(
  exec: ToolExecution,
  result: Readonly<ToolExecutionResult>,
  state: AgentState,
  config: Required<Config>,
): Finding | undefined {
  state.calls += 1
  const callKey = JSON.stringify([exec.name, canonicalize(exec.arguments)])
  state.repeatedCalls = state.lastCallKey === callKey ? state.repeatedCalls + 1 : 1
  state.lastCallKey = callKey
  let failureFinding: Finding | undefined
  if (!result.isError) {
    delete state.lastFailureKey
    state.repeatedFailures = 0
  } else {
    state.failures += 1
    const failureKey = JSON.stringify([exec.name, result.error.info?.code ?? '', result.error.message])
    state.repeatedFailures = state.lastFailureKey === failureKey ? state.repeatedFailures + 1 : 1
    state.lastFailureKey = failureKey
    if (state.repeatedFailures === config.failureThreshold) {
      failureFinding = { ruleId: 'failed-retry', facts: { tool: exec.name, count: state.repeatedFailures }, recommendation: '检查错误原因，改变参数或行动路径后再重试。' }
    }
  }
  if (state.repeatedCalls === config.repeatThreshold) {
    return { ruleId: 'repeat-call', facts: { tool: exec.name, count: state.repeatedCalls }, recommendation: '重新阅读最近一次结果，或更换验证路径。' }
  }
  return failureFinding
}

function emit(
  ctx: Context,
  finding: Finding,
  config: Required<Config>,
  state: AgentState,
  extra: { agent: Agent; decision: PostToolDecision },
): PostToolDecision {
  if (state.findings >= config.maxFindingsPerTurn) return extra.decision
  state.findings += 1
  const text = roast(config.style, finding)
  if (config.channels.includes('console')) ctx.logger.info(text)
  if (!config.channels.includes('context')) return extra.decision
  const context = contextFor(text, finding.ruleId)
  if (extra.decision.kind === 'block') return { ...extra.decision, additionalContexts: prependContext(context, extra.decision.additionalContexts) }
  return { ...extra.decision, additionalContexts: prependContext(context, extra.decision.additionalContexts) }
}

/** Install the observer and its non-blocking feedback channels. */
export function apply(ctx: Context, rawConfig: Config): void {
  const config: Required<Config> = {
    style: rawConfig.style ?? 'roast',
    channels: rawConfig.channels ?? ['context', 'console'],
    repeatThreshold: validatePositiveInteger(rawConfig.repeatThreshold ?? 3, 'repeatThreshold'),
    failureThreshold: validatePositiveInteger(rawConfig.failureThreshold ?? 2, 'failureThreshold'),
    maxFindingsPerTurn: validatePositiveInteger(rawConfig.maxFindingsPerTurn ?? 3, 'maxFindingsPerTurn'),
    cleanFinish: rawConfig.cleanFinish ?? true,
  }
  const states = new WeakMap<Agent, AgentState>()

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    if (exec.agent === undefined) return decision
    const state = stateFor(states, exec.agent)
    const finding = observe(exec, result, state, config)
    return finding === undefined ? decision : emit(ctx, finding, config, state, { agent: exec.agent, decision })
  })

  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) states.delete(agent)
    return next()
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    const state = states.get(agent)
    if (state === undefined || !config.cleanFinish || state.calls === 0 || state.findings >= config.maxFindingsPerTurn) {
      states.delete(agent)
      return
    }
    const finding: Finding = { ruleId: 'clean-finish', facts: { calls: state.calls, failures: state.failures }, recommendation: '检查相关测试和工作区后再提交。' }
    const text = roast(config.style, finding)
    if (config.channels.includes('console')) ctx.logger.info(text)
    states.delete(agent)
  })
}
