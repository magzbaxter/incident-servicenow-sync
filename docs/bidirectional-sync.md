# Bi-directional Synchronization

This document explains the bi-directional synchronization feature that allows changes in ServiceNow to automatically update incident.io and vice versa.

## Overview

The integration supports two-way synchronization:

1. **incident.io → ServiceNow**: Triggered by incident.io webhooks (original functionality)
2. **ServiceNow → incident.io**: Triggered by ServiceNow Business Rules (new functionality)

## Architecture

```
incident.io ←→ Integration Service ←→ ServiceNow
     ↑              ↓                    ↑
     │         Webhook               Business
     │         Handlers              Rules
     │              ↓                    ↑
     └─── API Updates ←→ Field Mapping ──┘
```

## Forward Sync (incident.io → ServiceNow)

### Process Flow
1. Incident updated in incident.io
2. incident.io sends webhook to `/webhook`
3. Integration processes webhook
4. ServiceNow incident updated via REST API

### Supported Events
- `public_incident.incident_created_v2`
- `public_incident.incident_updated_v2`

### Field Mappings
- `incident.name` → `short_description`
- `incident.summary` → `description`
- `incident.most_recent_update_message` → `work_notes`

## Reverse Sync (ServiceNow → incident.io)

### Process Flow
1. Incident updated in ServiceNow
2. Business Rule triggers and sends webhook to `/webhook/servicenow`
3. Integration processes ServiceNow webhook
4. incident.io incident updated via API

### Supported Fields
- `short_description` → `incident.name`
- `description` → `incident.summary`
- `work_notes` → incident.io update message
- `incident_state` → `incident.status` (if enabled)
- `priority` → `incident.severity` (if enabled)

## Configuration

### Enable Reverse Sync

Update your `config.json`:

```json
{
  "features": {
    "reverse_sync": true,
    "sync_status": false,
    "sync_severity": false
  },
  "servicenow_webhook": {
    "verify_signature": false,
    "secret": "your-webhook-secret"
  }
}
```

### Field Mapping Configuration

The `config/field-mappings.json` includes reverse mappings:

```json
{
  "reverse_mappings": {
    "status": {
      "1": "open",      // New → open
      "2": "open",      // In Progress → open  
      "3": "open",      // On Hold → open
      "6": "closed",    // Resolved → closed
      "7": "closed",    // Closed → closed
      "8": "closed"     // Canceled → closed
    },
    "severity": {
      "1": "critical",  // Critical → critical
      "2": "major",     // High → major
      "3": "minor",     // Moderate → minor
      "4": "minor",     // Low → minor
      "5": "minor"      // Planning → minor
    }
  }
}
```

## ServiceNow Setup

### 1. Create Custom Field

Create a custom field to store the incident.io ID:

1. Navigate to **System Definition > Tables**
2. Find and open the **Incident [incident]** table
3. Go to the **Columns** tab
4. Create a new column:
   - **Type**: String
   - **Column label**: Incident.io ID
   - **Column name**: u_incident_io_id
   - **Max length**: 100

### 2. Create Business Rule

See [ServiceNow Business Rules Setup](./servicenow-business-rules.md) for detailed instructions.

## API Endpoints

### Webhook Endpoints

- `POST /webhook` - incident.io webhook (forward sync)
- `POST /webhook/servicenow` - ServiceNow webhook (reverse sync)

### Manual Sync Endpoints

- `POST /sync/incident/:incidentId` - Manual forward sync
- `POST /sync/servicenow/:sysId` - Manual reverse sync

### Testing Endpoints

Test reverse sync manually:

```bash
curl -X POST http://localhost:$PORT/sync/servicenow/abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "updated_fields": ["short_description", "description"],
    "old_values": {
      "short_description": "Old title",
      "description": "Old description"
    }
  }'
```

## Preventing Sync Loops

The integration includes several mechanisms to prevent infinite sync loops:

### 1. Processing Locks
- Forward sync uses `processingIncidents` Set
- Reverse sync uses `processingUpdates` Set

### 2. Field Change Detection
- Only processes actual field changes
- Compares old vs new values
- Skips updates if no relevant changes

### 3. Rate Limiting
- Configurable delays between API calls
- Prevents overwhelming external APIs

## Monitoring and Logging

### Log Levels

Set appropriate log levels in your configuration:

```json
{
  "logging": {
    "level": "info"  // or "debug" for detailed logs
  }
}
```

### Key Log Messages

**Forward Sync**:
- `Processing incident creation`
- `Processing incident update`
- `Incident created successfully`
- `Incident updated successfully`

**Reverse Sync**:
- `Processing ServiceNow → incident.io sync`
- `Successfully synced ServiceNow changes to incident.io`
- `No mappable changes found, skipping sync`

### Health Check

Check integration health:

```bash
curl http://localhost:$PORT/health
```

## Error Handling

### Common Scenarios

1. **incident.io API Errors**:
   - Automatic retry with exponential backoff
   - Detailed error logging
   - Failed requests logged for manual review

2. **ServiceNow API Errors**:
   - Connection timeouts handled
   - Authentication failures logged
   - Rate limit errors respected

3. **Mapping Errors**:
   - Invalid field values logged
   - Missing required fields cause failures
   - Custom field mappings validated

### Recovery Procedures

1. **Check Logs**: Review application logs for error details
2. **Verify Connectivity**: Test API connections to both systems
3. **Validate Configuration**: Ensure field mappings are correct
4. **Manual Sync**: Use manual sync endpoints for recovery

## Performance Considerations

### Optimization Settings

```json
{
  "performance": {
    "concurrent_requests": 3,
    "batch_size": 10,
    "rate_limit": {
      "requests_per_minute": 30
    }
  }
}
```

### Best Practices

1. **Selective Sync**: Only sync incidents that need bidirectional updates
2. **Field Filtering**: Limit synced fields to essential ones only
3. **Batch Processing**: Use bulk operations where possible
4. **Rate Limiting**: Respect API rate limits of both systems

## Security

### Webhook Signatures

Enable signature verification:

```json
{
  "webhook": {
    "verify_signature": true,
    "secret": "your-incident-io-secret"
  },
  "servicenow_webhook": {
    "verify_signature": true,
    "secret": "your-servicenow-secret"
  }
}
```

### Network Security

- Use HTTPS for all webhook endpoints
- Implement IP allowlisting if possible
- Use secure API keys and rotate regularly

## Troubleshooting

### Debug Mode

Enable debug logging:

```json
{
  "logging": {
    "level": "debug"
  }
}
```

### Common Issues

1. **ServiceNow Business Rule Not Triggering**:
   - Check Business Rule is active
   - Verify field conditions
   - Review ServiceNow logs

2. **incident.io Updates Not Reflecting**:
   - Check API permissions
   - Verify incident exists
   - Review field mapping configuration

3. **Webhook Signature Failures**:
   - Verify shared secrets match
   - Check signature generation logic
   - Review webhook payload format

### Testing Checklist

- [ ] incident.io webhook receives and processes correctly
- [ ] ServiceNow Business Rule triggers on field changes
- [ ] ServiceNow webhook endpoint receives data
- [ ] Field mappings work in both directions
- [ ] No sync loops occur during testing
- [ ] Error handling works for API failures
- [ ] Logs provide adequate debugging information