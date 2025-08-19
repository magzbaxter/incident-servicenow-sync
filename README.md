# Incident.io ↔ ServiceNow Bidirectional Sync

A production-ready integration that provides real-time bidirectional synchronization between incident.io and ServiceNow.

## What it does

- **Forward Sync**: incident.io incidents automatically create ServiceNow tickets
- **Reverse Sync**: ServiceNow updates sync back to incident.io (title, description, priority, work notes)
- **Smart Sync**: Only syncs essential fields, prevents infinite loops
- **Production Ready**: Docker deployment, health monitoring, comprehensive logging

## Quick Start

### 1. Prerequisites
- Node.js 18+
- incident.io API access
- ServiceNow instance with admin access

### 2. Setup
```bash
git clone <repository-url>
cd incident-servicenow-sync
cp .env.example .env
```

### 3. Configure Environment
Edit `.env` with your credentials:
```bash
INCIDENT_IO_API_KEY=your_incident_io_api_key
SERVICENOW_INSTANCE_URL=https://your-instance.service-now.com
SERVICENOW_USERNAME=your_servicenow_username
SERVICENOW_PASSWORD=your_servicenow_password
PORT=3000
```

### 4. Deploy with Docker (Recommended)
```bash
docker-compose up -d
```

### 5. Configure Webhooks

#### incident.io Webhook
1. Go to Settings → Webhooks
2. Create webhook: `https://your-domain.com/webhook`
3. Events: `incident_created_v2`, `incident_updated_v2`, `incident_status_updated_v2`

#### ServiceNow Setup
1. **Create Custom Field** in incident table:
   - Name: `u_incident_io_id`
   - Type: String (40 chars)
   - Unique: ✅

2. **Create Business Rule**:
   - Table: incident
   - When: after update
   - Condition: `incident.io Id is not empty`
   - Script: [See detailed setup guide](docs/SETUP.md#servicenow-business-rule)

### 6. Verify
```bash
curl http://localhost:3000/health
```

## Field Mapping

### Forward Sync (incident.io → ServiceNow)
- Name → Short Description
- Summary → Description  
- Severity → Priority/Impact/Urgency
- Status → State
- Updates → Work Notes

### Reverse Sync (ServiceNow → incident.io)
- Short Description → Name
- Description → Summary
- Priority → Severity
- Work Notes → Timeline Updates

## ⚠️ Status Sync Limitations

**IMPORTANT**: Status synchronization has specific limitations due to incident.io workflow rules:

- ✅ **Works**: Syncing between active statuses (Investigating ↔ Fixing ↔ Monitoring)
- ❌ **Does NOT work**: Closing incidents from either system will NOT close the incident in the other system
- ❌ **Does NOT work**: Reopening closed incidents from either system

**Why**: incident.io enforces strict workflow rules that only allow transitions between "live" statuses. Closing an incident requires proper workflow completion in each system independently.

**Best Practice**: Always close incidents directly in the system where resolution was achieved.

## Configuration

### Essential Configuration Files
- **`.env`** - API credentials and server config
- **`config/config.json`** - System integration settings
- **`config/field-mappings.json`** - Field mapping rules

**Critical**: Update severity UUIDs in `field-mappings.json` to match your incident.io organization:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://api.incident.io/v1/severities
```

## Troubleshooting

### Common Issues
- **No sync happening**: Check ServiceNow custom field `u_incident_io_id` exists and is populated
- **Status sync fails**: incident.io only allows transitions between active statuses
- **Webhook errors**: Verify endpoint URLs and signature secrets match

### Debug Mode
```bash
export LOG_LEVEL=debug
docker-compose restart
docker-compose logs -f
```

## Health Check
- Endpoint: `GET /health`
- Returns: Service status and configuration

## Documentation
- [Detailed Setup Guide](docs/SETUP.md)
- [ServiceNow Configuration](docs/servicenow-business-rules.md)
- [Bidirectional Sync Details](docs/bidirectional-sync.md)

## Support
1. Check logs: `docker-compose logs -f`
2. Verify configuration matches examples
3. Test API connectivity to both systems
4. Enable debug logging for detailed troubleshooting