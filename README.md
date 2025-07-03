# incident.io to ServiceNow Sync

Automatically sync incidents between incident.io and ServiceNow without Zapier.

## Quick Setup

1. **Deploy to Railway:**
   - Fork this repo
   - Connect to Railway
   - Set environment variables (see below)

2. **Configure Environment Variables:**
   ```
   INCIDENT_IO_WEBHOOK_SECRET=your_webhook_secret
   INCIDENT_IO_API_KEY=your_incident_io_private_api_key
   SERVICENOW_INSTANCE_URL=https://your-instance.service-now.com  
   SERVICENOW_USERNAME=your_username
   SERVICENOW_PASSWORD=your_password
   ```

3. **Set up incident.io webhook:**
   - Go to incident.io Settings > Webhooks
   - Add webhook URL: `https://your-railway-app.railway.app/webhook/incident`
   - Select events: `incident.created`, `incident.updated`

## Local Development

```bash
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev
```

## How it works

- Receives incident.io webhooks for `incident.created` and `incident.updated` events
- Calls incident.io API to get full incident details 
- Creates/updates corresponding ServiceNow incidents
- Updates ServiceNow work notes with incident.io updates (with deduplication)
- Maps severity to urgency/impact
- Tracks incidents via custom field `u_incident_io_id`

## ServiceNow Setup

You'll need to create a custom field in your ServiceNow incident table:
- Field name: `u_incident_io_id` 
- Type: String
- Label: "Incident.io ID"

## Field Mappings

| incident.io | ServiceNow |
|-------------|------------|
| Critical    | Urgency 1, Impact 1 |
| High        | Urgency 2, Impact 2 |
| Medium/Low  | Urgency 3, Impact 3 |

## Health Check

`GET /health` - Returns service status