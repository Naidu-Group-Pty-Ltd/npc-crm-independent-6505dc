import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getBrandConfig } from '../_shared/brand-config.ts';
import { internalError } from '../_shared/errorResponse.ts';

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
};

interface WeeklyReportRequest {
  recipientEmail: string;
  daysBack?: number;
}

interface CallStats {
  totalCalls: number;
  avgDuration: number;
  avgQualityScore: number;
  successRate: number;
  totalCost: number;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  outcomeBreakdown: Record<string, number>;
  alertsTriggered: number;
  topIntents: { intent: string; count: number }[];
}

function calculateQualityScore(call: any): number {
  let score = 50;
  
  // Sentiment scoring
  if (call.sentiment === 'positive') score += 25;
  else if (call.sentiment === 'neutral') score += 10;
  else if (call.sentiment === 'negative') score -= 15;
  
  // Duration scoring (optimal: 2-10 minutes)
  const duration = call.duration_seconds || 0;
  if (duration >= 120 && duration <= 600) score += 20;
  else if (duration >= 60 && duration <= 900) score += 10;
  else if (duration < 30 || duration > 1200) score -= 10;
  
  // Outcome scoring
  if (call.call_outcome === 'successful' || call.call_outcome === 'completed') score += 15;
  else if (call.call_outcome === 'voicemail') score += 5;
  else if (call.call_outcome === 'failed' || call.call_outcome === 'no-answer') score -= 10;
  
  // Transcript availability
  if (call.transcript) score += 5;
  
  // Action items identified
  if (call.action_items && call.action_items.length > 0) score += 5;
  
  return Math.max(0, Math.min(100, score));
}

function getGrade(score: number): string {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 85) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 75) return 'C+';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function getGradeColor(grade: string): string {
  if (grade.startsWith('A')) return '#22c55e';
  if (grade.startsWith('B')) return '#3b82f6';
  if (grade.startsWith('C')) return '#f59e0b';
  return '#ef4444';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const body = await req.json();
    const { recipientEmail, daysBack = 7 }: WeeklyReportRequest = body;

    // SECURITY: Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[send-weekly-call-report] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[send-weekly-call-report] Authenticated user: ${userId}`);

    if (!recipientEmail) {
      throw new Error("Recipient email is required");
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    console.log(`Generating report from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Fetch calls for the period
    const { data: calls, error: callsError } = await supabase
      .from('vapi_call_logs')
      .select('*')
      .gte('started_at', startDate.toISOString())
      .lte('started_at', endDate.toISOString())
      .order('started_at', { ascending: false });

    if (callsError) {
      console.error('Error fetching calls:', callsError);
      throw callsError;
    }

    // Fetch alerts for the period
    const { data: alerts, error: alertsError } = await supabase
      .from('call_alert_history')
      .select('*')
      .gte('triggered_at', startDate.toISOString())
      .lte('triggered_at', endDate.toISOString());

    if (alertsError) {
      console.error('Error fetching alerts:', alertsError);
    }

    // Calculate statistics
    const stats: CallStats = {
      totalCalls: calls?.length || 0,
      avgDuration: 0,
      avgQualityScore: 0,
      successRate: 0,
      totalCost: 0,
      sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 },
      outcomeBreakdown: {},
      alertsTriggered: alerts?.length || 0,
      topIntents: [],
    };

    if (calls && calls.length > 0) {
      // Calculate averages
      let totalDuration = 0;
      let totalQuality = 0;
      let successfulCalls = 0;
      const intentCounts: Record<string, number> = {};

      calls.forEach((call: any) => {
        totalDuration += call.duration_seconds || 0;
        stats.totalCost += call.cost || 0;
        totalQuality += calculateQualityScore(call);

        // Sentiment breakdown
        if (call.sentiment === 'positive') stats.sentimentBreakdown.positive++;
        else if (call.sentiment === 'negative') stats.sentimentBreakdown.negative++;
        else stats.sentimentBreakdown.neutral++;

        // Outcome breakdown
        const outcome = call.call_outcome || 'unknown';
        stats.outcomeBreakdown[outcome] = (stats.outcomeBreakdown[outcome] || 0) + 1;

        // Success rate
        if (outcome === 'successful' || outcome === 'completed') successfulCalls++;

        // Intent tracking
        if (call.call_intent) {
          intentCounts[call.call_intent] = (intentCounts[call.call_intent] || 0) + 1;
        }
      });

      stats.avgDuration = Math.round(totalDuration / calls.length);
      stats.avgQualityScore = Math.round(totalQuality / calls.length);
      stats.successRate = Math.round((successfulCalls / calls.length) * 100);

      // Top intents
      stats.topIntents = Object.entries(intentCounts)
        .map(([intent, count]) => ({ intent, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    }

    const avgGrade = getGrade(stats.avgQualityScore);
    const gradeColor = getGradeColor(avgGrade);

    // Format duration
    const formatDuration = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}m ${secs}s`;
    };

    // Generate email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; padding: 30px; text-align: center; }
          .header h1 { margin: 0 0 5px 0; font-size: 24px; }
          .header p { margin: 0; opacity: 0.9; font-size: 14px; }
          .content { padding: 30px; }
          .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 25px; }
          .stat-card { background: #f8fafc; border-radius: 8px; padding: 15px; text-align: center; }
          .stat-value { font-size: 28px; font-weight: bold; color: #1e3a5f; }
          .stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; margin-top: 5px; }
          .grade-card { background: ${gradeColor}15; border: 2px solid ${gradeColor}; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 25px; }
          .grade { font-size: 48px; font-weight: bold; color: ${gradeColor}; }
          .grade-label { color: #64748b; font-size: 14px; }
          .section { margin-bottom: 25px; }
          .section h3 { color: #1e3a5f; margin: 0 0 15px 0; font-size: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
          .breakdown-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
          .breakdown-label { color: #475569; }
          .breakdown-value { font-weight: 600; color: #1e3a5f; }
          .alert-badge { background: #fef2f2; color: #dc2626; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
          .positive { color: #22c55e; }
          .negative { color: #ef4444; }
          .neutral { color: #64748b; }
          .footer { background: #f8fafc; padding: 20px; text-align: center; color: #64748b; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📊 Weekly Call Performance Report</h1>
            <p>${startDate.toLocaleDateString('en-AU')} - ${endDate.toLocaleDateString('en-AU')}</p>
          </div>
          
          <div class="content">
            <div class="grade-card">
              <div class="grade">${avgGrade}</div>
              <div class="grade-label">Average Quality Score: ${stats.avgQualityScore}/100</div>
            </div>
            
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-value">${stats.totalCalls}</div>
                <div class="stat-label">Total Calls</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${formatDuration(stats.avgDuration)}</div>
                <div class="stat-label">Avg Duration</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${stats.successRate}%</div>
                <div class="stat-label">Success Rate</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">$${stats.totalCost.toFixed(2)}</div>
                <div class="stat-label">Total Cost</div>
              </div>
            </div>
            
            <div class="section">
              <h3>📈 Sentiment Analysis</h3>
              <div class="breakdown-item">
                <span class="breakdown-label">😊 Positive</span>
                <span class="breakdown-value positive">${stats.sentimentBreakdown.positive} calls</span>
              </div>
              <div class="breakdown-item">
                <span class="breakdown-label">😐 Neutral</span>
                <span class="breakdown-value neutral">${stats.sentimentBreakdown.neutral} calls</span>
              </div>
              <div class="breakdown-item">
                <span class="breakdown-label">😞 Negative</span>
                <span class="breakdown-value negative">${stats.sentimentBreakdown.negative} calls</span>
              </div>
            </div>
            
            <div class="section">
              <h3>🎯 Call Outcomes</h3>
              ${Object.entries(stats.outcomeBreakdown).map(([outcome, count]) => `
                <div class="breakdown-item">
                  <span class="breakdown-label">${outcome.charAt(0).toUpperCase() + outcome.slice(1)}</span>
                  <span class="breakdown-value">${count} calls</span>
                </div>
              `).join('')}
            </div>
            
            ${stats.topIntents.length > 0 ? `
              <div class="section">
                <h3>💡 Top Call Intents</h3>
                ${stats.topIntents.map(({ intent, count }) => `
                  <div class="breakdown-item">
                    <span class="breakdown-label">${intent}</span>
                    <span class="breakdown-value">${count} calls</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            
            <div class="section">
              <h3>🚨 Alerts Summary</h3>
              <div class="breakdown-item">
                <span class="breakdown-label">Total Alerts Triggered</span>
                <span class="alert-badge">${stats.alertsTriggered} alerts</span>
              </div>
            </div>
          </div>
          
          <div class="footer">
            <p>This report was automatically generated by ${(await getBrandConfig()).companyName} Call Analytics</p>
            <p>© ${new Date().getFullYear()} ${(await getBrandConfig()).companyName}. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email
    const brand = await getBrandConfig();
    const { error: emailError } = await resend.emails.send({
      from: brand.fromHeaderAdmin,
      to: [recipientEmail],
      subject: `Weekly Call Report - ${startDate.toLocaleDateString('en-AU')} to ${endDate.toLocaleDateString('en-AU')}`,
      html: emailHtml,
    });

    if (emailError) {
      console.error('Error sending email:', emailError);
      throw emailError;
    }

    console.log(`Weekly report sent to ${recipientEmail}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Report sent to ${recipientEmail}`,
        stats 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in send-weekly-call-report:", error);
    return new Response(
      JSON.stringify(internalError(error, 'send-weekly-call-report')),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
