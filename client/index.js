window.__ModuleLoader__.load({
  id: '@dsh-plugins/roast-office',
  factory: (require) => {
    const React = require('react')

const reviewDefinition = {
  kind: 'roast-office-review',
  target: 'chat',
  match(event) {
    if (event.type === 'roast-office/review-request') return { id: String(event.data.requestId), role: 'start' }
    if (event.type === 'roast-office/review-result') return { id: String(event.data.requestId), role: 'update' }
    return null
  },
  start(_context, match) {
    return { request: match.event.data, result: undefined }
  },
  update(context, match) {
    if (match.event.type !== 'roast-office/review-result') return context.state
    return { ...context.state, result: match.event.data }
  },
  buildViewNode(context) {
    if (context.start === undefined) return null
    return {
      key: context.key,
      kind: 'roast-office-review',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: context.state,
    }
  },
}

function ReviewCard({ node }) {
  const result = node.data.result
  const request = node.data.request
  const report = request.report
  const findings = result?.findings ?? []
  return React.createElement('section', {
    'data-roast-office-review': '',
    style: { margin: '10px 0', padding: '12px 14px', border: '1px solid var(--ds-border-subtle, #34363d)', borderRadius: 10 },
  },
  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12 } },
    React.createElement('strong', null, '吐槽办 · 独立评审'),
    React.createElement('span', null, result?.status === 'failed' ? '评审失败' : result === undefined ? '评审中…' : '已完成')),
  React.createElement('div', { style: { marginTop: 6, opacity: 0.8 } }, `评分 ${report.score} · ${report.risk} 风险 · ${report.verdict}`),
  result !== undefined && React.createElement('p', { style: { margin: '8px 0 4px' } }, result.summary),
  result !== undefined && findings.length > 0 && React.createElement('ul', { style: { margin: '6px 0 0', paddingLeft: 20 } }, findings.map((finding) => React.createElement('li', { key: `${finding.code}-${finding.message}` }, finding.message))),
  result !== undefined && React.createElement('small', { style: { opacity: 0.7 } }, `置信度 ${result.confidence} · ${result.needsSecondReview ? '建议二次复核' : '无需二次复核'}`))
}

function ReviewDock({ inputActions, input }) {
  if (input?.phase === 'submitting' || input?.phase === 'adjudicating') return null
  return React.createElement('button', {
    type: 'button',
    'data-roast-office-review-button': '',
    onClick: () => { inputActions.setDraft('/review'); inputActions.submit() },
    style: { fontSize: 12, padding: '4px 9px', borderRadius: 7, cursor: 'pointer' },
  }, '主动评审')
}

const inject = ['slots', 'conversationEvents']

function apply(ctx) {
  ctx.conversationEvents.register(reviewDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'roast-office-review', order: 40,
  }, ReviewCard))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'roast-office-review', order: 30,
  }, ReviewDock))
}

    const module = { exports: {} }
    module.exports.inject = inject
    module.exports.apply = apply
    return module.exports
  },
})
