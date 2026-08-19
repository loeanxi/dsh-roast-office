import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as RoastOffice from '../src/index.js'

function execution(agent: Agent, name: string, args: unknown): ToolExecution {
  return { name, arguments: args, agent } as ToolExecution
}

function success(): ToolExecutionResult {
  return { isError: false, value: 'ok', content: [{ type: 'text', text: 'ok' }] }
}

function failure(message = 'not found'): ToolExecutionResult {
  return { isError: true, error: { message, info: { name: 'TestError', code: 'TEST_ERROR' } }, content: [{ type: 'text', text: message }] }
}

async function post(ctx: Context, call: ToolExecution, result: ToolExecutionResult) {
  return ctx.waterfall(ctx as never, 'tools/post-execute', call, result, () => Promise.resolve({ kind: 'accept' as const }))
}

describe('dsh-roast-office', () => {
  it('scores behavior deterministically', () => {
    expect(RoastOffice.buildBehaviorReport({
      calls: 10,
      failures: 2,
      repeatIncidents: 1,
      failureIncidents: 1,
      uniqueTools: 4,
      mutations: 0,
      verificationRuns: 0,
      unverifiedChanges: 0,
    })).toEqual({
      calls: 10,
      failures: 2,
      repeatIncidents: 1,
      failureIncidents: 1,
      uniqueTools: 4,
      mutations: 0,
      verificationRuns: 0,
      unverifiedChanges: 0,
      breakdown: {
        stability: 59,
        completeness: 100,
        efficiency: 90,
        closure: 80,
      },
      efficiencyStatus: 'normal',
      trend: 'first-turn',
      score: 82,
      risk: 'medium',
      verdict: 'review',
    })
  })

  it('marks excessive calls as an efficiency watch', () => {
    expect(RoastOffice.buildBehaviorReport({
      calls: 10,
      failures: 0,
      repeatIncidents: 0,
      failureIncidents: 0,
      uniqueTools: 1,
      mutations: 0,
      verificationRuns: 0,
      unverifiedChanges: 0,
    })).toMatchObject({
      breakdown: { efficiency: 60 },
      efficiencyStatus: 'watch',
    })
  })

  it('emits one repeat notice at the configured threshold', async () => {
    const ctx = new Context()
    await ctx.plugin(RoastOffice, { channels: ['context'], repeatThreshold: 3 })
    const agent = {} as Agent
    await post(ctx, execution(agent, 'grep', { query: 'same' }), success())
    await post(ctx, execution(agent, 'grep', { query: 'same' }), success())
    const result = await post(ctx, execution(agent, 'grep', { query: 'same' }), success())
    expect(result.additionalContexts).toHaveLength(1)
    expect(result.additionalContexts?.[0]?.content).toMatchObject([{ text: expect.stringContaining('文件系统') }])
    const fourth = await post(ctx, execution(agent, 'grep', { query: 'same' }), success())
    expect(fourth.additionalContexts).toBeUndefined()
  })

  it('emits a failed-retry notice for the second identical failure', async () => {
    const ctx = new Context()
    await ctx.plugin(RoastOffice, { channels: ['context'], failureThreshold: 2 })
    const agent = {} as Agent
    await post(ctx, execution(agent, 'read', { path: 'missing' }), failure())
    const result = await post(ctx, execution(agent, 'read', { path: 'missing' }), failure())
    expect(result.additionalContexts?.[0]?.content).toMatchObject([{ text: expect.stringContaining('刷存在感') }])
  })

  it('logs the clean-finish summary and does not alter the decision', async () => {
    const ctx = new Context()
    const info = vi.spyOn(ctx.logger, 'info').mockImplementation(() => ctx.logger)
    await ctx.plugin(RoastOffice, { channels: ['console'], cleanFinish: true })
    const agent = {} as Agent
    const result = await post(ctx, execution(agent, 'read', { path: 'README.md' }), success())
    expect(result).toEqual({ kind: 'accept' })
    ctx.emit(ctx as never, 'agent/status', { agent, status: 'idle' })
    expect(info).toHaveBeenCalledWith(expect.stringContaining('clean-finish'))
    expect(info).toHaveBeenCalledWith(expect.stringContaining('行为评分：100/100'))
  })

  it('publishes a structured report event without requiring console output', async () => {
    const ctx = new Context()
    const reports: RoastOffice.BehaviorReport[] = []
    ctx.on('roast-office/report', ({ report }) => { reports.push(report) })
    await ctx.plugin(RoastOffice, { channels: ['context'], reportChannel: 'event' })
    const agent = {} as Agent
    await post(ctx, execution(agent, 'read', { path: 'README.md' }), success())
    ctx.emit(ctx as never, 'agent/status', { agent, status: 'idle' })
    expect(reports).toEqual([{
      calls: 1,
      failures: 0,
      repeatIncidents: 0,
      failureIncidents: 0,
      uniqueTools: 1,
      mutations: 0,
      verificationRuns: 0,
      unverifiedChanges: 0,
      breakdown: {
        stability: 100,
        completeness: 100,
        efficiency: 100,
        closure: 100,
      },
      efficiencyStatus: 'normal',
      trend: 'first-turn',
      score: 100,
      risk: 'low',
      verdict: 'excellent',
    }])
  })

  it('penalizes a mutation that has not been verified', async () => {
    const ctx = new Context()
    const reports: RoastOffice.BehaviorReport[] = []
    ctx.on('roast-office/report', ({ report }) => { reports.push(report) })
    await ctx.plugin(RoastOffice, {
      channels: ['context'],
      reportChannel: 'event',
      mutationTools: ['write'],
      verificationTools: ['test'],
    })
    const agent = {} as Agent
    await post(ctx, execution(agent, 'write', { path: 'src/index.ts' }), success())
    ctx.emit(ctx as never, 'agent/status', { agent, status: 'idle' })
    expect(reports[0]).toMatchObject({
      mutations: 1,
      verificationRuns: 0,
      unverifiedChanges: 1,
      breakdown: {
        completeness: 80,
      },
      efficiencyStatus: 'normal',
      trend: 'first-turn',
      score: 93,
      risk: 'low',
      verdict: 'excellent',
    })
  })

  it('clears the unverified-change penalty after a verification run', async () => {
    const ctx = new Context()
    const reports: RoastOffice.BehaviorReport[] = []
    ctx.on('roast-office/report', ({ report }) => { reports.push(report) })
    await ctx.plugin(RoastOffice, {
      channels: ['context'],
      reportChannel: 'event',
      mutationTools: ['write'],
      verificationTools: ['test'],
    })
    const agent = {} as Agent
    await post(ctx, execution(agent, 'write', { path: 'src/index.ts' }), success())
    await post(ctx, execution(agent, 'test', { scope: 'unit' }), success())
    ctx.emit(ctx as never, 'agent/status', { agent, status: 'idle' })
    expect(reports[0]).toMatchObject({
      mutations: 1,
      verificationRuns: 1,
      unverifiedChanges: 0,
      breakdown: {
        completeness: 100,
      },
      efficiencyStatus: 'normal',
      trend: 'first-turn',
      score: 100,
      verdict: 'excellent',
    })
  })

  it('keeps a failed verification unverified', async () => {
    const ctx = new Context()
    const reports: RoastOffice.BehaviorReport[] = []
    ctx.on('roast-office/report', ({ report }) => { reports.push(report) })
    await ctx.plugin(RoastOffice, {
      channels: ['context'],
      reportChannel: 'event',
      mutationTools: ['write'],
      verificationTools: ['test'],
    })
    const agent = {} as Agent
    await post(ctx, execution(agent, 'write', { path: 'src/index.ts' }), success())
    await post(ctx, execution(agent, 'test', { scope: 'unit' }), failure('test failed'))
    ctx.emit(ctx as never, 'agent/status', { agent, status: 'idle' })
    expect(reports[0]).toMatchObject({
      mutations: 1,
      verificationRuns: 0,
      unverifiedChanges: 1,
    })
  })

  it('ignores documentation-only mutations for verification completeness', async () => {
    const ctx = new Context()
    const reports: RoastOffice.BehaviorReport[] = []
    ctx.on('roast-office/report', ({ report }) => { reports.push(report) })
    await ctx.plugin(RoastOffice, { channels: ['context'], reportChannel: 'event' })
    const agent = {} as Agent
    await post(ctx, execution(agent, 'write', { path: 'README.md' }), success())
    ctx.emit(ctx as never, 'agent/status', { agent, status: 'idle' })
    expect(reports[0]).toMatchObject({ mutations: 0, unverifiedChanges: 0, score: 100 })
  })

  it('reports improvement across consecutive turns', async () => {
    const ctx = new Context()
    const reports: RoastOffice.BehaviorReport[] = []
    ctx.on('roast-office/report', ({ report }) => { reports.push(report) })
    await ctx.plugin(RoastOffice, { channels: ['context'], reportChannel: 'event' })
    const agent = {} as Agent
    await post(ctx, execution(agent, 'write', { path: 'src/index.ts' }), success())
    ctx.emit(ctx as never, 'agent/status', { agent, status: 'idle' })
    await post(ctx, execution(agent, 'write', { path: 'README.md' }), success())
    ctx.emit(ctx as never, 'agent/status', { agent, status: 'idle' })
    expect(reports.map(report => report.trend)).toEqual(['first-turn', 'improving'])
  })
})
