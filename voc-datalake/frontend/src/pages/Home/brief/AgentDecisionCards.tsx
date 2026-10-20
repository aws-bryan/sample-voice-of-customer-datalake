/**
 * @fileoverview Home's live "<agent> needs your decision" cards: one per
 * autonomous agent whose last run stopped for a person, right under the header.
 *
 * Live, not from the brief build: the agents come from the sidebar badge's
 * `/agents` query (`useAgentsAwaitingDecision`, one cache entry, 60 s refresh)
 * and each card reads its waiting run (`agentsKeys.run`) for the reason, the
 * step and the stop time. While that read loads or fails the card still shows,
 * with the generic reason. The link opens the agent's Runs tab, which opens the
 * newest run (the waiting one): "Make the decision" for admins, "Review the run"
 * for everyone else (deciding is admin-only).
 *
 * @module pages/Home/brief/AgentDecisionCards
 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowRight, Hand } from 'lucide-react'
import { agentsApi, agentsKeys } from '../../../api/agentsApi'
import { useIsAdmin } from '../../../store/authStore'
import { ReasonLine } from '../../Agents/RunDecisionCard'
import { formatTime } from './briefCards'
import type { Agent, AgentRun } from '../../../api/agentsApi'

/** The waiting run, when it can be read and is still waiting. */
function useWaitingRun(agent: Agent): AgentRun | undefined {
  const runId = agent.stats.last_run_id ?? ''
  const { data } = useQuery({
    queryKey: agentsKeys.run(agent.agent_id, runId),
    queryFn: () => agentsApi.getRun(agent.agent_id, runId),
    enabled: runId !== '',
  })
  return data?.status === 'needs_human' ? data : undefined
}

function RunFacts({ run }: Readonly<{ run: AgentRun | undefined }>) {
  const { t, i18n } = useTranslation('briefing')
  const node = run?.needs_human?.node_title ?? ''
  const stopped = formatTime(run?.finished_at ?? '', i18n.language)
  if (node === '' && stopped === '') return null
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {node !== '' && <span>{t('agentDecision.node', { node })}</span>}
      {stopped !== '' && <span>{t('agentDecision.stopped', { time: stopped })}</span>}
    </p>
  )
}

function DecisionCard({ agent, isAdmin }: Readonly<{ agent: Agent; isAdmin: boolean }>) {
  const { t } = useTranslation(['briefing', 'agents'])
  const run = useWaitingRun(agent)
  const name = agent.name.trim() === '' ? agent.agent_id : agent.name
  return (
    <li className="space-y-2 rounded-xl border border-warn/30 bg-warn-subtle p-4" data-agent-id={agent.agent_id}>
      <h3 className="flex items-center gap-2 font-semibold text-text-strong">
        <Hand size={16} aria-hidden="true" className="shrink-0 text-warn" />
        {t('briefing:agentDecision.title', { name })}
      </h3>
      <ReasonLine needsHuman={run?.needs_human ?? null} />
      <RunFacts run={run} />
      <Link to={`/agents/${encodeURIComponent(agent.agent_id)}?tab=runs`} className="btn btn-primary btn-sm">
        {isAdmin ? t('agents:decision.form.submit') : t('agents:decision.reviewRun')}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </li>
  )
}

export default function AgentDecisionCards({ agents }: Readonly<{ agents: readonly Agent[] }>) {
  const { t } = useTranslation('briefing')
  const isAdmin = useIsAdmin()
  if (agents.length === 0) return null
  return (
    <section aria-label={t('agentDecision.sectionLabel')}>
      <ul className="space-y-3">
        {agents.map((agent) => <DecisionCard key={agent.agent_id} agent={agent} isAdmin={isAdmin} />)}
      </ul>
    </section>
  )
}
