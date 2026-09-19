import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));

    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) {
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }

    // Check superadmin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', authResult.userId)
      .eq('role', 'superadmin')
      .single();

    if (!roleData) {
      return createForbiddenResponse('Superadmin access required', corsHeaders);
    }

    const { mode = 'overview', days = 30, service_filter, budget_thresholds } = body;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString();

    if (mode === 'overview') {
      // ========== HEALTH LOGS (api_health_log) ==========
      const { data: allLogs, error: logsError } = await supabase
        .from('api_health_log')
        .select('*')
        .gte('created_at', startDateStr)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (logsError) throw logsError;
      const logs = allLogs || [];

      const totalCalls = logs.length;
      const successCalls = logs.filter((l: any) => l.status === 'success').length;
      const errorCalls = logs.filter((l: any) => l.status === 'error').length;
      const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 10000) / 100 : 0;
      const avgResponseTime = totalCalls > 0
        ? Math.round(logs.reduce((sum: number, l: any) => sum + (l.response_time_ms || 0), 0) / totalCalls)
        : 0;

      // Service breakdown
      const serviceMap: Record<string, { total: number; success: number; errors: number; avgTime: number; times: number[] }> = {};
      for (const log of logs) {
        const svc = log.service_name || 'unknown';
        if (!serviceMap[svc]) serviceMap[svc] = { total: 0, success: 0, errors: 0, avgTime: 0, times: [] };
        serviceMap[svc].total++;
        if (log.status === 'success') serviceMap[svc].success++;
        else serviceMap[svc].errors++;
        if (log.response_time_ms) serviceMap[svc].times.push(log.response_time_ms);
      }

      const serviceBreakdown = Object.entries(serviceMap).map(([name, stats]) => ({
        service: name,
        total: stats.total,
        success: stats.success,
        errors: stats.errors,
        successRate: stats.total > 0 ? Math.round((stats.success / stats.total) * 10000) / 100 : 0,
        avgResponseTime: stats.times.length > 0
          ? Math.round(stats.times.reduce((a, b) => a + b, 0) / stats.times.length)
          : 0,
      }));

      // Daily volume for charts
      const dailyMap: Record<string, Record<string, { success: number; errors: number; avgTime: number; times: number[] }>> = {};
      for (const log of logs) {
        const day = log.created_at.substring(0, 10);
        const svc = log.service_name || 'unknown';
        if (!dailyMap[day]) dailyMap[day] = {};
        if (!dailyMap[day][svc]) dailyMap[day][svc] = { success: 0, errors: 0, avgTime: 0, times: [] };
        if (log.status === 'success') dailyMap[day][svc].success++;
        else dailyMap[day][svc].errors++;
        if (log.response_time_ms) dailyMap[day][svc].times.push(log.response_time_ms);
      }

      const dailyVolume = Object.entries(dailyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, services]) => {
          const entry: Record<string, any> = { date };
          for (const [svc, stats] of Object.entries(services)) {
            entry[svc] = stats.success + stats.errors;
            entry[`${svc}_success`] = stats.success;
            entry[`${svc}_errors`] = stats.errors;
            entry[`${svc}_avgTime`] = stats.times.length > 0
              ? Math.round(stats.times.reduce((a, b) => a + b, 0) / stats.times.length)
              : 0;
          }
          return entry;
        });

      // Data quality breakdown
      const qualityMap: Record<string, number> = {};
      for (const log of logs) {
        const q = log.data_quality || 'unknown';
        qualityMap[q] = (qualityMap[q] || 0) + 1;
      }

      // Recent health logs (last 50)
      const recentLogs = logs.slice(0, 50).map((l: any) => ({
        id: l.id,
        service: l.service_name,
        endpoint: l.endpoint,
        status: l.status,
        responseTime: l.response_time_ms,
        dataQuality: l.data_quality,
        error: l.error_message,
        createdAt: l.created_at,
      }));

      const services = [...new Set(logs.map((l: any) => l.service_name))].filter(Boolean);

      // ========== CONSUMPTION LOGS (api_usage_log) ==========
      const { data: usageLogs, error: usageError } = await supabase
        .from('api_usage_log')
        .select('*')
        .gte('created_at', startDateStr)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (usageError) {
        console.warn('Failed to fetch api_usage_log:', usageError.message);
      }

      const uLogs = usageLogs || [];

      // Consumption summary
      const totalTokens = uLogs.reduce((sum: number, l: any) => sum + (l.tokens_used || 0), 0);
      const totalCost = uLogs.reduce((sum: number, l: any) => sum + (l.cost_estimate_usd || 0), 0);
      const totalUsageRequests = uLogs.length;

      // Per-service consumption
      const consumptionByService: Record<string, {
        requests: number;
        tokens: number;
        promptTokens: number;
        completionTokens: number;
        cost: number;
        models: Record<string, number>;
      }> = {};

      for (const log of uLogs) {
        const svc = log.service_name;
        if (!consumptionByService[svc]) {
          consumptionByService[svc] = { requests: 0, tokens: 0, promptTokens: 0, completionTokens: 0, cost: 0, models: {} };
        }
        consumptionByService[svc].requests++;
        consumptionByService[svc].tokens += log.tokens_used || 0;
        consumptionByService[svc].promptTokens += log.prompt_tokens || 0;
        consumptionByService[svc].completionTokens += log.completion_tokens || 0;
        consumptionByService[svc].cost += log.cost_estimate_usd || 0;
        if (log.model_used) {
          consumptionByService[svc].models[log.model_used] = (consumptionByService[svc].models[log.model_used] || 0) + 1;
        }
      }

      const consumptionBreakdown = Object.entries(consumptionByService).map(([service, stats]) => ({
        service,
        requests: stats.requests,
        tokens: stats.tokens,
        promptTokens: stats.promptTokens,
        completionTokens: stats.completionTokens,
        cost: Math.round(stats.cost * 10000) / 10000,
        topModel: Object.entries(stats.models).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown',
        models: stats.models,
      }));

      // Daily token/cost trends
      const dailyConsumptionMap: Record<string, Record<string, { tokens: number; cost: number; requests: number }>> = {};
      for (const log of uLogs) {
        const day = log.created_at.substring(0, 10);
        const svc = log.service_name;
        if (!dailyConsumptionMap[day]) dailyConsumptionMap[day] = {};
        if (!dailyConsumptionMap[day][svc]) dailyConsumptionMap[day][svc] = { tokens: 0, cost: 0, requests: 0 };
        dailyConsumptionMap[day][svc].tokens += log.tokens_used || 0;
        dailyConsumptionMap[day][svc].cost += log.cost_estimate_usd || 0;
        dailyConsumptionMap[day][svc].requests++;
      }

      const consumptionServices = [...new Set(uLogs.map((l: any) => l.service_name))].filter(Boolean);

      const dailyConsumption = Object.entries(dailyConsumptionMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, services]) => {
          const entry: Record<string, any> = { date };
          let dayTotalTokens = 0;
          let dayTotalCost = 0;
          for (const [svc, stats] of Object.entries(services)) {
            entry[`${svc}_tokens`] = stats.tokens;
            entry[`${svc}_cost`] = Math.round(stats.cost * 10000) / 10000;
            entry[`${svc}_requests`] = stats.requests;
            dayTotalTokens += stats.tokens;
            dayTotalCost += stats.cost;
          }
          entry.totalTokens = dayTotalTokens;
          entry.totalCost = Math.round(dayTotalCost * 10000) / 10000;
          return entry;
        });

      // Model usage distribution
      const modelMap: Record<string, number> = {};
      for (const log of uLogs) {
        if (log.model_used) {
          modelMap[log.model_used] = (modelMap[log.model_used] || 0) + 1;
        }
      }
      const modelDistribution = Object.entries(modelMap)
        .sort((a, b) => b[1] - a[1])
        .map(([model, count]) => ({ model, count }));

      // ========== VAPI CALL STATS ==========
      const { data: vapiCalls } = await supabase
        .from('vapi_call_logs')
        .select('id, duration_seconds, cost, started_at, call_direction, sentiment')
        .gte('created_at', startDateStr)
        .order('created_at', { ascending: false })
        .limit(1000);

      const vCalls = vapiCalls || [];
      const totalVapiCalls = vCalls.length;
      const totalVapiMinutes = Math.round(vCalls.reduce((s: number, c: any) => s + (c.duration_seconds || 0), 0) / 60);
      const totalVapiCost = vCalls.reduce((s: number, c: any) => s + (c.cost || 0), 0);
      const vapiInbound = vCalls.filter((c: any) => c.call_direction === 'inbound').length;
      const vapiOutbound = vCalls.filter((c: any) => c.call_direction === 'outbound').length;

      const vapiDailyMap: Record<string, { calls: number; minutes: number; cost: number }> = {};
      for (const c of vCalls) {
        const day = c.started_at?.substring(0, 10) || '';
        if (!day) continue;
        if (!vapiDailyMap[day]) vapiDailyMap[day] = { calls: 0, minutes: 0, cost: 0 };
        vapiDailyMap[day].calls++;
        vapiDailyMap[day].minutes += (c.duration_seconds || 0) / 60;
        vapiDailyMap[day].cost += c.cost || 0;
      }
      const vapiDailyTrend = Object.entries(vapiDailyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, stats]) => ({
          date,
          calls: stats.calls,
          minutes: Math.round(stats.minutes * 10) / 10,
          cost: Math.round(stats.cost * 100) / 100,
        }));

      // ========== BUDGET PROJECTIONS ==========
      const daysElapsed = Math.max(1, days);
      const dailyAvgCost = totalCost / daysElapsed;
      const projectedMonthlyCost = Math.round(dailyAvgCost * 30 * 100) / 100;
      const dailyAvgVapiCost = totalVapiCost / daysElapsed;
      const projectedMonthlyVapi = Math.round(dailyAvgVapiCost * 30 * 100) / 100;

      const serviceProjections = consumptionBreakdown.map(svc => ({
        service: svc.service,
        currentCost: svc.cost,
        dailyAvg: Math.round((svc.cost / daysElapsed) * 10000) / 10000,
        projectedMonthly: Math.round((svc.cost / daysElapsed) * 30 * 100) / 100,
      }));

      // Recent usage logs (last 50)
      const recentUsageLogs = uLogs.slice(0, 50).map((l: any) => ({
        id: l.id,
        service: l.service_name,
        endpoint: l.endpoint,
        model: l.model_used,
        tokens: l.tokens_used,
        promptTokens: l.prompt_tokens,
        completionTokens: l.completion_tokens,
        cost: l.cost_estimate_usd,
        status: l.status,
        createdAt: l.created_at,
        metadata: l.metadata,
      }));

      return new Response(JSON.stringify({
        success: true,
        summary: {
          totalCalls,
          successCalls,
          errorCalls,
          successRate,
          avgResponseTime,
          activeServices: services.length,
          period: `${days} days`,
        },
        serviceBreakdown,
        dailyVolume,
        dataQuality: qualityMap,
        services,
        recentLogs,
        consumption: {
          summary: {
            totalRequests: totalUsageRequests,
            totalTokens,
            totalCost: Math.round(totalCost * 10000) / 10000,
            activeServices: consumptionServices.length,
          },
          breakdown: consumptionBreakdown,
          dailyConsumption,
          consumptionServices,
          modelDistribution,
          recentUsageLogs,
        },
        vapi: {
          totalCalls: totalVapiCalls,
          totalMinutes: totalVapiMinutes,
          totalCost: Math.round(totalVapiCost * 100) / 100,
          inbound: vapiInbound,
          outbound: vapiOutbound,
          avgCostPerCall: totalVapiCalls > 0 ? Math.round((totalVapiCost / totalVapiCalls) * 100) / 100 : 0,
          dailyTrend: vapiDailyTrend,
        },
        projections: {
          dailyAvgCost: Math.round(dailyAvgCost * 10000) / 10000,
          projectedMonthlyCost,
          projectedMonthlyVapi,
          serviceProjections,
          totalProjectedMonthly: Math.round((projectedMonthlyCost + projectedMonthlyVapi) * 100) / 100,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Invalid mode' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in get-api-usage-stats:', error);
    return new Response(JSON.stringify({ ...internalError(error, 'get-api-usage-stats'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
