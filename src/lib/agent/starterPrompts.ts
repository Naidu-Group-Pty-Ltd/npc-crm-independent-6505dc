/**
 * The sixteen prompts the Aurixa panel has always offered, word for word.
 *
 * Kept in one place so the Home view and anything else that offers a starter
 * send exactly the strings the agent has always received.
 */
export const STARTER_PROMPTS = [
  '☀️ Morning briefing',
  '🔍 Proactive insights scan',
  '📊 Pipeline overview',
  '⏰ Overdue reminders',
  '📅 Upcoming appointments',
  '💰 Commission forecast',
  '🏥 System health check',
  '📊 Chart: deals by stage',
  '📈 Weekly digest',
  '🏆 Top clients',
  '💹 Revenue forecast',
  '🔮 What-if: rates +0.5%',
  '📤 Export pipeline data',
  '📋 My playbooks',
  '🔎 Smart search',
  '📝 Generate report for...',
] as const;
