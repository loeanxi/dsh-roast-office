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

/** Destination for the structured turn-end report. */
export type ReportChannel = 'console' | 'event' | 'both' | 'none'

/** Scope of an independent review request. */
export type ReviewScope = 'turn' | 'selection' | 'session'

/** Cause of an independent review request. */
export type ReviewTrigger = 'threshold' | 'turn-end' | 'manual'

/** Rules available in the plugin. */
export type RuleId = 'repeat-call' | 'failed-retry' | 'clean-finish'

/** Stable behavior metrics collected for one Agent turn. */
export interface BehaviorMetrics {
  readonly calls: number
  readonly failures: number
  readonly repeatIncidents: number
  readonly failureIncidents: number
  readonly uniqueTools: number
  readonly mutations: number
  readonly verificationRuns: number
  readonly unverifiedChanges: number
}

/** Scores for the independent behavior dimensions shown in a report. */
export interface BehaviorBreakdown {
  readonly stability: number
  readonly completeness: number
  readonly efficiency: number
  readonly closure: number
}

/** Deterministic turn-level behavior report. */
export interface BehaviorReport extends BehaviorMetrics {
  readonly breakdown: BehaviorBreakdown
  readonly efficiencyStatus: 'normal' | 'watch' | 'stuck'
  readonly trend: 'first-turn' | 'improving' | 'stable' | 'declining'
  readonly score: number
  readonly risk: 'low' | 'medium' | 'high'
  readonly verdict: 'excellent' | 'review' | 'stalled'
}

/** Sanitized observation supplied to an independent reviewer. */
export interface ReviewObservation {
  readonly tool: string
  readonly succeeded: boolean
  readonly failureCode?: string
}

/** Structured request for a reviewer Agent running outside the execution turn. */
export interface ReviewRequest {
  readonly requestId: string
  readonly agent: Agent
  readonly scope: ReviewScope
  readonly trigger: ReviewTrigger
  readonly report: BehaviorReport
  readonly observations: readonly ReviewObservation[]
  readonly reviewer: 'independent-agent'
}

/** Evidence visible to the separate reviewer; the execution Agent is excluded. */
export type IndependentReviewInput = Omit<ReviewRequest, 'agent'>

/** One finding returned by an independent reviewer. */
export interface ReviewFinding {
  readonly code: string
  readonly severity: 'info' | 'warning' | 'critical'
  readonly message: string
}

/** A non-sensitive fact that supports a reviewer conclusion. */
export interface ReviewEvidence {
  readonly code: string
  readonly label: string
  readonly value: string | number
}

/** Result published after a separate reviewer Agent handles a request. */
export interface ReviewResult {
  readonly requestId: string
  readonly agent: Agent
  readonly status: 'completed' | 'failed'
  readonly summary: string
  readonly findings: readonly ReviewFinding[]
  readonly confidence: 'low' | 'medium' | 'high'
  readonly evidence: readonly ReviewEvidence[]
  readonly needsSecondReview: boolean
  readonly consensus: 'single' | 'unanimous' | 'majority' | 'split'
  readonly reviewer: 'independent-agent'
  readonly error?: string
}

/** Fields a reviewer returns before the bridge adds request identity. */
export interface ReviewConclusion {
  readonly summary: string
  readonly findings: readonly ReviewFinding[]
  readonly confidence: 'low' | 'medium' | 'high'
  readonly evidence: readonly ReviewEvidence[]
  readonly needsSecondReview: boolean
}

/** A consensus conclusion returned by more than one reviewer. */
export interface ReviewConsensus extends ReviewConclusion {
  readonly consensus: 'unanimous' | 'majority' | 'split'
}

/** Host-owned runner for a separate, read-only reviewer Agent. */
export interface IndependentReviewer {
  /**
   * Review sanitized evidence in a separate Agent session.
   * @param request - request without raw tool arguments or file contents.
   * @returns the review summary and findings to publish to the UI.
   */
  review(request: IndependentReviewInput): Promise<ReviewConclusion>
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Emitted once when the observed Agent becomes idle and reporting is enabled.
     * @param payload - the Agent, deterministic report, and rendered text.
     * @mode emit
     */
    'roast-office/report'(payload: { agent: Agent; report: BehaviorReport; text: string }): void
    /**
     * Requests an independent reviewer Agent to assess the execution trace.
     * @param payload - the execution Agent, review scope, and trigger.
     * @mode emit
     */
    'roast-office/request-review'(payload: { agent: Agent; scope: ReviewScope }): void
    /**
     * Emitted when review is requested automatically or manually.
     * @param payload - sanitized evidence for a separate reviewer Agent.
     * @mode emit
     */
    'roast-office/review-request'(payload: ReviewRequest): void
    /**
     * Emitted when the independent reviewer finishes or fails.
     * @param payload - the review result for the matching request id.
     * @mode emit
     */
    'roast-office/review-result'(payload: ReviewResult): void
  }
}

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
  /** Destination for the structured turn-end report; defaults to `console`. */
  reportChannel?: ReportChannel
  /** Tool names treated as workspace mutations. */
  mutationTools?: string[]
  /** Tool names treated as verification runs. */
  verificationTools?: string[]
  /** Paths whose mutations require a verification run; defaults to source and config paths. */
  verificationPaths?: string[]
  /** Number of previous turn scores retained for trend comparison. */
  historySize?: number
  /** Enable automatic independent review requests. */
  autoReview?: boolean
  /** Automatic review triggers; defaults to threshold and turn-end. */
  reviewTriggers?: ReviewTrigger[]
  /** Maximum sanitized tool observations included in one review request. */
  maxReviewObservations?: number
}

export const Config: z<Config> = z.object({
  style: z.union([z.const('neutral'), z.const('gentle'), z.const('roast')]).default('roast'),
  channels: z.array(z.union([z.const('context'), z.const('console')])).default(['context', 'console']),
  repeatThreshold: z.number().default(3),
  failureThreshold: z.number().default(2),
  maxFindingsPerTurn: z.number().default(3),
  cleanFinish: z.boolean().default(true),
  reportChannel: z.union([z.const('console'), z.const('event'), z.const('both'), z.const('none')]).default('console'),
  mutationTools: z.array(z.string()).default(['write', 'edit', 'apply_patch', 'str_replace_editor']),
  verificationTools: z.array(z.string()).default(['test', 'lint', 'typecheck', 'build', 'check']),
  verificationPaths: z.array(z.string()).default(['src/**', 'packages/**', 'examples/**', 'scripts/**', '*.config.*', 'package.json', 'tsconfig*.json']),
  historySize: z.number().default(5),
  autoReview: z.boolean().default(true),
  reviewTriggers: z.array(z.union([z.const('threshold'), z.const('turn-end'), z.const('manual')])).default(['threshold', 'turn-end']),
  maxReviewObservations: z.number().default(20),
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
  repeatIncidents: number
  failureIncidents: number
  uniqueTools: Set<string>
  mutations: number
  verificationRuns: number
  verifiedSinceMutation: boolean
  observations: ReviewObservation[]
  reviewRequested: boolean
}

interface ReviewSnapshot {
  readonly report: BehaviorReport
  readonly observations: readonly ReviewObservation[]
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

function matchesTool(name: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => {
    const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\\$&`)
    return new RegExp(`^${escaped.replaceAll('*', '.*')}$`).test(name)
  })
}

function matchesPath(path: string, patterns: readonly string[]): boolean {
  const normalized = path.replaceAll('\\', '/')
  return patterns.some(pattern => {
    const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\\$&`)
    return new RegExp(`^${escaped.replaceAll('*', '.*')}$`).test(normalized)
  })
}

function pathsFrom(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(pathsFrom)
  if (value === null || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return Object.entries(record)
    .filter(([key]) => ['path', 'file', 'filePath', 'paths', 'files'].includes(key))
    .flatMap(([, entry]) => pathsFrom(entry))
}

function needsVerification(args: unknown, patterns: readonly string[]): boolean {
  const paths = pathsFrom(args)
  return paths.length === 0 || paths.some(path => matchesPath(path, patterns))
}

function validatePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`roast-office: ${field} must be a positive integer`)
  return value
}

function stateFor(states: WeakMap<Agent, AgentState>, agent: Agent): AgentState {
  const current = states.get(agent)
  if (current !== undefined) return current
  const created: AgentState = {
    calls: 0,
    failures: 0,
    findings: 0,
    repeatedCalls: 0,
    repeatedFailures: 0,
    repeatIncidents: 0,
    failureIncidents: 0,
    uniqueTools: new Set(),
    mutations: 0,
    verificationRuns: 0,
    verifiedSinceMutation: false,
    observations: [],
    reviewRequested: false,
  }
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

/** Build a deterministic score from turn metrics without model judgment. */
export function buildBehaviorReport(metrics: BehaviorMetrics): BehaviorReport {
  const failureRatePenalty = metrics.calls === 0
    ? 0
    : Math.min(30, Math.round((metrics.failures / metrics.calls) * 30))
  const breakdown: BehaviorBreakdown = {
    stability: Math.max(0, 100 - metrics.repeatIncidents * 20 - metrics.failureIncidents * 15 - failureRatePenalty),
    completeness: Math.max(0, 100 - metrics.unverifiedChanges * 20),
    efficiency: Math.max(0, 100 - Math.max(0, metrics.calls - metrics.uniqueTools * 2) * 5),
    closure: Math.max(0, 100 - metrics.failures * 10 - metrics.unverifiedChanges * 10),
  }
  const efficiencyStatus = breakdown.efficiency >= 85 ? 'normal' : breakdown.efficiency >= 60 ? 'watch' : 'stuck'
  const score = Math.round((breakdown.stability + breakdown.completeness + breakdown.efficiency + breakdown.closure) / 4)
  const risk = score >= 85 ? 'low' : score >= 60 ? 'medium' : 'high'
  const verdict = score >= 85 ? 'excellent' : score >= 60 ? 'review' : 'stalled'
  return { ...metrics, breakdown, efficiencyStatus, trend: 'first-turn', score, risk, verdict }
}

function withTrend(report: BehaviorReport, previousScore: number | undefined): BehaviorReport {
  const trend = previousScore === undefined
    ? 'first-turn'
    : report.score > previousScore
      ? 'improving'
      : report.score < previousScore
        ? 'declining'
        : 'stable'
  return { ...report, trend }
}

function reportText(style: Style, report: BehaviorReport): string {
  const summary = `[吐槽办·clean-finish] 行为评分：${report.score}/100（${report.verdict}）\n`
    + `工具调用：${report.calls} 次；失败：${report.failures} 次；重复事件：${report.repeatIncidents} 次；失败重试：${report.failureIncidents} 次；使用工具：${report.uniqueTools} 种。\n`
    + `工作区改动：${report.mutations} 次；成功验证：${report.verificationRuns} 次；未验证改动：${report.unverifiedChanges} 次。\n`
    + `稳定性：${report.breakdown.stability}；完整性：${report.breakdown.completeness}；效率：${report.breakdown.efficiency}（${report.efficiencyStatus}）；收尾：${report.breakdown.closure}。\n`
    + `风险等级：${report.risk}；趋势：${report.trend}。`
  if (style === 'neutral') return summary + ' 建议：检查相关测试和工作区后再提交。'
  if (style === 'gentle') return summary + ' 可以再确认一次测试和工作区状态。'
  const joke = report.verdict === 'excellent'
    ? '本回合秩序良好，吐槽办暂不立案。'
    : report.verdict === 'review'
      ? '证据链还有几页没盖章，先别急着宣布胜利。'
      : '这回合的进展条，正在申请失踪人口认定。'
  return `${summary} ${joke}\n建议：检查相关测试和工作区后再提交。`
}

function reportFromState(state: AgentState): BehaviorReport {
  return buildBehaviorReport({
    calls: state.calls,
    failures: state.failures,
    repeatIncidents: state.repeatIncidents,
    failureIncidents: state.failureIncidents,
    uniqueTools: state.uniqueTools.size,
    mutations: state.mutations,
    verificationRuns: state.verificationRuns,
    unverifiedChanges: state.mutations > 0 && !state.verifiedSinceMutation ? 1 : 0,
  })
}

function emitReviewSnapshot(
  ctx: Context,
  agent: Agent,
  snapshot: ReviewSnapshot,
  scope: ReviewScope,
  trigger: ReviewTrigger,
  requestId: string,
): void {
  const request: ReviewRequest = {
    agent,
    requestId,
    scope,
    trigger,
    report: snapshot.report,
    observations: snapshot.observations,
    reviewer: 'independent-agent',
  }
  ctx.emit(ctx as never, 'roast-office/review-request', request)
}

/**
 * Connect a host-owned independent reviewer to the review request protocol.
 * @param ctx - Cordis context carrying roast-office events.
 * @param reviewer - runner backed by a separate reviewer Agent session.
 * @returns a disposer for the event consumer.
 */
export function installIndependentReviewer(ctx: Context, reviewer: IndependentReviewer): () => void {
  return ctx.on('roast-office/review-request', request => {
    const { agent: _executionAgent, ...reviewInput } = request
    void Promise.resolve().then(() => reviewer.review(reviewInput)).then(result => {
      ctx.emit(ctx as never, 'roast-office/review-result', {
        requestId: request.requestId,
        agent: request.agent,
        status: 'completed',
        summary: result.summary,
        findings: result.findings,
        confidence: result.confidence,
        evidence: result.evidence,
        needsSecondReview: result.needsSecondReview,
        consensus: 'single',
        reviewer: 'independent-agent',
      })
    }).catch(error => {
      ctx.emit(ctx as never, 'roast-office/review-result', {
        requestId: request.requestId,
        agent: request.agent,
        status: 'failed',
        summary: '独立评审 Agent 未能完成评审。',
        findings: [],
        confidence: 'low',
        evidence: [],
        needsSecondReview: true,
        consensus: 'single',
        reviewer: 'independent-agent',
        error: error instanceof Error ? error.message : String(error),
      })
    })
  })
}

/**
 * Create a model-free reviewer backed only by the deterministic behavior report.
 * @returns a reviewer suitable as the host fallback when no reviewer Agent is configured.
 */
export function createDeterministicReviewer(): IndependentReviewer {
  return {
    async review(request): Promise<ReviewConclusion> {
      const findings: ReviewFinding[] = []
      const evidence: ReviewEvidence[] = [
        { code: 'score', label: '行为评分', value: request.report.score },
        { code: 'risk', label: '风险等级', value: request.report.risk },
        { code: 'calls', label: '工具调用次数', value: request.report.calls },
      ]
      if (request.report.repeatIncidents > 0) {
        findings.push({ code: 'repeat-call', severity: 'warning', message: `检测到 ${request.report.repeatIncidents} 次重复调用。` })
        evidence.push({ code: 'repeatIncidents', label: '重复调用次数', value: request.report.repeatIncidents })
      }
      if (request.report.unverifiedChanges > 0) {
        findings.push({ code: 'unverified-change', severity: 'critical', message: '存在未完成验证的代码变更。' })
        evidence.push({ code: 'unverifiedChanges', label: '未验证变更数', value: request.report.unverifiedChanges })
      }
      if (request.report.failures > 0) {
        findings.push({ code: 'tool-failure', severity: 'warning', message: `检测到 ${request.report.failures} 次工具失败。` })
        evidence.push({ code: 'failures', label: '工具失败次数', value: request.report.failures })
      }
      const needsSecondReview = request.report.risk === 'high'
        || request.report.verdict === 'stalled'
        || request.report.unverifiedChanges > 0
      return {
        summary: findings.length === 0 ? '未发现需要升级处理的行为问题。' : `发现 ${findings.length} 项需要关注的行为问题。`,
        findings,
        confidence: 'high',
        evidence,
        needsSecondReview,
      }
    },
  }
}

/**
 * Run several independent reviewers and merge their conclusions by finding-code agreement.
 * @param reviewers - separate reviewer implementations; at least one is required.
 * @param request - sanitized review input shared with every reviewer.
 * @returns the merged conclusion and the level of reviewer agreement.
 */
export async function reviewWithConsensus(
  reviewers: readonly IndependentReviewer[],
  request: IndependentReviewInput,
): Promise<ReviewConsensus> {
  if (reviewers.length === 0) throw new TypeError('at least one reviewer is required')
  const conclusions = await Promise.all(reviewers.map(reviewer => reviewer.review(request)))
  const signatures = conclusions.map(conclusion => conclusion.findings.map(finding => finding.code).sort().join(','))
  const counts = new Map<string, number>()
  for (const signature of signatures) counts.set(signature, (counts.get(signature) ?? 0) + 1)
  const majoritySignature = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  const majority = conclusions[signatures.indexOf(majoritySignature)]!
  const agreement = new Set(signatures).size === 1 ? 'unanimous' : (counts.get(majoritySignature)! > conclusions.length / 2 ? 'majority' : 'split')
  return {
    ...majority,
    confidence: agreement === 'unanimous' ? majority.confidence : 'medium',
    needsSecondReview: majority.needsSecondReview || agreement === 'split',
    consensus: agreement,
  }
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
  state.uniqueTools.add(exec.name)
  state.observations.push({
    tool: exec.name,
    succeeded: !result.isError,
    ...(result.isError && result.error.info?.code !== undefined ? { failureCode: result.error.info.code } : {}),
  })
  if (state.observations.length > config.maxReviewObservations) state.observations.shift()
  if (matchesTool(exec.name, config.mutationTools) && needsVerification(exec.arguments, config.verificationPaths)) {
    state.mutations += 1
    state.verifiedSinceMutation = false
  } else if (!result.isError && matchesTool(exec.name, config.verificationTools)) {
    state.verificationRuns += 1
    if (state.mutations > 0) state.verifiedSinceMutation = true
  }
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
      state.failureIncidents += 1
      failureFinding = { ruleId: 'failed-retry', facts: { tool: exec.name, count: state.repeatedFailures }, recommendation: '检查错误原因，改变参数或行动路径后再重试。' }
    }
  }
  if (state.repeatedCalls === config.repeatThreshold) {
    state.repeatIncidents += 1
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
    reportChannel: rawConfig.reportChannel ?? 'console',
    mutationTools: rawConfig.mutationTools ?? ['write', 'edit', 'apply_patch', 'str_replace_editor'],
    verificationTools: rawConfig.verificationTools ?? ['test', 'lint', 'typecheck', 'build', 'check'],
    verificationPaths: rawConfig.verificationPaths ?? ['src/**', 'packages/**', 'examples/**', 'scripts/**', '*.config.*', 'package.json', 'tsconfig*.json'],
    historySize: validatePositiveInteger(rawConfig.historySize ?? 5, 'historySize'),
    autoReview: rawConfig.autoReview ?? true,
    reviewTriggers: rawConfig.reviewTriggers ?? ['threshold', 'turn-end'],
    maxReviewObservations: validatePositiveInteger(rawConfig.maxReviewObservations ?? 20, 'maxReviewObservations'),
  }
  const states = new WeakMap<Agent, AgentState>()
  const history = new WeakMap<Agent, number[]>()
  const lastReviews = new WeakMap<Agent, ReviewSnapshot>()
  let nextReviewId = 0

  const requestId = (): string => `review-${++nextReviewId}`

  ctx.inject(['commands'], (commandCtx) => {
    const commands = (commandCtx as unknown as { commands: { register(definition: unknown): () => void } }).commands
    const dispose = commands.register({
      name: 'review',
      description: 'request an independent roast-office review',
      input: { hint: 'turn | selection | session' },
      recordInput: false,
      handler: (invocation: { agent: Agent; rawInput: string }): { kind: 'success'; text: string } => {
        const scope = invocation.rawInput.trim() === 'session' || invocation.rawInput.trim() === 'selection'
          ? invocation.rawInput.trim() as ReviewScope
          : 'turn'
        ctx.emit(ctx as never, 'roast-office/request-review', { agent: invocation.agent, scope })
        return { kind: 'success', text: '已提交独立评审请求。' }
      },
    })
    commandCtx.effect(() => dispose, 'roast-office: review command')
  })

  ctx.on('roast-office/request-review', ({ agent, scope }) => {
    const state = states.get(agent)
    if (state !== undefined && state.calls > 0) {
      emitReviewSnapshot(ctx, agent, {
        report: reportFromState(state),
        observations: state.observations.slice(-config.maxReviewObservations),
      }, scope, 'manual', requestId())
      return
    }
    const snapshot = lastReviews.get(agent)
    if (snapshot !== undefined) emitReviewSnapshot(ctx, agent, snapshot, scope, 'manual', requestId())
  })

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const decision = await next()
    if (exec.agent === undefined) return decision
    const state = stateFor(states, exec.agent)
    const finding = observe(exec, result, state, config)
    if (finding !== undefined) {
      const nextDecision = emit(ctx, finding, config, state, { agent: exec.agent, decision })
      if (config.autoReview && config.reviewTriggers.includes('threshold') && !state.reviewRequested) {
        state.reviewRequested = true
        emitReviewSnapshot(ctx, exec.agent, {
          report: reportFromState(state),
          observations: state.observations.slice(-config.maxReviewObservations),
        }, 'turn', 'threshold', requestId())
      }
      return nextDecision
    }
    return decision
  })

  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) states.delete(agent)
    return next()
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    const state = states.get(agent)
    if (state === undefined || !config.cleanFinish || state.calls === 0) {
      states.delete(agent)
      return
    }
    const report = reportFromState(state)
    const scores = history.get(agent) ?? []
    const reportWithTrend = withTrend(report, scores.at(-1))
    scores.push(report.score)
    while (scores.length > config.historySize) scores.shift()
    history.set(agent, scores)
    lastReviews.set(agent, {
      report: reportWithTrend,
      observations: state.observations.slice(-config.maxReviewObservations),
    })
    if (config.autoReview && config.reviewTriggers.includes('turn-end') && !state.reviewRequested) {
      state.reviewRequested = true
      emitReviewSnapshot(ctx, agent, {
        report: reportWithTrend,
        observations: state.observations.slice(-config.maxReviewObservations),
      }, 'turn', 'turn-end', requestId())
    }
    const text = reportText(config.style, reportWithTrend)
    if (config.reportChannel === 'console' || config.reportChannel === 'both') ctx.logger.info(text)
    if (config.reportChannel === 'event' || config.reportChannel === 'both') {
      ctx.emit(ctx as never, 'roast-office/report', { agent, report: reportWithTrend, text })
    }
    states.delete(agent)
  })
}
