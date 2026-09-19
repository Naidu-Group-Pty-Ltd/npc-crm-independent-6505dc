import { useEffect, useRef, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useNotifications } from '@/contexts/NotificationsContext';

interface BackgroundJob {
  id: string;
  type: 'bulk_generation' | 'comparison_analysis' | 'investment_report';
}

/**
 * `localStorage` throws on *property access* where site data is blocked
 * (Safari private browsing, "block all cookies", enterprise policy) — not just
 * on write. This component mounts above the router, so an unguarded throw here
 * took down every page including sign-in. A dropped job list is a lost
 * convenience; a page that will not render is not.
 */
function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* jobs not persisted across reloads */ }
}

export function BackgroundJobTracker() {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const jobsRef = useRef<BackgroundJob[]>([]);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { addNotification } = useNotifications();
  const processedJobsRef = useRef<Set<string>>(new Set());

  // Keep jobsRef in sync with jobs state
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  // Load jobs from localStorage on mount and also load processed jobs
  useEffect(() => {
    const stored = readStored('background_jobs');
    const processedStored = readStored('processed_jobs');
    
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setJobs(parsed);
      } catch (error) {
        console.error('Failed to parse background jobs:', error);
      }
    }
    
    if (processedStored) {
      try {
        const parsed = JSON.parse(processedStored);
        processedJobsRef.current = new Set(parsed);
      } catch (error) {
        console.error('Failed to parse processed jobs:', error);
      }
    }
  }, []);

  // Save jobs to localStorage whenever they change
  useEffect(() => {
    writeStored('background_jobs', JSON.stringify(jobs));
  }, [jobs]);

  // Save processed jobs to localStorage whenever they change
  useEffect(() => {
    const saveProcessedJobs = () => {
      writeStored('processed_jobs', JSON.stringify(Array.from(processedJobsRef.current)));
    };
    
    // Debounce saves
    const timeoutId = setTimeout(saveProcessedJobs, 500);
    return () => clearTimeout(timeoutId);
  }, [jobs]); // Trigger when jobs change to ensure processed state is saved

  // Poll for job status
  useEffect(() => {
    if (jobs.length === 0) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const checkAllJobs = async () => {
      const currentJobs = jobsRef.current;
      for (const job of currentJobs) {
        try {
          if (job.type === 'bulk_generation') {
            await checkBulkGenerationJob(job.id);
          } else if (job.type === 'comparison_analysis') {
            await checkComparisonJob(job.id);
          } else if (job.type === 'investment_report') {
            await checkInvestmentReportJob(job.id);
          }
        } catch (error) {
          console.error(`Error checking job ${job.id}:`, error);
        }
      }
    };

    if (!pollIntervalRef.current) {
      pollIntervalRef.current = setInterval(checkAllJobs, 3000);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [jobs.length]);

  const checkBulkGenerationJob = async (jobId: string) => {
    if (processedJobsRef.current.has(jobId)) return;

    const { data, error } = await invokeSecureFunction('manage-templates', {
      operation: 'get',
      table: 'bulk_generation_jobs',
      recordId: jobId
    });

    if (error || !data?.record) return;

    const job = data.record;
    
    if (job.status === 'completed') {
      addNotification({
        type: 'info',
        title: 'Bulk Generation Complete',
        message: `Successfully generated ${job.completed_reports} of ${job.total_reports} reports`
      });
      processedJobsRef.current.add(jobId);
      removeJob(jobId);
    } else if (job.status === 'failed') {
      addNotification({
        type: 'report_failed',
        title: 'Bulk Generation Failed',
        message: `Failed to complete bulk generation. ${job.failed_reports} reports failed.`
      });
      processedJobsRef.current.add(jobId);
      removeJob(jobId);
    }
  };

  const checkComparisonJob = async (jobId: string) => {
    if (processedJobsRef.current.has(jobId)) return;

    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      table: 'property_comparisons',
      reportId: jobId
    });

    if (!error && data?.report) {
      addNotification({
        type: 'info',
        title: 'Comparison Analysis Complete',
        message: 'Your property comparison analysis is ready to view'
      });
      processedJobsRef.current.add(jobId);
      removeJob(jobId);
    }
  };

  const checkInvestmentReportJob = async (jobId: string) => {
    // Check if already processed BEFORE making any async calls
    if (processedJobsRef.current.has(jobId)) return;
    
    // CRITICAL: Add to processed set IMMEDIATELY to prevent race conditions
    // This prevents duplicate notifications when polling overlaps
    processedJobsRef.current.add(jobId);

    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      reportId: jobId,
      listOptions: {
        select: 'id, property_address, status, error_message'
      }
    });

    if (error || !data?.report) {
      // If fetch failed, remove from processed so it can be retried
      processedJobsRef.current.delete(jobId);
      return;
    }
    
    const report = data.report;
    
    if (report.status === 'completed') {
      // Server-side Edge Function already creates a notification in the database
      // We just need to clean up the background job tracking
      // Skip adding duplicate notification here - the NotificationsContext will fetch from DB
      console.log(`[BackgroundJobTracker] Report ${jobId} completed - cleaning up job (notification from server)`);
      removeJob(jobId);
    } else if (report.status === 'failed') {
      // For failures, we DO add a notification since the server might not
      addNotification({
        type: 'report_failed',
        title: 'Investment Report Failed',
        message: `Failed to generate report for ${report.property_address}. ${report.error_message || 'Please try again.'}`,
      });
      removeJob(jobId);
    } else {
      // Still in progress - remove from processed set so we check again
      processedJobsRef.current.delete(jobId);
    }
  };

  const removeJob = (jobId: string) => {
    setJobs(prev => prev.filter(j => j.id !== jobId));
  };

  // Listen for new jobs
  useEffect(() => {
    const handleAddJob = (event: CustomEvent<BackgroundJob>) => {
      setJobs(prev => {
        // Don't add if already exists
        if (prev.some(j => j.id === event.detail.id)) return prev;
        return [...prev, event.detail];
      });
    };

    window.addEventListener('addBackgroundJob' as any, handleAddJob);
    return () => window.removeEventListener('addBackgroundJob' as any, handleAddJob);
  }, []);

  return null; // This component doesn't render anything
}

// Helper function to add a job from anywhere in the app
export function addBackgroundJob(job: BackgroundJob) {
  window.dispatchEvent(new CustomEvent('addBackgroundJob', { detail: job }));
}
