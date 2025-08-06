# Production Setup Guide: incident.io ↔ ServiceNow Synchronization

## Overview

This service provides real-time bidirectional synchronization between incident.io and ServiceNow, ensuring that incident data stays consistent across both platforms.

## Features

- **Forward Sync**: incident.io → ServiceNow (incident creation/updates)
- **Reverse Sync**: ServiceNow → incident.io (priority/severity mapping)
- **Loop Prevention**: Intelligent cooldown mechanisms prevent sync loops
- **Configurable Mappings**: Fully customizable field mappings
- **Production Ready**: Comprehensive logging, error handling, and monitoring

## Prerequisites

1. **ServiceNow Instance**: Admin access to configure webhooks and custom fields
2. **incident.io Organization**: API access and webhook configuration
3. **Node.js**: Version 18 or higher
4. **Docker** (optional): For containerized deployment

## Configuration

### 1. Environment Variables

Create a `.env` file with the following variables:

```bash
# ServiceNow Configuration
SERVICENOW_USERNAME=your-servicenow-username
SERVICENOW_PASSWORD=your-servicenow-password
SERVICENOW_INSTANCE_URL=https://your-instance.service-now.com

# incident.io Configuration  
INCIDENT_IO_API_KEY=your-incident-io-api-key
SERVICENOW_LINK_FIELD_ID=your-custom-field-uuid

# Webhook Security (optional)
WEBHOOK_SECRET=your-webhook-secret
SERVICENOW_WEBHOOK_SECRET=your-servicenow-webhook-secret
```

### 2. Severity UUID Configuration

**CRITICAL**: You must configure the correct incident.io severity UUIDs for your organization.

1. **Find Your Severity UUIDs**:
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" \
        https://api.incident.io/v2/catalog_v2/types/Severity
   ```

2. **Update Field Mappings**: Edit `config/field-mappings.json`:
   ```json
   "reverse_mappings": {
     "severity": {
       "1": "YOUR_CRITICAL_SEVERITY_UUID",
       "2": "YOUR_MAJOR_SEVERITY_UUID", 
       "3": "YOUR_MINOR_SEVERITY_UUID",
       "4": "YOUR_MINOR_SEVERITY_UUID",
       "5": "YOUR_MINOR_SEVERITY_UUID"
     }
   }
   ```

### 3. ServiceNow Configuration

#### Custom Fields
Add these fields to your ServiceNow incident table:

- `u_incident_io_id` (String, 40 chars) - Stores incident.io incident ID
- `u_incident_io_url` (URL) - Stores incident.io incident permalink

#### Business Rule for Reverse Sync
Create a ServiceNow Business Rule to trigger webhooks:

```javascript
(function executeRule(current, previous) {
    // Only process updates, not inserts
    if (current.operation() != 'update') return;
    
    // Track which fields changed
    var changedFields = [];
    var oldValues = {};
    
    // Check key fields for changes
    var fieldsToWatch = ['priority', 'urgency', 'impact', 'incident_state', 'short_description', 'description'];
    
    fieldsToWatch.forEach(function(field) {
        if (current[field].changes()) {
            changedFields.push(field);
            oldValues[field] = previous[field].toString();
        }
    });
    
    if (changedFields.length > 0) {
        // Send webhook to sync service
        var payload = {
            sys_id: current.sys_id.toString(),
            table: 'incident',
            operation: 'update',
            updated_fields: changedFields,
            old_values: oldValues
        };
        
        // Configure your webhook URL
        var webhook = new sn_ws.RESTMessageV2();
        webhook.setEndpoint('https://your-sync-service.com/webhook/servicenow');
        webhook.setHttpMethod('POST');
        webhook.setRequestHeader('Content-Type', 'application/json');
        webhook.setRequestBody(JSON.stringify(payload));
        
        webhook.execute();
    }
})(current, previous);
```

### 4. incident.io Configuration

1. **Create Custom Field for ServiceNow Links**:
   - Go to incident.io Settings → Custom Fields
   - Create a new "Link" type field named "ServiceNow Link"
   - Copy the custom field UUID (from URL or API response)
   - Add to your `.env` file: `SERVICENOW_LINK_FIELD_ID=your-field-uuid-here`

2. **Find Custom Field UUID** (if needed):
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" \
        https://api.incident.io/v2/custom_fields
   ```

3. **Configure Webhook**: Set up webhook to point to your sync service:
   - URL: `https://your-sync-service.com/webhook`
   - Events: `incident.created`, `incident.updated`, `incident.status_updated`

## Deployment

### Docker Deployment (Recommended)

1. **Build and Run**:
   ```bash
   docker-compose up -d
   ```

2. **Monitor Logs**:
   ```bash
   docker-compose logs -f
   ```

### Native Node.js Deployment

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Service**:
   ```bash
   npm start
   ```

## Monitoring

### Health Check Endpoint
```bash
curl https://your-sync-service.com/health
```

### Log Monitoring
- Logs are written to `logs/app.log`
- JSON format for easy parsing
- Monitor for ERROR level messages

### Key Metrics to Monitor
- Sync success/failure rates
- Response times from both APIs
- Loop prevention triggers
- Field mapping failures

## Troubleshooting

### Common Issues

1. **Severity Not Updating**: Check that severity UUIDs match your incident.io organization
2. **Sync Loops**: Verify cooldown period is adequate (default: 30 seconds)
3. **Authentication Errors**: Verify API keys and ServiceNow credentials
4. **Field Mapping Errors**: Check ServiceNow field names and types

### Debug Mode
Set logging level to "debug" in `config/config.json` for detailed troubleshooting.

### Manual Testing
If `enable_manual_sync_endpoints` is enabled, you can manually trigger syncs:
```bash
curl -X POST https://your-sync-service.com/sync/servicenow/SERVICENOW_SYS_ID \
     -H "Content-Type: application/json" \
     -d '{"updated_fields": ["priority"]}'
```

## Security Considerations

1. **Enable Webhook Signatures**: Set `verify_signature: true` in config
2. **Use HTTPS**: Deploy behind SSL termination
3. **Network Security**: Restrict access to webhook endpoints
4. **Credential Management**: Use environment variables, not hardcoded values
5. **Disable Debug Endpoints**: Keep `enable_manual_sync_endpoints: false` in production

## Performance Tuning

### Rate Limiting
Configure in `config/config.json`:
```json
"performance": {
  "concurrent_requests": 5,
  "batch_size": 10, 
  "rate_limit": {
    "requests_per_minute": 60
  }
}
```

### Resource Requirements
- **Minimum**: 512MB RAM, 1 vCPU
- **Recommended**: 1GB RAM, 2 vCPU
- **Storage**: 10GB for logs and application

## Support

For issues or questions:
1. Check application logs for error details
2. Verify configuration against this guide
3. Test individual API calls to isolate issues
4. Review field mappings for accuracy