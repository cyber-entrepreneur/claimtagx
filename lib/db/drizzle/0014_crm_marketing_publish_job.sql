-- Include marketing scheduled-publish in recurring job dedupe index

DELETE FROM crm_jobs a
USING crm_jobs b
WHERE a.id <> b.id
  AND a.type = b.type
  AND a.type IN (
    'refresh_sla',
    'enforce_retention',
    'graph_mail_subscription_renewal',
    'graph_mail_delta_sync',
    'marketing_publish_due'
  )
  AND a.status IN ('pending', 'running')
  AND b.status IN ('pending', 'running')
  AND a.created_at > b.created_at;

DROP INDEX IF EXISTS crm_jobs_recurring_active_uidx;

CREATE UNIQUE INDEX crm_jobs_recurring_active_uidx ON public.crm_jobs USING btree (type)
WHERE (
  type = ANY (
    ARRAY[
      'refresh_sla'::text,
      'enforce_retention'::text,
      'graph_mail_subscription_renewal'::text,
      'graph_mail_delta_sync'::text,
      'marketing_publish_due'::text
    ]
  )
  AND status = ANY (ARRAY['pending'::text, 'running'::text])
);
