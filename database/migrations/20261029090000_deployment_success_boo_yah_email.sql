-- Refresh the existing deployment success email; presentation only.
-- Deployment success remains authorised and recorded by License Manager.
insert into public.mail_templates
(template_key,name,category,subject,html,text_body,from_account,enabled)
values (
 'deployment.succeeded',
 'Deployment successful — Service is alive',
 'deployments',
 'Boo Yah! 🚀 Your Service Is Alive!',
 '<h1>BOO YAH! 🚀</h1><h2>Your service is officially ALIVE!</h2><p>Hey {{customer_name}},</p><p>Great news! Your deployment has successfully completed, and your <strong>{{product_name}}</strong> service is now up and running!</p><p>Everything is deployed, and your environment is ready for action.</p><h3>Your Service Details</h3><p><strong>Service:</strong> {{product_name}}<br><strong>Version:</strong> {{version}}<br><strong>Deployment Type:</strong> {{deployment_type}}<br><strong>Status:</strong> LIVE — Deployment Successful<br><strong>Your Website:</strong> <a href="{{environment_url}}">{{environment_url}}</a></p><h3>Time to take it for a spin!</h3><p>Your OrbitFS environment is ready. Head over to your live website and check out your freshly deployed service.</p><p><a href="{{environment_url}}"><strong>LAUNCH YOUR SERVICE</strong></a></p><p>You can also visit your OrbitFS customer portal to manage your service, review deployment activity and check for available updates.</p><h3>Need a hand?</h3><p>Something not looking right? Got a question? We are here to help.</p><p>Reach us at <a href="mailto:support@orbitfs.cc">support@orbitfs.cc</a>.</p><p>Thanks for choosing OrbitFS. Now go make something awesome!</p><p><strong>The OrbitFS Team</strong><br><em>Built to deploy. Ready to run.</em></p><p><small>This is an automated deployment confirmation from OrbitFS, sent after your deployment was successfully recorded.</small></p>',
 'BOO YAH! 🚀\nYour service is officially ALIVE!\n\nHey {{customer_name}},\n\nGreat news! Your deployment has successfully completed, and your {{product_name}} service is now up and running!\nEverything is deployed, and your environment is ready for action.\n\nYour Service Details\nService: {{product_name}}\nVersion: {{version}}\nDeployment Type: {{deployment_type}}\nStatus: LIVE — Deployment Successful\nYour Website: {{environment_url}}\n\nTime to take it for a spin!\nYour OrbitFS environment is ready. Head over to your live website and check out your freshly deployed service.\nLAUNCH YOUR SERVICE: {{environment_url}}\n\nYou can also visit your OrbitFS customer portal to manage your service, review deployment activity and check for available updates.\n\nNeed a hand?\nSomething not looking right? Got a question? We are here to help.\nReach us at support@orbitfs.cc.\n\nThanks for choosing OrbitFS. Now go make something awesome!\nThe OrbitFS Team\nBuilt to deploy. Ready to run.\n\nThis is an automated deployment confirmation from OrbitFS, sent after your deployment was successfully recorded.',
 'info@orbitfs.cc',
 true
)
on conflict (template_key) do update set
 name=excluded.name,
 category=excluded.category,
 subject=excluded.subject,
 html=excluded.html,
 text_body=excluded.text_body,
 from_account=excluded.from_account,
 enabled=excluded.enabled,
 updated_at=now();
