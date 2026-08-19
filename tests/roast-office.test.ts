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
  })
})
