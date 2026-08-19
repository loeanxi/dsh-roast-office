import { Context } from '@deepseek-ai/cordis'
import * as RoastOffice from '../lib/src/index.js'

const ctx = new Context()
ctx.on('roast-office/report', ({ report, text }) => {
  console.log(text)
  console.log(JSON.stringify({ score: report.score, trend: report.trend, breakdown: report.breakdown }))
})
await ctx.plugin(RoastOffice, {
  channels: ['console'],
  reportChannel: 'event',
  style: 'roast',
})

const agent = {}
const execute = (name, args, result) => ctx.waterfall(
  ctx,
  'tools/post-execute',
  { name, arguments: args, agent },
  result,
  () => Promise.resolve({ kind: 'accept' }),
)

await execute('write', { path: 'src/example.ts' }, { isError: false, value: 'ok', content: [] })
await execute('test', { scope: 'unit' }, { isError: true, error: { message: 'one test failed', info: { code: 'TEST_ERROR' } }, content: [] })
ctx.emit(ctx, 'agent/status', { agent, status: 'idle' })
