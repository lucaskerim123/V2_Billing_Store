-- OrbitFS Mail sender roles + release/deployment customer templates.
-- Billing Store owns customer-facing mail presentation. License Manager remains the
-- technical authority for release/deployment state and must supply authoritative
-- event data when these automations are emitted.

insert into public.mail_accounts(address,display_name,kind,active,assigned_user_id)
values
  ('info@orbitfs.cc','OrbitFS','no-reply',true,null),
  ('support@orbitfs.cc','OrbitFS Support','shared',true,null),
  ('billing@orbitfs.cc','OrbitFS Billing','shared',true,null)
on conflict (address) do nothing;

insert into public.mail_settings(key,value)
values (
  'outbound',
  jsonb_build_object(
    'sender_name','OrbitFS',
    'default_from','info@orbitfs.cc',
    'reply_to','support@orbitfs.cc',
    'customer_sender','support@orbitfs.cc',
    'customer_sender_name','OrbitFS Support',
    'system_sender','info@orbitfs.cc',
    'support_sender','support@orbitfs.cc',
    'billing_sender','billing@orbitfs.cc'
  )
)
on conflict (key) do update
set value=coalesce(public.mail_settings.value,'{}'::jsonb)||excluded.value;

-- Normalize existing templates by mail responsibility before retiring the old
-- no-reply sender. Delivery history and mailbox records are left untouched.
update public.mail_templates
set from_account='support@orbitfs.cc'
where lower(coalesce(category,''))='support'
   or lower(coalesce(template_key,'')) like 'support.%';

update public.mail_templates
set from_account='billing@orbitfs.cc'
where lower(coalesce(category,''))='billing'
   or lower(coalesce(template_key,'')) like 'invoice.%'
   or lower(coalesce(template_key,'')) like 'payment.%'
   or lower(coalesce(template_key,'')) like 'refund.%'
   or lower(coalesce(template_key,''))='order.paid';

update public.mail_templates
set from_account='info@orbitfs.cc'
where lower(coalesce(from_account,''))='noreply@orbitfs.cc';

insert into public.mail_templates
  (template_key,name,category,subject,html,text_body,from_account,enabled)
values
  (
    'release.update_available',
    'Update available',
    'releases',
    'OrbitFS {{product_name}} {{version}} update available',
    '<p>Hi {{customer_name}},</p><p>An update is available for <strong>{{product_name}}</strong>.</p><p><strong>Version:</strong> {{version}}<br><strong>Your version:</strong> {{current_version}}<br><strong>Channel:</strong> {{channel}}</p><p>{{release_notes}}</p><p><a href="{{update_url}}">Review and deploy the update</a></p>',
    'Hi {{customer_name}},\n\nAn update is available for {{product_name}}.\nVersion: {{version}}\nYour version: {{current_version}}\nChannel: {{channel}}\n\n{{release_notes}}\n\nReview and deploy: {{update_url}}',
    'info@orbitfs.cc',
    true
  ),
  (
    'release.update_released',
    'Update released',
    'releases',
    'OrbitFS {{product_name}} {{version}} has been released',
    '<p>Hi {{customer_name}},</p><p><strong>{{product_name}} {{version}}</strong> has been released to the <strong>{{channel}}</strong> channel.</p><p>{{release_notes}}</p><p><a href="{{release_url}}">View release details</a></p>',
    'Hi {{customer_name}},\n\n{{product_name}} {{version}} has been released to the {{channel}} channel.\n\n{{release_notes}}\n\nView release details: {{release_url}}',
    'info@orbitfs.cc',
    true
  ),
  (
    'deployment.ready',
    'Deployment ready',
    'deployments',
    '{{product_name}} {{version}} is ready to deploy',
    '<p>Hi {{customer_name}},</p><p><strong>{{product_name}} {{version}}</strong> is ready for {{deployment_type}} deployment.</p><p>The deployment will only start when you approve it from your customer portal.</p><p><a href="{{deploy_url}}">Open deployment</a></p>',
    'Hi {{customer_name}},\n\n{{product_name}} {{version}} is ready for {{deployment_type}} deployment.\nThe deployment will only start when you approve it from your customer portal.\n\nOpen deployment: {{deploy_url}}',
    'info@orbitfs.cc',
    true
  ),
  (
    'deployment.started',
    'Deployment started',
    'deployments',
    '{{product_name}} {{version}} deployment started',
    '<p>Hi {{customer_name}},</p><p>Your <strong>{{deployment_type}}</strong> deployment for <strong>{{product_name}} {{version}}</strong> has started.</p><p>Deployment reference: <strong>{{deployment_id}}</strong></p><p>You can follow progress from the customer portal.</p>',
    'Hi {{customer_name}},\n\nYour {{deployment_type}} deployment for {{product_name}} {{version}} has started.\nDeployment reference: {{deployment_id}}\n\nYou can follow progress from the customer portal.',
    'info@orbitfs.cc',
    true
  ),
  (
    'deployment.succeeded',
    'Deployment completed',
    'deployments',
    '{{product_name}} {{version}} deployment completed',
    '<p>Hi {{customer_name}},</p><p>Your <strong>{{deployment_type}}</strong> deployment for <strong>{{product_name}} {{version}}</strong> completed successfully.</p><p><a href="{{environment_url}}">Open your environment</a></p>',
    'Hi {{customer_name}},\n\nYour {{deployment_type}} deployment for {{product_name}} {{version}} completed successfully.\n\nOpen your environment: {{environment_url}}',
    'info@orbitfs.cc',
    true
  ),
  (
    'deployment.failed',
    'Deployment failed',
    'deployments',
    '{{product_name}} {{version}} deployment needs attention',
    '<p>Hi {{customer_name}},</p><p>Your <strong>{{deployment_type}}</strong> deployment for <strong>{{product_name}} {{version}}</strong> did not complete.</p><p><strong>What happened:</strong> {{error_summary}}</p><p>Your existing authorised release state has not been changed by this email. Review the deployment in the customer portal before retrying.</p><p><a href="{{deployment_url}}">Review deployment</a></p><p>If you need help, contact <a href="mailto:support@orbitfs.cc">support@orbitfs.cc</a>.</p>',
    'Hi {{customer_name}},\n\nYour {{deployment_type}} deployment for {{product_name}} {{version}} did not complete.\nWhat happened: {{error_summary}}\n\nYour existing authorised release state has not been changed by this email. Review the deployment before retrying.\n\nReview deployment: {{deployment_url}}\nSupport: support@orbitfs.cc',
    'info@orbitfs.cc',
    true
  ),
  (
    'deployment.action_required',
    'Deployment action required',
    'deployments',
    'Action required for {{product_name}} deployment',
    '<p>Hi {{customer_name}},</p><p>Your deployment for <strong>{{product_name}} {{version}}</strong> needs a manual step before it can continue.</p><p>{{action_required}}</p><p><a href="{{deployment_url}}">Continue deployment</a></p>',
    'Hi {{customer_name}},\n\nYour deployment for {{product_name}} {{version}} needs a manual step before it can continue.\n\n{{action_required}}\n\nContinue deployment: {{deployment_url}}',
    'info@orbitfs.cc',
    true
  ),
  (
    'deployment.rollback_succeeded',
    'Rollback completed',
    'deployments',
    '{{product_name}} rollback completed',
    '<p>Hi {{customer_name}},</p><p>Your <strong>{{product_name}}</strong> rollback completed successfully.</p><p><strong>Restored version:</strong> {{rollback_version}}</p><p><a href="{{environment_url}}">Open your environment</a></p>',
    'Hi {{customer_name}},\n\nYour {{product_name}} rollback completed successfully.\nRestored version: {{rollback_version}}\n\nOpen your environment: {{environment_url}}',
    'info@orbitfs.cc',
    true
  )
on conflict (template_key) do nothing;

insert into public.mail_automations
  (event_key,name,category,description,template_key,enabled,variables)
values
  ('release.update_available','Update available','releases','Notify an entitled customer when License Manager reports that a newer update is available in the customer''s release channel.','release.update_available',true,'["customer_name","product_name","current_version","version","channel","release_notes","update_url"]'::jsonb),
  ('release.update_released','Update released','releases','Notify customers when Billing publishes an approved update for customer presentation.','release.update_released',true,'["customer_name","product_name","version","channel","release_notes","release_url"]'::jsonb),
  ('deployment.ready','Deployment ready','deployments','Notify the customer when an authorised Base or Update deployment is ready for customer approval.','deployment.ready',true,'["customer_name","product_name","version","deployment_type","deploy_url"]'::jsonb),
  ('deployment.started','Deployment started','deployments','Notify the customer when the customer deployer starts an authorised deployment.','deployment.started',true,'["customer_name","product_name","version","deployment_type","deployment_id"]'::jsonb),
  ('deployment.succeeded','Deployment completed','deployments','Notify the customer after License Manager records a successful deployment result.','deployment.succeeded',true,'["customer_name","product_name","version","deployment_type","environment_url"]'::jsonb),
  ('deployment.failed','Deployment failed','deployments','Notify the customer after License Manager records a failed deployment result.','deployment.failed',true,'["customer_name","product_name","version","deployment_type","error_summary","deployment_url"]'::jsonb),
  ('deployment.action_required','Deployment action required','deployments','Notify the customer when the deployer requires a manual provider or environment step.','deployment.action_required',true,'["customer_name","product_name","version","action_required","deployment_url"]'::jsonb),
  ('deployment.rollback_succeeded','Rollback completed','deployments','Notify the customer after an authorised rollback completes and the result is recorded.','deployment.rollback_succeeded',true,'["customer_name","product_name","rollback_version","environment_url"]'::jsonb)
on conflict (event_key) do nothing;
